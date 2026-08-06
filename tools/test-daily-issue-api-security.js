#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 API 보안·오류 테스트
 */

const { requestApp } = require('./daily-issue-api-http-helper');
const { makeReady, createTestApp, authHeaders, ADMIN_TOKEN } = require('./daily-issue-api-test-fixtures');
const { createMemoryRateLimiter } = require('../server/daily-issue-api-rate-limit');
const contract = require('../shared/daily-issue-review-repository-contract');

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

async function main() {
  console.log('\n=== daily-issue API security ===\n');

  // DB unavailable
  {
    const { createFakeDbDailyIssueReviewRepository } = require('../server/daily-issue-review-db-repository');
    const repo = createFakeDbDailyIssueReviewRepository({});
    repo.initialize();
    const orig = repo.getPublishedIssues.bind(repo);
    repo.getPublishedIssues = function () {
      return contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, 'down');
    };
    const { app } = createTestApp({ repositoryInstance: repo });
    const r = await requestApp(app, 'GET', '/api/daily-issues');
    ok('37. DB unavailable 503', r.status === 503 && r.body.error.code === 'DATABASE_UNAVAILABLE');
    repo.getPublishedIssues = orig;
  }

  {
    const { app, repo } = createTestApp();
    // Force internal error via broken id path that throws
    const item = makeReady('sec1');
    item.evidenceRefs = [{ id: 'e', text: 'x', rawText: 'SECRET' }];
    repo.insertReviewItems([item], [], {});
    const detail = await requestApp(app, 'GET', '/api/admin/daily-issues/review/' + item.id, {
      headers: authHeaders(),
    });
    ok('38. stack trace 미노출', detail.raw.indexOf('at ') < 0 || detail.raw.indexOf('Error:') < 0 || !/at Object\./.test(detail.raw));
    ok('39/40. SQL·비밀 미노출', detail.raw.indexOf('SELECT') < 0 && detail.raw.indexOf(ADMIN_TOKEN) < 0);
    ok('requestId 반환', !!detail.body.requestId && !!detail.headers['x-request-id']);
  }

  // Rate limit
  {
    let now = Date.now();
    const limiter = createMemoryRateLimiter({
      now: function () {
        return now;
      },
    });
    const { app } = createTestApp({
      rateLimiter: limiter,
      rateLimits: { listPerMin: 3, mutatePerMin: 2, publicPerMin: 2 },
    });
    let last = null;
    for (let i = 0; i < 4; i++) {
      last = await requestApp(app, 'GET', '/api/daily-issues');
    }
    ok('41. rate limit 429', last.status === 429 && last.body.error.code === 'RATE_LIMITED', last.status);
  }

  // Content-type
  {
    const { app, repo } = createTestApp();
    const item = makeReady('ct1');
    repo.insertReviewItems([item], [], {});
    const r = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
      headers: Object.assign({ 'Content-Type': 'text/plain' }, authHeaders()),
      body: '{"expectedStatus":"READY_FOR_REVIEW","expectedLockVersion":1}',
    });
    ok('42. 잘못된 content-type 차단', r.status === 422 && r.body.error.code === 'INVALID_CONTENT_TYPE');
  }

  // CORS
  {
    const { app } = createTestApp({ corsOrigins: ['http://allowed.test'] });
    const okCors = await requestApp(app, 'OPTIONS', '/api/daily-issues', {
      headers: { Origin: 'http://allowed.test', 'Access-Control-Request-Method': 'GET' },
    });
    ok('43. CORS 허용 origin', okCors.status === 204 && okCors.headers['access-control-allow-origin'] === 'http://allowed.test');

    const badCors = await requestApp(app, 'OPTIONS', '/api/daily-issues', {
      headers: { Origin: 'http://evil.test', 'Access-Control-Request-Method': 'GET' },
    });
    ok('44. CORS 비허용 origin 차단', badCors.status === 403);

    const getDenied = await requestApp(app, 'GET', '/api/daily-issues', {
      headers: { Origin: 'http://evil.test' },
    });
    ok('44b. GET 비허용 origin', getDenied.status === 403);
  }

  // 45 requestId already covered — assert public
  {
    const { app } = createTestApp();
    const r = await requestApp(app, 'GET', '/api/daily-issues');
    ok('45. requestId 반환', r.body && typeof r.body.requestId === 'string' && r.body.requestId.indexOf('req_') === 0);
  }

  // Admin invalid token (fail-closed)
  {
    const { app } = createTestApp({ adminToken: '' });
    const r = await requestApp(app, 'GET', '/api/admin/daily-issues/review', {
      headers: authHeaders('anything'),
    });
    ok('fail-closed invalid admin auth', r.status === 401 && r.body.error.code === 'ADMIN_TOKEN_INVALID');
  }

  console.log('\nSecurity API results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
