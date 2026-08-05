#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 공개 API 테스트
 */

const { requestApp } = require('./daily-issue-api-http-helper');
const { makeReady, createTestApp, authHeaders, AS_OF } = require('./daily-issue-api-test-fixtures');
const reviewService = require('../server/daily-issue-review-service');
const lifecycle = require('../shared/daily-issue-lifecycle-core');

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

async function publishViaApi(app, repo, suffix) {
  const item = makeReady(suffix);
  repo.insertReviewItems([item], [], {});
  const ap = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
    headers: authHeaders(),
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'pub-test' },
  });
  if (!ap.body || !ap.body.ok) throw new Error('approve failed ' + JSON.stringify(ap.body));
  const lock = ap.body.data.item.lockVersion;
  const pb = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/publish', {
    headers: authHeaders(),
    body: { expectedStatus: 'APPROVED', expectedLockVersion: lock, reviewerId: 'pub-test' },
  });
  if (!pb.body || !pb.body.ok) throw new Error('publish failed ' + JSON.stringify(pb.body));
  return pb.body.data.item;
}

async function main() {
  console.log('\n=== daily-issue public API ===\n');
  const { app, repo } = createTestApp();

  const published = await publishViaApi(app, repo, 'pub_ok');

  // APPROVED only
  const approvedOnly = makeReady('approved_only');
  repo.insertReviewItems([approvedOnly], [], {});
  await reviewService.transitionItem(approvedOnly.id, lifecycle.REVIEW_STATUS.APPROVED, {
    repositoryInstance: repo,
    asOf: AS_OF,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: 1,
    reviewer: 'x',
  });

  // RETIRED
  const retired = await publishViaApi(app, repo, 'pub_ret');
  await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + retired.id + '/retire', {
    headers: authHeaders(),
    body: {
      expectedStatus: 'PUBLISHED',
      expectedLockVersion: retired.lockVersion,
      reasonCode: 'MANUAL_RETIRE',
      reasonText: 'bye',
    },
  });

  // EXPIRED queue item — not published
  const expired = makeReady('expired_q');
  expired.status = 'EXPIRED';
  repo.insertReviewItems([expired], [], {});

  // Expired publish window
  const expiredPub = await publishViaApi(app, repo, 'pub_exp');
  const found = repo.getById(expiredPub.id);
  found.item.publishExpiresAt = '2026-08-01T00:00:00.000Z';
  // force update in fake store
  repo.transitionReviewItem({
    id: expiredPub.id,
    expectedStatus: 'PUBLISHED',
    expectedLockVersion: found.item.lockVersion,
    nextItem: Object.assign({}, found.item, { publishExpiresAt: '2026-08-01T00:00:00.000Z' }),
    targetBucket: 'published',
    auditEvents: [],
  });

  const list = await requestApp(app, 'GET', '/api/daily-issues');
  ok('27. PUBLISHED만 목록', list.status === 200 && list.body.ok);
  const ids = (list.body.data.items || []).map(function (i) {
    return i.id;
  });
  ok('27b. published 포함', ids.indexOf(published.id) >= 0);
  ok('28. APPROVED 제외', ids.indexOf(approvedOnly.id) < 0);
  ok('29. RETIRED 제외', ids.indexOf(retired.id) < 0);
  ok('30. EXPIRED 제외', ids.indexOf(expired.id) < 0);
  ok('31. publishExpiresAt 경과 제외', ids.indexOf(expiredPub.id) < 0);

  const detail = await requestApp(app, 'GET', '/api/daily-issues/' + published.id);
  ok('32. 상세 공개 필드', detail.status === 200 && detail.body.data.item.title && detail.body.data.item.claims);
  ok('33. reviewerId 미노출', detail.raw.indexOf('reviewerId') < 0 && detail.raw.indexOf('pub-test') < 0);
  ok('34. audit 미노출', detail.raw.indexOf('audit') < 0 && detail.raw.indexOf('snapshotHash') < 0);
  ok('35. rawText 미노출', detail.raw.indexOf('rawText') < 0 && detail.raw.indexOf('SECRET_RAW') < 0);
  ok('36. choices/stance 없음', detail.raw.indexOf('choices') < 0 && detail.raw.indexOf('stance') < 0);

  const hidden = await requestApp(app, 'GET', '/api/daily-issues/' + approvedOnly.id);
  ok('미게시 상세 404', hidden.status === 404);

  const noAuthNeeded = await requestApp(app, 'GET', '/api/daily-issues');
  ok('공개 API 토큰 불필요', noAuthNeeded.status === 200);

  console.log('\nPublic API results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
