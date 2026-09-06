#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const reviewService = require('../server/daily-issue-review-service');
const reviewCore = require('../shared/daily-issue-review-core');
const qualityCore = require('../shared/daily-issue-quality-core');
const freshnessCore = require('../shared/daily-issue-freshness-core');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');

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

const AS_OF = '2026-08-06T01:00:00.000Z';

function makeAutoEligibleItem(id) {
  const title = '통계청, 7월 고용 통계 공식 발표';
  const summary = '통계청이 7월 고용 통계를 공식 발표했다.';
  const sources = [
    {
      id: 's1',
      publisher: '통계청',
      originDomain: 'kostat.go.kr',
      title: '보도자료',
      url: 'https://kostat.go.kr/portal/korea/kor_nw/1/1/index.board',
      publishedAt: '2026-08-05T01:00:00.000Z',
      sourceType: 'OFFICIAL',
      documentType: 'PRESS_RELEASE',
    },
    {
      id: 's2',
      publisher: '연합뉴스',
      originDomain: 'www.yna.co.kr',
      title: '관련 기사',
      url: 'https://www.yna.co.kr/view/AKR20260805000000000',
      publishedAt: '2026-08-05T02:00:00.000Z',
      sourceType: 'NEWS',
      documentType: 'NEWS_REPORT',
    },
  ];
  const evidences = [
    { id: 'e1', sourceId: 's1', text: summary, quotedText: summary },
    { id: 'e2', sourceId: 's2', text: summary, quotedText: summary },
  ];
  const claims = [
    {
      id: 'c1',
      text: summary,
      classification: 'CONFIRMED_FACT',
      evidenceIds: ['e1', 'e2'],
      supportingSourceIds: ['s1', 's2'],
      isCore: true,
    },
  ];
  const built = qualityCore.buildDailyIssueCandidate({
    title: title,
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: sources,
    evidences: evidences,
    candidateClaims: claims,
    retrievedAt: AS_OF,
  });
  const gated = freshnessCore.applyFreshnessGateToCandidate(built, {
    asOf: AS_OF,
    category: 'korea-economy',
  });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      clusterId: 'cl_' + id,
      category: 'korea-economy',
      candidateId: id,
      contentSignature: 'sig_' + id,
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  const item = Object.assign({}, created.item, {
    id: id,
    expiresAt: '2099-01-01T00:00:00.000Z',
    lockVersion: 1,
  });
  return decisionCore.attachDecisionToItem(item, { asOf: AS_OF }).item;
}

async function main() {
  const prev = process.env.DAILY_ISSUE_MORNING_AUTO_PUBLISH;
  delete process.env.DAILY_ISSUE_MORNING_AUTO_PUBLISH;

  ok('flag default off', reviewService.isMorningAutoPublishEnabled() === false);
  const off = await reviewService.runMorningAutoPublish({ force: true, ignoreMorningWindow: true });
  ok('off → OPERATOR_APPROVAL_REQUIRED', off.reason === 'OPERATOR_APPROVAL_REQUIRED');

  process.env.DAILY_ISSUE_MORNING_AUTO_PUBLISH = '1';
  ok('flag on', reviewService.isMorningAutoPublishEnabled() === true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-autopub-'));
  const repo = createDailyIssueReviewRepository({ kind: 'json', reviewRoot: root });
  repo.initialize();
  const item = makeAutoEligibleItem('cand_auto_pub_1');
  ok('eligible AUTO', item.publicationDecision === decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE, item.publicationDecision);

  const ins = repo.insertReviewItems(
    [item],
    [{ entityId: item.id, fromStatus: null, toStatus: item.status, action: 'enqueue', actorId: 'system', timestamp: AS_OF }],
  );
  ok('enqueued', ins && ins.ok);

  const pub = await reviewService.runMorningAutoPublish({
    repositoryInstance: repo,
    asOf: AS_OF,
    force: true,
    ignoreMorningWindow: true,
  });
  ok('on → published', (pub.publishedIds || []).length >= 1, JSON.stringify(pub));

  const pub2 = await reviewService.runMorningAutoPublish({
    repositoryInstance: repo,
    asOf: AS_OF,
    force: true,
    ignoreMorningWindow: true,
  });
  ok('duplicate prevented', (pub2.publishedIds || []).length === 0, JSON.stringify(pub2));
  ok('public has item', ((repo.getPublishedIssues({}).items || []).length) >= 1);

  if (prev === undefined) delete process.env.DAILY_ISSUE_MORNING_AUTO_PUBLISH;
  else process.env.DAILY_ISSUE_MORNING_AUTO_PUBLISH = prev;

  console.log('\nresult', { passed: passed, failed: failed });
  process.exit(failed ? 1 : 0);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
