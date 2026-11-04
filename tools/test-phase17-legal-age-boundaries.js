#!/usr/bin/env node
'use strict';

/**
 * Phase 17 — 고정 시각·생일 경계·미국 18세 (서울 기준일). 신원 검증 아님.
 */

const core = require('../shared/legal-gate-core');

let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

function seoulNoonUtc(y, m, d) {
  return Date.UTC(y, m - 1, d, 3, 0, 0);
}

function dob(y, m, d) {
  return { year: y, month: m, day: d };
}

function main() {
  const usDob = dob(2008, 11, 5);
  const dayBefore = seoulNoonUtc(2026, 11, 4);
  const birthday = seoulNoonUtc(2026, 11, 5);
  const dayAfter = seoulNoonUtc(2026, 11, 6);

  const u17 = core.evaluateAgeForRegion(usDob, 'US', dayBefore);
  check('생일 전날 미국 17세는 거절', u17.ok === false && u17.error === 'AGE_UNDER_18' && u17.age === 17);

  const u18 = core.evaluateAgeForRegion(usDob, 'US', birthday);
  check('18세 생일 당일 미국 허용', u18.ok === true && u18.age === 18 && u18.policyVersion === core.US_AGE_POLICY_VERSION);

  const u18next = core.evaluateAgeForRegion(usDob, 'US', dayAfter);
  check('생일 다음날도 미국 허용', u18next.ok === true && u18next.age === 18);

  const leapOk = core.evaluateAgeForRegion(dob(2004, 2, 29), 'US', seoulNoonUtc(2026, 3, 1));
  check('2월 29일 유효 생년', leapOk.ok === true);

  const leapBad = core.parseDob({ year: 2003, month: 2, day: 29 });
  check('2월 29일 불가 연도는 거절', leapBad.ok === false && leapBad.error === 'AGE_INVALID_DATE');

  const missing = core.evaluateAgeForRegion({}, 'US', birthday);
  check('생년월일 누락 거절', missing.ok === false && missing.error === 'AGE_INVALID_DATE');

  const badDate = core.evaluateAgeForRegion({ birthDate: '2008-13-40' }, 'US', birthday);
  check('비정상 날짜 거절', badDate.ok === false && badDate.error === 'AGE_INVALID_DATE');

  const spoof = core.parseAgeConfirmBody({ userId: '00000000-0000-4000-8000-000000000001', year: 2000, month: 1, day: 1 });
  check('본문 userId 위조 거절', spoof.ok === false && spoof.error === 'LEGAL_USER_ID_NOT_ALLOWED');

  const kr13 = core.evaluateAgeForRegion(dob(2013, 11, 5), 'KR', birthday);
  const kr14 = core.evaluateAgeForRegion(dob(2012, 11, 4), 'KR', birthday);
  check('한국 13세 거절 유지', kr13.ok === false && kr13.error === 'AGE_UNDER_14');
  check('한국 14세 경계 허용 유지', kr14.ok === true && kr14.policyVersion === core.AGE_POLICY_VERSION);

  if (failed) {
    console.log('PHASE17_AGE_BOUNDARIES_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('PHASE17_AGE_BOUNDARIES_OK');
}

main();
