#!/usr/bin/env node
'use strict';

/**
 * SQL executor / memory-SQL repository 단위 테스트
 * (실 PostgreSQL 없이도 transaction·lockVersion·audit 원자성 검증)
 */

const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const contract = require('../shared/daily-issue-review-repository-contract');
const mapper = require('../server/daily-issue-review-sql-mapper');
const { createMemorySqlExecutor } = require('../server/daily-issue-memory-sql-executor');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createDbDailyIssueReviewRepository } = require('../server/daily-issue-review-db-repository');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');
const { validatePgClientConfig, resolveDailyIssueDatabaseUrl } = require('../server/daily-issue-pg-client');

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
    id: 's1_' + suffix,
    publisher: 'BBC',
    title: 't',
    url: 'https://bbc.example.com/' + suffix,
    publishedAt: '2026-08-04T10:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'bbc.example.com',
    contentHash: 'h1_' + suffix,
    rawText: 'SECRET_RAW_SHOULD_NOT_PERSIST',
  };
  const s2 = {
    id: 's2_' + suffix,
    publisher: 'Guardian',
    title: 't',
    url: 'https://guardian.example.com/' + suffix,
    publishedAt: '2026-08-04T12:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'guardian.example.com',
    contentHash: 'h2_' + suffix,
  };
  const text = 'Officials announced a new decision on border crisis after the crossing event occurred.';
  const evidences = [
    { id: 'ev1_' + suffix, sourceId: s1.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: 'ev2_' + suffix, sourceId: s2.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = quality.buildDailyIssueCandidate({
    title: 'EU responds to border crossing crisis ' + suffix,
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: 'c1_' + suffix,
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
      clusterId: 'cl_' + suffix,
      category: 'world',
      candidateId: 'cand_' + suffix,
    }),
    { asOf: AS_OF, existingItems: [] },
  ).item;
}

async function run() {
  // Config: never auto-use DATABASE_URL
  const savedDb = process.env.DATABASE_URL;
  const savedDi = process.env.DAILY_ISSUE_DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://ops:secret@ops-host/ops';
  delete process.env.DAILY_ISSUE_DATABASE_URL;
  ok('env. DAILY_ISSUE_DATABASE_URL only', !resolveDailyIssueDatabaseUrl({}));
  ok('env. validate fail-closed', !validatePgClientConfig({}).valid);
  const noFallback = createDailyIssueReviewRepository({ kind: 'db' });
  const nfInit = await Promise.resolve(noFallback.initialize());
  ok('env. db without daily url → UNAVAILABLE', !nfInit.ok && nfInit.error === contract.ERROR_CODES.DATABASE_UNAVAILABLE);
  ok('env. no JSON fallback kind', noFallback.kind === 'db');
  if (savedDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
  if (savedDi === undefined) delete process.env.DAILY_ISSUE_DATABASE_URL;
  else process.env.DAILY_ISSUE_DATABASE_URL = savedDi;

  // Mapper jsonb round-trip
  const item0 = makeReady('map');
  item0.qualityMeta = { independentSourceCount: 2, nested: { a: 1 } };
  const row = mapper.itemToRow(item0);
  ok('mapper. rawText stripped from document', !JSON.stringify(row.document).includes('SECRET_RAW'));
  const back = mapper.rowToItem(row);
  ok('mapper. status round-trip', back.status === item0.status);
  ok('mapper. qualityMeta round-trip', back.qualityMeta && back.qualityMeta.independentSourceCount === 2);
  ok('mapper. lockVersion default', back.lockVersion === 1);

  // Memory SQL repository contract
  const exec = createMemorySqlExecutor({ schemaName: 'daily_issue_test' });
  const repo = createSqlDailyIssueReviewRepository({ executor: exec });
  ok('sql. initialize', (await repo.initialize()).ok);
  ok('sql. healthCheck', (await repo.healthCheck()).ok);
  ok('sql. empty list', (await repo.list({})).count === 0);

  const item = makeReady('sql_a');
  const ins = await repo.insertReviewItems(
    [item],
    [{ entityId: item.id, fromStatus: null, toStatus: item.status, action: 'enqueue', timestamp: AS_OF }],
  );
  ok('sql. insert READY', ins.ok, JSON.stringify(ins));

  const dup = await repo.insertReviewItems([item], [{ entityId: item.id, action: 'enqueue', timestamp: AS_OF }]);
  ok('sql. duplicate candidate/version', !dup.ok && dup.error === contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION);

  const byId = await repo.getById(item.id);
  ok('sql. getById', byId.ok && byId.item.title === item.title);
  ok('sql. sourceRefs preserved', (byId.item.sourceRefs || []).length >= 2);
  ok('sql. claims preserved', (byId.item.claims || []).length >= 1);
  ok('sql. no rawText', !JSON.stringify(byId.item).includes('SECRET_RAW'));

  const approved = Object.assign({}, byId.item, { status: 'APPROVED', approvedAt: AS_OF, reviewedAt: AS_OF });
  const appr = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: byId.item.lockVersion,
    nextItem: approved,
    auditEvents: [
      { entityId: item.id, fromStatus: 'READY_FOR_REVIEW', toStatus: 'APPROVED', action: 'approve', timestamp: AS_OF },
    ],
  });
  ok('sql. READY→APPROVED', appr.ok && appr.item && appr.item.status === 'APPROVED', JSON.stringify(appr));
  ok('sql. lockVersion +1', appr.ok && appr.item && appr.item.lockVersion === byId.item.lockVersion + 1);

  const stale = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: byId.item.lockVersion,
    nextItem: Object.assign({}, appr.item, { status: 'PUBLISHED', publishedAt: AS_OF }),
    auditEvents: [{ entityId: item.id, action: 'publish', timestamp: AS_OF }],
  });
  ok('sql. stale lockVersion blocked', !stale.ok && stale.error === contract.ERROR_CODES.STALE_VERSION);

  const pub = await repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: appr.item.lockVersion,
    nextItem: Object.assign({}, appr.item, {
      status: 'PUBLISHED',
      publishedAt: AS_OF,
      publishExpiresAt: '2026-08-07T12:00:00.000Z',
    }),
    auditEvents: [
      { entityId: item.id, fromStatus: 'APPROVED', toStatus: 'PUBLISHED', action: 'publish', timestamp: AS_OF },
    ],
  });
  ok('sql. APPROVED→PUBLISHED', pub.ok && pub.item.status === 'PUBLISHED');
  ok('sql. publishExpiresAt', pub.item.publishExpiresAt === '2026-08-07T12:00:00.000Z');

  const audits = await repo.listAuditEvents({ entityId: item.id });
  ok('sql. audit same txn path', audits.ok && audits.events.length >= 2);

  // Concurrent approve — only one wins
  const item2 = makeReady('sql_conc');
  await repo.insertReviewItems([item2], [{ entityId: item2.id, action: 'enqueue', timestamp: AS_OF }]);
  const g2 = (await repo.getById(item2.id)).item;
  const nextA = Object.assign({}, g2, { status: 'APPROVED', approvedAt: AS_OF });
  const [t1, t2] = await Promise.all([
    repo.transitionReviewItem({
      id: item2.id,
      expectedStatus: 'READY_FOR_REVIEW',
      expectedLockVersion: g2.lockVersion,
      nextItem: nextA,
      auditEvents: [{ entityId: item2.id, action: 'approve', timestamp: AS_OF }],
    }),
    repo.transitionReviewItem({
      id: item2.id,
      expectedStatus: 'READY_FOR_REVIEW',
      expectedLockVersion: g2.lockVersion,
      nextItem: nextA,
      auditEvents: [{ entityId: item2.id, action: 'approve', timestamp: AS_OF }],
    }),
  ]);
  const wins = [t1, t2].filter(function (r) {
    return r.ok;
  }).length;
  const loses = [t1, t2].filter(function (r) {
    return !r.ok;
  });
  ok('sql. concurrent approve one win', wins === 1 && loses.length === 1, JSON.stringify([t1.error, t2.error]));

  // Audit failure rollback
  const item3 = makeReady('sql_aud');
  await repo.insertReviewItems([item3], [{ entityId: item3.id, action: 'enqueue', timestamp: AS_OF }]);
  const beforeAud = (await repo.listAuditEvents({})).events.length;
  const g3 = (await repo.getById(item3.id)).item;
  repo.setTestHooks({ failAudit: true });
  const failT = await repo.transitionReviewItem({
    id: item3.id,
    expectedStatus: g3.status,
    expectedLockVersion: g3.lockVersion,
    nextItem: Object.assign({}, g3, { status: 'APPROVED', approvedAt: AS_OF }),
    auditEvents: [{ entityId: item3.id, action: 'approve', timestamp: AS_OF }],
  });
  repo.clearTestHooks();
  ok('sql. audit fail rollback', !failT.ok && failT.rolledBack);
  ok('sql. status unchanged after audit fail', (await repo.getById(item3.id)).item.status === g3.status);
  ok('sql. audit count unchanged', (await repo.listAuditEvents({})).events.length === beforeAud);

  // Source insert fail rollback
  const item4 = makeReady('sql_src');
  repo.setTestHooks({ failSource: true });
  const failS = await repo.insertReviewItems([item4], [{ entityId: item4.id, action: 'enqueue', timestamp: AS_OF }]);
  repo.clearTestHooks();
  ok('sql. source fail rollback', !failS.ok && failS.rolledBack);
  ok('sql. item absent after source fail', !(await repo.getById(item4.id)).ok);

  // Factory with executor
  const exec2 = createMemorySqlExecutor({ schemaName: 'daily_issue_test' });
  const viaFactory = createDbDailyIssueReviewRepository({ executor: exec2 });
  ok('factory. sql via executor', (await viaFactory.initialize()).ok);

  // Bundle parity fields
  const pubItem = (await repo.getById(item.id)).item;
  const bundle = reviewCore.buildPublishedCentristBundleFromReviewState({
    publishedIssues: [pubItem],
    generatedAt: AS_OF,
    bundleVersion: 'sql-test',
  });
  const issues = [];
  Object.keys(bundle.categories || {}).forEach(function (cat) {
    (bundle.categories[cat].issues || []).forEach(function (iss) {
      issues.push(iss);
    });
  });
  ok('sql. bundle has published', issues.length >= 1);
  ok('sql. bundle no choices', issues.every(function (i) { return !i.choices && !i.stance; }));
  ok('sql. bundle no reviewerId', issues.every(function (i) { return !i.reviewerId; }));
  ok('sql. bundle no rawText', !JSON.stringify(issues).includes('SECRET_RAW'));

  console.log('\n=== sql executor unit: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed ? 1 : 0);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
