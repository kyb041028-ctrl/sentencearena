#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
    return;
  }
  passed += 1;
  console.log('PASS', name);
}

function has(re) {
  return re.test(INDEX_HTML);
}

function notHas(re) {
  return !re.test(INDEX_HTML);
}

function count(re) {
  const m = INDEX_HTML.match(re);
  return m ? m.length : 0;
}

function main() {
  console.log('=== daily issue system tests ===');

  assert('A1. 선택지 렌더 컨테이너 제거', notHas(/className\s*=\s*'board__issue-choices'/));
  assert('A2. 선택 필수 제목 제거', notHas(/관점 선택 \(필수\)/));
  assert('A3. 선택 후 댓글 안내 제거', notHas(/관점 선택 후 입력할 수 있습니다/));
  assert('A4. submit에서 stance 필수 검사 제거', notHas(/submitCentristIssueComment[\s\S]*getDailyIssueStance/));
  assert('A5. 댓글 저장 시 stance 필드 미기록', notHas(/stanceChoiceId|stanceLabel/));
  assert('A6. 댓글 반응 stance 게이트 제거', notHas(/공감·반응을 쓰려면 이 카드에서 관점을 먼저 선택/));

  assert('B1. 선택 가중 함수 런타임 호출 제거', count(/applyDailyIssueChoiceGravityDelta\(/g) <= 1);
  assert('B2. 클릭 성향 delta 호출 제거', notHas(/CONTENT_LEAN_MULT_CLICK\)/));
  assert('B3. 체류 성향 delta 호출 제거', notHas(/CONTENT_LEAN_MULT_DWELL_20\)|CONTENT_LEAN_MULT_DWELL_60\)/));
  assert('B4. 데일리 반응 성향 delta 호출 제거', notHas(/tryApplyContentGravityDelta\(me,\s*issue\.lean/));
  assert('B5. 데일리 좋아요/싫어요 성향 delta 호출 제거', notHas(/tryApplyContentGravityDelta\(me,\s*oppLean/));

  assert('C1. publicationStatus 필드 사용', has(/publicationStatus/));
  assert('C2. qualityGateVersion 필드 사용', has(/qualityGateVersion/));
  assert('C3. 품질 게이트 함수 존재', has(/function validateDailyIssuePublicationQuality/));
  assert('C4. 독립 출처 계산 함수 존재', has(/function countDailyIssueIndependentSources/));
  assert('C5. 중립 문구 검사 상수 존재', has(/DAILY_ISSUE_BIAS_PHRASES/));
  assert('C6. 검증 실패 QUARANTINED 처리', has(/DAILY_ISSUE_QUALITY_STATUS\.QUARANTINED/));
  assert('C7. 검증 통과 시 PUBLISHED 처리', has(/DAILY_ISSUE_QUALITY_STATUS\.PUBLISHED/));
  assert('C8. 기준 미달 시 준비중 카드 렌더', has(/현재 게시 기준을 충족한 이슈를 준비 중입니다/));

  assert('D1. 기존 stance 키 상수 유지(호환)', has(/sc_daily_issue_stance_v1/));
  assert('D2. choices가 번들 유효성 필수가 아님', notHas(/isValidCentristBundle[\s\S]*isValidIssueChoices\(iss\.choices\)/));
  assert('D3. 자유 토론 안내 문구 존재', has(/이슈 내용을 확인하고 자유롭게 의견을 나눠보세요/));
  assert('D4. 독립 출처 표시 문구 존재', has(/독립 출처/));

  console.log('---');
  console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
  process.exit(failed ? 1 : 0);
}

main();
