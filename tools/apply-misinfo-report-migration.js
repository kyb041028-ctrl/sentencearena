#!/usr/bin/env node
'use strict';
/**
 * Additive misinfo report abuse table.
 * DAILY_ISSUE_DATABASE_URL + --confirm-apply required.
 *
 *   node tools/apply-misinfo-report-migration.js --dry-run
 *   node tools/apply-misinfo-report-migration.js --confirm-apply
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_misinfo_report_v1.sql');

function toDirectDbUrl(url) {
  try {
    const u = new URL(url);
    const user = decodeURIComponent(u.username || '');
    let ref = '';
    const hostM = String(u.hostname || '').match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (hostM) ref = hostM[1];
    if (!ref && user.indexOf('.') !== -1) ref = user.split('.').pop();
    if (!ref) return null;
    const direct = new URL(url);
    direct.hostname = 'db.' + ref + '.supabase.co';
    direct.port = '5432';
    direct.username = 'postgres';
    direct.searchParams.set('sslmode', 'require');
    return direct.toString();
  } catch (_) {
    return null;
  }
}

async function notifyPgrst(url) {
  const { Client } = require('pg');
  const attempts = [];
  const direct = toDirectDbUrl(url);
  if (direct) attempts.push(direct);
  try {
    const pooled = new URL(url);
    if (pooled.port === '6543') {
      pooled.port = '5432';
      attempts.push(pooled.toString());
    }
  } catch (_) {}
  attempts.push(url);
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const client = new Client({ connectionString: attempts[i], ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      await client.query("NOTIFY pgrst, 'reload schema'");
      await client.end();
      return true;
    } catch (e) {
      lastErr = e;
      try { await client.end(); } catch (_) {}
    }
  }
  throw lastErr || new Error('PGRST_NOTIFY_FAILED');
}

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
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('misinfo_report_abuse_state','board_reports','rights_infringement_requests') ORDER BY 1"
  );
  const ipCols = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='misinfo_report_abuse_state' AND column_name IN ('ip','ip_address','alignment_score')"
  );
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  const reasons = await exec.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.board_reports'::regclass AND conname='board_reports_reason_chk'"
  );
  return {
    tables: (tables.rows || []).map(function (r) { return r.table_name; }),
    forbiddenCols: (ipCols.rows || []).map(function (r) { return r.column_name; }),
    profileCount: profiles.rows[0] && profiles.rows[0].n,
    reasonCheck: reasons.rows[0] && reasons.rows[0].def,
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
      hasAbuseTable: /misinfo_report_abuse_state/.test(sql),
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
  let pgrstReloaded = false;
  let pgrstError = null;
  try {
    await notifyPgrst(url);
    pgrstReloaded = true;
  } catch (e) {
    pgrstError = String(e && e.code ? e.code : (e && e.message ? e.message : e)).slice(0, 80);
    try { await exec.query("NOTIFY pgrst, 'reload schema'"); } catch (__) {}
  }
  const after = await verify(exec);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_misinfo_report_v1.sql',
    before: before,
    after: after,
    profilesPreserved: before.profileCount === after.profileCount,
    boardReportsPreserved: after.tables.indexOf('board_reports') !== -1,
    rightsPreserved: after.tables.indexOf('rights_infringement_requests') !== -1,
    noIpOrAlignmentCols: after.forbiddenCols.length === 0,
    reasonCodesUnchanged: String(after.reasonCheck || '').indexOf('misinfo') !== -1,
    pgrstReloaded: pgrstReloaded,
    pgrstError: pgrstError,
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
