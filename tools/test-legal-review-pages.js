'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public', 'legal');
const names = [
  'index.html',
  'terms.html',
  'privacy.html',
  'community.html',
  'report-sanction.html',
  'rights.html',
  'withdrawal.html',
  'consent-withdrawal.html',
  'support.html',
];
const guide = fs.readFileSync(path.join(__dirname, '..', 'public', 'permissions-guide.js'), 'utf8');
const prep = fs.readFileSync(path.join(__dirname, '..', 'docs', 'legal', 'PRODUCTION_SQL_PREP_NOT_APPLIED.md'), 'utf8');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

names.forEach(function (name) {
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  ok(name + ' 최종본 아님', text.indexOf('법적 최종본이 아닙니다') >= 0 || text.indexOf('법적 최종본 아님') >= 0);
  ok(name + ' 법률 검토', text.indexOf('법률 검토 필요') >= 0);
  ok(name + ' 완료 삭제 단정 없음', text.indexOf('모든 사본을 삭제했습니다') < 0);
});

const privacy = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
ok('예정 상호', privacy.indexOf('센브릿지') >= 0 && privacy.indexOf('SENBRIDGE') >= 0 && privacy.indexOf('등록된 사업자가 아닙니다') >= 0);
ok('미정 항목', privacy.indexOf('개인정보 보호책임자: 미정') >= 0 && privacy.indexOf('시행일: 미정') >= 0 && privacy.indexOf('사업자등록번호: 미정') >= 0);
ok('서비스 이름', privacy.indexOf('SentenceArena') >= 0);
ok('안내 연결', guide.indexOf('href="/legal/"') >= 0);
ok('SQL 준비 문서는 미적용', prep.indexOf('Production 검증이 아닙니다') >= 0 && prep.indexOf('실행하지 않았습니다') >= 0);
ok('재가입 차단을 추가했다고 쓰지 않음', prep.indexOf('영구정지 재가입 차단은 추가하지 않았습니다') >= 0);

console.log('OK', passed);
