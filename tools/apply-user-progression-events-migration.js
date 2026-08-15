#!/usr/bin/env node
'use strict';

/**
 * user_progression_events + apply_user_progression_event (Lv1~10)
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db 필수
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_user_progression_events_xp.sql');

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

  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (!args.confirm) {
    console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', maskedUrl: maskDatabaseUrl(url) }));
    process.exit(1);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  const sql = fs.readFileSync(MIGRATION, 'utf8');
  if (/\bTRUNCATE\b|\bDROP TABLE\b|\bDELETE FROM\b/i.test(sql)) {
    console.error(JSON.stringify({ ok: false, error: 'DESTRUCTIVE_SQL_REFUSED' }));
    process.exit(1);
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, bytes: sql.length, maskedUrl: maskDatabaseUrl(url) }));
    return;
  }

  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  await exec.query(sql);
  console.log(JSON.stringify({ ok: true, applied: 'migration_user_progression_events_xp.sql', maskedUrl: maskDatabaseUrl(url) }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
