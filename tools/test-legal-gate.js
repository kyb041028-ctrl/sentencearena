#!/usr/bin/env node
'use strict';

/**
 * Legal signup gate — age / sensitive consent / visibility / bypass / OAuth-Guest-withdrawal regression.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const core = require('../shared/legal-gate-core');
const { createLegalGateService } = require('../server/legal-gate-service');
const { createLegalGateRouter } = require('../server/legal-gate-routes');
const { createBoardRouter } = require('../server/board-routes');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const publicProfile = require('../shared/public-profile-core');
const { requestApp } = require('./daily-issue-api-http-helper');

const root = path.join(__dirname, '..');
let passed = 0;

function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? ' — ' + detail : ''));
  passed += 1;
  console.log('PASS', name);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function birthdayMs(year, month, day) {
  return Date.UTC(year, month - 1, day, 3, 0, 0);
}

function createMemoryLegalAdmin(seed) {
  const rows = {};
  const profiles = {};
  (seed || []).forEach(function (r) {
    rows[r.user_id] = Object.assign({}, r);
  });
  const deletedAlignment = [];
  return {
    deletedAlignment: deletedAlignment,
    rows: rows,
    profiles: profiles,
    admin: {
      from: function (table) {
        const self = {
          _table: table,
          _action: 'select',
          _filters: {},
          _payload: null,
          select: function () {
            self._action = 'select';
            return self;
          },
          insert: function (payload) {
            self._action = 'insert';
            self._payload = payload;
            return self;
          },
          upsert: function (payload) {
            self._action = 'upsert';
            self._payload = payload;
            return Promise.resolve(applyWrite());
          },
          update: function (payload) {
            self._action = 'update';
            self._payload = payload;
            return self;
          },
          delete: function () {
            self._action = 'delete';
            return self;
          },
          eq: function (col, val) {
            self._filters[col] = val;
            if (self._action === 'update' || self._action === 'delete') {
              if (table === 'profiles') return self;
              return Promise.resolve(applyWrite());
            }
            return self;
          },
          is: function (col, val) {
            self._filters['is:' + col] = val;
            if (self._action === 'update' || self._action === 'delete') return Promise.resolve(applyWrite());
            return self;
          },
          in: function (col, vals) {
            self._filters.in = { col: col, vals: vals };
            if (self._action === 'select') return Promise.resolve(applyWrite());
            return self;
          },
          maybeSingle: function () {
            return Promise.resolve(applyWrite());
          },
        };
        function applyWrite() {
          if (table === 'user_alignment_state' || table === 'alignment_history' || table === 'alignment_territory_history') {
            if (self._action === 'delete') {
              deletedAlignment.push({ table: table, userId: self._filters.user_id });
            }
            return { data: null, error: null };
          }
          if (table === 'profiles') {
            const pid = self._filters.id;
            if (self._action === 'update' && self._payload && pid) {
              if (!profiles[pid]) profiles[pid] = { id: pid, signup_completed_at: null };
              if (Object.prototype.hasOwnProperty.call(self._filters, 'is:signup_completed_at') &&
                  profiles[pid].signup_completed_at != null) {
                return { data: profiles[pid], error: null };
              }
              profiles[pid] = Object.assign({}, profiles[pid], self._payload);
            }
            return { data: profiles[pid] || null, error: null };
          }
          if (table !== 'user_legal_consents') return { data: null, error: null };
          if (self._action === 'upsert' && self._payload) {
            const id = self._payload.user_id;
            rows[id] = Object.assign({}, rows[id] || {}, self._payload);
            return { data: rows[id], error: null };
          }
          if (self._action === 'update' && self._payload) {
            const id = self._filters.user_id;
            if (rows[id]) rows[id] = Object.assign({}, rows[id], self._payload);
            return { data: rows[id] || null, error: null };
          }
          if (self._action === 'select') {
            if (self._filters.in) {
              const list = (self._filters.in.vals || []).map(function (id) {
                return rows[id];
              }).filter(Boolean);
              return { data: list, error: null };
            }
            const id = self._filters.user_id;
            return { data: rows[id] || null, error: null };
          }
          return { data: null, error: null };
        }
        return self;
      },
    },
  };
}

async function main() {
  const today = core.seoulToday(birthdayMs(2026, 8, 20));
  ok('A. seoul today fixture', today.year === 2026 && today.month === 8 && today.day === 20);

  const under = core.evaluateAge({ year: 2013, month: 8, day: 20 }, birthdayMs(2026, 8, 20));
  ok('A. 13세 가입 불가', under.ok === false && under.error === 'AGE_UNDER_14' && under.age === 13);

  const exact = core.evaluateAge({ year: 2012, month: 8, day: 20 }, birthdayMs(2026, 8, 20));
  ok('B. 정확히 만 14세 가능', exact.ok === true && exact.age === 14);

  const future = core.evaluateAge({ year: 2027, month: 1, day: 1 }, birthdayMs(2026, 8, 20));
  ok('C. 미래 생년월일 불가', future.ok === false && future.error === 'AGE_FUTURE');

  const bad = core.evaluateAge({ year: 2020, month: 2, day: 30 }, birthdayMs(2026, 8, 20));
  ok('C2. 잘못된 날짜 불가', bad.ok === false && bad.error === 'AGE_INVALID_DATE');

  const mem = createMemoryLegalAdmin();
  const svc = createLegalGateService({ getAdminClient: function () { return mem.admin; } });
  const st0 = await svc.getStatus('user-a');
  ok('F. consent 없음은 incomplete', st0.complete === false && st0.ageConfirmed === false && st0.sensitiveConsented === false && st0.territoryDisclosureConsented === false);

  const prevEnforce = process.env.LEGAL_GATE_ENFORCE;
  process.env.LEGAL_GATE_ENFORCE = '1';
  let blocked = '';
  try {
    await svc.assertCompleteForUser('user-a');
  } catch (e) {
    blocked = e.code;
  }
  ok('D. 미완료 민감정보 처리 금지', blocked === 'LEGAL_GATE_INCOMPLETE');

  const ageBody = core.parseAgeConfirmBody({ year: 2012, month: 8, day: 20, policyVersion: 'age-policy-v1' });
  ok('B2. age confirm body ok', ageBody.ok === true && !('year' in ageBody));

  const underBody = core.parseAgeConfirmBody({ year: 2013, month: 8, day: 21, policyVersion: 'age-policy-v1' });
  ok('A2. age confirm 13세 403', underBody.ok === false && underBody.error === 'AGE_UNDER_14');

  const spoof = core.parseAgeConfirmBody({ year: 2000, month: 1, day: 1, userId: 'other', policyVersion: 'age-policy-v1' });
  ok('G. client userId 지정 불가', spoof.ok === false && spoof.error === 'LEGAL_USER_ID_NOT_ALLOWED');

  const ageSaved = await svc.confirmAge('user-a', { year: 2000, month: 1, day: 1, policyVersion: 'age-policy-v1' });
  ok('age saved without DOB', ageSaved.ageConfirmed === true && !core.containsDob(ageSaved) && ageSaved.complete === false);
  ok('연령만으로는 가입완료 없음', !mem.profiles['user-a'] || !mem.profiles['user-a'].signup_completed_at);

  const noConsent = core.parseSensitiveConsentBody({ consented: false, policyVersion: 'sensitive-political-v1' });
  ok('D. 민감정보 미동의 body', noConsent.ok === false);

  const noTerritory = core.parseSensitiveConsentBody({
    consented: true,
    policyVersion: 'sensitive-political-v1',
  });
  ok('D. 영토 공개 미동의 body 거부', noTerritory.ok === false && noTerritory.error === 'TERRITORY_DISCLOSURE_REQUIRED');

  const visIgnored = core.parseSensitiveConsentBody({
    consented: true,
    territoryDisclosureConsented: true,
    policyVersion: 'sensitive-political-v1',
    territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
    politicalProfileVisibility: 'public',
  });
  ok('가입 POST visibility 미사용', visIgnored.ok === true && visIgnored.politicalProfileVisibility == null);

  let bypassConsent = '';
  try {
    await svc.consentSensitive('user-a', {
      consented: true,
      policyVersion: 'sensitive-political-v1',
      politicalProfileVisibility: 'public',
    });
  } catch (e) {
    bypassConsent = e.code;
  }
  ok('4. 서버 우회 미동의 가입 거부', bypassConsent === 'TERRITORY_DISCLOSURE_REQUIRED');

  const consented = await svc.consentSensitive('user-a', {
    consented: true,
    territoryDisclosureConsented: true,
    policyVersion: 'sensitive-political-v1',
    territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
    politicalProfileVisibility: 'public',
  });
  ok('E. 14세+필수동의 완료', consented.complete === true && consented.territoryDisclosureConsented === true);
  ok('가입 동의로 성향 공개 강제 안 함', consented.politicalProfileVisibility === 'private');
  ok('A. 신규 회원가입 완료 기록', !!mem.profiles['user-a'] && !!mem.profiles['user-a'].signup_completed_at);
  await svc.assertCompleteForUser('user-a');
  ok('E. 완료 후 처리 허용', true);

  const vis = await svc.setVisibility('user-a', 'public');
  ok('O. 명시적 공개 선택', vis.politicalProfileVisibility === 'public');
  const visPriv = await svc.setVisibility('user-a', 'private');
  ok('N. 비공개 기본/전환', visPriv.politicalProfileVisibility === 'private');

  const withdrawn = await svc.withdrawSensitiveConsent('user-a');
  ok('철회 후 미동의', withdrawn.complete === false && withdrawn.ageConfirmed === true && withdrawn.territoryDisclosureConsented === false);
  ok('철회 시 성향 파생 삭제', mem.deletedAlignment.length >= 2);
  ok('동의 철회 후에도 가입완료 유지', !!mem.profiles['user-a'] && !!mem.profiles['user-a'].signup_completed_at);

  const legacyMem = createMemoryLegalAdmin([
    {
      user_id: 'legacy-member',
      age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
      age_policy_version: 'age-policy-v1',
      age_gate_method: 'dob-input',
      sensitive_political_consented_at: '2026-01-01T00:00:00.000Z',
      sensitive_political_policy_version: 'sensitive-political-v1',
      political_profile_visibility: 'private',
    },
  ]);
  legacyMem.profiles['legacy-member'] = { id: 'legacy-member', signup_completed_at: '2026-01-02T00:00:00.000Z' };
  const legacySvc = createLegalGateService({ getAdminClient: function () { return legacyMem.admin; } });
  const legacySt = await legacySvc.getStatus('legacy-member');
  ok('8. 기존 회원 연령+민감정보만으로는 incomplete', legacySt.complete === false && legacySt.sensitiveConsented === true && legacySt.territoryDisclosureConsented === false);
  ok('8. 기존 회원 가입완료 기록 유지', !!legacyMem.profiles['legacy-member'].signup_completed_at);
  const legacyAfter = await legacySvc.consentSensitive('legacy-member', {
    consented: true,
    territoryDisclosureConsented: true,
    policyVersion: 'sensitive-political-v1',
    territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
  });
  ok('8. 기존 회원 영토 공개 추가 동의 후 complete', legacyAfter.complete === true);
  ok('8. 기존 민감정보 동의 시각 유지', legacyMem.rows['legacy-member'].sensitive_political_consented_at === '2026-01-01T00:00:00.000Z');
  ok('8. 기존 회원 가입완료 시각 덮지 않음', legacyMem.profiles['legacy-member'].signup_completed_at === '2026-01-02T00:00:00.000Z');

  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createLegalGateRouter({
      resolveActor: async function (req) {
        if (req.headers['x-test-user']) return { userId: req.headers['x-test-user'] };
        return null;
      },
      service: svc,
    }),
  );
  const guest = await requestApp(app, 'POST', '/api/me/legal/age-confirm', {
    body: { year: 2000, month: 1, day: 1, policyVersion: 'age-policy-v1' },
  });
  ok('Guest legal API 401', guest.status === 401);

  await svc.confirmAge('user-b', { year: 2000, month: 1, day: 1, policyVersion: 'age-policy-v1' });
  const missConsent = await requestApp(app, 'POST', '/api/me/legal/sensitive-consent', {
    headers: { 'x-test-user': 'user-b' },
    body: { consented: false, policyVersion: 'sensitive-political-v1' },
  });
  ok('D. API 미동의 거부', missConsent.status === 400);

  const okConsent = await requestApp(app, 'POST', '/api/me/legal/sensitive-consent', {
    headers: { 'x-test-user': 'user-b' },
    body: {
      consented: true,
      territoryDisclosureConsented: true,
      policyVersion: 'sensitive-political-v1',
      territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
    },
  });
  ok('E. API 동의 완료', okConsent.status === 200 && okConsent.body.legal && okConsent.body.legal.complete === true);
  ok('응답에 DOB 없음', !core.containsDob(okConsent.body));

  const boardApp = express();
  boardApp.use(express.json());
  boardApp.use(
    '/api/board',
    createBoardRouter({
      operational: true,
      useMemory: true,
      resolveActorFromRequest: async function (req) {
        if (req.headers['x-test-user']) return { userId: req.headers['x-test-user'] };
        return null;
      },
      repository: createBoardMemoryRepository(),
    }),
  );
  const bypass = await requestApp(boardApp, 'POST', '/api/board/reactions/toggle', {
    headers: { 'x-test-user': 'no-consent' },
    body: { targetType: 'POST', targetId: '00000000-0000-4000-8000-000000000001', reactionType: 'LIKE' },
  });
  ok('G. 우회 반응 API 불가', bypass.status === 403 && bypass.body.error === 'LEGAL_GATE_INCOMPLETE');

  const priv = publicProfile.mapPublicUserProfile({
    profile: { display_name: '타인', territory: 'CENTRAL' },
    progression: { level: 2 },
    alignmentMap: { available: true, value: 12, displayValue: 'x' },
    politicalProfileVisibility: 'private',
    viewerUserId: 'viewer',
    targetUserId: 'target',
  });
  ok('N. 타인 비공개 성향맵 숨김', priv.alignmentMap && priv.alignmentMap.available === false && priv.politicalProfileVisibility === 'private');
  ok('N. 원점수 필드 없음', priv.alignmentScore == null);
  ok('N. 변화량/이동기록 필드 없음', priv.alignmentDelta == null && priv.territoryHistory == null && priv.alignmentHistory == null);

  const pub = publicProfile.mapPublicUserProfile({
    profile: { display_name: '타인', territory: 'CENTRAL' },
    progression: { level: 2 },
    alignmentMap: { available: true, value: 'map', displayValue: '표시' },
    politicalProfileVisibility: 'public',
    viewerUserId: 'viewer',
    targetUserId: 'target',
  });
  ok('O. 공개 선택 시에만 맵 available', pub.alignmentMap && pub.alignmentMap.available === true);
  ok('territory는 공개 유지', pub.territory === 'CENTRAL');
  ok('9. 타인에게 현재 영토 공개', pub.territory === 'CENTRAL' && pub.displayName === '타인');

  const mine = publicProfile.mapPublicUserProfile({
    profile: { display_name: '나' },
    alignmentMap: { available: true, value: 'mine', displayValue: '나' },
    politicalProfileVisibility: 'private',
    viewerUserId: 'me',
    targetUserId: 'me',
  });
  ok('본인은 비공개여도 본인 맵 표시 가능', mine.isMine === true && mine.alignmentMap.available === true);

  const authJs = read('public/auth.js');
  ok('I. Google OAuth 유지', /provider:\s*'google'/.test(authJs) || /'google'/.test(authJs));
  ok('J. Kakao OAuth 유지', /kakao/.test(authJs));
  ok('K. Naver OAuth 유지', /custom:naver/.test(authJs) && /flowType:\s*'pkce'/.test(authJs));
  const entry = read('public/app-entry.js');
  ok('IJK. 회원가입만 startOAuth', /AUTH_INTENT_SIGNUP/.test(entry) && /ScLegalGateUI\.startOAuth/.test(entry));
  ok('IJK. 로그인은 바로 ScAuth.login', /AUTH_INTENT_LOGIN/.test(entry) && /ScAuth\.login\(provider\)/.test(entry));
  ok('L. Guest enterGuest 유지', /function enterGuest/.test(entry) && /auth-guest-btn/.test(entry));
  ok('L. Guest는 legal complete 없이 진입', /enterGuest\(\)/.test(entry) && !/startOAuth\('guest'\)/.test(entry));
  ok('로그인 화면에서 임시 법적 상태 정리', /clearAbandonedPreOAuthState/.test(entry));
  ok('로그인 의도 sessionStorage', /sc_auth_intent/.test(entry) && /LOGIN/.test(entry) && /SIGNUP/.test(entry));
  ok('신규 로그인 우회 READY 차단', /showNoAccountAndSignOut/.test(entry) && /isEstablishedMember/.test(entry));
  ok('가입완료 시각만으로 회원 판별', /signupCompletedAt/.test(entry) && /signup_completed_at/.test(entry));
  const establishedFn = entry.slice(entry.indexOf('function isEstablishedMember'), entry.indexOf('function setAuthLead'));
  ok('활동량으로 회원 추측 안 함', !/activityStats/.test(establishedFn) && !/\.xp/.test(establishedFn) && !/ageConfirmed/.test(establishedFn));
  ok('이메일만으로 회원 판별 안 함', !/pack\.profile\.email/.test(entry) && !/user\.email && established/.test(entry));
  const boot = read('public/app-bootstrap.js');
  ok('부팅 시 startOAuth 없음', !/startOAuth\(/.test(boot) && !/openAgeGate\(/.test(boot) && !/showPostLogin\(/.test(boot));

  const wd = read('tools/test-account-withdrawal.js');
  ok('M. 탈퇴 테스트 파일 유지', /OK 48|account withdrawal/.test(wd));
  const mig = read('supabase/migration_legal_gate_v1.sql');
  ok('DB. DOB 컬럼 없음', !/\bbirth_date\b/i.test(mig) && !/\bdate_of_birth\b/i.test(mig) && /user_legal_consents/.test(mig));
  ok('DB. 자동 동의 UPDATE 없음', !/sensitive_political_consented_at\s*=\s*now\(\)/i.test(mig.replace(/DEFAULT now/g, '')));
  ok('DB. ON DELETE CASCADE', /ON DELETE CASCADE/.test(mig));
  const tdMig = read('supabase/migration_legal_territory_disclosure_v1.sql');
  ok('영토 공개 동의 컬럼 additive', /territory_disclosure_consented_at timestamptz NULL/.test(tdMig) && /territory_disclosure_policy_version text NULL/.test(tdMig));
  ok('영토 공개 기존 회원 일괄 UPDATE 없음', !/UPDATE\s+public\.user_legal_consents/i.test(tdMig));
  ok('영토 공개 DROP/TRUNCATE/DELETE 없음', !/\bDROP TABLE\b/i.test(tdMig) && !/\bTRUNCATE\b/i.test(tdMig) && !/\bDELETE FROM\b/i.test(tdMig) && !/\bDROP COLUMN\b/i.test(tdMig));
  ok('visibility 컬럼 삭제 없음', /political_profile_visibility/.test(mig) && !/DROP COLUMN.*political_profile_visibility/i.test(tdMig));
  const coreSrc = read('shared/legal-gate-core.js');
  ok('필수 동의 제목에 영토 공개', /정치 관련 정보 처리 및 소속 영토 공개/.test(coreSrc));
  ok('원점수 비공개 안내', /정치성향 원점수/.test(coreSrc) && /다른 이용자에게 공개되지 않습니다/.test(coreSrc));
  ok('민감정보 정책버전 유지', /sensitive-political-v1/.test(coreSrc) && /territory-disclosure-v1/.test(coreSrc));
  const signupMig = read('supabase/migration_signup_completed_at_v1.sql');
  ok('가입완료 컬럼 기본 NULL', /signup_completed_at timestamptz NULL/.test(signupMig));
  ok('가입완료 일괄 UPDATE 없음', !/UPDATE\s+public\.profiles/i.test(signupMig));
  ok('가입완료 클라이언트 쓰기 금지', /PROFILES_SIGNUP_COMPLETED_CLIENT_WRITE_FORBIDDEN/.test(signupMig));
  ok('가입완료 DROP/TRUNCATE 없음', !/\bDROP TABLE\b/i.test(signupMig) && !/\bTRUNCATE\b/i.test(signupMig) && !/\bDELETE FROM\b/i.test(signupMig));
  ok('H. 성향 공식 파일 미변경 확인용 존재', fs.existsSync(path.join(root, 'shared/alignment-batch-core.js')));
  const formulaFiles = [
    'shared/alignment-batch-core.js',
    'shared/alignment-territory-core.js',
    'public/auth.js',
  ];
  formulaFiles.forEach(function (rel) {
    const diff = require('child_process').execFileSync('git', ['diff', '--', rel], { cwd: root, encoding: 'utf8' });
    ok('H. ' + rel + ' 미변경', !String(diff || '').trim());
  });

  const indexHtml = read('public/index.html');
  ok('UI 만 14세 문구', indexHtml.indexOf('/legal-gate-ui.js') >= 0);
  ok('UI 민감정보 스크립트', /legal-gate-core\.js/.test(indexHtml));
  ok('auth.js 스크립트 유지', /src="\/auth\.js"/.test(indexHtml));
  ok('첫 화면 로그인/회원가입 분리', /auth-choice-login/.test(indexHtml) && /auth-choice-signup/.test(indexHtml) && /auth-guest-btn/.test(indexHtml));
  ok('가입 없음 안내', /가입된 계정이 없습니다/.test(indexHtml) && /회원가입하기/.test(indexHtml));

  const ui = read('public/legal-gate-ui.js');
  ok('UI 체크 기본 해제', /ack\.checked = false/.test(ui));
  ok('1. 필수 동의 기본 해제', /disabled>동의하고 계속/.test(ui) && /ack\.checked = false/.test(ui));
  ok('2. 미체크 시 계속 버튼 비활성', /submit\.disabled = !ack\.checked/.test(ui));
  ok('가입 화면 영토 공개 선택 라디오 없음', !/name="sc-legal-vis"/.test(ui) && !/내 정치성향 공개/.test(ui));
  ok('가입 POST에 영토 공개 필수 플래그', /territoryDisclosureConsented: true/.test(ui) && /TERRITORY_DISCLOSURE_POLICY_VERSION/.test(ui));
  ok('로그인 후 영토 공개 미동의면 동의 화면', /!legal\.territoryDisclosureConsented/.test(ui));
  ok('UI 생년월일 select', /sc-legal-year/.test(ui) && !/type="checkbox" id="sc-legal-age"/.test(ui));
  const ageFn = ui.slice(ui.indexOf('function onAgeNext'), ui.indexOf('function postAgeToServer'));
  ok('연령 다음에서 OAuth 즉시 시작 없음', ageFn.indexOf('ScAuth.login') === -1 && /showStep\(false, true\)/.test(ageFn));
  ok('동의 후에만 선택 provider OAuth', /saveTmpConsent/.test(ui) && /beginSelectedOAuth/.test(ui) && /ScAuth\.login\(name\)/.test(ui));
  ok('회원가입 의도에만 사전 게이트', /intent !== 'SIGNUP'/.test(ui));
  ok('Google/Kakao/Naver만 사전 게이트', /name !== 'google' && name !== 'kakao' && name !== 'naver'/.test(ui));
  ok('취소 시 메인 로그인 복귀', /sc-legal-age-cancel/.test(ui) && /sc-legal-consent-cancel/.test(ui) && /cancelToLogin/.test(ui));
  ok('사전 OAuth 상태를 sessionStorage만 사용', /sessionStorage/.test(ui) && ui.indexOf('localStorage') === -1);
  ok('profile GET에 가입완료 시각', /signupCompletedAt/.test(read('public/app-entry.js')) && /signupCompletedAt/.test(read('server.js')));

  process.env.LEGAL_GATE_ENFORCE = prevEnforce == null ? '' : prevEnforce;
  if (prevEnforce == null) delete process.env.LEGAL_GATE_ENFORCE;

  console.log('\nOK', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.message ? e.message : e);
  process.exit(1);
});
