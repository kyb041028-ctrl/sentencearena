#!/usr/bin/env node
'use strict';
/**
 * Additive: service_role SELECT on achievements + mark_user_achievement_notified.
 *
 *   node tools/apply-achievement-service-role-select-migration.js --dry-run
 *   railway run --service sentencearena node tools/apply-achievement-service-role-select-migration.js --confirm-apply
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
  'migration_achievement_service_role_select_v1.sql',
);

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function verify(exec) {
  const col = await exec.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_achievements'
        AND column_name='acquisition_notified_at'`,
  );
  const priv = await exec.query(
    `SELECT grantee, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='user_achievements'
        AND grantee='service_role' AND privilege_type='SELECT'`,
  );
  const mark = await exec.query(
    `SELECT pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='mark_user_achievement_notified'`,
  );
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  const ach = await exec.query('SELECT COUNT(*)::int AS n FROM public.user_achievements');
  return {
    hasNotifiedColumn: !!(col.rows && col.rows[0]),
    serviceRoleSelect: !!(priv.rows && priv.rows[0]),
    markArgs: (mark.rows || []).map(function (r) { return r.args; }),
    profileCount: profiles.rows[0] && profiles.rows[0].n,
    achievementCount: ach.rows[0] && ach.rows[0].n,
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

  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      bytes: sql.length,
      maskedUrl: maskDatabaseUrl(url),
      hasServiceRoleGrant: /GRANT SELECT ON TABLE public\.user_achievements TO service_role/.test(sql),
      hasMarkFn: /mark_user_achievement_notified/.test(sql),
    }));
    return;
  }
  if (!args.confirm) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', hint: '--confirm-apply' }));
    process.exit(2);
  }

  const exec = createDailyIssuePgExecutor({ connectionString: url });
  const before = await verify(exec);
  await exec.query(sql);
  const after = await verify(exec);
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_achievement_service_role_select_v1.sql',
    before: before,
    after: after,
    profilesUnchanged: before.profileCount === after.profileCount,
    achievementsUnchanged: before.achievementCount === after.achievementCount,
  }, null, 2));
  await exec.end();
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
