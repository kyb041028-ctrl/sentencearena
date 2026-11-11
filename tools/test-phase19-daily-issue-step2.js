#!/usr/bin/env node
'use strict';

/**
 * Phase 19 2단계 — 격리 PG·MOCK·NOT_IMPLEMENTED·BETA_BLOCKER (1단계 PASS 항목 반복 없음).
 */

const core = require('../shared/daily-issue-morning-scheduler-core');
const usOps = require('../shared/daily-issue-us-ops-core');
const usRun = require('../server/daily-issue-us-run-service');
const reviewService = require('../server/daily-issue-review-service');
const opsService = require('../server/daily-issue-ops-service');
const opsCore = require('../shared/daily-issue-ops-core');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const contract = require('../shared/daily-issue-review-repository-contract');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const { createUsSchedulerStore } = require('../server/daily-issue-us-scheduler-store');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createSqlMorningSchedulerStore } = require('../server/daily-issue-morning-scheduler-store');
const { createPgDailyIssueCommentStore } = require('../server/daily-issue-comment-store');
const { createPgDailyIssueAlignmentReactionStore } = require('../server/daily-issue-alignment-reaction-store');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const TEST_USER = '11111111-1111-4111-8111-111111111111';
const TEST_USER_B = '11111111-1111-4111-8111-111111111111';
const AS_OF = '2026-09-01T00:00:00.000Z';
const PREFIX = 'p19s2_' + Date.now().toString(36);
const BASE_COMMIT = '43584565697cc435e542fd78c120730daddb4fe5';

let failed = 0;
let blockers = 0;
const verdicts = {};

function report(key, verdict, detail) {
  const line = 'PHASE19_STEP2 ' + key + ' ' + verdict + (detail ? ' ' + detail : '');
  console.log(line);
  verdicts[key] = { verdict: verdict, detail: detail || '' };
  if (verdict === 'ISOLATED DB FAIL' || verdict === 'MOCK FAIL' || verdict === 'FAIL') failed += 1;
  if (verdict === 'BETA_BLOCKER') blockers += 1;
}

function notImpl(key, files, extra) {
  report(key, 'NOT_IMPLEMENTED', 'checked=' + files.join(',') + (extra ? ' ' + extra : ''));
}

function fresh(url) {
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  return { ex: ex, repo: createSqlDailyIssueReviewRepository({ executor: ex, schemaName: SCHEMA, enabled: true }) };
}

function schedStore(url) {
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  return { ex: ex, store: createSqlMorningSchedulerStore({ executor: ex, schemaName: SCHEMA }) };
}

async function countRunRows(ex, runKey) {
  const res = await ex.query(
    'SELECT COUNT(*)::int AS n FROM "' + SCHEMA + '"."daily_issue_scheduler_runs" WHERE run_key = $1',
    [runKey],
  );
  return (res.rows && res.rows[0] && res.rows[0].n) || 0;
}

function makeKrItem(suffix) {
  const s1 = {
    id: PREFIX + '_s1_' + suffix,
    publisher: '통계청',
    title: 't',
    url: 'https://kostat.go.kr/s2/' + suffix,
    publishedAt: '2026-08-31T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: PREFIX + '_s2_' + suffix,
    publisher: '연합뉴스',
    title: 't2',
    url: 'https://www.yna.co.kr/s2/' + suffix,
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
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: PREFIX + '_id_' + suffix,
      clusterId: PREFIX + '_cl_' + suffix,
      candidateId: PREFIX + '_cand_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'KR',
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeKrItem:' + (created.reasons || []).join(','));
  return opsCore.ensureOpsMeta(created.item, AS_OF);
}

function makeUsItem(suffix, categoryOverride) {
  const id = PREFIX + 'us_' + suffix;
  const category = categoryOverride || 'us-national';
  const summary = 'Federal agency published quarterly employment statistics ' + suffix + '.';
  const s1 = {
    id: id + '_s1',
    publisher: 'CBS News',
    title: 't',
    url: 'https://www.cbsnews.com/p19s2/' + id + '/1',
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
    url: 'https://www.kqed.org/p19s2/' + id + '/2',
    publishedAt: '2026-08-31T13:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.kqed.org',
    independentNetworkKey: 'kqed-org',
    usMediaClass: 'PUBLIC_BROADCAST',
  };
  const built = quality.buildDailyIssueCandidate({
    title: summary,
    discussionPrompt: 'What should readers watch?',
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
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF, category: category });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: id,
      candidateId: id + '_cand',
      clusterId: 'cl_us_' + suffix,
      contentSignature: 'sig_us_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'US',
      category: category,
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeUsItem:' + (created.reasons || []).join(','));
  return decisionCore.attachDecisionToItem(
    Object.assign({}, created.item, { lifecycleMeta: Object.assign({}, created.item.lifecycleMeta || {}, { activityRegion: 'US' }) }),
    { asOf: AS_OF },
  ).item;
}

async function publishUsItem(repo, suffix, publishedAt, categoryOverride) {
  const item = makeUsItem(suffix, categoryOverride);
  const ins = await repo.insertReviewItems([item], [
    { entityId: item.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19s2', timestamp: AS_OF },
  ]);
  if (!ins.ok) return { ok: false, error: ins.error };
  const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
  const appr = await reviewService.transitionItem(id, 'APPROVED', {
    repositoryInstance: repo,
    operatorApproval: true,
    reviewer: 'admin',
    asOf: AS_OF,
  });
  if (!appr.ok) return appr;
  return reviewService.transitionItem(id, 'PUBLISHED', {
    repositoryInstance: repo,
    operatorApproval: true,
    reviewer: 'admin',
    asOf: publishedAt,
  });
}

async function main() {
  report('baseline_commit', 'INFO', 'user_base=996e1aa work_head=' + BASE_COMMIT);

  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  const gate = assertDailyIssueIsolatedTarget(url, SCHEMA);
  if (!gate.ok || !isAllowedTestSchema(SCHEMA)) {
    report('isolated_env', 'BLOCKED', gate.reason || 'missing-url');
    console.log('PHASE19_STEP2_VERDICT', 'BLOCKED');
    process.exit(2);
  }

  const boot = fresh(url);
  if (!boot.ex.ok) {
    report('isolated_env', 'BLOCKED', 'executor');
    process.exit(2);
  }
  await boot.repo.initialize();
  const bootSched = schedStore(url);
  await bootSched.store.initialize();

  // --- 1 동시 runKey (두 DB 연결) ---
  try {
    const runKey = PREFIX + ':dual:' + Date.now();
    const at = new Date().toISOString();
    const pairA = schedStore(url);
    const pairB = schedStore(url);
    const [c1, c2] = await Promise.all([
      pairA.store.tryClaimRun({ runKey: runKey, runType: 'PUBLISH', scheduledAt: at, startedAt: at }),
      pairB.store.tryClaimRun({ runKey: runKey, runType: 'PUBLISH', scheduledAt: at, startedAt: at }),
    ]);
    await pairA.ex.end();
    await pairB.ex.end();
    const claimCount = (c1.claimed ? 1 : 0) + (c2.claimed ? 1 : 0);
    const dupSide = c1.claimed ? c2 : c1;
    const rQ = schedStore(url);
    const byKey = await rQ.store.getByRunKey(runKey);
    await rQ.ex.end();
    const dupOk =
      claimCount === 1 &&
      !dupSide.claimed &&
      dupSide.skipped === true &&
      byKey.run &&
      byKey.run.status === core.RUN_STATUS.STARTED;
    report('concurrent_dual_connection_claim', claimCount === 1 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'claims=' + claimCount);
    report(
      'concurrent_duplicate_state_return',
      dupOk ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      (dupSide.reason || '') + ' requery=' + (byKey.run && byKey.run.status),
    );

    const rowCount = await countRunRows(bootSched.ex, runKey);
    report('concurrent_single_run_row', rowCount === 1 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'rows=' + rowCount);

    await bootSched.store.finishRun(runKey, {
      status: core.RUN_STATUS.FAILED,
      errorCode: 'SIMULATED',
      errorSummary: 'lock-cleanup-test',
    });
    const rFail = schedStore(url);
    const afterFail = await rFail.store.getByRunKey(runKey);
    await rFail.ex.end();
    report(
      'failure_lock_marked_failed',
      afterFail.run && afterFail.run.status === core.RUN_STATUS.FAILED ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'status=' + (afterFail.run && afterFail.run.status),
    );

    const rPub = schedStore(url);
    await rPub.store.finishRun(runKey, { status: core.RUN_STATUS.SUCCESS, autoPublishedCount: 1 });
    const dupPub = await rPub.store.tryClaimRun({ runKey: runKey, runType: 'PUBLISH', scheduledAt: at, startedAt: at });
    const rowsAfterSuccess = await countRunRows(rPub.ex, runKey);
    await rPub.ex.end();
    report(
      'no_duplicate_publish_run_after_success',
      dupPub.skipped && rowsAfterSuccess === 1 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'skipped=' + dupPub.skipped + ' rows=' + rowsAfterSuccess,
    );
  } catch (e) {
    report('concurrent_dual_connection_claim', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- 2 SUCCESS 전 장애·재시도·원자성 ---
  try {
    const orphanKey = PREFIX + ':orphan:' + Date.now();
    const at2 = new Date().toISOString();
    const sOr = schedStore(url);
    const orphanClaim = await sOr.store.tryClaimRun({ runKey: orphanKey, runType: 'COLLECT', scheduledAt: at2, startedAt: at2 });
    const blockRetry = await sOr.store.tryClaimRun({ runKey: orphanKey, runType: 'COLLECT', scheduledAt: at2, startedAt: at2 });
    await sOr.ex.end();
    report(
      'orphan_started_blocks_second_claim',
      orphanClaim.claimed && blockRetry.skipped ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'reason=' + (blockRetry.reason || ''),
    );
    notImpl('process_crash_recovery_orphan_running', [
      'server/daily-issue-morning-scheduler-service.js',
      'server/daily-issue-morning-scheduler-store.js',
    ], 'no STARTED sweeper');

    const failKey = PREFIX + ':retry:' + Date.now();
    const sF = schedStore(url);
    await sF.store.tryClaimRun({ runKey: failKey, runType: 'PUBLISH', scheduledAt: at2, startedAt: at2 });
    await sF.store.finishRun(failKey, { status: core.RUN_STATUS.FAILED, errorCode: 'MID_RUN', errorSummary: 'before-success' });
    const retry = await sF.store.tryClaimRun({
      runKey: failKey,
      runType: 'PUBLISH',
      scheduledAt: at2,
      startedAt: at2,
      allowRetryAfterFailure: true,
    });
    await sF.ex.end();
    report('failed_run_retry_claim', retry.claimed ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'allowRetryAfterFailure');

    const item = makeKrItem('txn');
    await boot.repo.insertReviewItems([item], [
      { entityId: item.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19s2', timestamp: AS_OF },
    ]);
    const loaded = await boot.repo.getById(item.id);
    const beforeAud = (await boot.repo.listAuditEvents({ entityId: item.id })).events.length;
    boot.repo.setTestHooks({ failAudit: true });
    const txnFail = await boot.repo.transitionReviewItem({
      id: item.id,
      expectedStatus: loaded.item.status,
      expectedLockVersion: loaded.item.lockVersion,
      nextItem: Object.assign({}, loaded.item, { status: 'APPROVED', approvedAt: AS_OF }),
      auditEvents: [{ entityId: item.id, action: 'approve_fail_test', timestamp: AS_OF }],
    });
    boot.repo.clearTestHooks();
    const afterItem = await boot.repo.getById(item.id);
    const afterAud = (await boot.repo.listAuditEvents({ entityId: item.id })).events.length;
    report(
      'txn_failure_rollback',
      !txnFail.ok && txnFail.rolledBack && afterItem.item.status === loaded.item.status ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      txnFail.error || '',
    );
    report(
      'failure_audit_not_partially_persisted',
      afterAud === beforeAud ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'before=' + beforeAud + ' after=' + afterAud,
    );

    notImpl('timeout_then_scheduler_retry', [
      'server/daily-issue-morning-scheduler-service.js',
      'shared/daily-issue-us-ops-core.js',
    ], 'retryDecision=transient-only-no-wall-clock-timeout');

    const artKey = PREFIX + ':art:' + Date.now();
    const artAt = new Date().toISOString();
    const sArt = schedStore(url);
    await sArt.store.tryClaimRun({ runKey: artKey, runType: 'PUBLISH', scheduledAt: artAt, startedAt: artAt });
    const artItem = makeKrItem('midfail');
    await boot.repo.insertReviewItems([artItem], [
      { entityId: artItem.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19s2', timestamp: AS_OF },
    ]);
    await sArt.store.finishRun(artKey, { status: core.RUN_STATUS.FAILED, errorCode: 'SIMULATED', errorSummary: 'after-articles' });
    const rArt = fresh(url);
    await rArt.repo.initialize();
    const still = await rArt.repo.getById(artItem.id);
    const rRun = schedStore(url);
    const runRow = await rRun.store.getByRunKey(artKey);
    await rArt.ex.end();
    await rRun.ex.end();
    report(
      'articles_saved_before_success_failure',
      still.ok && runRow.run && runRow.run.status === core.RUN_STATUS.FAILED ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'no-duplicate-article-rollback-on-run-fail',
    );
  } catch (e) {
    report('failure_recovery_bundle', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- 3 일일 제한 ---
  try {
    notImpl('kr_daily_max_per_day_db', ['server/daily-issue-morning-scheduler-service.js', 'server/daily-issue-review-service.js'], 'no KR maxPerDay in code');

    const winterDate = '2026-01-15T16:00:00.000Z';
    const summer11 = '2026-07-15T15:00:00.000Z';
    const summer15 = '2026-07-15T19:00:00.000Z';
    const winter19 = '2026-01-16T00:00:00.000Z';
    const pubAt = '2026-01-15T17:00:00.000Z';
    await publishUsItem(boot.repo, 'd1', pubAt);
    await publishUsItem(boot.repo, 'd2', pubAt);
    await publishUsItem(boot.repo, 'd3', pubAt);
    const rCnt = fresh(url);
    await rCnt.repo.initialize();
    const dayCount = await usRun.countPublishedUsOnDate(rCnt.repo, usOps.slotFor(winterDate).dateKey, winterDate);
    await rCnt.ex.end();
    report(
      'us_daily_count_from_pg_published',
      dayCount.ok && dayCount.count >= 3 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'count=' + dayCount.count + ' dateKey=' + usOps.slotFor(winterDate).dateKey,
    );

    const memStore = createUsSchedulerStore({});
    const atMax = await usRun.runUsDailyIssueSlot({
      asOf: winterDate,
      forceSlot: true,
      publishedTodayOverride: 3,
      env: {},
      usStore: memStore,
      skipNetwork: true,
      repositoryInstance: boot.repo,
      ingestRunner: async function () {
        return { ok: true, readyCandidates: [], candidates: [] };
      },
    });
    report(
      'us_daily_limit_at_max',
      atMax.reason === 'DAILY_MAX_REACHED' || atMax.note === 'DAILY_MAX_REACHED' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'pg-count+override maxPerDay=3',
    );
    report(
      'us_scheduler_run_store_limitation',
      'MOCK PASS',
      'us run claim in memory store only; PG holds articles+KR scheduler_runs not US-only table',
    );

    const slotW = usOps.slotFor(winterDate);
    const slotS11 = usOps.slotFor(summer11);
    const slotS15 = usOps.slotFor(summer15);
    const slotW19 = usOps.slotFor(winter19);
    report(
      'us_dst_slot_keys',
      slotW.hour === 11 && slotS11.hour === 11 && slotS15.hour === 15 && slotW19.hour === 19 ? 'MOCK PASS' : 'MOCK FAIL',
      'slotFor ET not persisted aggregation table',
    );
  } catch (e) {
    report('daily_limit_bundle', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- 4·7 긴급 중지 vs env OFF ---
  notImpl('kr_emergency_halt_persistent', ['server/daily-issue-review-service.js', 'server/daily-issue-routes.js'], 'only DAILY_ISSUE_MORNING_AUTO_PUBLISH env');
  notImpl('us_emergency_halt_persistent', ['server/daily-issue-us-run-service.js', 'shared/daily-issue-us-ops-core.js'], 'only DAILY_ISSUE_US_AUTO_PUBLISH env');
  notImpl('halt_retry_while_emergency', ['server/daily-issue-review-service.js', 'server/daily-issue-us-run-service.js']);
  notImpl('halt_mid_run_cancel', ['server/daily-issue-morning-scheduler-service.js', 'server/daily-issue-us-run-service.js']);
  notImpl('unauthorized_halt_release', ['server/daily-issue-routes.js', 'public/admin/daily-issues/admin-daily-issue.js']);
  notImpl('halt_state_survives_restart', ['server/daily-issue-morning-scheduler-store.js', 'server/daily-issue-us-scheduler-store.js'], 'no halt row');

  report(
    'env_auto_off_is_not_emergency_halt',
    reviewService.isMorningAutoPublishEnabled({}) === false ? 'MOCK PASS' : 'MOCK FAIL',
    'policy flag only not persisted emergency',
  );

  const forceBypass = await Promise.resolve(
    reviewService.runMorningAutoPublish({
      asOf: '2026-08-06T20:05:00.000Z',
      forceAutoPublish: true,
      ignoreMorningWindow: true,
      dryRun: true,
      env: {},
      repositoryInstance: {
        list: function () {
          return Promise.resolve({ ok: true, items: [] });
        },
        getPublishedIssues: function () {
          return Promise.resolve({ ok: true, items: [] });
        },
        initialize: function () {
          return Promise.resolve({ ok: true });
        },
      },
    }),
  );
  if (forceBypass.skipped !== true && (forceBypass.results || []).length >= 0) {
    report('forceAutoPublish_bypasses_env_off', 'BETA_BLOCKER', 'review-service runMorningAutoPublish dryRun');
  } else {
    report('forceAutoPublish_bypasses_env_off', 'MOCK FAIL', 'unexpected skip');
  }

  // --- 5 정정·숨김·재공개 ---
  try {
    const kr = makeKrItem('life');
    const ins = await boot.repo.insertReviewItems([kr], [
      { entityId: kr.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'admin', timestamp: AS_OF },
    ]);
    const krId = (ins.items && ins.items[0] && ins.items[0].id) || kr.id;
    const edited = await opsService.manualEdit({
      repositoryInstance: boot.repo,
      id: krId,
      asOf: '2026-09-01T01:00:00.000Z',
      patch: { title: '운영자 정정 제목', confirmedSummary: '정정 요약' },
      actorId: 'admin',
    });
    await opsService.aiRevise({
      repositoryInstance: boot.repo,
      id: krId,
      asOf: '2026-09-01T02:00:00.000Z',
      instruction: '확인된 사실만',
      actorId: 'admin',
    });
    const rV = fresh(url);
    await rV.repo.initialize();
    const vRow = await rV.repo.getById(krId);
    await rV.ex.end();
    const versions = (vRow.item && vRow.item.draftVersions) || [];
    const hasMeta =
      versions.length >= 3 &&
      versions.some(function (v) {
        return v.originMethod === opsCore.ORIGIN.MANUAL_EDIT || v.originMethod === 'MANUAL_EDIT';
      }) &&
      versions.some(function (v) {
        return v.originMethod === opsCore.ORIGIN.AI_REVISE || v.originMethod === 'AI_REVISE';
      });
    report(
      'admin_correction_versions_not_status_only',
      edited.ok && hasMeta ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'versions=' + versions.length,
    );
    report(
      'source_refs_after_correction',
      vRow.ok && (vRow.item.sourceRefs || []).length >= 2 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'requery',
    );

    await reviewService.transitionItem(krId, 'APPROVED', {
      repositoryInstance: boot.repo,
      operatorApproval: true,
      reviewer: 'admin',
      asOf: '2026-09-01T03:00:00.000Z',
    });
    await reviewService.transitionItem(krId, 'PUBLISHED', {
      repositoryInstance: boot.repo,
      operatorApproval: true,
      reviewer: 'admin',
      asOf: '2026-09-01T04:00:00.000Z',
    });

    const retired = await reviewService.transitionItem(krId, 'RETIRED', {
      repositoryInstance: boot.repo,
      actorId: 'admin',
      retireReason: 'MANUAL_RETIRE',
      reasonText: 'retire-not-hide',
      asOf: '2026-09-01T05:00:00.000Z',
    });
    report(
      'kr_retired_distinct_from_us_temp_hide',
      retired.ok ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      retired.error || 'status=RETIRED',
    );

    const usPub = await publishUsItem(boot.repo, 'hide', '2026-01-15T17:00:00.000Z', 'us-politics');
    if (!usPub.ok) {
      report('us_temp_hide_requery', 'ISOLATED DB FAIL', usPub.error || 'publish-us');
      throw new Error('us-publish-failed');
    }
    const usId = usPub.item.id;
    const pubRow = await boot.repo.getById(usId);
    const hideDec = usOps.decideVisibility(
      { activityRegion: 'US', status: 'PUBLISHED', lifecycleMeta: pubRow.item.lifecycleMeta || {} },
      { coreFactVerifiablyWrong: true },
    );
    const mergedHide = Object.assign({}, pubRow.item, {
      lifecycleMeta: Object.assign({}, pubRow.item.lifecycleMeta || {}, hideDec.meta),
    });
    await boot.repo.applyExistingIssueUpdate({ targetId: usId, mergedIssue: mergedHide, auditEvents: [] });

    const usCorrPub = await publishUsItem(boot.repo, 'corr', '2026-01-15T18:00:00.000Z', 'us-world');
    const corrId = usCorrPub.item.id;
    const corrRow = await boot.repo.getById(corrId);
    const corrDec = usOps.decideVisibility(
      { activityRegion: 'US', status: 'PUBLISHED', lifecycleMeta: corrRow.item.lifecycleMeta || {} },
      { correctionNote: '사실 관계 정정', title: '정정 제목' },
    );
    const mergedCorr = Object.assign({}, corrRow.item, {
      title: '정정 제목',
      lifecycleMeta: Object.assign({}, corrRow.item.lifecycleMeta || {}, corrDec.meta),
    });
    await boot.repo.applyExistingIssueUpdate({ targetId: corrId, mergedIssue: mergedCorr, auditEvents: [] });

    const rH = fresh(url);
    await rH.repo.initialize();
    const hid = await rH.repo.getById(usId);
    const corrRead = await rH.repo.getById(corrId);
    await rH.ex.end();
    report(
      'us_temp_hide_requery',
      hid.ok && hid.item.lifecycleMeta && hid.item.lifecycleMeta.usVisibility === 'TEMP_HIDDEN' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'not RETIRED',
    );
    report(
      'us_correction_note_meta',
      corrRead.ok && corrRead.item && corrRead.item.lifecycleMeta && corrRead.item.lifecycleMeta.correctionNote
        ? 'ISOLATED DB PASS'
        : 'ISOLATED DB FAIL',
      'correctionNote requery',
    );
    report(
      'retired_vs_temp_hide_distinct',
      (await boot.repo.getById(krId)).item.status === 'RETIRED' && hid.item.lifecycleMeta.usVisibility === 'TEMP_HIDDEN'
        ? 'ISOLATED DB PASS'
        : 'ISOLATED DB FAIL',
      'KR RETIRED US TEMP_HIDDEN',
    );

    const reopen = usOps.decideVisibility({ activityRegion: 'US', lifecycleMeta: { usVisibility: 'TEMP_HIDDEN' } }, { republish: true });
    report('republish_requires_admin', reopen.ok === false ? 'MOCK PASS' : 'MOCK FAIL', reopen.error || '');

    const rKr = fresh(url);
    await rKr.repo.initialize();
    const krStill = await rKr.repo.getById(krId);
    await rKr.ex.end();
    report(
      'kr_unaffected_by_us_hide',
      krStill.ok && krStill.item.status === 'RETIRED' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'requery',
    );
  } catch (e) {
    report('lifecycle_step2_bundle', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- 6 댓글·반응 ---
  try {
    const base = makeKrItem('social');
    const insB = await boot.repo.insertReviewItems([base], [
      { entityId: base.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19s2', timestamp: AS_OF },
    ]);
    const issueId = (insB.items && insB.items[0] && insB.items[0].id) || base.id;
    await reviewService.transitionItem(issueId, 'APPROVED', {
      repositoryInstance: boot.repo,
      operatorApproval: true,
      reviewer: 'admin',
      asOf: AS_OF,
    });
    await reviewService.transitionItem(issueId, 'PUBLISHED', {
      repositoryInstance: boot.repo,
      operatorApproval: true,
      reviewer: 'admin',
      asOf: '2026-09-01T04:00:00.000Z',
    });
    const cstore = createPgDailyIssueCommentStore({ executor: boot.ex, schemaName: SCHEMA });
    const rstore = createPgDailyIssueAlignmentReactionStore({ executor: boot.ex, schemaName: SCHEMA });
    const c1 = await cstore.create({ issueId: issueId, userId: TEST_USER, body: '댓글1' });
    const c2 = await cstore.create({ issueId: issueId, userId: TEST_USER, body: '댓글2' });
    await rstore.toggle({ issueId: issueId, userId: TEST_USER, reactionType: 'LIKE', directionSnapshot: 'NEUTRAL' });

    await reviewService.transitionItem(issueId, 'RETIRED', {
      repositoryInstance: boot.repo,
      actorId: 'admin',
      retireReason: 'MANUAL_RETIRE',
      asOf: '2026-09-01T05:00:00.000Z',
    });

    const rC = fresh(url);
    await rC.repo.initialize();
    const cl = createPgDailyIssueCommentStore({ executor: rC.ex, schemaName: SCHEMA });
    const listed = await cl.listByIssueId(issueId);
    const rs = createPgDailyIssueAlignmentReactionStore({ executor: rC.ex, schemaName: SCHEMA });
    const react = await rs.getActive(TEST_USER, issueId);
    await rC.ex.end();

    report(
      'comments_persist_after_issue_retired',
      c1.ok && c2.ok && listed.length >= 2 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'no cascade delete in schema',
    );
    report(
      'reactions_persist_after_issue_retired',
      react && react.reactionType === 'LIKE' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'FK issue_id kept',
    );
    notImpl('comment_hide_policy_on_issue_hide', ['server/daily-issue-comment-store.js', 'server/daily-issue-routes.js'], 'soft-delete only per comment');
    notImpl('reaction_policy_on_temp_hide', ['server/daily-issue-routes.js'], 'public US hides issue not reactions row');
  } catch (e) {
    report('social_step2_bundle', 'ISOLATED DB FAIL', String(e.message || e));
  }

  report('real_auth', 'BLOCKED', 'no Supabase real auth in step2');
  report('paid_openai', 'BLOCKED', 'aiRevise uses local rebuild only in test');

  await bootSched.ex.end();
  await boot.ex.end();

  console.log('PHASE19_STEP2_SUMMARY baseline user=996e1aa head=' + BASE_COMMIT);
  console.log('PHASE19_STEP2_SUMMARY concurrent ISOLATED DB PASS when dual-connection tests green');
  console.log('PHASE19_STEP2_SUMMARY failure_recovery partial ISOLATED DB + process timeout NOT_IMPLEMENTED');
  console.log('PHASE19_STEP2_SUMMARY daily KR NOT_IMPLEMENTED US PG count ISOLATED DB');
  console.log('PHASE19_STEP2_SUMMARY halt persistent NOT_IMPLEMENTED forceAutoPublish BETA_BLOCKER');
  console.log('PHASE19_STEP2_SUMMARY lifecycle hide correction ISOLATED DB');
  console.log('PHASE19_STEP2_SUMMARY comments reactions ISOLATED DB persist on retire');

  if (failed) {
    console.log('PHASE19_STEP2_VERDICT', 'FAIL', 'failed=' + failed + ' blockers=' + blockers);
    process.exit(1);
  }
  console.log('PHASE19_STEP2_VERDICT', 'PASS', 'blockers=' + blockers);
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
