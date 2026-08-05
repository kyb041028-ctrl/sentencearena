#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 review lifecycle migration 적용 (개발 DB 전용)
 *
 * 필수:
 *   DAILY_ISSUE_DATABASE_URL
 *   --confirm-dev-db
 *
 * 선택:
 *   DAILY_ISSUE_DB_SCHEMA (기본 public)
 *   --schema=daily_issue_test
 *
 * 금지:
 *   운영 DATABASE_URL 자동 사용
 *   비밀번호 로그 출력
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
const contract = require('../shared/daily-issue-review-repository-contract');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_daily_issue_review_lifecycle.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false, reset: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--reset-test-tables') out.reset = true;
    else if (a.startsWith('--schema=')) out.schema = a.slice(9);
  });
  return out;
}

function rewriteSchema(sql, schema) {
  if (!schema || schema === 'public') return sql;
  // Only rewrite public.daily_issue_* identifiers
  return sql.replace(/\bpublic\.(daily_issue_[a-z0-9_]+)/gi, schema + '.$1');
}

function stripRollbackComments(sql) {
  // Keep DROP only inside comments — already the case; strip nothing critical
  return sql;
}

async function resetTestTables(executor, schema) {
  if (process.env.NODE_ENV !== 'test' && String(process.env.DAILY_ISSUE_ALLOW_TEST_RESET || '') !== '1') {
    throw new Error('reset requires NODE_ENV=test or DAILY_ISSUE_ALLOW_TEST_RESET=1');
  }
  if (!isAllowedTestSchema(schema)) {
    throw new Error('reset refused: schema must match daily_issue_test|daily_issue_dev');
  }
  const tables = [
    'daily_issue_claim_sources',
    'daily_issue_claim_evidences',
    'daily_issue_review_item_claims',
    'daily_issue_review_item_evidences',
    'daily_issue_review_item_sources',
    'daily_issue_updates',
    'daily_issue_audit_logs',
    'daily_issue_claims',
    'daily_issue_evidences',
    'daily_issue_sources',
    'daily_issue_review_items',
    'daily_issue_repository_meta',
  ];
  for (let i = 0; i < tables.length; i++) {
    await executor.query('TRUNCATE TABLE "' + schema + '"."' + tables[i] + '" CASCADE');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const schema = resolveSchemaName({ schemaName: args.schema || process.env.DAILY_ISSUE_DB_SCHEMA });

  if (!url) {
    console.log(
      JSON.stringify({
        ok: false,
        skipped: true,
        error: contract.ERROR_CODES.DATABASE_UNAVAILABLE,
        message: 'DAILY_ISSUE_DATABASE_URL missing — migration not applied',
      }),
    );
    process.exit(2);
  }

  if (!args.confirm) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'CONFIRM_REQUIRED',
        message: 'Pass --confirm-dev-db to apply migration to development DB',
        schema: schema,
        maskedUrl: maskDatabaseUrl(url),
      }),
    );
    process.exit(1);
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  let sql = fs.readFileSync(MIGRATION, 'utf8');
  sql = rewriteSchema(stripRollbackComments(sql), schema);

  if (args.dryRun) {
    console.log(
      JSON.stringify({
        ok: true,
        dryRun: true,
        schema: schema,
        maskedUrl: maskDatabaseUrl(url),
        sqlBytes: Buffer.byteLength(sql),
      }),
    );
    return;
  }

  const executor = createDailyIssuePgExecutor({
    databaseUrl: url,
    schemaName: schema,
  });
  if (!executor.ok) {
    console.error(JSON.stringify({ ok: false, error: executor.error, message: executor.message }));
    process.exit(1);
  }

  try {
    if (schema !== 'public') {
      await executor.query('CREATE SCHEMA IF NOT EXISTS "' + schema.replace(/"/g, '') + '"');
    }
    await executor.query(sql);
    if (args.reset) {
      await resetTestTables(executor, schema);
    }
    console.log(
      JSON.stringify({
        ok: true,
        applied: true,
        schema: schema,
        maskedUrl: maskDatabaseUrl(url),
        reset: !!args.reset,
      }),
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        ok: false,
        error: contract.ERROR_CODES.TRANSACTION_FAILED,
        message: String(e.message || e),
        schema: schema,
        maskedUrl: maskDatabaseUrl(url),
      }),
    );
    process.exit(1);
  } finally {
    await executor.end();
  }
}

main();
