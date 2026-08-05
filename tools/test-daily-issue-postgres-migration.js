#!/usr/bin/env node
'use strict';

/**
 * Migration 정적 + (선택) 실 DB 적용 검증
 * DAILY_ISSUE_DATABASE_URL 없으면 real apply = SKIPPED
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const contract = require('../shared/daily-issue-review-repository-contract');
const { resolveDailyIssueDatabaseUrl, maskDatabaseUrl, isAllowedTestSchema } = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_daily_issue_review_lifecycle.sql');

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function skip(name, reason) {
  skipped += 1;
  console.log('SKIPPED', name, '—', reason);
}

const sql = fs.readFileSync(MIGRATION, 'utf8');
const body = sql.replace(/--[\s\S]*$/m, sql); // keep full for checks

ok('file exists', fs.existsSync(MIGRATION));
ok('document jsonb column', /document\s+jsonb/i.test(sql));
ok('lock_version', /lock_version\s+integer/i.test(sql));
ok('candidate_id version unique', /UNIQUE\s*\(\s*candidate_id\s*,\s*version\s*\)/i.test(sql));
ok('no DROP TABLE executable', !/^\s*DROP\s+TABLE\b/im.test(sql));
ok('no TRUNCATE executable', !/^\s*TRUNCATE\b/im.test(sql));
ok('RLS enable', /ENABLE ROW LEVEL SECURITY/i.test(sql));
ok('미적용 경고', /미적용|자동 적용하지 않/i.test(sql));

const url = resolveDailyIssueDatabaseUrl({});
if (!url) {
  skip('real migration apply', 'DAILY_ISSUE_DATABASE_URL missing');
  console.log(
    JSON.stringify({
      realMigrationApply: 'SKIPPED',
      reason: 'DAILY_ISSUE_DATABASE_URL missing',
    }),
  );
} else {
  const schema = String(process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test');
  if (!isAllowedTestSchema(schema) && schema !== 'public') {
    ok('schema gate', false, schema);
  } else if (String(process.env.DAILY_ISSUE_APPLY_MIGRATION_IN_TEST || '') !== '1') {
    skip(
      'real migration apply',
      'set DAILY_ISSUE_APPLY_MIGRATION_IN_TEST=1 to apply (schema=' + schema + ', ' + maskDatabaseUrl(url) + ')',
    );
  } else {
    const r = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'apply-daily-issue-review-migration.js'),
        '--confirm-dev-db',
        '--schema=' + schema,
      ],
      {
        env: process.env,
        encoding: 'utf8',
      },
    );
    ok('real migration apply exit 0', r.status === 0, (r.stdout || '') + (r.stderr || ''));
  }
}

console.log('\n=== postgres migration: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped ===');
process.exit(failed ? 1 : 0);
