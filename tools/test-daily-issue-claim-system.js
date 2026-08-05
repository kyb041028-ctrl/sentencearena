#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 — 출처·claim 분류·품질 게이트 실제 실행 테스트
 * node tools/test-daily-issue-claim-system.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sourceCore = require('../shared/daily-issue-source-core');
const claimCore = require('../shared/daily-issue-claim-core');
const qualityCore = require('../shared/daily-issue-quality-core');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    failures.push({ name, detail: detail || '' });
    console.error('FAIL', name, detail || '');
    return;
  }
  passed += 1;
  console.log('PASS', name);
}

function src(id, overrides) {
  return Object.assign(
    {
      id: id,
      publisher: 'Publisher ' + id,
      title: 'Title ' + id,
      url: 'https://' + id + '.example.org/article',
      publishedAt: '2026-08-01T00:00:00.000Z',
      sourceType: 'NEWS',
      originDomain: id + '.example.org',
      documentType: 'NEWS_REPORT',
      primarySourceUrl: '',
    },
    overrides || {},
  );
}

function ev(id, sourceId, text, overrides) {
  return Object.assign(
    {
      id: id,
      sourceId: sourceId,
      text: text,
      evidenceType: 'DOCUMENT_TEXT',
      extractionConfidence: 0.9,
    },
    overrides || {},
  );
}

function basePassPair() {
  const sources = [
    src('gov', {
      publisher: '기획재정부',
      title: '개정안 발표',
      url: 'https://www.moef.go.kr/release/1',
      originDomain: 'www.moef.go.kr',
      sourceType: 'OFFICIAL',
      documentType: 'PRESS_RELEASE',
    }),
    src('yna', {
      publisher: '연합뉴스',
      title: '정부가 개정안을 발표',
      url: 'https://www.yna.co.kr/view/1',
      originDomain: 'www.yna.co.kr',
      sourceType: 'NEWS',
    }),
  ];
  const evidences = [
    ev('e1', 'gov', '정부는 8월 5일 해당 개정안을 발표했다.'),
    ev('e2', 'yna', '정부는 8월 5일 해당 개정안을 발표했다.'),
  ];
  const claims = [
    {
      id: 'c1',
      text: '정부는 8월 5일 해당 개정안을 발표했다.',
      classification: 'CONFIRMED_FACT',
      evidenceIds: ['e1', 'e2'],
      supportingSourceIds: ['gov', 'yna'],
      isCore: true,
    },
  ];
  return { sources, evidences, claims };
}

function main() {
  console.log('=== daily issue claim / quality pipeline tests ===');

  // 1 official + independent news
  {
    const b = basePassPair();
    const out = qualityCore.buildDailyIssueCandidate({
      title: '개정안 발표',
      discussionPrompt: '이 정책에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert('1. 공식+독립뉴스 CONFIRMED_FACT READY', out.ok && out.publicationStatus === 'READY', out.qualityFailureReasons.join(','));
  }

  // 2 two independent news
  {
    const sources = [
      src('a', { originDomain: 'news-a.com', sourceType: 'NEWS' }),
      src('b', { originDomain: 'news-b.com', sourceType: 'NEWS' }),
    ];
    const evidences = [
      ev('e1', 'a', '회사는 2분기 매출을 3조 원으로 공시했다.'),
      ev('e2', 'b', '회사는 2분기 매출을 3조 원으로 공시했다.'),
    ];
    const claims = [
      {
        text: '회사는 2분기 매출을 3조 원으로 공시했다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['a', 'b'],
        isCore: true,
      },
    ];
    const out = qualityCore.buildDailyIssueCandidate({
      title: '매출 공시',
      discussionPrompt: '현재 공개된 정보만으로 판단하기 어려운 부분은 무엇인가요?',
      sources,
      evidences,
      candidateClaims: claims,
    });
    assert('2. 독립 뉴스 2개 CONFIRMED_FACT', out.ok, out.qualityFailureReasons.join(','));
  }

  // 3 same domain not independent
  {
    const sources = [
      src('a1', { originDomain: 'same.com', url: 'https://same.com/1', sourceType: 'NEWS' }),
      src('a2', { originDomain: 'same.com', url: 'https://same.com/2', sourceType: 'NEWS' }),
    ];
    assert('3. 동일 도메인 독립출처 1', sourceCore.countIndependentSources(sources) === 1);
  }

  // 4 same primarySourceUrl
  {
    const sources = [
      src('a', { primarySourceUrl: 'https://wire.example/x', originDomain: 'a.com' }),
      src('b', { primarySourceUrl: 'https://wire.example/x', originDomain: 'b.com' }),
    ];
    assert('4. 동일 primarySourceUrl 하나로 계산', sourceCore.countIndependentSources(sources) === 1);
  }

  // 5 single news cannot confirm
  {
    const sources = [src('a', { sourceType: 'NEWS' })];
    const evidences = [ev('e1', 'a', '정부가 정책을 발표했다.')];
    const claims = [
      {
        text: '정부가 정책을 발표했다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1'],
        supportingSourceIds: ['a'],
        isCore: true,
      },
    ];
    const out = qualityCore.buildDailyIssueCandidate({
      title: '단일 뉴스',
      discussionPrompt: '이 결정으로 기대되는 효과와 우려되는 점은 무엇인가요?',
      sources,
      evidences,
      candidateClaims: claims,
    });
    assert('5. 단일 뉴스 핵심 사실 게시 불가', !out.ok);
  }

  // 6 SOCIAL only
  {
    const sources = [
      src('s1', { sourceType: 'SOCIAL', documentType: 'SOCIAL_POST', originDomain: 'x.com' }),
      src('s2', { sourceType: 'SOCIAL', documentType: 'SOCIAL_POST', originDomain: 'y.com' }),
    ];
    const evidences = [ev('e1', 's1', '정부가 정책을 발표했다.'), ev('e2', 's2', '정부가 정책을 발표했다.')];
    const claims = [
      {
        text: '정부가 정책을 발표했다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['s1', 's2'],
        isCore: true,
      },
    ];
    const out = qualityCore.buildDailyIssueCandidate({
      title: 'SNS',
      discussionPrompt: '현재 공개된 정보만으로 판단하기 어려운 부분은 무엇인가요?',
      sources,
      evidences,
      candidateClaims: claims,
    });
    assert('6. SOCIAL만으로 CONFIRMED_FACT 불가', !out.ok);
  }

  // 7 OPINION only
  {
    const sources = [
      src('o1', { sourceType: 'OPINION', documentType: 'COLUMN', originDomain: 'op1.com' }),
      src('o2', { sourceType: 'OPINION', documentType: 'EDITORIAL', originDomain: 'op2.com' }),
    ];
    const evidences = [ev('e1', 'o1', '정책은 실패했다.'), ev('e2', 'o2', '정책은 실패했다.')];
    const claims = [
      {
        text: '정책은 실패했다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['o1', 'o2'],
        isCore: true,
      },
    ];
    const out = qualityCore.buildDailyIssueCandidate({
      title: '사설',
      discussionPrompt: '이 정책에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
      sources,
      evidences,
      candidateClaims: claims,
    });
    assert('7. OPINION만으로 CONFIRMED_FACT 불가', !out.ok);
  }

  // 8 government statement attributed
  {
    const claims = claimCore.processCandidateClaims(
      [
        {
          text: '정부는 해당 정책이 물가 안정에 도움이 될 것이라고 설명했다.',
          speaker: '정부',
          evidenceIds: ['e1'],
          supportingSourceIds: ['gov'],
        },
      ],
      [src('gov', { sourceType: 'OFFICIAL' })],
      [ev('e1', 'gov', '정부는 해당 정책이 물가 안정에 도움이 될 것이라고 설명했다.', { speaker: '정부' })],
    );
    assert('8. 정부 발언 ATTRIBUTED_CLAIM', claims[0].classification === 'ATTRIBUTED_CLAIM');
  }

  // 9 opposition attributed
  {
    const claims = claimCore.processCandidateClaims(
      [
        {
          text: '야당은 예산 산정 근거가 부족하다고 비판했다.',
          speaker: '야당',
          evidenceIds: ['e1'],
          supportingSourceIds: ['n1'],
        },
      ],
      [src('n1')],
      [ev('e1', 'n1', '야당은 예산 산정 근거가 부족하다고 비판했다.', { speaker: '야당' })],
    );
    assert('9. 야당 발언 ATTRIBUTED_CLAIM', claims[0].classification === 'ATTRIBUTED_CLAIM');
  }

  // 10 anonymous
  {
    const claims = claimCore.processCandidateClaims(
      [{ text: '관계자에 따르면 피해가 크다.', evidenceIds: ['e1'], supportingSourceIds: ['n1'] }],
      [src('n1')],
      [ev('e1', 'n1', '관계자에 따르면 피해가 크다.')],
    );
    assert(
      '10. 익명 관계자 UNVERIFIED/REJECTED',
      claims[0].classification === 'UNVERIFIED' || claims[0].classification === 'REJECTED',
    );
  }

  // 11 disagreement
  {
    const claims = claimCore.processCandidateClaims(
      [
        {
          text: '피해 규모는 출처마다 다르게 집계되고 있다.',
          classification: 'SOURCE_DISAGREEMENT',
          evidenceIds: ['e1', 'e2'],
          supportingSourceIds: ['a', 'b'],
          variants: [
            { value: 120, unit: '명', label: 'A 기관', sourceIds: ['a'] },
            { value: 137, unit: '명', label: 'B 기관', sourceIds: ['b'] },
          ],
        },
      ],
      [src('a'), src('b')],
      [ev('e1', 'a', '피해 120명'), ev('e2', 'b', '피해 137명')],
    );
    assert('11. 숫자 불일치 SOURCE_DISAGREEMENT', claims[0].classification === 'SOURCE_DISAGREEMENT');
  }

  // 12 disagreement hidden
  {
    const out = qualityCore.buildDailyIssueCandidate({
      title: '피해',
      discussionPrompt: '현재 공개된 정보만으로 판단하기 어려운 부분은 무엇인가요?',
      sources: basePassPair().sources,
      evidences: basePassPair().evidences,
      candidateClaims: [
        {
          text: '피해는 120명이다.',
          classification: 'SOURCE_DISAGREEMENT',
          evidenceIds: ['e1'],
          supportingSourceIds: ['gov'],
          variants: [{ value: 120 }],
          isCore: true,
        },
        basePassPair().claims[0],
      ],
    });
    assert(
      '12. 불일치 숨김 QUARANTINED',
      !out.ok && out.qualityFailureReasons.indexOf('SOURCE_DISAGREEMENT_HIDDEN') >= 0,
    );
  }

  // 13 number not in evidence
  {
    const b = basePassPair();
    b.claims[0].text = '정부는 8월 5일 해당 개정안을 발표했고 예산은 900조 원';
    const out = qualityCore.buildDailyIssueCandidate({
      title: '개정안',
      discussionPrompt: '이 정책에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert('13. 원문 없는 숫자 REJECT/QUARANTINE', !out.ok);
  }

  // 14 date not in evidence
  {
    const b = basePassPair();
    b.claims[0].text = '정부는 1999년 1월 1일 해당 개정안을 발표했다.';
    const out = qualityCore.buildDailyIssueCandidate({
      title: '개정안',
      discussionPrompt: '이 정책에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert('14. 원문 없는 날짜 차단', !out.ok);
  }

  // 15 overstatement
  {
    const sources = [src('a'), src('b')];
    const evidences = [
      ev('e1', 'a', '성장률이 1.8%가 될 가능성이 있다.'),
      ev('e2', 'b', '성장률이 1.8%가 될 가능성이 있다.'),
    ];
    const claims = [
      {
        text: '성장률 1.8%가 확정됐다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['a', 'b'],
        isCore: true,
      },
    ];
    const processed = claimCore.processCandidateClaims(claims, sources, evidences);
    assert(
      '15. 가능성→확정 CLAIM_OVERSTATEMENT',
      processed[0].failureReasons.indexOf('CLAIM_OVERSTATEMENT') >= 0 ||
        processed[0].classification === 'REJECTED',
    );
  }

  // 16 claim as fact from assertion
  {
    const sources = [src('a'), src('b')];
    const evidences = [
      ev('e1', 'a', '회사 측은 피해가 제한적이라고 주장했다.'),
      ev('e2', 'b', '회사 측은 피해가 제한적이라고 주장했다.'),
    ];
    const claims = [
      {
        text: '피해는 제한적이다.',
        classification: 'CONFIRMED_FACT',
        evidenceIds: ['e1', 'e2'],
        supportingSourceIds: ['a', 'b'],
        isCore: true,
      },
    ];
    const processed = claimCore.processCandidateClaims(claims, sources, evidences);
    assert('16. 주장→사실화 REJECTED', processed[0].classification === 'REJECTED');
  }

  // 17 analysis as fact blocked
  {
    const sources = [
      src('c1', { sourceType: 'OPINION', documentType: 'COLUMN', originDomain: 'col.com' }),
      src('c2', { sourceType: 'OPINION', documentType: 'COLUMN', originDomain: 'col2.com' }),
    ];
    const evidences = [ev('e1', 'c1', '경제가 악화될 것이다.'), ev('e2', 'c2', '경제가 악화될 것이다.')];
    const out = qualityCore.buildDailyIssueCandidate({
      title: '분석',
      discussionPrompt: '이 결정으로 기대되는 효과와 우려되는 점은 무엇인가요?',
      sources,
      evidences,
      candidateClaims: [
        {
          text: '경제가 악화될 것이다.',
          classification: 'CONFIRMED_FACT',
          evidenceIds: ['e1', 'e2'],
          supportingSourceIds: ['c1', 'c2'],
          isCore: true,
        },
      ],
    });
    assert('17. 분석 기사 CONFIRMED_FACT 차단', !out.ok);
  }

  // 18 pre-judgment crime
  {
    const sources = [src('a'), src('b')];
    const evidences = [ev('e1', 'a', '경찰이 수사 중이다.'), ev('e2', 'b', '경찰이 수사 중이다.')];
    const processed = claimCore.processCandidateClaims(
      [
        {
          text: '그는 유죄이며 고의로 속였다.',
          classification: 'CONFIRMED_FACT',
          evidenceIds: ['e1', 'e2'],
          supportingSourceIds: ['a', 'b'],
        },
      ],
      sources,
      evidences,
    );
    assert('18. 판결 전 범죄 확정 표현 차단', processed[0].classification === 'REJECTED');
  }

  // 19 unsupported causality
  {
    const sources = [src('a'), src('b')];
    const evidences = [ev('e1', 'a', '정책이 발표됐다.'), ev('e2', 'b', '정책이 발표됐다.')];
    const processed = claimCore.processCandidateClaims(
      [
        {
          text: '이 정책 때문에 경제가 악화됐다.',
          classification: 'CONFIRMED_FACT',
          evidenceIds: ['e1', 'e2'],
          supportingSourceIds: ['a', 'b'],
        },
      ],
      sources,
      evidences,
    );
    assert(
      '19. 출처 없는 인과관계 차단',
      processed[0].failureReasons.indexOf('UNSUPPORTED_CAUSALITY') >= 0 ||
        processed[0].classification === 'REJECTED',
    );
  }

  // 20 no evidence
  {
    const b = basePassPair();
    b.claims[0].evidenceIds = [];
    const out = qualityCore.buildDailyIssueCandidate({
      title: '개정안',
      discussionPrompt: '이 정책에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert('20. evidence 없는 CONFIRMED_FACT 차단', !out.ok);
  }

  // 21 evidence source missing
  {
    const b = basePassPair();
    b.evidences[0].sourceId = 'missing';
    const out = qualityCore.buildDailyIssueCandidate({
      title: '개정안',
      discussionPrompt: '이 정책에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert('21. evidence sourceId 불일치 차단', !out.ok);
  }

  // 22 core unverified
  {
    const out = qualityCore.buildDailyIssueCandidate({
      title: '미확인',
      discussionPrompt: '현재 공개된 정보만으로 판단하기 어려운 부분은 무엇인가요?',
      sources: basePassPair().sources,
      evidences: basePassPair().evidences,
      candidateClaims: [
        {
          text: '관계자에 따르면 피해가 있다.',
          classification: 'UNVERIFIED',
          evidenceIds: ['e1'],
          supportingSourceIds: ['gov'],
          isCore: true,
        },
      ],
    });
    assert(
      '22. 핵심 UNVERIFIED면 QUARANTINED',
      !out.ok && out.qualityFailureReasons.indexOf('CORE_CLAIM_UNVERIFIED') >= 0,
    );
  }

  // 23 peripheral unverified allowed in display groups when READY otherwise
  {
    const b = basePassPair();
    b.claims.push({
      text: '추가 피해 규모는 아직 확인되지 않았다.',
      classification: 'UNVERIFIED',
      evidenceIds: ['e1'],
      supportingSourceIds: ['gov'],
      isCore: false,
    });
    const out = qualityCore.buildDailyIssueCandidate({
      title: '개정안',
      discussionPrompt: '현재 공개된 정보만으로 판단하기 어려운 부분은 무엇인가요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert(
      '23. 부수 UNVERIFIED는 구획 표시 가능',
      out.ok && out.displayGroups.UNVERIFIED.length === 1,
      out.qualityFailureReasons.join(','),
    );
  }

  // 24 REJECTED excluded from display
  {
    const groups = claimCore.groupClaimsForDisplay([
      { text: 'ok', classification: 'CONFIRMED_FACT' },
      { text: 'bad', classification: 'REJECTED' },
    ]);
    assert('24. REJECTED 화면 제외', groups.CONFIRMED_FACT.length === 1 && !groups.REJECTED);
  }

  // 25 leading prompt
  {
    const b = basePassPair();
    const out = qualityCore.buildDailyIssueCandidate({
      title: '개정안',
      discussionPrompt: '정부의 잘못된 정책에 반대해야 하지 않을까요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert(
      '25. 유도 질문 QUARANTINED',
      !out.ok && out.qualityFailureReasons.indexOf('DISCUSSION_PROMPT_LEADING') >= 0,
    );
  }

  // 26 fail-closed on throw
  {
    const bad = {};
    Object.defineProperty(bad, 'sources', {
      get() {
        throw new Error('boom');
      },
    });
    const out = qualityCore.buildDailyIssueCandidate(bad);
    assert(
      '26. 검증 오류 fail-closed',
      out.publicationStatus === 'QUARANTINED' && out.qualityFailureReasons[0] === 'QUALITY_GATE_ERROR',
    );
  }

  // 27/28 READY only
  {
    const b = basePassPair();
    const good = qualityCore.buildDailyIssueCandidate({
      title: '개정안',
      discussionPrompt: '이 정책에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
      sources: b.sources,
      evidences: b.evidences,
      candidateClaims: b.claims,
    });
    assert('27. 통과 데이터만 READY', good.publicationStatus === 'READY');
    assert('28. READY만 PUBLISHED 후보(ok=true)', good.ok === true);
  }

  // 29 static pool all quarantined via legacy validate
  {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const start = html.indexOf('var CENTRIST_THEME_POOLS = ');
    let i = html.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let p = i; p < html.length; p++) {
      if (html[p] === '{') depth++;
      else if (html[p] === '}') {
        depth--;
        if (depth === 0) {
          end = p + 1;
          break;
        }
      }
    }
    // eslint-disable-next-line no-eval
    const pools = eval('(' + html.slice(i, end) + ')');
    let total = 0;
    let ready = 0;
    Object.keys(pools).forEach((cat) => {
      (pools[cat] || []).forEach((pick) => {
        total += 1;
        const q = qualityCore.validateDailyIssuePublicationQuality({
          topic: pick.topic,
          summary: pick.summary,
          discussionPrompt: pick.question,
          sourceRefs: pick.sourceRefs || [],
        });
        if (q.ok) ready += 1;
      });
    });
    assert('29. 정적 풀 58개 전부 QUARANTINED', total >= 50 && ready === 0, 'total=' + total + ' ready=' + ready);
  }

  // 30–33 policy guards in index.html
  {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert('30. 답변 선택 UI 미복원', !/className\s*=\s*'board__issue-choices'/.test(html));
    assert('31. 열람 성향 미복원', !/CONTENT_LEAN_MULT_CLICK\)/.test(html));
    assert('32. 댓글 반응 applyReactionScoresWithMult 유지', /applyDailyIssueCommentReactionAlignmentOps/.test(html));
    assert(
      '33. empathy 성향 미반영',
      !/function onDailyIssueToggleEmpathy[\s\S]{0,900}applyReactionScoresWithMult/.test(html),
    );
  }

  console.log('---');
  console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
  if (failures.length) {
    failures.forEach((f) => console.error(' -', f.name, f.detail));
    process.exit(1);
  }
  process.exit(0);
}

main();
