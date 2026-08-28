#!/usr/bin/env node
'use strict';

/**
 * 운영 daily_issue migration 게이트·절차 단위 테스트
 * — 실제 운영 DB 미연결 · write 없음(인메모리 mock만)
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const core = require('../shared/daily-issue-production-migration-core');

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
      DAILY_ISSUE_DB_SCHEMA: 'daily_issue',
      DAILY_ISSUE_DATABASE_URL: 'postgresql://u:p@db.abcdef123456.supabase.co:5432/postgres',
      DAILY_ISSUE_CONFIRM_PRODUCTION_MIGRATION: core.CONFIRM_VALUE,
    },
    extra || {},
  );
}

// 1 schema=daily_issue 허용
ok(
  '1. schema=daily_issue 허용',
  core.validateProductionSchema('daily_issue').ok === true,
);

// 2 schema=daily_issue_test 거부
ok(
  '2. schema=daily_issue_test 거부',
  core.validateProductionSchema('daily_issue_test').code === 'SCHEMA_TEST_FORBIDDEN',
);

// 3 schema=public 거부
ok('3. schema=public 거부', core.validateProductionSchema('public').code === 'SCHEMA_PUBLIC_FORBIDDEN');

ok('3b. schema 빈 문자열 거부', core.validateProductionSchema('').code === 'SCHEMA_EMPTY');

// 4 confirm 없음 거부
{
  const g = core.evaluateProductionMigrationGates({
    env: baseEnv({ DAILY_ISSUE_CONFIRM_PRODUCTION_MIGRATION: '' }),
    requireConfirm: true,
  });
  ok('4. confirm 값 없음 거부', !g.ok && g.errors.some(function (e) {
    return e.code === 'CONFIRM_MISSING';
  }));
}

// 5 confirm 불일치 거부
{
  const g = core.evaluateProductionMigrationGates({
    env: baseEnv({ DAILY_ISSUE_CONFIRM_PRODUCTION_MIGRATION: 'YES' }),
    requireConfirm: true,
  });
  ok('5. confirm 값 불일치 거부', !g.ok && g.errors.some(function (e) {
    return e.code === 'CONFIRM_MISMATCH';
  }));
}

ok(
  '5b. NODE_ENV!=production 거부',
  core.validateNodeEnv({ NODE_ENV: 'development' }).code === 'NODE_ENV_NOT_PRODUCTION',
);

// 6 dry-run write 없음 — buildRewritten only
{
  const rewritten = core.buildRewrittenMigrations('daily_issue');
  ok('6. dry-run용 rewritten 6건', rewritten.length === 6);
  ok(
    '6b. rewritten schema prefix',
    rewritten.every(function (m) {
      return m.rewrittenSql.indexOf('daily_issue.daily_issue_') >= 0 &&
        !/\bpublic\.daily_issue_/.test(m.rewrittenSql);
    }),
  );
}

// 7 migration 순서 고정
{
  const files = core.loadMigrationFiles();
  ok(
    '7. migration 순서 고정',
    files[0].id === 'review_lifecycle' &&
      files[1].id === 'morning_scheduler' &&
      files[2].id === 'alignment_seed' &&
      files[3].id === 'comments' &&
      files[4].id === 'account_withdrawal' &&
      files[5].id === 'ops_workflow',
  );
  ok(
    '7b. MIGRATION_FILES order',
    core.MIGRATION_FILES[0].order === 1 &&
      core.MIGRATION_FILES[1].order === 2 &&
      core.MIGRATION_FILES[2].order === 3 &&
      core.MIGRATION_FILES[3].order === 4 &&
      core.MIGRATION_FILES[4].order === 5 &&
      core.MIGRATION_FILES[5].order === 6,
  );
}

// 8 transaction rollback
(async function () {
  let began = false;
  let rolledBack = false;
  let committed = false;
  let queries = [];
  const executor = {
    withTransaction: async function (cb) {
      began = true;
      const tx = {
        query: async function (sql) {
          queries.push(String(sql).slice(0, 80));
          if (queries.length >= 2) {
            const err = new Error('INJECTED_FAIL');
            err.code = 'INJECTED_FAIL';
            throw err;
          }
          return { rows: [] };
        },
      };
      try {
        const result = await cb(tx);
        committed = true;
        return result;
      } catch (e) {
        rolledBack = true;
        throw e;
      }
    },
  };

  let failed = false;
  try {
    await core.applyProductionMigrations(executor, {});
  } catch (e) {
    failed = e && e.message === 'INJECTED_FAIL';
  }
  ok('8. transaction 실패', failed === true);
  ok('8b. rollback 경로', began && rolledBack && !committed);

  // 9 idempotent 재실행 (mock succeeds twice)
  let applyCount = 0;
  const idempotentExecutor = {
    withTransaction: async function (cb) {
      applyCount += 1;
      const tx = {
        query: async function () {
          return { rows: [] };
        },
      };
      return cb(tx);
    },
  };
  const r1 = await core.applyProductionMigrations(idempotentExecutor, {});
  const r2 = await core.applyProductionMigrations(idempotentExecutor, {});
  ok('9. idempotent 재실행 mock', r1.ok && r2.ok && applyCount === 2);
  ok(
    '9b. 적용 순서 유지',
    r1.migrationOrder.join(',') === 'review_lifecycle,morning_scheduler,alignment_seed,comments,account_withdrawal,ops_workflow',
  );

  // 10 비밀값 미출력
  const report = core.buildPreflightReport({
    env: baseEnv(),
    mode: 'check',
    requireConfirm: true,
  });
  const dumped = JSON.stringify(report);
  ok('10. 비밀번호 미포함', dumped.indexOf(':p@') < 0 && dumped.indexOf('postgresql://u:p@') < 0);
  ok('10b. maskedUrl 사용', report.target.maskedUrl && report.target.maskedUrl.indexOf('[db]') >= 0);

  // 11 reset/truncate 기능 없음
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'daily-issue-production-migration-core.js'),
    'utf8',
  );
  const cli = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'run-daily-issue-production-migrate.js'),
    'utf8',
  );
  ok(
    '11. core에 reset/truncate API 없음',
    !/\bresetTestTables\b/.test(src) &&
      !/function\s+reset/.test(src) &&
      !/\.query\(\s*['"]TRUNCATE/.test(src) &&
      /DESTRUCTIVE_SQL_FORBIDDEN/.test(src),
  );
  ok(
    '11b. CLI에 reset/truncate 실행 경로 없음',
    !/--reset/.test(cli) &&
      !/\btruncate\s+table\b/i.test(cli) &&
      !/\bresetTestTables\b/.test(cli) &&
      /reset \/ truncate \/ cleanup/.test(cli),
  );

  // 12 checksum 검증
  const files = core.loadMigrationFiles();
  const raw0 = fs.readFileSync(files[0].absolutePath);
  const expect = crypto.createHash('sha256').update(raw0).digest('hex');
  ok('12. checksum 일치', files[0].checksumSha256 === expect);
  ok(
    '12b. preflight에 checksum',
    report.migrations.every(function (m) {
      return /^[a-f0-9]{64}$/.test(m.checksumSha256);
    }),
  );

  // 13 적용 후 구조 검증 summarize
  const summaryOk = core.summarizeInspection({
    tables: core.REQUIRED_TABLES.map(function (t) {
      return { table_name: t };
    }),
    indexes: core.REQUIRED_INDEX_HINTS.map(function (n) {
      return { indexname: n };
    }),
    foreignKeys: [{ constraint_name: 'fk1', table_name: 'daily_issue_evidences' }],
    rls: core.REQUIRED_TABLES.map(function (t) {
      return { table_name: t, rls_enabled: true };
    }),
  });
  ok('13. 구조 검증 ok', summaryOk.ok && summaryOk.hasSchedulerTable);

  const summaryBad = core.summarizeInspection({
    tables: [{ table_name: 'daily_issue_review_items' }],
    indexes: [],
    foreignKeys: [],
    rls: [],
  });
  ok('13b. 누락 시 실패', !summaryBad.ok && summaryBad.missingTables.length > 0);

  // rewrite refuses test schema
  let rewriteDenied = false;
  try {
    core.rewriteSchema('CREATE TABLE public.daily_issue_x(id text);', 'daily_issue_test');
  } catch (e) {
    rewriteDenied = e.code === 'REWRITE_REFUSED_SCHEMA';
  }
  ok('13c. rewrite test schema 거부', rewriteDenied);

  // gates success path
  const good = core.evaluateProductionMigrationGates({
    env: baseEnv(),
    requireConfirm: true,
  });
  ok('14. 정상 게이트 통과', good.ok === true);

  // 개발 migration 도구 회귀: 파일이 여전히 production 거부
  const devTool = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'apply-daily-issue-review-migration.js'),
    'utf8',
  );
  ok('14b. 개발 도구 PRODUCTION_REFUSED 유지', /PRODUCTION_REFUSED/.test(devTool));
  ok('14c. 개발 도구 --confirm-dev-db 유지', /--confirm-dev-db/.test(devTool));

  ok(
    '14d. localhost DB 거부',
    core.evaluateProductionMigrationGates({
      env: baseEnv({ DAILY_ISSUE_DATABASE_URL: 'postgresql://u:p@localhost:5432/postgres' }),
      requireConfirm: true,
    }).errors.some(function (e) {
      return e.code === 'LOCALHOST_DB_FORBIDDEN';
    }),
  );

  console.log('\nOK', passed);
})().catch(function (e) {
  console.error('FAIL unexpected', e);
  process.exit(1);
});
