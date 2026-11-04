'use strict';

const quality = require('../../shared/daily-issue-quality-core');
const freshness = require('../../shared/daily-issue-freshness-core');

const AS_OF = '2026-11-04T23:00:00.000Z';

function buildUsReady(suffix) {
  const text = 'Agencies released bank supervision review findings.';
  const s1 = {
    id: 'p16_us_s1_' + suffix,
    publisher: 'CBS News',
    title: 'Bank review',
    url: 'https://www.cbsnews.com/news/p16-' + suffix,
    publishedAt: '2026-11-03T12:00:00.000Z',
    sourceType: 'NEWS',
    independentNetworkKey: 'cbsnews-com',
    originDomain: 'cbsnews.com',
    contentHash: 'p16_us_h1_' + suffix,
  };
  const s2 = {
    id: 'p16_us_s2_' + suffix,
    publisher: 'KQED',
    title: 'Bank review',
    url: 'https://www.kqed.org/news/p16-' + suffix,
    publishedAt: '2026-11-03T13:00:00.000Z',
    sourceType: 'NEWS',
    independentNetworkKey: 'kqed-org',
    originDomain: 'kqed.org',
    contentHash: 'p16_us_h2_' + suffix,
  };
  const ev1 = {
    id: 'p16_us_ev1_' + suffix,
    sourceId: s1.id,
    text: text + ' from a joint review.',
    evidenceType: 'DOCUMENT_TEXT',
    extractionConfidence: 0.92,
  };
  const ev2 = {
    id: 'p16_us_ev2_' + suffix,
    sourceId: s2.id,
    text: text + ' after prior supervisory concerns.',
    evidenceType: 'DOCUMENT_TEXT',
    extractionConfidence: 0.92,
  };
  const built = quality.buildDailyIssueCandidate({
    title: 'Bank supervision review findings ' + suffix,
    discussionPrompt: 'What should depositors watch?',
    sources: [s1, s2],
    evidences: [ev1, ev2],
    candidateClaims: [
      {
        id: 'p16_us_c1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [ev1.id, ev2.id],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  gated.activityRegion = 'US';
  gated.independentSourceGate = { ok: true, journalismIndependentCount: 2 };
  if (gated.normalizedSources) {
    gated.normalizedSources.forEach(function (s, i) {
      s.evidenceSnippet = i === 0 ? ev1.text : ev2.text;
    });
  }
  if (gated.sources) {
    gated.sources.forEach(function (s, i) {
      s.evidenceSnippet = i === 0 ? ev1.text : ev2.text;
    });
  }
  gated.candidateId = 'p16_us_' + suffix;
  gated.clusterId = 'p16_us_cl_' + suffix;
  gated.category = 'us-national';
  gated.sourceRefs = gated.sources || gated.normalizedSources || [];
  return gated;
}

function buildKrReady(suffix) {
  const text = '통계청이 고용 통계를 발표했다.';
  const s1 = {
    id: 'p16_kr_s1_' + suffix,
    publisher: '연합뉴스',
    title: '고용 통계',
    url: 'https://www.yna.co.kr/view/p16-' + suffix,
    publishedAt: '2026-11-03T10:00:00.000Z',
    sourceType: 'NEWS',
    independentNetworkKey: 'yna-co-kr',
    originDomain: 'yna.co.kr',
    contentHash: 'p16_kr_h1_' + suffix,
  };
  const s2 = {
    id: 'p16_kr_s2_' + suffix,
    publisher: '한국경제',
    title: '고용 통계',
    url: 'https://www.hankyung.com/view/p16-' + suffix,
    publishedAt: '2026-11-03T11:00:00.000Z',
    sourceType: 'NEWS',
    independentNetworkKey: 'hankyung-com',
    originDomain: 'hankyung.com',
    contentHash: 'p16_kr_h2_' + suffix,
  };
  const ev1 = {
    id: 'p16_kr_ev1_' + suffix,
    sourceId: s1.id,
    text: text,
    evidenceType: 'DOCUMENT_TEXT',
    extractionConfidence: 0.92,
  };
  const ev2 = {
    id: 'p16_kr_ev2_' + suffix,
    sourceId: s2.id,
    text: '통계청 고용 통계 발표가 이뤄졌다.',
    evidenceType: 'DOCUMENT_TEXT',
    extractionConfidence: 0.92,
  };
  const built = quality.buildDailyIssueCandidate({
    title: '통계청 고용 통계 ' + suffix,
    discussionPrompt: '이번 고용 통계에서 무엇을 볼까요?',
    sources: [s1, s2],
    evidences: [ev1, ev2],
    candidateClaims: [
      {
        id: 'p16_kr_c1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [ev1.id, ev2.id],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  gated.activityRegion = 'KR';
  gated.independentSourceGate = { ok: true, journalismIndependentCount: 2 };
  if (gated.normalizedSources) {
    gated.normalizedSources.forEach(function (s, i) {
      s.evidenceSnippet = i === 0 ? ev1.text : ev2.text;
    });
  }
  if (gated.sources) {
    gated.sources.forEach(function (s, i) {
      s.evidenceSnippet = i === 0 ? ev1.text : ev2.text;
    });
  }
  gated.candidateId = 'p16_kr_' + suffix;
  gated.clusterId = 'p16_kr_cl_' + suffix;
  gated.category = 'korea-economy';
  gated.sourceRefs = gated.sources || gated.normalizedSources || [];
  return gated;
}

function usAiPayload(cand) {
  const refs = cand.sourceRefs || cand.normalizedSources || cand.sources || [];
  const s1 = refs[0];
  const s2 = refs[1];
  const text = 'Agencies released bank supervision review findings.';
  return {
    articleTitle: 'Agencies released bank supervision review findings',
    factSummary: text,
    backgroundContext: text + ' after prior supervisory concerns.',
    confirmedFacts: [{ text: text, sourceIds: [s1.id, s2.id] }],
    unverifiedClaims: [],
    discussionQuestion: 'What should depositors watch in these findings?',
    referenceLinks: [
      { sourceId: s1.id, url: s1.url, publisherTitle: s1.publisher, publishedDate: '2026-11-03' },
      { sourceId: s2.id, url: s2.url, publisherTitle: s2.publisher, publishedDate: '2026-11-03' },
    ],
    nationalRelevance: 'high',
    debateSuitability: 'yes',
    factStatusNote: 'Two independent outlets',
  };
}

function krAiPayload(cand) {
  const refs = cand.sourceRefs || cand.normalizedSources || cand.sources || [];
  const s1 = refs[0];
  const s2 = refs[1];
  return {
    articleTitle: '통계청, 고용 통계 발표',
    factSummary: '통계청이 고용 통계를 발표했다.',
    backgroundContext: '통계청 고용 통계 발표가 이뤄졌다.',
    confirmedFacts: [{ text: '통계청이 고용 통계를 발표했다.', sourceIds: [s1.id, s2.id] }],
    unverifiedClaims: [],
    discussionQuestion: '이번 고용 통계에서 가계는 무엇을 확인하면 좋을까요?',
    referenceLinks: [
      { sourceId: s1.id, url: s1.url, publisherTitle: s1.publisher, publishedDate: '2026-11-03' },
      { sourceId: s2.id, url: s2.url, publisherTitle: s2.publisher, publishedDate: '2026-11-03' },
    ],
    nationalRelevance: 'high',
    debateSuitability: 'yes',
    factStatusNote: '두 언론 교차',
  };
}

function mockAdapter(payload) {
  return {
    callStructured: async function () {
      return {
        ok: true,
        payload: typeof payload === 'function' ? payload() : payload,
        usage: { prompt_tokens: 55, completion_tokens: 35 },
        estimatedUsd: 0.0012,
        model: 'mock-p16',
        provider: 'mock',
      };
    },
  };
}

module.exports = {
  AS_OF: AS_OF,
  buildUsReady: buildUsReady,
  buildKrReady: buildKrReady,
  usAiPayload: usAiPayload,
  krAiPayload: krAiPayload,
  mockAdapter: mockAdapter,
};
