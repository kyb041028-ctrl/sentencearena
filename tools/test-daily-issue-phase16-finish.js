#!/usr/bin/env node
'use strict';

/**
 * Phase 16 마무리 — LIVE OpenAI(허가 시), LIVE AI→PG, LIVE RSS 진단, 누락 검증.
 * 운영 DB/배포 없음. 키·플래그 없으면 BLOCKED_NOT_CONFIGURED (env만 PASS 금지).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const evalCore = require('../shared/daily-issue-ai-eval-core');
const aiService = require('../server/daily-issue-ai-service');
const reviewCore = require('../shared/daily-issue-review-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const registry = require('../config/daily-issue-source-registry');
const fetcher = require('../server/daily-issue-feed-fetcher');
const feedCore = require('../shared/daily-issue-feed-core');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const { readRegionAiEnv } = require('../config/daily-issue-ai-env');
const { createDailyIssuePgExecutor } = require('../server/daily-issue-pg-client');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');
const contract = require('../shared/daily-issue-review-repository-contract');
const { bootDailyIssueLocalPg } = require('./lib/daily-issue-local-pg-harness');
const fixtures = require('./lib/daily-issue-phase16-fixtures');
const quarantine = require('./lib/daily-issue-us-quarantine-report');

const AS_OF = fixtures.AS_OF;
const ROOT = path.join(__dirname, '..');

const finish = {
  1: 'BLOCKED',
  2: 'BLOCKED',
  3: 'NOT_TESTED',
  4: 'NOT_TESTED',
  5: 'NOT_TESTED',
};

let failed = 0;
const liveCaptured = { us: null, kr: null };

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

function safeJsonLog(label, obj) {
  const s = JSON.stringify(obj || {});
  check(label + ' no key leak', !/sk-[a-z0-9]{8,}/i.test(s));
  console.log(label, s);
}

function liveGate(region) {
  const env =
    region === 'KR'
      ? readRegionAiEnv('KR', Object.assign({}, process.env, { DAILY_ISSUE_KR_AI_ENABLED: '1' }))
      : readRegionAiEnv('US', process.env);
  if (!env.configured || !env.liveTestAllowed) {
    return { ok: false, blockedReason: env.blockedReason || 'BLOCKED_NOT_CONFIGURED' };
  }
  return { ok: true, env: env };
}

async function runLiveOpenAiRegion(region) {
  const gate = liveGate(region);
  const cand = region === 'US' ? fixtures.buildUsReady('liveapi') : fixtures.buildKrReady('liveapi');
  const envExtra = region === 'KR' ? { DAILY_ISSUE_KR_AI_ENABLED: '1' } : {};

  if (!gate.ok) {
    const probe = await aiService.evaluateOneCandidate(cand, {
      region: region,
      asOf: AS_OF,
      env: Object.assign({}, process.env, envExtra),
    });
    check(
      region + ' live blockedNotConfigured',
      probe.ok !== true &&
        (probe.outcome === evalCore.OUTCOME.BLOCKED_NOT_CONFIGURED ||
          probe.errorCode === 'BLOCKED_NOT_CONFIGURED' ||
          probe.runOutcome === evalCore.RUN_OUTCOME.AI_NOT_CONFIGURED),
      probe.outcome || probe.errorCode,
    );
    return { ok: false, blocked: true };
  }

  const live = await aiService.evaluateOneCandidate(cand, {
    region: region,
    asOf: AS_OF,
    env: Object.assign({}, process.env, envExtra),
  });

  liveCaptured[region === 'US' ? 'us' : 'kr'] = live;

  const pass =
    live.ok === true &&
    live.outcome === evalCore.OUTCOME.AI_CALL_OK &&
    live.candidate &&
    live.candidate.aiVerificationMeta &&
    live.candidate.aiVerificationMeta.verificationStatus === 'AI_VERIFIED' &&
    live.callLog &&
    live.callLog.ok === true;

  check(region + ' live API success', pass, live.outcome || live.errorCode);
  if (pass) {
    safeJsonLog('LIVE_' + region + '_METRICS', {
      model: live.callLog.model,
      provider: live.callLog.provider,
      latencyMs: live.callLog.latencyMs,
      estimatedUsd: live.callLog.estimatedUsd,
      usage: live.callLog.usage,
      title: String(live.candidate.title || '').slice(0, 80),
      verificationStatus: live.candidate.aiVerificationMeta.verificationStatus,
    });
  }
  return { ok: pass, live: live };
}

async function runFinishLiveOpenAi() {
  console.log('=== FINISH_01_LIVE_OPENAI [ACTUAL_API] ===');
  const us = await runLiveOpenAiRegion('US');
  const kr = await runLiveOpenAiRegion('KR');

  if (us.blocked && kr.blocked) {
    finish[1] = 'BLOCKED';
  } else if (us.ok && kr.ok) {
    finish[1] = 'PASS';
  } else {
    finish[1] = 'FAIL';
  }
}

async function persistEvalToPg(evalRes, region, pg, suffix) {
  const enriched = evalRes.candidate;
  enriched.candidateId = enriched.candidateId || 'live_' + region + '_' + suffix;
  enriched.id = enriched.candidateId;
  enriched.clusterId = enriched.clusterId || 'live_cl_' + suffix;
  enriched.category = region === 'US' ? 'us-national' : 'korea-economy';
  enriched.activityRegion = region;
  enriched.lifecycleMeta = Object.assign({}, enriched.lifecycleMeta || {}, {
    aiEvalRunKey: 'live-ai-' + region + '-' + suffix,
    aiVerificationMeta: enriched.aiVerificationMeta,
  });

  const created = reviewCore.createReviewItem(enriched, { asOf: AS_OF, existingItems: [] });
  if (!created.ok) return { ok: false, step: 'review', detail: (created.reasons || []).join(',') };

  const item = created.item;
  item.activityRegion = region;
  item.lifecycleMeta = Object.assign({}, item.lifecycleMeta, enriched.lifecycleMeta);
  item.aiVerificationMeta = enriched.aiVerificationMeta;
  item.aiArticle = enriched.aiArticle;

  const execA = createDailyIssuePgExecutor({ databaseUrl: pg.connectionString, schemaName: pg.schemaName });
  const repoA = createDailyIssueReviewRepository({ kind: 'db', executor: execA, schemaName: pg.schemaName, enabled: true });
  await repoA.initialize();
  const ins = await repoA.insertReviewItems([item], [], {});
  if (execA.end) await execA.end();
  if (!ins.ok) return { ok: false, step: 'insert', detail: ins.error };

  const execB = createDailyIssuePgExecutor({ databaseUrl: pg.connectionString, schemaName: pg.schemaName });
  const repoB = createDailyIssueReviewRepository({ kind: 'db', executor: execB, schemaName: pg.schemaName, enabled: true });
  await repoB.initialize();
  const got = await repoB.getById(item.id);
  if (execB.end) await execB.end();
  if (!got.ok || !got.item) return { ok: false, step: 'fetch', detail: got.error };

  const fetched = got.item;
  check(region + ' live PG region', fetched.activityRegion === region);
  check(region + ' live PG title', String(fetched.title) === String(enriched.title));
  const lm = fetched.lifecycleMeta || {};
  check(region + ' live PG aiEvalRunKey', lm.aiEvalRunKey === enriched.lifecycleMeta.aiEvalRunKey);
  check(region + ' live PG provider openai or mock', !!(lm.aiEval && lm.aiEval.provider) || !!(fetched.aiVerificationMeta && fetched.aiVerificationMeta.provider));
  const bg =
    (fetched.aiArticle && fetched.aiArticle.backgroundContext) ||
    (lm.aiVerificationMeta && lm.aiVerificationMeta.backgroundContext) ||
    '';
  check(region + ' live PG background preserved', String(bg).length > 0);
  const pub = (fetched.sourceRefs || [])[0];
  check(region + ' live PG source publishedAt', !!(pub && pub.publishedAt));
  const decision = decisionCore.classifyPublicationDecision(fetched, { asOf: AS_OF });
  check(region + ' live PG eligibility recorded', !!decision.publicationDecision);

  return { ok: true, item: fetched };
}

async function runFinishLiveAiPg() {
  console.log('=== FINISH_02_LIVE_AI_PG [ACTUAL_API+ISOLATED_DB] ===');
  if (finish[1] !== 'PASS') {
    finish[2] = 'BLOCKED';
    console.log('LIVE_AI_PG', 'BLOCKED_NO_LIVE_AI_SUCCESS');
    return;
  }

  const usLive = liveCaptured.us;
  const krLive = liveCaptured.kr;

  const pg = await bootDailyIssueLocalPg({});
  if (!pg.ok) {
    finish[2] = 'FAIL';
    check('PG boot for live AI', false, pg.error);
    return;
  }

  try {
    const rUs = await persistEvalToPg(usLive, 'US', pg, 'us');
    check('US live AI PG persist', rUs.ok === true, rUs.detail || rUs.step);
    const rKr = await persistEvalToPg(krLive, 'KR', pg, 'kr');
    check('KR live AI PG persist', rKr.ok === true, rKr.detail || rKr.step);
    finish[2] = failed === 0 ? 'PASS' : 'FAIL';
  } finally {
    await pg.shutdown();
  }
}

function classifyDiagnosisBucket(c) {
  const qual = c.qualityFailureReasons || [];
  const fresh = c.freshnessFailureReasons || [];
  if (qual.some(function (q) {
    return String(q).indexOf('JOURNALISM') >= 0 || String(q).indexOf('INDEPENDENT') >= 0;
  })) {
    return 'INDEPENDENT_SOURCE';
  }
  if (qual.some(function (q) {
    return String(q).indexOf('EVIDENCE') >= 0 || String(q).indexOf('CONFIRMED') >= 0 || String(q).indexOf('CLAIM') >= 0;
  })) {
    return 'EVIDENCE_OR_CLAIM';
  }
  if (fresh.length) return 'FRESHNESS';
  const gate = c.independentSourceGate || {};
  if (gate.ok !== true || gate.reason === 'SINGLE_DOC') return 'CLUSTER_OR_SOURCE';
  const primary = quarantine.primaryQuarantineBucket(c);
  if (primary === 'INDEPENDENT_SOURCE_INSUFFICIENT') return 'INDEPENDENT_SOURCE';
  if (primary && String(primary).indexOf('FRESHNESS') >= 0) return 'FRESHNESS';
  if (primary === 'CLUSTER_OR_SOURCE_GATE') return 'CLUSTER_OR_SOURCE';
  if (qual.length) return 'EVIDENCE_OR_CLAIM';
  return 'OTHER';
}

async function runFinishLiveRssDiagnosis() {
  console.log('=== FINISH_03_LIVE_RSS [ACTUAL_RSS] ===');
  const ids = ['npr-world', 'fed-press'];
  let feedOk = false;
  for (let i = 0; i < ids.length; i += 1) {
    const src = registry.getSourceById(ids[i]);
    if (!src || !src.enabled) continue;
    try {
      const fetched = await fetcher.fetchTextSafe(src.feedUrl, { timeoutMs: 15000, maxBytes: 900000 });
      const parsed = feedCore.parseRssOrAtom(fetched.body, {
        publisher: src.publisher,
        sourceRegistryId: src.id,
        retrievedAt: new Date().toISOString(),
      });
      if (fetched.status === 200 && parsed.ok && parsed.items.length > 0) feedOk = true;
    } catch (_) {}
  }

  if (!feedOk) {
    finish[3] = 'NOT_TESTED';
    console.log('LIVE_RSS_DIAG', JSON.stringify({ outcome: 'COLLECT_FAILED', feedsReachable: false }));
    return;
  }

  let ingest;
  try {
    ingest = await runDailyIssueIngest({
      dryRun: true,
      group: 'us-national',
      language: 'en',
      sinceHours: 72,
      maxItems: 6,
      asOf: AS_OF,
      includeFullCandidates: true,
    });
  } catch (e) {
    finish[3] = 'NOT_TESTED';
    console.log('LIVE_RSS_DIAG', JSON.stringify({ outcome: 'COLLECT_FAILED', error: String(e.message || e).slice(0, 120) }));
    return;
  }

  const manifest = ingest.manifest || {};
  const sourceResults = manifest.sourceResults || [];
  const collectFailed = sourceResults.length > 0 && sourceResults.every(function (s) {
    return !s.ok;
  });
  const allCandidates = ingest.candidates || ingest.allCandidates || [];
  const ready = (ingest.readyCandidates || []).filter(function (c) {
    return c && c.ok && c.publicationStatus === 'READY';
  });

  const buckets = {
    COLLECT_FAILED: collectFailed ? 1 : 0,
    CLUSTER_OR_SOURCE: 0,
    INDEPENDENT_SOURCE: 0,
    FRESHNESS: 0,
    EVIDENCE_OR_CLAIM: 0,
    OTHER: 0,
  };

  allCandidates.forEach(function (c) {
    if (c && c.ok && c.publicationStatus === 'READY') return;
    const b = classifyDiagnosisBucket(c || {});
    buckets[b] = (buckets[b] || 0) + 1;
  });

  const diag = {
    readyCount: ready.length,
    candidateCount: allCandidates.length,
    buckets: buckets,
    runClass: quarantine.classifyUsIngestRun(manifest, allCandidates, ready.length),
    samples: allCandidates.slice(0, 3).map(function (c) {
      return quarantine.summarizeLiveCandidate(c);
    }),
  };
  console.log('LIVE_RSS_DIAG', JSON.stringify(diag));

  finish[3] = ready.length > 0 ? 'PASS' : 'NOT_TESTED';
}

async function runFinishGapTests(pg) {
  console.log('=== FINISH_04_GAP [MOCK+ISOLATED_DB] ===');
  const before = failed;

  const officialPlusOne = {
    ok: true,
    publicationStatus: 'READY',
    freshnessOk: true,
    activityRegion: 'KR',
    title: '고용',
    confirmedSummary: '통계청 발표',
    claims: [],
    normalizedSources: [
      { id: 'o1', publisher: '통계청', sourceType: 'OFFICIAL', url: 'https://kostat.go.kr/x', independentNetworkKey: 'kostat' },
      { id: 'j1', publisher: '연합뉴스', url: 'https://yna.co.kr/x', independentNetworkKey: 'yna-co-kr' },
    ],
    independentSourceGate: { ok: true, journalismIndependentCount: 2 },
    qualityFailureReasons: [],
    retrievedAt: AS_OF,
  };
  const og = evalCore.ruleEligibleForAi(officialPlusOne, 'KR');
  check('official+1 journalism gate blocked', og.ok === false);

  const us = fixtures.buildUsReady('gap');
  const env = {
    DAILY_ISSUE_US_AI_API_KEY: 'mock-gap',
    DAILY_ISSUE_KR_AI_ENABLED: '1',
    DAILY_ISSUE_KR_AI_API_KEY: 'mock-gap',
  };
  const failEval = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: env,
    adapter: fixtures.mockAdapter(
      Object.assign({}, fixtures.usAiPayload(us), {
        confirmedFacts: [{ text: 'Exactly 777777 banks vanished.', sourceIds: [us.sourceRefs[0].id, us.sourceRefs[1].id] }],
      }),
    ),
  });
  check('failed eval not ok', failEval.ok !== true);

  const failItem = fixtures.buildUsReady('gapfail');
  const created = reviewCore.createReviewItem(failItem, { asOf: AS_OF, existingItems: [] });
  if (created.ok) {
    const item = created.item;
    item.activityRegion = 'US';
    item.lifecycleMeta = Object.assign({}, item.lifecycleMeta, {
      aiVerificationMeta: {
        verificationStatus: 'AI_FAILED',
        blockedReasons: failEval.blockedReasons || ['GROUNDING_NUMBER_CONFIRMED_0'],
        outcome: failEval.runOutcome,
      },
      aiEvalRunKey: 'gap-fail-run',
    });
    item.aiVerificationMeta = item.lifecycleMeta.aiVerificationMeta;

    const exec = createDailyIssuePgExecutor({ databaseUrl: pg.connectionString, schemaName: pg.schemaName });
    const repo = createDailyIssueReviewRepository({ kind: 'db', executor: exec, schemaName: pg.schemaName, enabled: true });
    await repo.initialize();
    await repo.insertReviewItems([item], [], {});

    const got = await repo.getById(item.id);
    const br = (got.item && got.item.lifecycleMeta && got.item.lifecycleMeta.aiVerificationMeta && got.item.lifecycleMeta.aiVerificationMeta.blockedReasons) || [];
    check('failure reasons PG roundtrip', br.length > 0);

    const rejectNext = Object.assign({}, got.item, {
      status: lifecycle.REVIEW_STATUS.REJECTED,
      rejectReason: 'FACT_CHECK_GAP',
      lockVersion: got.item.lockVersion,
    });
    const trans = await repo.transitionReviewItem({
      id: got.item.id,
      expectedStatus: lifecycle.REVIEW_STATUS.READY_FOR_REVIEW,
      expectedLockVersion: got.item.lockVersion,
      nextItem: rejectNext,
      auditEvents: [
        {
          action: 'REJECT',
          entityId: got.item.id,
          entityType: 'review_item',
          fromStatus: lifecycle.REVIEW_STATUS.READY_FOR_REVIEW,
          toStatus: lifecycle.REVIEW_STATUS.REJECTED,
          reasonCode: 'FACT_CHECK_GAP',
          reasonText: 'gap test provenance',
        },
      ],
    });
    check('reject transition ok', trans.ok === true);
    const audits = await repo.listAuditEvents({ entityId: got.item.id });
    check('audit history after reject', audits.ok === true && (audits.events || []).length >= 1);

    const good = fixtures.buildUsReady('gapgood');
    const okEval = await aiService.evaluateOneCandidate(good, {
      region: 'US',
      asOf: AS_OF,
      env: env,
      adapter: fixtures.mockAdapter(fixtures.usAiPayload(good)),
    });
    const c2 = reviewCore.createReviewItem(okEval.candidate, { asOf: AS_OF, existingItems: [] });
    if (c2.ok) {
      const item2 = c2.item;
      item2.id = 'gap_batch_second';
      item2.candidateId = item2.id;
      const batch = await repo.insertReviewItems([item, item2], [], {});
      check('batch persist fail closed', batch.ok === false);
      const absent = await repo.getById(item2.id);
      check('failed batch second absent', absent.ok !== true || !absent.item);
    }

    if (exec.end) await exec.end();
  }

  finish[4] = failed === before ? 'PASS' : 'FAIL';
}

function runFinishRegression() {
  console.log('=== FINISH_05_REGRESSION [MOCK] ===');
  const before = failed;
  const v15 = spawnSync(process.execPath, [path.join(__dirname, 'test-daily-issue-phase15-voice-block.js')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  check('phase15 voice regression', v15.status === 0, 'exit ' + v15.status);
  finish[5] = failed === before ? 'PASS' : 'FAIL';
}

function printFinishReports() {
  console.log('FINISH_REPORT_01 category=ACTUAL_API', finish[1]);
  console.log('FINISH_REPORT_02 category=ACTUAL_API+ISOLATED_DB', finish[2]);
  console.log('FINISH_REPORT_03 category=ACTUAL_RSS', finish[3]);
  console.log('FINISH_REPORT_04 category=MOCK+ISOLATED_DB', finish[4]);
  console.log('FINISH_REPORT_05 category=MOCK_REGRESSION', finish[5]);
}

async function main() {
  console.log('=== PHASE16_FINISH ===');
  console.log('BASE_COMMIT', '3a7c28d');

  await runFinishLiveOpenAi();
  await runFinishLiveAiPg();
  await runFinishLiveRssDiagnosis();

  const pg = await bootDailyIssueLocalPg({});
  if (pg.ok) {
    try {
      await runFinishGapTests(pg);
    } finally {
      await pg.shutdown();
    }
  } else {
    finish[4] = 'FAIL';
    check('PG boot gap tests', false, pg.error);
  }

  runFinishRegression();
  printFinishReports();

  if (failed) {
    console.log('PHASE16_FINISH_FAIL', failed);
    process.exitCode = 1;
  } else {
    console.log('PHASE16_FINISH_OK');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
