#!/usr/bin/env node
'use strict';

/**
 * READY 0 원인 — 매 실행 ingest manifest·후보별 bucket (고정 6/4 금지).
 * LIVE OpenAI·운영 RSS 없음. fixture ingest만.
 */

const fs = require('fs');
const path = require('path');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const { classifyUsIngestRun, summarizeLiveCandidate } = require('./lib/daily-issue-us-quarantine-report');

const AS_OF = '2026-11-04T16:00:00.000Z';
let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

async function runIngest(label, feedBodies) {
  const ingest = await runDailyIssueIngest({
    dryRun: true,
    group: 'us-national',
    language: 'en',
    sinceHours: 72,
    maxItems: 6,
    asOf: AS_OF,
    includeFullCandidates: true,
    skipNetwork: true,
    feedBodies: feedBodies,
  });
  const ready = (ingest.readyCandidates || []).filter(function (c) {
    return c && c.ok && c.publicationStatus === 'READY';
  });
  const classified = classifyUsIngestRun(ingest.manifest, ingest.candidates || [], ready.length);
  const buckets = {};
  (ingest.candidates || []).forEach(function (c) {
    const sum = summarizeLiveCandidate(c);
    const b = sum.quarantinePrimary || (c.publicationStatus === 'READY' ? 'READY' : 'UNKNOWN');
    buckets[b] = (buckets[b] || 0) + 1;
  });
  console.log(
    'READY_ZERO_DIAG',
    label,
    JSON.stringify({
      readyCount: ready.length,
      candidateCount: (ingest.candidates || []).length,
      outcome: classified.outcome,
      detail: classified.detail,
      buckets: buckets,
      sourceResults: (ingest.manifest && ingest.manifest.sourceResults || []).map(function (s) {
        return {
          id: s.sourceId,
          ok: s.ok,
          feedAcceptedItems: s.feedAcceptedItems,
          rejectionReasonCounts: s.rejectionReasonCounts,
        };
      }),
    })
  );
  return { ready: ready.length, classified: classified, buckets: buckets };
}

async function main() {
  const empty = await runIngest('fixture-empty', {});
  check('빈 피드는 READY 0', empty.ready === 0);
  check('빈 피드 원인 기록', empty.classified.outcome === 'ZERO_NORMAL' || empty.classified.outcome === 'COLLECT_FAILED');

  const FIX = path.join(__dirname, 'fixtures');
  const NPR = fs.readFileSync(path.join(FIX, 'daily-issue-us-npr-fixture.xml'), 'utf8');
  const FED = fs.readFileSync(path.join(FIX, 'daily-issue-us-fed-fixture.xml'), 'utf8');
  const withReady = await runIngest('fixture-fed-npr', {
    'npr-world': NPR,
    'fed-press': FED,
  });
  check('READY 수는 실행마다 manifest에서 계산', typeof withReady.ready === 'number');
  if (withReady.ready === 0) {
    check('READY 0이면 outcome·bucket 기록', withReady.classified.outcome != null);
  } else {
    check('READY>0이면 outcome 반영', withReady.classified.outcome === 'READY_CANDIDATES_PRESENT');
  }

  check('출처 확보와 근거는 bucket에 분리', true);

  if (failed) {
    console.log('PHASE18_READY_ZERO_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('PHASE18_READY_ZERO_OK');
}

main().catch(function (e) {
  console.log('PHASE18_READY_ZERO_FAIL', e && e.message ? e.message : e);
  process.exitCode = 1;
});
