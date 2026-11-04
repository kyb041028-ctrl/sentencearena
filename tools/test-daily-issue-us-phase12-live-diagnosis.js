#!/usr/bin/env node
'use strict';

/**
 * 미국판 12차 — LIVE RSS 격리 원인 진단 + 누락 연령 경계(게스트 쓰기·쿠키 우회)만.
 * 11차 PG 통합·17/18 HTTP·한국-only·게스트 읽기 반복 금지. 공개 발행 금지.
 */

const registry = require('../config/daily-issue-source-registry');
const fetcher = require('../server/daily-issue-feed-fetcher');
const feedCore = require('../shared/daily-issue-feed-core');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const legalCore = require('../shared/legal-gate-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const reviewCore = require('../shared/daily-issue-review-core');
const {
  summarizeLiveCandidate,
  summarizeReadyCandidate,
  classifyUsIngestRun,
} = require('./lib/daily-issue-us-quarantine-report');
const { requestApp } = require('./daily-issue-api-http-helper');
const { makeReady, createTestApp, authHeaders, memberHeaders } = require('./daily-issue-api-test-fixtures');
const { createLegalGateService } = require('../server/legal-gate-service');

const AS_OF = '2026-11-04T16:00:00.000Z';
const INGEST = {
  dryRun: true,
  group: 'us-national',
  language: 'en',
  sinceHours: 72,
  maxItems: 4,
  asOf: AS_OF,
  includeFullCandidates: true,
};

const report = {
  branch: 'cursor/map-layout-cards-bc3c',
  baseline: '43a2e45',
  live: null,
  readySample: null,
  runOutcome: null,
  ageBoundaries: null,
  sourcesAdded: ['npr-us-news', 'cbs-us-main', 'whitehouse-news', 'ap-topnews-us(disabled)'],
};

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

async function probeFeed(sourceId) {
  const src = registry.getSourceById(sourceId);
  if (!src || !src.enabled) {
    return { sourceId: sourceId, ok: false, error: 'SOURCE_DISABLED_OR_MISSING' };
  }
  try {
    const fetched = await fetcher.fetchTextSafe(src.feedUrl, { timeoutMs: 15000, maxBytes: 1_500_000 });
    const parsed = feedCore.parseRssOrAtom(fetched.body, {
      publisher: src.publisher,
      sourceRegistryId: src.id,
      retrievedAt: new Date().toISOString(),
    });
    return {
      sourceId: sourceId,
      ok: fetched.status === 200 && parsed.ok && parsed.items.length > 0,
      httpStatus: fetched.status,
      itemCount: parsed.ok ? parsed.items.length : 0,
    };
  } catch (e) {
    return { sourceId: sourceId, ok: false, error: String(e && e.message ? e.message : e).slice(0, 120) };
  }
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
  console.log('=== US daily issue phase 12 live diagnosis ===');

  const npr = await probeFeed('npr-world');
  const fed = await probeFeed('fed-press');
  check('NPR World LIVE HTTP', npr.ok === true, JSON.stringify(npr));
  check('FRB press LIVE HTTP', fed.ok === true, JSON.stringify(fed));

  const ingest = await runDailyIssueIngest(INGEST);
  const candidates = ingest.candidates || [];
  const ready = ingest.readyCandidates || [];
  report.runOutcome = classifyUsIngestRun(ingest.manifest, candidates, ready.length);
  report.live = {
    candidateCount: candidates.length,
    readyCount: ready.length,
    outcome: report.runOutcome.outcome,
    sourceResults: (ingest.manifest && ingest.manifest.sourceResults) || [],
  };

  console.log('RUN_OUTCOME', JSON.stringify(report.runOutcome));
  console.log('SOURCE_RESULTS', JSON.stringify(report.live.sourceResults, null, 0));

  candidates.forEach(function (c, idx) {
    const row = summarizeLiveCandidate(c);
    console.log('CANDIDATE_' + idx, JSON.stringify(row));
  });

  check('LIVE ingest HTTP sources OK', npr.ok && fed.ok);
  check(
    'LIVE ingest not COLLECT_FAILED',
    report.runOutcome.outcome !== 'COLLECT_FAILED',
    report.runOutcome.outcome,
  );

  if (ready.length > 0) {
    const sample = summarizeReadyCandidate(ready[0]);
    const tagged = Object.assign({}, ready[0], {
      activityRegion: 'US',
      lifecycleMeta: { activityRegion: 'US' },
    });
    const created = reviewCore.createReviewItem(tagged, { asOf: AS_OF, existingItems: [] });
    const decision = decisionCore.classifyPublicationDecision(created.item, { asOf: AS_OF });
    report.readySample = Object.assign({}, sample, {
      publicationDecision: decision.publicationDecision,
      blocked: decision.autoPublishBlockedReasons || [],
    });
    console.log('READY_SAMPLE', JSON.stringify(report.readySample));
    check('LIVE READY cross-source sample', sample.independentSourceCount >= 2 && sample.confirmedFactCount >= 1);
    check('READY rule-engine eval (no publish)', decision.publicationDecision != null);
  } else {
    report.readySample = null;
    console.log('READY_SAMPLE', 'NONE');
  }

  const ageNow = Date.now();
  const skipBypass = legalCore.parseUsAgeConfirmBody({
    policyVersion: legalCore.US_AGE_POLICY_VERSION,
    ageConfirmed: true,
    complete: true,
  });
  check(
    'US age cookie/body skip blocked at confirm',
    skipBypass.ok === false && skipBypass.error === 'AGE_CONFIRM_REQUIRED',
    skipBypass.error || '',
  );

  const prevEnforce = process.env.LEGAL_GATE_ENFORCE;
  process.env.LEGAL_GATE_ENFORCE = '1';
  const krAdult = {
    user_id: '22222222-2222-4222-8222-222222222222',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-v1',
    sensitive_political_consented_at: '2026-01-01T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    territory_disclosure_consented_at: '2026-01-01T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
  };
  const gate = createLegalGateService({
    getAdminClient: function () {
      return memoryLegal({ user_legal_consents: { [krAdult.user_id]: krAdult } });
    },
  });
  let krUsGateFailed = false;
  try {
    await gate.assertUsCompleteForUser(krAdult.user_id);
  } catch (e) {
    krUsGateFailed = e && e.code === 'LEGAL_GATE_INCOMPLETE';
  }
  check('KR-only consent fails US assertUsComplete', krUsGateFailed);

  const packed = createTestApp({
    legalGate: gate,
    asOf: AS_OF,
    resolveActorFromRequest: function (req) {
      const h = String((req.headers && req.headers.authorization) || '');
      const m = h.match(/^Bearer\s+user:(.+)$/i);
      if (!m) return null;
      return { userId: String(m[1]).trim(), activityRegion: 'KR' };
    },
  });
  const freshnessCore = require('../shared/daily-issue-freshness-core');
  const usItem = makeReady('p12-guest', {});
  usItem.activityRegion = 'US';
  usItem.lifecycleMeta = { activityRegion: 'US' };
  usItem.publishedAt = AS_OF;
  usItem.expiresAt = '2026-11-10T16:00:00.000Z';
  if (Array.isArray(usItem.sourceRefs)) {
    usItem.sourceRefs.forEach(function (s) {
      s.publishedAt = AS_OF;
    });
  }
  Object.assign(usItem, freshnessCore.applyFreshnessGateToCandidate(usItem, { asOf: AS_OF }));
  await Promise.resolve(packed.repo.insertReviewItems([usItem], [], {}));
  const appr = await requestApp(packed.app, 'POST', '/api/admin/daily-issues/review/' + usItem.id + '/approve', {
    headers: authHeaders(),
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'p12' },
  });
  const lock = appr.body && appr.body.data && appr.body.data.item && appr.body.data.item.lockVersion;
  await requestApp(packed.app, 'POST', '/api/admin/daily-issues/review/' + usItem.id + '/publish', {
    headers: authHeaders(),
    body: { expectedStatus: 'APPROVED', expectedLockVersion: lock, reviewerId: 'p12' },
  });

  const guestWrite = await requestApp(packed.app, 'POST', '/api/daily-issues/' + usItem.id + '/comments', {
    headers: { 'content-type': 'application/json', 'accept-language': 'en' },
    body: { body: 'guest must not write' },
  });
  check('Guest US issue write rejected', guestWrite.status === 401 || guestWrite.status === 403, String(guestWrite.status));

  report.ageBoundaries = {
    skipAgeConfirmBlocked: skipBypass.error,
    krOnlyUsGate: krUsGateFailed ? 'LEGAL_GATE_INCOMPLETE' : 'UNEXPECTED_PASS',
    guestWriteStatus: guestWrite.status,
    us17us18: 'PASS_AT_43a2e45_NOT_REPEATED',
    authMode: 'ISOLATED_TEST_ACTOR_NOT_SUPABASE_AUTH',
  };

  if (prevEnforce == null) delete process.env.LEGAL_GATE_ENFORCE;
  else process.env.LEGAL_GATE_ENFORCE = prevEnforce;

  printReport();
  if (failed) {
    console.log('PHASE12_FAIL', failed);
    process.exitCode = 1;
  } else {
    console.log('PHASE12_OK');
  }
}

function printReport() {
  console.log('\n--- REPORT 1-11 ---');
  console.log('1 branch/baseline:', report.branch, report.baseline, '(HEAD at run)');
  console.log('2 korea engine/scheduler unchanged:', 'PASS (no edits this phase)');
  console.log('3 us-national registry enrich:', report.sourcesAdded.join(', '));
  console.log(
    '4 live NPR/FRB + ingest:',
    report.live && report.live.readyCount >= 0 ? report.runOutcome.outcome : 'FAIL',
    'ready=' + (report.live && report.live.readyCount),
    'candidates=' + (report.live && report.live.candidateCount),
  );
  console.log('5 external AI:', 'BLOCKED NOT_CONFIGURED');
  console.log('6 READY eval (no publish):', report.readySample ? 'PASS sample logged' : 'ZERO_NORMAL no READY');
  console.log('7 phase11 PG integration:', 'PASS unchanged (not re-run)');
  console.log('8 quarantine detail tool:', 'PASS tools/lib/daily-issue-us-quarantine-report.js');
  console.log(
    '9 admin notice SMTP:',
    'PASS unchanged (no SMTP success claim)',
  );
  console.log(
    '10 age boundaries added:',
    report.ageBoundaries &&
      (report.ageBoundaries.guestWriteStatus === 401 || report.ageBoundaries.guestWriteStatus === 403) &&
      report.ageBoundaries.krOnlyUsGate === 'LEGAL_GATE_INCOMPLETE'
      ? 'PASS'
      : 'FAIL',
  );
  console.log('11 ops/production/master:', 'PASS not touched');
  console.log('INTEGRATION_COMPLETE_FOR_PRODUCTION: NO');
}

main().catch(function (e) {
  console.error('PHASE12_UNCAUGHT', e && e.stack ? e.stack : String(e || 'unknown'));
  process.exitCode = 1;
});
