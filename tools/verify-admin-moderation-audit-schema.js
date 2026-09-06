#!/usr/bin/env node
'use strict';
/**
 * READ-ONLY verification of admin_moderation_audit_events.
 *   railway run --service sentencearena node tools/verify-admin-moderation-audit-schema.js
 */

require('dotenv').config();

const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

async function main() {
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }
  const table = await exec.query(
    "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_moderation_audit_events'",
  );
  const columns = await exec.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_moderation_audit_events' ORDER BY 1",
  );
  const rls = await exec.query(
    "SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='admin_moderation_audit_events'",
  );
  const grants = await exec.query(
    "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='admin_moderation_audit_events' AND grantee IN ('anon','authenticated','service_role') ORDER BY 1,2",
  );
  const triggers = await exec.query(
    "SELECT trigger_name, event_manipulation FROM information_schema.triggers WHERE event_object_schema='public' AND event_object_table='admin_moderation_audit_events' ORDER BY 1",
  );
  const fns = await exec.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND (routine_name LIKE 'admin_%audit%' OR routine_name LIKE 'admin_operator_%_with_audit') ORDER BY 1",
  );
  const idx = await exec.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='admin_moderation_audit_events' ORDER BY 1",
  );
  const counts = await exec.query(
    'SELECT (SELECT COUNT(*)::int FROM public.admin_moderation_audit_events) AS audit_n, (SELECT COUNT(*)::int FROM public.profiles) AS profiles_n, (SELECT COUNT(*)::int FROM public.board_posts) AS posts_n',
  );
  await exec.end();
  const grantRows = grants.rows || [];
  const servicePrivs = grantRows.filter(function (r) { return r.grantee === 'service_role'; }).map(function (r) { return r.privilege_type; });
  const clientPrivs = grantRows.filter(function (r) { return r.grantee === 'anon' || r.grantee === 'authenticated'; });
  console.log(JSON.stringify({
    ok: true,
    readOnly: true,
    maskedUrl: maskDatabaseUrl(url),
    table: table.rows,
    columns: columns.rows,
    rls: rls.rows,
    grants: grantRows,
    triggers: triggers.rows,
    functions: (fns.rows || []).map(function (r) { return r.routine_name; }),
    indexes: (idx.rows || []).map(function (r) { return r.indexname; }),
    counts: counts.rows && counts.rows[0],
    serviceRoleWrite: servicePrivs.indexOf('INSERT') !== -1 && servicePrivs.indexOf('SELECT') !== -1,
    serviceRoleNoMutate: servicePrivs.indexOf('UPDATE') === -1 && servicePrivs.indexOf('DELETE') === -1 && servicePrivs.indexOf('TRUNCATE') === -1,
    clientsHaveNoGrants: clientPrivs.length === 0,
  }, null, 2));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
