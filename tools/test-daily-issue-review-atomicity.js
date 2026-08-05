#!/usr/bin/env node
'use strict';

/**
 * 검수 상태 저장 ↔ 감사 로그 원자성 (B방식) 테스트
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewService = require('../server/daily-issue-review-service');

const AS_OF = '2026-08-05T12:00:00.000Z';
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

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-atomic-' + (label || 't') + '-'));
}

function makeReady(id) {
  const s1 = {
    id: 's1',
    publisher: 'BBC',
    title: 't',
    url: 'https://bbc.example.com/' + id,
    publishedAt: '2026-08-04T10:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'bbc.example.com',
    contentHash: 'h1_' + id,
  };
  const s2 = {
    id: 's2',
    publisher: 'Guardian',
    title: 't',
    url: 'https://guardian.example.com/' + id,
    publishedAt: '2026-08-04T12:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'guardian.example.com',
    contentHash: 'h2_' + id,
  };
  const text = 'Officials announced a new decision on border crisis after the crossing event occurred.';
  const evidences = [
    { id: 'ev1', sourceId: 's1', text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: 'ev2', sourceId: 's2', text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = quality.buildDailyIssueCandidate({
    title: 'EU responds to border crossing crisis ' + id,
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: 'c1',
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['ev1', 'ev2'],
        supportingSourceIds: ['s1', 's2'],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  return Object.assign({}, gated, {
    clusterId: 'cl_' + id,
    category: 'world',
    candidateId: 'cand_' + id,
  });
}

function readStatus(root, name) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function historyCount(root) {
  const p = path.join(root, 'review-history.jsonl');
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, 'utf8').split(/\n/).filter(Boolean).length;
}

function snapshotFingerprint(root) {
  return {
    queue: readStatus(root, 'review-queue.json'),
    published: readStatus(root, 'published.json'),
    rejected: readStatus(root, 'rejected.json'),
    retired: readStatus(root, 'retired.json'),
    manifest: readStatus(root, 'review-manifest.json'),
    history: historyCount(root),
  };
}

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function seedApproved(root, id) {
  reviewService.clearTestHooks();
  const ready = makeReady(id);
  reviewService.enqueueCandidates([ready], { reviewRoot: root, asOf: AS_OF });
  return reviewService.transitionItem('cand_' + id, 'APPROVED', {
    reviewRoot: root,
    asOf: AS_OF,
    reviewer: 'admin',
  });
}

// 1. 상태 저장 성공 + 로그 성공
{
  const root = tmpRoot('ok');
  reviewService.clearTestHooks();
  const ready = makeReady('ok1');
  const enq = reviewService.enqueueCandidates([ready], { reviewRoot: root, asOf: AS_OF });
  const appr = reviewService.transitionItem('cand_ok1', 'APPROVED', {
    reviewRoot: root,
    asOf: AS_OF,
    reviewer: 'a',
  });
  ok('1. 상태+로그 성공 전환', enq.ok && appr.ok && appr.item.status === 'APPROVED');
  ok('1b. history 증가', historyCount(root) >= 2);
  const man = readStatus(root, 'review-manifest.json');
  const q = readStatus(root, 'review-queue.json');
  ok('9. manifest 일관성(queue)', man && man.queueCount === (q.items || []).length);
}

// 2. 상태 저장 실패 → 상태·로그 모두 변화 없음
{
  const root = tmpRoot('persistfail');
  reviewService.clearTestHooks();
  seedApproved(root, 'pf1');
  const before = snapshotFingerprint(root);
  reviewService.setTestHooks({ failPersist: true });
  const res = reviewService.transitionItem('cand_pf1', 'PUBLISHED', {
    reviewRoot: root,
    asOf: AS_OF,
    reviewer: 'a',
  });
  reviewService.clearTestHooks();
  const after = snapshotFingerprint(root);
  ok('2. persist 실패 시 CLI 실패', !res.ok && res.error === 'PERSIST_FAILED');
  ok('2b. 상태·로그 무변화', deepEq(before, after), JSON.stringify({ before, after, res }));
}

// 3/4. 상태 저장 성공 + 로그 실패 → 상태 원복
{
  const root = tmpRoot('logfail');
  reviewService.clearTestHooks();
  seedApproved(root, 'lf1');
  const before = snapshotFingerprint(root);
  reviewService.setTestHooks({ failAppend: true });
  const res = reviewService.transitionItem('cand_lf1', 'PUBLISHED', {
    reviewRoot: root,
    asOf: AS_OF,
    reviewer: 'a',
  });
  reviewService.clearTestHooks();
  const after = snapshotFingerprint(root);
  ok('3. 로그 실패 시 실패 반환', !res.ok && res.error === 'HISTORY_APPEND_FAILED');
  ok('4. 로그 실패 + rollback 성공 → 이전 상태 유지', res.rolledBack === true && deepEq(before, after));
  const stillApproved = reviewService.showItem('cand_lf1', { reviewRoot: root });
  ok('4b. 항목 상태 APPROVED 유지', stillApproved.ok && stillApproved.item.status === 'APPROVED');
  ok('10-ish 감사 로그 없는 상태 변경 없음', before.history === after.history);
}

// 5. 로그 실패 + rollback 실패 → fatal
{
  const root = tmpRoot('fatal');
  reviewService.clearTestHooks();
  seedApproved(root, 'ft1');
  reviewService.setTestHooks({ failAppend: true, failRollback: true });
  const res = reviewService.transitionItem('cand_ft1', 'PUBLISHED', {
    reviewRoot: root,
    asOf: AS_OF,
    reviewer: 'a',
  });
  reviewService.clearTestHooks();
  ok('5. rollback 실패 → FATAL_ROLLBACK_FAILED', !res.ok && res.error === 'FATAL_ROLLBACK_FAILED');
}

// 6. published.json 전환에서도 동일 보장
{
  const root = tmpRoot('pub');
  reviewService.clearTestHooks();
  seedApproved(root, 'pub1');
  // first publish succeeds
  const pub = reviewService.transitionItem('cand_pub1', 'PUBLISHED', {
    reviewRoot: root,
    asOf: AS_OF,
    reviewer: 'a',
  });
  ok('6a. publish 성공', pub.ok && pub.item.status === 'PUBLISHED');
  const before = snapshotFingerprint(root);
  reviewService.setTestHooks({ failAppend: true });
  const ret = reviewService.transitionItem('cand_pub1', 'RETIRED', {
    reviewRoot: root,
    asOf: AS_OF,
    reason: 'MANUAL_RETIRE',
  });
  reviewService.clearTestHooks();
  const after = snapshotFingerprint(root);
  ok('6. published→retired 로그 실패 시 원복', !ret.ok && ret.rolledBack && deepEq(before, after));
  ok('6b. 여전히 PUBLISHED', reviewService.showItem('cand_pub1', { reviewRoot: root }).item.status === 'PUBLISHED');
}

// 7. rejected.json 이동
{
  const root = tmpRoot('rej');
  reviewService.clearTestHooks();
  const ready = makeReady('rj1');
  reviewService.enqueueCandidates([ready], { reviewRoot: root, asOf: AS_OF });
  const before = snapshotFingerprint(root);
  reviewService.setTestHooks({ failAppend: true });
  const rej = reviewService.transitionItem('cand_rj1', 'REJECTED', {
    reviewRoot: root,
    asOf: AS_OF,
    reason: 'MISLEADING_TITLE',
  });
  reviewService.clearTestHooks();
  const after = snapshotFingerprint(root);
  ok('7. reject 로그 실패 시 원복', !rej.ok && rej.rolledBack && deepEq(before, after));
  ok('7b. queue에 잔류', reviewService.showItem('cand_rj1', { reviewRoot: root }).item.status === 'READY_FOR_REVIEW');
}

// 8. retired — covered by 6

// 9. manifest 일관성 after successful publish
{
  const root = tmpRoot('man');
  reviewService.clearTestHooks();
  seedApproved(root, 'mn1');
  reviewService.transitionItem('cand_mn1', 'PUBLISHED', { reviewRoot: root, asOf: AS_OF, reviewer: 'a' });
  const man = readStatus(root, 'review-manifest.json');
  const pub = readStatus(root, 'published.json');
  const q = readStatus(root, 'review-queue.json');
  ok(
    '9b. manifest published/queue 카운트',
    man.publishedCount === (pub.items || []).length && man.queueCount === (q.items || []).length,
  );
}

// 10. dry-run 무변경
{
  const root = tmpRoot('dry');
  reviewService.clearTestHooks();
  seedApproved(root, 'dry1');
  const before = snapshotFingerprint(root);
  const dry = reviewService.transitionItem('cand_dry1', 'PUBLISHED', {
    reviewRoot: root,
    asOf: AS_OF,
    reviewer: 'a',
    dryRun: true,
  });
  const after = snapshotFingerprint(root);
  ok('10. dry-run 성공 보고 + 무변경', dry.ok && dry.dryRun && deepEq(before, after));
}

reviewService.clearTestHooks();
console.log('\n=== atomicity tests:', passed, 'passed,', failed, 'failed ===');
process.exit(failed ? 1 : 0);
