#!/usr/bin/env node
'use strict';

/**
 * handle_new_user email-less OAuth migration 적용 (dev Supabase public schema)
 *
 * 필수:
 *   DAILY_ISSUE_DATABASE_URL (동일 Supabase Postgres pooler/direct URL)
 *   --confirm-dev-db
 *
 * 금지:
 *   운영 production NODE_ENV
 *   비밀번호·URL 원문 로그
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_handle_new_user_emailless_oauth.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function readFunctionBody(executor) {
  const r = await executor.query(
    "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'handle_new_user' LIMIT 1",
  );
  return r.rows && r.rows[0] ? String(r.rows[0].def || '') : '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });

  if (!url) {
    console.log(
      JSON.stringify({
        ok: false,
        skipped: true,
        error: 'DATABASE_UNAVAILABLE',
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
        message: 'Pass --confirm-dev-db to apply handle_new_user migration',
        maskedUrl: maskDatabaseUrl(url),
      }),
    );
    process.exit(1);
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  const sql = fs.readFileSync(MIGRATION, 'utf8');

  if (args.dryRun) {
    console.log(
      JSON.stringify({
        ok: true,
        dryRun: true,
        maskedUrl: maskDatabaseUrl(url),
        sqlBytes: Buffer.byteLength(sql),
      }),
    );
    return;
  }

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!executor.ok) {
    console.error(JSON.stringify({ ok: false, error: executor.error, message: executor.message }));
    process.exit(1);
  }

  try {
    const before = await readFunctionBody(executor);
    await executor.query(sql);
    const after = await readFunctionBody(executor);

    const hasEmptyDisplayDefault =
      after.includes("v_display := ''") || after.includes("v_display:=''");
    const noNicknameFallback = !after.includes("'nickname'");

    console.log(
      JSON.stringify({
        ok: true,
        applied: true,
        maskedUrl: maskDatabaseUrl(url),
        hadFunctionBefore: !!before,
        verified: hasEmptyDisplayDefault && noNicknameFallback,
      }),
    );

    if (!hasEmptyDisplayDefault || !noNicknameFallback) {
      process.exit(1);
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'TRANSACTION_FAILED',
        message: String(e.message || e),
        maskedUrl: maskDatabaseUrl(url),
      }),
    );
    process.exit(1);
  } finally {
    await executor.end();
  }
}

main();
