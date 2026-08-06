#!/usr/bin/env node
'use strict';

/**
 * 아침판 스케줄러 PG smoke — daily_issue_test only
 */

require('dotenv').config({ path: '.env' });

const core = require('../shared/daily-issue-morning-scheduler-core');
const decision = require('../shared/daily-issue-publication-decision-core');
const morning = require('../server/daily-issue-morning-scheduler-service');
const reviewService = require('../server/daily-issue-review-service');
const qualityCore = require('../shared/daily-issue-quality-core');
const freshnessCore = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const { createDailyIssuePgExecutor, isAllowedTestSchema, maskDatabaseUrl } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createSqlMorningSchedulerStore } = require('../server/daily-issue-morning-scheduler-store');
const fs = require('fs');
const path = require('path');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const PREFIX = 'mornsched_' + Date.now().toString(36) + '_';
const DAY = '2099-01-15'; // far future dateKey to avoid colliding with real ops keys
const COLLECT_AT = core.scheduledAtIso(DAY, 4, 30);
const PUBLISH_AT = core.scheduledAtIso(DAY, 5, 0);

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
  const title = isAuto ? '통계청 고용 통계 공식 발표 ' + id : '여야 정치 갈등 ' + id;
  const summary = isAuto ? '통계청이 고용 통계를 공식 발표했다.' : '정치 갈등이 커지고 있다.';
  const s1 = {
    id: id + '_s1',
    publisher: '통계청',
    title: isAuto ? '보도자료' : '기사1',
    url: 'https://kostat.go.kr/pg/' + id,
    publishedAt: '2099-01-14T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: id + '_s2',
    publisher: '연합뉴스',
    title: isAuto ? '관련' : '기사2',
    url: 'https://www.yna.co.kr/pg/' + id,
    publishedAt: '2099-01-14T02:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.yna.co.kr',
  };
  const evidences = [
    { id: id + '_e1', sourceId: s1.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    { id: id + '_e2', sourceId: s2.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
  ];
  const built = qualityCore.buildDailyIssueCandidate({
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
    retrievedAt: COLLECT_AT,
  });
  const gated = freshnessCore.applyFreshnessGateToCandidate(built, {
    asOf: COLLECT_AT,
    category: isAuto ? 'korea-economy' : 'korea-politics',
  });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      clusterId: 'cl_' + id,
      category: isAuto ? 'korea-economy' : 'korea-politics',
      candidateId: id,
      contentSignature: 'sig_' + id,
      expiresAt: '2099-12-31T00:00:00.000Z',
    }),
    { asOf: COLLECT_AT, existingItems: [] },
  );
  return decision.attachDecisionToItem(
    Object.assign({}, created.item, { id: id, expiresAt: '2099-12-31T00:00:00.000Z' }),
    { asOf: COLLECT_AT },
  );
}

async function ensureSchedulerTable(executor, schema) {
  const sqlPath = path.join(__dirname, '..', 'supabase', 'migration_daily_issue_morning_scheduler.sql');
  let sql = fs.readFileSync(sqlPath, 'utf8');
  sql = sql.replace(/\bpublic\.(daily_issue_[a-z0-9_]+)/gi, schema + '.$1');
  await executor.query(sql);
}

async function cleanup(repo, store, ids) {
  for (let i = 0; i < ids.length; i++) {
    try {
      const got = await Promise.resolve(repo.getById(ids[i]));
      if (got && got.ok && got.item && (got.item.status === 'PUBLISHED' || got.item.status === 'APPROVED')) {
        await Promise.resolve(
          reviewService.transitionItem(ids[i], 'RETIRED', {
            repositoryInstance: repo,
            actorId: 'morn_smoke',
            reason: 'MANUAL_RETIRE',
            reasonText: 'smoke cleanup',
            asOf: new Date().toISOString(),
          }),
        );
      }
    } catch (_) {}
  }
  // leave scheduler runs (unique keys on far-future day) — optional delete
  try {
    const keys = [core.collectRunKey(DAY), core.publishRunKey(DAY)];
    for (let k = 0; k < keys.length; k++) {
      if (store && store.kind === 'sql') {
        /* keep for audit; far-future keys harmless */
      }
    }
  } catch (_) {}
}

async function main() {
  console.log('=== morning scheduler PG smoke ===');
  console.log('schema:', SCHEMA);
  if (!isAllowedTestSchema(SCHEMA)) {
    skip('schema', 'must be daily_issue_test');
    process.exit(0);
  }
  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  if (!url) {
    skip('database', 'DAILY_ISSUE_DATABASE_URL missing');
    process.exit(0);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('PRODUCTION_REFUSED');
    process.exit(1);
  }
  console.log('database:', maskDatabaseUrl(url));

  let executor;
  let repo;
  let store;
  const ids = [];
  try {
    executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
    if (!executor.ok) {
      skip('executor', executor.message || 'unavailable');
      process.exit(0);
    }
    const hc = await executor.healthCheck();
    if (!hc.ok) {
      skip('health', hc.message || hc.error);
      await executor.end();
      process.exit(0);
    }
    ok('pg health', true);
    await ensureSchedulerTable(executor, SCHEMA);
    ok('scheduler migration applied', true);

    repo = createSqlDailyIssueReviewRepository({ executor: executor, schemaName: SCHEMA, enabled: true });
    const init = await Promise.resolve(repo.initialize());
    ok('repo init', init && init.ok, JSON.stringify(init));

    store = createSqlMorningSchedulerStore({ executor: executor, schemaName: SCHEMA });
    const sInit = await store.initialize();
    ok('scheduler store init', sInit && sInit.ok, JSON.stringify(sInit));

    const auto = makeItem('auto');
    const man = makeItem('manual');
    ids.push(auto.item.id, man.item.id);

    const collect = await morning.runCollect({
      asOf: COLLECT_AT,
      dateKey: DAY,
      force: true,
      schedulerStore: store,
      repositoryInstance: repo,
      collectRunner: async function (opt) {
        await Promise.resolve(
          opt.repositoryInstance.insertReviewItems(
            [auto.item, man.item],
            [
              {
                entityId: auto.item.id,
                fromStatus: null,
                toStatus: 'READY_FOR_REVIEW',
                action: 'enqueue',
                actorId: 'smoke',
                timestamp: COLLECT_AT,
              },
              {
                entityId: man.item.id,
                fromStatus: null,
                toStatus: 'READY_FOR_REVIEW',
                action: 'enqueue',
                actorId: 'smoke',
                timestamp: COLLECT_AT,
              },
            ],
          ),
        );
        return {
          ok: true,
          status: 'SUCCESS',
          collectedSourceCount: 2,
          candidateCount: 2,
          autoEligibleCount: 1,
          manualReviewCount: 1,
        };
      },
    });
    ok('inject clock collect', collect.ok && collect.status === 'SUCCESS', JSON.stringify(collect));

    const publish = await morning.runPublish({
      asOf: PUBLISH_AT,
      dateKey: DAY,
      force: true,
      schedulerStore: store,
      repositoryInstance: repo,
    });
    ok('05:00 publish', publish.ok, JSON.stringify(publish));
    ok('AUTO published on PG', publish.run && publish.run.autoPublishedCount >= 1, JSON.stringify(publish.run));

    const gotAuto = await Promise.resolve(repo.getById(auto.item.id));
    const gotMan = await Promise.resolve(repo.getById(man.item.id));
    ok('AUTO PUBLISHED', gotAuto.item && gotAuto.item.status === 'PUBLISHED');
    ok('MANUAL READY', gotMan.item && gotMan.item.status === 'READY_FOR_REVIEW');

    const again = await morning.runPublish({
      asOf: PUBLISH_AT,
      dateKey: DAY,
      force: true,
      schedulerStore: store,
      repositoryInstance: repo,
    });
    ok('same runKey skip', again.skipped === true, JSON.stringify(again));

    const hist = await morning.getHistory({ schedulerStore: store, limit: 20 });
    ok(
      'history has collect+publish',
      (hist.items || []).some(function (r) {
        return r.runKey === core.collectRunKey(DAY);
      }) &&
        (hist.items || []).some(function (r) {
          return r.runKey === core.publishRunKey(DAY);
        }),
    );

    const post = (await Promise.resolve(repo.list({ status: 'PUBLISHED' }))).items || [];
    const queue = post.filter(function (it) {
      return (
        String(it.reviewerId || '') === decision.ACTOR_AUTO_MORNING ||
        (it.lifecycleMeta && it.lifecycleMeta.publishedBy === decision.ACTOR_AUTO_MORNING)
      );
    });
    ok(
      'post-review queue contains auto',
      queue.some(function (i) {
        return i.id === auto.item.id;
      }),
    );

    const ret = await Promise.resolve(
      reviewService.transitionItem(auto.item.id, 'RETIRED', {
        repositoryInstance: repo,
        actorId: 'admin',
        reason: 'MANUAL_RETIRE',
        reasonText: 'smoke',
        asOf: new Date().toISOString(),
      }),
    );
    ok('retire ok', ret.ok, JSON.stringify(ret));
  } catch (e) {
    failed += 1;
    console.error('FAIL exception', e && e.message ? e.message : e);
  } finally {
    if (repo) await cleanup(repo, store, ids);
    if (executor && executor.end) await executor.end();
  }

  console.log('\nPG smoke:', passed, 'passed,', failed, 'failed,', skipped, 'skipped');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
