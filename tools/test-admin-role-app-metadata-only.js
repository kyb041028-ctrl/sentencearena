#!/usr/bin/env node
'use strict';

/**
 * 관리자 역할: app_metadata.role 만 신뢰 (user_metadata 권한상승 차단)
 */

const assert = require('assert');
const { resolveUserRole, readAllowedRoles, createAdminAccessGuard } = require('../server/daily-issue-admin-auth');

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

function expectRole(label, user, expected) {
  const got = resolveUserRole(user);
  ok(label, got === expected, 'got=' + got + ' expected=' + expected);
}

async function runGuardCases() {
  const calls = [];
  const fakeGetUser = async function () {
    const next = calls.shift();
    return next;
  };

  // Patch createClient path via injecting guard with broken URL would hit real network.
  // Unit-test resolveUserRole + allowedRoles gate semantics instead; middleware uses resolveUserRole.
  const allowed = readAllowedRoles({ allowedRoles: ['ADMIN', 'OWNER'] });

  function gate(user) {
    const role = resolveUserRole(user);
    if (!role) return 'ADMIN_ROLE_MISSING';
    if (allowed.indexOf(role) < 0) return 'ADMIN_ROLE_FORBIDDEN';
    return 'ALLOW';
  }

  ok(
    '1. app 없음 + user ADMIN → 거부',
    gate({ app_metadata: {}, user_metadata: { role: 'ADMIN' } }) === 'ADMIN_ROLE_MISSING'
  );
  ok(
    '2. app 없음 + user OWNER → 거부',
    gate({ app_metadata: {}, user_metadata: { role: 'OWNER' } }) === 'ADMIN_ROLE_MISSING'
  );
  ok(
    '3. app MEMBER + user ADMIN → 거부',
    gate({ app_metadata: { role: 'MEMBER' }, user_metadata: { role: 'ADMIN' } }) === 'ADMIN_ROLE_FORBIDDEN'
  );
  ok(
    '4. app ADMIN + user 없음 → 허용',
    gate({ app_metadata: { role: 'ADMIN' }, user_metadata: {} }) === 'ALLOW'
  );
  ok(
    '5. app OWNER + user MEMBER → 허용',
    gate({ app_metadata: { role: 'OWNER' }, user_metadata: { role: 'MEMBER' } }) === 'ALLOW'
  );
  ok('6. role 없음 → 거부', gate({ app_metadata: {}, user_metadata: {} }) === 'ADMIN_ROLE_MISSING');
  ok('7. user만 admin_role → 거부', gate({ user_metadata: { admin_role: 'ADMIN' } }) === 'ADMIN_ROLE_MISSING');
  ok(
    '8. app.admin_role만 (role 없음) → 거부',
    gate({ app_metadata: { admin_role: 'ADMIN' }, user_metadata: {} }) === 'ADMIN_ROLE_MISSING'
  );
  ok(
    '9. app.role=admin 소문자 → ADMIN 정규화 후 허용',
    gate({ app_metadata: { role: 'admin' } }) === 'ALLOW'
  );
  ok(
    '10. app.role=administrator → 거부',
    gate({ app_metadata: { role: 'administrator' } }) === 'ADMIN_ROLE_FORBIDDEN'
  );
  ok(
    '11. top-level user.role 무시',
    gate({ role: 'ADMIN', app_metadata: {}, user_metadata: {} }) === 'ADMIN_ROLE_MISSING'
  );

  void fakeGetUser;
  void createAdminAccessGuard;
}

function main() {
  console.log('\n=== admin role app_metadata only ===\n');

  expectRole('resolve empty', {}, '');
  expectRole('resolve app ADMIN', { app_metadata: { role: 'ADMIN' } }, 'ADMIN');
  expectRole('resolve app OWNER', { app_metadata: { role: 'OWNER' } }, 'OWNER');
  expectRole(
    'resolve ignore user_metadata ADMIN',
    { app_metadata: {}, user_metadata: { role: 'ADMIN' } },
    ''
  );
  expectRole(
    'resolve ignore user when app set',
    { app_metadata: { role: 'OWNER' }, user_metadata: { role: 'ADMIN' } },
    'OWNER'
  );

  return runGuardCases().then(function () {
    console.log('\nAdmin role security results:', passed, 'passed,', failed, 'failed');
    assert.strictEqual(failed, 0);
    process.exit(failed ? 1 : 0);
  });
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
