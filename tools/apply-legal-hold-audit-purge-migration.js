#!/usr/bin/env node
'use strict';
/**
 * Additive DEC-021 legal_hold + DEC-020 admin audit controlled purge.
 *   node tools/apply-legal-hold-audit-purge-migration.js --dry-run
 *   node tools/apply-legal-hold-audit-purge-migration.js --confirm-apply
 *
 * Uses DAILY_ISSUE_DATABASE_URL only. No Railway required.
 * 60s statement timeout expected at caller.
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
  'migration_legal_hold_and_audit_purge_v1.sql',
);

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply' || a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

function sqlBody(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .replace(/--[^\n]*/g, '\n');
}

function refuseSql(sql) {
  const body = sqlBody(sql)
    .replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION[\s\S]*?LANGUAGE\s+plpgsql[\s\S]*?\$\$;/gi, '\n')
    .replace(/REVOKE[\s\S]*?;/gi, '\n');
  if (/\bTRUNCATE\s+(TABLE|public\.)|\bDROP TABLE\b|\bDROP COLUMN\b|\bDROP SCHEMA\b/i.test(body)) {
    return 'DESTRUCTIVE_SQL_REFUSED';
  }
  if (/\bDELETE\s+FROM\b/i.test(body)) return 'DELETE_OUTSIDE_FUNCTION_REFUSED';
  if (!/admin_moderation_audit_legal_holds/.test(sql)) return 'MISSING_AUDIT_HOLD_TABLE';
  if (!/legal_hold_operator_events/.test(sql)) return 'MISSING_HOLD_EVENT_TABLE';
  if (!/purge_expired_admin_moderation_audit_events/.test(sql)) return 'MISSING_PURGE_RPC';
  if (!/set_admin_moderation_audit_legal_hold/.test(sql)) return 'MISSING_HOLD_RPC';
  return null;
}

async function verify(exec) {
  const tables = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('admin_moderation_audit_legal_holds','legal_hold_operator_events','admin_moderation_audit_events') ORDER BY 1",
  );
  const colsReports = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='board_reports' AND column_name='legal_hold_reason'",
  );
  const colsSanctions = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sanction_records' AND column_name='legal_hold_reason'",
  );
  const fns = await exec.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('purge_expired_admin_moderation_audit_events','set_admin_moderation_audit_legal_hold','admin_moderation_audit_events_block_mutation') ORDER BY 1",
  );
  const triggerDef = await exec.query(
    "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_moderation_audit_events_block_mutation' LIMIT 1",
  );
  const auditCount = await exec.query('SELECT COUNT(*)::int AS n FROM public.admin_moderation_audit_events');
  return {
    tables: (tables.rows || []).map(function (r) { return r.table_name; }),
    reportReasonCol: !!(colsReports.rows && colsReports.rows[0]),
    sanctionReasonCol: !!(colsSanctions.rows && colsSanctions.rows[0]),
    functions: (fns.rows || []).map(function (r) { return r.routine_name; }),
    purgeBypassInTrigger: !!(triggerDef.rows && triggerDef.rows[0] && /allow_admin_audit_purge/.test(triggerDef.rows[0].def)),
    auditCount: auditCount.rows && auditCount.rows[0] ? auditCount.rows[0].n : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const bad = refuseSql(sql);
  if (bad) {
    console.error(JSON.stringify({ ok: false, error: bad }));
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
      migration: 'migration_legal_hold_and_audit_purge_v1.sql',
      maskedUrl: maskDatabaseUrl(url),
    }));
    return;
  }
  if (!args.confirm) {
    console.error(JSON.stringify({
      ok: false,
      error: 'CONFIRM_REQUIRED',
      hint: '--confirm-apply',
      maskedUrl: maskDatabaseUrl(url),
    }));
    process.exit(1);
  }

  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }
  try {
    await exec.query("SET statement_timeout = '60s'");
  } catch (_) {}
  const before = await verify(exec);
  await exec.query(sql);
  try {
    await exec.query("NOTIFY pgrst, 'reload schema'");
  } catch (_) {}
  const after = await verify(exec);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_legal_hold_and_audit_purge_v1.sql',
    before: before,
    after: after,
    hasHoldTable: after.tables.indexOf('admin_moderation_audit_legal_holds') !== -1,
    hasEventTable: after.tables.indexOf('legal_hold_operator_events') !== -1,
    hasPurgeRpc: after.functions.indexOf('purge_expired_admin_moderation_audit_events') !== -1,
    auditCountUnchanged: before.auditCount === after.auditCount,
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({
    ok: false,
    error: e && e.message ? e.message : String(e),
  }));
  process.exit(1);
});
