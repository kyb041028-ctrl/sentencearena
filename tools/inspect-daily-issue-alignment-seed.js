#!/usr/bin/env node
'use strict';
require('dotenv').config();
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

async function inspectSchema(exec, schema) {
  const tables = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('daily_issue_review_items','daily_issue_reactions') ORDER BY 1",
    [schema]
  );
  const col = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='daily_issue_review_items' AND column_name='alignment_direction'",
    [schema]
  );
  let counts = null;
  let dirs = null;
  const hasItems = (tables.rows || []).some(function (r) { return r.table_name === 'daily_issue_review_items'; });
  if (hasItems) {
    const c = await exec.query(
      'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = \'PUBLISHED\')::int AS published FROM "' + schema + '".daily_issue_review_items'
    );
    counts = c.rows[0];
    if (col.rows && col.rows.length) {
      const d = await exec.query(
        'SELECT COUNT(*) FILTER (WHERE alignment_direction IS NULL)::int AS null_dir, COUNT(*) FILTER (WHERE alignment_direction = \'PIONEER\')::int AS pioneer, COUNT(*) FILTER (WHERE alignment_direction = \'GUARDIAN\')::int AS guardian, COUNT(*) FILTER (WHERE alignment_direction = \'NEUTRAL\')::int AS neutral FROM "' + schema + '".daily_issue_review_items'
      );
      dirs = d.rows[0];
    }
  }
  return {
    schema: schema,
    tables: (tables.rows || []).map(function (r) { return r.table_name; }),
    hasAlignmentColumn: !!(col.rows && col.rows.length),
    counts: counts,
    directionCounts: dirs,
  };
}

async function main() {
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.log(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }
  const publicInfo = await inspectSchema(exec, 'public');
  const testInfo = await inspectSchema(exec, 'daily_issue_test');
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    maskedUrl: maskDatabaseUrl(url),
    nodeEnv: process.env.NODE_ENV || null,
    envSchema: process.env.DAILY_ISSUE_DB_SCHEMA || null,
    public: publicInfo,
    daily_issue_test: testInfo,
  }, null, 2));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
