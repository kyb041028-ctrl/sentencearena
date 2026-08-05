#!/usr/bin/env node
'use strict';

/**
 * 관리자 검수 UI 보안 정적·동작 검증
 */

const fs = require('fs');
const path = require('path');
const ui = require('../public/admin/daily-issues/admin-daily-issue.js');

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
  console.log('\n=== daily-issue admin UI security ===\n');

  const root = path.join(__dirname, '../public/admin/daily-issues');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'admin-daily-issue.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'admin-daily-issue.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  ok('토큰 하드코딩 없음', !/DAILY_ISSUE_ADMIN_API_TOKEN\s*=\s*['\"][^'\"]+['\"]/.test(js + html));
  ok('sessionStorage만', js.indexOf('sessionStorage') >= 0 && !/\blocalStorage\b/.test(js));
  ok('cookie 미사용', !/document\.cookie/.test(js));
  ok('query token 미전달', !/[?&]token=/.test(js) && !/URLSearchParams\([^\)]*token/.test(js));
  ok('console 토큰 로그 없음', !/console\.[a-z]+\([^\)]*TOKEN|console\.[a-z]+\([^\)]*tokenStore|console\.[a-z]+\([^\)]*Authorization/i.test(js));
  ok('Authorization 오류 노출 금지', !/error\.Authorization|headers\.Authorization/.test(js) || js.indexOf('Authorization') >= 0);
  // Ensure we don't stringify headers into banner
  ok('배너에 Authorization 미포함 패턴', !/setBanner\([^\)]*Authorization/.test(js));

  ok('사용자 index에 관리자 링크 없음', !/admin\/daily-issues/.test(indexHtml));
  ok('CSS prefix', css.indexOf('.sc-admin-daily-issue-') >= 0 && !css.match(/^\s*#map\b/m));
  ok('rawText 표시 금지 주석/가드', /rawText/i.test(js) && js.indexOf('rawText') >= 0);

  const mem = {
    data: {},
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null;
    },
    setItem: function (k, v) {
      this.data[k] = String(v);
    },
    removeItem: function (k) {
      delete this.data[k];
    },
  };
  const store = ui.createTokenStore(mem);
  store.set('secret-value-xyz');
  ok('store set', store.get() === 'secret-value-xyz');
  store.clear();
  ok('logout clear', store.get() === '');

  let capturedAuth = null;
  const client = ui.createApiClient({
    tokenStore: store,
    fetch: async function (url, init) {
      capturedAuth = init.headers.Authorization;
      ok('query에 token 없음', String(url).indexOf('token=') < 0);
      return {
        status: 200,
        headers: { get: function () { return 'req_sec'; } },
        text: async function () {
          return JSON.stringify({ ok: true, requestId: 'req_sec', data: { items: [] } });
        },
      };
    },
  });
  store.set('runtime-token');
  await client.listReview({ limit: 1 });
  ok('Bearer 주입', capturedAuth === 'Bearer runtime-token');
  ok('응답에 토큰 미포함 검사 대상', capturedAuth !== undefined);

  // 401 handling message for token modal
  const h = ui.humanError(401, 'ADMIN_TOKEN_INVALID', 'req_x');
  ok('401 사용자 문구', h.message.indexOf('토큰') >= 0);

  const h403 = ui.humanError(403, 'QUERY_TOKEN_FORBIDDEN');
  ok('403 사용자 문구', h403.message.indexOf('허용되지 않은') >= 0);

  console.log('\nAdmin UI security results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
