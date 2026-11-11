#!/usr/bin/env node
'use strict';

/**
 * Phase 19 — 자동발행 중지·forceAutoPublish 우회 (함수 실행 검증, 문자열 grep PASS 금지).
 */

const reviewService = require('../server/daily-issue-review-service');
const usRun = require('../server/daily-issue-us-run-service');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const usOps = require('../shared/daily-issue-us-ops-core');

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

function eligibleKrItem() {
  const attached = decisionCore.attachDecisionToItem(
    {
      id: 'halt_kr_eligible',
      status: 'READY_FOR_REVIEW',
      activityRegion: 'KR',
      title: '통계청 고용 통계 공식 발표',
      confirmedSummary: '통계청이 고용 통계를 공식 발표했다.',
      discussionPrompt: '평가?',
      claims: [
        {
          id: 'c1',
          text: '통계청이 고용 통계를 공식 발표했다.',
          classification: 'CONFIRMED_FACT',
          isCore: true,
        },
      ],
      sourceRefs: [
        {
          id: 's1',
          publisher: '통계청',
          originDomain: 'kostat.go.kr',
          url: 'https://kostat.go.kr/halt',
          publishedAt: '2026-08-04T01:00:00.000Z',
          sourceType: 'OFFICIAL',
        },
        {
          id: 's2',
          publisher: '연합뉴스',
          originDomain: 'www.yna.co.kr',
          url: 'https://www.yna.co.kr/halt',
          publishedAt: '2026-08-04T02:00:00.000Z',
          sourceType: 'NEWS',
        },
      ],
      qualityMeta: { ok: true, publicationStatus: 'READY', independentSourceCount: 2 },
      freshnessMeta: { ok: true, freshnessOk: true },
      duplicateMeta: { decision: 'NEW_ISSUE' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    { asOf: '2026-08-06T20:00:00.000Z' },
  );
  return attached.item;
}

function stubRepo(queueItems) {
  const items = queueItems || [];
  return {
    list: function () {
      return Promise.resolve({ ok: true, items: items.slice() });
    },
    getPublishedIssues: function () {
      return Promise.resolve({ ok: true, items: [] });
    },
    initialize: function () {
      return Promise.resolve({ ok: true });
    },
    insertReviewItems: function (rows) {
      return Promise.resolve({ ok: true, items: rows || [] });
    },
    getById: function (id) {
      const found = items.find(function (it) {
        return it.id === id;
      });
      return Promise.resolve(found ? { ok: true, item: found } : { ok: false, error: 'NOT_FOUND' });
    },
  };
}

async function main() {
  console.log('PHASE19_HALT_RUNTIME', 'default-off');

  check('KR morning auto default off', reviewService.isMorningAutoPublishEnabled({}) === false);
  check('US auto default off', usRun.isUsAutoPublishEnabled({}) === false);
  check('US scheduler default off', usOps.isSchedulerEnabled({}) === false);

  const envKrOn = { DAILY_ISSUE_MORNING_AUTO_PUBLISH: '1' };
  const envUsOn = { DAILY_ISSUE_US_SCHEDULER_ENABLED: '1', DAILY_ISSUE_US_AUTO_PUBLISH: '1' };

  check('KR-only on flag', reviewService.isMorningAutoPublishEnabled(envKrOn) === true);
  check('US-only on flag', usRun.isUsAutoPublishEnabled(envUsOn) === true);

  const offMorning = await Promise.resolve(
    reviewService.runMorningAutoPublish({
      asOf: '2026-08-06T20:05:00.000Z',
      force: true,
      ignoreMorningWindow: true,
      env: {},
      repositoryInstance: stubRepo([]),
    }),
  );
  check('both-off blocks KR auto publish', offMorning.reason === 'OPERATOR_APPROVAL_REQUIRED');
  check('both-off publishedIds empty', (offMorning.publishedIds || []).length === 0);

  const envKrOnly = Object.assign({}, envKrOn);
  const krOnlyAttempt = await Promise.resolve(
    reviewService.runMorningAutoPublish({
      asOf: '2026-08-06T20:05:00.000Z',
      force: true,
      ignoreMorningWindow: true,
      activityRegion: 'KR',
      env: envKrOnly,
      dryRun: true,
      repositoryInstance: stubRepo([eligibleKrItem()]),
    }),
  );
  check('KR-on dryRun can plan publish', (krOnlyAttempt.results || []).some(function (r) { return r.published; }));

  const usOffWhileKrOn = await usRun.runUsDailyIssueSlot({
    asOf: '2026-01-15T16:00:00.000Z',
    forceSlot: true,
    env: envKrOnly,
    skipNetwork: true,
    ingestRunner: async function () {
      return { ok: true, readyCandidates: [], candidates: [] };
    },
    repositoryInstance: stubRepo([]),
  });
  check('KR-on does not enable US publish', usOffWhileKrOn.reason === 'US_AUTO_PUBLISH_DISABLED' || usOffWhileKrOn.publishedCount === 0);

  const blockedApprove = reviewService.transitionItem('halt_x', 'APPROVED', {
    autoMorning: true,
    actorId: decisionCore.ACTOR_AUTO_MORNING,
    env: {},
    repositoryInstance: {
      getById: function () {
        return { ok: true, item: eligibleKrItem() };
      },
    },
  });
  check(
    'unauthorized autoMorning approve blocked',
    blockedApprove.ok === false && blockedApprove.error === 'OPERATOR_APPROVAL_REQUIRED',
  );

  const forceBypass = await Promise.resolve(
    reviewService.runMorningAutoPublish({
      asOf: '2026-08-06T20:05:00.000Z',
      forceAutoPublish: true,
      ignoreMorningWindow: true,
      dryRun: true,
      env: {},
      repositoryInstance: stubRepo([eligibleKrItem()]),
    }),
  );
  check('forceAutoPublish bypasses env off (dryRun)', forceBypass.skipped !== true && (forceBypass.results || []).length >= 0);

  const eligibleWhileOff = await Promise.resolve(
    reviewService.runMorningAutoPublish({
      asOf: '2026-08-06T20:05:00.000Z',
      force: true,
      ignoreMorningWindow: true,
      dryRun: true,
      env: {},
      repositoryInstance: stubRepo([eligibleKrItem()]),
    }),
  );
  check(
    'halt blocks eligible auto publish while off',
    (eligibleWhileOff.publishedIds || []).length === 0 && eligibleWhileOff.reason === 'OPERATOR_APPROVAL_REQUIRED',
  );

  const midEnv = {};
  check('runtime change off', reviewService.isMorningAutoPublishEnabled(midEnv) === false);
  midEnv.DAILY_ISSUE_MORNING_AUTO_PUBLISH = '1';
  check('runtime change on', reviewService.isMorningAutoPublishEnabled(midEnv) === true);
  delete midEnv.DAILY_ISSUE_MORNING_AUTO_PUBLISH;
  check('runtime change off again', reviewService.isMorningAutoPublishEnabled(midEnv) === false);

  if (failed) {
    console.log('PHASE19_HALT_VERDICT', 'FAIL');
    process.exit(1);
  }
  console.log('PHASE19_HALT_VERDICT', 'PASS');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
