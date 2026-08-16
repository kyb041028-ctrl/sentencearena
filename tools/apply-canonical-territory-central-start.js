#!/usr/bin/env node
'use strict';
/**
 * Additive CENTRAL start + NULL backfill for profiles.territory.
 *
 *   node tools/apply-canonical-territory-central-start.js --inspect
 *   node tools/apply-canonical-territory-central-start.js --dry-run
 *   node tools/apply-canonical-territory-central-start.js --confirm-dev-db
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_canonical_territory_central_start.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false, inspect: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--inspect') out.inspect = true;
  });
  return out;
}

function inspectSql(sql) {
  const sqlBody = sql.replace(/--[^\n]*/g, '');
  return {
    bytes: sql.length,
    hasTruncate: /\bTRUNCATE\b/i.test(sqlBody),
    hasDropTable: /\bDROP TABLE\b/i.test(sqlBody),
    hasDeleteFrom: /\bDELETE FROM\b/i.test(sqlBody),
    hasNullBackfill: /UPDATE\s+public\.profiles\s+SET\s+territory\s*=\s*'CENTRAL'\s+WHERE\s+territory\s+IS\s+NULL/i.test(
      sqlBody
    ),
    hasOtherProfileUpdate: /UPDATE\s+public\.profiles[\s\S]*SET(?![\s\S]*WHERE\s+territory\s+IS\s+NULL)/i.test(sqlBody),
    hasDefaultCentral: /SET DEFAULT 'CENTRAL'/i.test(sql),
    hasHandleNewUserCentral: /INSERT INTO public\.profiles[\s\S]*'CENTRAL'/i.test(sql),
    hasAlienAllowed: /IN\s*\([^)]*ALIEN/i.test(sqlBody),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const inspected = inspectSql(sql);

  if (inspected.hasTruncate || inspected.hasDropTable || inspected.hasDeleteFrom) {
    console.error(JSON.stringify({ ok: false, error: 'DESTRUCTIVE_SQL_REFUSED', inspected: inspected }));
    process.exit(1);
  }
  if (!inspected.hasNullBackfill || !inspected.hasDefaultCentral) {
    console.error(JSON.stringify({ ok: false, error: 'CENTRAL_START_SQL_INCOMPLETE', inspected: inspected }));
    process.exit(1);
  }

  if (args.inspect) {
    console.log(JSON.stringify({ ok: true, inspect: true, inspected: inspected }));
    return;
  }

  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (args.dryRun) {
    console.log(
      JSON.stringify({
        ok: true,
        dryRun: true,
        maskedUrl: maskDatabaseUrl(url),
        inspected: inspected,
      })
    );
    return;
  }
  if (!args.confirm) {
    console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', maskedUrl: maskDatabaseUrl(url) }));
    process.exit(1);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  const exec = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }

  try {
    const before = await exec.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE territory IS NULL)::int AS nulls, COUNT(*) FILTER (WHERE territory = 'CENTRAL')::int AS central FROM public.profiles"
    );
    await exec.query(sql);
    const after = await exec.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE territory IS NULL)::int AS nulls, COUNT(*) FILTER (WHERE territory = 'CENTRAL')::int AS central, COUNT(*) FILTER (WHERE territory IS NOT NULL AND territory <> 'CENTRAL')::int AS other FROM public.profiles"
    );
    const col = await exec.query(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='territory'"
    );
    const fn = await exec.query(
      "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='handle_new_user' LIMIT 1"
    );
    console.log(
      JSON.stringify({
        ok: true,
        applied: true,
        maskedUrl: maskDatabaseUrl(url),
        before: before.rows && before.rows[0],
        after: after.rows && after.rows[0],
        column: col.rows && col.rows[0],
        handleNewUserHasCentral: /territory[\s\S]*CENTRAL/.test(String((fn.rows && fn.rows[0] && fn.rows[0].def) || '')),
      })
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'TRANSACTION_FAILED',
        message: String(e && e.message ? e.message : e),
      })
    );
    process.exit(1);
  } finally {
    await exec.end();
  }
}

main();
