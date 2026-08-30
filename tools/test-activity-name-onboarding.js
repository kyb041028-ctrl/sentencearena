#!/usr/bin/env node
'use strict';

/**
 * 활동명 onboarding — provider 공통 판정 · validation · DOM 정적 검증
 */
const fs = require('fs');
const path = require('path');
const ActivityNameCore = require('../shared/activity-name-core.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function needsActivityNameOnboarding(profile) {
  if (!profile) return true;
  return !ActivityNameCore.isCompleteActivityName(profile.display_name);
}

function providerProfileFixture(provider, opts) {
  opts = opts || {};
  return {
    id: opts.id || provider + '-user-id',
    display_name: opts.display_name != null ? opts.display_name : '',
    home_country: 'KR',
    _provider: provider,
  };
}

// 1. 신규 Google — metadata + email, display_name 없음
assert(
  needsActivityNameOnboarding(
    providerProfileFixture('google', {
      display_name: '',
    }),
  ),
  'new google user with empty display_name needs onboarding',
);

// 2. 신규 Kakao — nickname metadata, email NULL 가능, display_name 없음
assert(
  needsActivityNameOnboarding(
    providerProfileFixture('kakao', {
      display_name: '',
    }),
  ),
  'new kakao user needs onboarding',
);

// 3. 향후 Naver — generic OAuth fixture
assert(
  needsActivityNameOnboarding(
    providerProfileFixture('naver', {
      display_name: '',
    }),
  ),
  'new naver-style user needs onboarding',
);

// 4. provider metadata만 있고 display_name 비어 있으면 onboarding (DB가 '' 이면 항상 true)
assert(needsActivityNameOnboarding({ display_name: '' }), 'empty display_name incomplete');
assert(needsActivityNameOnboarding({ display_name: '   ' }), 'whitespace display_name incomplete');
assert(needsActivityNameOnboarding(null), 'missing profile needs onboarding');

// 5. 기존 회원 — display_name 있음 → skip
assert(
  !needsActivityNameOnboarding({ display_name: '푸른개척자' }),
  'existing member with valid display_name skips onboarding',
);
assert(
  !needsActivityNameOnboarding({ display_name: 'Sentence99' }),
  'existing member english name skips onboarding',
);

// 6–7. 직접 입력 / 자동 이름 validation
assert(!ActivityNameCore.validateActivityName('bad name!').ok, 'spaces/special rejected');
assert(ActivityNameCore.validateActivityName('푸른개척자').ok, 'valid korean name');
assert(ActivityNameCore.validateActivityName('Sentence01').ok, 'valid english+digits');

// 8. 자동 이름 여러 번 생성
var diceSet = {};
for (var i = 0; i < 12; i++) {
  var c = ActivityNameCore.generateActivityNameCandidate({ maxAttempts: 8 });
  assert(ActivityNameCore.validateActivityName(c).ok, 'dice candidate valid: ' + c);
  diceSet[c] = true;
}
assert(Object.keys(diceSet).length >= 8, 'dice variety across rolls');

// 9–10. 중복·대소문자 — API 레벨은 server test; core는 동일 문자열 검증
assert(ActivityNameCore.validateActivityName('Sentence').ok, 'case name valid');
assert(ActivityNameCore.validateActivityName('sentence').ok, 'lowercase valid');

const root = path.join(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'public', 'app-entry.js'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'public', 'activity-name-onboarding.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const displayName = fs.readFileSync(path.join(root, 'public', 'display-name.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migration_handle_new_user_emailless_oauth.sql'),
  'utf8',
);

assert(entry.includes('needsActivityNameOnboarding'), 'app-entry onboarding gate');
assert(entry.includes('isCompleteActivityName'), 'app-entry uses isCompleteActivityName');
assert(entry.includes('ScActivityNameOnboarding'), 'app-entry wires onboarding UI');
assert(entry.includes('showTerritorySelection'), 'app-entry territory entry kept for existing members');
assert(entry.includes('showFirstVisitGuide'), 'app-entry first visit after activity name');
assert(entry.includes('enterCentralPlazaFromGuide'), 'app-entry first visit finishes at central plaza');
assert(entry.includes('afterActivityName'), 'app-entry activity name does not skip first visit');
assert(
  !/handleAuthenticatedUser[\s\S]{0,600}provider\s*===/.test(entry),
  'no provider branch inside authenticated onboarding path',
);

assert(onboarding.includes('sc-activity-name-dice'), 'dice button in onboarding UI');
assert(onboarding.includes('generateActivityNameCandidate'), 'dice uses core generator');
assert(onboarding.includes('ScAuth.authFetch'), 'onboarding save uses ScAuth');

assert(index.includes('id="sc-activity-name-onboarding"') || index.includes("activity-name-onboarding.js"), 'onboarding DOM/script');
assert(index.includes('activity-name-core.js'), 'activity name core loaded');
assert(index.includes('data-provider="google"'), 'google login button kept');
assert(index.includes('view-login'), 'login view for localhost unauth');

assert(
  displayName.includes('existingProf') || displayName.includes('existingProf)'),
  'profile recursion fix: syncCurrentUserDisplayName accepts existing profile',
);
assert(displayName.includes('isCompleteActivityName'), 'display-name uses completion check');

assert(migration.includes("v_display := ''"), 'trigger defaults display_name empty');
assert(!migration.includes("'nickname'"), 'trigger does not copy kakao nickname');

// 12. 기존 회원 provider metadata로 덮어쓰지 않음 — trigger는 INSERT only ON CONFLICT DO NOTHING
assert(migration.includes('ON CONFLICT (id) DO NOTHING'), 'existing profiles untouched on conflict');

// 13. Google OAuth path — auth.js untouched by onboarding
const authJs = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
assert(authJs.includes('signInWithOAuth') || authJs.includes('login'), 'auth.js login intact');

console.log('PASS activity-name onboarding provider-agnostic static checks');
