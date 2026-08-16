#!/usr/bin/env node
'use strict';
/**
 * Additive profiles.territory (Earth membership) migration.
 *
 *   node tools/apply-canonical-user-territory-migration.js --inspect
 *   node tools/apply-canonical-user-territory-migration.js --dry-run
 *   node tools/apply-canonical-user-territory-migration.js --confirm-dev-db
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_canonical_user_territory.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false, inspect: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--inspect') out.inspect = true;
  });
  return out;
}

function inspectSql(sql) {
  const sqlBody = sql.replace(/--[^\n]*/g, '');
  return {
    bytes: sql.length,
    hasTruncate: /\bTRUNCATE\b/i.test(sqlBody),
    hasDropTable: /\bDROP TABLE\b/i.test(sqlBody),
    hasDeleteFrom: /\bDELETE FROM\b/i.test(sqlBody),
    hasRowUpdate: /\bUPDATE\s+public\.profiles\b/i.test(sqlBody),
    hasDefaultCentral: /DEFAULT\s+'CENTRAL'/i.test(sqlBody),
    hasAlienAllowed: /IN\s*\([^)]*ALIEN/i.test(sqlBody),
    hasNullableTerritory: /ADD COLUMN IF NOT EXISTS territory text NULL/i.test(sql),
    hasEarthCheck: /PIONEER',\s*'CENTRAL',\s*'GUARDIAN'/.test(sql),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const inspected = inspectSql(sql);

  if (inspected.hasTruncate || inspected.hasDropTable || inspected.hasDeleteFrom || inspected.hasRowUpdate) {
    console.error(JSON.stringify({ ok: false, error: 'DESTRUCTIVE_SQL_REFUSED', inspected: inspected }));
    process.exit(1);
  }
  if (inspected.hasDefaultCentral) {
    console.error(JSON.stringify({ ok: false, error: 'DEFAULT_CENTRAL_REFUSED', inspected: inspected }));
    process.exit(1);
  }

  if (args.inspect) {
    console.log(JSON.stringify({ ok: true, inspect: true, inspected: inspected }));
    return;
  }

  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      maskedUrl: maskDatabaseUrl(url),
      inspected: inspected,
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

  const exec = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }

  try {
    await exec.query(sql);
    const col = await exec.query(
      "SELECT column_name, is_nullable, column_default, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='territory'"
    );
    const chk = await exec.query(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='profiles_territory_earth_membership_chk'"
    );
    const counts = await exec.query(
      "SELECT COUNT(*)::int AS total, COUNT(territory)::int AS with_territory FROM public.profiles"
    );
    console.log(JSON.stringify({
      ok: true,
      applied: true,
      maskedUrl: maskDatabaseUrl(url),
      column: col.rows && col.rows[0],
      check: chk.rows && chk.rows[0] && chk.rows[0].def,
      profiles: counts.rows && counts.rows[0],
    }));
  } catch (e) {
    console.error(JSON.stringify({
      ok: false,
      error: 'TRANSACTION_FAILED',
      message: String(e && e.message ? e.message : e),
    }));
    process.exit(1);
  } finally {
    await exec.end();
  }
}

main();
