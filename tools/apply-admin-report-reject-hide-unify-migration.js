#!/usr/bin/env node
'use strict';
/**
 * Additive: REPORT_REJECTED allow-list + admin soft-delete → HIDDEN_BY_OPERATOR.
 * No new table. No DROP TABLE / TRUNCATE / DELETE FROM.
 *
 *   node tools/apply-admin-report-reject-hide-unify-migration.js --dry-run
 *   railway run --service sentencearena node tools/apply-admin-report-reject-hide-unify-migration.js --confirm-apply
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
  'migration_admin_report_reject_and_hide_unify_v1.sql',
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
    if (
      !/UPDATE\s+public\.board_posts\b/i.test(updates[i])
      && !/UPDATE\s+public\.board_comments\b/i.test(updates[i])
    ) {
      return 'UPDATE_REFUSED';
    }
  }
  if (!/REPORT_REJECTED/.test(body)) return 'MISSING_REPORT_REJECTED';
  if (!/HIDDEN_BY_OPERATOR/.test(body)) return 'MISSING_HIDDEN_STATUS';
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
  const insertDef = await exec.query(
    "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_insert_moderation_audit_event' LIMIT 1",
  );
  const postDef = await exec.query(
    "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_operator_soft_delete_post_with_audit' LIMIT 1",
  );
  const commentDef = await exec.query(
    "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_operator_soft_delete_comment_with_audit' LIMIT 1",
  );
  const insertSrc = insertDef.rows && insertDef.rows[0] ? String(insertDef.rows[0].def || '') : '';
  const postSrc = postDef.rows && postDef.rows[0] ? String(postDef.rows[0].def || '') : '';
  const commentSrc = commentDef.rows && commentDef.rows[0] ? String(commentDef.rows[0].def || '') : '';
  return {
    insertAllowsReportRejected: insertSrc.indexOf('REPORT_REJECTED') !== -1,
    postSoftDeleteUsesHidden: postSrc.indexOf('HIDDEN_BY_OPERATOR') !== -1,
    commentSoftDeleteUsesHidden: commentSrc.indexOf('HIDDEN_BY_OPERATOR') !== -1,
    auditCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.admin_moderation_audit_events'),
    profileCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.profiles'),
    postCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.board_posts'),
    commentCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.board_comments'),
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
      hasReportRejected: /REPORT_REJECTED/.test(sql),
      hasHiddenUnify: /HIDDEN_BY_OPERATOR/.test(sql),
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
  const exec = createDailyIssuePgExecutor({ connectionString: url });
  try {
    const before = await verify(exec);
    await exec.query(sql);
    const after = await verify(exec);
    console.log(JSON.stringify({
      ok: true,
      applied: 'migration_admin_report_reject_and_hide_unify_v1.sql',
      before: before,
      after: after,
      rpcsReady: !!(after.insertAllowsReportRejected && after.postSoftDeleteUsesHidden && after.commentSoftDeleteUsesHidden),
      profilesPreserved: before.profileCount === after.profileCount,
      postsPreserved: before.postCount === after.postCount,
      commentsPreserved: before.commentCount === after.commentCount,
      auditRowsPreserved: before.auditCount === after.auditCount,
      maskedUrl: maskDatabaseUrl(url),
    }));
  } finally {
    await exec.end();
  }
}

main().catch(function (err) {
  console.error(JSON.stringify({ ok: false, error: (err && err.message) || String(err) }));
  process.exit(1);
});
