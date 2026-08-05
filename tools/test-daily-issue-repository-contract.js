#!/usr/bin/env node
'use strict';

/**
 * Repository contract — JSON + fake DB 동일 테스트
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const contract = require('../shared/daily-issue-review-repository-contract');
const { createDailyIssueReviewRepository, assertRepositoryContract } = require('../server/daily-issue-review-repository');
const { createJsonDailyIssueReviewRepository } = require('../server/daily-issue-review-json-repository');
const { createFakeDbDailyIssueReviewRepository } = require('../server/daily-issue-review-db-repository');

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
    id: 's1',
    publisher: 'BBC',
    title: 't',
    url: 'https://bbc.example.com/' + suffix,
    publishedAt: '2026-08-04T10:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'bbc.example.com',
    contentHash: 'h1_' + suffix,
  };
  const s2 = {
    id: 's2',
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
    { id: 'ev1', sourceId: 's1', text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: 'ev2', sourceId: 's2', text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = quality.buildDailyIssueCandidate({
    title: 'EU responds to border crossing crisis ' + suffix,
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: 'c1',
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['ev1', 'ev2'],
        supportingSourceIds: ['s1', 's2'],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      clusterId: 'cl_' + suffix,
      category: 'world',
      candidateId: 'cand_' + suffix,
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  return created.item;
}

function runContractSuite(label, createRepo) {
  console.log('\n--- contract suite:', label, '---');
  const repo = createRepo();
  ok(label + ' 1. initialize', repo.initialize().ok);
  ok(label + ' contract shape', assertRepositoryContract(repo).ok);

  const empty = repo.list({});
  ok(label + ' 2. 빈 list', empty.ok && empty.count === 0);

  const item = makeReady(label + '_a');
  const ins = repo.insertReviewItems(
    [item],
    [{ entityId: item.id, fromStatus: null, toStatus: item.status, action: 'enqueue', timestamp: AS_OF }],
  );
  ok(label + ' 3. READY insert', ins.ok, JSON.stringify(ins));

  const dup = repo.insertReviewItems([item], [{ entityId: item.id, action: 'enqueue', timestamp: AS_OF }]);
  ok(label + ' 4. candidate+version 중복 차단', !dup.ok && dup.error === contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION);

  const byId = repo.getById(item.id);
  ok(label + ' 5. getById', byId.ok && byId.item.title === item.title);
  ok(label + ' 6. getByCandidateId', repo.getByCandidateId(item.candidateId).ok);

  const byStatus = repo.findByStatus(['READY_FOR_REVIEW']);
  ok(label + ' 7. status filter', byStatus.ok && byStatus.items.length >= 1);

  const approved = Object.assign({}, byId.item, {
    status: 'APPROVED',
    approvedAt: AS_OF,
    reviewedAt: AS_OF,
  });
  const appr = repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: byId.item.lockVersion,
    nextItem: approved,
    auditEvents: [
      {
        entityId: item.id,
        fromStatus: 'READY_FOR_REVIEW',
        toStatus: 'APPROVED',
        action: 'approve',
        timestamp: AS_OF,
      },
    ],
  });
  ok(label + ' 8. READY→APPROVED', appr.ok && appr.item.status === 'APPROVED', JSON.stringify(appr));
  ok(label + ' 17. lockVersion 증가', appr.ok && appr.item.lockVersion === byId.item.lockVersion + 1);

  const stale = repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: byId.item.lockVersion,
    nextItem: Object.assign({}, appr.item, { status: 'PUBLISHED', publishedAt: AS_OF }),
    auditEvents: [{ entityId: item.id, action: 'publish', timestamp: AS_OF }],
  });
  ok(label + ' 16. lockVersion 불일치 차단', !stale.ok && stale.error === contract.ERROR_CODES.STALE_VERSION);

  const published = Object.assign({}, appr.item, {
    status: 'PUBLISHED',
    publishedAt: AS_OF,
    publishExpiresAt: '2026-08-07T12:00:00.000Z',
  });
  const pub = repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'APPROVED',
    expectedLockVersion: appr.item.lockVersion,
    nextItem: published,
    auditEvents: [
      {
        entityId: item.id,
        fromStatus: 'APPROVED',
        toStatus: 'PUBLISHED',
        action: 'publish',
        timestamp: AS_OF,
      },
    ],
  });
  ok(label + ' 9. APPROVED→PUBLISHED', pub.ok && pub.item.status === 'PUBLISHED');

  const wrong = repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: pub.item.lockVersion,
    nextItem: Object.assign({}, pub.item, { status: 'APPROVED' }),
    auditEvents: [{ entityId: item.id, action: 'bad', timestamp: AS_OF }],
  });
  ok(label + ' 15. expectedStatus 불일치', !wrong.ok && wrong.error === contract.ERROR_CODES.STATUS_CHANGED);

  const audits = repo.listAuditEvents({ entityId: item.id });
  ok(label + ' 12. audit 기록', audits.ok && audits.events.length >= 2);

  // concurrent: second approve-like on same version fails
  const item2 = makeReady(label + '_conc');
  repo.insertReviewItems([item2], [{ entityId: item2.id, action: 'enqueue', timestamp: AS_OF }]);
  const g2 = repo.getById(item2.id).item;
  const nextA = Object.assign({}, g2, { status: 'APPROVED', approvedAt: AS_OF });
  const t1 = repo.transitionReviewItem({
    id: item2.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: g2.lockVersion,
    nextItem: nextA,
    auditEvents: [{ entityId: item2.id, action: 'approve', timestamp: AS_OF }],
  });
  const t2 = repo.transitionReviewItem({
    id: item2.id,
    expectedStatus: 'READY_FOR_REVIEW',
    expectedLockVersion: g2.lockVersion,
    nextItem: nextA,
    auditEvents: [{ entityId: item2.id, action: 'approve', timestamp: AS_OF }],
  });
  ok(label + ' 18. 동시 전환 하나만 성공', t1.ok && !t2.ok && (t2.error === contract.ERROR_CODES.STALE_VERSION || t2.error === contract.ERROR_CODES.STATUS_CHANGED || t2.error === contract.ERROR_CODES.CONCURRENT_MODIFICATION));

  const pubList = repo.getPublishedIssues({});
  ok(label + ' 20. published 목록', pubList.ok && pubList.items.some(function (i) { return i.id === item.id; }));

  const hist = repo.getRecentHistoricalIssues({ lookbackDays: 30, asOf: AS_OF });
  ok(label + ' 21. recent historical', hist.ok && hist.items.length >= 1);

  const retired = Object.assign({}, pub.item, { status: 'RETIRED', retiredAt: AS_OF, retireReason: 'MANUAL_RETIRE' });
  const ret = repo.transitionReviewItem({
    id: item.id,
    expectedStatus: 'PUBLISHED',
    expectedLockVersion: pub.item.lockVersion,
    nextItem: retired,
    auditEvents: [
      {
        entityId: item.id,
        fromStatus: 'PUBLISHED',
        toStatus: 'RETIRED',
        action: 'retire',
        timestamp: AS_OF,
      },
    ],
  });
  ok(label + ' 10. PUBLISHED→RETIRED', ret.ok);

  // meta preservation
  ok(label + ' 28. qualityMeta', !!(byId.item.qualityMeta));
  ok(label + ' 29. freshnessMeta', !!(byId.item.freshnessMeta));
  ok(label + ' 30. duplicateMeta', byId.item.duplicateMeta != null);
  ok(label + ' 31. eventIdentity', !!byId.item.eventIdentity);

  // audit fail rollback (fake DB hooks / json hooks)
  if (typeof repo.setTestHooks === 'function') {
    const item3 = makeReady(label + '_aud');
    repo.clearTestHooks();
    repo.insertReviewItems([item3], [{ entityId: item3.id, action: 'enqueue', timestamp: AS_OF }]);
    const beforeCount = repo.list({}).count;
    const beforeAud = repo.listAuditEvents({}).events.length;
    repo.setTestHooks({ failAppend: true, failAudit: true });
    const g3 = repo.getById(item3.id).item;
    const failT = repo.transitionReviewItem({
      id: item3.id,
      expectedStatus: g3.status,
      expectedLockVersion: g3.lockVersion,
      nextItem: Object.assign({}, g3, { status: 'APPROVED', approvedAt: AS_OF }),
      auditEvents: [{ entityId: item3.id, action: 'approve', timestamp: AS_OF }],
    });
    repo.clearTestHooks();
    ok(label + ' 13. audit 실패 rollback', !failT.ok && failT.rolledBack);
    ok(label + ' 14. 실패 시 상태 유지', repo.getById(item3.id).item.status === g3.status);
    ok(label + ' audit count 불변', repo.listAuditEvents({}).events.length === beforeAud);
    ok(label + ' list count 불변', repo.list({}).count === beforeCount);
  }

  // write fail
  if (typeof repo.setTestHooks === 'function') {
    const item4 = makeReady(label + '_wr');
    repo.insertReviewItems([item4], [{ entityId: item4.id, action: 'enqueue', timestamp: AS_OF }]);
    const g4 = repo.getById(item4.id).item;
    repo.setTestHooks({ failPersist: true, failWrite: true });
    const failW = repo.transitionReviewItem({
      id: item4.id,
      expectedStatus: g4.status,
      expectedLockVersion: g4.lockVersion,
      nextItem: Object.assign({}, g4, { status: 'APPROVED' }),
      auditEvents: [{ entityId: item4.id, action: 'approve', timestamp: AS_OF }],
    });
    repo.clearTestHooks();
    ok(label + ' write 실패 rollback', !failW.ok);
    ok(label + ' write 실패 상태 유지', repo.getById(item4.id).item.status === g4.status);
  }

  // UPDATE_PENDING store
  const upd = makeReady(label + '_upd');
  upd.status = 'UPDATE_PENDING';
  upd.updateType = 'FOLLOW_UP';
  const updIns = repo.insertReviewItems([upd], [{ entityId: upd.id, action: 'enqueue', timestamp: AS_OF }]);
  ok(label + ' 22. UPDATE_PENDING 저장', updIns.ok);

  const man = repo.buildManifestSnapshot();
  ok(label + ' manifest', man.ok && man.manifest);

  // bundle identity
  const pubItem = pub.item;
  const bundle = reviewCore.buildPublishedCentristBundleFromReviewState({
    publishedIssues: [Object.assign({}, pubItem, { status: 'PUBLISHED' })],
    generatedAt: AS_OF,
  });
  const issue0 = bundle.categories.world && bundle.categories.world.issues[0];
  ok(label + ' 33. bundle PUBLISHED', bundle.publishedCount === 1);
  ok(label + ' 34. choices/stance 없음', issue0 && !issue0.choices && !issue0.stance);
  ok(label + ' 35. reviewerId 제외', issue0 && issue0.reviewerId == null);
  ok(label + ' 36. rawText 제외', !(issue0.sourceRefs || []).some(function (s) { return s.rawText; }));

  return { repo: repo, publishedItem: pub.item };
}

// JSON suite
const jsonRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-repo-json-'));
const jsonResult = runContractSuite('json', function () {
  return createJsonDailyIssueReviewRepository({ reviewRoot: jsonRoot });
});

// Fake DB suite
const fakeResult = runContractSuite('fake-db', function () {
  return createFakeDbDailyIssueReviewRepository({});
});

// DB unavailable — no JSON fallback
{
  const db = createDailyIssueReviewRepository({ kind: 'db', enabled: false });
  const init = db.initialize();
  ok('38/39. DB unavailable fail-closed', !init.ok && init.error === contract.ERROR_CODES.DATABASE_UNAVAILABLE);
  const listed = db.list({});
  ok('39b. DB 선택 후 JSON fallback 없음', !listed.ok && listed.error === contract.ERROR_CODES.DATABASE_UNAVAILABLE);
}

// JSON/DB bundle structural compare using same candidate flow via service would be heavier;
// compare serialized published item fields from both suites' first published item shapes
{
  const a = jsonResult.publishedItem;
  const b = fakeResult.publishedItem;
  ok(
    '31-ish JSON/DB field parity (status/freshness/sourceCount)',
    a &&
      b &&
      a.status === 'PUBLISHED' &&
      b.status === 'PUBLISHED' &&
      (a.sourceRefs || []).length === (b.sourceRefs || []).length,
  );
}

// dry-run
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-repo-dry-'));
  const repo = createJsonDailyIssueReviewRepository({ reviewRoot: root });
  repo.initialize();
  const item = makeReady('dry');
  const dry = repo.insertReviewItems([item], [], { dryRun: true });
  ok('40. dry-run 무변경', dry.ok && dry.dryRun && repo.list({}).count === 0);
}

console.log('\n=== repository contract:', passed, 'passed,', failed, 'failed ===');
process.exit(failed ? 1 : 0);
