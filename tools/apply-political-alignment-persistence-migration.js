#!/usr/bin/env node
'use strict';
/**
 * Additive alignment score persistence migration.
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db required to apply.
 *
 *   node tools/apply-political-alignment-persistence-migration.js --dry-run
 *   node tools/apply-political-alignment-persistence-migration.js --confirm-dev-db
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_political_alignment_persistence.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
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
  await exec.query(sql);
  const tables = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_alignment_state','alignment_batches','alignment_history') ORDER BY table_name"
  );
  const fn = await exec.query(
    "SELECT proname FROM pg_proc WHERE proname = 'apply_alignment_score_batch'"
  );
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_political_alignment_persistence.sql',
    tables: (tables.rows || []).map(function (r) { return r.table_name; }),
    rpc: (fn.rows || []).map(function (r) { return r.proname; }),
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
