#!/usr/bin/env node
'use strict';

/**
 * acquisition_notified_at + mark_user_achievement_notified
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db 필수
 * Additive only — DROP TABLE / TRUNCATE 없음
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migration_achievement_notified_state.sql',
);

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false, inspect: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--inspect') out.inspect = true;
  });
  return out;
}

async function inspect(executor) {
  const cols = await executor.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_achievements'
      ORDER BY ordinal_position`,
  );
  let notified = { exists: false, total: null, unnotified: null };
  const hasCol = (cols.rows || []).some(function (r) {
    return r.column_name === 'acquisition_notified_at';
  });
  if (hasCol) {
    const counts = await executor.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE acquisition_notified_at IS NULL)::int AS unnotified
         FROM public.user_achievements`,
    );
    notified = {
      exists: true,
      total: counts.rows[0] && counts.rows[0].total,
      unnotified: counts.rows[0] && counts.rows[0].unnotified,
    };
  }
  return {
    columns: cols.rows || [],
    acquisitionNotifiedAt: notified,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });

  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (!args.confirm && !args.inspect) {
    console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', maskedUrl: maskDatabaseUrl(url) }));
    process.exit(1);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const sqlNoComments = sql.replace(/--[^\n]*/g, '');
  if (/\bDROP TABLE\b/i.test(sqlNoComments) || /\bTRUNCATE\b/i.test(sqlNoComments)) {
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
        hasNotifiedColumn: /acquisition_notified_at/.test(sql),
        hasMarkRpc: /mark_user_achievement_notified/.test(sql),
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
    const before = await inspect(executor);
    if (args.inspect && !args.confirm) {
      console.log(JSON.stringify({ ok: true, inspect: true, maskedUrl: maskDatabaseUrl(url), before: before }));
      return;
    }

    await executor.query(sql);
    try {
      await executor.query("NOTIFY pgrst, 'reload schema'");
    } catch (_) {}

    const after = await inspect(executor);
    const grantDef = await executor.query(
      "SELECT pg_get_functiondef('public.grant_user_achievement(uuid,text,timestamptz,bigint,text,jsonb)'::regprocedure) AS def",
    );
    const markDef = await executor.query(
      "SELECT pg_get_functiondef('public.mark_user_achievement_notified(text,bigint)'::regprocedure) AS def",
    );
    const g = grantDef.rows && grantDef.rows[0] && grantDef.rows[0].def ? String(grantDef.rows[0].def) : '';
    const m = markDef.rows && markDef.rows[0] && markDef.rows[0].def ? String(markDef.rows[0].def) : '';
    const ok =
      after.acquisitionNotifiedAt.exists &&
      /acquisition_notified_at/.test(g) &&
      /auth\.uid\(\)/.test(m) &&
      /ACHIEVEMENT_NOT_OWNED/.test(m);
    console.log(
      JSON.stringify({
        ok: ok,
        applied: true,
        maskedUrl: maskDatabaseUrl(url),
        before: before.acquisitionNotifiedAt,
        after: after.acquisitionNotifiedAt,
        grantReturnsNotifiedAt: /acquisition_notified_at/.test(g),
        markUsesAuthUid: /auth\.uid\(\)/.test(m),
      }),
    );
    if (!ok) process.exit(1);
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
