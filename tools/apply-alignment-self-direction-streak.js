#!/usr/bin/env node
'use strict';
/**
 * Additive: user_alignment_state self-direction streak columns.
 * No score rewrite. No territory rewrite. Existing rows stay streak 0.
 *
 *   node tools/apply-alignment-self-direction-streak.js --dry-run
 *   node tools/apply-alignment-self-direction-streak.js --confirm-apply
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
  'migration_alignment_self_direction_streak_v1.sql'
);

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

function sqlAllowed(sql) {
  const body = String(sql || '').replace(/--[^\n]*/g, '');
  if (/\bTRUNCATE\b|\bDROP TABLE\b|\bDROP SCHEMA\b|\bDELETE\s+FROM\b/i.test(body)) return false;
  if (/UPDATE\s+public\.user_alignment_state[\s\S]{0,80}SET\s+score\s*=\s*0/i.test(body)) return false;
  if (/UPDATE\s+public\.profiles[\s\S]{0,80}SET\s+territory/i.test(body)) return false;
  return /ADD COLUMN IF NOT EXISTS/.test(body);
}

async function verify(exec) {
  const cols = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_alignment_state' AND column_name IN ('self_direction','self_direction_streak','self_direction_last_date','score') ORDER BY 1"
  );
  const names = (cols.rows || []).map(function (r) { return r.column_name; });
  const hasStreak = names.indexOf('self_direction_streak') >= 0;
  const align = await exec.query(
    hasStreak
      ? 'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE score <> 0)::int AS nonzero_score, COALESCE(SUM(self_direction_streak),0)::int AS streak_sum FROM public.user_alignment_state'
      : 'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE score <> 0)::int AS nonzero_score, NULL::int AS streak_sum FROM public.user_alignment_state'
  );
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  return {
    columns: names,
    alignment: align.rows[0],
    profileCount: profiles.rows[0] && profiles.rows[0].n,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  if (!sqlAllowed(sql)) {
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
      hasSelfDirection: /self_direction/.test(sql),
      hasStreak: /self_direction_streak/.test(sql),
      additive: true,
    }));
    return;
  }
  if (!args.confirm) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', hint: '--confirm-apply' }));
    process.exit(2);
  }

  const exec = createDailyIssuePgExecutor({ connectionString: url, databaseUrl: url });
  const before = await verify(exec);
  await exec.query(sql);
  const after = await verify(exec);
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_alignment_self_direction_streak_v1.sql',
    before: before,
    after: after,
    profilesUnchanged: before.profileCount === after.profileCount,
    scoresUnchanged: before.alignment && after.alignment && before.alignment.nonzero_score === after.alignment.nonzero_score,
    streakCols: (after.columns || []).filter(function (c) {
      return c === 'self_direction' || c === 'self_direction_streak' || c === 'self_direction_last_date';
    }),
    existingStreakZero: after.alignment && Number(after.alignment.streak_sum) === 0,
  }, null, 2));
  if (typeof exec.end === 'function') await exec.end();
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
