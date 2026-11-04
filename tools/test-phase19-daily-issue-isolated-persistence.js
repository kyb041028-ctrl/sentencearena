#!/usr/bin/env node
'use strict';

/**
 * Phase 19 — 격리 DB에 기사·스케줄 run 저장 후 별도 연결로 재조회 (메모리 PASS 금지).
 * DAILY_ISSUE_DATABASE_URL + daily_issue_test 필수.
 */

const core = require('../shared/daily-issue-morning-scheduler-core');
const usOps = require('../shared/daily-issue-us-ops-core');
const morning = require('../server/daily-issue-morning-scheduler-service');
const reviewService = require('../server/daily-issue-review-service');
const usRun = require('../server/daily-issue-us-run-service');
const { createUsSchedulerStore } = require('../server/daily-issue-us-scheduler-store');
const qualityCore = require('../shared/daily-issue-quality-core');
const freshnessCore = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const decision = require('../shared/daily-issue-publication-decision-core');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createSqlMorningSchedulerStore } = require('../server/daily-issue-morning-scheduler-store');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const PREFIX = 'p19iso_' + Date.now().toString(36) + '_';
const KR_DAY = '2099-02-01';
const COLLECT_AT = core.scheduledAtIso(KR_DAY, 4, 30);
const PUBLISH_AT = core.scheduledAtIso(KR_DAY, 5, 0);

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function freshExecutor(url) {
  return createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
}

function freshRepo(url) {
  const ex = freshExecutor(url);
  const repo = createSqlDailyIssueReviewRepository({ executor: ex, schemaName: SCHEMA, enabled: true });
  return { repo: repo, executor: ex };
}

function makeKrItem(kind) {
  const id = PREFIX + 'kr_' + kind;
  const isAuto = kind === 'auto';
  const title = isAuto ? '통계청 고용 통계 공식 발표 ' + id : '여야 정치 갈등 ' + id;
  const summary = isAuto ? '통계청이 고용 통계를 공식 발표했다.' : '정치 갈등이 커지고 있다.';
  const s1 = {
    id: id + '_s1',
    publisher: '통계청',
    title: '보도',
    url: 'https://kostat.go.kr/p19/' + id,
    publishedAt: '2099-01-31T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: id + '_s2',
    publisher: '연합뉴스',
    title: '기사',
    url: 'https://www.yna.co.kr/p19/' + id,
    publishedAt: '2099-01-31T02:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.yna.co.kr',
  };
  const evidences = [
    { id: id + '_e1', sourceId: s1.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: id + '_e2', sourceId: s2.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = qualityCore.buildDailyIssueCandidate({
    title: title,
    discussionPrompt: '평가?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: id + '_c1',
        text: summary,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [evidences[0].id, evidences[1].id],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: COLLECT_AT,
  });
  const gated = freshnessCore.applyFreshnessGateToCandidate(built, {
    asOf: COLLECT_AT,
    category: isAuto ? 'korea-economy' : 'korea-politics',
  });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      clusterId: 'cl_' + id,
      category: isAuto ? 'korea-economy' : 'korea-politics',
      candidateId: id,
      contentSignature: 'sig_' + id,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'KR',
    }),
    { asOf: COLLECT_AT, existingItems: [] },
  );
  return decision.attachDecisionToItem(Object.assign({}, created.item, { id: id }), { asOf: COLLECT_AT });
}

function makeUsItem(suffix) {
  const id = PREFIX + 'us_' + suffix;
  const summary = 'Federal agency published quarterly employment statistics.';
  return {
    id: id,
    candidateId: id,
    activityRegion: 'US',
    status: 'READY_FOR_REVIEW',
    title: summary + ' ' + id,
    confirmedSummary: summary,
    discussionPrompt: 'What should readers watch?',
    claims: [{ id: 'c1', text: summary, classification: 'CONFIRMED_FACT', isCore: true }],
    sourceRefs: [
      {
        id: 's1',
        publisher: 'CBS News',
        originDomain: 'www.cbsnews.com',
        url: 'https://www.cbsnews.com/p19/' + id,
        publishedAt: '2099-01-31T12:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'cbsnews-com',
        usMediaClass: 'COMMERCIAL',
      },
      {
        id: 's2',
        publisher: 'KQED',
        originDomain: 'www.kqed.org',
        url: 'https://www.kqed.org/p19/' + id,
        publishedAt: '2099-01-31T13:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'kqed-org',
        usMediaClass: 'PUBLIC_BROADCAST',
      },
    ],
    qualityMeta: {
      ok: true,
      publicationStatus: 'READY',
      independentSourceCount: 2,
      journalismIndependentCount: 2,
    },
    freshnessMeta: { ok: true, freshnessOk: true, freshnessClass: 'RECENT_UPDATE' },
    duplicateMeta: { decision: 'NEW_ISSUE' },
    clusterId: 'cl_us_' + suffix,
    contentSignature: 'sig_us_' + suffix,
    expiresAt: '2099-12-31T00:00:00.000Z',
    lifecycleMeta: { activityRegion: 'US' },
  };
}

async function main() {
  console.log('PHASE19_ISOLATED_PERSIST', 'schema=' + SCHEMA);
  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  const gate = assertDailyIssueIsolatedTarget(url, SCHEMA);
  if (!gate.ok || !isAllowedTestSchema(SCHEMA)) {
    console.log('PHASE19_ISOLATED_PERSIST', 'SKIPPED', gate.reason || 'schema');
    console.log('PHASE19_ISO_PERSIST_VERDICT', 'SKIPPED');
    process.exit(2);
  }

  let executor;
  let store;
  const krIds = [];
  try {
    executor = freshExecutor(url);
    if (!executor.ok) {
      console.log('PHASE19_ISO_PERSIST_VERDICT', 'SKIPPED');
      process.exit(2);
    }
    const hc = await executor.healthCheck();
    ok('health fresh connection', hc.ok, hc.message);

    store = createSqlMorningSchedulerStore({ executor: executor, schemaName: SCHEMA });
    await store.initialize();
    const repo = createSqlDailyIssueReviewRepository({ executor: executor, schemaName: SCHEMA, enabled: true });
    await Promise.resolve(repo.initialize());

    const auto = makeKrItem('auto');
    const man = makeKrItem('manual');
    krIds.push(auto.item.id, man.item.id);

    const collect = await morning.runCollect({
      asOf: COLLECT_AT,
      dateKey: KR_DAY,
      force: true,
      schedulerStore: store,
      repositoryInstance: repo,
      collectRunner: async function (opt) {
        await Promise.resolve(
          opt.repositoryInstance.insertReviewItems([auto.item, man.item], [
            { entityId: auto.item.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19', timestamp: COLLECT_AT },
            { entityId: man.item.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19', timestamp: COLLECT_AT },
          ]),
        );
        return { ok: true, status: 'SUCCESS', collectedSourceCount: 2, candidateCount: 2, autoEligibleCount: 1, manualReviewCount: 1 };
      },
    });
    ok('KR collect persisted', collect.ok && collect.status === 'SUCCESS');

    const r2 = freshRepo(url);
    await Promise.resolve(r2.repo.initialize());
    const reAuto = await Promise.resolve(r2.repo.getById(auto.item.id));
    ok('KR article re-read conn2', reAuto.ok && reAuto.item && reAuto.item.title.indexOf('통계청') >= 0);
    await r2.executor.end();

    const exHist = freshExecutor(url);
    const histStore = createSqlMorningSchedulerStore({ executor: exHist, schemaName: SCHEMA });
    const hist = await morning.getHistory({ schedulerStore: histStore, limit: 30 });
    ok(
      'KR run history re-read',
      (hist.items || []).some(function (r) {
        return r.runKey === core.collectRunKey(KR_DAY);
      }),
    );
    await exHist.end();

    const publish = await morning.runPublish({
      asOf: PUBLISH_AT,
      dateKey: KR_DAY,
      force: true,
      schedulerStore: store,
      repositoryInstance: repo,
    });
    ok('KR publish run stored', publish.ok);
    const dupPublish = await morning.runPublish({
      asOf: PUBLISH_AT,
      dateKey: KR_DAY,
      force: true,
      schedulerStore: store,
      repositoryInstance: repo,
    });
    ok('same runKey duplicate blocked', dupPublish.skipped === true);

    const winter = usOps.slotFor('2026-01-15T16:00:00.000Z');
    const summer11 = usOps.slotFor('2026-07-15T15:00:00.000Z');
    const slot15 = usOps.slotFor('2026-07-15T19:00:00.000Z');
    const slot19 = usOps.slotFor('2026-01-16T00:00:00.000Z');
    ok('US ET 11 winter DST', winter.due && winter.hour === 11);
    ok('US ET 11 summer DST', summer11.due && summer11.hour === 11);
    ok('US ET 15 summer slot', slot15.due && slot15.hour === 15);
    ok('US slot 19 ET', slot19.due && slot19.hour === 19);

    const usItem = makeUsItem('slot');
    const usIns = await Promise.resolve(
      repo.insertReviewItems([usItem], [
        { entityId: usItem.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19us', timestamp: COLLECT_AT },
      ]),
    );
    ok('US item insert PG', usIns.ok);

    const r3 = freshRepo(url);
    await Promise.resolve(r3.repo.initialize());
    const gotUs = await Promise.resolve(r3.repo.getById(usItem.id));
    const gotKr = await Promise.resolve(r3.repo.getById(auto.item.id));
    ok('US row re-read conn3', gotUs.ok && gotUs.item && gotUs.item.id === usItem.id);
    ok('KR row re-read conn3', gotKr.ok && gotKr.item && gotKr.item.id === auto.item.id);
    ok('KR/US rows distinct', gotUs.item.id !== gotKr.item.id);
    await r3.executor.end();

    const sharedUsStore = createUsSchedulerStore({});
    const slotRun = await usRun.runUsDailyIssueSlot({
      asOf: '2026-01-15T16:00:00.000Z',
      forceSlot: true,
      repositoryInstance: repo,
      usStore: sharedUsStore,
      skipNetwork: true,
      ingestRunner: async function () {
        return { ok: true, readyCandidates: [], candidates: [] };
      },
      env: {},
    });
    ok('US slot run daily limit path ok', slotRun.ok !== false);
    const slotAgain = await usRun.runUsDailyIssueSlot({
      asOf: '2026-01-15T16:05:00.000Z',
      forceSlot: true,
      repositoryInstance: repo,
      usStore: sharedUsStore,
      skipNetwork: true,
      ingestRunner: async function () {
        return { ok: true, readyCandidates: [], candidates: [] };
      },
      env: {},
    });
    ok(
      'US duplicate runKey blocked',
      slotAgain.reason === 'ALREADY_PUBLISHED' ||
        slotAgain.outcome === 'DUPLICATE_BLOCKED' ||
        slotAgain.started === false,
      JSON.stringify({ reason: slotAgain.reason, outcome: slotAgain.outcome }),
    );

    const exFail = freshExecutor(url);
    const failStore = createSqlMorningSchedulerStore({ executor: exFail, schemaName: SCHEMA });
    const fk = core.collectRunKey('2099-02-02');
    const claim = await failStore.tryClaimRun({
      runKey: fk,
      runType: 'COLLECT',
      scheduledAt: COLLECT_AT,
      startedAt: COLLECT_AT,
    });
    ok('run claim before finish', claim.claimed === true, JSON.stringify(claim));
    await failStore.finishRun(fk, { status: 'FAILED', errorCode: 'SIMULATED', errorSummary: 'p19' });
    const failRead = await failStore.getByRunKey(fk);
    ok('failed run persisted', failRead.run && failRead.run.status === 'FAILED');
    await exFail.end();
  } catch (e) {
    failed += 1;
    console.error('FAIL exception', e && e.message ? e.message : e);
  } finally {
    if (executor && executor.end) await executor.end();
  }

  console.log('\nPhase19 isolated persist:', passed, 'passed,', failed, 'failed');
  if (failed) {
    console.log('PHASE19_ISO_PERSIST_VERDICT', 'FAIL');
    process.exit(1);
  }
  console.log('PHASE19_ISO_PERSIST_VERDICT', 'PASS');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
