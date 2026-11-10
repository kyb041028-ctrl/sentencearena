'use strict';
/**
 * 보궐 안내 문구. 선거 진행은 열지 않는다.
 * node tools/test-by-election-copy.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;
function ok(id, label, cond) {
  if (cond) {
    console.log('PASS: ' + id + ' ' + label);
    passed += 1;
  } else {
    console.log('FAIL: ' + id + ' ' + label);
    failed += 1;
  }
}

const root = path.join(__dirname, '..');
const guide = fs.readFileSync(path.join(root, 'public', 'permissions-guide.js'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'shared', 'election-preview-core.js'), 'utf8');
const filing = fs.readFileSync(path.join(root, 'server', 'leader-filing-service.js'), 'utf8');
const election = fs.readFileSync(path.join(root, 'server', 'leader-election-service.js'), 'utf8');
const shown = guide + '\n' + preview;

ok('1', '보궐 안내에서 추가 검증 2일 제거', shown.indexOf('검증 2일, 재선거') < 0 && shown.indexOf('2일 검증') < 0 && shown.indexOf('2 days of checks') < 0 && shown.indexOf('검증 대기 2일은 없습니다') >= 0 && shown.indexOf('no separate 2-day review wait') >= 0);
ok('2', '공석 7일·접수 3일·48시간', shown.indexOf('해임 시각부터 7일') >= 0 && shown.indexOf('접수는 3일') >= 0 && shown.indexOf('48시간') >= 0 && shown.indexOf('7 days from that removal') >= 0 && shown.indexOf('lasts 3 days') >= 0 && shown.indexOf('48 hours') >= 0);
ok('3', '총 12일', shown.indexOf('12일') >= 0 && shown.indexOf('12 days after removal') >= 0);
ok('4', '0명·1명·복수', shown.indexOf('후보가 없으면 매주 다시 접수') >= 0 && shown.indexOf('투표 없이 자동 당선') >= 0 && shown.indexOf('두 명 이상이면 48시간') >= 0 && shown.indexOf('No candidates means filing opens again each week') >= 0 && shown.indexOf('automatic winner with no vote') >= 0 && shown.indexOf('Two or more') >= 0);
ok('5', '일반 선거 자격 심사 설명 유지', guide.indexOf('후보는 대표 가운데 출마를 희망한 사람만입니다') >= 0 && guide.indexOf('Only a representative who asks to run can be a candidate') >= 0 && preview.indexOf('대표 중 희망자만 후보') >= 0 && preview.indexOf('Only a representative who wants to run is a candidate') >= 0 && filing.indexOf("action === 'start_review'") >= 0 && election.indexOf("action === 'start_review'") >= 0);
ok('6', 'KR/US 정책 일치', guide.indexOf('자동 접수, 단독 임명, 투표 개설은 아직 없습니다') >= 0 && guide.indexOf('not a live election') >= 0 && preview.indexOf('운영 중인 선거가 아닙니다') >= 0 && preview.indexOf('not a live election') >= 0);
ok('7', '레이아웃과 기능 유지', guide.indexOf("if (sub === 'election') return renderElectionPanel(false)") >= 0 && guide.indexOf('선거 · 탄핵') >= 0 && guide.indexOf('Elections and impeachment') >= 0 && guide.indexOf("data-perm-sub") >= 0 && preview.indexOf('rulesElection') >= 0 && preview.indexOf('rulesImpeach') >= 0);

const runs = [
  'tools/test-by-election-schedule.js',
  'tools/test-election-preview.js',
  'tools/test-first-visit-guide.js',
].map(function (file) {
  return spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
});
ok('8', '기존 선거·탄핵 회귀', runs.every(function (row) { return row.status === 0; }));
if (runs.some(function (row) { return row.status !== 0; })) {
  runs.forEach(function (row, index) {
    if (row.status !== 0) console.log(row.stdout.slice(-400) + '\n' + row.stderr.slice(-400));
  });
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
