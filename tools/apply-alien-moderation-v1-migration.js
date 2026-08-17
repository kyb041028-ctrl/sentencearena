#!/usr/bin/env node
'use strict';
/**
 * Additive ALIEN MODERATION V1 migration.
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db required.
 * Production refused. No DROP/TRUNCATE/기존 row DELETE. No territory CHECK change.
 *
 *   node tools/apply-alien-moderation-v1-migration.js --dry-run
 *   node tools/apply-alien-moderation-v1-migration.js --confirm-dev-db
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_alien_moderation_v1.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function verify(exec) {
  const tables = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_moderation_state','user_moderation_events','user_moderation_notifications') ORDER BY 1"
  );
  const cols = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_moderation_state' AND column_name IN ('return_policy','last_returned_at','cycle_start_at','alien_strike_count','entered_at','release_eligible_at') ORDER BY 1"
  );
  const profiles = await exec.query(
    "SELECT COUNT(*)::int AS n FROM public.profiles"
  );
  const terrCheck = await exec.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%territory%'"
  );
  return {
    tables: (tables.rows || []).map(function (r) { return r.table_name; }),
    stateCols: (cols.rows || []).map(function (r) { return r.column_name; }),
    profileCount: profiles.rows[0] && profiles.rows[0].n,
    territoryChecks: (terrCheck.rows || []).map(function (r) { return r.def; }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const sqlBody = sql.replace(/--[^\n]*/g, '');

  if (/\bTRUNCATE\b|\bDROP TABLE\b|\bDROP POLICY\b|\bDELETE FROM\b/i.test(sqlBody)) {
    console.error(JSON.stringify({ ok: false, error: 'DESTRUCTIVE_SQL_REFUSED' }));
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
      hasState: /user_moderation_state/.test(sql),
      hasEvents: /user_moderation_events/.test(sql),
      hasNotifications: /user_moderation_notifications/.test(sql),
      hasTruncate: false,
      maskedUrl: maskDatabaseUrl(url),
    }));
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

  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }
  const before = await verify(exec);
  await exec.query(sql);
  const after = await verify(exec);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_alien_moderation_v1.sql',
    before: before,
    after: after,
    profilesPreserved: before.profileCount === after.profileCount,
    territoryCheckUnchanged: JSON.stringify(before.territoryChecks) === JSON.stringify(after.territoryChecks),
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
