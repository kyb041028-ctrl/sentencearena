#!/usr/bin/env node
'use strict';
/**
 * Additive BETA ALIGNMENT V1 migration.
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db required to apply.
 * Production refused. No score reset. No profile territory rewrite.
 *
 *   node tools/apply-political-alignment-beta-v1-migration.js --dry-run
 *   node tools/apply-political-alignment-beta-v1-migration.js --confirm-dev-db
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_political_alignment_beta_v1.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function verify(exec) {
  const profiles = await exec.query(
    "SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE territory='CENTRAL')::int AS central, COUNT(*) FILTER (WHERE territory IS DISTINCT FROM 'CENTRAL')::int AS other FROM public.profiles"
  );
  const align = await exec.query(
    'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE score <> 0)::int AS nonzero_score, COUNT(*) FILTER (WHERE previous_signal <> 0)::int AS nonzero_prev FROM public.user_alignment_state'
  );
  const cols = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='board_reactions' AND column_name IN ('actor_alignment_score_at_reaction','target_author_alignment_score_at_reaction') ORDER BY 1"
  );
  const pending = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_alignment_state' AND column_name IN ('pending_territory','pending_territory_count','last_territory_changed_at') ORDER BY 1"
  );
  const hist = await exec.query(
    "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='alignment_territory_history'"
  );
  return {
    profiles: profiles.rows[0],
    alignment: align.rows[0],
    snapshotCols: (cols.rows || []).map(function (r) { return r.column_name; }),
    pendingCols: (pending.rows || []).map(function (r) { return r.column_name; }),
    territoryHistoryTable: hist.rows[0] && hist.rows[0].n === 1,
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
      hasRpc: /apply_alignment_score_batch/.test(sql),
      hasToggle: /toggle_board_reaction/.test(sql),
      hasScoreSnapshot: /actor_alignment_score_at_reaction/.test(sql),
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
    applied: 'migration_political_alignment_beta_v1.sql',
    before: before,
    after: after,
    profilesPreserved: before.profiles.n === after.profiles.n,
    centralPreserved: before.profiles.central === after.profiles.central,
    scoresNotReset: after.alignment.nonzero_score === before.alignment.nonzero_score,
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
