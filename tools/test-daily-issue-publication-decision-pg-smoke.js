#!/usr/bin/env node
'use strict';

/**
 * 자동 게시 정책 — 실 PostgreSQL smoke (daily_issue_test only)
 * DAILY_ISSUE_DATABASE_URL 없으면 SKIPPED (가짜 PASS 금지)
 */

require('dotenv').config({ path: '.env' });

const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const decision = require('../shared/daily-issue-publication-decision-core');
const reviewService = require('../server/daily-issue-review-service');
const { createDailyIssuePgExecutor, isAllowedTestSchema, maskDatabaseUrl } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');

const AS_OF = '2026-08-06T01:00:00.000Z';
const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const PREFIX = 'pubdec_smoke_' + Date.now().toString(36) + '_';

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

function makeItem(kind) {
  const id = PREFIX + kind;
  const isAuto = kind === 'auto';
  const title = isAuto
    ? '통계청, 고용 통계 공식 발표 ' + id
    : '여야 정치 갈등 이슈 ' + id;
  const summary = isAuto
    ? '통계청이 고용 통계를 공식 발표했다.'
    : '정치 갈등이 커지고 있다.';
  const s1 = {
    id: id + '_s1',
    publisher: '통계청',
    title: isAuto ? '보도자료' : '기사1',
    url: 'https://kostat.go.kr/smoke/' + id,
    publishedAt: '2026-08-05T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: id + '_s2',
    publisher: '연합뉴스',
    title: isAuto ? '관련 기사' : '기사2',
    url: 'https://www.yna.co.kr/smoke/' + id,
    publishedAt: '2026-08-05T02:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.yna.co.kr',
  };
  const evidences = [
    { id: id + '_e1', sourceId: s1.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: id + '_e2', sourceId: s2.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = quality.buildDailyIssueCandidate({
    title: title,
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: id + '_c1',
        text: summary,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [evidences[0].id, evidences[1].id],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, {
    asOf: AS_OF,
    category: isAuto ? 'korea-economy' : 'korea-politics',
  });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      clusterId: 'cl_' + id,
      category: isAuto ? 'korea-economy' : 'korea-politics',
      candidateId: id,
      contentSignature: 'sig_' + id,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  const attached = decision.attachDecisionToItem(
    Object.assign({}, created.item, {
      id: id,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    { asOf: AS_OF },
  );
  return attached;
}

async function cleanup(repo, ids) {
  for (let i = 0; i < ids.length; i++) {
    try {
      const got = await Promise.resolve(repo.getById(ids[i]));
      if (!got || !got.ok || !got.item) continue;
      const st = got.item.status;
      if (st === 'PUBLISHED' || st === 'APPROVED') {
        await Promise.resolve(
          reviewService.transitionItem(ids[i], 'RETIRED', {
            repositoryInstance: repo,
            actorId: 'pubdec_smoke',
            reason: 'MANUAL_RETIRE',
            reasonText: 'smoke cleanup',
            asOf: new Date().toISOString(),
          }),
        );
      }
    } catch (_) {}
  }
}

async function main() {
  console.log('=== publication decision PG smoke ===');
  console.log('schema:', SCHEMA);

  if (!isAllowedTestSchema(SCHEMA)) {
    skip('schema gate', 'schema must be daily_issue_test (got ' + SCHEMA + ')');
    console.log('\nResults:', passed, 'passed,', failed, 'failed,', skipped, 'skipped');
    process.exit(failed ? 1 : 0);
  }

  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  if (!url) {
    skip('database', 'DAILY_ISSUE_DATABASE_URL missing');
    console.log('\nResults:', passed, 'passed,', failed, 'failed,', skipped, 'skipped');
    process.exit(0);
  }

  console.log('database:', maskDatabaseUrl(url));

  let executor;
  let repo;
  const ids = [];
  try {
    executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
    if (!executor.ok) {
      skip('pg executor', executor.message || 'unavailable');
      console.log('\nPG smoke results:', passed, 'passed,', failed, 'failed,', skipped, 'skipped');
      process.exit(0);
    }
    const hc = await executor.healthCheck();
    if (!hc.ok) {
      skip('pg healthCheck', hc.message || hc.error);
      await executor.end();
      console.log('\nPG smoke results:', passed, 'passed,', failed, 'failed,', skipped, 'skipped');
      process.exit(0);
    }
    ok('pg healthCheck', true);

    repo = createSqlDailyIssueReviewRepository({
      executor: executor,
      schemaName: SCHEMA,
      enabled: true,
    });
    const init = await Promise.resolve(repo.initialize());
    ok('repo initialize', init && init.ok, JSON.stringify(init));

    const auto = makeItem('auto');
    const man = makeItem('manual');
    ids.push(auto.item.id, man.item.id);
    ok('auto decision', auto.decision.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE', auto.decision.publicationDecision);
    ok('manual decision', man.decision.publicationDecision === 'MANUAL_REVIEW_REQUIRED', man.decision.publicationDecision);

    const ins = await Promise.resolve(
      repo.insertReviewItems(
        [auto.item, man.item],
        [
          {
            entityId: auto.item.id,
            fromStatus: null,
            toStatus: 'READY_FOR_REVIEW',
            action: 'enqueue',
            actorId: 'pubdec_smoke',
            timestamp: AS_OF,
          },
          {
            entityId: man.item.id,
            fromStatus: null,
            toStatus: 'READY_FOR_REVIEW',
            action: 'enqueue',
            actorId: 'pubdec_smoke',
            timestamp: AS_OF,
          },
        ],
        { dryRun: false },
      ),
    );
    ok('insert READY', ins && ins.ok, JSON.stringify(ins));

    const loaded = await Promise.resolve(repo.getById(auto.item.id));
    ok(
      'persisted publicationDecision',
      loaded.ok &&
        (loaded.item.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE' ||
          (loaded.item.lifecycleMeta && loaded.item.lifecycleMeta.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE')),
      JSON.stringify({
        top: loaded.item && loaded.item.publicationDecision,
        meta: loaded.item && loaded.item.lifecycleMeta && loaded.item.lifecycleMeta.publicationDecision,
      }),
    );

    const morning = await Promise.resolve(
      reviewService.runMorningAutoPublish({
        repositoryInstance: repo,
        asOf: '2026-08-06T20:05:00.000Z',
        force: true,
        dryRun: false,
      }),
    );
    ok('morning ok', morning && morning.ok, JSON.stringify(morning));
    ok('auto published on PG', (morning.publishedIds || []).indexOf(auto.item.id) >= 0, JSON.stringify(morning.publishedIds));
    ok('manual not published on PG', (morning.publishedIds || []).indexOf(man.item.id) < 0);

    const audit = await Promise.resolve(repo.listAuditEvents({ entityId: auto.item.id }));
    const events = (audit && audit.events) || [];
    ok(
      'auto morning audit actor',
      events.some(function (e) {
        return e && e.actorId === decision.ACTOR_AUTO_MORNING;
      }),
      JSON.stringify(
        events.map(function (e) {
          return { action: e.action, actorId: e.actorId };
        }),
      ),
    );

    const morning2 = await Promise.resolve(
      reviewService.runMorningAutoPublish({
        repositoryInstance: repo,
        asOf: '2026-08-07T20:05:00.000Z',
        force: true,
      }),
    );
    ok('no duplicate auto republish', (morning2.publishedIds || []).indexOf(auto.item.id) < 0);

    const ret = await Promise.resolve(
      reviewService.transitionItem(auto.item.id, 'RETIRED', {
        repositoryInstance: repo,
        actorId: 'admin_smoke',
        reason: 'MANUAL_RETIRE',
        reasonText: 'post auto publish retire',
        asOf: '2026-08-06T21:00:00.000Z',
      }),
    );
    ok('admin retire after auto publish', ret && ret.ok, JSON.stringify(ret));
  } catch (e) {
    failed += 1;
    console.error('FAIL smoke exception', e && e.message ? e.message : e);
  } finally {
    if (repo && ids.length) {
      await cleanup(repo, ids);
    }
    if (executor && typeof executor.end === 'function') {
      try {
        await executor.end();
      } catch (_) {}
    }
  }

  console.log('\nPG smoke results:', passed, 'passed,', failed, 'failed,', skipped, 'skipped');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
