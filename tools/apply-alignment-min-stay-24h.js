#!/usr/bin/env node
'use strict';
/**
 * Additive: replace alignment_beta_v1_territory_candidate stay rule.
 * 24h after any territory change. No score/territory row rewrite.
 *
 *   node tools/apply-alignment-min-stay-24h.js --dry-run
 *   node tools/apply-alignment-min-stay-24h.js --confirm-apply
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
  'migration_alignment_min_stay_24h_all_moves.sql'
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
  if (/UPDATE\s+public\.user_alignment_state/i.test(body)) return false;
  if (/UPDATE\s+public\.profiles/i.test(body)) return false;
  if (/INSERT\s+INTO/i.test(body)) return false;
  return /CREATE OR REPLACE FUNCTION public\.alignment_beta_v1_territory_candidate/.test(body)
    && /interval '24 hours'/.test(body)
    && !/interval '48 hours'/.test(body);
}

async function verify(exec) {
  const now = new Date().toISOString();
  const last23 = new Date(Date.now() - (24 * 3600000 - 1000)).toISOString();
  const last24 = new Date(Date.now() - 24 * 3600000).toISOString();
  const last25 = new Date(Date.now() - 25 * 3600000).toISOString();
  const q = await exec.query(
    'SELECT public.alignment_beta_v1_territory_candidate($1,$2,$3::timestamptz,$4::timestamptz) AS v',
    ['CENTRAL', 400, null, now]
  );
  const c23 = await exec.query(
    'SELECT public.alignment_beta_v1_territory_candidate($1,$2,$3::timestamptz,$4::timestamptz) AS v',
    ['CENTRAL', 400, last23, now]
  );
  const c24 = await exec.query(
    'SELECT public.alignment_beta_v1_territory_candidate($1,$2,$3::timestamptz,$4::timestamptz) AS v',
    ['CENTRAL', 400, last24, now]
  );
  const p23 = await exec.query(
    'SELECT public.alignment_beta_v1_territory_candidate($1,$2,$3::timestamptz,$4::timestamptz) AS v',
    ['PIONEER', 160, last23, now]
  );
  const p25 = await exec.query(
    'SELECT public.alignment_beta_v1_territory_candidate($1,$2,$3::timestamptz,$4::timestamptz) AS v',
    ['PIONEER', 160, last25, now]
  );
  const direct = await exec.query(
    'SELECT public.alignment_beta_v1_territory_candidate($1,$2,$3::timestamptz,$4::timestamptz) AS v',
    ['PIONEER', -400, last25, now]
  );
  const align = await exec.query(
    'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE score <> 0)::int AS nonzero_score FROM public.user_alignment_state'
  );
  const profiles = await exec.query(
    "SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE territory='CENTRAL')::int AS central FROM public.profiles"
  );
  return {
    firstMoveNullStay: q.rows[0] && q.rows[0].v,
    central23h: c23.rows[0] && c23.rows[0].v,
    central24h: c24.rows[0] && c24.rows[0].v,
    pioneer23h: p23.rows[0] && p23.rows[0].v,
    pioneer25h: p25.rows[0] && p25.rows[0].v,
    pioneerNoDirectGuardian: direct.rows[0] && direct.rows[0].v,
    alignment: align.rows[0],
    profiles: profiles.rows[0],
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
      stayHours: 24,
      allMoves: true,
    }));
    return;
  }
  if (!args.confirm) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', hint: '--confirm-apply' }));
    process.exit(2);
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
  const stayOk =
    after.firstMoveNullStay === 'PIONEER' &&
    after.central23h === 'CENTRAL' &&
    after.central24h === 'PIONEER' &&
    after.pioneer23h === 'PIONEER' &&
    after.pioneer25h === 'CENTRAL' &&
    after.pioneerNoDirectGuardian === 'CENTRAL';
  console.log(JSON.stringify({
    ok: stayOk,
    applied: 'migration_alignment_min_stay_24h_all_moves.sql',
    scoresUnchanged: before.alignment.nonzero_score === after.alignment.nonzero_score,
    profilesUnchanged: before.profiles.n === after.profiles.n,
    centralUnchanged: before.profiles.central === after.profiles.central,
    after: {
      firstMoveNullStay: after.firstMoveNullStay,
      central23h: after.central23h,
      central24h: after.central24h,
      pioneer23h: after.pioneer23h,
      pioneer25h: after.pioneer25h,
      pioneerNoDirectGuardian: after.pioneerNoDirectGuardian,
    },
  }));
  if (!stayOk) process.exit(1);
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
