#!/usr/bin/env node
'use strict';

/**
 * 개발 DB 아침판 파이프라인 E2E — 수동 enqueue 없이 실제 수집→enqueue→publish
 * runKey namespace: e2e (운영 runKey 삭제 금지)
 */

require('dotenv').config({ path: '.env' });

const core = require('../shared/daily-issue-morning-scheduler-core');
const morning = require('../server/daily-issue-morning-scheduler-service');
const ingestMod = require('../server/daily-issue-ingest-service');
const reviewService = require('../server/daily-issue-review-service');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createSqlMorningSchedulerStore } = require('../server/daily-issue-morning-scheduler-store');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const RUN_NS = { runKeyNamespace: 'e2e' };
const DAY = core.kstParts(new Date()).dateKey;
const E2E_DAY = DAY + '-e2e';
const COLLECT_AT = core.scheduledAtIso(DAY, 4, 30);
const PUBLISH_AT = core.scheduledAtIso(DAY, 5, 0);
const PORT = Number(process.env.PORT) || 3000;

const report = { ok: false, enqueued: 0, autoPublished: 0, manualWaiting: 0, publicVisible: false, issues: [] };
const enqueuedIds = [];
const cleanupClusterIds = [];

async function cleanupAllReady(ex) {
  const res = await ex.query('SELECT id FROM "' + SCHEMA + '"."daily_issue_review_items" WHERE status = $1', [
    'READY_FOR_REVIEW',
  ]);
  for (const row of res.rows || []) {
    await deleteReviewItem(ex, row.id);
  }
}
async function cleanupReadyByClusters(ex, clusterIds) {
  if (!clusterIds.length) return;
  const res = await ex.query('SELECT id, cluster_id FROM "' + SCHEMA + '"."daily_issue_review_items" WHERE status = $1', [
    'READY_FOR_REVIEW',
  ]);
  for (const row of res.rows || []) {
    const cid = row.cluster_id || '';
    if (clusterIds.indexOf(cid) >= 0) {
      await deleteReviewItem(ex, row.id);
    }
  }
}

async function cleanupE2eRuns(ex) {
  await ex.query('DELETE FROM "' + SCHEMA + '"."daily_issue_scheduler_runs" WHERE run_key LIKE $1', [
    core.resolveRunKeyNamespace(RUN_NS) + 'morning-%',
  ]);
}

async function deleteReviewItem(ex, id) {
  const tables = [
    ['daily_issue_claim_evidences', 'claim_id IN (SELECT claim_id FROM "' + SCHEMA + '".daily_issue_review_item_claims WHERE review_item_id = $1)'],
    ['daily_issue_claim_sources', 'claim_id IN (SELECT claim_id FROM "' + SCHEMA + '".daily_issue_review_item_claims WHERE review_item_id = $1)'],
    ['daily_issue_review_item_claims', 'review_item_id = $1'],
    ['daily_issue_review_item_evidences', 'review_item_id = $1'],
    ['daily_issue_review_item_sources', 'review_item_id = $1'],
    ['daily_issue_updates', 'issue_id = $1'],
    ['daily_issue_audit_logs', 'entity_id = $1'],
    ['daily_issue_review_items', 'id = $1'],
  ];
  for (let i = 0; i < tables.length; i++) {
    await ex.query('DELETE FROM "' + SCHEMA + '"."' + tables[i][0] + '" WHERE ' + tables[i][1], [id]);
  }
}

async function main() {
  if (!isAllowedTestSchema(SCHEMA)) process.exit(1);
  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  if (!url) process.exit(1);

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  const repo = createSqlDailyIssueReviewRepository({ executor: executor, schemaName: SCHEMA, enabled: true });
  await repo.initialize();
  const store = createSqlMorningSchedulerStore({ executor: executor, schemaName: SCHEMA });

  try {
    await cleanupE2eRuns(executor);
    await cleanupAllReady(executor);

    const collect = await morning.runCollect({
      repositoryInstance: repo,
      schedulerStore: store,
      asOf: COLLECT_AT,
      dateKey: E2E_DAY,
      force: true,
      manual: true,
      runKeyNamespace: RUN_NS.runKeyNamespace,
      collectRunner: async function (opt) {
        const ingestAsOf = new Date().toISOString();
        const groups = ['korea-economy', 'korea-policy'];
        let ready = [];
        let docCount = 0;
        for (let i = 0; i < groups.length; i++) {
          const ing = await ingestMod.runDailyIssueIngest({
            dryRun: true,
            group: groups[i],
            language: 'ko',
            sinceHours: 72,
            maxItems: 30,
            asOf: ingestAsOf,
          });
          docCount += (ing.documents && ing.documents.length) || 0;
          ready = ready.concat(ing.readyCandidates || []);
        }
        const seen = {};
        ready = ready.filter(function (c) {
          if (!(c && c.ok && c.publicationStatus === 'READY')) return false;
          const k = c.clusterId || c.title;
          if (seen[k]) return false;
          seen[k] = 1;
          if (c.clusterId) cleanupClusterIds.push(c.clusterId);
          return true;
        });
        await cleanupReadyByClusters(executor, cleanupClusterIds);
        const enq = await reviewService.enqueueCandidates(ready, {
          repositoryInstance: opt.repositoryInstance,
          asOf: ingestAsOf,
        });
        (enq.results || []).forEach(function (r) {
          if (r.ok && r.item && r.item.id) enqueuedIds.push(r.item.id);
        });
        report.enqueued = enq.enqueuedCount || 0;
        if (!report.enqueued) report.issues.push('enqueue_zero');
        return {
          ok: true,
          status: core.RUN_STATUS.SUCCESS,
          collectedSourceCount: groups.length,
          candidateCount: docCount,
          autoEligibleCount: 0,
          manualReviewCount: report.enqueued,
        };
      },
    });

    if (collect && collect.skipped) report.issues.push('collect_skipped');

    const pub = await morning.runPublish({
      repositoryInstance: repo,
      schedulerStore: store,
      asOf: PUBLISH_AT,
      dateKey: E2E_DAY,
      force: true,
      manual: true,
      runKeyNamespace: RUN_NS.runKeyNamespace,
      skipCollectGate: false,
    });

    report.autoPublished =
      (pub && pub.run && pub.run.autoPublishedCount) ||
      (pub && pub.morning && pub.morning.publishedIds && pub.morning.publishedIds.length) ||
      0;
    if (pub && pub.skipped) report.issues.push('publish_skipped');
    if (pub && pub.blocked) report.issues.push('publish_blocked');

    const listed = await repo.list({ status: 'READY_FOR_REVIEW' });
    report.manualWaiting = (listed.items || []).length;

    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/api/daily-issues?limit=10');
      const json = await res.json();
      report.publicVisible = !!((json.data && json.data.items) || []).length;
    } catch (_) {
      report.issues.push('public_api_skip');
    }

    report.ok = report.enqueued > 0 && !pub.skipped && !pub.blocked;
  } finally {
    for (let i = 0; i < enqueuedIds.length; i++) {
      try {
        await deleteReviewItem(executor, enqueuedIds[i]);
      } catch (_) {}
    }
    await cleanupReadyByClusters(executor, cleanupClusterIds);
    await cleanupE2eRuns(executor);
    await executor.end();
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch(function () {
  process.exit(1);
});
