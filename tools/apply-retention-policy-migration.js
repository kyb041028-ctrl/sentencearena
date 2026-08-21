#!/usr/bin/env node
'use strict';
/**
 * Additive retention policy v1.
 * DAILY_ISSUE_DATABASE_URL + --confirm-apply required.
 * No backfill. No DROP TABLE / TRUNCATE / existing-row DELETE.
 *
 *   node tools/apply-retention-policy-migration.js --dry-run
 *   node tools/apply-retention-policy-migration.js --confirm-apply
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_retention_policy_v1.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply' || a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function verify(exec) {
  const tables = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('deleted_content_evidence','user_sanction_records','banned_rejoin_blocks') ORDER BY 1"
  );
  const cols = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='board_reports' AND column_name IN ('finalized_at','retention_until','legal_hold','evidence_id') ORDER BY 1"
  );
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  return {
    tables: (tables.rows || []).map(function (r) { return r.table_name; }),
    reportCols: (cols.rows || []).map(function (r) { return r.column_name; }),
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
      hasEvidence: /deleted_content_evidence/.test(sql),
      hasSanctionRecords: /user_sanction_records/.test(sql),
      hasRejoin: /banned_rejoin_blocks/.test(sql),
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
  const before = await verify(exec);
  await exec.query(sql);
  try { await exec.query("NOTIFY pgrst, 'reload schema'"); } catch (_) {}
  const after = await verify(exec);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_retention_policy_v1.sql',
    before: before,
    after: after,
    profilesPreserved: before.profileCount === after.profileCount,
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
