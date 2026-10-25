#!/usr/bin/env node
'use strict';

/**
 * Dev-only apply for migration_service_role_route_min_grants_v1.sql.
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
  'migration_service_role_route_min_grants_v1.sql',
);

const EXPECTED_REF = 'wzpreuseuiuzwpoqqckr';
const FORBIDDEN_REFS = Object.freeze(['vmpdddcdnxeavchgivcd', 'rlzltrwwamrgrfwlaqxj']);

const PROFILE_UPDATE_COLUMNS = Object.freeze([
  'central_plaza_hint_seen_at',
  'first_visit_guide_completed_at',
  'first_visit_guide_eligible_at',
  'signup_completed_at',
]);

const REQUIRED_TABLE_PRIVS = Object.freeze({
  board_posts: ['INSERT', 'SELECT', 'UPDATE'],
  board_comments: ['SELECT', 'UPDATE'],
  board_reactions: ['SELECT'],
  board_reports: ['SELECT', 'UPDATE'],
  profiles: ['SELECT'],
  user_alignment_state: ['DELETE', 'SELECT'],
  alignment_history: ['DELETE', 'SELECT'],
  alignment_territory_history: ['DELETE', 'SELECT'],
});

const FORBIDDEN_TABLE_PRIVS = Object.freeze({
  board_posts: ['DELETE'],
  board_comments: ['INSERT', 'DELETE'],
  board_reactions: ['INSERT', 'UPDATE', 'DELETE'],
  board_reports: ['INSERT', 'DELETE'],
  profiles: ['INSERT', 'UPDATE', 'DELETE'],
  user_alignment_state: ['INSERT', 'UPDATE'],
  alignment_history: ['INSERT', 'UPDATE'],
  alignment_territory_history: ['INSERT', 'UPDATE'],
});

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
  if (/\bGRANT\s+ALL\b/i.test(body)) return 'GRANT_ALL_REFUSED';
  if (/\bGRANT\s+[^;]*\bON\s+SCHEMA\b/i.test(body)) return 'SCHEMA_GRANT_REFUSED';
  if (/\b(CREATE|ALTER|DROP)\s+POLICY\b/i.test(body)) return 'RLS_POLICY_CHANGE_REFUSED';
  if (/\b(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i.test(body)) return 'RLS_TOGGLE_REFUSED';
  if (/\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b/i.test(body)) return 'DESTRUCTIVE_SQL_REFUSED';
  if (/\bTO\s+PUBLIC\b/i.test(body)) return 'PUBLIC_GRANT_REFUSED';
  return '';
}

async function verify(tx) {
  const names = Object.keys(REQUIRED_TABLE_PRIVS);
  const grants = await tx.query(
    `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee = 'service_role'
        AND table_name = ANY($1::text[])`,
    [names],
  );
  const have = {};
  (grants.rows || []).forEach(function (row) {
    const table = row.table_name;
    if (!have[table]) have[table] = {};
    have[table][row.privilege_type] = true;
  });
  const missing = [];
  const forbiddenPresent = [];
  names.forEach(function (table) {
    REQUIRED_TABLE_PRIVS[table].forEach(function (priv) {
      if (!have[table] || !have[table][priv]) missing.push(table + ':' + priv);
    });
    (FORBIDDEN_TABLE_PRIVS[table] || []).forEach(function (priv) {
      if (have[table] && have[table][priv]) forbiddenPresent.push(table + ':' + priv);
    });
  });
  const cols = await tx.query(
    `SELECT column_name
       FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND grantee = 'service_role'
        AND privilege_type = 'UPDATE'
      ORDER BY column_name`,
  );
  const updateColumns = (cols.rows || []).map(function (row) {
    return row.column_name;
  });
  const rls = await tx.query(
    `SELECT c.relname AS table_name, c.relrowsecurity AS enabled
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])`,
    [names],
  );
  const rlsOff = (rls.rows || [])
    .filter(function (row) {
      return row.enabled !== true;
    })
    .map(function (row) {
      return row.table_name;
    });
  const columnsMatch =
    updateColumns.length === PROFILE_UPDATE_COLUMNS.length &&
    PROFILE_UPDATE_COLUMNS.every(function (name, index) {
      return updateColumns[index] === name;
    });
  return {
    ok: missing.length === 0 && forbiddenPresent.length === 0 && columnsMatch && rlsOff.length === 0,
    missing: missing,
    forbiddenPresent: forbiddenPresent,
    profileUpdateColumns: updateColumns,
    rlsOff: rlsOff,
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
      await tx.query(sql);
      const result = await verify(tx);
      if (!result.ok) {
        const err = new Error('GRANT_VERIFY_FAILED');
        err.verify = result;
        throw err;
      }
      return result;
    });
    console.log(
      JSON.stringify({
        ok: true,
        applied: 'migration_service_role_route_min_grants_v1.sql',
        projectRef: EXPECTED_REF,
        profileUpdateColumns: checked.profileUpdateColumns,
        rlsOff: checked.rlsOff,
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
  PROFILE_UPDATE_COLUMNS: PROFILE_UPDATE_COLUMNS,
  REQUIRED_TABLE_PRIVS: REQUIRED_TABLE_PRIVS,
  FORBIDDEN_TABLE_PRIVS: FORBIDDEN_TABLE_PRIVS,
  assertDevTarget: assertDevTarget,
  assertSqlSafe: assertSqlSafe,
};
