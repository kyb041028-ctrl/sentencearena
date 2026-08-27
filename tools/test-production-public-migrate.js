#!/usr/bin/env node
'use strict';

/**
 * Production public-schema migration gates — no real DB apply.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const core = require('../shared/production-public-migration-core');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

function baseEnv(extra) {
  return Object.assign(
    {
      NODE_ENV: 'production',
      DAILY_ISSUE_DATABASE_URL: 'postgresql://u:p@db.abcdef123456.supabase.co:5432/postgres',
      DAILY_ISSUE_DB_SCHEMA: 'daily_issue',
      PUBLIC_SCHEMA_CONFIRM_PRODUCTION_MIGRATION: core.CONFIRM_VALUE,
    },
    extra || {},
  );
}

ok('1. catalog dependency order', core.assertCatalogDependencies().length === 0);

const files = core.loadRequiredMigrations();
ok('2. REQUIRED 파일 수', files.length === core.REQUIRED.length);
ok(
  '3. 첫 파일 profiles identity',
  files[0].id === 'profiles_identity_history' && files[0].fileName === 'schema_profiles_identity_history.sql',
);
ok(
  '4. 마지막 파일 empathy fame revoke rpc',
  files[files.length - 1].id === 'empathy_received_fame_revoke_rpc',
);
ok(
  '5. central_start 가 handle_new_user / territory 이후',
  files.findIndex(function (f) { return f.id === 'canonical_territory_central_start'; }) >
    files.findIndex(function (f) { return f.id === 'canonical_user_territory'; }) &&
    files.findIndex(function (f) { return f.id === 'canonical_territory_central_start'; }) >
      files.findIndex(function (f) { return f.id === 'handle_new_user_emailless'; }),
);
ok(
  '6. beta_v1 이 persistence + board 이후',
  files.findIndex(function (f) { return f.id === 'political_alignment_beta_v1'; }) >
    files.findIndex(function (f) { return f.id === 'political_alignment_persistence'; }) &&
    files.findIndex(function (f) { return f.id === 'political_alignment_beta_v1'; }) >
      files.findIndex(function (f) { return f.id === 'board_core'; }),
);

const destructive = files.filter(function (m) {
  return m.scan.dropTable || m.scan.truncate || m.scan.dropSchema || m.scan.dropColumn;
});
ok('7. REQUIRED top-level DROP TABLE/TRUNCATE/DROP COLUMN 없음', destructive.length === 0);

ok(
  '8. alignment_system 은 DO_NOT_APPLY',
  core.DO_NOT_APPLY.some(function (e) { return e.fileName === 'migration_alignment_system.sql'; }),
);
ok(
  '9. user_data / drop_profiles DO_NOT_APPLY',
  core.DO_NOT_APPLY.some(function (e) { return e.fileName === 'migration_user_data_system.sql'; }) &&
    core.DO_NOT_APPLY.some(function (e) { return e.fileName === 'drop_profiles_identity_schema.sql'; }),
);

const classed = core.classifyAllFiles();
ok('10. Daily Issue 5건은 daily_issue schema REQUIRED', classed.dailyIssueRequired.length === 5);

const checkReport = core.buildPreflightReport({
  mode: 'check',
  env: { NODE_ENV: 'development' },
  requireConfirm: false,
  requireDatabaseUrl: false,
});
ok('11. check 는 URL 없이도 static ok', checkReport.ok === true && checkReport.connection === 'NOT_CONFIGURED');
ok('12. dry-run kind 는 SQL 미실행', checkReport.dryRunKind === 'STATIC_VALIDATION_NO_SQL_EXECUTE');
ok(
  '13. preflight JSON 비밀번호 없음',
  JSON.stringify(checkReport).indexOf('postgresql://') < 0,
);

const prodGates = core.evaluateProductionPublicMigrationGates({
  env: baseEnv(),
  requireConfirm: true,
  requireDatabaseUrl: true,
  requireNodeEnv: true,
  forbidLocalhost: true,
  refuseDailyIssueTestSchema: true,
});
ok('14. production apply 게이트 통과(mock env)', prodGates.ok === true);

ok(
  '15. confirm 없으면 apply 거부',
  !core.evaluateProductionPublicMigrationGates({
    env: baseEnv({ PUBLIC_SCHEMA_CONFIRM_PRODUCTION_MIGRATION: '' }),
    requireConfirm: true,
    requireDatabaseUrl: true,
    requireNodeEnv: true,
  }).ok,
);
ok(
  '16. localhost 거부',
  core.evaluateProductionPublicMigrationGates({
    env: baseEnv({ DAILY_ISSUE_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/postgres' }),
    requireConfirm: true,
    requireDatabaseUrl: true,
    requireNodeEnv: true,
    forbidLocalhost: true,
  }).errors.some(function (e) { return e.code === 'LOCALHOST_DB_FORBIDDEN'; }),
);
ok(
  '17. daily_issue_test schema 거부(apply)',
  core.evaluateProductionPublicMigrationGates({
    env: baseEnv({ DAILY_ISSUE_DB_SCHEMA: 'daily_issue_test' }),
    requireConfirm: true,
    requireDatabaseUrl: true,
    requireNodeEnv: true,
    refuseDailyIssueTestSchema: true,
  }).errors.some(function (e) { return e.code === 'DAILY_ISSUE_SCHEMA_NOT_PRODUCTION'; }),
);

const masked = core.maskHostRef('postgresql://user:super-secret@db.abcdef123456.supabase.co:5432/postgres');
ok('18. host 식별, secret 미포함', masked.projectRef === 'abcdef123456' && JSON.stringify(masked).indexOf('super-secret') < 0);

let applied = false;
let rolled = false;
const mockExec = {
  withTransaction: async function (cb) {
    const tx = {
      query: async function () {
        applied = true;
        throw new Error('INJECTED_FAIL');
      },
    };
    try {
      return await cb(tx);
    } catch (e) {
      rolled = true;
      throw e;
    }
  },
};
let applyFailed = false;
core.applyProductionPublicMigrations(mockExec, {}).then(
  function () {},
  function () {
    applyFailed = true;
  },
).then(function () {
  ok('19. mock apply 실패', applyFailed && applied && rolled);

  const cliPath = path.join(__dirname, 'run-production-public-migrate.js');
  const src = fs.readFileSync(cliPath, 'utf8');
  ok(
    '20. CLI apply 는 confirm+production 필요',
    /requireConfirm:\s*true/.test(src) && /requireNodeEnv:\s*true/.test(src),
  );
  ok('21. CLI에 reset 없음', !/--reset/.test(src) && !/\bTRUNCATE\b/.test(src));

  const spawned = spawnSync(process.execPath, [cliPath, 'check'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      NODE_ENV: 'development',
      PUBLIC_SCHEMA_CONFIRM_PRODUCTION_MIGRATION: '',
    }),
  });
  ok(
    '22. check CLI exit 0',
    spawned.status === 0,
  );
  if (spawned.status !== 0) {
    throw new Error('check CLI failed: ' + String(spawned.stderr || spawned.stdout || '').slice(0, 500));
  }
  const parsed = JSON.parse(spawned.stdout);
  ok('23. check wrote=false, SQL 미실행', parsed.wrote === false && parsed.applied === false);
  ok(
    '24. check 비밀번호 미출력',
    spawned.stdout.indexOf('super-secret') < 0 && !/postgresql:\/\/[^:]+:[^@]+@/.test(spawned.stdout),
  );
  ok('25. dryRunKind 명시', parsed.dryRunKind === 'STATIC_VALIDATION_NO_SQL_EXECUTE');

  const dry = spawnSync(process.execPath, [cliPath, 'dry-run'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NODE_ENV: 'development' }),
  });
  ok('26. dry-run CLI exit 0', dry.status === 0);
  const dryJson = JSON.parse(dry.stdout);
  ok('27. dry-run 미적용', dryJson.wrote === false && dryJson.applied === false);

  console.log('\nOK', passed);
}).catch(function (e) {
  console.error('FAIL unexpected', e);
  process.exit(1);
});
