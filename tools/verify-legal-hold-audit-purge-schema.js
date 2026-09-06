#!/usr/bin/env node
'use strict';
/**
 * READ-ONLY verify DEC-021 / audit purge schema.
 *   node tools/verify-legal-hold-audit-purge-schema.js
 */

require('dotenv').config();

const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

async function main() {
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  if (!url) {
    console.log(JSON.stringify({ ok: false, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.log(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }

  const tables = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('admin_moderation_audit_legal_holds','legal_hold_operator_events') ORDER BY 1",
  );
  const fns = await exec.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('purge_expired_admin_moderation_audit_events','set_admin_moderation_audit_legal_hold') ORDER BY 1",
  );
  const grants = await exec.query(
    "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='admin_moderation_audit_events' AND privilege_type IN ('DELETE','UPDATE','TRUNCATE') ORDER BY 1,2",
  );
  const triggerDef = await exec.query(
    "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_moderation_audit_events_block_mutation' LIMIT 1",
  );
  const purgeDef = await exec.query(
    "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='purge_expired_admin_moderation_audit_events' LIMIT 1",
  );

  const out = {
    ok: true,
    maskedUrl: maskDatabaseUrl(url),
    tables: (tables.rows || []).map(function (r) { return r.table_name; }),
    functions: (fns.rows || []).map(function (r) { return r.routine_name; }),
    auditDangerousGrants: grants.rows || [],
    triggerAllowsOnlyControlledPurge: !!(
      triggerDef.rows
      && triggerDef.rows[0]
      && /allow_admin_audit_purge/.test(triggerDef.rows[0].def)
      && /ADMIN_AUDIT_APPEND_ONLY/.test(triggerDef.rows[0].def)
    ),
    purgeHasFixedOneYearCutoff: !!(
      purgeDef.rows
      && purgeDef.rows[0]
      && /interval '1 year'/.test(purgeDef.rows[0].def)
      && !/p_cutoff/.test(purgeDef.rows[0].def)
    ),
  };
  await exec.end();
  console.log(JSON.stringify(out, null, 2));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
  process.exit(1);
});
