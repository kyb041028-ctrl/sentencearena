#!/usr/bin/env node
'use strict';

/**
 * Phase 15 — unified KR/US AI engine (mock + isolated PG). AS_OF fixed for freshness.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const evalCore = require('../shared/daily-issue-ai-eval-core');
const aiService = require('../server/daily-issue-ai-service');
const morning = require('../server/daily-issue-morning-scheduler-service');
const { readRegionAiEnv, isAiPipelineEnabledForRegion } = require('../config/daily-issue-ai-env');
const { bootDailyIssueLocalPg } = require('./lib/daily-issue-local-pg-harness');

const AS_OF = '2026-11-04T22:00:00.000Z';

let failed = 0;
const status = {
  implemented: 'IMPLEMENTED',
  mockPass: 'MOCK PASS',
  isolatedDb: 'ISOLATED DB PASS',
  liveAi: 'LIVE AI PASS',
  blocked: 'BLOCKED',
  fail: 'FAIL',
};

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

function mockAdapter(payloadFn) {
  return {
    callStructured: async function () {
      return {
        ok: true,
        payload: payloadFn(),
        usage: { prompt_tokens: 50, completion_tokens: 40 },
        estimatedUsd: 0.002,
        model: 'mock',
        provider: 'mock',
      };
    },
  };
}

function usCandidate() {
  return {
    ok: true,
    publicationStatus: 'READY',
    freshnessOk: true,
    activityRegion: 'US',
    title: 'Bank review findings released',
    confirmedSummary: 'Agencies released bank supervision review findings.',
    claims: [
      {
        id: 'c1',
        text: 'Agencies released bank supervision review findings.',
        classification: 'CONFIRMED_FACT',
        isCore: true,
        supportingSourceIds: ['s1', 's2'],
      },
    ],
    normalizedSources: [
      {
        id: 's1',
        publisher: 'CBS News',
        url: 'https://www.cbsnews.com/news/us-fixture-1',
        publishedAt: '2026-11-03T12:00:00.000Z',
        independentNetworkKey: 'cbsnews-com',
        evidenceSnippet: 'Agencies released bank supervision review findings from a joint review.',
      },
      {
        id: 's2',
        publisher: 'KQED',
        url: 'https://www.kqed.org/news/us-fixture-2',
        publishedAt: '2026-11-03T13:00:00.000Z',
        independentNetworkKey: 'kqed-org',
        evidenceSnippet: 'Agencies released bank supervision review findings after prior supervisory concerns.',
      },
    ],
    independentSourceGate: { ok: true, journalismIndependentCount: 2 },
    qualityFailureReasons: [],
    retrievedAt: AS_OF,
  };
}

function krCandidate() {
  return {
    ok: true,
    publicationStatus: 'READY',
    freshnessOk: true,
    activityRegion: 'KR',
    title: '통계청 고용 통계',
    confirmedSummary: '통계청이 고용 통계를 발표했다.',
    claims: [
      {
        id: 'c1',
        text: '통계청이 고용 통계를 발표했다.',
        classification: 'CONFIRMED_FACT',
        isCore: true,
        supportingSourceIds: ['s1', 's2'],
      },
    ],
    normalizedSources: [
      {
        id: 's1',
        publisher: '연합뉴스',
        url: 'https://www.yna.co.kr/view/1',
        publishedAt: '2026-11-03T10:00:00.000Z',
        independentNetworkKey: 'yna-co-kr',
        evidenceSnippet: '통계청이 고용 통계를 발표했다.',
      },
      {
        id: 's2',
        publisher: '한국경제',
        url: 'https://www.hankyung.com/view/1',
        publishedAt: '2026-11-03T11:00:00.000Z',
        independentNetworkKey: 'hankyung-com',
        evidenceSnippet: '통계청 고용 통계 발표가 이뤄졌다.',
      },
    ],
    independentSourceGate: { ok: true, journalismIndependentCount: 2 },
    qualityFailureReasons: [],
    retrievedAt: AS_OF,
  };
}

function payloadUs(c) {
  const s1 = c.normalizedSources[0];
  const s2 = c.normalizedSources[1];
  return {
    articleTitle: 'Agencies release bank supervision review findings',
    factSummary: 'Agencies released bank supervision review findings.',
    backgroundContext: 'Follow-up to prior supervisory concerns about large banks.',
    confirmedFacts: [{ text: 'Agencies released bank supervision review findings.', sourceIds: ['s1', 's2'] }],
    unverifiedClaims: [],
    discussionQuestion: 'What should depositors watch in these findings?',
    referenceLinks: [
      { sourceId: 's1', url: s1.url, publisherTitle: s1.publisher, publishedDate: '2026-11-03' },
      { sourceId: 's2', url: s2.url, publisherTitle: s2.publisher, publishedDate: '2026-11-03' },
    ],
    nationalRelevance: 'high',
    debateSuitability: 'yes',
    factStatusNote: 'Two independent outlets',
  };
}

function payloadKr(c) {
  const s1 = c.normalizedSources[0];
  const s2 = c.normalizedSources[1];
  return {
    articleTitle: '통계청, 고용 통계 발표',
    factSummary: '통계청이 고용 통계를 발표했다.',
    backgroundContext: '통계청 고용 통계 발표가 이뤄졌다.',
    confirmedFacts: [{ text: '통계청이 고용 통계를 발표했다.', sourceIds: ['s1', 's2'] }],
    unverifiedClaims: [],
    discussionQuestion: '이번 고용 통계에서 가계는 무엇을 확인하면 좋을까요?',
    referenceLinks: [
      { sourceId: 's1', url: s1.url, publisherTitle: s1.publisher, publishedDate: '2026-11-03' },
      { sourceId: 's2', url: s2.url, publisherTitle: s2.publisher, publishedDate: '2026-11-03' },
    ],
    nationalRelevance: 'high',
    debateSuitability: 'yes',
    factStatusNote: '두 언론 교차',
  };
}

async function runMockTests() {
  console.log('=== PHASE15_MOCK ===');
  process.env.DAILY_ISSUE_US_AI_API_KEY = 'mock-us';
  process.env.DAILY_ISSUE_KR_AI_ENABLED = '1';
  process.env.DAILY_ISSUE_KR_AI_API_KEY = 'mock-kr';

  const us = usCandidate();
  const kr = krCandidate();

  const usRes = await aiService.evaluateOneCandidate(us, {
    asOf: AS_OF,
    region: 'US',
    adapter: mockAdapter(function () {
      return payloadUs(us);
    }),
  });
  check('US mock AI', usRes.ok === true, usRes.errorCode);
  check('US English title', /Agencies/.test(usRes.candidate.title));

  const krRes = await aiService.evaluateOneCandidate(kr, {
    asOf: AS_OF,
    region: 'KR',
    adapter: mockAdapter(function () {
      return payloadKr(kr);
    }),
  });
  check('KR mock AI', krRes.ok === true, krRes.errorCode);
  check('KR Hangul title', /통계청/.test(krRes.candidate.title));

  const badNum = await aiService.evaluateOneCandidate(us, {
    asOf: AS_OF,
    region: 'US',
    adapter: mockAdapter(function () {
      return Object.assign(payloadUs(us), {
        confirmedFacts: [{ text: 'Exactly 999999 jobs vanished yesterday.', sourceIds: ['s1'] }],
      });
    }),
  });
  check(
    'fabricated number 999999 blocked',
    badNum.ok !== true && badNum.runOutcome === evalCore.RUN_OUTCOME.FACT_VERIFICATION_FAILED,
    badNum.runOutcome || badNum.errorCode,
  );

  delete process.env.DAILY_ISSUE_KR_AI_ENABLED;
  check('KR pipeline off by default', isAiPipelineEnabledForRegion('KR', process.env) === false);

  delete process.env.DAILY_ISSUE_US_AI_API_KEY;
  delete process.env.DAILY_ISSUE_KR_AI_API_KEY;
}

async function runKrCollectSkipAi() {
  console.log('=== PHASE15_KR_NO_AI_BY_DEFAULT ===');
  const collect = await morning.defaultCollectAndEnqueue({
    group: 'korea-economy',
    language: 'ko',
    skipNetwork: true,
    feedBodies: {},
    asOf: AS_OF,
    dryRun: true,
    activityRegion: 'KR',
  });
  check('KR collect without AI flag skips regionAiRun pipeline', !collect.regionAiRun || collect.regionAiRun === null);
}

async function runPgIsolation() {
  console.log('=== PHASE15_PG ===');
  let pgStatus = status.blocked;
  let pg = null;
  try {
    pg = await bootDailyIssueLocalPg({});
    check('PG harness boot', pg.ok === true, pg.error || '');
    if (pg.ok) pgStatus = status.isolatedDb;
  } catch (e) {
    console.log('PG_SKIP', String(e && e.message ? e.message : e).slice(0, 200));
    pgStatus = status.blocked;
  } finally {
    if (pg && pg.shutdown) {
      try {
        await pg.shutdown();
      } catch (_) {}
    }
  }
  console.log('PG_STATUS', pgStatus);
}

async function main() {
  console.log('ENGINE_STATUS', status.implemented);
  await runMockTests();
  await runKrCollectSkipAi();
  await runPgIsolation();

  const liveEnv = readRegionAiEnv('US', process.env);
  console.log(
    'LIVE_AI_STATUS',
    liveEnv.configured && liveEnv.liveTestAllowed ? status.liveAi : status.blocked,
  );

  const r14 = spawnSync(process.execPath, [path.join(__dirname, 'test-daily-issue-us-phase14-ai.js')], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  check('phase14 regression', r14.status === 0, 'exit ' + r14.status);

  if (failed) {
    console.log('PHASE15_FAIL', failed);
    console.log('OVERALL', status.fail);
    process.exitCode = 1;
  } else {
    console.log('PHASE15_OK');
    console.log('MOCK_STATUS', status.mockPass);
  }
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
