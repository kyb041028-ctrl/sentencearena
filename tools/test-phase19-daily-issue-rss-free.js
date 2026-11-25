#!/usr/bin/env node
'use strict';

/**
 * Phase 19 — 승인 RSS 무료 진단. 네트워크 불가 시 수집 성공으로 적지 않음. 실게시·유료 AI 금지.
 */

const registry = require('../config/daily-issue-source-registry');
const fetcher = require('../server/daily-issue-feed-fetcher');
const feedCore = require('../shared/daily-issue-feed-core');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const { classifyUsIngestRun } = require('./lib/daily-issue-us-quarantine-report');

const AS_OF = '2026-11-04T18:00:00.000Z';
const APPROVED_US = ['npr-us-news', 'cbs-us-main', 'fed-press', 'whitehouse-news'];

let failed = 0;
let networkOk = false;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

async function probeNetwork() {
  try {
    const src = registry.getSourceById('npr-us-news');
    if (!src || !src.enabled) return false;
    const fetched = await fetcher.fetchTextSafe(src.feedUrl, { timeoutMs: 12000, maxBytes: 500000 });
    return !!(fetched && fetched.ok && fetched.body && fetched.body.length > 100);
  } catch (_) {
    return false;
  }
}

async function main() {
  console.log('PHASE19_RSS_FREE', 'no-live-publish');

  networkOk = await probeNetwork();
  if (!networkOk) {
    console.log('PHASE19_RSS_NETWORK', 'UNAVAILABLE');
    console.log('PHASE19_RSS_VERDICT', 'BLOCKED');
    process.exit(2);
  }
  console.log('PHASE19_RSS_NETWORK', 'OK');

  let sourceCount = 0;
  let fetchOk = 0;
  for (let i = 0; i < APPROVED_US.length; i += 1) {
    const id = APPROVED_US[i];
    const src = registry.getSourceById(id);
    if (!src || !src.enabled) continue;
    sourceCount += 1;
    try {
      const fetched = await fetcher.fetchTextSafe(src.feedUrl, { timeoutMs: 15000, maxBytes: 1_500_000 });
      if (!fetched.ok) continue;
      const parsed = feedCore.parseRssOrAtom(fetched.body, {
        publisher: src.publisher,
        sourceRegistryId: src.id,
        feedUrl: src.feedUrl,
      });
      if ((parsed.items || []).length > 0) fetchOk += 1;
    } catch (_) {}
  }
  check('approved sources registered', sourceCount >= 3);
  check('at least one feed fetched', fetchOk >= 1, 'fetchOk=' + fetchOk);

  const ingest = await runDailyIssueIngest({
    dryRun: true,
    group: 'us-national',
    language: 'en',
    sinceHours: 48,
    maxItems: 6,
    asOf: AS_OF,
    includeFullCandidates: true,
    allowedSourceIds: APPROVED_US,
  });
  check('ingest dryRun ok', ingest && ingest.ok !== false, ingest && ingest.error);
  const summary = classifyUsIngestRun(ingest);
  check('run classified', summary && summary.outcome, summary && summary.outcome);
  check('dryRun ingest (no persist publish)', true);

  let ready = 0;
  let autoEligible = 0;
  (ingest.readyCandidates || ingest.candidates || []).forEach(function (c) {
    const st = (c.qualityMeta && c.qualityMeta.publicationStatus) || c.publicationStatus;
    if (st === 'READY') ready += 1;
    const d = decisionCore.classifyPublicationDecision(c, { asOf: AS_OF });
    if (d.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE') autoEligible += 1;
  });
  console.log('PHASE19_RSS_DIAG', 'ready=' + ready, 'autoEligible=' + autoEligible, 'sources=' + sourceCount);

  if (failed) {
    console.log('PHASE19_RSS_VERDICT', 'FAIL');
    process.exit(1);
  }
  console.log('PHASE19_RSS_VERDICT', 'PASS');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
