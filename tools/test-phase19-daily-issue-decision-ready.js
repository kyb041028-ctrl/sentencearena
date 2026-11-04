#!/usr/bin/env node
'use strict';

/**
 * Phase 19 — READY vs AUTO_PUBLISH_ELIGIBLE, Fed+NPR, NPR+CBS, 2×NPR (MOCK, no network).
 */

const decisionCore = require('../shared/daily-issue-publication-decision-core');
const clusterCore = require('../shared/daily-issue-cluster-core');

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

function decide(item) {
  return decisionCore.classifyPublicationDecision(item, { asOf: '2026-11-04T18:00:00.000Z' });
}

function usItem(over) {
  const base = {
    activityRegion: 'US',
    status: 'READY_FOR_REVIEW',
    title: 'Agency published quarterly statistics',
    confirmedSummary: 'Agency published quarterly statistics on employment.',
    claims: [{ id: 'c1', text: 'Agency published quarterly statistics on employment.', classification: 'CONFIRMED_FACT', isCore: true }],
    freshnessMeta: { ok: true, freshnessOk: true, freshnessClass: 'RECENT_UPDATE' },
    duplicateMeta: { decision: 'NEW_ISSUE' },
    qualityMeta: { ok: true, publicationStatus: 'READY', independentSourceCount: 2, journalismIndependentCount: 2 },
    independentSourceGate: { ok: true, independentCount: 2, journalismIndependentCount: 2 },
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  return Object.assign({}, base, over || {});
}

async function main() {
  console.log('PHASE19_DECISION_READY_VS_AUTO');

  const fedNpr = usItem({
    sourceRefs: [
      {
        id: 's1',
        publisher: 'Federal Reserve',
        originDomain: 'www.federalreserve.gov',
        url: 'https://www.federalreserve.gov/p19/fed',
        publishedAt: '2026-11-03T10:00:00.000Z',
        sourceType: 'OFFICIAL',
        usMediaClass: 'OFFICIAL',
        independentNetworkKey: 'fed-gov',
      },
      {
        id: 's2',
        publisher: 'NPR',
        originDomain: 'www.npr.org',
        url: 'https://www.npr.org/p19/fed',
        publishedAt: '2026-11-03T11:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'npr-org',
      },
    ],
    qualityMeta: { ok: true, publicationStatus: 'READY', independentSourceCount: 2, journalismIndependentCount: 1 },
    independentSourceGate: { ok: false, independentCount: 2, journalismIndependentCount: 1 },
  });
  const fedD = decide(fedNpr);
  check('Fed+NPR READY quality', fedNpr.qualityMeta.publicationStatus === 'READY');
  check(
    'Fed+NPR auto blocked journalism<2',
    fedD.publicationDecision === 'MANUAL_REVIEW_REQUIRED' &&
      (fedD.autoPublishBlockedReasons || []).indexOf('JOURNALISM_INDEPENDENT_SOURCES_BELOW_2') >= 0,
  );

  const nprCbs = usItem({
    sourceRefs: [
      {
        id: 's1',
        publisher: 'NPR',
        originDomain: 'www.npr.org',
        url: 'https://www.npr.org/p19/same',
        publishedAt: '2026-11-03T10:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'npr-org',
      },
      {
        id: 's2',
        publisher: 'CBS News',
        originDomain: 'www.cbsnews.com',
        url: 'https://www.cbsnews.com/p19/same',
        publishedAt: '2026-11-03T11:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'cbsnews-com',
      },
    ],
  });
  const sameD = decide(nprCbs);
  check('NPR+CBS same event auto eligible', sameD.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE');

  const twoNpr = usItem({
    sourceRefs: [
      {
        id: 's1',
        publisher: 'NPR',
        originDomain: 'www.npr.org',
        url: 'https://www.npr.org/p19/a',
        publishedAt: '2026-11-03T10:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'npr-org',
      },
      {
        id: 's2',
        publisher: 'NPR',
        originDomain: 'www.npr.org',
        url: 'https://www.npr.org/p19/b',
        publishedAt: '2026-11-03T11:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'npr-org',
      },
    ],
    qualityMeta: { ok: true, publicationStatus: 'READY', independentSourceCount: 2, journalismIndependentCount: 1 },
  });
  check('two NPR not auto eligible', decide(twoNpr).publicationDecision === 'MANUAL_REVIEW_REQUIRED');

  const a = usItem({ id: 'ev_a', clusterId: 'cl_a', title: 'Bridge collapse in county X', confirmedSummary: 'Bridge collapse in county X killed two.' });
  const b = usItem({ id: 'ev_b', clusterId: 'cl_b', title: 'Senate passes budget bill', confirmedSummary: 'Senate passes budget bill after overnight vote.' });
  const clustered = clusterCore.clusterDocuments(
    [
      { id: 'd_a', title: a.title, publishedAt: '2026-11-03T10:00:00.000Z', sourceRegistryId: 'npr-us-news' },
      { id: 'd_b', title: b.title, publishedAt: '2026-11-03T11:00:00.000Z', sourceRegistryId: 'cbs-us-main' },
    ],
    { asOf: '2026-11-04T18:00:00.000Z' },
  );
  check('different events not merged', Array.isArray(clustered) && clustered.length === 2);

  let readyCount = 0;
  let autoCount = 0;
  [fedNpr, nprCbs, twoNpr].forEach(function (it) {
    if (it.qualityMeta && it.qualityMeta.publicationStatus === 'READY') readyCount += 1;
    if (decide(it).publicationDecision === 'AUTO_PUBLISH_ELIGIBLE') autoCount += 1;
  });
  check('READY count != AUTO count', readyCount >= 2 && autoCount === 1, 'ready=' + readyCount + ' auto=' + autoCount);

  if (failed) {
    console.log('PHASE19_DECISION_VERDICT', 'FAIL');
    process.exit(1);
  }
  console.log('PHASE19_DECISION_VERDICT', 'PASS');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
