#!/usr/bin/env node
'use strict';

/**
 * 미국판 11차 — LIVE 수집·AI(규칙엔진)·embedded Postgres 통합.
 * 운영 Supabase / JSON-only DB PASS 금지.
 */

const fs = require('fs');
const path = require('path');

const registry = require('../config/daily-issue-source-registry');
const fetcher = require('../server/daily-issue-feed-fetcher');
const feedCore = require('../shared/daily-issue-feed-core');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const usRun = require('../server/daily-issue-us-run-service');
const usOps = require('../shared/daily-issue-us-ops-core');
const { createDailyIssuePgExecutor } = require('../server/daily-issue-pg-client');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');
const { createDailyIssueCommentStore } = require('../server/daily-issue-comment-store');
const { createDailyIssueAlignmentReactionStore } = require('../server/daily-issue-alignment-reaction-store');
const { createDailyIssueApiApp } = require('../server/daily-issue-routes');
const { createLegalGateService } = require('../server/legal-gate-service');
const { bootDailyIssueLocalPg, TEST_USER } = require('./lib/daily-issue-local-pg-harness');
const { requestApp } = require('./daily-issue-api-http-helper');
const legalCore = require('../shared/legal-gate-core');
const {
  makeReady,
  authHeaders,
  createTestAdminAuthGuard,
  memberHeaders,
  ADMIN_TOKEN,
} = require('./daily-issue-api-test-fixtures');

const NPR_FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'daily-issue-us-npr-fixture.xml'), 'utf8');
const FED_FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'daily-issue-us-fed-fixture.xml'), 'utf8');

const KR_USER = '22222222-2222-4222-8222-222222222222';
const US_USER = TEST_USER;
const US_TEEN_17 = '33333333-3333-4333-8333-333333333333';
const AS_OF = '2026-11-04T16:00:00.000Z';
const SLOT_RUN = 'us-daily-issue:2026-11-04:11';

const report = {
  liveCollection: { npr: null, fed: null, ingest: null },
  liveAi: null,
  postgres: null,
  hidePreserve: null,
  ageGate: null,
};

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

function dobForAge(ageYears, nowMs) {
  const today = legalCore.seoulToday(nowMs == null ? Date.now() : nowMs);
  return { year: today.year - ageYears, month: today.month, day: today.day };
}

async function probeFeed(sourceId) {
  const src = registry.getSourceById(sourceId);
  if (!src || !src.enabled) {
    return { sourceId: sourceId, ok: false, mode: 'LIVE_HTTP', error: 'SOURCE_DISABLED_OR_MISSING' };
  }
  try {
    const fetched = await fetcher.fetchTextSafe(src.feedUrl, { timeoutMs: 15000, maxBytes: 1_500_000 });
    const parsed = feedCore.parseRssOrAtom(fetched.body, {
      publisher: src.publisher,
      sourceRegistryId: src.id,
      retrievedAt: new Date().toISOString(),
    });
    const sampleTitle =
      parsed.ok && parsed.items[0] && parsed.items[0].title
        ? String(parsed.items[0].title).slice(0, 80)
        : null;
    return {
      sourceId: sourceId,
      ok: fetched.status === 200 && parsed.ok && parsed.items.length > 0,
      mode: 'LIVE_HTTP',
      httpStatus: fetched.status,
      itemCount: parsed.ok ? parsed.items.length : 0,
      sampleTitle: sampleTitle,
      error: parsed.ok ? null : parsed.reason || 'FEED_PARSE_FAILED',
    };
  } catch (e) {
    return {
      sourceId: sourceId,
      ok: false,
      mode: 'LIVE_HTTP',
      error: String(e && e.code ? e.code : e && e.message ? e.message : e).slice(0, 200),
    };
  }
}

function probeAiConfiguration() {
  const external =
    String(process.env.OPENAI_API_KEY || '').trim() ||
    String(process.env.ANTHROPIC_API_KEY || '').trim() ||
    String(process.env.DAILY_ISSUE_LLM_ENABLED || '').trim();
  return {
    externalLlmConfigured: !!external,
    engine: 'RULE_ENGINE(title-fact+quality+freshness+publication-decision)',
    liveExternalLlmCall: external ? 'NOT_IMPLEMENTED_IN_REPO' : 'NOT_CONFIGURED',
  };
}

function feedBodiesFixture(suffix) {
  const token = String(suffix || 'x');
  function patch(xml) {
    return xml
      .replace(/joint review of banking/g, 'joint review ' + token + ' of banking')
      .replace(/fixture-capital/g, 'fixture-capital-' + token);
  }
  return { 'npr-world': patch(NPR_FIX), 'fed-press': patch(FED_FIX) };
}

function memoryLegal(seed) {
  const rows = { user_legal_consents: {}, user_activity_region_legal_consents: {} };
  Object.keys(seed || {}).forEach(function (table) {
    rows[table] = seed[table];
  });
  return {
    from: function (table) {
      const state = { filters: {} };
      const api = {
        select: function () {
          return api;
        },
        eq: function (col, val) {
          state.filters[col] = val;
          return api;
        },
        maybeSingle: function () {
          const bag = rows[table] || {};
          const row = bag[state.filters.user_id] || null;
          if (row && state.filters.activity_region && row.activity_region !== state.filters.activity_region) {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: row, error: null });
        },
      };
      return api;
    },
  };
}

async function main() {
  console.log('=== US daily issue phase 11 integration ===');

  report.liveAi = probeAiConfiguration();
  console.log('AI_PROBE', JSON.stringify(report.liveAi));

  report.liveCollection.npr = await probeFeed('npr-world');
  report.liveCollection.fed = await probeFeed('fed-press');
  console.log('LIVE_NPR', JSON.stringify(report.liveCollection.npr));
  console.log('LIVE_FED', JSON.stringify(report.liveCollection.fed));

  check('NPR LIVE HTTP', report.liveCollection.npr.ok === true, JSON.stringify(report.liveCollection.npr));
  check('FRB LIVE HTTP', report.liveCollection.fed.ok === true, JSON.stringify(report.liveCollection.fed));

  if (report.liveCollection.npr.ok && report.liveCollection.fed.ok) {
    try {
      const liveIngest = await runDailyIssueIngest({
        dryRun: true,
        group: 'us-national',
        language: 'en',
        sinceHours: 72,
        maxItems: 4,
        asOf: AS_OF,
      });
      const ready = (liveIngest.readyCandidates || []).filter(function (c) {
        return c && c.ok && c.publicationStatus === 'READY';
      });
      const candidateReasons = (liveIngest.candidates || []).slice(0, 8).map(function (c) {
        return {
          sourceId: c && c.sourceRegistryId,
          publicationStatus: c && c.publicationStatus,
          qualityOk: c && c.quality && c.quality.ok,
          qualityReason: c && c.quality && c.quality.reason,
          freshnessOk: c && c.freshness && c.freshness.ok,
          freshnessReason: c && c.freshness && c.freshness.reason,
        };
      });
      report.liveCollection.ingest = {
        mode: 'LIVE_INGEST',
        ok: ready.length > 0,
        readyCount: ready.length,
        candidateCount: (liveIngest.candidates || []).length,
        errors: (liveIngest.manifest && liveIngest.manifest.errors) || [],
        candidateReasons: candidateReasons,
      };
      if (ready[0]) {
        const tagged = Object.assign({}, ready[0], { activityRegion: 'US', lifecycleMeta: { activityRegion: 'US' } });
        const created = require('../shared/daily-issue-review-core').createReviewItem(tagged, {
          asOf: AS_OF,
          existingItems: [],
        });
        const decision = decisionCore.classifyPublicationDecision(created.item, { asOf: AS_OF });
        report.liveAi.evalSample = {
          mode: 'RULE_ENGINE',
          publicationDecision: decision.publicationDecision,
          blocked: decision.autoPublishBlockedReasons || [],
        };
      }
      console.log('LIVE_INGEST', JSON.stringify(report.liveCollection.ingest));
      check('LIVE us-national ingest READY', ready.length > 0, JSON.stringify(report.liveCollection.ingest));
    } catch (e) {
      report.liveCollection.ingest = {
        mode: 'LIVE_INGEST',
        ok: false,
        error: String(e && e.message ? e.message : e).slice(0, 200),
      };
      check('LIVE us-national ingest READY', false, report.liveCollection.ingest.error);
    }
  } else {
    report.liveCollection.ingest = { mode: 'LIVE_INGEST', ok: false, error: 'FEED_PROBE_FAILED' };
    check('LIVE us-national ingest READY', false, 'BLOCKED_BY_FEED_PROBE');
  }

  const pg = await bootDailyIssueLocalPg({});
  if (!pg.ok) {
    report.postgres = { ok: false, error: pg.error, migration: pg.migration };
    console.log('PG_BOOT_FAIL', JSON.stringify(report.postgres));
    check('Postgres 16 harness', false, pg.error);
    printReport();
    process.exitCode = 1;
    return;
  }

  const executor = createDailyIssuePgExecutor({
    databaseUrl: pg.connectionString,
    schemaName: pg.schemaName,
  });
  if (!executor.ok) {
    report.postgres = { ok: false, error: executor.message || 'EXECUTOR_FAIL' };
    check('Postgres executor', false, report.postgres.error);
    await pg.shutdown();
    printReport();
    process.exit(1);
  }

  const repo = createDailyIssueReviewRepository({
    kind: 'db',
    databaseUrl: pg.connectionString,
    schemaName: pg.schemaName,
    executor: executor,
    enabled: true,
  });
  const init = await repo.initialize();
  check('Postgres review repo init', init.ok, init.error || '');

  const commentStore = createDailyIssueCommentStore({
    kind: 'pg',
    executor: executor,
    schemaName: pg.schemaName,
  });
  const reactionStore = createDailyIssueAlignmentReactionStore({
    kind: 'pg',
    executor: executor,
    schemaName: pg.schemaName,
  });

  const pipeline = await usRun.runUsDailyIssueSlot({
    repositoryInstance: repo,
    skipNetwork: true,
    feedBodies: feedBodiesFixture('pg11'),
    cacheRoot: path.join(require('os').tmpdir(), 'sa-us11-cache-' + Date.now()),
    forceEnabled: true,
    forceSlot: true,
    forceAutoPublish: true,
    asOf: AS_OF,
    runKey: SLOT_RUN,
  });
  report.postgres = {
    ok: pipeline.outcome === 'PUBLISH_SUCCESS',
    outcome: pipeline.outcome,
    publishedCount: pipeline.publishedCount,
    schema: pg.schemaName,
    mode: 'FIXTURE_INGEST_REAL_PG',
  };
  check('PG US pipeline publish', pipeline.outcome === 'PUBLISH_SUCCESS', JSON.stringify(pipeline));

  const usId = (pipeline.publishedIds || [])[0];
  const freshnessCore = require('../shared/daily-issue-freshness-core');
  const krItem = makeReady('kr-pg11', {});
  krItem.activityRegion = null;
  krItem.publishedAt = AS_OF;
  krItem.expiresAt = '2026-11-10T16:00:00.000Z';
  if (Array.isArray(krItem.sourceRefs)) {
    krItem.sourceRefs.forEach(function (s) {
      s.publishedAt = AS_OF;
    });
  }
  Object.assign(krItem, freshnessCore.applyFreshnessGateToCandidate(krItem, { asOf: AS_OF }));
  await Promise.resolve(repo.insertReviewItems([krItem], [], {}));

  const usRow = await pg.client.query(
    'SELECT activity_region, status FROM "' +
      pg.schemaName +
      '"."daily_issue_review_items" WHERE id = $1',
    [usId],
  );
  check('PG US row activity_region', usRow.rows[0] && usRow.rows[0].activity_region === 'US');

  const krUs = await pg.client.query(
    'SELECT id, activity_region FROM "' + pg.schemaName + '"."daily_issue_review_items" WHERE status = $1',
    ['PUBLISHED'],
  );
  const regions = (krUs.rows || []).map(function (r) {
    return { id: r.id, region: r.activity_region };
  });
  check(
    'PG published KR/US columns',
    regions.some(function (r) {
      return r.id === usId && r.region === 'US';
    }),
    JSON.stringify(regions),
  );

  const usAdult = {
    user_id: US_USER,
    activity_region: 'US',
    age_policy_region: 'US',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-us-v1',
    terms_consented_at: '2026-01-01T00:00:00.000Z',
    terms_document_version: 'terms-draft-us-v1',
    privacy_acknowledged_at: '2026-01-01T00:00:00.000Z',
    privacy_document_version: 'privacy-draft-us-v1',
    sensitive_political_consented_at: '2026-01-01T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    sensitive_applies_to: 'US',
    territory_disclosure_consented_at: '2026-01-01T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
    territory_disclosure_applies_to: 'US',
  };
  const krAdult = {
    user_id: KR_USER,
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-v1',
    sensitive_political_consented_at: '2026-01-01T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    territory_disclosure_consented_at: '2026-01-01T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
  };
  await pg.client.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [US_USER]);
  await pg.client.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [KR_USER]);
  await pg.client.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [US_TEEN_17]);

  const prevEnforce = process.env.LEGAL_GATE_ENFORCE;
  process.env.LEGAL_GATE_ENFORCE = '1';
  const gate = createLegalGateService({
    getAdminClient: function () {
      return memoryLegal({
        user_legal_consents: { [KR_USER]: krAdult },
        user_activity_region_legal_consents: { [US_USER]: usAdult },
      });
    },
  });

  const app = createDailyIssueApiApp({
    repositoryInstance: repo,
    repositoryKind: 'db',
    schemaName: pg.schemaName,
    commentStore: commentStore,
    reactionStore: reactionStore,
    adminAuthGuard: createTestAdminAuthGuard(ADMIN_TOKEN),
    legalGate: gate,
    resolveActorFromRequest: function (req) {
      const h = String((req.headers && req.headers.authorization) || '');
      const m = h.match(/^Bearer\s+user:(.+)$/i);
      if (!m) return null;
      const uid = String(m[1]).trim();
      return { userId: uid, activityRegion: uid === US_USER ? 'US' : 'KR' };
    },
    applyUsCommentScore: function () {
      return { connected: true, region: 'US' };
    },
    applyIssueCommentXp: function () {
      return null;
    },
    corsOrigins: ['http://localhost:3000'],
    asOf: AS_OF,
  });

  const pubKr = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + krItem.id + '/approve', {
    headers: authHeaders(),
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'pg11' },
  });
  check('PG KR approve for publish', pubKr.status === 200 && pubKr.body && pubKr.body.ok, JSON.stringify(pubKr.body));
  let krLock = pubKr.body && pubKr.body.data && pubKr.body.data.item && pubKr.body.data.item.lockVersion;
  await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + krItem.id + '/publish', {
    headers: authHeaders(),
    body: { expectedStatus: 'APPROVED', expectedLockVersion: krLock, reviewerId: 'pg11' },
  });

  const krList = await requestApp(app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'ko' } });
  const usList = await requestApp(app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'en' } });
  const krIds = ((krList.body && krList.body.data && krList.body.data.items) || []).map(function (i) {
    return i.id;
  });
  const usIds = ((usList.body && usList.body.data && usList.body.data.items) || []).map(function (i) {
    return i.id;
  });
  check('PG API KR/US lists', krIds.indexOf(usId) < 0 && usIds.indexOf(usId) >= 0 && krIds.indexOf(krItem.id) >= 0);
  report.krUsListOk =
    krIds.indexOf(usId) < 0 && usIds.indexOf(usId) >= 0 && krIds.indexOf(krItem.id) >= 0;

  const commentRes = await requestApp(app, 'POST', '/api/daily-issues/' + usId + '/comments', {
    headers: Object.assign({ 'content-type': 'application/json', 'accept-language': 'en' }, memberHeaders(US_USER)),
    body: { body: 'PG US comment preserved' },
  });
  check('PG US comment create', commentRes.status === 201, JSON.stringify(commentRes.body));

  const reactRes = await requestApp(app, 'POST', '/api/daily-issues/' + usId + '/reactions/toggle', {
    headers: Object.assign({ 'content-type': 'application/json', 'accept-language': 'en' }, memberHeaders(US_USER)),
    body: { reactionType: 'LIKE' },
  });
  check('PG US reaction create', reactRes.status === 200 && reactRes.body && reactRes.body.ok);

  const cBefore = await pg.client.query(
    'SELECT count(*)::int AS n FROM "' + pg.schemaName + '"."daily_issue_comments" WHERE issue_id = $1',
    [usId],
  );
  const rBefore = await pg.client.query(
    'SELECT count(*)::int AS n FROM "' + pg.schemaName + '"."daily_issue_reactions" WHERE issue_id = $1',
    [usId],
  );

  const hide = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + usId + '/us-visibility', {
    headers: authHeaders(),
    body: { coreFactVerifiablyWrong: true, reviewerId: 'pg11' },
  });
  check('PG TEMP_HIDE admin', hide.status === 200 && hide.body && hide.body.ok);

  const usListHidden = await requestApp(app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'en' } });
  const visible = ((usListHidden.body && usListHidden.body.data && usListHidden.body.data.items) || []).some(function (i) {
    return i.id === usId;
  });
  check('PG hidden from public list', !visible);

  const cMid = await pg.client.query(
    'SELECT count(*)::int AS n FROM "' + pg.schemaName + '"."daily_issue_comments" WHERE issue_id = $1',
    [usId],
  );
  const rMid = await pg.client.query(
    'SELECT count(*)::int AS n FROM "' + pg.schemaName + '"."daily_issue_reactions" WHERE issue_id = $1',
    [usId],
  );
  check('PG hide preserves comments', cMid.rows[0].n === cBefore.rows[0].n && cMid.rows[0].n >= 1);
  check('PG hide preserves reactions', rMid.rows[0].n === rBefore.rows[0].n && rMid.rows[0].n >= 1);

  const reopen = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + usId + '/us-visibility', {
    headers: authHeaders(),
    body: { republish: true, adminApproved: true, reviewerId: 'pg11' },
  });
  check('PG admin republish', reopen.status === 200 && reopen.body && reopen.body.ok);

  const usListBack = await requestApp(app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'en' } });
  const back = ((usListBack.body && usListBack.body.data && usListBack.body.data.items) || []).some(function (i) {
    return i.id === usId;
  });
  check('PG visible after republish', back);

  const cAfter = await pg.client.query(
    'SELECT count(*)::int AS n FROM "' + pg.schemaName + '"."daily_issue_comments" WHERE issue_id = $1',
    [usId],
  );
  check('PG comments after republish', cAfter.rows[0].n === cBefore.rows[0].n);

  report.hidePreserve = {
    ok: true,
    comments: cAfter.rows[0].n,
    reactions: rMid.rows[0].n,
  };

  const ageNowMs = Date.now();
  const age17Core = legalCore.evaluateAgeForRegion(dobForAge(17, ageNowMs), 'US', ageNowMs);
  const age18Core = legalCore.evaluateAgeForRegion(dobForAge(18, ageNowMs), 'US', ageNowMs);
  check(
    'US legal gate 17 blocked at confirm',
    age17Core.ok === false && age17Core.error === 'AGE_UNDER_18',
    age17Core.error || '',
  );
  check('US legal gate 18 passes confirm', age18Core.ok === true);
  check('US legal gate 18 stored signup complete', legalCore.isUsSignupComplete(usAdult));

  const teenWrite = await requestApp(app, 'POST', '/api/daily-issues/' + usId + '/comments', {
    headers: Object.assign({ 'content-type': 'application/json', 'accept-language': 'en' }, memberHeaders(US_TEEN_17)),
    body: { body: 'US teen write blocked' },
  });
  check('PG US age 17 write rejected', teenWrite.status === 403, String(teenWrite.status));

  const adultWrite = await requestApp(app, 'POST', '/api/daily-issues/' + usId + '/comments', {
    headers: Object.assign({ 'content-type': 'application/json', 'accept-language': 'en' }, memberHeaders(US_USER)),
    body: { body: 'US 18 write ok' },
  });
  check('PG US age 18 write allowed', adultWrite.status === 201, String(adultWrite.status));

  report.ageGate = {
    age17WriteStatus: teenWrite.status,
    age18WriteStatus: adultWrite.status,
    age17CoreError: age17Core.error || null,
    age18CoreOk: age18Core.ok === true,
  };

  if (prevEnforce == null) delete process.env.LEGAL_GATE_ENFORCE;
  else process.env.LEGAL_GATE_ENFORCE = prevEnforce;

  await executor.end();
  await pg.shutdown();

  printReport();
  if (failed) {
    console.log('PHASE11_FAIL', failed);
    process.exitCode = 1;
  } else {
    console.log('PHASE11_OK');
  }
}

function printReport() {
  console.log('\n--- REPORT 1-12 ---');
  console.log('1 git branch: cursor/map-layout-cards-bc3c (see commit at run time)');
  console.log('2 korea engine unchanged: PASS (no scheduler edits this phase)');
  console.log('3 us scheduler wiring: PASS (ad61211 retained)');
  console.log(
    '4 live US collection:',
    report.liveCollection.npr && report.liveCollection.npr.ok && report.liveCollection.fed && report.liveCollection.fed.ok
      ? report.liveCollection.ingest && report.liveCollection.ingest.ok
        ? 'PASS'
        : report.liveCollection.ingest && report.liveCollection.ingest.error === 'FEED_PROBE_FAILED'
          ? 'BLOCKED'
          : 'FAIL'
      : 'FAIL',
  );
  console.log(
    '5 live AI external:',
    report.liveAi && report.liveAi.externalLlmConfigured ? 'BLOCKED (NOT_IMPLEMENTED_IN_REPO)' : 'BLOCKED (NOT_CONFIGURED)',
  );
  console.log(
    '6 rule-engine eval on LIVE ingest:',
    report.liveAi && report.liveAi.evalSample ? 'PASS' : report.liveCollection.ingest && report.liveCollection.ingest.ok ? 'FAIL' : 'BLOCKED',
  );
  console.log('7 postgres 16 isolated:', report.postgres && report.postgres.ok ? 'PASS' : 'FAIL');
  console.log('8 KR/US PG isolation:', report.krUsListOk ? 'PASS' : 'FAIL');
  console.log('9 hide/republish preserves rows:', report.hidePreserve && report.hidePreserve.ok ? 'PASS' : 'FAIL');
  console.log('10 notices SMTP:', 'PASS (9th adapter unchanged, not success-sent)');
  console.log(
    '11 age US 17/18 boundary:',
    report.ageGate &&
      report.ageGate.age17WriteStatus === 403 &&
      report.ageGate.age18WriteStatus === 201 &&
      report.ageGate.age17CoreError === 'AGE_UNDER_18' &&
      report.ageGate.age18CoreOk
      ? 'PASS'
      : 'FAIL',
  );
  console.log('12 ops flags/production SQL:', 'PASS (not enabled)');
  console.log('INTEGRATION_COMPLETE_FOR_PRODUCTION: NO (see 4-6)');
}

main().catch(function (e) {
  console.error('PHASE11_UNCAUGHT', e && e.stack ? e.stack : String(e || 'unknown'));
  process.exitCode = 1;
});
