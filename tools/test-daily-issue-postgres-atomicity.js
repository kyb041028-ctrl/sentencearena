#!/usr/bin/env node
'use strict';

/**
 * 실 PostgreSQL 원자성·JSONB·timestamp 보강 검증
 */

require('dotenv').config();

const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const contract = require('../shared/daily-issue-review-repository-contract');
const { createDailyIssuePgExecutor, isAllowedTestSchema, maskDatabaseUrl } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');

const AS_OF = '2026-08-05T12:00:00.000Z';
let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function makeReady(suffix) {
  const s1 = {
    id: 'pg2_s1_' + suffix,
    publisher: 'BBC',
    title: 't',
    url: 'https://bbc.example.com/pg2/' + suffix,
    publishedAt: '2026-08-04T10:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'bbc.example.com',
    contentHash: 'pg2_h1_' + suffix,
  };
  const s2 = {
    id: 'pg2_s2_' + suffix,
    publisher: 'Guardian',
    title: 't',
    url: 'https://guardian.example.com/pg2/' + suffix,
    publishedAt: '2026-08-04T12:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'guardian.example.com',
    contentHash: 'pg2_h2_' + suffix,
  };
  const text = 'Officials announced a new decision on border crisis after the crossing event occurred.';
  const evidences = [
    { id: 'pg2_ev1_' + suffix, sourceId: s1.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: 'pg2_ev2_' + suffix, sourceId: s2.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = quality.buildDailyIssueCandidate({
    title: 'EU responds to border crossing crisis ' + suffix,
    discussionPrompt: '평가?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: 'pg2_c1_' + suffix,
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
      clusterId: 'pg2_cl_' + suffix,
      category: 'world',
      candidateId: 'pg2_cand_' + suffix,
    }),
    { asOf: AS_OF, existingItems: [] },
  ).item;
}

async function reset(executor, schema) {
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

async function main() {
  const url = String(process.env.DAILY_ISSUE_DATABASE_URL || '').trim();
  const schema = String(process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test').trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, reason: 'NO_URL' }));
    process.exit(0);
  }
  if (!isAllowedTestSchema(schema)) {
    console.log(JSON.stringify({ ok: false, error: 'SCHEMA_NOT_ALLOWED' }));
    process.exit(1);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.log(JSON.stringify({ ok: false, error: 'PRODUCTION' }));
    process.exit(1);
  }

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: schema });
  const repo = createSqlDailyIssueReviewRepository({ executor: executor });
  const init = await repo.initialize();
  ok('init', init.ok, JSON.stringify(init));
  if (!init.ok) process.exit(1);

  await reset(executor, schema);
  console.log('connected', maskDatabaseUrl(url), 'schema=' + schema);

  const item = makeReady('atom');
  item.qualityMeta = Object.assign({}, item.qualityMeta, { nestedProbe: { a: 1, b: [2, 3] } });
  item.freshnessMeta = Object.assign({}, item.freshnessMeta, { probeClass: item.freshnessClass });
  const ins = await repo.insertReviewItems([item], [{ entityId: item.id, action: 'enqueue', timestamp: AS_OF }]);
  ok('insert', ins.ok, JSON.stringify(ins));

  const loaded = await repo.getById(item.id);
  ok('jsonb qualityMeta nested', loaded.ok && loaded.item.qualityMeta && loaded.item.qualityMeta.nestedProbe && loaded.item.qualityMeta.nestedProbe.a === 1);
  ok('evidenceRefs preserved', (loaded.item.evidenceRefs || loaded.item.evidences || []).length >= 2);
  ok('claims evidenceIds', loaded.item.claims && loaded.item.claims[0] && loaded.item.claims[0].evidenceIds.length >= 2);
  ok('source publishedAt iso', String(loaded.item.sourceRefs[0].publishedAt).indexOf('2026-08-04') === 0);
  ok('queuedAt preserved', !!loaded.item.queuedAt);

  // A: audit fail rollback
  const beforeStatus = loaded.item.status;
  const beforeLock = loaded.item.lockVersion;
  const beforeAud = (await repo.listAuditEvents({ entityId: item.id })).events.length;
  repo.setTestHooks({ failAudit: true });
  const failA = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: beforeStatus,
    expectedLockVersion: beforeLock,
    nextItem: Object.assign({}, loaded.item, { status: 'APPROVED', approvedAt: AS_OF }),
    auditEvents: [{ entityId: item.id, action: 'approve', timestamp: AS_OF }],
  });
  repo.clearTestHooks();
  const afterFail = await repo.getById(item.id);
  const afterAud = (await repo.listAuditEvents({ entityId: item.id })).events.length;
  ok('A audit fail rolledBack', !failA.ok && failA.rolledBack);
  ok('A status unchanged', afterFail.item.status === beforeStatus);
  ok('A lockVersion unchanged', afterFail.item.lockVersion === beforeLock);
  ok('A audit count unchanged', afterAud === beforeAud);

  // B: source insert fail rollback
  const itemB = makeReady('srcfail');
  repo.setTestHooks({ failSource: true });
  const failB = await repo.insertReviewItems([itemB], [{ entityId: itemB.id, action: 'enqueue', timestamp: AS_OF }]);
  repo.clearTestHooks();
  ok('B source fail rolledBack', !failB.ok && failB.rolledBack);
  ok('B item absent', !(await repo.getById(itemB.id)).ok);

  // stale + success lock bump
  const g = (await repo.getById(item.id)).item;
  const appr = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: g.lockVersion,
    nextItem: Object.assign({}, g, { status: 'APPROVED', approvedAt: AS_OF }),
    auditEvents: [{ entityId: item.id, fromStatus: 'READY_FOR_REVIEW', toStatus: 'APPROVED', action: 'approve', timestamp: AS_OF }],
  });
  ok('approve ok', appr.ok && appr.item.lockVersion === g.lockVersion + 1);
  const stale = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: g.lockVersion,
    nextItem: Object.assign({}, appr.item, { status: 'PUBLISHED', publishedAt: AS_OF }),
    auditEvents: [{ entityId: item.id, action: 'publish', timestamp: AS_OF }],
  });
  ok('stale lock blocked', !stale.ok && (stale.error === contract.ERROR_CODES.STALE_VERSION || stale.error === contract.ERROR_CODES.CONCURRENT_MODIFICATION || stale.error === contract.ERROR_CODES.STATUS_CHANGED));

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
  ok('publishExpiresAt', pub.ok && pub.item.publishExpiresAt === '2026-08-07T12:00:00.000Z');

  // fail-closed no JSON fallback
  const bad = createDailyIssueReviewRepository({ kind: 'db', databaseUrl: '', enabled: true });
  const badInit = await Promise.resolve(bad.initialize());
  ok('G fail-closed', !badInit.ok && badInit.error === contract.ERROR_CODES.DATABASE_UNAVAILABLE);
  ok('G kind stays db', bad.kind === 'db');

  await reset(executor, schema);
  await executor.end();
  console.log('\n=== postgres atomicity extra: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
