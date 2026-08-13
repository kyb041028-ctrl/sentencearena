#!/usr/bin/env node
'use strict';

/**
 * 게시판 코어 스키마 적용 (board_posts 등) — first-post canonical 저장용
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db 필수
 * Additive only — DROP TABLE / TRUNCATE / bulk delete 없음
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_board_core_system.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });

  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (!args.confirm) {
    console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', maskedUrl: maskDatabaseUrl(url) }));
    process.exit(1);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  const sql = fs.readFileSync(MIGRATION, 'utf8');
  if (/TRUNCATE|DROP TABLE|DELETE FROM/i.test(sql) && !/DROP POLICY IF EXISTS/.test(sql)) {
    /* DROP POLICY is expected; DROP TABLE is not */
  }
  if (/\bDROP TABLE\b/i.test(sql) || /\bTRUNCATE\b/i.test(sql)) {
    console.error(JSON.stringify({ ok: false, error: 'UNSAFE_MIGRATION' }));
    process.exit(1);
  }
  if (args.dryRun) {
    console.log(
      JSON.stringify({
        ok: true,
        dryRun: true,
        maskedUrl: maskDatabaseUrl(url),
        sqlBytes: Buffer.byteLength(sql),
        hasBoardPosts: /CREATE TABLE IF NOT EXISTS public\.board_posts/.test(sql),
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
    await executor.query(sql);
    try {
      await executor.query("NOTIFY pgrst, 'reload schema'");
    } catch (_) {}
    const tables = await executor.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('board_posts','board_comments','board_reactions','board_reports') ORDER BY tablename",
    );
    const names = (tables.rows || []).map(function (r) {
      return r.tablename;
    });
    console.log(
      JSON.stringify({
        ok: true,
        applied: true,
        maskedUrl: maskDatabaseUrl(url),
        tables: names,
      }),
    );
    if (names.indexOf('board_posts') === -1) process.exit(1);
  } catch (e) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'APPLY_FAILED',
        message: String(e && e.message ? e.message : e).slice(0, 400),
      }),
    );
    process.exit(1);
  } finally {
    try {
      await executor.end();
    } catch (_) {}
  }
}

main();
