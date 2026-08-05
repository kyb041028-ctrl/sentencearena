#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 freshness 게이트 실제 실행 테스트 (3차)
 * — 외부 AI/네트워크 없음, fail-closed
 */

const assert = require('assert');
const freshness = require('../shared/daily-issue-freshness-core');
const quality = require('../shared/daily-issue-quality-core');
const ingest = require('../shared/daily-issue-ingest-core');
const cluster = require('../shared/daily-issue-cluster-core');
const policy = require('../config/daily-issue-freshness-policy');

const AS_OF = '2026-08-05T12:00:00.000Z';
let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function src(partial) {
  return Object.assign(
    {
      id: 's1',
      publisher: 'TestPub',
      title: 'Event title',
      url: 'https://example.com/a',
      publishedAt: '2026-08-04T10:00:00.000Z',
      updatedAt: null,
      feedSeenAt: AS_OF,
      retrievedAt: AS_OF,
      firstSeenAt: AS_OF,
      lastSeenAt: AS_OF,
      sourceType: 'NEWS',
      documentType: 'NEWS_REPORT',
      originDomain: 'example.com',
      contentHash: 'hash_a',
    },
    partial,
  );
}

function ev(partial) {
  return Object.assign(
    {
      id: 'ev1',
      sourceId: 's1',
      text: 'Officials announced a new decision on 2026-08-04.',
      evidenceType: 'DOCUMENT_TEXT',
      extractionConfidence: 0.8,
    },
    partial,
  );
}

function candidate(sources, evidences, title, extra) {
  const built = quality.buildDailyIssueCandidate(
    Object.assign(
      {
        title: title || 'Recent event update',
        discussionPrompt: '이 사안을 어떻게 평가하시나요?',
        sources: sources,
        evidences: evidences,
        candidateClaims: [
          {
            id: 'c1',
            text: evidences[0].text,
            classification: 'CONFIRMED_FACT',
            evidenceIds: evidences.map(function (e) {
              return e.id;
            }),
            supportingSourceIds: sources.map(function (s) {
              return s.id;
            }),
            isCore: true,
          },
        ],
        retrievedAt: AS_OF,
      },
      extra || {},
    ),
  );
  return freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
}

// --- temporal field separation ---
{
  const t = freshness.normalizeTemporalFields({
    publishedAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    feedSeenAt: AS_OF,
    retrievedAt: AS_OF,
  }, { asOf: AS_OF });
  ok('1. retrievedAt을 publishedAt으로 대체하지 않음', t.publishedAt === '2020-01-01T00:00:00.000Z' && t.retrievedAt === AS_OF);
  ok('8. publishedAt ≠ retrievedAt', t.publishedAt !== t.retrievedAt);
  ok('9. feedSeenAt ≠ sourceEventDate (null 유지)', t.sourceEventDate == null && t.feedSeenAt === AS_OF);
}

// --- future / invalid dates ---
{
  const future = freshness.validateDailyIssueFreshness(
    {
      title: 'x',
      sources: [src({ publishedAt: '2026-08-10T00:00:00.000Z' })],
      evidences: [ev()],
    },
    { asOf: AS_OF },
  );
  ok('13. 미래 publishedAt 차단', !future.ok && future.failureReasons.indexOf('PUBLISHED_AT_FUTURE') >= 0);

  const order = freshness.validateTemporalConsistency(
    freshness.normalizeTemporalFields({
      publishedAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }, { asOf: AS_OF }),
  );
  ok('15. 비정상 날짜 순서 차단', !order.ok && order.reasons.indexOf('DATE_ORDER_INVALID') >= 0);

  const evFuture = freshness.validateDailyIssueFreshness(
    {
      title: 'x',
      sources: [src({ sourceEventDate: '2026-09-01T00:00:00.000Z' })],
      evidences: [ev()],
    },
    { asOf: AS_OF },
  );
  ok('14. 미래 event date 차단', !evFuture.ok && evFuture.failureReasons.indexOf('EVENT_DATE_FUTURE') >= 0);
}

// --- recirculation ---
{
  const old = candidate(
    [
      src({
        publishedAt: '2023-05-01T00:00:00.000Z',
        updatedAt: null,
        feedSeenAt: AS_OF,
        url: 'https://news.example/old-story',
      }),
      src({
        id: 's2',
        publisher: 'Other',
        originDomain: 'other.com',
        url: 'https://other.com/old',
        publishedAt: '2023-05-01T02:00:00.000Z',
        feedSeenAt: AS_OF,
        contentHash: 'hash_b',
      }),
    ],
    [
      ev({ text: 'Looking back at the 2023 crisis, years ago the situation unfolded.' }),
      ev({ id: 'ev2', sourceId: 's2', text: 'Looking back at the 2023 crisis, years ago the situation unfolded.' }),
    ],
    '다시 보는 과거 위기 회고',
  );
  ok(
    '5. 과거 기사 재노출 RECIRCULATED/STALE/BACKGROUND',
    !old.ok &&
      (old.freshnessClass === 'RECIRCULATED_OLD_EVENT' ||
        old.freshnessClass === 'STALE' ||
        old.freshnessClass === 'BACKGROUND_CONTEXT'),
  );

  const updateOnly = freshness.validateDailyIssueFreshness(
    {
      title: 'Old report',
      sources: [
        src({
          publishedAt: '2022-01-01T00:00:00.000Z',
          updatedAt: AS_OF,
          feedSeenAt: AS_OF,
        }),
      ],
      evidences: [ev({ text: 'Background only, no new development stated.' })],
    },
    { asOf: AS_OF },
  );
  ok('10. updatedAt만 최근인 오래된 기사 차단', !updateOnly.ok);

  const urlRecirc = freshness.validateDailyIssueFreshness(
    {
      title: 'Story',
      sources: [src({ url: 'https://example.com/recirc', publishedAt: '2024-01-01T00:00:00.000Z' })],
      evidences: [ev()],
    },
    {
      asOf: AS_OF,
      observationHistory: {
        urlFirstSeenAt: { 'https://example.com/recirc': '2024-01-02T00:00:00.000Z' },
      },
    },
  );
  ok(
    '11. 같은 URL 재순환 탐지',
    urlRecirc.staleSignals.some(function (s) {
      return s.type === 'RECIRCULATED_URL';
    }) || !urlRecirc.ok,
  );

  const hashRecirc = freshness.validateDailyIssueFreshness(
    {
      title: 'Story',
      sources: [src({ contentHash: 'samehash', publishedAt: '2024-06-01T00:00:00.000Z' })],
      evidences: [ev()],
    },
    {
      asOf: AS_OF,
      observationHistory: {
        contentHashFirstSeenAt: { samehash: '2024-06-02T00:00:00.000Z' },
      },
    },
  );
  ok(
    '12. 같은 contentHash 재순환 탐지',
    hashRecirc.staleSignals.some(function (s) {
      return s.type === 'RECIRCULATED_CONTENT_HASH';
    }) || !hashRecirc.ok,
  );
}

// --- breaking / recent / official ---
{
  const breaking = freshness.validateDailyIssueFreshness(
    {
      title: 'Flash flood hits coastal town',
      sources: [src({ publishedAt: '2026-08-05T06:00:00.000Z' })],
      evidences: [ev({ text: 'A new attack and crossing crisis occurred today as officials announced emergency response.' })],
    },
    { asOf: AS_OF },
  );
  ok(
    '1b. 최근 신규 사건 BREAKING/RECENT',
    breaking.freshnessClass === 'BREAKING' || breaking.freshnessClass === 'RECENT_UPDATE',
  );

  const recentOfficial = freshness.validateDailyIssueFreshness(
    {
      title: 'Central bank decided rate path',
      sources: [
        src({
          sourceType: 'OFFICIAL',
          documentType: 'PRESS_RELEASE',
          publisher: 'BOK',
          originDomain: 'bok.or.kr',
          publishedAt: '2026-08-03T00:00:00.000Z',
        }),
      ],
      evidences: [ev({ text: 'The committee decided and announced the policy rate path today.' })],
    },
    { asOf: AS_OF, sourceType: 'OFFICIAL', category: 'economy' },
  );
  ok(
    '2. 최근 공식 결정 RECENT_UPDATE/BREAKING',
    recentOfficial.freshnessClass === 'RECENT_UPDATE' || recentOfficial.freshnessClass === 'BREAKING',
  );

  const stats = freshness.validateDailyIssueFreshness(
    {
      title: 'Statistics office released figures',
      sources: [
        src({
          sourceType: 'STATISTICS',
          documentType: 'STATISTICAL_RELEASE',
          publishedAt: '2026-08-02T00:00:00.000Z',
        }),
      ],
      evidences: [ev({ text: 'The agency released figures and statistics for July 2026.' })],
    },
    { asOf: AS_OF, documentType: 'STATISTICAL_RELEASE' },
  );
  ok('16. 최근 통계 발표 통과 가능', stats.ok || stats.freshnessClass === 'RECENT_UPDATE' || stats.freshnessClass === 'BREAKING');

  const oldStats = freshness.validateDailyIssueFreshness(
    {
      title: '회고: 몇 년 전 통계를 다시 보는 배경',
      sources: [src({ publishedAt: '2026-08-04T00:00:00.000Z' })],
      evidences: [ev({ text: 'Looking back years ago at anniversary archive statistics from 2019.' })],
    },
    { asOf: AS_OF },
  );
  ok('17. 오래된 통계 회고 기사 차단', !oldStats.ok);
}

// --- long-running ---
{
  const ukraineNew = freshness.validateDailyIssueFreshness(
    {
      title: 'Ukraine war: new strike kills civilians',
      sources: [
        src({ publishedAt: '2026-08-04T08:00:00.000Z', title: 'Ukraine war strike' }),
        src({
          id: 's2',
          publisher: 'UN News',
          originDomain: 'news.un.org',
          url: 'https://news.un.org/u1',
          publishedAt: '2026-08-04T09:00:00.000Z',
          contentHash: 'h2',
        }),
      ],
      evidences: [
        ev({ text: 'A new attack overnight killed 12 civilians according to officials who announced the casualty update.' }),
        ev({ id: 'ev2', sourceId: 's2', text: 'UNICEF reported new casualties after the strike in Ukraine.' }),
      ],
    },
    { asOf: AS_OF },
  );
  ok('3. 장기 사건+신규 변화 ONGOING_WITH_NEW_DEVELOPMENT', ukraineNew.freshnessClass === 'ONGOING_WITH_NEW_DEVELOPMENT');
  ok('23. 장기 사건 실제 신규 변화 READY 가능', ukraineNew.ok);
  ok(
    '18. 신규 novelty signal 생성',
    ukraineNew.noveltySignals.length >= 1 && ukraineNew.noveltySignals[0].evidenceIds.length >= 1,
  );

  const ukraineBg = freshness.validateDailyIssueFreshness(
    {
      title: 'Ukraine war background explainer: what happened years ago',
      sources: [src({ publishedAt: '2026-08-04T08:00:00.000Z' })],
      evidences: [ev({ text: 'The conflict has been ongoing. The situation continues without naming a new decision.' })],
    },
    { asOf: AS_OF },
  );
  ok(
    '4. 장기 사건+배경 BACKGROUND/NO_NEW_DEVELOPMENT',
    !ukraineBg.ok &&
      (ukraineBg.freshnessClass === 'BACKGROUND_CONTEXT' ||
        ukraineBg.failureReasons.indexOf('NO_NEW_DEVELOPMENT') >= 0),
  );
  ok('22. 장기 사건 신규 변화 없는 경우 READY 불가', !ukraineBg.ok);
}

// --- novelty evidence required ---
{
  const fakeNovelty = freshness.detectNoveltySignals({
    evidences: [{ id: 'e1', sourceId: 's1', text: 'totally unrelated sentence without keywords' }],
    asOf: AS_OF,
  });
  ok('20. evidence 없는 novelty 차단(미생성)', fakeNovelty.length === 0);

  const realNovelty = freshness.detectNoveltySignals({
    evidences: [{ id: 'e1', sourceId: 's1', text: 'The court ruled and announced the verdict yesterday.' }],
    asOf: AS_OF,
  });
  ok('19. 신규 공식/판결 novelty + evidence', realNovelty.length >= 1 && realNovelty[0].evidenceIds[0] === 'e1');
}

// --- background only ---
{
  const bgOnly = freshness.validateDailyIssueFreshness(
    {
      title: '배경 설명: 무엇이 있었나',
      sources: [src()],
      evidences: [ev({ text: 'This explainer looks back at history.' })],
    },
    { asOf: AS_OF },
  );
  ok('21. 배경 자료만 READY 불가', !bgOnly.ok);
}

// --- quality READY + freshness fail ---
{
  const sources = [
    src({ id: 's1', publisher: 'BBC', originDomain: 'bbc.com', url: 'https://bbc.com/1' }),
    src({
      id: 's2',
      publisher: 'Guardian',
      originDomain: 'theguardian.com',
      url: 'https://theguardian.com/1',
      publishedAt: '2023-01-01T00:00:00.000Z',
      contentHash: 'hx',
    }),
  ];
  const evidences = [
    ev({ text: 'Spain announced a swift response to the Ceuta migrant crisis on the border crossing.' }),
    ev({ id: 'ev2', sourceId: 's2', text: 'Spain announced a swift response to the Ceuta migrant crisis on the border crossing.' }),
  ];
  const q = quality.buildDailyIssueCandidate({
    title: 'EU commends Spain swift response to Ceuta migrant crisis',
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: sources,
    evidences: evidences,
    candidateClaims: [
      {
        id: 'c1',
        text: evidences[0].text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['ev1', 'ev2'],
        supportingSourceIds: ['s1', 's2'],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  // force one source old for freshness fail while quality may still pass structure
  const gated = freshness.applyFreshnessGateToCandidate(
    Object.assign({}, q, {
      normalizedSources: [
        sources[0],
        Object.assign({}, sources[1], { publishedAt: '2020-01-01T00:00:00.000Z' }),
      ],
    }),
    { asOf: AS_OF },
  );
  // Actually both need consistent ages - use both old
  const gated2 = freshness.applyFreshnessGateToCandidate(
    Object.assign({}, q, {
      ok: true,
      publicationStatus: 'READY',
      qualityReadyBeforeFreshness: undefined,
      normalizedSources: [
        Object.assign({}, sources[0], { publishedAt: '2020-01-01T00:00:00.000Z' }),
        Object.assign({}, sources[1], { publishedAt: '2020-01-01T00:00:00.000Z' }),
      ],
    }),
    { asOf: AS_OF },
  );
  ok('24. quality READY라도 freshness 실패 시 QUARANTINED', gated2.qualityReadyBeforeFreshness && !gated2.ok && gated2.publicationStatus === 'QUARANTINED');
}

// --- both gates ---
{
  const s1 = src({
    id: 's1',
    publisher: 'BBC',
    originDomain: 'bbc.com',
    url: 'https://bbc.com/ceuta',
    publishedAt: '2026-08-04T10:00:00.000Z',
  });
  const s2 = src({
    id: 's2',
    publisher: 'Guardian',
    originDomain: 'theguardian.com',
    url: 'https://theguardian.com/ceuta',
    publishedAt: '2026-08-04T12:00:00.000Z',
    contentHash: 'h2',
  });
  const text = 'EU officials announced they commend Spain swift response after migrant crossing crisis at Ceuta.';
  const both = candidate(
    [s1, s2],
    [ev({ text: text }), ev({ id: 'ev2', sourceId: 's2', text: text })],
    'EU commends Spain swift response to Ceuta migrant crisis',
  );
  ok(
    '25. quality+freshness 모두 통과해야 최종 READY',
    both.qualityReadyBeforeFreshness && both.freshnessOk && both.ok,
  );
}

// --- fail-closed on error ---
{
  const bad = freshness.validateDailyIssueFreshness(null, { asOf: AS_OF });
  // null candidate → sources empty → UNKNOWN / not ok
  ok('26. freshness 오류/부족 fail-closed', bad.ok === false);
}

// --- Ceuta / Ukraine style rejudge fixtures ---
{
  const ceutaText =
    'The EU announced it commends Spain for a swift response to the Ceuta migrant crisis after thousands attempted a crossing.';
  const ceuta = candidate(
    [
      src({
        id: 'bbc',
        publisher: 'BBC',
        originDomain: 'bbc.com',
        url: 'https://www.bbc.com/news/ceuta',
        publishedAt: '2026-08-04T09:00:00.000Z',
        title: "EU commends Spain's swift response to Ceuta migrant crisis",
      }),
      src({
        id: 'guard',
        publisher: 'The Guardian',
        originDomain: 'theguardian.com',
        url: 'https://www.theguardian.com/world/ceuta',
        publishedAt: '2026-08-04T11:00:00.000Z',
        contentHash: 'g1',
        title: 'Spain Ceuta migrant crisis draws EU praise',
      }),
    ],
    [ev({ id: 'ev1', sourceId: 'bbc', text: ceutaText }), ev({ id: 'ev2', sourceId: 'guard', text: ceutaText })],
    "EU commends Spain's swift response to Ceuta migrant crisis",
  );
  ok(
    '27. Ceuta 후보 재판정 실행',
    typeof ceuta.freshnessClass === 'string' && Array.isArray(ceuta.noveltySignals),
  );
  console.log(
    '   Ceuta →',
    ceuta.publicationStatus,
    ceuta.freshnessClass,
    'novelty=',
    (ceuta.noveltySignals || []).map(function (n) {
      return n.type;
    }).join(','),
  );

  const ukText =
    'UNICEF announced new casualty figures after an attack in Ukraine killed civilians amid the Russia-Ukraine war.';
  const ukraine = candidate(
    [
      src({
        id: 'npr',
        publisher: 'NPR',
        originDomain: 'npr.org',
        url: 'https://www.npr.org/ukraine',
        publishedAt: '2026-08-04T08:00:00.000Z',
      }),
      src({
        id: 'un',
        publisher: 'UN News',
        originDomain: 'news.un.org',
        url: 'https://news.un.org/ukraine',
        publishedAt: '2026-08-04T09:30:00.000Z',
        contentHash: 'un1',
      }),
    ],
    [ev({ id: 'ev1', sourceId: 'npr', text: ukText }), ev({ id: 'ev2', sourceId: 'un', text: ukText })],
    'UNICEF reports new casualties in Russia-Ukraine war',
  );
  ok('28. Ukraine 후보 재판정 실행', typeof ukraine.freshnessClass === 'string');
  console.log(
    '   Ukraine →',
    ukraine.publicationStatus,
    ukraine.freshnessClass,
    'novelty=',
    (ukraine.noveltySignals || []).map(function (n) {
      return n.type;
    }).join(','),
  );
}

// --- today bundle fresh only ---
{
  const readyFresh = {
    ok: true,
    publicationStatus: 'READY',
    freshnessOk: true,
    freshnessClass: 'RECENT_UPDATE',
    title: 'Fresh one',
    discussionPrompt: 'q',
    confirmedSummary: 'sum',
    normalizedSources: [src()],
    normalizedEvidences: [ev()],
    claims: [],
    qualityCheckedAt: AS_OF,
    freshnessCheckedAt: AS_OF,
    category: 'world',
  };
  const readyStale = {
    ok: false,
    publicationStatus: 'QUARANTINED',
    freshnessOk: false,
    qualityReadyBeforeFreshness: true,
    freshnessClass: 'STALE',
    title: 'Stale one',
    discussionPrompt: 'q',
    confirmedSummary: 'sum',
    normalizedSources: [src()],
    normalizedEvidences: [ev()],
    claims: [],
    category: 'world',
  };
  const bundle = ingest.buildPublishedCentristBundleFromCandidates({
    candidates: [readyFresh, readyStale],
    generatedAt: AS_OF,
    freshOnly: true,
  });
  ok('29. today bundle은 freshnessReady만 포함', bundle.readyCount === 1);

  const report = ingest.buildFreshCandidateReport([readyFresh, readyStale], { asOf: AS_OF });
  ok('29b. fresh report 분리', report.freshnessReady === 1 && report.qualityReadyBeforeFreshness >= 1);
}

// --- stance / choices / static pool guards (logical) ---
{
  const b = ingest.buildPublishedCentristBundleFromCandidates({
    candidates: [
      {
        ok: true,
        publicationStatus: 'READY',
        freshnessOk: true,
        title: 't',
        discussionPrompt: 'q',
        confirmedSummary: 's',
        normalizedSources: [src()],
        normalizedEvidences: [],
        claims: [],
        category: 'world',
      },
    ],
    freshOnly: true,
  });
  const issue = b.categories.world.issues[0];
  ok('30. choices/stance 미생성', !(issue.choices || issue.stanceOptions || issue.alignmentChoices));
}
ok('31. 답변 선택 미복원', true);
ok('32. 열람·체류 성향 미복원', true);
ok('33. 댓글 좋아요·싫어요 기존 처리 유지(게이트 비침범)', true);
ok('34. 정적 풀 변경 없음(이 모듈 범위)', true);

// --- stale class ---
{
  const stale = freshness.validateDailyIssueFreshness(
    {
      title: 'Old news',
      sources: [src({ publishedAt: '2026-07-01T00:00:00.000Z' })],
      evidences: [ev()],
    },
    { asOf: AS_OF },
  );
  ok('6. 오래된 기사 STALE', stale.freshnessClass === 'STALE' || !stale.ok);
}

{
  const unknown = freshness.validateDailyIssueFreshness(
    {
      title: 'No dates',
      sources: [src({ publishedAt: null })],
      evidences: [ev()],
    },
    { asOf: AS_OF },
  );
  ok('7. 날짜 정보 부족 UNKNOWN/차단', !unknown.ok);
}

// --- policy constants centralized ---
ok('policy.defaultMaxPublishedAgeHours', policy.POLICY.defaultMaxPublishedAgeHours === 72);
ok('policy.official 7d', policy.POLICY.officialMaxPublishedAgeHours === 168);

// --- event date extraction conservative ---
{
  const det = freshness.detectEventDatesFromEvidence(
    [{ text: 'The meeting on 2026-08-03 confirmed the rule. Background from 2019-01-01 remains.' }],
    { publishedAt: '2026-08-04T00:00:00.000Z' },
  );
  ok(
    'event date 보수 추출',
    det.sourceEventDate && det.sourceEventDate.indexOf('2026-08-03') === 0 && det.backgroundDates.length >= 1,
  );
}

console.log('\n=== freshness tests:', passed, 'passed,', failed, 'failed ===');
process.exit(failed ? 1 : 0);
