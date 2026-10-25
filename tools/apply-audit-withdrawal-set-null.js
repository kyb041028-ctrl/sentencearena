#!/usr/bin/env node
'use strict';

/**
 * Dev-only apply for migration_audit_withdrawal_set_null_v1.sql.
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db required.
 * Refuses NODE_ENV=production and any project ref other than the dev ref.
 * Does not print the database URL or password.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migration_audit_withdrawal_set_null_v1.sql',
);

const EXPECTED_REF = 'wzpreuseuiuzwpoqqckr';
const FORBIDDEN_REFS = Object.freeze(['vmpdddcdnxeavchgivcd', 'rlzltrwwamrgrfwlaqxj']);

function parseArgs(argv) {
  const out = { confirm: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
  });
  return out;
}

function fail(error) {
  console.error(JSON.stringify({ ok: false, error: error }));
  process.exit(1);
}

function projectRefFromDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return '';
  }
  const user = decodeURIComponent(parsed.username || '');
  const userMatch = user.match(/^postgres\.([a-z0-9]{20})$/);
  if (userMatch) return userMatch[1];
  const hostMatch = String(parsed.hostname || '').match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
  return hostMatch ? hostMatch[1] : '';
}

function projectRefFromSupabaseUrl(url) {
  const match = String(url || '').match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  return match ? match[1] : '';
}

function assertDevTarget(databaseUrl, supabaseUrl) {
  const blob = String(databaseUrl || '') + '\n' + String(supabaseUrl || '');
  for (let i = 0; i < FORBIDDEN_REFS.length; i++) {
    if (blob.indexOf(FORBIDDEN_REFS[i]) !== -1) return 'FORBIDDEN_PROJECT_REF';
  }
  if (projectRefFromSupabaseUrl(supabaseUrl) !== EXPECTED_REF) return 'SUPABASE_URL_REF_MISMATCH';
  if (projectRefFromDatabaseUrl(databaseUrl) !== EXPECTED_REF) return 'DATABASE_REF_MISMATCH';
  return '';
}

function sqlBody(sql) {
  return String(sql || '').replace(/--[^\n]*/g, '');
}

function assertSqlSafe(sql) {
  const body = sqlBody(sql);
  if (/\bGRANT\b/i.test(body)) return 'GRANT_REFUSED';
  if (/\b(CREATE|ALTER|DROP)\s+POLICY\b/i.test(body)) return 'RLS_POLICY_CHANGE_REFUSED';
  if (/\b(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i.test(body)) return 'RLS_TOGGLE_REFUSED';
  if (/\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b/i.test(body)) return 'DESTRUCTIVE_SQL_REFUSED';
  if (/\bTO\s+PUBLIC\b/i.test(body)) return 'PUBLIC_GRANT_REFUSED';
  return '';
}

async function fingerprint(tx) {
  const audit = await tx.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(
              id::text || '|' || coalesce(actor_user_id::text, '') || '|' ||
              coalesce(target_user_id::text, '') || '|' || action_type || '|' ||
              target_type || '|' || target_id::text || '|' || reason_code || '|' ||
              operator_note || '|' || coalesce(sanction_id::text, '') || '|' ||
              coalesce(report_id::text, '') || '|' || created_at::text,
              ',' ORDER BY id), '')) AS fp
       FROM public.admin_moderation_audit_events`,
  );
  const hold = await tx.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(
              id::text || '|' || action_type || '|' || target_type || '|' ||
              target_id::text || '|' || coalesce(actor_user_id::text, '') || '|' ||
              reason || '|' || created_at::text,
              ',' ORDER BY id), '')) AS fp
       FROM public.legal_hold_operator_events`,
  );
  return {
    auditN: audit.rows[0].n,
    auditFp: audit.rows[0].fp,
    holdN: hold.rows[0].n,
    holdFp: hold.rows[0].fp,
  };
}

async function expectRaise(tx, sql, params, token) {
  await tx.query('SAVEPOINT probe');
  try {
    await tx.query(sql, params || []);
    await tx.query('ROLLBACK TO SAVEPOINT probe');
    return false;
  } catch (e) {
    await tx.query('ROLLBACK TO SAVEPOINT probe');
    return String((e && e.message) || '').indexOf(token) !== -1;
  }
}

async function verify(tx, before) {
  const defs = await tx.query(
    `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'admin_moderation_audit_events_block_mutation',
          'legal_hold_operator_events_block_mutation'
        )`,
  );
  const byName = {};
  (defs.rows || []).forEach(function (row) {
    byName[row.name] = row.def || '';
  });
  const auditDef = byName.admin_moderation_audit_events_block_mutation || '';
  const holdDef = byName.legal_hold_operator_events_block_mutation || '';
  const grants = await tx.query(
    `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee = 'service_role'
        AND table_name IN ('admin_moderation_audit_events', 'legal_hold_operator_events')`,
  );
  const updateGrant = (grants.rows || []).some(function (row) {
    return row.privilege_type === 'UPDATE' || row.privilege_type === 'DELETE';
  });

  const user = await tx.query('SELECT id FROM auth.users ORDER BY created_at LIMIT 1');
  const userId = user.rows && user.rows[0] ? user.rows[0].id : null;
  let nullOnlyOk = false;
  let contentBlocked = false;
  let deleteBlocked = false;
  let holdNullOk = false;
  let holdContentBlocked = false;
  let holdDeleteBlocked = false;
  if (userId) {
    await tx.query('SAVEPOINT probe_all');
    const inserted = await tx.query(
      `INSERT INTO public.admin_moderation_audit_events (
         actor_user_id, action_type, target_type, target_id, target_user_id, reason_code, operator_note
       ) VALUES ($1, 'POST_SOFT_DELETE', 'POST', gen_random_uuid(), $1, 'spam', 'probe')
       RETURNING id`,
      [userId],
    );
    const id = inserted.rows[0].id;
    await tx.query(
      'UPDATE public.admin_moderation_audit_events SET target_user_id = NULL WHERE id = $1',
      [id],
    );
    const afterNull = await tx.query(
      `SELECT actor_user_id, target_user_id, reason_code, operator_note, action_type
         FROM public.admin_moderation_audit_events WHERE id = $1`,
      [id],
    );
    const nulled = afterNull.rows[0];
    nullOnlyOk =
      nulled.target_user_id === null &&
      String(nulled.actor_user_id) === String(userId) &&
      nulled.reason_code === 'spam' &&
      nulled.operator_note === 'probe' &&
      nulled.action_type === 'POST_SOFT_DELETE';
    contentBlocked = await expectRaise(
      tx,
      'UPDATE public.admin_moderation_audit_events SET reason_code = $2 WHERE id = $1',
      [id, 'abuse'],
      'ADMIN_AUDIT_APPEND_ONLY',
    );
    deleteBlocked = await expectRaise(
      tx,
      'DELETE FROM public.admin_moderation_audit_events WHERE id = $1',
      [id],
      'ADMIN_AUDIT_APPEND_ONLY',
    );
    const holdIns = await tx.query(
      `INSERT INTO public.legal_hold_operator_events (
         action_type, target_type, target_id, actor_user_id, reason
       ) VALUES ('HOLD_SET', 'ADMIN_AUDIT', $2, $1, 'probe hold')
       RETURNING id`,
      [userId, id],
    );
    const holdId = holdIns.rows[0].id;
    await tx.query(
      'UPDATE public.legal_hold_operator_events SET actor_user_id = NULL WHERE id = $1',
      [holdId],
    );
    const holdRow = await tx.query(
      `SELECT actor_user_id, action_type, reason
         FROM public.legal_hold_operator_events WHERE id = $1`,
      [holdId],
    );
    holdNullOk =
      holdRow.rows[0].actor_user_id === null &&
      holdRow.rows[0].action_type === 'HOLD_SET' &&
      holdRow.rows[0].reason === 'probe hold';
    holdContentBlocked = await expectRaise(
      tx,
      'UPDATE public.legal_hold_operator_events SET reason = $2 WHERE id = $1',
      [holdId, 'changed'],
      'LEGAL_HOLD_EVENT_APPEND_ONLY',
    );
    holdDeleteBlocked = await expectRaise(
      tx,
      'DELETE FROM public.legal_hold_operator_events WHERE id = $1',
      [holdId],
      'LEGAL_HOLD_EVENT_APPEND_ONLY',
    );
    await tx.query('ROLLBACK TO SAVEPOINT probe_all');
  }

  const after = await fingerprint(tx);
  return {
    ok:
      /ADMIN_AUDIT_APPEND_ONLY/.test(auditDef) &&
      /allow_admin_audit_purge/.test(auditDef) &&
      /actor_user_id/.test(auditDef) &&
      /target_user_id/.test(auditDef) &&
      /LEGAL_HOLD_EVENT_APPEND_ONLY/.test(holdDef) &&
      /actor_user_id/.test(holdDef) &&
      !updateGrant &&
      !!userId &&
      nullOnlyOk &&
      contentBlocked &&
      deleteBlocked &&
      holdNullOk &&
      holdContentBlocked &&
      holdDeleteBlocked &&
      after.auditN === before.auditN &&
      after.auditFp === before.auditFp &&
      after.holdN === before.holdN &&
      after.holdFp === before.holdFp,
    nullOnlyOk: nullOnlyOk,
    contentBlocked: contentBlocked,
    deleteBlocked: deleteBlocked,
    holdNullOk: holdNullOk,
    holdContentBlocked: holdContentBlocked,
    holdDeleteBlocked: holdDeleteBlocked,
    updateGrant: updateGrant,
    auditUnchanged: after.auditN === before.auditN && after.auditFp === before.auditFp,
    holdUnchanged: after.holdN === before.holdN && after.holdFp === before.holdFp,
    auditN: after.auditN,
    holdN: after.holdN,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') fail('PRODUCTION_REFUSED');
  if (!args.confirm) fail('CONFIRM_REQUIRED');

  const databaseUrl = resolveDailyIssueDatabaseUrl({
    databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL,
  });
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  if (!databaseUrl) fail('DATABASE_UNAVAILABLE');
  const targetError = assertDevTarget(databaseUrl, supabaseUrl);
  if (targetError) fail(targetError);

  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const sqlError = assertSqlSafe(sql);
  if (sqlError) fail(sqlError);

  const executor = createDailyIssuePgExecutor({ databaseUrl: databaseUrl, schemaName: 'public' });
  if (!executor.ok) fail(executor.error || 'DATABASE_UNAVAILABLE');
  try {
    const checked = await executor.withTransaction(async function (tx) {
      const before = await fingerprint(tx);
      await tx.query(sql);
      const result = await verify(tx, before);
      if (!result.ok) {
        const err = new Error('AUDIT_WITHDRAWAL_VERIFY_FAILED');
        err.verify = result;
        throw err;
      }
      return result;
    });
    console.log(
      JSON.stringify({
        ok: true,
        applied: 'migration_audit_withdrawal_set_null_v1.sql',
        projectRef: EXPECTED_REF,
        nullOnlyOk: checked.nullOnlyOk,
        contentBlocked: checked.contentBlocked,
        deleteBlocked: checked.deleteBlocked,
        holdNullOk: checked.holdNullOk,
        holdContentBlocked: checked.holdContentBlocked,
        holdDeleteBlocked: checked.holdDeleteBlocked,
        updateGrant: checked.updateGrant,
        auditUnchanged: checked.auditUnchanged,
        holdUnchanged: checked.holdUnchanged,
        auditN: checked.auditN,
        holdN: checked.holdN,
      }),
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        ok: false,
        error: (e && e.message) || 'APPLY_FAILED',
        verify: e && e.verify ? e.verify : undefined,
      }),
    );
    process.exit(1);
  } finally {
    await executor.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  EXPECTED_REF: EXPECTED_REF,
  FORBIDDEN_REFS: FORBIDDEN_REFS,
  assertDevTarget: assertDevTarget,
  assertSqlSafe: assertSqlSafe,
};
