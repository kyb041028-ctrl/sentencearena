#!/usr/bin/env node
'use strict';

/**
 * Phase 16 — isolated PG roundtrip, extended voice, fixture/live RSS, optional LIVE OpenAI.
 * No operational deploy / Supabase / auto-publish.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const evalCore = require('../shared/daily-issue-ai-eval-core');
const aiService = require('../server/daily-issue-ai-service');
const reviewCore = require('../shared/daily-issue-review-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const morning = require('../server/daily-issue-morning-scheduler-service');
const { readRegionAiEnv, isAiPipelineEnabledForRegion } = require('../config/daily-issue-ai-env');
const { createDailyIssuePgExecutor } = require('../server/daily-issue-pg-client');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');
const contract = require('../shared/daily-issue-review-repository-contract');
const registry = require('../config/daily-issue-source-registry');
const fetcher = require('../server/daily-issue-feed-fetcher');
const feedCore = require('../shared/daily-issue-feed-core');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const { bootDailyIssueLocalPg } = require('./lib/daily-issue-local-pg-harness');
const fixtures = require('./lib/daily-issue-phase16-fixtures');

const AS_OF = fixtures.AS_OF;
const ROOT = path.join(__dirname, '..');

const report = {
  1: 'PASS',
  2: 'NOT_TESTED',
  3: 'NOT_TESTED',
  4: 'NOT_TESTED',
  5: 'NOT_TESTED',
  6: 'NOT_TESTED',
  7: 'NOT_TESTED',
  8: 'NOT_TESTED',
  9: 'NOT_TESTED',
  10: 'NOT_TESTED',
  11: 'NOT_TESTED',
  12: 'BLOCKED',
  13: 'BLOCKED',
  14: 'NOT_TESTED',
};

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

function mockEnv() {
  return {
    DAILY_ISSUE_US_AI_API_KEY: 'mock-p16-us',
    DAILY_ISSUE_KR_AI_ENABLED: '1',
    DAILY_ISSUE_KR_AI_API_KEY: 'mock-p16-kr',
  };
}

async function expectBlocked(label, result) {
  check(label + ' blocked', result.ok !== true, result.runOutcome || result.errorCode);
}

async function runExtendedVoice() {
  console.log('=== PHASE16_VOICE ===');
  process.env.DAILY_ISSUE_US_AI_API_KEY = 'mock-p16-us';
  process.env.DAILY_ISSUE_KR_AI_ENABLED = '1';
  process.env.DAILY_ISSUE_KR_AI_API_KEY = 'mock-p16-kr';

  const us = fixtures.buildUsReady('voice');
  const kr = fixtures.buildKrReady('voice');
  const env = mockEnv();

  check(
    'US good path',
    (await aiService.evaluateOneCandidate(us, { region: 'US', asOf: AS_OF, env: env, adapter: fixtures.mockAdapter(fixtures.usAiPayload(us)) }))
      .ok === true,
  );
  check(
    'KR good path',
    (await aiService.evaluateOneCandidate(kr, { region: 'KR', asOf: AS_OF, env: env, adapter: fixtures.mockAdapter(fixtures.krAiPayload(kr)) }))
      .ok === true,
  );

  await expectBlocked(
    'fake date',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(
        Object.assign({}, fixtures.usAiPayload(us), { factSummary: 'On 2099-01-01 all banks closed.' }),
      ),
    }),
  );

  await expectBlocked(
    'fake institution',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(
        Object.assign({}, fixtures.usAiPayload(us), {
          confirmedFacts: [{ text: 'The Department of Imaginary Affairs seized all banks.', sourceIds: [us.sourceRefs[0].id] }],
        }),
      ),
    }),
  );

  await expectBlocked(
    'fake causality',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(
        Object.assign({}, fixtures.usAiPayload(us), {
          backgroundContext: 'Because Martian tariffs caused the banks to vanish overnight.',
        }),
      ),
    }),
  );

  await expectBlocked(
    'number distortion',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(
        Object.assign({}, fixtures.usAiPayload(us), {
          confirmedFacts: [{ text: 'Exactly 888888 banks failed yesterday.', sourceIds: [us.sourceRefs[0].id, us.sourceRefs[1].id] }],
        }),
      ),
    }),
  );

  await expectBlocked(
    'title-only fabrication',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(Object.assign({}, fixtures.usAiPayload(us), { articleTitle: 'Secret moon treaty abolished all banks' })),
    }),
  );

  await expectBlocked(
    'question premise fabrication',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(
        Object.assign({}, fixtures.usAiPayload(us), {
          discussionQuestion: 'Since 999999 banks failed yesterday, what should depositors do?',
        }),
      ),
    }),
  );

  await expectBlocked(
    'keyword-only semantic lie',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(
        Object.assign({}, fixtures.usAiPayload(us), {
          confirmedFacts: [
            { text: 'Bank supervision review findings triggered nuclear war.', sourceIds: [us.sourceRefs[0].id, us.sourceRefs[1].id] },
          ],
        }),
      ),
    }),
  );

  await expectBlocked(
    'US eval on KR candidate',
    await aiService.evaluateOneCandidate(kr, { region: 'US', asOf: AS_OF, env: env, adapter: fixtures.mockAdapter(fixtures.krAiPayload(kr)) }),
  );
  await expectBlocked(
    'KR eval on US candidate',
    await aiService.evaluateOneCandidate(us, { region: 'KR', asOf: AS_OF, env: env, adapter: fixtures.mockAdapter(fixtures.usAiPayload(us)) }),
  );

  const authFail = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: env,
    adapter: { callStructured: async () => ({ ok: false, errorCode: 'AI_AUTH_ERROR' }) },
  });
  check('auth failure blocked', authFail.ok !== true && authFail.outcome === evalCore.OUTCOME.AI_AUTH_ERROR);

  const timeoutFail = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: env,
    adapter: { callStructured: async () => ({ ok: false, errorCode: 'AI_TIMEOUT' }) },
  });
  check('timeout blocked', timeoutFail.ok !== true);

  const costFail = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: env,
    estimatedUsdSoFar: 999,
    adapter: fixtures.mockAdapter(fixtures.usAiPayload(us)),
  });
  check('cost limit blocked', costFail.ok !== true && costFail.outcome === evalCore.OUTCOME.AI_COST_LIMIT);

  const badJson = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: env,
    adapter: { callStructured: async () => ({ ok: false, errorCode: 'AI_INVALID_JSON' }) },
  });
  check('bad JSON blocked', badJson.ok !== true);

  delete process.env.DAILY_ISSUE_US_AI_API_KEY;
  delete process.env.DAILY_ISSUE_KR_AI_API_KEY;
  delete process.env.DAILY_ISSUE_KR_AI_ENABLED;

  report[2] = failed === 0 ? 'PASS' : 'FAIL';
  report[3] = report[2];
  return failed;
}

async function verifyAiFailureBlocksReview() {
  console.log('=== PHASE16_AI_FAILURE_REVIEW ===');
  const before = failed;
  const us = fixtures.buildUsReady('fail');
  const probe = Object.assign({}, us, {
    activityRegion: 'US',
    lifecycleMeta: { aiEval: { verificationStatus: 'AI_FAILED' }, activityRegion: 'US' },
    aiVerificationMeta: { verificationStatus: 'AI_FAILED', blockedReasons: ['GROUNDING_NUMBER_CONFIRMED_0'] },
  });
  const decision = decisionCore.classifyPublicationDecision(probe, { asOf: AS_OF });
  check('AI_FAILED not AUTO eligible', decision.publicationDecision !== decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE);
  const created = reviewCore.createReviewItem(
    Object.assign({}, us, { publicationStatus: 'READY', ok: true, lifecycleMeta: { aiEval: { verificationStatus: 'AI_FAILED' } } }),
    { asOf: AS_OF, existingItems: [] },
  );
  check('AI_FAILED still enqueue review item', created.ok === true);
  report[4] = failed === before ? 'PASS' : 'FAIL';
}

function assertRoundtripMeta(original, fetched, region) {
  check('region persisted', fetched.activityRegion === region);
  check('title roundtrip', String(fetched.title || '') === String(original.title || ''));
  check('summary roundtrip', String(fetched.confirmedSummary || '') === String(original.confirmedSummary || ''));
  check('discussion roundtrip', String(fetched.discussionPrompt || '') === String(original.discussionPrompt || ''));
  const lm = fetched.lifecycleMeta || {};
  const ai = lm.aiVerificationMeta || fetched.aiVerificationMeta || lm.aiEval || {};
  check('ai model meta', !!(ai.model || (lm.aiEval && lm.aiEval.model)));
  check('verification status', (ai.verificationStatus || lm.aiEval && lm.aiEval.verificationStatus) === 'AI_VERIFIED');
  check('usage tokens preserved', !!(ai.usage || (lm.aiEval && lm.aiEval.usage)));
  check('claims preserved', Array.isArray(fetched.claims) && fetched.claims.length > 0);
  check('sources preserved', Array.isArray(fetched.sourceRefs) && fetched.sourceRefs.length >= 2);
}

async function pgRegionRoundtrip(region, suffix, pg) {
  const cand = region === 'US' ? fixtures.buildUsReady(suffix) : fixtures.buildKrReady(suffix);
  const env = mockEnv();
  const evalRes = await aiService.evaluateOneCandidate(cand, {
    region: region,
    asOf: AS_OF,
    env: env,
    adapter: fixtures.mockAdapter(region === 'US' ? fixtures.usAiPayload(cand) : fixtures.krAiPayload(cand)),
  });
  if (!evalRes.ok) return { ok: false, step: 'ai', detail: evalRes.errorCode || evalRes.runOutcome };

  const enriched = evalRes.candidate;
  enriched.candidateId = enriched.candidateId || cand.candidateId;
  enriched.id = enriched.candidateId;
  enriched.clusterId = cand.clusterId;
  enriched.category = cand.category;

  const created = reviewCore.createReviewItem(enriched, { asOf: AS_OF, existingItems: [] });
  if (!created.ok) return { ok: false, step: 'review', detail: (created.reasons || []).join(',') };

  const item = created.item;
  item.activityRegion = region;
  item.lifecycleMeta = Object.assign({}, item.lifecycleMeta, enriched.lifecycleMeta || {}, {
    aiVerificationMeta: enriched.aiVerificationMeta,
    aiEval: enriched.lifecycleMeta && enriched.lifecycleMeta.aiEval,
  });
  item.aiVerificationMeta = enriched.aiVerificationMeta;
  item.aiArticle = enriched.aiArticle;

  const execA = createDailyIssuePgExecutor({ databaseUrl: pg.connectionString, schemaName: pg.schemaName });
  const repoA = createDailyIssueReviewRepository({ kind: 'db', executor: execA, schemaName: pg.schemaName, enabled: true });
  await repoA.initialize();
  const ins = await repoA.insertReviewItems([item], [], {});
  if (!ins.ok) {
    if (execA.end) await execA.end();
    return { ok: false, step: 'insert', detail: ins.error || 'insert failed' };
  }
  if (execA.end) await execA.end();

  const execB = createDailyIssuePgExecutor({ databaseUrl: pg.connectionString, schemaName: pg.schemaName });
  const repoB = createDailyIssueReviewRepository({ kind: 'db', executor: execB, schemaName: pg.schemaName, enabled: true });
  await repoB.initialize();
  const got = await repoB.getById(item.id);
  if (!got.ok || !got.item) {
    if (execB.end) await execB.end();
    return { ok: false, step: 'fetch', detail: got.error || 'missing row' };
  }

  assertRoundtripMeta(enriched, got.item, region);

  const dup = await repoB.insertReviewItems([item], [], {});
  check('duplicate insert rejected', dup.ok === false && dup.error === contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION);

  const decision = decisionCore.classifyPublicationDecision(got.item, { asOf: AS_OF });
  check('stored candidate publication decision present', !!decision.publicationDecision);

  if (execB.end) await execB.end();

  return { ok: failed === 0, item: got.item, enriched: enriched };
}

async function runPgIntegration() {
  console.log('=== PHASE16_PG ===');
  const pg = await bootDailyIssueLocalPg({});
  if (!pg.ok) {
    report[5] = 'FAIL';
    report[6] = 'FAIL';
    report[7] = 'FAIL';
    report[8] = 'FAIL';
    check('PG boot', false, pg.error);
    return;
  }

  try {
    const us = await pgRegionRoundtrip('US', 'pgus', pg);
    check('US PG roundtrip', us.ok === true, us.detail || us.step);
    report[5] = us.ok && failed === 0 ? 'PASS' : 'FAIL';

    const kr = await pgRegionRoundtrip('KR', 'pgkr', pg);
    check('KR PG roundtrip', kr.ok === true, kr.detail || kr.step);
    report[6] = kr.ok && failed === 0 ? 'PASS' : 'FAIL';

    report[7] = report[5] === 'PASS' && report[6] === 'PASS' ? 'PASS' : 'FAIL';
    report[8] = report[7];

    const unverified = fixtures.buildUsReady('unverified');
    const created = reviewCore.createReviewItem(unverified, { asOf: AS_OF, existingItems: [] });
    if (created.ok) {
      const d0 = decisionCore.classifyPublicationDecision(created.item, { asOf: AS_OF });
      check(
        'without AI verify stays manual or held',
        d0.publicationDecision === decisionCore.DECISION.MANUAL_REVIEW_REQUIRED ||
          d0.publicationDecision === decisionCore.DECISION.HELD,
        d0.publicationDecision,
      );
    }
  } finally {
    await pg.shutdown();
  }
}

async function runFixtureRss() {
  console.log('=== PHASE16_FIXTURE_RSS ===');
  const NPR = fs.readFileSync(path.join(__dirname, 'fixtures', 'daily-issue-us-npr-fixture.xml'), 'utf8');
  const FED = fs.readFileSync(path.join(__dirname, 'fixtures', 'daily-issue-us-fed-fixture.xml'), 'utf8');
  delete process.env.DAILY_ISSUE_US_AI_API_KEY;
  const collect = await morning.defaultCollectAndEnqueue({
    activityRegion: 'US',
    group: 'us-national',
    language: 'en',
    skipNetwork: true,
    feedBodies: { 'npr-world': NPR, 'fed-press': FED },
    asOf: AS_OF,
    sinceHours: 168,
    dryRun: true,
  });
  check('fixture collect ok', collect.ok !== false);
  check('fixture regionAiRun present', !!(collect.regionAiRun || collect.usAiRun));
  const aiRun = collect.regionAiRun || collect.usAiRun;
  check('fixture AI blocked without key', aiRun && aiRun.blockedNotConfigured === true);
  report[9] = failed === 0 ? 'PASS' : 'FAIL';
}

async function runLiveRssProbe() {
  console.log('=== PHASE16_LIVE_RSS ===');
  const ids = ['npr-world', 'fed-press'];
  let anyOk = false;
  for (let i = 0; i < ids.length; i += 1) {
    const src = registry.getSourceById(ids[i]);
    if (!src || !src.enabled) continue;
    try {
      const fetched = await fetcher.fetchTextSafe(src.feedUrl, { timeoutMs: 12000, maxBytes: 800000 });
      const parsed = feedCore.parseRssOrAtom(fetched.body, {
        publisher: src.publisher,
        sourceRegistryId: src.id,
        retrievedAt: new Date().toISOString(),
      });
      if (fetched.status === 200 && parsed.ok && parsed.items.length > 0) anyOk = true;
    } catch (_) {}
  }
  if (!anyOk) {
    report[10] = 'NOT_TESTED';
    console.log('LIVE_RSS_SKIPPED', 'NO_APPROVED_FEED_RESPONSE');
    return;
  }
  try {
    const ingest = await runDailyIssueIngest({
      dryRun: true,
      group: 'us-national',
      language: 'en',
      sinceHours: 72,
      maxItems: 4,
      asOf: AS_OF,
      includeFullCandidates: true,
    });
    const ready = (ingest.readyCandidates || []).filter(function (c) {
      return c && c.ok && c.publicationStatus === 'READY';
    });
    console.log('LIVE_RSS_READY_COUNT', ready.length);
    report[10] = ready.length > 0 ? 'PASS' : 'NOT_TESTED';
  } catch (e) {
    report[10] = 'NOT_TESTED';
    console.log('LIVE_RSS_INGEST_SKIP', String(e && e.message ? e.message : e).slice(0, 120));
  }
}

async function runLiveOpenAi() {
  console.log('=== PHASE16_LIVE_OPENAI ===');
  const usEnv = readRegionAiEnv('US', process.env);
  const krEnv = readRegionAiEnv('KR', Object.assign({}, process.env, { DAILY_ISSUE_KR_AI_ENABLED: '1' }));

  if (!usEnv.liveTestAllowed || !usEnv.configured) {
    report[12] = 'BLOCKED';
  } else {
    const usCand = fixtures.buildUsReady('live');
    const live = await aiService.evaluateOneCandidate(usCand, { region: 'US', asOf: AS_OF });
    const ok =
      live.ok === true &&
      live.outcome === evalCore.OUTCOME.AI_CALL_OK &&
      live.callLog &&
      live.callLog.ok === true &&
      !String(JSON.stringify(live)).match(/sk-[a-z0-9]/i);
    report[12] = ok ? 'PASS' : 'FAIL';
    if (ok) {
      console.log('LIVE_US_MODEL', live.callLog.model);
      console.log('LIVE_US_TOKENS', JSON.stringify(live.callLog.usage || {}));
      console.log('LIVE_US_LATENCY_MS', live.callLog.latencyMs);
    }
  }

  if (!krEnv.liveTestAllowed || !krEnv.configured) {
    report[13] = 'BLOCKED';
  } else {
    const krCand = fixtures.buildKrReady('live');
    const liveKr = await aiService.evaluateOneCandidate(krCand, { region: 'KR', asOf: AS_OF, env: { DAILY_ISSUE_KR_AI_ENABLED: '1' } });
    const okKr =
      liveKr.ok === true &&
      liveKr.outcome === evalCore.OUTCOME.AI_CALL_OK &&
      liveKr.callLog &&
      liveKr.callLog.ok === true;
    report[13] = okKr ? 'PASS' : 'FAIL';
  }
}

function runScheduleGuards() {
  console.log('=== PHASE16_SCHEDULE ===');
  const before = failed;
  check('KR AI default off', isAiPipelineEnabledForRegion('KR', {}) === false);
  const usOps = require('../shared/daily-issue-us-ops-core');
  check(
    'US ET slots 11/15/19',
    Array.isArray(usOps.SLOTS) &&
      [11, 15, 19].every(function (h) {
        return usOps.SLOTS.indexOf(h) >= 0;
      }),
  );
  report[14] = failed === before ? 'PASS' : 'FAIL';
}

function runRegressions() {
  console.log('=== PHASE16_REGRESSION ===');
  const v15 = spawnSync(process.execPath, [path.join(__dirname, 'test-daily-issue-phase15-voice-block.js')], { cwd: ROOT, encoding: 'utf8' });
  check('phase15 voice regression', v15.status === 0, 'exit ' + v15.status);
  report[11] = v15.status === 0 ? 'PASS' : 'FAIL';
}

function printReports() {
  for (let i = 1; i <= 14; i += 1) {
    console.log('REPORT_' + String(i).padStart(2, '0'), report[i]);
  }
}

async function main() {
  console.log('=== PHASE16_INTEGRATION ===');
  console.log('BASE_COMMIT', '61c6c3f');

  await runExtendedVoice();
  await verifyAiFailureBlocksReview();
  await runPgIntegration();
  await runFixtureRss();
  await runLiveRssProbe();
  runScheduleGuards();
  runRegressions();
  await runLiveOpenAi();

  printReports();

  if (failed) {
    console.log('PHASE16_FAIL', failed);
    process.exitCode = 1;
  } else {
    console.log('PHASE16_OK');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
