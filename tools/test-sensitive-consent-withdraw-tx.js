'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(
  path.join(root, 'supabase', 'migration_sensitive_consent_withdraw_tx_v1.sql'),
  'utf8',
);
const service = fs.readFileSync(path.join(root, 'server', 'legal-gate-service.js'), 'utf8');
const catalog = require('../shared/production-public-migration-core');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

const fn = service.slice(
  service.indexOf('async function withdrawSensitiveConsent'),
  service.indexOf('async function filterUserIdsAllowed'),
);
ok('1. 철회는 함수 한 번', /withdraw_sensitive_political_consent/.test(fn) && fn.indexOf('.delete(') === -1);
ok('2. 함수 실패는 성공으로 보지 않음', /LEGAL_GATE_SAVE_FAILED/.test(fn));

const ageFn = service.slice(service.indexOf('async function confirmAge'), service.indexOf('async function markSignupCompletedIfLegalComplete'));
ok('3. 연령 확인이 동의 시각을 다시 쓰지 않음', ageFn.indexOf('sensitive_political_consented_at') === -1);

ok('4. 성향 상태와 두 이력만 삭제', /DELETE FROM public\.user_alignment_state/.test(sql) && /DELETE FROM public\.alignment_history/.test(sql) && /DELETE FROM public\.alignment_territory_history/.test(sql));
ok('5. 프로필 영토를 바꾸지 않음', !/UPDATE\s+public\.profiles/i.test(sql));
ok('6. 반응 표를 바꾸지 않음', !/board_reactions/i.test(sql));
const body = sql.slice(sql.indexOf('AS $fn$'), sql.indexOf('$fn$;'));
ok('7. 외계 표를 바꾸지 않음', !/\balien\b/i.test(body));
ok('8. service_role 실행만 허용', /GRANT EXECUTE ON FUNCTION public\.withdraw_sensitive_political_consent\(uuid\) TO service_role;/.test(sql) && /FROM authenticated/.test(sql));
ok('9. 운영 필수 목록 밖', !catalog.REQUIRED.some(function (entry) {
  return entry.fileName === 'migration_sensitive_consent_withdraw_tx_v1.sql';
}));
ok('10. 적용 완료라고 적지 않음', /NOT APPLIED/.test(sql) && /NOT production-verified/.test(sql));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runTx(state, failAfter) {
  const snap = clone(state);
  try {
    state.locked = true;
    if (failAfter === 'lock') throw new Error('LOCK');
    state.alignment = [];
    if (failAfter === 'delete') throw new Error('DELETE');
    state.consent.sensitive = null;
    state.consent.territoryDisclosure = null;
    state.consent.visibility = 'private';
    if (failAfter === 'consent') throw new Error('CONSENT');
    state.locked = false;
    return true;
  } catch (err) {
    state.alignment = snap.alignment;
    state.consent = snap.consent;
    state.locked = false;
    state.error = err.message;
    return false;
  }
}

const base = {
  alignment: ['state', 'history', 'territory-history'],
  consent: { sensitive: 'yes', territoryDisclosure: 'yes', visibility: 'public', age: 'yes' },
  territory: 'PIONEER',
  alien: 'no',
  reactionCopy: 'score',
};
const rolled = clone(base);
ok('11. 중간 오류는 전부 취소', runTx(rolled, 'delete') === false && rolled.alignment.length === 3 && rolled.consent.sensitive === 'yes');
const committed = clone(base);
ok('12. 성공 시 성향만 지움', runTx(committed, '') === true && committed.alignment.length === 0 && committed.consent.sensitive === null && committed.territory === 'PIONEER' && committed.reactionCopy === 'score' && committed.alien === 'no');

const stale = clone(committed);
stale.consent.sensitive = 'old-request';
ok('13. 옛 동의 저장은 이 함수 밖에 남음', stale.consent.sensitive === 'old-request' && stale.alignment.length === 0);

console.log('OK', passed);
