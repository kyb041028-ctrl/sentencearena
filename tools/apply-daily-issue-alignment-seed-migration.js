#!/usr/bin/env node
'use strict';
/**
 * Additive Daily Issue alignment seed migration.
 * DAILY_ISSUE_DATABASE_URL + --confirm-dev-db required to apply.
 * Production refused. No DROP/TRUNCATE/DELETE. No P/G backfill.
 *
 *   node tools/apply-daily-issue-alignment-seed-migration.js --dry-run
 *   node tools/apply-daily-issue-alignment-seed-migration.js --confirm-dev-db
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  resolveSchemaName,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_daily_issue_alignment_seed_v1.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--schema=')) out.schema = a.slice(9);
  });
  return out;
}

function rewriteSchema(sql, schema) {
  if (!schema || schema === 'public') return sql;
  return sql.replace(/\bpublic\.(daily_issue_[a-z0-9_]+)/gi, schema + '.$1');
}

async function inspect(exec, schema) {
  const items = await exec.query(
    'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = \'PUBLISHED\')::int AS published FROM "' +
      schema +
      '".daily_issue_review_items'
  ).catch(function () {
    return { rows: [{ n: null, published: null }] };
  });
  const col = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='daily_issue_review_items' AND column_name='alignment_direction'",
    [schema]
  );
  const dirCounts = col.rows && col.rows.length
    ? await exec.query(
        'SELECT COUNT(*) FILTER (WHERE alignment_direction IS NULL)::int AS null_dir, COUNT(*) FILTER (WHERE alignment_direction = \'PIONEER\')::int AS pioneer, COUNT(*) FILTER (WHERE alignment_direction = \'GUARDIAN\')::int AS guardian, COUNT(*) FILTER (WHERE alignment_direction = \'NEUTRAL\')::int AS neutral FROM "' +
          schema +
          '".daily_issue_review_items'
      )
    : { rows: [{ null_dir: null, pioneer: null, guardian: null, neutral: null }] };
  const rx = await exec.query(
    "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='daily_issue_reactions'",
    [schema]
  );
  return {
    reviewItems: items.rows[0],
    hasAlignmentColumn: !!(col.rows && col.rows.length),
    directionCounts: dirCounts.rows[0],
    reactionsTable: rx.rows[0] && rx.rows[0].n === 1,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const schema = resolveSchemaName({ schemaName: args.schema || process.env.DAILY_ISSUE_DB_SCHEMA });
  const sql = rewriteSchema(fs.readFileSync(MIGRATION, 'utf8'), schema);
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
      schema: schema,
      hasAlignmentColumn: /alignment_direction/.test(sql),
      hasReactionsTable: /daily_issue_reactions/.test(sql),
      hasBackfillPioneerGuardian: /SET\s+alignment_direction\s*=\s*'PIONEER'|SET\s+alignment_direction\s*=\s*'GUARDIAN'/i.test(sqlBody),
      hasTruncate: false,
      maskedUrl: maskDatabaseUrl(url),
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

  const exec = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: schema });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }
  const before = await inspect(exec, schema);
  await exec.query(sql);
  const after = await inspect(exec, schema);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_daily_issue_alignment_seed_v1.sql',
    schema: schema,
    before: before,
    after: after,
    reviewItemsPreserved: before.reviewItems.n === after.reviewItems.n,
    publishedPreserved: before.reviewItems.published === after.reviewItems.published,
    noPioneerGuardianBackfill:
      after.directionCounts.pioneer === (before.directionCounts.pioneer || 0) &&
      after.directionCounts.guardian === (before.directionCounts.guardian || 0),
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
