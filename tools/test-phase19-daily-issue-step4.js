#!/usr/bin/env node
'use strict';

/**
 * Phase 19 4단계 — halt TX lock, bypass guard, halt HTTP auth, US SQL restart, public HTTP hide.
 */

const http = require('http');
const pubGuard = require('../shared/daily-issue-publish-internal-guard');
const reviewService = require('../server/daily-issue-review-service');
const haltSvc = require('../server/daily-issue-emergency-halt-service');
const usRun = require('../server/daily-issue-us-run-service');
const usOps = require('../shared/daily-issue-us-ops-core');
const { createSqlEmergencyHaltStore } = require('../server/daily-issue-emergency-halt-store');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createPgDailyIssueCommentStore } = require('../server/daily-issue-comment-store');
const { createDailyIssueApiApp } = require('../server/daily-issue-routes');
const { createTestAdminAuthGuard } = require('./daily-issue-api-test-fixtures');
const { requestApp } = require('./daily-issue-api-http-helper');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const BASE_HEAD = '4958893a7f427e4f33a3585321e92c9b2b0ce994';
const AS_OF = '2026-09-01T00:00:00.000Z';
const PREFIX = 'p19s4_' + Date.now().toString(36);
const US_COOKIE = 'sa_ar=US; sa_ar_x=1';

const TOKENS = {
  admin: 'p19s4-admin-token',
  owner: 'p19s4-owner-token',
  member: 'p19s4-member-token',
  bad: 'p19s4-bad-token',
};

let failed = 0;

function report(key, verdict, detail) {
  console.log('PHASE19_STEP4 ' + key + ' ' + verdict + (detail ? ' ' + detail : ''));
  if (verdict === 'FAIL') failed += 1;
}

function fresh(url) {
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  return { ex: ex, repo: createSqlDailyIssueReviewRepository({ executor: ex, schemaName: SCHEMA, enabled: true }) };
}

function dbOpt(url, repo, ex) {
  return {
    repositoryInstance: repo,
    databaseUrl: url,
    schemaName: SCHEMA,
    executor: ex,
    __trustedInternalPublishOptions: true,
  };
}

function makeKrItem(suffix) {
  const s1 = {
    id: PREFIX + '_s1_' + suffix,
    publisher: '통계청',
    title: 't',
    url: 'https://kostat.go.kr/s4/' + suffix,
    publishedAt: '2026-08-31T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: PREFIX + '_s2_' + suffix,
    publisher: '연합',
    title: 't2',
    url: 'https://www.yna.co.kr/s4/' + suffix,
    publishedAt: '2026-08-31T02:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.yna.co.kr',
  };
  const text = '통계청이 고용 통계를 공식 발표했다. ' + suffix;
  const built = quality.buildDailyIssueCandidate({
    title: '고용 통계 ' + suffix,
    discussionPrompt: '평가?',
    sources: [s1, s2],
    evidences: [
      { id: PREFIX + '_e1_' + suffix, sourceId: s1.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
      { id: PREFIX + '_e2_' + suffix, sourceId: s2.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    ],
    candidateClaims: [
      {
        id: PREFIX + '_c1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [PREFIX + '_e1_' + suffix, PREFIX + '_e2_' + suffix],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: '2026-09-01T00:00:00.000Z',
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: '2026-09-01T00:00:00.000Z' });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: PREFIX + '_id_' + suffix,
      candidateId: PREFIX + '_cand_' + suffix,
      clusterId: PREFIX + '_cl_' + suffix,
      contentSignature: 'sig_kr_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'KR',
    }),
    { asOf: '2026-09-01T00:00:00.000Z', existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeKrItem');
  return decisionCore.attachDecisionToItem(created.item, { asOf: '2026-09-01T00:00:00.000Z' }).item;
}

function makeUsItem(suffix, category) {
  const id = PREFIX + 'us_' + suffix;
  const summary = 'US federal report ' + suffix;
  const s1 = {
    id: id + '_s1',
    publisher: 'CBS',
    title: 't',
    url: 'https://www.cbsnews.com/s4/' + id,
    publishedAt: '2026-08-31T12:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.cbsnews.com',
    independentNetworkKey: 'cbsnews-com',
    usMediaClass: 'COMMERCIAL',
  };
  const s2 = {
    id: id + '_s2',
    publisher: 'KQED',
    title: 't2',
    url: 'https://www.kqed.org/s4/' + id,
    publishedAt: '2026-08-31T13:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.kqed.org',
    independentNetworkKey: 'kqed-org',
    usMediaClass: 'PUBLIC_BROADCAST',
  };
  const built = quality.buildDailyIssueCandidate({
    title: summary,
    discussionPrompt: 'Q',
    sources: [s1, s2],
    evidences: [
      { id: id + '_e1', sourceId: s1.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
      { id: id + '_e2', sourceId: s2.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    ],
    candidateClaims: [
      {
        id: id + '_c1',
        text: summary,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [id + '_e1', id + '_e2'],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: '2026-09-01T00:00:00.000Z',
  });
  const cat = category || 'us-national';
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: '2026-09-01T00:00:00.000Z', category: cat });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: id,
      candidateId: id + '_cand',
      clusterId: 'cl_' + suffix,
      contentSignature: 'sig_us_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'US',
      category: cat,
    }),
    { asOf: '2026-09-01T00:00:00.000Z', existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeUsItem');
  return decisionCore.attachDecisionToItem(
    Object.assign({}, created.item, { lifecycleMeta: { activityRegion: 'US' } }),
    { asOf: '2026-09-01T00:00:00.000Z' },
  ).item;
}

async function enqueue(repo, item) {
  return repo.insertReviewItems([item], [
    {
      entityId: item.id,
      fromStatus: null,
      toStatus: 'READY_FOR_REVIEW',
      action: 'enqueue',
      actorId: 'p19s4',
      timestamp: AS_OF,
    },
  ]);
}

async function approveKr(repo, url, ex, suffix) {
  const item = makeKrItem(suffix);
  const ins = await enqueue(repo, item);
  if (!ins.ok) return { ok: false, error: ins.error || 'ENQUEUE_FAILED', id: null };
  const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
  const appr = await reviewService.transitionItem(id, 'APPROVED', Object.assign({}, dbOpt(url, repo, ex), {
    operatorApproval: true,
    reviewer: 'admin',
    asOf: '2026-09-01T00:00:00.000Z',
  }));
  if (!appr.ok) return { ok: false, error: appr.error, id: id };
  return { ok: true, id: id, appr: appr, lockVersion: appr.item.lockVersion };
}

async function setHalt(store, region, halted, reason) {
  return haltSvc.setEmergencyHalt({
    haltStore: store,
    region: region,
    halted: halted,
    reason: reason || 'step4',
    actorId: ADMIN,
  });
}

async function main() {
  report('baseline_head', 'INFO', BASE_HEAD);

  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  const gate = assertDailyIssueIsolatedTarget(url, SCHEMA);
  if (!gate.ok || !isAllowedTestSchema(SCHEMA)) {
    report('isolated_env', 'BLOCKED', gate.reason || 'missing-url');
    console.log('PHASE19_STEP4_VERDICT BLOCKED');
    process.exit(2);
  }

  const boot = fresh(url);
  if (!boot.ex.ok) {
    report('isolated_env', 'BLOCKED', 'executor');
    console.log('PHASE19_STEP4_VERDICT BLOCKED');
    process.exit(2);
  }
  await boot.repo.initialize();
  const haltStore = createSqlEmergencyHaltStore({ executor: boot.ex, schemaName: SCHEMA });
  await haltStore.initialize();
  await setHalt(haltStore, 'KR', false, 'reset');
  await setHalt(haltStore, 'US', false, 'reset');

  // --- 1 halt race / TX lock ---
  try {
    await setHalt(haltStore, 'KR', false, 'race');
    const prep = await approveKr(boot.repo, url, boot.ex, 'race');
    if (!prep.ok) throw new Error(prep.error || 'approve-race');
    await setHalt(haltStore, 'KR', true, 'race-on');
    const pub = await reviewService.transitionItem(prep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
      operatorApproval: true,
      reviewer: 'admin',
      expectedStatus: 'APPROVED',
      expectedLockVersion: prep.lockVersion,
      asOf: '2026-09-01T12:00:00.000Z',
    }));
    const row = await boot.repo.getById(prep.id);
    const ok =
      pub.ok === false &&
      pub.error === 'EMERGENCY_HALT_ACTIVE' &&
      row.ok &&
      row.item &&
      row.item.status === 'APPROVED';
    report('halt_tx_lock', ok ? 'PASS' : 'FAIL', 'pub=' + (pub.error || 'ok') + ' status=' + row.item.status);
    await setHalt(haltStore, 'KR', false, 'race-off');
    const races = [];
    for (let i = 0; i < 8; i += 1) {
      const p = await approveKr(boot.repo, url, boot.ex, 'rc' + i);
      if (!p.ok) throw new Error(p.error || 'rc');
      races.push(
        Promise.all([
          setHalt(haltStore, 'KR', i % 2 === 0, 'toggle-' + i),
          reviewService.transitionItem(p.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
            operatorApproval: true,
            reviewer: 'admin',
            expectedStatus: 'APPROVED',
            expectedLockVersion: p.lockVersion,
            asOf: '2026-09-01T12:00:00.000Z',
          })),
        ]).then(async function () {
          const st = await boot.repo.getById(p.id);
          const halt = await haltStore.getRegion('KR');
          if (halt.halted && st.ok && st.item.status === 'PUBLISHED') return false;
          return true;
        }),
      );
    }
    const raceOk = (await Promise.all(races)).every(Boolean);
    report('halt_race_invariant', raceOk ? 'PASS' : 'FAIL', 'no publish while halted at commit');
  } catch (e) {
    report('halt_tx_lock', 'FAIL', String(e.message || e));
  }

  // --- 2 bypass options negative ---
  try {
    const g1 = pubGuard.validateTransitionOptions({ skipHaltCheck: true });
    const g2 = pubGuard.validateTransitionOptions({ forceAutoPublish: true });
    const g3 = pubGuard.findForbiddenHttpBodyKey({ forceAutoPublish: true });
    const trusted = pubGuard.validateTransitionOptions({
      forceAutoPublish: true,
      __trustedInternalPublishOptions: true,
    });
    report(
      'bypass_guard_negative',
      g1.ok === false && g2.ok === false && g3 === 'forceAutoPublish' && trusted.ok === true ? 'PASS' : 'FAIL',
      'skip=' + g1.error + ' force=' + g2.error,
    );
    const app = createDailyIssueApiApp({
      repositoryInstance: boot.repo,
      executor: boot.ex,
      schemaName: SCHEMA,
      repositoryKind: 'db',
      databaseUrl: url,
      adminAuthGuard: createTestAdminAuthGuard({
        [TOKENS.admin]: 'ADMIN',
        [TOKENS.owner]: 'OWNER',
        [TOKENS.member]: 'MEMBER',
      }),
      allowMorningManual: true,
      legalGate: { assertCompleteForUser: async function () {}, assertUsCompleteForUser: async function () {} },
    });
    const httpBad = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + PREFIX + '_dummy/publish', {
      headers: { Authorization: 'Bearer ' + TOKENS.admin, 'Content-Type': 'application/json' },
      body: { skipHaltCheck: true, expectedStatus: 'APPROVED', expectedLockVersion: 1 },
    });
    const errCode = httpBad.body && httpBad.body.error && httpBad.body.error.code;
    report(
      'bypass_http_reject',
      (httpBad.status === 400 || httpBad.status === 422) && errCode === 'UNAUTHORIZED_PUBLISH_OPTION' ? 'PASS' : 'FAIL',
      'status=' + httpBad.status + ' code=' + errCode,
    );
  } catch (e) {
    report('bypass_guard_negative', 'FAIL', String(e.message || e));
  }

  // --- 3 halt admin HTTP auth (mock) ---
  try {
    const roleMap = {
      [TOKENS.admin]: 'ADMIN',
      [TOKENS.owner]: 'OWNER',
      [TOKENS.member]: 'MEMBER',
    };
    const app = createDailyIssueApiApp({
      repositoryInstance: boot.repo,
      executor: boot.ex,
      schemaName: SCHEMA,
      repositoryKind: 'db',
      databaseUrl: url,
      adminAuthGuard: createTestAdminAuthGuard(roleMap),
    });
    const cases = [
      ['halt_auth_none', null, 401],
      ['halt_auth_bad', TOKENS.bad, 401],
      ['halt_auth_member', TOKENS.member, 403],
      ['halt_auth_admin', TOKENS.admin, 200],
      ['halt_auth_owner', TOKENS.owner, 200],
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i];
      const headers = { 'Content-Type': 'application/json' };
      if (c[1]) headers.Authorization = 'Bearer ' + c[1];
      const res = await requestApp(app, 'GET', '/api/admin/daily-issues/emergency-halt/KR', { headers: headers });
      report(c[0], res.status === c[2] ? 'MOCK PASS' : 'FAIL', 'status=' + res.status);
      if (res.status !== c[2]) failed += 0;
    }
    const realConfigured =
      String(process.env.DAILY_ISSUE_REAL_AUTH_INTEGRATION || '').trim() === '1' &&
      String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim() &&
      String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    report('halt_auth_real_supabase', realConfigured ? 'NOT_RUN' : 'REAL AUTH BLOCKED', 'mock only in this run');
  } catch (e) {
    report('halt_auth_admin', 'FAIL', String(e.message || e));
  }

  // --- 4 US SQL store restart ---
  try {
    const runKey = PREFIX + ':us-restart';
    const storeA = usRun.resolveUsSchedulerStore({ executor: boot.ex, schemaName: SCHEMA, leaseMs: 5000 });
    await storeA.tryClaimRun({ runKey: runKey, startedAt: new Date().toISOString() });
    await storeA.finishRun(runKey, { status: 'SUCCESS', publishedCount: 0, outcome: 'ZERO_NORMAL' });
    const exB = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
    const storeB = usRun.resolveUsSchedulerStore({ executor: exB, schemaName: SCHEMA });
    const row = await storeB.getByRunKey(runKey);
    report(
      'us_sql_restart_path',
      row && row.status === 'SUCCESS' && storeB.kind === 'sql-us' ? 'PASS' : 'FAIL',
      'kind=' + storeB.kind + ' status=' + (row && row.status),
    );
    await exB.end();
  } catch (e) {
    report('us_sql_restart_path', 'FAIL', String(e.message || e));
  }

  // --- 4b US concurrent daily max ---
  try {
    const slotAsOf = '2026-06-15T15:00:00.000Z';
    const pubAt = '2026-06-15T15:30:00.000Z';
    const cats = ['us-national', 'us-politics', 'us-world'];
    for (let i = 0; i < 3; i += 1) {
      const item = makeUsItem('dm' + i, cats[i]);
      const ins = await enqueue(boot.repo, item);
      const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
      const appr = await reviewService.transitionItem(id, 'APPROVED', Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
        operatorApproval: true,
        reviewer: 'admin',
        asOf: '2026-09-01T00:00:00.000Z',
      }));
      if (!appr.ok) throw new Error(appr.error || 'appr-' + i);
      const pub = await reviewService.transitionItem(id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
        operatorApproval: true,
        reviewer: 'admin',
        expectedStatus: 'APPROVED',
        expectedLockVersion: appr.item.lockVersion,
        asOf: pubAt,
      }));
      if (!pub.ok) throw new Error(pub.error || 'pub-' + i);
    }
    const slot = usOps.slotFor(slotAsOf);
    const parallel = await Promise.all([
      usRun.runUsDailyIssueSlot(
        Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
          asOf: slotAsOf,
          forceSlot: true,
          env: { DAILY_ISSUE_US_SCHEDULER_ENABLED: '1', DAILY_ISSUE_US_AUTO_PUBLISH: '1' },
          skipNetwork: true,
          ingestRunner: async function () {
            return { ok: true, readyCandidates: [], candidates: [] };
          },
        }),
      ),
      usRun.runUsDailyIssueSlot(
        Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
          asOf: slotAsOf,
          forceSlot: true,
          env: { DAILY_ISSUE_US_SCHEDULER_ENABLED: '1', DAILY_ISSUE_US_AUTO_PUBLISH: '1' },
          skipNetwork: true,
          ingestRunner: async function () {
            return { ok: true, readyCandidates: [], candidates: [] };
          },
        }),
      ),
    ]);
    const dc = await usRun.countPublishedUsOnDate(boot.repo, slot.dateKey, slotAsOf);
    const maxOk =
      dc.count === 3 &&
      parallel.every(function (r) {
        return r.reason === 'DAILY_MAX_REACHED' || r.note === 'DAILY_MAX_REACHED' || r.outcome === 'DUPLICATE_BLOCKED';
      });
    report('us_concurrent_daily_max', maxOk ? 'PASS' : 'FAIL', 'pgCount=' + dc.count);
  } catch (e) {
    report('us_concurrent_daily_max', 'FAIL', String(e.message || e));
  }

  // --- 5 public HTTP TEMP_HIDDEN ---
  try {
    const item = makeUsItem('httpHide', 'us-world');
    const ins = await enqueue(boot.repo, item);
    const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
    const apprH = await reviewService.transitionItem(id, 'APPROVED', Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: '2026-09-01T00:00:00.000Z',
    }));
    if (!apprH.ok) throw new Error(apprH.error || 'appr-http');
    const pubH = await reviewService.transitionItem(id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo, boot.ex), {
      operatorApproval: true,
      reviewer: 'admin',
      expectedStatus: 'APPROVED',
      expectedLockVersion: apprH.item.lockVersion,
      asOf: '2026-07-01T17:00:00.000Z',
    }));
    if (!pubH.ok) throw new Error(pubH.error || 'pub-http');
    const loaded = await boot.repo.getById(id);
    if (!loaded.ok) throw new Error('load-http');
    const hideDec = usOps.decideVisibility(loaded.item, { coreFactVerifiablyWrong: true });
    const merged = Object.assign({}, loaded.item, {
      lifecycleMeta: Object.assign({}, loaded.item.lifecycleMeta || {}, hideDec.meta),
    });
    await boot.repo.applyExistingIssueUpdate({ targetId: id, mergedIssue: merged, auditEvents: [] });
    const cstore = createPgDailyIssueCommentStore({ executor: boot.ex, schemaName: SCHEMA });
    await cstore.create({ issueId: id, userId: ADMIN, body: 'hidden-comment-http' });

    const app = createDailyIssueApiApp({
      repositoryInstance: boot.repo,
      executor: boot.ex,
      schemaName: SCHEMA,
      repositoryKind: 'db',
      databaseUrl: url,
      legalGate: { assertCompleteForUser: async function () {}, assertUsCompleteForUser: async function () {} },
    });
    const headers = { Cookie: US_COOKIE };
    const list = await requestApp(app, 'GET', '/api/daily-issues', { headers: headers });
    const show = await requestApp(app, 'GET', '/api/daily-issues/' + encodeURIComponent(id), { headers: headers });
    const comments = await requestApp(app, 'GET', '/api/daily-issues/' + encodeURIComponent(id) + '/comments', {
      headers: headers,
    });
    const react = await requestApp(app, 'POST', '/api/daily-issues/' + encodeURIComponent(id) + '/reactions/toggle', {
      headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
      body: { reactionType: 'LIKE' },
    });
    const listed = (list.body && list.body.items) || [];
    const inList = listed.some(function (it) {
      return String(it.id) === String(id);
    });
    const okHttp =
      !inList &&
      show.status === 404 &&
      comments.status === 404 &&
      (react.status === 404 || react.status === 401);
    const dbComments = await cstore.listByIssueId(id);
    report(
      'public_http_temp_hidden',
      okHttp && dbComments.length >= 1 ? 'PASS' : 'FAIL',
      'list=' + list.status + ' show=' + show.status + ' comments=' + comments.status + ' dbComments=' + dbComments.length,
    );
  } catch (e) {
    report('public_http_temp_hidden', 'FAIL', String(e.message || e));
  }

  await boot.ex.end();
  if (failed) {
    console.log('PHASE19_STEP4_VERDICT FAIL failed=' + failed);
    process.exit(1);
  }
  console.log('PHASE19_STEP4_VERDICT PASS');
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
