#!/usr/bin/env node
'use strict';

/**
 * confirmed fact 추출 라이브 검증 (수동 enqueue 금지)
 */

require('dotenv').config({ path: '.env' });

const ingestMod = require('../server/daily-issue-ingest-service');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const reviewCore = require('../shared/daily-issue-review-core');
const titleFactCore = require('../shared/daily-issue-title-fact-core');

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

  let titleOnlyClusters = 0;
  let confirmedSuccess = 0;
  let confirmedEmpty = 0;
  let numericConflict = 0;
  const overExtract = [];
  const blocked = [];

  allCandidates.forEach(function (c) {
    const srcCount = c.sourceCount || 0;
    const titleMeta = c.titleFactMeta || null;
    const confirmedFromTitle =
      (c.confirmedClaimCount || 0) > 0 && titleMeta && titleMeta.titleOnlyDocCount > 0;
    if (srcCount >= 2 && titleMeta && titleMeta.titleOnlyDocCount > 0) {
      titleOnlyClusters += 1;
    }
    if ((c.qualityFailureReasons || []).indexOf('CONFIRMED_FACT_EMPTY') >= 0) {
      confirmedEmpty += 1;
      blocked.push((c.title || '').slice(0, 48));
    }
    if (titleMeta && titleMeta.numericConflicts && titleMeta.numericConflicts.length) {
      numericConflict += titleMeta.numericConflicts.length;
    }
    if (confirmedFromTitle || (c.ok && c.publicationStatus === 'READY' && titleMeta)) {
      confirmedSuccess += 1;
    }
    if (
      c.ok &&
      c.publicationStatus === 'READY' &&
      titleMeta &&
      (c.title || '').match(/\d+(?:%|억|만)/)
    ) {
      overExtract.push((c.title || '').slice(0, 48));
    }
  });

  const ready = allCandidates.filter(function (c) {
    return c && c.ok && c.publicationStatus === 'READY';
  });
  const uniqueReady = uniqueByCluster(ready);
  let auto = 0;
  uniqueReady.forEach(function (c) {
    const created = reviewCore.createReviewItem(
      Object.assign({}, c, { expiresAt: '2099-01-01T00:00:00.000Z' }),
      { asOf: AS_OF, existingItems: [] },
    );
    if (decisionCore.classifyPublicationDecision(created.item).publicationDecision === 'AUTO_PUBLISH_ELIGIBLE') {
      auto += 1;
    }
  });

  console.log(
    JSON.stringify(
      {
        collectedDocuments: docs.length,
        titleOnlyClusters: titleOnlyClusters,
        confirmedFactSuccess: confirmedSuccess,
        confirmedFactEmptyRemaining: confirmedEmpty,
        numericConflictCount: numericConflict,
        readyForReview: uniqueReady.length,
        autoPublishEligible: auto,
        overExtractExamples: overExtract.slice(0, 2),
        blockedExamples: blocked.slice(0, 3),
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
