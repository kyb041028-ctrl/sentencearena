#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 관리자 API 테스트 (주입 app, npm start 없음)
 */

const { requestApp } = require('./daily-issue-api-http-helper');
const {
  AS_OF,
  ADMIN_TOKEN,
  makeReady,
  createTestApp,
  authHeaders,
  createTestAdminAuthGuard,
} = require('./daily-issue-api-test-fixtures');
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

async function seedReady(repo, suffix) {
  const item = makeReady(suffix);
  const ins = repo.insertReviewItems([item], [], {});
  ok('seed ' + suffix, ins.ok, ins.error);
  return item;
}

async function main() {
  console.log('\n=== daily-issue admin API ===\n');

  // Auth
  {
    const { app } = createTestApp();
    const r1 = await requestApp(app, 'GET', '/api/admin/daily-issues/review');
    ok('1. 토큰 없음 401', r1.status === 401 && r1.body && r1.body.error.code === 'ADMIN_TOKEN_MISSING', r1.status);

    const r2 = await requestApp(app, 'GET', '/api/admin/daily-issues/review', {
      headers: authHeaders('wrong-token'),
    });
    ok('2. 잘못된 토큰 401', r2.status === 401 && r2.body.error.code === 'ADMIN_TOKEN_INVALID');

    const r3 = await requestApp(app, 'GET', '/api/admin/daily-issues/review', {
      headers: authHeaders(),
    });
    ok('3. 올바른 토큰 통과', r3.status === 200 && r3.body.ok === true);

    const r4 = await requestApp(app, 'GET', '/api/admin/daily-issues/review?token=' + ADMIN_TOKEN, {
      headers: authHeaders(),
    });
    ok('4. query token 거부', r4.status === 403 && r4.body.error.code === 'QUERY_TOKEN_FORBIDDEN');

    const deny = createTestAdminAuthGuard({ [ADMIN_TOKEN]: 'USER' });
    const appDeny = createTestApp({ adminAuthGuard: deny }).app;
    const rRole = await requestApp(appDeny, 'GET', '/api/admin/daily-issues/review', { headers: authHeaders() });
    ok('6. USER 권한 차단', rRole.status === 403 && rRole.body.error.code === 'ADMIN_ROLE_FORBIDDEN');
  }

  // Token not in logs
  {
    const logs = [];
    const orig = console.log;
    console.log = function () {
      logs.push(Array.prototype.slice.call(arguments).join(' '));
      return orig.apply(console, arguments);
    };
    const { app, repo } = createTestApp();
    await seedReady(repo, 'log1');
    await requestApp(app, 'GET', '/api/admin/daily-issues/review', { headers: authHeaders() });
    console.log = orig;
    const joined = logs.join('\n');
    ok('5. 토큰 로그 미노출', joined.indexOf(ADMIN_TOKEN) < 0, joined.slice(0, 200));
  }

  // List / detail
  {
    const { app, repo } = createTestApp();
    const a = await seedReady(repo, 'list_a');
    const b = makeReady('list_b', { category: 'society' });
    repo.insertReviewItems([b], [], {});

    const list = await requestApp(app, 'GET', '/api/admin/daily-issues/review', { headers: authHeaders() });
    ok('7. 검수 목록 조회', list.status === 200 && list.body.data.total >= 2);

    const filt = await requestApp(app, 'GET', '/api/admin/daily-issues/review?status=READY_FOR_REVIEW&category=society', {
      headers: authHeaders(),
    });
    ok(
      '8. status/category 필터',
      filt.status === 200 && filt.body.data.items.every(function (it) {
        return it.category === 'society' && it.status === 'READY_FOR_REVIEW';
      }),
    );

    const lim = await requestApp(app, 'GET', '/api/admin/daily-issues/review?limit=1000', { headers: authHeaders() });
    ok('9. limit 상한', lim.status === 200 && lim.body.data.limit <= 100);

    const detail = await requestApp(app, 'GET', '/api/admin/daily-issues/review/' + a.id, {
      headers: authHeaders(),
    });
    ok('10. 상세 조회', detail.status === 200 && detail.body.data.item.id === a.id);
    ok('12. rawText 미노출', detail.raw.indexOf('SECRET_RAW') < 0 && detail.raw.indexOf('rawText') < 0);
    ok(
      '13. 상세 필드',
      detail.body.data.item.lockVersion >= 1 &&
        Array.isArray(detail.body.data.item.allowedNextStatuses) &&
        detail.body.data.item.claims,
    );

    const miss = await requestApp(app, 'GET', '/api/admin/daily-issues/review/no_such_id', {
      headers: authHeaders(),
    });
    ok('11. 없는 id 404', miss.status === 404);
  }

  // Transitions
  {
    const { app, repo } = createTestApp();
    const item = await seedReady(repo, 'tr_ok');
    const id = item.id;

    const noStatus = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/approve', {
      headers: authHeaders(),
      body: { expectedLockVersion: 1 },
    });
    ok('19. expectedStatus 누락 400/422', noStatus.status === 422 || noStatus.status === 400);

    const noLock = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/approve', {
      headers: authHeaders(),
      body: { expectedStatus: 'READY_FOR_REVIEW' },
    });
    ok('20. expectedLockVersion 누락', noLock.status === 422 || noLock.status === 400);

    const approve = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/approve', {
      headers: authHeaders(),
      body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'dev-admin' },
    });
    ok('14. approve 정상', approve.status === 200 && approve.body.data.toStatus === 'APPROVED', JSON.stringify(approve.body));
    const lock2 = approve.body.data.item.lockVersion;

    const pub = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/publish', {
      headers: authHeaders(),
      body: { expectedStatus: 'APPROVED', expectedLockVersion: lock2, reviewerId: 'dev-admin' },
    });
    ok('17. publish 정상', pub.status === 200 && pub.body.data.toStatus === 'PUBLISHED' && pub.body.data.item.publishExpiresAt);
    ok('25. approve+publish 합쳐지지 않음', approve.body.data.toStatus === 'APPROVED' && pub.body.data.fromStatus === 'APPROVED');

    const lock3 = pub.body.data.item.lockVersion;
    const retire = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/retire', {
      headers: authHeaders(),
      body: {
        expectedStatus: 'PUBLISHED',
        expectedLockVersion: lock3,
        reasonCode: 'MANUAL_RETIRE',
        reasonText: 'test retire',
      },
    });
    ok('18. retire 정상', retire.status === 200 && retire.body.data.toStatus === 'RETIRED');
  }

  {
    const { app, repo } = createTestApp();
    const item = await seedReady(repo, 'hold_rj');
    const hold = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/hold', {
      headers: authHeaders(),
      body: {
        expectedStatus: 'READY_FOR_REVIEW',
        expectedLockVersion: 1,
        reasonCode: 'EVIDENCE_REVIEW_REQUIRED',
        reasonText: 'need look',
      },
    });
    ok('15. hold 정상', hold.status === 200 && hold.body.data.toStatus === 'HELD');

    const item2 = await seedReady(repo, 'rej1');
    const noReason = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item2.id + '/reject', {
      headers: authHeaders(),
      body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1 },
    });
    ok('23. reason 누락 422', noReason.status === 422);

    const rej = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item2.id + '/reject', {
      headers: authHeaders(),
      body: {
        expectedStatus: 'READY_FOR_REVIEW',
        expectedLockVersion: 1,
        reasonCode: 'WRONG_CLUSTER',
        reasonText: 'wrong',
      },
    });
    ok('16. reject 정상', rej.status === 200 && rej.body.data.toStatus === 'REJECTED');
  }

  {
    const { app, repo } = createTestApp();
    const item = await seedReady(repo, 'stale');
    await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
      headers: authHeaders(),
      body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'a' },
    });
    const stale = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
      headers: authHeaders(),
      body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'b' },
    });
    ok(
      '21. stale lockVersion 409',
      stale.status === 409 &&
        (stale.body.error.code === 'STALE_VERSION' ||
          stale.body.error.code === 'STATUS_CHANGED' ||
          stale.body.error.code === 'CONCURRENT_MODIFICATION'),
      JSON.stringify(stale.body),
    );

    const item3 = await seedReady(repo, 'badtr');
    const bad = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item3.id + '/publish', {
      headers: authHeaders(),
      body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1 },
    });
    ok('22. 잘못된 상태 전환 409', bad.status === 409 && bad.body.error.code === 'INVALID_STATE_TRANSITION');
  }

  {
    const { app, repo } = createTestApp();
    const badQ = makeReady('badq');
    badQ.qualityMeta = Object.assign({}, badQ.qualityMeta, { passed: false, failureReasons: ['X'] });
    // Force fail canApprove by emptying sources
    badQ.sourceRefs = [];
    repo.insertReviewItems([badQ], [], {});
    const blocked = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + badQ.id + '/approve', {
      headers: authHeaders(),
      body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'dev' },
    });
    ok('24. quality/freshness 실패 승인 차단', blocked.status === 422 && blocked.body.error.code === 'APPROVE_BLOCKED');
  }

  {
    const { app, repo } = createTestApp();
    const item = await seedReady(repo, 'conc');
    const [a, b] = await Promise.all([
      requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
        headers: authHeaders(),
        body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'r1' },
      }),
      requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
        headers: authHeaders(),
        body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'r2' },
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    ok(
      '26. 동시 approve 1승 1패',
      (a.status === 200) !== (b.status === 200) || (statuses[0] === 200 && statuses[1] === 409),
      JSON.stringify([a.status, b.status, a.body && a.body.error, b.body && b.body.error]),
    );
    // At least one success required for meaningful concurrency on sync fake-db
    ok('26b. 최소 1건 성공', a.status === 200 || b.status === 200);
  }

  {
    const { app, repo } = createTestApp();
    const item = await seedReady(repo, 'reval');
    const rv = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/revalidate', {
      headers: authHeaders(),
      body: {},
    });
    // revalidate may not require transition body — if 422 on content-type empty body with json parser ok
    ok('revalidate 응답', rv.status === 200 && rv.body.data.revalidation, JSON.stringify(rv.body));

    const hist = await requestApp(app, 'GET', '/api/admin/daily-issues/review/' + item.id + '/history', {
      headers: authHeaders(),
    });
    ok('history 조회', hist.status === 200 && Array.isArray(hist.body.data.events));
  }

  ok('lifecycle READY→PUBLISH still forbidden', !lifecycle.canTransition('READY_FOR_REVIEW', 'PUBLISHED'));

  console.log('\nAdmin API results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
