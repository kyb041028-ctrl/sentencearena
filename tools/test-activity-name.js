#!/usr/bin/env node
'use strict';

/**
 * 활동명 규칙 · 주사위 · Guest 분리 · API 보안 정적/유닛 테스트
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const ActivityNameCore = require('../shared/activity-name-core');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(opts) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: opts.path,
        method: opts.method || 'GET',
        headers: opts.headers || {},
      },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          let j = null;
          try {
            j = JSON.parse(d);
          } catch (_) {}
          resolve({ status: res.statusCode, body: d, json: j });
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const pass = [
  '가나다',
  '가나다123',
  'SentenceArena',
  'user_01',
  'user-01',
  '푸른_개척자',
  '새벽-논객',
];
const fail = [
  'a',
  'abcdefghijklmnopq',
  '푸른 개척자',
  'user!',
  'user@',
  'user#',
  'user$',
  'user%',
  'user&',
  'user*',
  'user.',
  'user,',
  'user?',
  'user/',
  'user\\',
  'user+',
  'user=',
];

pass.forEach(function (v) {
  assert(ActivityNameCore.validateActivityName(v).ok, 'PASS expected: ' + v);
});
fail.forEach(function (v) {
  const r = ActivityNameCore.validateActivityName(v);
  assert(!r.ok, 'FAIL expected: ' + v);
});
assert(
  ActivityNameCore.validateActivityName('푸른 개척자').error === ActivityNameCore.ERRORS.HAS_SPACE,
  'space error code',
);

const diceSet = {};
for (let i = 0; i < 40; i++) {
  const c = ActivityNameCore.generateActivityNameCandidate({ maxAttempts: 12 });
  assert(ActivityNameCore.validateActivityName(c).ok, 'dice valid: ' + c);
  diceSet[c] = true;
}
assert(Object.keys(diceSet).length >= 8, 'dice variety');

const root = path.join(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'public', 'app-entry.js'), 'utf8');
assert(entry.includes('needsActivityNameOnboarding'), 'app-entry shows activity name gate');
assert(entry.includes('ScActivityNameOnboarding'), 'app-entry uses onboarding');
assert(entry.includes('loadCurrentProfile'), 'app-entry loads profile');
assert(!entry.includes("goBoard('COMMON')"), 'no auto board');
assert(!entry.includes('setInterval'), 'no polling');
assert(!entry.includes('auth-ready'), 'no auth-ready handshake');

const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(serverJs.includes('createActivityNameRouter'), 'activity routes mounted');
assert(!/resolveKakaoOAuthRedirect[\s\S]*activity-name/.test(serverJs), 'oauth not mixed');

const boardSql = fs.readFileSync(path.join(root, 'supabase', 'migration_board_core_system.sql'), 'utf8');
assert(boardSql.includes('author_user_id uuid'), 'posts/comments author_user_id');
assert(!/board_posts[\s\S]{0,400}display_name/.test(boardSql), 'posts not owned by display_name');

const mig = fs.readFileSync(path.join(root, 'supabase', 'migration_activity_name_unique.sql'), 'utf8');
assert(mig.includes('profiles_display_name_ci_unique'), 'unique index migration');
assert(mig.includes('lower(display_name)'), 'case-insensitive');

const idx = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
assert(idx.includes('activity-name-onboarding.js'), 'onboarding script');
assert(idx.includes('activity-name-core.js'), 'core script');
assert(idx.includes('게스트로 둘러보기'), 'guest button kept');
assert(idx.includes('data-provider="google"'), 'google login button');
assert(idx.includes('data-provider="kakao"'), 'kakao login button');

(async function () {
  const unauthPut = await request({
    method: 'PUT',
    path: '/api/profile/me/display-name',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: '해커이름01' }),
  });
  assert(unauthPut.status === 401 || unauthPut.status === 503, 'A unauth put blocked');

  const unauthAvail = await request({
    path:
      '/api/profile/display-name/availability?value=' +
      encodeURIComponent('해커이름01'),
  });
  assert(unauthAvail.status === 401 || unauthAvail.status === 503, 'A unauth availability blocked');

  const invalid = await request({
    method: 'PUT',
    path: '/api/profile/me/display-name',
    headers: { 'Content-Type': 'application/json', Cookie: 'sb-x=fake' },
    body: JSON.stringify({ displayName: 'bad name!' }),
  });
  assert(invalid.status === 401 || invalid.status === 400, 'E/F invalid rejected without session or validated');

  const spacePut = await request({
    method: 'PUT',
    path: '/api/profile/me/display-name',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: '푸른 개척자' }),
  });
  assert(spacePut.status === 401 || spacePut.status === 400, 'space rejected');

  console.log('PASS activity-name rules + dice + security static/live');
})().catch(function (e) {
  console.error('FAIL', e.message);
  process.exit(1);
});
