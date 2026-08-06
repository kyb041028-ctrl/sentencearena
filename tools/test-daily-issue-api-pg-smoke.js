#!/usr/bin/env node
'use strict';

/**
 * 개발 PostgreSQL(daily_issue_test) 제한 smoke:
 * enqueue → approve → publish → public read → retire → public gone → audit
 * 운영 public schema / npm start 사용 안 함
 */

require('dotenv').config();

const { requestApp } = require('./daily-issue-api-http-helper');
const { makeReady, authHeaders, ADMIN_TOKEN, AS_OF, createTestAdminAuthGuard } = require('./daily-issue-api-test-fixtures');
const { createDailyIssueApiApp } = require('../server/daily-issue-routes');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');

const schema = String(process.env.DAILY_ISSUE_DB_SCHEMA || '').trim();
const url = String(process.env.DAILY_ISSUE_DATABASE_URL || '').trim();
const allow = String(process.env.DAILY_ISSUE_ALLOW_TEST_RESET || '').trim() === '1';

async function main() {
  if (!url) {
    console.log('SKIP: DAILY_ISSUE_DATABASE_URL not set');
    process.exit(0);
  }
  if (schema !== 'daily_issue_test') {
    console.log('SKIP: schema must be daily_issue_test (got ' + schema + ')');
    process.exit(0);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.log('SKIP: NODE_ENV=production');
    process.exit(0);
  }

  console.log('\n=== daily-issue API PG smoke (schema=' + schema + ') ===\n');

  const repo = createDailyIssueReviewRepository({
    kind: 'db',
    databaseUrl: url,
    schemaName: schema,
    enabled: true,
  });
  const init = await Promise.resolve(repo.initialize());
  if (!init.ok) {
    console.error('FAIL initialize', init.error || init.message);
    process.exit(1);
  }

  const app = createDailyIssueApiApp({
    repositoryInstance: repo,
    adminAuthGuard: createTestAdminAuthGuard(process.env.DAILY_ISSUE_ADMIN_API_TOKEN || ADMIN_TOKEN),
    asOf: AS_OF,
    corsOrigins: ['http://localhost:3000'],
  });

  const suffix = 'api_smoke_' + Date.now();
  const item = makeReady(suffix);
  // Direct repository insert — enqueue 후보는 별도 ingest 계약
  const ins = await Promise.resolve(repo.insertReviewItems([item], [], {}));
  if (!ins.ok) {
    console.error('FAIL insert', ins.error, ins.message || '');
    process.exit(1);
  }
  console.log('PASS fixture insert');
  let id = item.id;

  const found0 = await Promise.resolve(repo.getById(id));
  if (!found0.ok) {
    console.error('FAIL get after seed');
    process.exit(1);
  }
  id = found0.item.id;
  let lock = found0.item.lockVersion || 1;
  const token = process.env.DAILY_ISSUE_ADMIN_API_TOKEN || ADMIN_TOKEN;

  const approve = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/approve', {
    headers: { Authorization: 'Bearer ' + token },
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: lock, reviewerId: 'pg-smoke' },
  });
  if (!(approve.status === 200 && approve.body.ok)) {
    console.error('FAIL approve', approve.status, approve.body);
    process.exit(1);
  }
  console.log('PASS admin approve');
  lock = approve.body.data.item.lockVersion;

  const publish = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/publish', {
    headers: { Authorization: 'Bearer ' + token },
    body: { expectedStatus: 'APPROVED', expectedLockVersion: lock, reviewerId: 'pg-smoke' },
  });
  if (!(publish.status === 200 && publish.body.ok)) {
    console.error('FAIL publish', publish.status, publish.body);
    process.exit(1);
  }
  console.log('PASS admin publish');
  lock = publish.body.data.item.lockVersion;

  const list = await requestApp(app, 'GET', '/api/daily-issues');
  const ids = ((list.body && list.body.data && list.body.data.items) || []).map(function (i) {
    return i.id;
  });
  if (!(list.status === 200 && ids.indexOf(id) >= 0)) {
    console.error('FAIL public list', list.status, ids);
    process.exit(1);
  }
  console.log('PASS public list includes published');

  const detail = await requestApp(app, 'GET', '/api/daily-issues/' + id);
  if (!(detail.status === 200 && detail.body.data.item.id === id)) {
    console.error('FAIL public detail', detail.status, detail.body);
    process.exit(1);
  }
  if (detail.raw.indexOf('pg-smoke') >= 0 || detail.raw.indexOf('rawText') >= 0) {
    console.error('FAIL public detail leaked fields');
    process.exit(1);
  }
  console.log('PASS public detail');

  const retire = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + id + '/retire', {
    headers: { Authorization: 'Bearer ' + token },
    body: {
      expectedStatus: 'PUBLISHED',
      expectedLockVersion: lock,
      reasonCode: 'MANUAL_RETIRE',
      reasonText: 'pg smoke cleanup',
    },
  });
  if (!(retire.status === 200 && retire.body.ok)) {
    console.error('FAIL retire', retire.status, retire.body);
    process.exit(1);
  }
  console.log('PASS admin retire');

  const list2 = await requestApp(app, 'GET', '/api/daily-issues');
  const ids2 = ((list2.body && list2.body.data && list2.body.data.items) || []).map(function (i) {
    return i.id;
  });
  if (ids2.indexOf(id) >= 0) {
    console.error('FAIL still public after retire');
    process.exit(1);
  }
  console.log('PASS public list excludes retired');

  const hist = await requestApp(app, 'GET', '/api/admin/daily-issues/review/' + id + '/history', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!(hist.status === 200 && hist.body.data.events.length >= 1)) {
    console.error('FAIL history', hist.status, hist.body);
    process.exit(1);
  }
  console.log('PASS audit history');

  // cleanup: leave RETIRED row (safe) or delete if allow reset helper exists
  if (allow && typeof repo.resetTestData === 'function') {
    await Promise.resolve(repo.resetTestData({ confirm: true }));
    console.log('PASS test data reset');
  } else {
    console.log('INFO left RETIRED fixture id=' + id + ' (set DAILY_ISSUE_ALLOW_TEST_RESET=1 for reset helper)');
  }

  if (repo.end) await Promise.resolve(repo.end());
  console.log('\nPG smoke PASS');
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
