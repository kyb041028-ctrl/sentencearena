#!/usr/bin/env node
'use strict';

/**
 * 아침판 스케줄러 테이블 migration 적용 (개발 DB 전용)
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db 필수
 * 기본 schema: daily_issue_test (운영 public 금지 권장)
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  resolveSchemaName,
  isAllowedTestSchema,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_daily_issue_morning_scheduler.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--schema=')) out.schema = a.slice(9);
  });
  return out;
}

function rewriteSchema(sql, schema) {
  if (!schema || schema === 'public') return sql;
  return sql.replace(/\bpublic\.(daily_issue_[a-z0-9_]+)/gi, schema + '.$1');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirm) {
    console.error('Refused: pass --confirm-dev-db');
    process.exit(1);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }
  const url = resolveDailyIssueDatabaseUrl({});
  if (!url) {
    console.error(JSON.stringify({ ok: false, error: 'DAILY_ISSUE_DATABASE_URL missing' }));
    process.exit(1);
  }
  const schema = args.schema || resolveSchemaName({}) || 'daily_issue_test';
  if (schema === 'public') {
    console.error(JSON.stringify({ ok: false, error: 'REFUSE_PUBLIC_SCHEMA', message: 'use daily_issue_test' }));
    process.exit(1);
  }
  if (!isAllowedTestSchema(schema)) {
    console.error(JSON.stringify({ ok: false, error: 'SCHEMA_NOT_ALLOWED', schema: schema }));
    process.exit(1);
  }

  let sql = fs.readFileSync(MIGRATION, 'utf8');
  sql = rewriteSchema(sql, schema);
  console.log('apply morning scheduler migration', maskDatabaseUrl(url), 'schema=' + schema);
  if (args.dryRun) {
    console.log(sql.slice(0, 400) + '...');
    process.exit(0);
  }

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: schema });
  if (!executor.ok) {
    console.error(JSON.stringify({ ok: false, error: executor.error || 'EXECUTOR' }));
    process.exit(1);
  }
  await executor.query('CREATE SCHEMA IF NOT EXISTS "' + schema.replace(/"/g, '') + '"');
  await executor.query(sql);
  await executor.end();
  console.log(JSON.stringify({ ok: true, schema: schema }));
}

main().catch(function (e) {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
