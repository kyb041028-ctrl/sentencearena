#!/usr/bin/env node
'use strict';
/**
 * Additive: admin_moderation_audit_events + append-only RPCs.
 * No backfill. No existing-row UPDATE/DELETE. No DROP TABLE.
 *
 *   node tools/apply-admin-moderation-audit-migration.js --dry-run
 *   railway run --service sentencearena node tools/apply-admin-moderation-audit-migration.js --confirm-apply
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_admin_moderation_audit_v1.sql');

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
  const body = sqlBody(sql);
  const destructive = body.replace(/REVOKE[\s\S]*?;/gi, '\n');
  if (/\bTRUNCATE\s+(TABLE|public\.)|\bDROP TABLE\b|\bDROP COLUMN\b|\bDROP SCHEMA\b|\bDELETE\s+FROM\b/i.test(destructive)) {
    return 'DESTRUCTIVE_SQL_REFUSED';
  }
  if (/\bINSERT\s+INTO\s+(?!public\.admin_moderation_audit_events\b)/i.test(body)) {
    return 'INSERT_REFUSED';
  }
  const updates = body
    .replace(/BEFORE\s+UPDATE\s+ON/gi, '')
    .match(/\bUPDATE\s+[a-zA-Z0-9_.]+/gi) || [];
  for (let i = 0; i < updates.length; i++) {
    if (!/UPDATE\s+public\.board_posts\b/i.test(updates[i])) return 'UPDATE_REFUSED';
  }
  if (!/CREATE TABLE IF NOT EXISTS public\.admin_moderation_audit_events/.test(body)) {
    return 'MISSING_AUDIT_TABLE';
  }
  if (!/admin_operator_soft_delete_post_with_audit/.test(body)) {
    return 'MISSING_SOFT_DELETE_RPC';
  }
  if (!/admin_operator_restore_post_with_audit/.test(body)) {
    return 'MISSING_RESTORE_RPC';
  }
  return null;
}

async function countOrNull(exec, sql) {
  try {
    const res = await exec.query(sql);
    return res.rows && res.rows[0] ? res.rows[0].n : null;
  } catch (_) {
    return null;
  }
}

async function verify(exec) {
  const table = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_moderation_audit_events'",
  );
  const cols = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_moderation_audit_events' ORDER BY 1",
  );
  const rls = await exec.query(
    "SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='admin_moderation_audit_events'",
  );
  const grants = await exec.query(
    "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='admin_moderation_audit_events' ORDER BY 1,2",
  );
  const fns = await exec.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('admin_insert_moderation_audit_event','admin_operator_soft_delete_post_with_audit','admin_operator_restore_post_with_audit','admin_moderation_audit_events_block_mutation') ORDER BY 1",
  );
  const idx = await exec.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='admin_moderation_audit_events' ORDER BY 1",
  );
  return {
    hasTable: !!(table.rows && table.rows[0]),
    columns: (cols.rows || []).map(function (r) { return r.column_name; }),
    rls: rls.rows && rls.rows[0] ? rls.rows[0].relrowsecurity : null,
    grants: grants.rows || [],
    functions: (fns.rows || []).map(function (r) { return r.routine_name; }),
    indexes: (idx.rows || []).map(function (r) { return r.indexname; }),
    auditCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.admin_moderation_audit_events'),
    profileCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.profiles'),
    postCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.board_posts'),
    reportCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.board_reports'),
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
      hasTable: /admin_moderation_audit_events/.test(sql),
      hasSoftDeleteRpc: /admin_operator_soft_delete_post_with_audit/.test(sql),
      hasRestoreRpc: /admin_operator_restore_post_with_audit/.test(sql),
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
  const before = await verify(exec);
  await exec.query(sql);
  try {
    await exec.query("NOTIFY pgrst, 'reload schema'");
  } catch (_) {}
  const after = await verify(exec);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_admin_moderation_audit_v1.sql',
    before: before,
    after: after,
    tableCreated: after.hasTable === true,
    rlsOn: after.rls === true,
    profilesPreserved: before.profileCount === after.profileCount,
    postsPreserved: before.postCount === after.postCount,
    reportsPreserved: before.reportCount === after.reportCount,
    noBackfill: after.auditCount === 0 || after.auditCount === before.auditCount,
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
