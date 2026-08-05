#!/usr/bin/env node
'use strict';

/**
 * daily_issue_test fixture cleanup only — never public schema
 */

require('dotenv').config({ path: '.env' });
const { createDailyIssuePgExecutor, resolveDailyIssueDatabaseUrl } = require('../server/daily-issue-pg-client');

const SCHEMA = 'daily_issue_test';

function isFixtureItem(row) {
  const id = String(row.id || '');
  const cand = String(row.candidate_id || '');
  const title = String(row.title || '');
  const blob = id + ' ' + cand + ' ' + title;
  if (/(^|[^a-z])(api_smoke_|ui_smoke_|dbg_|test_)/i.test(blob)) return true;
  if (/^cand_(api_smoke|ui_smoke|dbg|test)_/i.test(id) || /^cand_(api_smoke|ui_smoke|dbg|test)_/i.test(cand)) {
    return true;
  }
  if (/EU responds to border crossing crisis/i.test(title)) return true;
  return false;
}

async function main() {
  if (String(process.env.DAILY_ISSUE_DB_SCHEMA || '').trim() !== SCHEMA) {
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
  const rows = await ex.query('SELECT id, candidate_id, status, title FROM ' + qIdent + ' ORDER BY queued_at DESC NULLS LAST');
  const del = [];
  const keep = [];
  rows.rows.forEach(function (r) {
    if (isFixtureItem(r)) del.push(r);
    else keep.push(r);
  });

  console.log('schema', SCHEMA);
  console.log('delete_count', del.length);
  del.forEach(function (r) {
    console.log('DEL', r.status, r.id);
  });
  console.log('keep_count', keep.length);
  keep.forEach(function (r) {
    console.log('KEEP', r.status, r.id, String(r.title || '').slice(0, 60));
  });

  for (let i = 0; i < del.length; i++) {
    const id = del[i].id;
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
    console.log('deleted', id);
  }

  const ready = await ex.query(
    'SELECT count(*)::int AS n FROM ' + qIdent + " WHERE status = 'READY_FOR_REVIEW'",
  );
  const total = await ex.query('SELECT count(*)::int AS n FROM ' + qIdent);
  console.log('READY_FOR_REVIEW', ready.rows[0].n);
  console.log('TOTAL', total.rows[0].n);
  await ex.end();
}

main().catch(function (e) {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
