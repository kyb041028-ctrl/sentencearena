#!/usr/bin/env node
'use strict';

/**
 * Remove non-Korean review candidates from daily_issue_test only.
 * Keeps Korean-source candidates. Never touches public schema.
 */

require('dotenv').config({ path: '.env' });
const { createDailyIssuePgExecutor, resolveDailyIssueDatabaseUrl } = require('../server/daily-issue-pg-client');

const SCHEMA = 'daily_issue_test';

function isEnglishCandidate(row) {
  const id = String(row.id || '');
  const title = String(row.title || '');
  const blob = id + ' ' + title;
  if (/npr-world|bbc-world|guardian-world|un-news|who-news|yonhap-en|bok-eng|fed-press/i.test(blob)) {
    return true;
  }
  // Hangul present → treat as Korean title
  if (/[가-힣]/.test(title)) return false;
  // Latin-heavy title without Hangul
  if (/[A-Za-z]{4,}/.test(title) && !/[가-힣]/.test(title)) return true;
  return false;
}

async function deleteItem(ex, id) {
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
  const rows = await ex.query('SELECT id, status, title FROM ' + qIdent + ' ORDER BY queued_at DESC NULLS LAST');
  const del = [];
  const keep = [];
  rows.rows.forEach(function (r) {
    if (isEnglishCandidate(r)) del.push(r);
    else keep.push(r);
  });

  console.log('schema', SCHEMA);
  console.log('delete_en_count', del.length);
  for (let i = 0; i < del.length; i++) {
    console.log('DEL', del[i].status, del[i].id, String(del[i].title || '').slice(0, 50));
    await deleteItem(ex, del[i].id);
  }
  console.log('keep_count', keep.length);
  keep.forEach(function (r) {
    console.log('KEEP', r.status, r.id, String(r.title || '').slice(0, 50));
  });

  const ready = await ex.query(
    "SELECT count(*)::int AS n FROM " + qIdent + " WHERE status = 'READY_FOR_REVIEW'",
  );
  const total = await ex.query('SELECT count(*)::int AS n FROM ' + qIdent);
  const ko = await ex.query(
    "SELECT count(*)::int AS n FROM " + qIdent + " WHERE title ~ '[가-힣]'",
  );
  const en = await ex.query(
    "SELECT count(*)::int AS n FROM " +
      qIdent +
      " WHERE title !~ '[가-힣]' AND title ~ '[A-Za-z]{4,}'",
  );
  console.log('READY_FOR_REVIEW', ready.rows[0].n);
  console.log('TOTAL', total.rows[0].n);
  console.log('KO_TITLE', ko.rows[0].n);
  console.log('EN_TITLE', en.rows[0].n);
  await ex.end();
}

main().catch(function (e) {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
