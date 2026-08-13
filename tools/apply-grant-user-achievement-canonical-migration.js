#!/usr/bin/env node
'use strict';

/**
 * grant_user_achievement canonical (acquired_at/sequence) migration
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

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migration_grant_user_achievement_canonical.sql',
);

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
  if (args.dryRun) {
    console.log(
      JSON.stringify({
        ok: true,
        dryRun: true,
        maskedUrl: maskDatabaseUrl(url),
        sqlBytes: Buffer.byteLength(sql),
      }),
    );
    return;
  }

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!executor.ok) {
    console.error(JSON.stringify({ ok: false, error: executor.error, message: executor.message }));
    process.exit(1);
  }

  try {
    await executor.query(sql);
    const probe = await executor.query(
      "SELECT pg_get_functiondef('public.grant_user_achievement(uuid,text,timestamptz,bigint,text,jsonb)'::regprocedure) AS def",
    );
    const def = probe.rows && probe.rows[0] && probe.rows[0].def ? String(probe.rows[0].def) : '';
    const ok =
      /pg_advisory_xact_lock/.test(def) &&
      /v_acquired := now\(\)/.test(def) &&
      /ALREADY_GRANTED/.test(def);
    console.log(
      JSON.stringify({
        ok: ok,
        applied: true,
        maskedUrl: maskDatabaseUrl(url),
        hasAdvisoryLock: /pg_advisory_xact_lock/.test(def),
        usesDbNow: /v_acquired := now\(\)/.test(def),
      }),
    );
    if (!ok) process.exit(1);
  } catch (e) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'TRANSACTION_FAILED',
        message: String(e.message || e),
        maskedUrl: maskDatabaseUrl(url),
      }),
    );
    process.exit(1);
  } finally {
    await executor.end();
  }
}

main();
