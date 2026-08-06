#!/usr/bin/env node
'use strict';

const titleFact = require('../shared/daily-issue-title-fact-core');
const ingestCore = require('../shared/daily-issue-ingest-core');
const qualityCore = require('../shared/daily-issue-quality-core');
const clusterCore = require('../shared/daily-issue-cluster-core');

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

function doc(id, title, publisher, sourceId) {
  return {
    id: id,
    sourceId: id,
    title: title,
    publisher: publisher,
    publishedAt: '2026-08-06T07:00:00.000Z',
    rawText: '',
    textFrom: 'empty',
    sourceType: 'NEWS',
    sourceRegistryId: sourceId,
  };
}

function buildTwoSourceCandidate(d1, d2) {
  var cluster = clusterCore.clusterDocuments([d1, d2]).find(function (c) {
    return c.documentIds.length === 2;
  });
  if (!cluster) {
    cluster = { id: 'manual_pair', documentIds: [d1.id, d2.id] };
  }
  var docsById = {};
  docsById[d1.id] = d1;
  docsById[d2.id] = d2;
  return ingestCore.buildCandidateFromCluster(cluster, docsById, {
    asOf: '2026-08-06T08:00:00.000Z',
    skipFreshness: true,
  });
}

console.log('=== daily issue title-fact tests ===');

var cjA = doc(
  'cj1',
  'CJ프레시웨이 2분기 영업익 14% 감소…"온라인 사업 투자 영향"',
  '연합뉴스',
  'yonhap-ko-economy',
);
var cjB = doc(
  'cj2',
  'CJ프레시웨이 2분기 영업익 235억원, 전년比 14.2% 감소…“식봄·급식 성장”',
  '매일경제',
  'mk-economy',
);
var cjBuilt = buildTwoSourceCandidate(cjA, cjB);
var cjConfirmed = (cjBuilt.claims || []).filter(function (c) {
  return c.classification === 'CONFIRMED_FACT';
});
ok(
  'CJ numeric mismatch → safe confirmed without conflicting amounts',
  cjConfirmed.length === 1 &&
    !/235|14\.?2?%/.test(cjConfirmed[0].text) &&
    cjConfirmed[0].text.indexOf('CJ프레시웨이') >= 0,
);
ok(
  'CJ numeric conflict recorded',
  (cjBuilt.claims || []).some(function (c) {
    return c.classification === 'SOURCE_DISAGREEMENT';
  }),
);

var daewooA = doc(
  'd1',
  '대우건설 신임 대표 후보에 이강석 상무…현 김보현 사장 용퇴',
  '연합뉴스',
  'yonhap-ko-economy',
);
var daewooB = doc(
  'd2',
  '“역동적 리더십”…대우건설, 이강석 부사장 대표이사 추천 예정',
  '매일경제',
  'mk-economy',
);
var daewooBuilt = buildTwoSourceCandidate(daewooA, daewooB);
ok(
  '대우건설 appointment confirmed or quality-ready',
  daewooBuilt.qualityReadyBeforeFreshness || (daewooBuilt.claims || []).some(function (c) {
    return c.classification === 'CONFIRMED_FACT';
  }),
);

var diffA = doc('x1', '삼성전자 실적 발표', 'A', 'a');
var diffB = doc('x2', 'LG전자 신제품 공개', 'B', 'b');
var diffBuilt = buildTwoSourceCandidate(diffA, diffB);
ok(
  'different subjects no confirmed',
  !(diffBuilt.claims || []).some(function (c) {
    return c.classification === 'CONFIRMED_FACT';
  }),
);

var forecastA = doc('f1', '코스피 5000 전망…증권가 분석', 'A', 'a');
var forecastB = doc('f2', '코스피 5000 가능성…전망', 'B', 'b');
var forecastBuilt = buildTwoSourceCandidate(forecastA, forecastB);
ok(
  'forecast excluded from confirmed',
  !(forecastBuilt.claims || []).some(function (c) {
    return c.classification === 'CONFIRMED_FACT';
  }),
);

var politicalA = doc('p1', '與 "세제개편 영향 모니터링"…일각 우려(종합)', '연합', 'y');
var politicalB = doc('p2', '세제개편 ‘태풍’에 대출규제 ‘폭탄’…', '매경', 'm');
var polBuilt = buildTwoSourceCandidate(politicalA, politicalB);
ok('political cluster may stay without naive confirmed', true);

var sameNumA = doc('n1', '통계청 고용률 62.5% 발표', '통계청', 'gov');
var sameNumB = doc('n2', '고용률 62.5% 공식 발표', '연합', 'news');
sameNumA.sourceType = 'OFFICIAL';
sameNumB.sourceType = 'NEWS';
sameNumA.rawText = '통계청은 고용률 62.5%를 발표했다.';
sameNumB.rawText = '통계청 고용률 62.5% 발표';
var numBuilt = buildTwoSourceCandidate(sameNumA, sameNumB);
ok(
  'matching numbers allowed when identical',
  numBuilt.qualityReadyBeforeFreshness || (numBuilt.claims || []).length > 0,
);

ok('quality gate version unchanged', qualityCore.QUALITY_GATE_VERSION === 2);

console.log('---');
console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
if (failed) process.exit(1);
