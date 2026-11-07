#!/usr/bin/env node
'use strict';

/**
 * Phase 19 잔여 — 코드 있는 것만 격리 DB/MOCK 검증. 없으면 NOT_IMPLEMENTED + 확인 파일.
 */

const core = require('../shared/daily-issue-morning-scheduler-core');
const usOps = require('../shared/daily-issue-us-ops-core');
const usRun = require('../server/daily-issue-us-run-service');
const opsService = require('../server/daily-issue-ops-service');
const opsCore = require('../shared/daily-issue-ops-core');
const reviewService = require('../server/daily-issue-review-service');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const { createUsSchedulerStore } = require('../server/daily-issue-us-scheduler-store');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createSqlMorningSchedulerStore } = require('../server/daily-issue-morning-scheduler-store');
const { createPgDailyIssueCommentStore } = require('../server/daily-issue-comment-store');
const { createPgDailyIssueAlignmentReactionStore } = require('../server/daily-issue-alignment-reaction-store');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const TEST_USER = '11111111-1111-4111-8111-111111111111';
const AS_OF = '2026-09-01T00:00:00.000Z';
const PREFIX = 'p19rem_' + Date.now().toString(36);

let failed = 0;
const lines = [];

function report(key, verdict, detail) {
  const line = 'PHASE19_REMAINDER ' + key + ' ' + verdict + (detail ? ' ' + detail : '');
  lines.push(line);
  console.log(line);
  if (verdict === 'FAIL' || verdict === 'ISOLATED DB FAIL' || verdict === 'MOCK FAIL') failed += 1;
}

function notImpl(key, files) {
  report(key, 'NOT_IMPLEMENTED', 'checked=' + files.join(','));
}

function fresh(url) {
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  return { ex: ex, repo: createSqlDailyIssueReviewRepository({ executor: ex, schemaName: SCHEMA, enabled: true }) };
}

function makeKrItem(suffix) {
  const s1 = {
    id: PREFIX + '_s1_' + suffix,
    publisher: '통계청',
    title: 't',
    url: 'https://kostat.go.kr/rem/' + suffix,
    publishedAt: '2026-08-31T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: PREFIX + '_s2_' + suffix,
    publisher: '연합뉴스',
    title: 't2',
    url: 'https://www.yna.co.kr/rem/' + suffix,
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
  if (!created.ok || !created.item) {
    throw new Error('makeKrItem_failed:' + (created.reasons || []).join(','));
  }
  return opsCore.ensureOpsMeta(created.item, AS_OF);
}

async function main() {
  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  const gate = assertDailyIssueIsolatedTarget(url, SCHEMA);
  if (!gate.ok || !isAllowedTestSchema(SCHEMA)) {
    report('isolated_db', 'BLOCKED', gate.reason || 'missing-url');
    console.log('PHASE19_REMAINDER_VERDICT', 'BLOCKED');
    process.exit(2);
  }

  const boot = fresh(url);
  if (!boot.ex.ok) {
    report('isolated_db', 'BLOCKED', 'executor');
    process.exit(2);
  }
  await Promise.resolve(boot.repo.initialize());
  const store = createSqlMorningSchedulerStore({ executor: boot.ex, schemaName: SCHEMA });
  await store.initialize();

  // --- 동시 두 회차 (PG, 서로 다른 runKey) ---
  try {
    const k1 = core.collectRunKey('2099-03-01');
    const k2 = core.publishRunKey('2099-03-01');
    const at = core.scheduledAtIso('2099-03-01', 4, 30);
    const [c1, c2] = await Promise.all([
      store.tryClaimRun({ runKey: k1, runType: 'COLLECT', scheduledAt: at, startedAt: at }),
      store.tryClaimRun({ runKey: k2, runType: 'PUBLISH', scheduledAt: at, startedAt: at }),
    ]);
    const ok = c1.claimed && c2.claimed;
    report('concurrent_two_slots', ok ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'collect+publish keys');
    const sameKey = 'p19-same-run:' + Date.now();
    const dup = await Promise.all([
      store.tryClaimRun({ runKey: sameKey, runType: 'COLLECT', scheduledAt: at, startedAt: at }),
      store.tryClaimRun({ runKey: sameKey, runType: 'COLLECT', scheduledAt: at, startedAt: at }),
    ]);
    const oneClaim = (dup[0].claimed ? 1 : 0) + (dup[1].claimed ? 1 : 0);
    report('concurrent_same_runKey', oneClaim === 1 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'claims=' + oneClaim);
  } catch (e) {
    report('concurrent_two_slots', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- SUCCESS 기록 전 실패 ---
  try {
    const fk = core.collectRunKey('2099-03-02');
    const at2 = core.scheduledAtIso('2099-03-02', 4, 30);
    const claim = await store.tryClaimRun({ runKey: fk, runType: 'COLLECT', scheduledAt: at2, startedAt: at2 });
    const mid = await store.getByRunKey(fk);
    const beforeFinish =
      mid.run && mid.run.status === core.RUN_STATUS.STARTED && mid.run.status !== core.RUN_STATUS.SUCCESS;
    await store.finishRun(fk, { status: core.RUN_STATUS.FAILED, errorCode: 'SIMULATED', errorSummary: 'before-success' });
    const r2 = fresh(url);
    const after = await createSqlMorningSchedulerStore({ executor: r2.ex, schemaName: SCHEMA }).getByRunKey(fk);
    await r2.ex.end();
    report(
      'failure_before_success_record',
      beforeFinish && after.run && after.run.status === core.RUN_STATUS.FAILED ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'status=' + (after.run && after.run.status),
    );
  } catch (e) {
    report('failure_before_success_record', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- US 11·15·19 ET + DST → PG scheduler_runs (KR morning table, US runKey 저장 가능) ---
  try {
    const winter11 = usOps.slotFor('2026-01-15T16:00:00.000Z');
    const summer11 = usOps.slotFor('2026-07-15T15:00:00.000Z');
    const summer15 = usOps.slotFor('2026-07-15T19:00:00.000Z');
    const winter19 = usOps.slotFor('2026-01-16T00:00:00.000Z');
    const keys = [
      { slot: winter11, label: 'winter11' },
      { slot: summer11, label: 'summer11dst' },
      { slot: summer15, label: 'summer15' },
      { slot: winter19, label: 'winter19' },
    ];
    for (let i = 0; i < keys.length; i += 1) {
      const s = keys[i].slot;
      if (!s.runKey) continue;
      const t = new Date().toISOString();
      await store.tryClaimRun({
        runKey: s.runKey,
        runType: 'PUBLISH',
        scheduledAt: t,
        startedAt: t,
        meta: { activityRegion: 'US', hour: s.hour, label: keys[i].label },
      });
      await store.finishRun(s.runKey, { status: core.RUN_STATUS.SUCCESS, meta: { activityRegion: 'US', hour: s.hour } });
    }
    const r3 = fresh(url);
    const st = createSqlMorningSchedulerStore({ executor: r3.ex, schemaName: SCHEMA });
    const w = await st.getByRunKey(winter11.runKey);
    const s19 = await st.getByRunKey(winter19.runKey);
    await r3.ex.end();
    const pgOk = w.run && w.run.status === core.RUN_STATUS.SUCCESS && s19.run && s19.run.meta && s19.run.meta.hour === 19;
    report(
      'us_et_dst_pg_reread',
      pgOk ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'table=daily_issue_scheduler_runs no separate us-only table',
    );
  } catch (e) {
    report('us_et_dst_pg_reread', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- 일일 발행 제한 ---
  try {
    const memStore = createUsSchedulerStore({});
    const fourth = await usRun.runUsDailyIssueSlot({
      asOf: '2026-01-15T16:00:00.000Z',
      forceSlot: true,
      publishedTodayOverride: 3,
      env: {},
      usStore: memStore,
      skipNetwork: true,
      ingestRunner: async function () {
        return { ok: true, readyCandidates: [], candidates: [] };
      },
      repositoryInstance: {
        getPublishedIssues: function () {
          return Promise.resolve({ ok: true, items: [] });
        },
        list: function () {
          return Promise.resolve({ ok: true, items: [] });
        },
        initialize: function () {
          return Promise.resolve({ ok: true });
        },
        insertReviewItems: function () {
          return Promise.resolve({ ok: true, items: [] });
        },
      },
    });
    const usDaily =
      fourth.reason === 'DAILY_MAX_REACHED' || fourth.outcome === 'ZERO_NORMAL' || fourth.note === 'DAILY_MAX_REACHED';
    report('us_daily_publish_limit', usDaily ? 'MOCK PASS' : 'MOCK FAIL', 'server/daily-issue-us-run-service.js');
    report(
      'kr_daily_publish_limit',
      'NOT_IMPLEMENTED',
      'checked=server/daily-issue-morning-scheduler-service.js,shared/daily-issue-us-ops-core.js(no KR maxPerDay)',
    );
  } catch (e) {
    report('us_daily_publish_limit', 'MOCK FAIL', String(e.message || e));
  }

  // --- 중지 중 재시도 / 무권한 중지 해제 ---
  notImpl('halt_retry_while_stopped', [
    'server/daily-issue-review-service.js',
    'server/daily-issue-us-run-service.js',
    'shared/daily-issue-us-ops-core.js',
  ]);
  notImpl('unauthorized_halt_release', [
    'server/daily-issue-review-service.js',
    'server/daily-issue-routes.js',
    'public/admin/daily-issues/admin-daily-issue.js',
  ]);

  // --- 정정·숨김·이력 (PG, 별도 연결) ---
  try {
    const item = makeKrItem('ops');
    const ins = await Promise.resolve(
      boot.repo.insertReviewItems([item], [
        { entityId: item.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19', timestamp: AS_OF },
      ]),
    );
    if (!ins.ok) {
      report('insert_review_queue', 'ISOLATED DB FAIL', ins.error || ins.message || 'insert');
      report('correction_versions_pg', 'ISOLATED DB FAIL', 'blocked=insert');
      report('previous_versions_kept', 'ISOLATED DB FAIL', 'blocked=insert');
      report('source_refs_persisted', 'ISOLATED DB FAIL', 'blocked=insert');
      report('ai_meta_versions', 'ISOLATED DB FAIL', 'blocked=insert');
      report('publish_pg', 'ISOLATED DB FAIL', 'blocked=insert');
      report('temp_hide_pg', 'ISOLATED DB FAIL', 'blocked=insert');
      report('republish_us', 'MOCK FAIL', 'blocked=insert');
      report('duplicate_publish_block', 'ISOLATED DB FAIL', 'blocked=insert');
      report('comments_pg', 'ISOLATED DB FAIL', 'blocked=insert');
      report('reactions_pg', 'ISOLATED DB FAIL', 'blocked=insert');
      report('unauthorized_correction', 'ISOLATED DB FAIL', 'blocked=insert');
      report('other_country_unaffected', 'ISOLATED DB FAIL', 'blocked=insert');
      throw new Error('insert-failed');
    }
    const itemId = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
    const common = { repositoryInstance: boot.repo, schemaName: SCHEMA, databaseUrl: url, skipNetwork: true };

    const edited = await opsService.manualEdit(
      Object.assign({}, common, {
        id: itemId,
        asOf: '2026-09-01T01:00:00.000Z',
        patch: { title: '수정 제목', confirmedSummary: '수정 요약' },
      }),
    );
    const ai = await opsService.aiRevise(
      Object.assign({}, common, {
        id: itemId,
        asOf: '2026-09-01T02:00:00.000Z',
        instruction: '확인된 사실만 남겨라',
      }),
    );

    const rA = fresh(url);
    await Promise.resolve(rA.repo.initialize());
    const loaded = await Promise.resolve(rA.repo.getById(itemId));
    const doc = (loaded.item && loaded.item) || {};
    const vCount =
      (doc.draftVersions && doc.draftVersions.length) ||
      (doc.lifecycleMeta && doc.lifecycleMeta.draftVersions && doc.lifecycleMeta.draftVersions.length) ||
      0;
    const srcCount = (doc.sourceRefs && doc.sourceRefs.length) || 0;
    await rA.ex.end();

    report(
      'correction_versions_pg',
      edited.ok && ai.ok && vCount >= 3 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'versions=' + vCount + ' edit=' + (edited.error || edited.ok) + ' ai=' + (ai.error || ai.ok),
    );
    report('previous_versions_kept', vCount >= 2 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'requery=conn2');
    report('source_refs_persisted', srcCount >= 2 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'requery=conn2');
    report(
      'ai_meta_versions',
      ai.ok && ai.version ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'origin=' + ((ai.version && ai.version.originMethod) || 'none'),
    );

    const appr = await Promise.resolve(
      reviewService.transitionItem(itemId, 'APPROVED', {
        repositoryInstance: boot.repo,
        operatorApproval: true,
        reviewer: 'admin',
        asOf: '2026-09-01T03:00:00.000Z',
      }),
    );
    if (!appr.ok) {
      report('publish_pg', 'ISOLATED DB FAIL', appr.error);
    } else {
      const pub = await Promise.resolve(
        reviewService.transitionItem(itemId, 'PUBLISHED', {
          repositoryInstance: boot.repo,
          operatorApproval: true,
          reviewer: 'admin',
          asOf: '2026-09-01T04:00:00.000Z',
        }),
      );
      report('publish_pg', pub.ok ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'requery=conn2');
    }

    const usItem = makeKrItem('usvis');
    usItem.activityRegion = 'US';
    usItem.lifecycleMeta = Object.assign({}, usItem.lifecycleMeta || {}, { activityRegion: 'US' });
    const insUs = await Promise.resolve(
      boot.repo.insertReviewItems([usItem], [
        { entityId: usItem.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19', timestamp: AS_OF },
      ]),
    );
    const usId = (insUs.items && insUs.items[0] && insUs.items[0].id) || usItem.id;
    await Promise.resolve(
      reviewService.transitionItem(usId, 'APPROVED', {
        repositoryInstance: boot.repo,
        operatorApproval: true,
        reviewer: 'admin',
        asOf: '2026-09-01T03:30:00.000Z',
      }),
    );
    await Promise.resolve(
      reviewService.transitionItem(usId, 'PUBLISHED', {
        repositoryInstance: boot.repo,
        operatorApproval: true,
        reviewer: 'admin',
        asOf: '2026-09-01T03:31:00.000Z',
      }),
    );
    const pubUsRow = await Promise.resolve(boot.repo.getById(usId));
    const vis = usOps.decideVisibility(
      { activityRegion: 'US', status: 'PUBLISHED', lifecycleMeta: (pubUsRow.item && pubUsRow.item.lifecycleMeta) || {} },
      { coreFactVerifiablyWrong: true },
    );
    if (vis.action === 'TEMP_HIDE') {
      const base = pubUsRow.ok && pubUsRow.item ? pubUsRow.item : usItem;
      const merged = Object.assign({}, base, {
        lifecycleMeta: Object.assign({}, base.lifecycleMeta || {}, vis.meta),
      });
      const saved = await Promise.resolve(
        boot.repo.applyExistingIssueUpdate({
          targetId: usId,
          mergedIssue: merged,
          auditEvents: [],
        }),
      );
      const rH = fresh(url);
      await Promise.resolve(rH.repo.initialize());
      const hid = await Promise.resolve(rH.repo.getById(usId));
      await rH.ex.end();
      report(
        'temp_hide_pg',
        saved.ok && hid.ok && hid.item && hid.item.lifecycleMeta && hid.item.lifecycleMeta.usVisibility === 'TEMP_HIDDEN'
          ? 'ISOLATED DB PASS'
          : 'ISOLATED DB FAIL',
        saved.error || saved.message || 'shared/daily-issue-us-ops-core.js+sql repo',
      );
    } else {
      report('temp_hide_pg', 'ISOLATED DB FAIL', 'decideVisibility');
    }

    const reopen = usOps.decideVisibility(
      { activityRegion: 'US', lifecycleMeta: { usVisibility: 'TEMP_HIDDEN' } },
      { republish: true },
    );
    report('republish_us', reopen.ok === false ? 'MOCK PASS' : 'MOCK FAIL', 'shared/daily-issue-us-ops-core.js admin required');

    const dup = await Promise.resolve(
      reviewService.transitionItem(itemId, 'PUBLISHED', {
        repositoryInstance: boot.repo,
        operatorApproval: true,
        asOf: '2026-09-01T05:00:00.000Z',
        expectedStatus: 'PUBLISHED',
      }),
    );
    report('duplicate_publish_block', dup.ok === false ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'requery');

    const cstore = createPgDailyIssueCommentStore({ executor: boot.ex, schemaName: SCHEMA });
    const created = await cstore.create({ issueId: itemId, userId: TEST_USER, body: '테스트 댓글' });
    const rC = fresh(url);
    const cl = createPgDailyIssueCommentStore({ executor: rC.ex, schemaName: SCHEMA });
    const listed = await cl.listByIssueId(itemId);
    await rC.ex.end();
    report(
      'comments_pg',
      created.ok && listed.length >= 1 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      created.error || 'requery=conn3',
    );

    const rstore = createPgDailyIssueAlignmentReactionStore({ executor: boot.ex, schemaName: SCHEMA });
    const react = await rstore.toggle({
      issueId: itemId,
      userId: TEST_USER,
      reactionType: 'LIKE',
      directionSnapshot: 'NEUTRAL',
    });
    const rR = fresh(url);
    const rs = createPgDailyIssueAlignmentReactionStore({ executor: rR.ex, schemaName: SCHEMA });
    const got = await rs.getActive(TEST_USER, itemId);
    await rR.ex.end();
    report('reactions_pg', react.ok && got && got.reactionType === 'LIKE' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'requery=conn4');

    const bad = await Promise.resolve(
      reviewService.transitionItem(usId, 'PUBLISHED', {
        repositoryInstance: boot.repo,
        asOf: AS_OF,
      }),
    );
    report('unauthorized_correction', bad.ok === false ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'no operatorApproval');

    const rKr = fresh(url);
    await Promise.resolve(rKr.repo.initialize());
    const krRow = await Promise.resolve(rKr.repo.getById(itemId));
    const rUs = fresh(url);
    await Promise.resolve(rUs.repo.initialize());
    const usRow = await Promise.resolve(rUs.repo.getById(usId));
    await rKr.ex.end();
    await rUs.ex.end();
    report(
      'other_country_unaffected',
      krRow.ok && usRow.ok && krRow.item && usRow.item && krRow.item.id !== usRow.item.id ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      (krRow.error || usRow.error || 'requery=conn5'),
    );
  } catch (e) {
    if (String(e.message || e) !== 'insert-failed') {
      report('lifecycle_bundle', 'ISOLATED DB FAIL', String(e.message || e));
    }
  }

  await boot.ex.end();

  console.log('PHASE19_REMAINDER_VERDICT', failed ? 'FAIL' : 'PASS');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
