#!/usr/bin/env node
'use strict';

/**
 * daily_issue_test fixture cleanup only — never public schema
 */

require('dotenv').config({ path: '.env' });
const { createDailyIssuePgExecutor, resolveDailyIssueDatabaseUrl } = require('../server/daily-issue-pg-client');

const SCHEMA = 'daily_issue_test';

const FIXTURE_PREFIXES = [
  'mornsched_',
  'pubdec_smoke_',
  'api_smoke_',
  'ui_smoke_',
  'dbg_',
  'test_',
  'ut_',
  'pg_cand_',
  'pg_cl_',
  'cand_api_smoke',
  'cand_ui_smoke',
  'cand_safe_stats',
  'auto1',
  'man1',
  'hold1',
  'rej1',
];

function isFixtureItem(row) {
  const id = String(row.id || '');
  const cand = String(row.candidate_id || '');
  const title = String(row.title || '');
  const blob = (id + ' ' + cand + ' ' + title).toLowerCase();
  for (let i = 0; i < FIXTURE_PREFIXES.length; i++) {
    if (blob.indexOf(FIXTURE_PREFIXES[i].toLowerCase()) >= 0) return true;
  }
  if (/^cand_(api_smoke|ui_smoke|dbg|test)_/i.test(id) || /^cand_(api_smoke|ui_smoke|dbg|test)_/i.test(cand)) {
    return true;
  }
  if (/EU responds to border crossing crisis/i.test(title)) return true;
  if (row.expires_at && String(row.expires_at).indexOf('2099') === 0) return true;
  if (row.publish_expires_at && String(row.publish_expires_at).indexOf('2099') === 0) return true;
  return false;
}

function isFixtureSchedulerRun(row) {
  const key = String(row.run_key || '');
  if (!key) return false;
  if (/2099/.test(key)) return true;
  if (/^morning-(collect|publish):2099/.test(key)) return true;
  return false;
}

async function deleteReviewItem(ex, id) {
  await ex.query(
    'DELETE FROM "' +
      SCHEMA +
      '".daily_issue_claim_evidences WHERE claim_id IN (SELECT claim_id FROM "' +
      SCHEMA +
      '".daily_issue_review_item_claims WHERE review_item_id = $1)',
    [id],
  );
  await ex.query(
    'DELETE FROM "' +
      SCHEMA +
      '".daily_issue_claim_sources WHERE claim_id IN (SELECT claim_id FROM "' +
      SCHEMA +
      '".daily_issue_review_item_claims WHERE review_item_id = $1)',
    [id],
  );
  await ex.query('DELETE FROM "' + SCHEMA + '".daily_issue_review_item_claims WHERE review_item_id = $1', [id]);
  await ex.query('DELETE FROM "' + SCHEMA + '".daily_issue_review_item_evidences WHERE review_item_id = $1', [id]);
  await ex.query('DELETE FROM "' + SCHEMA + '".daily_issue_review_item_sources WHERE review_item_id = $1', [id]);
  await ex.query('DELETE FROM "' + SCHEMA + '".daily_issue_updates WHERE issue_id = $1', [id]);
  await ex.query('DELETE FROM "' + SCHEMA + '".daily_issue_audit_logs WHERE entity_id = $1', [id]);
  await ex.query('DELETE FROM "' + SCHEMA + '".daily_issue_review_items WHERE id = $1', [id]);
}

async function main() {
  const schemaEnv = String(process.env.DAILY_ISSUE_DB_SCHEMA || SCHEMA).trim();
  if (schemaEnv !== SCHEMA) {
    console.error('ABORT: DAILY_ISSUE_DB_SCHEMA must be daily_issue_test');
    process.exit(1);
  }
  const ex = createDailyIssuePgExecutor({
    databaseUrl: resolveDailyIssueDatabaseUrl({}),
    schemaName: SCHEMA,
  });
  if (!ex.ok) {
    console.error('ABORT: executor unavailable');
    process.exit(1);
  }

  const qIdent = '"' + SCHEMA + '"."daily_issue_review_items"';
  const rows = await ex.query('SELECT id, candidate_id, status, title, expires_at, publish_expires_at FROM ' + qIdent + ' ORDER BY queued_at DESC NULLS LAST');
  const del = [];
  const keep = [];
  rows.rows.forEach(function (r) {
    if (isFixtureItem(r)) del.push(r);
    else keep.push(r);
  });

  let schedulerDel = 0;
  try {
    const runs = await ex.query('SELECT run_key, run_type, status FROM "' + SCHEMA + '"."daily_issue_scheduler_runs"');
    for (let i = 0; i < runs.rows.length; i++) {
      if (isFixtureSchedulerRun(runs.rows[i])) {
        await ex.query('DELETE FROM "' + SCHEMA + '"."daily_issue_scheduler_runs" WHERE run_key = $1', [
          runs.rows[i].run_key,
        ]);
        schedulerDel += 1;
      }
    }
  } catch (_) {
    /* table may not exist in json-only env */
  }

  console.log('schema', SCHEMA);
  console.log('review_delete_count', del.length);
  console.log('review_keep_count', keep.length);
  console.log('scheduler_test_run_delete_count', schedulerDel);
  console.log('real_candidate_count', keep.length);
  console.log('test_candidate_count', del.length);

  for (let i = 0; i < del.length; i++) {
    await deleteReviewItem(ex, del[i].id);
    console.log('deleted_review', del[i].id);
  }

  const ready = await ex.query('SELECT count(*)::int AS n FROM ' + qIdent + " WHERE status = 'READY_FOR_REVIEW'");
  const total = await ex.query('SELECT count(*)::int AS n FROM ' + qIdent);
  console.log('READY_FOR_REVIEW', ready.rows[0].n);
  console.log('TOTAL', total.rows[0].n);
  await ex.end();
}

main().catch(function (e) {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
