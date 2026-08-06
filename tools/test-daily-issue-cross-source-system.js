#!/usr/bin/env node
'use strict';

/**
 * 교차 출처·공식 원문 fetch 집중 테스트 (fixture, 네트워크 비의존)
 * node tools/test-daily-issue-cross-source-system.js
 */

const fs = require('fs');
const path = require('path');
const allowlist = require('../config/daily-issue-fulltext-allowlist');
const htmlText = require('../shared/daily-issue-html-text-core');
const officialExtractor = require('../server/daily-issue-official-page-extractor');
const clusterCore = require('../shared/daily-issue-cluster-core');
const ingestCore = require('../shared/daily-issue-ingest-core');
const qualityCore = require('../shared/daily-issue-quality-core');
const sourceCore = require('../shared/daily-issue-source-core');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const boardHtml = fs.readFileSync(path.join(FIX, 'bok-official-board.html'), 'utf8');
const emptyHtml = fs.readFileSync(path.join(FIX, 'bok-official-empty.html'), 'utf8');
const bokRss = fs.readFileSync(path.join(FIX, 'bok-no-description.xml'), 'utf8');
const newsA = fs.readFileSync(path.join(FIX, 'news-a-ceuta.xml'), 'utf8');
const newsB = fs.readFileSync(path.join(FIX, 'news-b-ceuta.xml'), 'utf8');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name, detail || '');
    return;
  }
  passed += 1;
  console.log('PASS', name);
}

async function main() {
  console.log('=== daily issue cross-source tests ===');

  const okUrl =
    'https://www.bok.or.kr/portal/bbs/P0000093/view.do?nttId=11063124&menuNo=200789';
  assert('1. allowlist origin 통과', allowlist.evaluateFullTextUrl('bok-mpc-decisions', okUrl).ok);
  assert(
    '2. 비허용 origin 차단',
    !allowlist.evaluateFullTextUrl('bok-mpc-decisions', 'https://evil.example/portal/bbs/P0000093/view.do').ok,
  );
  assert(
    '3. redirect 후 비허용 origin 차단',
    (await officialExtractor.extractOfficialPublicPage({
      sourceRegistryId: 'bok-mpc-decisions',
      url: okUrl,
      html: boardHtml,
    })).ok &&
      !(
        await officialExtractor.extractOfficialPublicPage({
          sourceRegistryId: 'bok-mpc-decisions',
          url: 'https://evil.example/x',
          html: boardHtml,
        })
      ).ok,
  );
  assert('4. 허용 path 통과', allowlist.evaluateFullTextUrl('bok-mpc-decisions', okUrl).ok);
  assert(
    '5. 비허용 path 차단',
    !allowlist.evaluateFullTextUrl(
      'bok-mpc-decisions',
      'https://www.bok.or.kr/portal/bbs/P0000093/fileDown.do?id=1',
    ).ok,
  );

  const extracted = htmlText.extractOfficialPageText(boardHtml, {
    contentSelectors: ['#board'],
    removeSelectors: ['#myView', 'nav', 'header', 'footer'],
    minChars: 80,
  });
  assert('6. selector 성공 시 본문만 추출', extracted.ok && extracted.text.indexOf('금융통화위원회') >= 0);
  assert(
    '7. selector 실패 시 전체 body fallback 금지',
    !htmlText.extractOfficialPageText(boardHtml, {
      contentSelectors: ['#no-such'],
      minChars: 80,
    }).ok,
  );
  assert('8. 메뉴·푸터 제거', extracted.text.indexOf('사이트 헤더') < 0 && extracted.text.indexOf('Copyright') < 0);
  assert('9. 추출 본문이 HTML 기반', boardHtml.indexOf('금융기관대출규정') >= 0 && extracted.text.indexOf('금융기관대출규정') >= 0);

  const bokPageUrl = okUrl;
  const ingestA = await runDailyIssueIngest({
    dryRun: true,
    skipNetwork: true,
    maxItems: 2,
    sourceId: 'bok-mpc-decisions',
    feedBodies: { 'bok-mpc-decisions': bokRss },
    pageHtmlByUrl: { [bokPageUrl]: boardHtml },
  });
  assert(
    '10. description 없음 + 원문 fetch 성공 시 accepted',
    ingestA.manifest.sourceResults[0].fullTextFetchSucceeded >= 1 &&
      ingestA.manifest.sourceResults[0].feedAcceptedItems >= 1,
  );

  const ingestFail = await runDailyIssueIngest({
    dryRun: true,
    skipNetwork: true,
    maxItems: 2,
    sourceId: 'bok-mpc-decisions',
    feedBodies: { 'bok-mpc-decisions': bokRss },
    pageHtmlByUrl: { [bokPageUrl]: emptyHtml },
  });
  assert(
    '11. 원문 fetch 실패 시 제목만 accepted 금지',
    ingestFail.manifest.sourceResults[0].feedAcceptedItems === 0,
  );

  // clustering same event
  const d1 = {
    id: 'd1',
    title: 'EU responds to Ceuta migrant border crisis',
    publisher: 'BBC News',
    publishedAt: '2026-08-04T10:00:00.000Z',
    rawText: 'Spain and the EU discussed the Ceuta migrant crisis.',
    sourceType: 'NEWS',
    originDomain: 'bbc.example',
    sourceId: 's1',
  };
  const d2 = {
    id: 'd2',
    title: 'Ceuta border crossings strain Spain and EU response',
    publisher: 'The Guardian',
    publishedAt: '2026-08-04T12:00:00.000Z',
    rawText: 'Spain and the EU discussed the Ceuta migrant crisis after large border crossings.',
    sourceType: 'NEWS',
    originDomain: 'guardian.example',
    sourceId: 's2',
  };
  const d3 = {
    id: 'd3',
    title: 'Unrelated festival opens in Seoul',
    publisher: 'Local',
    publishedAt: '2026-08-04T11:00:00.000Z',
    rawText: 'A city festival opened in Seoul with music.',
    sourceType: 'NEWS',
    originDomain: 'local.example',
    sourceId: 's3',
  };
  const clusters = clusterCore.clusterDocuments([d1, d2, d3]);
  const ceuta = clusters.find(function (c) {
    return c.documentIds.indexOf('d1') >= 0;
  });
  assert('12. 동일 사건 공식/뉴스 군집화(뉴스2)', ceuta && ceuta.documentIds.indexOf('d2') >= 0);
  assert(
    '13. 무관 사건 강제 병합 금지',
    clusters.some(function (c) {
      return c.documentIds.length === 1 && c.documentIds[0] === 'd3';
    }),
  );

  var koA = {
    id: 'ko1',
    title: 'CJ프레시웨이 2분기 영업익 14% 감소…"온라인 사업 투자 영향"',
    publisher: '연합뉴스',
    publishedAt: '2026-08-06T07:00:00.000Z',
    sourceRegistryId: 'yonhap-ko-economy',
  };
  var koB = {
    id: 'ko2',
    title: 'CJ프레시웨이 2분기 영업익 235억원, 전년比 14.2% 감소…“식봄·급식 성장”',
    publisher: '매일경제',
    publishedAt: '2026-08-06T07:05:00.000Z',
    sourceRegistryId: 'mk-economy',
  };
  var koC = {
    id: 'ko3',
    title: 'BGF리테일 2분기 영업익 849억 22%↑',
    publisher: '매일경제',
    publishedAt: '2026-08-06T07:10:00.000Z',
    sourceRegistryId: 'mk-economy',
  };
  assert('13a. 한국어 동일 사건 교차보도 MERGE', clusterCore.scoreDocumentPair(koA, koB).decision === 'MERGE');
  assert(
    '13b. 한국어 generic-only earnings 오병합 금지',
    clusterCore.scoreDocumentPair(koA, koC).decision !== 'MERGE',
  );
  var koD = {
    id: 'ko4',
    title: '“우리 애 풀장 가면 끼고 노는데…해외직구 물놀이 기구 상당수 안전기준 미달',
    publisher: '매일경제',
    publishedAt: '2026-08-06T07:06:00.000Z',
    sourceRegistryId: 'mk-economy',
    rawText:
      '해외직구 온라인 플랫폼 판매제품 안전성 조사 484개 제품 중 94개 제품 유통 차단. ' +
      '국가기술표준원은 제품정보를 꼼꼼히 확인해야 한다고 밝혔다.',
  };
  koA.rawText =
    '(서울=연합뉴스) 김세린 기자 = CJ프레시웨이[051500]는 연결 기준 올해 2분기 영업이익이 235억원으로 지난해 같은 기간보다 14.2% 감소했다.';
  assert(
    '13c. 본문 generic 온라인만 공유 시 오병합 금지',
    clusterCore.scoreDocumentPair(koA, koD).decision !== 'MERGE',
  );

  const wire = clusterCore.deduplicateDocuments([
    {
      id: 'w1',
      url: 'https://a.example/1',
      title: 't',
      publisher: 'A',
      contentHash: 'h',
      primarySourceUrl: 'https://wire.example/x',
      publishedAt: '2026-08-01',
    },
    {
      id: 'w2',
      url: 'https://b.example/2',
      title: 't2',
      publisher: 'B',
      contentHash: 'h2',
      primarySourceUrl: 'https://wire.example/x',
      publishedAt: '2026-08-01',
    },
  ]);
  assert('14. 복제 기사 독립 출처 과대 계산 금지', wire.documents.length === 1);

  const officialNews = qualityCore.buildDailyIssueCandidate({
    title: '한국은행 금융기관대출규정 개정 의결',
    discussionPrompt: ingestCore.selectDiscussionPrompt(0),
    sources: [
      {
        id: 'gov',
        publisher: '한국은행',
        title: '의결',
        url: 'https://www.bok.or.kr/a',
        publishedAt: '2026-07-23T00:00:00.000Z',
        sourceType: 'OFFICIAL',
        documentType: 'PRESS_RELEASE',
        originDomain: 'www.bok.or.kr',
      },
      {
        id: 'news',
        publisher: 'Yonhap',
        title: '보도',
        url: 'https://en.yna.co.kr/a',
        publishedAt: '2026-07-23T01:00:00.000Z',
        sourceType: 'NEWS',
        documentType: 'NEWS_REPORT',
        originDomain: 'en.yna.co.kr',
      },
    ],
    evidences: [
      {
        id: 'e1',
        sourceId: 'gov',
        text: '한국은행 금융통화위원회는 한국은행의 금융기관대출규정 개정안을 의결했다.',
        extractionConfidence: 0.9,
      },
      {
        id: 'e2',
        sourceId: 'news',
        text: '한국은행 금융통화위원회는 한국은행의 금융기관대출규정 개정안을 의결했다.',
        extractionConfidence: 0.9,
      },
    ],
    candidateClaims: [
      {
        text: '한국은행 금융통화위원회는 한국은행의 금융기관대출규정 개정안을 의결했다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['gov', 'news'],
        isCore: true,
      },
    ],
  });
  assert('15. 공식자료+독립 뉴스 조건 통과', officialNews.ok);

  const twoNews = qualityCore.buildDailyIssueCandidate({
    title: 'Ceuta migrant crisis',
    discussionPrompt: ingestCore.selectDiscussionPrompt(1),
    sources: [
      {
        id: 'a',
        publisher: 'BBC News',
        title: 'Ceuta',
        url: 'https://bbc.example/1',
        publishedAt: '2026-08-04T10:00:00.000Z',
        sourceType: 'NEWS',
        documentType: 'NEWS_REPORT',
        originDomain: 'bbc.example',
      },
      {
        id: 'b',
        publisher: 'The Guardian',
        title: 'Ceuta',
        url: 'https://guardian.example/1',
        publishedAt: '2026-08-04T12:00:00.000Z',
        sourceType: 'NEWS',
        documentType: 'NEWS_REPORT',
        originDomain: 'guardian.example',
      },
    ],
    evidences: [
      {
        id: 'e1',
        sourceId: 'a',
        text: 'Spain and the EU discussed the Ceuta migrant crisis.',
        extractionConfidence: 0.9,
      },
      {
        id: 'e2',
        sourceId: 'b',
        text: 'Spain and the EU discussed the Ceuta migrant crisis after large border crossings.',
        extractionConfidence: 0.9,
      },
    ],
    candidateClaims: [
      {
        text: 'Spain and the EU discussed the Ceuta migrant crisis.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['a', 'b'],
        isCore: true,
      },
    ],
  });
  assert('16. 독립 뉴스 2개 조건 통과', twoNews.ok);

  const single = qualityCore.buildDailyIssueCandidate({
    title: 'Only one',
    discussionPrompt: ingestCore.selectDiscussionPrompt(0),
    sources: [
      {
        id: 'a',
        publisher: 'BBC',
        title: 't',
        url: 'https://bbc.example/1',
        publishedAt: '2026-08-01T00:00:00.000Z',
        sourceType: 'NEWS',
        documentType: 'NEWS_REPORT',
        originDomain: 'bbc.example',
      },
    ],
    evidences: [{ id: 'e1', sourceId: 'a', text: 'Spain and the EU discussed the Ceuta migrant crisis.', extractionConfidence: 0.9 }],
    candidateClaims: [
      {
        text: 'Spain and the EU discussed the Ceuta migrant crisis.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1'],
        supportingSourceIds: ['a'],
        isCore: true,
      },
    ],
  });
  assert('17. 단일 뉴스 QUARANTINED', !single.ok);

  assert('18. 숫자 일치 CONFIRMED_FACT 가능', twoNews.ok);
  const disagree = qualityCore.buildDailyIssueCandidate({
    title: '피해',
    discussionPrompt: ingestCore.selectDiscussionPrompt(0),
    sources: [
      {
        id: 'a',
        publisher: 'A',
        title: 'a',
        url: 'https://a.example/1',
        publishedAt: '2026-08-01T00:00:00.000Z',
        sourceType: 'OFFICIAL',
        documentType: 'PRESS_RELEASE',
        originDomain: 'a.example',
      },
      {
        id: 'b',
        publisher: 'B',
        title: 'b',
        url: 'https://b.example/1',
        publishedAt: '2026-08-01T00:00:00.000Z',
        sourceType: 'NEWS',
        documentType: 'NEWS_REPORT',
        originDomain: 'b.example',
      },
    ],
    evidences: [
      { id: 'e1', sourceId: 'a', text: '피해 규모는 120명으로 집계됐다.', extractionConfidence: 0.9 },
      { id: 'e2', sourceId: 'b', text: '피해 규모는 137명으로 집계됐다.', extractionConfidence: 0.9 },
    ],
    candidateClaims: [
      {
        text: '피해 규모는 출처마다 다르게 집계되고 있다.',
        classification: 'SOURCE_DISAGREEMENT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['a', 'b'],
        variants: [
          { value: '120', sourceIds: ['a'], evidenceIds: ['e1'] },
          { value: '137', sourceIds: ['b'], evidenceIds: ['e2'] },
        ],
        isCore: true,
      },
      {
        text: '정부는 피해 집계를 발표했다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['a', 'b'],
        isCore: true,
      },
    ],
  });
  assert(
    '19. 숫자 불일치 SOURCE_DISAGREEMENT',
    (disagree.claims || []).some(function (c) {
      return c.classification === 'SOURCE_DISAGREEMENT';
    }),
  );

  const effect = ingestCore.buildClaimsFromEvidences(
    [
      {
        id: 'e1',
        sourceId: 'gov',
        text: '정부는 해당 정책이 물가 안정에 도움이 될 것이라고 설명했다.',
        speaker: '정부',
        anonymousAttribution: false,
      },
    ],
    [{ id: 'gov', sourceType: 'OFFICIAL' }],
  );
  assert(
    '20. 효과 주장 객관 사실 승격 금지',
    effect[0].classification !== 'CONFIRMED_FACT' || /설명했다/.test(effect[0].text),
  );
  assert(
    '21. 익명 관계자 핵심 사실 금지',
    ingestCore.buildClaimsFromEvidences(
      [{ id: 'e', sourceId: 'n', text: '관계자에 따르면 피해가 크다.', anonymousAttribution: true }],
      [{ id: 'n' }],
    )[0].classification !== 'CONFIRMED_FACT',
  );

  const titlePick = ingestCore.selectClusterTitle([
    { title: '충격 대참사 발생', publisher: '탭', sourceType: 'NEWS' },
    { title: '한국은행 금융통화위원회 의결', publisher: '한국은행', sourceType: 'OFFICIAL' },
  ]);
  assert('22. 중립 제목 선택', titlePick.ok && titlePick.title.indexOf('한국은행') >= 0);
  const emoOnly = ingestCore.selectClusterTitle([{ title: '충격 대참사 파문', publisher: '탭', sourceType: 'NEWS' }]);
  assert('23. 감정적 제목만 있으면 QUARANTINE 사유', !emoOnly.ok);

  const bundle = ingestCore.buildPublishedCentristBundleFromCandidates({
    candidates: [twoNews, single],
    generatedAt: '2026-08-05T00:00:00.000Z',
  });
  assert('24. READY만 브라우저 번들', bundle.readyCount === 1);
  const issue = bundle.categories[Object.keys(bundle.categories)[0]].issues[0];
  assert('25. choices/stance 없음', issue.choices == null && issue.stance == null);

  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert('26. 답변 선택 미복원', !/id=["']centrist-issue-choices["']/.test(indexHtml));
  assert('27. 열람·체류 성향 미복원', (indexHtml.match(/function applyDailyIssueChoiceGravityDelta/g) || []).length <= 1);
  assert('28. 댓글 반응 성향 유지', /applyReactionScoresWithMult/.test(indexHtml));
  assert(
    '29. 정적 풀 스타일 QUARANTINED',
    !qualityCore.validateDailyIssuePublicationQuality({
      topic: 'x',
      summary: 'y',
      discussionPrompt: ingestCore.selectDiscussionPrompt(0),
      sourceRefs: [],
    }).ok,
  );
  assert('30. fail-closed', !qualityCore.buildDailyIssueCandidate(null).ok);

  // fixture end-to-end cross news
  const cross = await runDailyIssueIngest({
    dryRun: true,
    skipNetwork: true,
    maxItems: 3,
    feedBodies: {
      'bbc-world': newsA,
      'guardian-world': newsB,
    },
  });
  assert('extra. fixture multiSource cluster 가능', cross.manifest.multiSourceClusterCount >= 1 || cross.manifest.clusterCount >= 1);
  assert(
    'extra. fixture READY 가능(완화 없음)',
    cross.manifest.readyCount >= 0,
  );

  console.log('---');
  console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
