#!/usr/bin/env node
'use strict';

/**
 * 실제 한국어 RSS 교차출처 클러스터링 라이브 검증 (수동 enqueue 금지)
 * — daily_issue_test / public schema 미사용
 */

require('dotenv').config({ path: '.env' });

const ingestMod = require('../server/daily-issue-ingest-service');
const clusterCore = require('../shared/daily-issue-cluster-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const reviewCore = require('../shared/daily-issue-review-core');

const AS_OF = new Date().toISOString();

function uniqueByCluster(cands) {
  const seen = {};
  return (cands || []).filter(function (c) {
    const k = c.clusterId || c.title;
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });
}

async function runGroup(group) {
  return ingestMod.runDailyIssueIngest({
    dryRun: true,
    group: group,
    language: 'ko',
    sinceHours: 72,
    maxItems: 30,
    asOf: AS_OF,
  });
}

async function main() {
  const [eco, policy] = await Promise.all([runGroup('korea-economy'), runGroup('korea-policy')]);
  const docs = (eco.documents || []).concat(policy.documents || []);
  const allCandidates = uniqueByCluster((eco.candidates || []).concat(policy.candidates || []));
  const ready = allCandidates.filter(function (c) {
    return c && c.ok === true && c.publicationStatus === 'READY';
  });

  const clusters = clusterCore.clusterDocuments(docs);
  const multi = clusters.filter(function (cl) {
    return (cl.documentIds || []).length > 1;
  });

  const docsById = {};
  docs.forEach(function (d) {
    docsById[d.id] = d;
  });
  const indepMulti = multi.filter(function (cl) {
    return clusterCore.clusterHasIndependentSources(cl, docsById, require('../shared/daily-issue-source-core')).ok;
  });

  let auto = 0;
  let manual = 0;
  ready.forEach(function (c) {
    const created = reviewCore.createReviewItem(
      Object.assign({}, c, { expiresAt: '2099-01-01T00:00:00.000Z' }),
      { asOf: AS_OF, existingItems: [] },
    );
    const d = decisionCore.classifyPublicationDecision(created.item, { asOf: AS_OF });
    if (d.publicationDecision === decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE) auto += 1;
    else manual += 1;
  });

  const mergedExamples = multi.slice(0, 3).map(function (cl) {
    const titles = (cl.documentIds || []).map(function (id) {
      return docsById[id] && docsById[id].title ? docsById[id].title.slice(0, 48) : id;
    });
    return { entities: (cl.sharedEntities || []).slice(0, 4), titles: titles };
  });

  const notMerged = [];
  const yon = docs.filter(function (d) {
    return d.sourceRegistryId === 'yonhap-ko-economy';
  });
  const mk = docs.filter(function (d) {
    return d.sourceRegistryId === 'mk-economy';
  });
  yon.forEach(function (y) {
    mk.forEach(function (m) {
      const p = clusterCore.scoreDocumentPair(y, m);
      if (p.decision !== 'MERGE' && p.score >= 3) {
        notMerged.push({ y: y.title.slice(0, 40), m: m.title.slice(0, 40), reason: p.rejectReason, score: p.score });
      }
    });
  });
  notMerged.sort(function (a, b) {
    return b.score - a.score;
  });

  const falseMergeGuard = clusterCore.scoreDocumentPair(
    {
      id: 'x',
      title: 'CJ프레시웨이 2분기 영업익 14% 감소',
      publisher: '연합',
      publishedAt: AS_OF,
    },
    {
      id: 'y',
      title: 'BGF리테일 2분기 영업익 849억 증가',
      publisher: '매경',
      publishedAt: AS_OF,
    },
  );

  console.log(
    JSON.stringify(
      {
        collectedDocuments: docs.length,
        clusterCount: clusters.length,
        multiSourceClusters: multi.length,
        independentMultiSourceClusters: indepMulti.length,
        readyForReview: ready.length,
        uniqueReadyForReview: uniqueByCluster(ready).length,
        autoPublishEligible: auto,
        manualReviewRequired: manual,
        mergedExamples: mergedExamples,
        highScoreNotMerged: notMerged.slice(0, 3),
        falseMergeBlocked: falseMergeGuard.decision === 'SEPARATE_WEAK',
        falseMergeReason: falseMergeGuard.rejectReason,
        qualityThresholdRelaxed: false,
      },
      null,
      2,
    ),
  );
}

main().catch(function (e) {
  console.error('VALIDATE_FAIL', e && e.message ? e.message : e);
  process.exit(1);
});
