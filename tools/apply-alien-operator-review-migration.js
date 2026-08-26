#!/usr/bin/env node
'use strict';
/**
 * Additive: allow OPERATOR_REVIEW on user_moderation_state.return_policy.
 *
 *   node tools/apply-alien-operator-review-migration.js --dry-run
 *   railway run --service sentencearena node tools/apply-alien-operator-review-migration.js --confirm-apply
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_alien_operator_review_v1.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function verify(exec) {
  const chk = await exec.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'user_moderation_state_return_policy_chk'"
  );
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  return {
    constraint: chk.rows[0] && chk.rows[0].def,
    profileCount: profiles.rows[0] && profiles.rows[0].n,
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
      hasOperatorReview: /OPERATOR_REVIEW/.test(sql),
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
    applied: 'migration_alien_operator_review_v1.sql',
    before: before,
    after: after,
    profilesUnchanged: before.profileCount === after.profileCount,
    hasOperatorReview: /OPERATOR_REVIEW/.test(String(after.constraint || '')),
  }, null, 2));
  await exec.end();
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: (e && e.message) || String(e) }));
  process.exit(1);
});
