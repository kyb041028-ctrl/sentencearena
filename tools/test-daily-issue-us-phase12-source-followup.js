#!/usr/bin/env node
'use strict';

/**
 * 12차 후속 — 출처·독립 판별·us-national 감사 (PG/17·18/재수집 12차 로그 혼합 금지).
 */

const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const reviewCore = require('../shared/daily-issue-review-core');
const {
  summarizeLiveCandidate,
  summarizeReadyCandidate,
  classifyUsIngestRun,
} = require('./lib/daily-issue-us-quarantine-report');

const AS_OF = '2026-11-04T16:00:00.000Z';

/** 12차 LIVE 로그(c8f123a) — NEW_RUN과 섞지 않음 */
const LOG_12_READY_THREE = Object.freeze([
  {
    log: 'c8f123a',
    title: 'Congressional Bills H.R. 1744 and H.R. 8205 Signed into Law',
    urls: [
      'https://www.npr.org/2026/11/03/g-s1-151445/up-first-newsletter-midterms-election-day-iran-war-lindsay-clancy',
      'https://www.cbsnews.com/live-updates/senate-election-results-2026/',
      'https://www.whitehouse.gov/briefings-statements/2026/11/congressional-bills-h-r-1744-and-h-r-8205-signed-into-law/',
    ],
    independentSources: ['NPR (newsletter URL)', 'CBS News', 'The White House'],
    coreFacts: 'confirmedFactCount=2 (claim text not in log)',
    freshness: 'freshnessOk=true, freshnessClass=BREAKING',
    autoPublish:
      'MANUAL_REVIEW_REQUIRED; blocked NOT_KOREAN, NOT_FACT_SAFE_TOPIC, LOW_CLASSIFIER_CONFIDENCE',
    postFollowupNote: '후속 규칙: CROSS_EVENT_CLUSTER + journalism-only indep — 동일 사건 통과 아님',
  },
  {
    log: 'c8f123a',
    title: 'Troy Jackson wins Maine Senate race over Susan Collins, in major coup for Democrats',
    urls: ['(per-log independentSourceCount=2; URL list not printed in log)'],
    independentSources: 'NPR News + NPR World network (로그상 2 — 동일 npr-org면 1로 재집계)',
    coreFacts: 'confirmedFactCount in log: not printed per candidate',
    freshness: 'freshnessOk=true in log summary (per READY_SAMPLE pattern)',
    autoPublish: 'MANUAL_REVIEW_REQUIRED (same blocked codes as log batch)',
  },
  {
    log: 'c8f123a',
    title: 'ANTI-COMMUNISM WEEK, 2026',
    urls: ['(per-log independentSourceCount=3; URLs not in READY_SAMPLE line)'],
    independentSources: 'White House + NPR cluster (로그)',
    coreFacts: 'not in log',
    freshness: 'not in log',
    autoPublish: 'MANUAL_REVIEW_REQUIRED (log batch)',
  },
]);

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

async function main() {
  console.log('=== US phase 12 source follow-up ===');
  console.log('LOG_12_READY_THREE', JSON.stringify(LOG_12_READY_THREE));

  const ingest = await runDailyIssueIngest({
    dryRun: true,
    group: 'us-national',
    language: 'en',
    sinceHours: 72,
    maxItems: 4,
    asOf: AS_OF,
    includeFullCandidates: true,
  });

  const candidates = ingest.candidates || [];
  const ready = ingest.readyCandidates || [];
  const runClass = classifyUsIngestRun(ingest.manifest, candidates, ready.length);

  console.log('NEW_RUN_OUTCOME', JSON.stringify(runClass));
  console.log(
    'NEW_RUN_SOURCES',
    JSON.stringify(
      (ingest.manifest && ingest.manifest.sourceResults) || [],
      null,
      0,
    ),
  );
  console.log('NEW_RUN_ready', ready.length, 'candidates', candidates.length);

  const crossEvent = candidates.filter(function (c) {
    return (c.qualityFailureReasons || []).indexOf('CROSS_EVENT_CLUSTER') >= 0;
  });
  console.log('NEW_RUN_CROSS_EVENT_QUARANTINE', crossEvent.length);

  ready.forEach(function (c, i) {
    const sum = summarizeReadyCandidate(c);
    const tagged = Object.assign({}, c, { activityRegion: 'US', lifecycleMeta: { activityRegion: 'US' } });
    const created = reviewCore.createReviewItem(tagged, { asOf: AS_OF, existingItems: [] });
    const decision = decisionCore.classifyPublicationDecision(created.item, { asOf: AS_OF });
    console.log(
      'NEW_RUN_READY_' + i,
      JSON.stringify(
        Object.assign({}, sum, {
          autoPublishEligible: decision.publicationDecision,
          blocked: decision.autoPublishBlockedReasons || [],
        }),
      ),
    );
  });

  check('NEW_RUN not COLLECT_FAILED', runClass.outcome !== 'COLLECT_FAILED');
  check(
    'Congressional Bills cluster quarantined after follow-up rules',
    candidates.some(function (c) {
      return (
        String(c.title || '').indexOf('Congressional Bills') >= 0 &&
        (c.qualityFailureReasons || []).indexOf('CROSS_EVENT_CLUSTER') >= 0
      );
    }),
    'expected CROSS_EVENT_CLUSTER on mixed newsletter/election/bill cluster',
  );

  if (failed) {
    console.log('PHASE12_FOLLOWUP_FAIL', failed);
    process.exitCode = 1;
  } else {
    console.log('PHASE12_FOLLOWUP_OK');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
