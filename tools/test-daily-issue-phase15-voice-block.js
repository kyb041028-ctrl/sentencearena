#!/usr/bin/env node
'use strict';

/**
 * Phase 15 보완 — 음성(명시) 차단 증명. MOCK only. LIVE API / PG integration = BLOCKED (16차).
 */

const evalCore = require('../shared/daily-issue-ai-eval-core');
const aiService = require('../server/daily-issue-ai-service');
const decisionCore = require('../shared/daily-issue-publication-decision-core');

const AS_OF = '2026-11-04T23:00:00.000Z';

let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('VOICE_OK', name);
  else {
    failed += 1;
    console.log('VOICE_FAIL', name, detail || '');
  }
}

function mockReturn(payload) {
  return {
    callStructured: async function () {
      return {
        ok: true,
        payload: payload,
        usage: { prompt_tokens: 40, completion_tokens: 30 },
        estimatedUsd: 0.001,
        model: 'mock-voice',
        provider: 'mock',
      };
    },
  };
}

function usBase() {
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

function usGoodPayload(c) {
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

function krBase() {
  return {
    ok: true,
    publicationStatus: 'READY',
    freshnessOk: true,
    activityRegion: 'KR',
    title: '고용 통계 발표',
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

function krGoodPayload(c) {
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

async function expectBlocked(name, result) {
  check(name, result.ok !== true, result.errorCode || result.outcome);
  check(name + ' runOutcome set', !!result.runOutcome, result.runOutcome);
}

async function main() {
  console.log('=== PHASE15_VOICE_BLOCK ===');
  process.env.DAILY_ISSUE_US_AI_API_KEY = 'mock-voice';
  process.env.DAILY_ISSUE_KR_AI_ENABLED = '1';
  process.env.DAILY_ISSUE_KR_AI_API_KEY = 'mock-voice';

  const us = usBase();
  const kr = krBase();

  const usOk = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    adapter: mockReturn(usGoodPayload(us)),
  });
  check('US good candidate not over-blocked', usOk.ok === true, usOk.errorCode);
  check('US aiVerificationMeta preserved', !!(usOk.candidate && usOk.candidate.aiVerificationMeta));

  const krOk = await aiService.evaluateOneCandidate(kr, {
    region: 'KR',
    asOf: AS_OF,
    adapter: mockReturn(krGoodPayload(kr)),
  });
  check('KR good candidate not over-blocked', krOk.ok === true, krOk.errorCode);

  await expectBlocked(
    'fake number 999999 blocked',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      adapter: mockReturn(
        Object.assign({}, usGoodPayload(us), {
          confirmedFacts: [{ text: 'Exactly 999999 jobs vanished yesterday.', sourceIds: ['s1', 's2'] }],
        }),
      ),
    }),
  );

  await expectBlocked(
    'summary-only fabrication blocked',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      adapter: mockReturn(
        Object.assign({}, usGoodPayload(us), {
          factSummary: 'The president resigned yesterday after 888888 votes were nullified.',
        }),
      ),
    }),
  );

  await expectBlocked(
    'background-only fabrication blocked',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      adapter: mockReturn(
        Object.assign({}, usGoodPayload(us), {
          backgroundContext: 'Secret treaty with Mars signed on 2099-01-01.',
        }),
      ),
    }),
  );

  await expectBlocked(
    'valid IDs semantic lie blocked',
    await aiService.evaluateOneCandidate(us, {
      region: 'US',
      asOf: AS_OF,
      adapter: mockReturn(
        Object.assign({}, usGoodPayload(us), {
          confirmedFacts: [{ text: 'Congress abolished all banks overnight.', sourceIds: ['s1', 's2'] }],
        }),
      ),
    }),
  );

  await expectBlocked(
    'KR region swap blocked',
    await aiService.evaluateOneCandidate(kr, { region: 'US', asOf: AS_OF, adapter: mockReturn(krGoodPayload(kr)) }),
  );

  const gateInflated = Object.assign({}, us, {
    independentSourceGate: { ok: true, journalismIndependentCount: 99 },
  });
  check(
    'journalism gate mismatch blocked',
    evalCore.ruleEligibleForAi(gateInflated, 'US').ok === false,
  );

  const officialPlusOne = {
    ok: true,
    publicationStatus: 'READY',
    freshnessOk: true,
    activityRegion: 'KR',
    title: '고용 통계',
    confirmedSummary: '통계청이 고용 통계를 발표했다.',
    claims: kr.claims,
    normalizedSources: [
      {
        id: 's1',
        publisher: '통계청',
        url: 'https://kostat.go.kr/x',
        publishedAt: '2026-11-03T09:00:00.000Z',
        sourceType: 'OFFICIAL',
        evidenceSnippet: '통계청이 고용 통계를 발표했다.',
      },
      {
        id: 's2',
        publisher: '연합뉴스',
        url: 'https://www.yna.co.kr/view/2',
        publishedAt: '2026-11-03T10:00:00.000Z',
        independentNetworkKey: 'yna-co-kr',
        evidenceSnippet: '통계청이 고용 통계를 발표했다.',
      },
    ],
    independentSourceGate: { ok: true, journalismIndependentCount: 2 },
    qualityFailureReasons: [],
    retrievedAt: AS_OF,
  };
  const officialGate = evalCore.ruleEligibleForAi(officialPlusOne, 'KR');
  check(
    'official+1 journalism inflated gate fails',
    officialGate.ok === false &&
      (officialGate.reason === 'JOURNALISM_GATE_MISMATCH' || officialGate.reason === 'JOURNALISM_INDEPENDENT_TOO_LOW'),
    officialGate.reason,
  );

  delete process.env.DAILY_ISSUE_US_AI_API_KEY;
  const noKey = await aiService.evaluateOneCandidate(us, { region: 'US', asOf: AS_OF });
  check('no key not success', noKey.ok !== true && noKey.runOutcome === evalCore.RUN_OUTCOME.AI_NOT_CONFIGURED);

  const badJson = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: { DAILY_ISSUE_US_AI_API_KEY: 'x' },
    adapter: { callStructured: async () => ({ ok: false, errorCode: 'AI_INVALID_JSON' }) },
  });
  check('bad JSON blocks', badJson.ok !== true && badJson.runOutcome === evalCore.RUN_OUTCOME.AI_CALL_FAILED);

  check(
    'AI failed candidate not AUTO eligible',
    decisionCore.classifyPublicationDecision(
      Object.assign({}, us, {
        activityRegion: 'US',
        lifecycleMeta: { aiEval: { verificationStatus: 'AI_FAILED' } },
        aiVerificationMeta: { verificationStatus: 'AI_FAILED' },
      }),
      { asOf: AS_OF },
    ).publicationDecision !== decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE,
  );

  console.log('LIVE_AI_STATUS', 'BLOCKED');
  console.log('PG_INTEGRATION_STATUS', 'BLOCKED');

  if (failed) {
    console.log('PHASE15_VOICE_FAIL', failed);
    process.exitCode = 1;
  } else {
    console.log('PHASE15_VOICE_PASS');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
