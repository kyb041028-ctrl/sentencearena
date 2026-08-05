#!/usr/bin/env node
'use strict';

/**
 * 실 PostgreSQL integration 테스트
 *
 * DAILY_ISSUE_DATABASE_URL 없으면 SKIPPED (가짜 PASS 금지)
 * 적용: tools/apply-daily-issue-review-migration.js --confirm-dev-db --schema=daily_issue_test
 */

require('dotenv').config();

const contract = require('../shared/daily-issue-review-repository-contract');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const { createDailyIssuePgExecutor, isAllowedTestSchema, maskDatabaseUrl } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createJsonDailyIssueReviewRepository } = require('../server/daily-issue-review-json-repository');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AS_OF = '2026-08-05T12:00:00.000Z';
let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function skip(name, reason) {
  skipped += 1;
  console.log('SKIPPED', name, '—', reason);
}

function makeReady(suffix) {
  const s1 = {
    id: 'pg_s1_' + suffix,
    publisher: 'BBC',
    title: 't',
    url: 'https://bbc.example.com/pg/' + suffix,
    publishedAt: '2026-08-04T10:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'bbc.example.com',
    contentHash: 'pg_h1_' + suffix,
  };
  const s2 = {
    id: 'pg_s2_' + suffix,
    publisher: 'Guardian',
    title: 't',
    url: 'https://guardian.example.com/pg/' + suffix,
    publishedAt: '2026-08-04T12:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'guardian.example.com',
    contentHash: 'pg_h2_' + suffix,
  };
  const text = 'Officials announced a new decision on border crisis after the crossing event occurred.';
  const evidences = [
    { id: 'pg_ev1_' + suffix, sourceId: s1.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: 'pg_ev2_' + suffix, sourceId: s2.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = quality.buildDailyIssueCandidate({
    title: 'EU responds to border crossing crisis ' + suffix,
    discussionPrompt: '평가?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: 'pg_c1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [evidences[0].id, evidences[1].id],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  return reviewCore.createReviewItem(
    Object.assign({}, gated, {
      clusterId: 'pg_cl_' + suffix,
      category: 'world',
      candidateId: 'pg_cand_' + suffix,
    }),
    { asOf: AS_OF, existingItems: [] },
  ).item;
}

function compareBundleFields(a, b) {
  const keys = [
    'id',
    'topic',
    'title',
    'freshnessClass',
    'publishedAt',
    'publishExpiresAt',
    'sourceCount',
    'independentSourceCount',
  ];
  return keys.every(function (k) {
    return String(a[k] || '') === String(b[k] || '');
  });
}

async function resetSchema(executor, schema) {
  const tables = [
    'daily_issue_claim_sources',
    'daily_issue_claim_evidences',
    'daily_issue_review_item_claims',
    'daily_issue_review_item_evidences',
    'daily_issue_review_item_sources',
    'daily_issue_updates',
    'daily_issue_audit_logs',
    'daily_issue_claims',
    'daily_issue_evidences',
    'daily_issue_sources',
    'daily_issue_review_items',
  ];
  for (let i = 0; i < tables.length; i++) {
    await executor.query('TRUNCATE TABLE "' + schema + '"."' + tables[i] + '" CASCADE');
  }
}

async function run() {
  const url = String(process.env.DAILY_ISSUE_DATABASE_URL || '').trim();
  const schema = String(process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test').trim();

  if (!url) {
    skip('real PostgreSQL contract', 'DAILY_ISSUE_DATABASE_URL missing');
    console.log(
      JSON.stringify({
        ok: true,
        realPostgres: 'SKIPPED',
        reason: 'DAILY_ISSUE_DATABASE_URL missing',
        note: '코드 구현 완료, 실제 DB 검증 미완료',
      }),
    );
    console.log('\n=== postgres repository: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped ===');
    process.exit(0);
  }

  if (!isAllowedTestSchema(schema) && schema !== 'public') {
    console.error(JSON.stringify({ ok: false, error: 'SCHEMA_NOT_ALLOWED', schema: schema }));
    process.exit(1);
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: schema });
  if (!executor.ok) {
    skip('pg executor', executor.message || 'unavailable');
    process.exit(0);
  }

  const hc = await executor.healthCheck();
  if (!hc.ok) {
    skip('pg healthCheck', hc.message || hc.error);
    await executor.end();
    process.exit(0);
  }

  console.log('pg connected', maskDatabaseUrl(url), 'schema=' + schema);

  const repo = createSqlDailyIssueReviewRepository({ executor: executor });
  const init = await repo.initialize();
  if (!init.ok) {
    ok('initialize (migration required?)', false, JSON.stringify(init));
    await executor.end();
    process.exit(failed ? 1 : 0);
  }
  ok('initialize', init.ok);

  if (isAllowedTestSchema(schema) && (process.env.NODE_ENV === 'test' || process.env.DAILY_ISSUE_ALLOW_TEST_RESET === '1')) {
    await resetSchema(executor, schema);
    ok('test reset scoped', true);
  } else {
    skip('test reset', 'set NODE_ENV=test or DAILY_ISSUE_ALLOW_TEST_RESET=1 with test schema');
  }

  ok('healthCheck', (await repo.healthCheck()).ok);
  ok('empty list', (await repo.list({})).count === 0);

  const item = makeReady('live1');
  const ins = await repo.insertReviewItems(
    [item],
    [{ entityId: item.id, action: 'enqueue', timestamp: AS_OF }],
  );
  ok('insert', ins.ok, JSON.stringify(ins));

  const dup = await repo.insertReviewItems([item], [{ entityId: item.id, action: 'enqueue', timestamp: AS_OF }]);
  ok('duplicate blocked', !dup.ok && dup.error === contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION);

  const byId = await repo.getById(item.id);
  ok('getById + claims', byId.ok && (byId.item.claims || []).length >= 1);

  const appr = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: byId.item.lockVersion,
    nextItem: Object.assign({}, byId.item, { status: 'APPROVED', approvedAt: AS_OF }),
    auditEvents: [{ entityId: item.id, fromStatus: 'READY_FOR_REVIEW', toStatus: 'APPROVED', action: 'approve', timestamp: AS_OF }],
  });
  ok('approve', appr.ok);

  const pub = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: appr.item.lockVersion,
    nextItem: Object.assign({}, appr.item, {
      status: 'PUBLISHED',
      publishedAt: AS_OF,
      publishExpiresAt: '2026-08-07T12:00:00.000Z',
    }),
    auditEvents: [{ entityId: item.id, fromStatus: 'APPROVED', toStatus: 'PUBLISHED', action: 'publish', timestamp: AS_OF }],
  });
  ok('publish', pub.ok);

  const audits = await repo.listAuditEvents({ entityId: item.id });
  ok('audit rows', audits.ok && audits.events.length >= 2);

  // Concurrent
  const cItem = makeReady('livec');
  await repo.insertReviewItems([cItem], [{ entityId: cItem.id, action: 'enqueue', timestamp: AS_OF }]);
  const cg = (await repo.getById(cItem.id)).item;
  const nextA = Object.assign({}, cg, { status: 'APPROVED', approvedAt: AS_OF });
  const [a1, a2] = await Promise.all([
    repo.transitionReviewItem({
      id: cItem.id,
      expectedStatus: 'READY_FOR_REVIEW',
      expectedLockVersion: cg.lockVersion,
      nextItem: nextA,
      auditEvents: [{ entityId: cItem.id, action: 'approve', timestamp: AS_OF }],
    }),
    repo.transitionReviewItem({
      id: cItem.id,
      expectedStatus: 'READY_FOR_REVIEW',
      expectedLockVersion: cg.lockVersion,
      nextItem: nextA,
      auditEvents: [{ entityId: cItem.id, action: 'approve', timestamp: AS_OF }],
    }),
  ]);
  ok(
    'concurrent one win',
    [a1, a2].filter(function (r) { return r.ok; }).length === 1,
  );

  // JSON vs DB bundle compare
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-pg-json-'));
  const jsonRepo = createJsonDailyIssueReviewRepository({ reviewRoot: tmp });
  jsonRepo.initialize();
  const jItem = makeReady('bundle');
  jsonRepo.insertReviewItems([jItem], [{ entityId: jItem.id, action: 'enqueue', timestamp: AS_OF }]);
  const jg = jsonRepo.getById(jItem.id).item;
  const ja = jsonRepo.transitionReviewItem({
    id: jItem.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: jg.lockVersion,
    nextItem: Object.assign({}, jg, { status: 'APPROVED', approvedAt: AS_OF }),
    auditEvents: [{ entityId: jItem.id, action: 'approve', timestamp: AS_OF }],
  });
  const jp = jsonRepo.transitionReviewItem({
    id: jItem.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: ja.item.lockVersion,
    nextItem: Object.assign({}, ja.item, {
      status: 'PUBLISHED',
      publishedAt: AS_OF,
      publishExpiresAt: '2026-08-07T12:00:00.000Z',
    }),
    auditEvents: [{ entityId: jItem.id, action: 'publish', timestamp: AS_OF }],
  });

  const dItem = makeReady('bundle_db');
  // Align ids for structural compare via same content fields
  dItem.title = jItem.title;
  await repo.insertReviewItems([dItem], [{ entityId: dItem.id, action: 'enqueue', timestamp: AS_OF }]);
  const dg = (await repo.getById(dItem.id)).item;
  const da = await repo.transitionReviewItem({
    id: dItem.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: dg.lockVersion,
    nextItem: Object.assign({}, dg, { status: 'APPROVED', approvedAt: AS_OF }),
    auditEvents: [{ entityId: dItem.id, action: 'approve', timestamp: AS_OF }],
  });
  const dp = await repo.transitionReviewItem({
    id: dItem.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: da.item.lockVersion,
    nextItem: Object.assign({}, da.item, {
      status: 'PUBLISHED',
      publishedAt: AS_OF,
      publishExpiresAt: '2026-08-07T12:00:00.000Z',
    }),
    auditEvents: [{ entityId: dItem.id, action: 'publish', timestamp: AS_OF }],
  });

  const jb = reviewCore.buildPublishedCentristBundleFromReviewState({
    publishedIssues: [jp.item],
    generatedAt: AS_OF,
  });
  const db = reviewCore.buildPublishedCentristBundleFromReviewState({
    publishedIssues: [dp.item],
    generatedAt: AS_OF,
  });
  function firstIssue(bundle) {
    const cats = bundle.categories || {};
    for (const k of Object.keys(cats)) {
      if (cats[k].issues && cats[k].issues[0]) return cats[k].issues[0];
    }
    return null;
  }
  const ji = firstIssue(jb);
  const di = firstIssue(db);
  ok('json/db bundle field parity', ji && di && ji.freshnessClass === di.freshnessClass && ji.publishExpiresAt === di.publishExpiresAt);
  ok('json/db no choices', !ji.choices && !di.choices && !ji.stance && !di.stance);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {}

  await executor.end();
  console.log('\n=== postgres repository: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped ===');
  process.exit(failed ? 1 : 0);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
