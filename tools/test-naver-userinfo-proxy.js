#!/usr/bin/env node
'use strict';

/**
 * Naver userinfo → Supabase { sub } normalization (unit).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  normalizeNaverUserinfo,
  fetchNormalizedNaverUserinfo,
  NAVER_PROFILE_URL,
} = require('../server/auth/naver-userinfo-proxy');

const sampleRaw = {
  resultcode: '00',
  message: 'success',
  response: {
    email: 'openapi@naver.com',
    nickname: 'OpenAPI',
    id: '32742776',
    name: '오픈 API',
  },
};

const ok = normalizeNaverUserinfo(sampleRaw);
assert.strictEqual(ok.ok, true, 'normalize ok');
assert.strictEqual(ok.body.sub, '32742776', 'sub from response.id');
assert.strictEqual(ok.body.email, 'openapi@naver.com', 'email mapped when present');
assert.ok(!Object.prototype.hasOwnProperty.call(ok.body, 'resultcode'), 'no nested envelope');
assert.ok(!Object.prototype.hasOwnProperty.call(ok.body, 'response'), 'no nested response');

const noEmail = normalizeNaverUserinfo({
  resultcode: '00',
  message: 'success',
  response: { id: '999', nickname: 'x' },
});
assert.strictEqual(noEmail.ok, true, 'email-less ok');
assert.strictEqual(noEmail.body.sub, '999', 'sub without email');
assert.ok(!Object.prototype.hasOwnProperty.call(noEmail.body, 'email'), 'email omitted when absent');

const missingId = normalizeNaverUserinfo({
  resultcode: '00',
  message: 'success',
  response: { nickname: 'x' },
});
assert.strictEqual(missingId.ok, false, 'missing id fails');

const topLevelIdOnly = normalizeNaverUserinfo({ id: 'should-not-use' });
assert.strictEqual(topLevelIdOnly.ok, false, 'top-level id without response rejected');

fetchNormalizedNaverUserinfo('Bearer test-token', function (url, opts) {
  assert.strictEqual(url, NAVER_PROFILE_URL, 'calls Naver profile URL');
  assert.ok(opts && opts.headers && /Bearer test-token/.test(opts.headers.Authorization), 'forwards bearer');
  return Promise.resolve({
    ok: true,
    status: 200,
    json: function () {
      return Promise.resolve(sampleRaw);
    },
  });
})
  .then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.body.sub, '32742776');

    const authJs = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');
    const kakao = fs.readFileSync(path.join(__dirname, '../server/auth/kakao-oauth-scopes.js'), 'utf8');
    assert.ok(/custom:naver/.test(authJs), 'naver wire kept');
    assert.ok(/provider: 'kakao'/.test(authJs), 'google/kakao login path kept');
    assert.ok(/KAKAO_OAUTH_SCOPES/.test(kakao), 'kakao scopes unchanged');
    assert.ok(
      fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').includes('/api/auth/naver-userinfo'),
      'server mounts naver-userinfo',
    );
    console.log('PASS naver userinfo proxy normalize');
  })
  .catch(function (e) {
    console.error('FAIL', e && e.message ? e.message : e);
    process.exit(1);
  });
