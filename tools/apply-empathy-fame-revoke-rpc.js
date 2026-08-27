#!/usr/bin/env node
'use strict';
/**
 * Additive: EMPATHY 취소 시 해당 event 가 실제로 제거된 1회만 명성 -1.
 * node tools/apply-empathy-fame-revoke-rpc.js --dry-run
 * railway run --service sentencearena node tools/apply-empathy-fame-revoke-rpc.js --confirm-apply
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
  'migration_empathy_received_fame_revoke_rpc.sql',
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
  if (/\bTRUNCATE\b|\bDROP TABLE\b|\bDROP SCHEMA\b/i.test(body)) return false;
  const deletes = body.match(/\bDELETE\s+FROM\s+([^\s;]+)/gi) || [];
  for (let i = 0; i < deletes.length; i++) {
    if (!/DELETE\s+FROM\s+public\.user_progression_events/i.test(deletes[i])) return false;
  }
  return true;
}

async function verify(exec) {
  const fn = await exec.query(
    `SELECT pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='revoke_empathy_received_fame'`,
  );
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  return {
    revokeArgs: (fn.rows || []).map(function (r) { return r.args; }),
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
      hasRevokeFn: /revoke_empathy_received_fame/.test(sql),
      hasEventDelete: /DELETE FROM public\.user_progression_events/.test(sql),
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
    applied: 'migration_empathy_received_fame_revoke_rpc.sql',
    before: before,
    after: after,
    profilesUnchanged: before.profileCount === after.profileCount,
    revokePresent: (after.revokeArgs || []).some(function (a) {
      return /uuid/.test(String(a)) && /text/.test(String(a));
    }),
  }, null, 2));
  if (typeof exec.end === 'function') await exec.end();
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
