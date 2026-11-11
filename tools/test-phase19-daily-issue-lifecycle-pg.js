#!/usr/bin/env node
'use strict';

/**
 * Phase 19 — 격리 DB lifecycle: 발행·숨김·버전·재조회(별도 연결). 실게시·유료 AI 없음.
 */

const reviewService = require('../server/daily-issue-review-service');
const opsCore = require('../shared/daily-issue-ops-core');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const AS_OF = '2026-09-01T00:00:00.000Z';
const PREFIX = 'p19life_' + Date.now().toString(36);

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

function freshPair(url) {
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  const repo = createSqlDailyIssueReviewRepository({ executor: ex, schemaName: SCHEMA, enabled: true });
  return { ex: ex, repo: repo };
}

function makeReady(suffix) {
  const s1 = {
    id: PREFIX + '_s1_' + suffix,
    publisher: '통계청',
    title: 't',
    url: 'https://kostat.go.kr/life/' + suffix,
    publishedAt: '2026-08-31T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: PREFIX + '_s2_' + suffix,
    publisher: '연합뉴스',
    title: 't2',
    url: 'https://www.yna.co.kr/life/' + suffix,
    publishedAt: '2026-08-31T02:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.yna.co.kr',
  };
  const text = '통계청이 고용 통계를 공식 발표했다. ' + suffix;
  const built = quality.buildDailyIssueCandidate({
    title: '고용 통계 발표 ' + suffix,
    discussionPrompt: '평가?',
    sources: [s1, s2],
    evidences: [
      { id: PREFIX + '_e1_' + suffix, sourceId: s1.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
      { id: PREFIX + '_e2_' + suffix, sourceId: s2.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    ],
    candidateClaims: [
      {
        id: PREFIX + '_c1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [PREFIX + '_e1_' + suffix, PREFIX + '_e2_' + suffix],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: PREFIX + '_id_' + suffix,
      clusterId: PREFIX + '_cl_' + suffix,
      candidateId: PREFIX + '_cand_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'KR',
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  return opsCore.ensureOpsMeta(created.item, AS_OF);
}

async function main() {
  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  const gate = assertDailyIssueIsolatedTarget(url, SCHEMA);
  if (!gate.ok || !isAllowedTestSchema(SCHEMA)) {
    console.log('PHASE19_LIFECYCLE_PG', 'SKIPPED', gate.reason || 'schema');
    console.log('PHASE19_LIFECYCLE_VERDICT', 'SKIPPED');
    process.exit(2);
  }

  const write = freshPair(url);
  if (!write.ex.ok) {
    console.log('PHASE19_LIFECYCLE_VERDICT', 'SKIPPED');
    process.exit(2);
  }
  await Promise.resolve(write.repo.initialize());

  const item = makeReady('main');
  const itemUs = makeReady('us_side');
  itemUs.activityRegion = 'US';
  itemUs.id = PREFIX + '_us_id';
  itemUs.candidateId = PREFIX + '_us_cand';
  itemUs.lifecycleMeta = { activityRegion: 'US' };

  try {
    const ins = await Promise.resolve(
      write.repo.insertReviewItems([item, itemUs], [
        { entityId: item.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19', timestamp: AS_OF },
        { entityId: itemUs.id, fromStatus: null, toStatus: 'READY_FOR_REVIEW', action: 'enqueue', actorId: 'p19', timestamp: AS_OF },
      ]),
    );
    ok('insert queue', ins.ok);

    const appr = await Promise.resolve(
      reviewService.transitionItem(item.id, 'APPROVED', {
        repositoryInstance: write.repo,
        operatorApproval: true,
        reviewer: 'admin',
        asOf: AS_OF,
      }),
    );
    ok('operator approve', appr.ok, appr.error);

    const pub = await Promise.resolve(
      reviewService.transitionItem(item.id, 'PUBLISHED', {
        repositoryInstance: write.repo,
        operatorApproval: true,
        reviewer: 'admin',
        asOf: '2026-09-01T01:00:00.000Z',
      }),
    );
    ok('publish KR', pub.ok, pub.error);

    const read1 = freshPair(url);
    await Promise.resolve(read1.repo.initialize());
    const gotPub = await Promise.resolve(read1.repo.getById(item.id));
    ok('re-read published conn2', gotPub.ok && gotPub.item && gotPub.item.status === 'PUBLISHED', gotPub.item && gotPub.item.status);
    await read1.ex.end();

    const dupPub = await Promise.resolve(
      reviewService.transitionItem(item.id, 'PUBLISHED', {
        repositoryInstance: write.repo,
        operatorApproval: true,
        reviewer: 'admin',
        asOf: '2026-09-01T02:00:00.000Z',
        expectedStatus: 'PUBLISHED',
      }),
    );
    ok('duplicate publish blocked', dupPub.ok === false);

    const retired = await Promise.resolve(
      reviewService.transitionItem(item.id, 'RETIRED', {
        repositoryInstance: write.repo,
        actorId: 'admin',
        reason: 'MANUAL_RETIRE',
        reasonText: 'hide test',
        asOf: '2026-09-01T03:00:00.000Z',
      }),
    );
    ok('retire/hide path', retired.ok, retired.error);

    const readUs = freshPair(url);
    await Promise.resolve(readUs.repo.initialize());
    const usStill = await Promise.resolve(readUs.repo.getById(itemUs.id));
    ok('US item unaffected by KR retire', usStill.ok && usStill.item && usStill.item.status === 'READY_FOR_REVIEW');
    await readUs.ex.end();

    const badPub = await Promise.resolve(
      reviewService.transitionItem(itemUs.id, 'PUBLISHED', {
        repositoryInstance: write.repo,
        asOf: AS_OF,
      }),
    );
    ok('unauthorized publish blocked', badPub.ok === false, badPub.error);
  } catch (e) {
    failed += 1;
    console.error('FAIL exception', e && e.message ? e.message : e);
  } finally {
    await write.ex.end();
  }

  console.log('\nPhase19 lifecycle PG:', passed, 'passed,', failed, 'failed');
  if (failed) {
    console.log('PHASE19_LIFECYCLE_VERDICT', 'FAIL');
    process.exit(1);
  }
  console.log('PHASE19_LIFECYCLE_VERDICT', 'PASS');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
