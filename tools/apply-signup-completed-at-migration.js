#!/usr/bin/env node
'use strict';
/**
 * Apply additive profiles.signup_completed_at. No backfill.
 * Use Railway production env:
 *   railway run node tools/apply-signup-completed-at-migration.js --confirm-apply
 */

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_signup_completed_at_v1.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply' || a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function verify(exec) {
  const col = await exec.query(
    "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='signup_completed_at'",
  );
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  const stamped = await exec.query(
    'SELECT COUNT(*)::int AS n FROM public.profiles WHERE signup_completed_at IS NOT NULL',
  ).catch(function () {
    return { rows: [{ n: null }] };
  });
  return {
    column: (col.rows || [])[0] || null,
    profileCount: profiles.rows[0] && profiles.rows[0].n,
    stampedCount: stamped.rows && stamped.rows[0] ? stamped.rows[0].n : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const sqlBody = sql.replace(/--[^\n]*/g, '');

  if (/\bTRUNCATE\b|\bDROP TABLE\b|\bDELETE FROM\b/i.test(sqlBody)) {
    console.error(JSON.stringify({ ok: false, error: 'DESTRUCTIVE_SQL_REFUSED' }));
    process.exit(1);
  }
  if (/UPDATE\s+public\.profiles/i.test(sqlBody)) {
    console.error(JSON.stringify({ ok: false, error: 'BACKFILL_IN_SCHEMA_REFUSED' }));
    process.exit(1);
  }

  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      bytes: sql.length,
      hasColumn: /signup_completed_at/.test(sql),
      maskedUrl: maskDatabaseUrl(url),
    }));
    return;
  }
  if (!args.confirm) {
    console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', maskedUrl: maskDatabaseUrl(url) }));
    process.exit(1);
  }

  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }
  const before = await verify(exec).catch(function () {
    return { column: null, profileCount: null, stampedCount: null };
  });
  await exec.query(sql);
  try { await exec.query("NOTIFY pgrst, 'reload schema'"); } catch (_) {}
  const after = await verify(exec);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_signup_completed_at_v1.sql',
    before: before,
    after: after,
    profilesPreserved: before.profileCount == null || before.profileCount === after.profileCount,
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
