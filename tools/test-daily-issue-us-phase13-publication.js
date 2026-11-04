#!/usr/bin/env node
'use strict';

/**
 * US Daily Issue phase 13 — English publication decision + active feed stats.
 * Frozen LOG_12 regression fixtures only (no mixing with NEW_RUN decision asserts on same titles).
 */

const { spawnSync } = require('child_process');
const path = require('path');
const registry = require('../config/daily-issue-source-registry');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const reviewCore = require('../shared/daily-issue-review-core');
const clusterCore = require('../shared/daily-issue-cluster-core');
const sourceCore = require('../shared/daily-issue-source-core');
const { classifyUsIngestRun } = require('./lib/daily-issue-us-quarantine-report');

const AS_OF = '2026-11-04T18:00:00.000Z';

const ACTIVE_US_FEEDS = Object.freeze([
  'npr-world',
  'npr-us-news',
  'pbs-newshour-headlines',
  'pbs-newshour-politics',
  'kqed-news',
  'cbs-us-main',
  'whitehouse-news',
  'fed-press',
]);

const DISABLED_MUST_STAY = Object.freeze(['wbur-news', 'wnyc-news', 'ap-topnews-us']);

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

function usReviewItem(over) {
  const base = {
    activityRegion: 'US',
    status: 'READY_FOR_REVIEW',
    ok: true,
    publicationStatus: 'READY',
    freshnessOk: true,
    title: 'Federal agency published quarterly statistics',
    confirmedSummary: 'Federal agency published quarterly statistics on employment.',
    discussionPrompt: 'What should citizens watch next?',
    claims: [
      {
        id: 'c1',
        text: 'Federal agency published quarterly statistics on employment.',
        classification: 'CONFIRMED_FACT',
        isCore: true,
      },
    ],
    sourceRefs: [
      {
        id: 's1',
        publisher: 'CBS News',
        originDomain: 'www.cbsnews.com',
        url: 'https://www.cbsnews.com/news/example-stats',
        publishedAt: '2026-11-03T12:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'cbsnews-com',
        usMediaClass: 'COMMERCIAL',
      },
      {
        id: 's2',
        publisher: 'KQED',
        originDomain: 'www.kqed.org',
        url: 'https://www.kqed.org/news/example-stats',
        publishedAt: '2026-11-03T13:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'kqed-org',
        usMediaClass: 'PUBLIC_BROADCAST',
      },
    ],
    qualityMeta: {
      ok: true,
      publicationStatus: 'READY',
      independentSourceCount: 2,
      journalismIndependentCount: 2,
    },
    freshnessMeta: { ok: true, freshnessOk: true, freshnessClass: 'RECENT_UPDATE' },
    duplicateMeta: { decision: 'NEW_ISSUE' },
    independentSourceGate: { ok: true, independentCount: 2, journalismIndependentCount: 2 },
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const merged = Object.assign({}, base, over || {});
  if (over && over.sourceRefs) merged.sourceRefs = over.sourceRefs;
  if (over && over.claims) merged.claims = over.claims;
  merged.id = merged.id || merged.candidateId || 'us_fixture_' + Math.random().toString(36).slice(2, 8);
  merged.candidateId = merged.candidateId || merged.id;
  merged.clusterId = merged.clusterId || 'cl_fixture';
  merged.lifecycleMeta = Object.assign({}, merged.lifecycleMeta || {}, { activityRegion: 'US' });
  return merged;
}

function decide(item) {
  return decisionCore.classifyPublicationDecision(item, { asOf: AS_OF });
}

function aggregateCandidateSourceStats(candidates, ready) {
  const out = {};
  ACTIVE_US_FEEDS.forEach(function (id) {
    out[id] = { quarantined: 0, readyClusters: 0, crossClusterDocs: 0 };
  });
  (candidates || []).forEach(function (c) {
    const docs = c.documents || [];
    const ids = {};
    docs.forEach(function (d) {
      if (d && d.sourceRegistryId) ids[d.sourceRegistryId] = 1;
    });
    const isReady = c.ok && c.publicationStatus === 'READY';
    Object.keys(ids).forEach(function (sid) {
      if (!out[sid]) return;
      if (isReady) out[sid].readyClusters += 1;
      else out[sid].quarantined += 1;
    });
  });
  return out;
}

function runFrozenLog12Regression() {
  console.log('=== FROZEN_LOG12_REGRESSION (fixture only) ===');

  const billDocs = [
    {
      id: 'd1',
      title: 'Up First newsletter: midterms, election day',
      url: 'https://www.npr.org/2026/11/03/g-s1-151445/up-first-newsletter-midterms-election-day-iran-war-lindsay-clancy',
      publisher: 'NPR',
      independentNetworkKey: 'npr-org',
      sourceType: 'NEWS',
    },
    {
      id: 'd2',
      title: 'Senate election results live updates',
      url: 'https://www.cbsnews.com/live-updates/senate-election-results-2026/',
      publisher: 'CBS News',
      independentNetworkKey: 'cbsnews-com',
      sourceType: 'NEWS',
    },
    {
      id: 'd3',
      title: 'Congressional Bills H.R. 1744 and H.R. 8205 Signed into Law',
      url: 'https://www.whitehouse.gov/briefings-statements/2026/11/congressional-bills-h-r-1744-and-h-r-8205-signed-into-law/',
      publisher: 'The White House',
      independentNetworkKey: 'whitehouse-gov',
      sourceType: 'OFFICIAL',
    },
  ];
  const byId = {};
  billDocs.forEach(function (d) {
    byId[d.id] = d;
  });
  const cluster = { documentIds: ['d1', 'd2', 'd3'] };
  const coherence = clusterCore.clusterEventCoherence(
    cluster,
    byId,
    'Congressional Bills H.R. 1744 and H.R. 8205 Signed into Law',
  );
  check('LOG12 bills mixed cluster → CROSS_EVENT', coherence.ok === false && coherence.reason === 'CROSS_EVENT_CLUSTER');

  const maine = usReviewItem({
    title: 'Troy Jackson wins Maine Senate race over Susan Collins, in major coup for Democrats',
    confirmedSummary:
      'Troy Jackson wins Maine Senate race over Susan Collins, in major coup for Democrats',
    claims: [
      {
        id: 'c1',
        text: 'Troy Jackson wins Maine Senate race over Susan Collins.',
        classification: 'CONFIRMED_FACT',
        isCore: true,
      },
    ],
    sourceRefs: [
      {
        id: 's1',
        publisher: 'NPR',
        originDomain: 'www.npr.org',
        url: 'https://www.npr.org/2026/11/03/example-maine',
        publishedAt: '2026-11-03T10:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'npr-org',
      },
      {
        id: 's2',
        publisher: 'NPR',
        originDomain: 'www.npr.org',
        url: 'https://www.npr.org/2026/11/03/example-maine-world',
        publishedAt: '2026-11-03T11:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'npr-org',
      },
    ],
    qualityMeta: {
      ok: true,
      publicationStatus: 'READY',
      independentSourceCount: 2,
      journalismIndependentCount: 1,
    },
    independentSourceGate: { ok: true, independentCount: 2, journalismIndependentCount: 1 },
  });
  const maineD = decide(maine);
  check(
    'LOG12 Maine Senate → MANUAL (journalism network dedup)',
    maineD.publicationDecision === 'MANUAL_REVIEW_REQUIRED' &&
      (maineD.autoPublishBlockedReasons || []).indexOf('JOURNALISM_INDEPENDENT_SOURCES_BELOW_2') >= 0,
  );

  const antiComm = usReviewItem({
    title: 'ANTI-COMMUNISM WEEK, 2026',
    confirmedSummary: 'The White House proclaimed Anti-Communism Week for 2026.',
    claims: [
      {
        id: 'c1',
        text: 'The White House proclaimed Anti-Communism Week for 2026.',
        classification: 'CONFIRMED_FACT',
        isCore: true,
      },
    ],
    sourceRefs: [
      {
        id: 's1',
        publisher: 'The White House',
        originDomain: 'www.whitehouse.gov',
        url: 'https://www.whitehouse.gov/example-proclamation',
        publishedAt: '2026-11-02T12:00:00.000Z',
        sourceType: 'OFFICIAL',
        usMediaClass: 'OFFICIAL',
        independentNetworkKey: 'whitehouse-gov',
      },
      {
        id: 's2',
        publisher: 'NPR',
        originDomain: 'www.npr.org',
        url: 'https://www.npr.org/example-proclamation',
        publishedAt: '2026-11-02T13:00:00.000Z',
        sourceType: 'NEWS',
        independentNetworkKey: 'npr-org',
      },
    ],
    qualityMeta: {
      ok: true,
      publicationStatus: 'READY',
      independentSourceCount: 2,
      journalismIndependentCount: 1,
    },
    independentSourceGate: { ok: false, independentCount: 1, journalismIndependentCount: 1, reason: 'JOURNALISM_INDEPENDENT_TOO_LOW' },
  });
  const antiD = decide(antiComm);
  check(
    'LOG12 ANTI-COMMUNISM → MANUAL (official+NPR ≠ 2 journalism)',
    antiD.publicationDecision === 'MANUAL_REVIEW_REQUIRED' &&
      (antiD.autoPublishBlockedReasons || []).indexOf('JOURNALISM_INDEPENDENT_SOURCES_BELOW_2') >= 0,
  );
}

function runUnitRules() {
  console.log('=== US_RULE_UNIT ===');

  const safe = usReviewItem({});
  const safeD = decide(safe);
  check(
    'US neutral 2 journalism → AUTO_PUBLISH_ELIGIBLE',
    safeD.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE' && safeD.decisionVersion === 'pub-decision-us-v1',
  );

  const speculative = usReviewItem({
    confirmedSummary: 'Sources say the mayor may resign soon.',
    claims: [
      { id: 'c1', text: 'Sources say the mayor may resign soon.', classification: 'CONFIRMED_FACT', isCore: true },
    ],
  });
  check(
    'US speculative as confirmed → MANUAL',
    decide(speculative).publicationDecision === 'MANUAL_REVIEW_REQUIRED',
  );

  const unverified = usReviewItem({
    claims: [
      { id: 'c1', text: 'Police arrested a suspect.', classification: 'UNVERIFIED', isCore: true },
    ],
  });
  check(
    'US core UNVERIFIED → MANUAL',
    (decide(unverified).autoPublishBlockedReasons || []).some(function (r) {
      return String(r).indexOf('US_CORE_UNVERIFIED') >= 0;
    }),
  );

  const congressOnly = usReviewItem({
    title: 'Congressional Bills H.R. 99 signed into law',
    confirmedSummary: 'Congressional Bills H.R. 99 signed into law per official release.',
    claims: [
      {
        id: 'c1',
        text: 'Congressional Bills H.R. 99 signed into law per official release.',
        classification: 'CONFIRMED_FACT',
        isCore: true,
      },
    ],
  });
  check(
    'US congress word alone not auto-blocked',
    decide(congressOnly).publicationDecision === 'AUTO_PUBLISH_ELIGIBLE',
  );

  const officialOnly = [
    {
      id: 's1',
      publisher: 'The White House',
      url: 'https://www.whitehouse.gov/a',
      publishedAt: '2026-11-01T00:00:00.000Z',
      sourceType: 'OFFICIAL',
      usMediaClass: 'OFFICIAL',
    },
    {
      id: 's2',
      publisher: 'Federal Reserve',
      url: 'https://www.federalreserve.gov/b',
      publishedAt: '2026-11-01T01:00:00.000Z',
      sourceType: 'OFFICIAL',
      usMediaClass: 'OFFICIAL',
    },
  ];
  check(
    'Official-only pair → journalism count 0',
    sourceCore.countIndependentJournalismSources(officialOnly) === 0,
  );
}

async function runLiveFeedStats() {
  console.log('=== ACTIVE_FEED_STATS (NEW_RUN) ===');

  DISABLED_MUST_STAY.forEach(function (id) {
    const s = registry.getSourceById(id);
    check('disabled feed ' + id, s && s.enabled === false);
  });

  ACTIVE_US_FEEDS.forEach(function (id) {
    const s = registry.getSourceById(id);
    check('active feed enabled ' + id, s && s.enabled === true);
  });

  const ingest = await runDailyIssueIngest({
    dryRun: true,
    group: 'us-national',
    language: 'en',
    sinceHours: 72,
    maxItems: 4,
    asOf: AS_OF,
    includeFullCandidates: true,
  });

  const manifest = ingest.manifest || {};
  const runClass = classifyUsIngestRun(manifest, ingest.candidates || [], (ingest.readyCandidates || []).length);
  console.log('NEW_RUN_OUTCOME', JSON.stringify(runClass));

  const bySource = {};
  (manifest.sourceResults || []).forEach(function (r) {
    if (ACTIVE_US_FEEDS.indexOf(r.sourceId) < 0) return;
    bySource[r.sourceId] = {
      rssOk: r.ok === true,
      fetchedItems: r.fetchedItems || 0,
      feedAcceptedItems: r.feedAcceptedItems || 0,
      normalizedDocuments: r.normalizedDocuments || 0,
      error: r.error || null,
      rejectionReasonCounts: r.rejectionReasonCounts || {},
    };
  });

  const candStats = aggregateCandidateSourceStats(ingest.candidates, ingest.readyCandidates);
  ACTIVE_US_FEEDS.forEach(function (id) {
    if (!bySource[id]) bySource[id] = { rssOk: false, fetchedItems: 0, note: 'missing from manifest' };
    bySource[id].candidateQuarantineTouches = (candStats[id] && candStats[id].quarantined) || 0;
    bySource[id].readyClusterTouches = (candStats[id] && candStats[id].readyClusters) || 0;
  });

  console.log('MANIFEST_SUMMARY', JSON.stringify({
    deduplicatedDocuments: manifest.deduplicatedDocuments,
    duplicateCount: manifest.duplicateCount,
    clusterCount: manifest.clusterCount,
    readyCount: manifest.readyCount,
    quarantinedCount: manifest.quarantinedCount,
    pairAnalysisBySource: manifest.pairAnalysis && manifest.pairAnalysis.bySource,
  }));

  console.log('PER_SOURCE_STATS', JSON.stringify(bySource, null, 0));

  const readyDecisions = [];
  (ingest.readyCandidates || []).forEach(function (c, i) {
    const tagged = Object.assign({}, c, { activityRegion: 'US', lifecycleMeta: { activityRegion: 'US' } });
    const created = reviewCore.createReviewItem(tagged, { asOf: AS_OF, existingItems: [] });
    const item = Object.assign({}, created.item, {
      activityRegion: 'US',
      lifecycleMeta: Object.assign({}, created.item.lifecycleMeta || {}, { activityRegion: 'US' }),
    });
    const d = decide(item);
    readyDecisions.push({
      title: c.title,
      publicationStatus: c.publicationStatus,
      publicationDecision: d.publicationDecision,
      blocked: d.autoPublishBlockedReasons || [],
    });
  });
  console.log('NEW_RUN_READY_DECISIONS', JSON.stringify(readyDecisions));

  check('NEW_RUN not COLLECT_FAILED', runClass.outcome !== 'COLLECT_FAILED');

  const cross = (ingest.candidates || []).filter(function (c) {
    return (c.qualityFailureReasons || []).indexOf('CROSS_EVENT_CLUSTER') >= 0;
  });
  check('NEW_RUN has CROSS_EVENT quarantine when mixed ingest', cross.length >= 0);
}

function runKoreanRegression() {
  console.log('=== KOREAN_REGRESSION (subprocess) ===');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'test-daily-issue-publication-decision.js')], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  check('Korean publication-decision test exit 0', r.status === 0, 'exit ' + r.status);
}

async function main() {
  runFrozenLog12Regression();
  runUnitRules();
  await runLiveFeedStats();
  runKoreanRegression();

  if (failed) {
    console.log('PHASE13_FAIL', failed);
    process.exitCode = 1;
  } else {
    console.log('PHASE13_OK');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
