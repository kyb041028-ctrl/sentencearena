#!/usr/bin/env node
'use strict';

/**
 * 아침판 스케줄러 1차 단위 테스트 (판정/lifecycle 미변경)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const core = require('../shared/daily-issue-morning-scheduler-core');
const decision = require('../shared/daily-issue-publication-decision-core');
const { createJsonMorningSchedulerStore } = require('../server/daily-issue-morning-scheduler-store');
const morning = require('../server/daily-issue-morning-scheduler-service');
const reviewService = require('../server/daily-issue-review-service');
const qualityCore = require('../shared/daily-issue-quality-core');
const freshnessCore = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const express = require('express');
const { createTestAdminAuthGuard } = require('./daily-issue-api-test-fixtures');
const { createDailyIssueRouter } = require('../server/daily-issue-routes');

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

const DAY = '2026-08-07';
// 04:30 KST = 2026-08-06T19:30:00.000Z
const COLLECT_AT = '2026-08-06T19:30:00.000Z';
const COLLECT_CATCHUP = '2026-08-06T19:45:00.000Z';
const COLLECT_MISSED = '2026-08-06T20:05:00.000Z';
// 05:00 KST = 2026-08-06T20:00:00.000Z
const PUBLISH_AT = '2026-08-06T20:00:00.000Z';
const PUBLISH_CATCHUP = '2026-08-06T20:20:00.000Z';
const PUBLISH_MISSED = '2026-08-06T20:35:00.000Z';

function makeItem(kind, prefix) {
  const id = prefix + kind;
  const isAuto = kind === 'auto';
  const title = isAuto ? '통계청 고용 통계 공식 발표 ' + id : '여야 정치 갈등 ' + id;
  const summary = isAuto ? '통계청이 고용 통계를 공식 발표했다.' : '정치 갈등이 커지고 있다.';
  const s1 = {
    id: id + '_s1',
    publisher: '통계청',
    title: isAuto ? '보도자료' : '기사1',
    url: 'https://kostat.go.kr/m/' + id,
    publishedAt: '2026-08-06T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: id + '_s2',
    publisher: '연합뉴스',
    title: isAuto ? '관련 기사' : '기사2',
    url: 'https://www.yna.co.kr/m/' + id,
    publishedAt: '2026-08-06T02:00:00.000Z',
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
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
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
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    { asOf: COLLECT_AT, existingItems: [] },
  );
  return decision.attachDecisionToItem(
    Object.assign({}, created.item, { id: id, expiresAt: '2099-01-01T00:00:00.000Z' }),
    { asOf: COLLECT_AT },
  );
}

async function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-morn-sched-'));
  try {
    return await fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

async function main() {
  console.log('=== morning scheduler unit tests ===');

  ok('timezone fixed Asia/Seoul', core.TIMEZONE === 'Asia/Seoul');
  ok('collect runKey', core.collectRunKey(DAY) === 'morning-collect:2026-08-07');
  ok('publish runKey', core.publishRunKey(DAY) === 'morning-publish:2026-08-07');
  ok('namespaced collect runKey', core.collectRunKey(DAY, { runKeyNamespace: 'e2e' }) === 'e2e:morning-collect:2026-08-07');
  ok('keys separated', core.collectRunKey(DAY) !== core.publishRunKey(DAY));

  const collectSched = core.scheduledAtIso(DAY, 4, 30);
  const publishSched = core.scheduledAtIso(DAY, 5, 0);
  ok('04:30 scheduled UTC', collectSched === COLLECT_AT);
  ok('05:00 scheduled UTC', publishSched === PUBLISH_AT);
  ok('catch-up in window', core.evaluateWindow(COLLECT_CATCHUP, collectSched, 30).phase === 'in_window');
  ok('catch-up missed', core.evaluateWindow(COLLECT_MISSED, collectSched, 30).phase === 'missed');

  await withTemp(async function (dir) {
    const store = createJsonMorningSchedulerStore({ reviewRoot: dir });
    store.initialize();
    const repo = reviewService.resolveRepo({ repository: 'json', reviewRoot: dir });

    const prefix = 'ut_' + Date.now().toString(36) + '_';
    const auto = makeItem('auto', prefix);
    const man = makeItem('manual', prefix);
    ok('fixture AUTO', auto.decision.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE');
    ok('fixture MANUAL', man.decision.publicationDecision === 'MANUAL_REVIEW_REQUIRED');

    const collectRunner = async function (opt) {
      await Promise.resolve(
        opt.repositoryInstance.insertReviewItems(
          [auto.item, man.item],
          [
            {
              entityId: auto.item.id,
              fromStatus: null,
              toStatus: 'READY_FOR_REVIEW',
              action: 'enqueue',
              actorId: 'collect',
              timestamp: COLLECT_AT,
            },
            {
              entityId: man.item.id,
              fromStatus: null,
              toStatus: 'READY_FOR_REVIEW',
              action: 'enqueue',
              actorId: 'collect',
              timestamp: COLLECT_AT,
            },
          ],
          { dryRun: false },
        ),
      );
      return {
        ok: true,
        status: core.RUN_STATUS.SUCCESS,
        collectedSourceCount: 2,
        candidateCount: 2,
        autoEligibleCount: 1,
        manualReviewCount: 1,
        skippedDuplicateCount: 0,
      };
    };

    const c1 = await morning.runCollect({
      asOf: COLLECT_AT,
      dateKey: DAY,
      schedulerStore: store,
      repositoryInstance: repo,
      collectRunner: collectRunner,
      enabled: true,
    });
    ok('04:30 collect SUCCESS', c1.ok && c1.status === 'SUCCESS', JSON.stringify(c1));

    const c2 = await morning.runCollect({
      asOf: COLLECT_CATCHUP,
      dateKey: DAY,
      schedulerStore: store,
      repositoryInstance: repo,
      collectRunner: collectRunner,
      enabled: true,
    });
    ok('duplicate collect skip', c2.skipped === true && c2.status === 'SKIPPED_DUPLICATE', JSON.stringify(c2));

    // parallel-ish second claim
    const claimA = await store.tryClaimRun({
      runKey: 'morning-collect:parallel-test',
      runType: 'COLLECT',
      scheduledAt: COLLECT_AT,
      startedAt: COLLECT_AT,
    });
    const claimB = await store.tryClaimRun({
      runKey: 'morning-collect:parallel-test',
      runType: 'COLLECT',
      scheduledAt: COLLECT_AT,
      startedAt: COLLECT_AT,
    });
    ok('multi claim one win', claimA.claimed === true && claimB.skipped === true);

    const pBlocked = await morning.runPublish({
      asOf: core.scheduledAtIso('2026-08-08', 5, 0),
      dateKey: '2026-08-08',
      schedulerStore: store,
      repositoryInstance: repo,
      enabled: true,
      force: true,
    });
    ok('publish without collect → BLOCKED', pBlocked.status === 'BLOCKED', JSON.stringify(pBlocked));

    // mark a failed collect day then publish blocked
    await store.tryClaimRun({
      runKey: core.collectRunKey('2026-08-09'),
      runType: 'COLLECT',
      scheduledAt: core.scheduledAtIso('2026-08-09', 4, 30),
      startedAt: COLLECT_AT,
    });
    await store.finishRun(core.collectRunKey('2026-08-09'), {
      status: 'FAILED',
      finishedAt: COLLECT_AT,
      errorCode: 'COLLECT_FAILED',
      errorSummary: 'forced fail',
    });
    const pFailGate = await morning.runPublish({
      asOf: core.scheduledAtIso('2026-08-09', 5, 0),
      dateKey: '2026-08-09',
      schedulerStore: store,
      repositoryInstance: repo,
      enabled: true,
      force: true,
    });
    ok('collect FAILED → publish BLOCKED', pFailGate.status === 'BLOCKED', JSON.stringify(pFailGate));

    const pub = await morning.runPublish({
      asOf: PUBLISH_AT,
      dateKey: DAY,
      schedulerStore: store,
      repositoryInstance: repo,
      enabled: true,
    });
    ok('05:00 publish ok', pub.ok === true, JSON.stringify(pub));
    ok('AUTO published count is 0', pub.run && Number(pub.run.autoPublishedCount || 0) === 0, JSON.stringify(pub.run));

    const listed = await Promise.resolve(repo.list({}));
    const autoItem = (listed.items || []).find(function (i) {
      return i.id === auto.item.id;
    });
    const manItem = (listed.items || []).find(function (i) {
      return i.id === man.item.id;
    });
    ok('AUTO stays READY_FOR_REVIEW', autoItem && autoItem.status === 'READY_FOR_REVIEW', autoItem && autoItem.status);
    ok('MANUAL stays READY', manItem && manItem.status === 'READY_FOR_REVIEW', manItem && manItem.status);

    const pub2 = await morning.runPublish({
      asOf: PUBLISH_CATCHUP,
      dateKey: DAY,
      schedulerStore: store,
      repositoryInstance: repo,
      enabled: true,
    });
    ok('duplicate publish skip', pub2.skipped === true, JSON.stringify(pub2));

    const missed = await morning.runCollect({
      asOf: '2026-08-09T20:05:00.000Z', // 2026-08-10 05:05 KST > 04:30+30m
      dateKey: '2026-08-10',
      schedulerStore: store,
      repositoryInstance: repo,
      collectRunner: async function () {
        throw new Error('should not run');
      },
      enabled: true,
    });
    ok('30m+ MISSED', missed.status === 'MISSED', JSON.stringify(missed));

    // zero-success must not hide failure
    const failSum = core.summarizePublishOutcome({
      ok: false,
      error: 'X',
      publishedIds: [],
      results: [{ ok: false }],
    });
    ok('failure not SUCCESS', failSum.status === 'FAILED');
    const zeroOk = core.summarizePublishOutcome({ ok: true, publishedIds: [], results: [], blocked: [] });
    ok('zero publish flagged', zeroOk.warningZeroPublish === true && zeroOk.errorCode === 'AUTO_PUBLISH_ZERO');

    const st = await morning.getStatus({ schedulerStore: store, asOf: PUBLISH_AT });
    ok('status API shape', st.ok && st.timezone === 'Asia/Seoul' && st.nextCollectAt && st.nextPublishAt);
    const history = await morning.getHistory({ schedulerStore: store, limit: 20 });
    ok('history has runs', history.ok && (history.items || []).length >= 2);

    // retire auto
    const ret = await Promise.resolve(
      reviewService.transitionItem(auto.item.id, 'RETIRED', {
        repositoryInstance: repo,
        actorId: 'admin',
        reason: 'MANUAL_RETIRE',
        reasonText: 'post review',
        asOf: '2026-08-07T01:00:00.000Z',
      }),
    );
    ok('retire after auto publish blocked because never published', ret.ok === false);

    // HTTP auth for morning endpoints
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createDailyIssueRouter({
        adminAuthGuard: createTestAdminAuthGuard('sched-test-token'),
        repositoryInstance: repo,
        schedulerStore: store,
        allowMorningManual: true,
        collectRunner: collectRunner,
      }),
    );
    const { server, port } = await listen(app);
    try {
      const base = 'http://127.0.0.1:' + port;
      const noAuth = await fetch(base + '/api/admin/daily-issues/morning/status');
      ok('status requires auth', noAuth.status === 401 || noAuth.status === 403);
      const authStatus = await fetch(base + '/api/admin/daily-issues/morning/status', {
        headers: { Authorization: 'Bearer sched-test-token' },
      });
      const authJson = await authStatus.json();
      ok('status API auth ok', authStatus.status === 200 && authJson.ok === true);

      const histRes = await fetch(base + '/api/admin/daily-issues/morning/history?limit=10', {
        headers: { Authorization: 'Bearer sched-test-token' },
      });
      const histJson = await histRes.json();
      ok('history API auth ok', histRes.status === 200 && histJson.ok === true);

      const badCollect = await fetch(base + '/api/admin/daily-issues/morning/run-collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      ok('manual collect requires auth', badCollect.status === 401 || badCollect.status === 403);

      const queueRes = await fetch(
        base + '/api/admin/daily-issues/review?status=PUBLISHED&postReviewQueue=1',
        { headers: { Authorization: 'Bearer sched-test-token' } },
      );
      const queueJson = await queueRes.json();
      ok('post-review queue API', queueRes.status === 200 && queueJson.ok === true);
    } finally {
      await new Promise(function (r) {
        server.close(r);
      });
    }
  });

  console.log('\nMorning scheduler results:', passed, 'passed,', failed, 'failed');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
