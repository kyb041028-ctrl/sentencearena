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
  (seed || []).forEach(function (r) {
    rows[r.user_id] = Object.assign({}, r);
  });
  const deletedAlignment = [];
  return {
    deletedAlignment: deletedAlignment,
    rows: rows,
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
  ok('F. consent 없음은 incomplete', st0.complete === false && st0.ageConfirmed === false && st0.sensitiveConsented === false);

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

  const noConsent = core.parseSensitiveConsentBody({ consented: false, policyVersion: 'sensitive-political-v1' });
  ok('D. 민감정보 미동의 body', noConsent.ok === false);

  const consented = await svc.consentSensitive('user-a', {
    consented: true,
    policyVersion: 'sensitive-political-v1',
    politicalProfileVisibility: 'private',
  });
  ok('E. 14세+동의 완료', consented.complete === true && consented.politicalProfileVisibility === 'private');
  await svc.assertCompleteForUser('user-a');
  ok('E. 완료 후 처리 허용', true);

  const vis = await svc.setVisibility('user-a', 'public');
  ok('O. 명시적 공개 선택', vis.politicalProfileVisibility === 'public');
  const visPriv = await svc.setVisibility('user-a', 'private');
  ok('N. 비공개 기본/전환', visPriv.politicalProfileVisibility === 'private');

  const withdrawn = await svc.withdrawSensitiveConsent('user-a');
  ok('철회 후 미동의', withdrawn.complete === false && withdrawn.ageConfirmed === true);
  ok('철회 시 성향 파생 삭제', mem.deletedAlignment.length >= 2);

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
    body: { consented: true, policyVersion: 'sensitive-political-v1' },
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
  ok('IJK. OAuth는 age 통과 후 ScAuth.login', /ScLegalGateUI\.startOAuth/.test(entry) && /ScAuth\.login/.test(entry));
  ok('L. Guest enterGuest 유지', /function enterGuest/.test(entry) && /auth-guest-btn/.test(entry));
  ok('L. Guest는 legal complete 없이 진입', /enterGuest\(\)/.test(entry) && !/startOAuth\('guest'\)/.test(entry));

  const wd = read('tools/test-account-withdrawal.js');
  ok('M. 탈퇴 테스트 파일 유지', /OK 48|account withdrawal/.test(wd));
  const mig = read('supabase/migration_legal_gate_v1.sql');
  ok('DB. DOB 컬럼 없음', !/\bbirth_date\b/i.test(mig) && !/\bdate_of_birth\b/i.test(mig) && /user_legal_consents/.test(mig));
  ok('DB. 자동 동의 UPDATE 없음', !/sensitive_political_consented_at\s*=\s*now\(\)/i.test(mig.replace(/DEFAULT now/g, '')));
  ok('DB. ON DELETE CASCADE', /ON DELETE CASCADE/.test(mig));
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

  const ui = read('public/legal-gate-ui.js');
  ok('UI 체크 기본 해제', /ack\.checked = false/.test(ui));
  ok('UI 생년월일 select', /sc-legal-year/.test(ui) && !/type="checkbox" id="sc-legal-age"/.test(ui));

  process.env.LEGAL_GATE_ENFORCE = prevEnforce == null ? '' : prevEnforce;
  if (prevEnforce == null) delete process.env.LEGAL_GATE_ENFORCE;

  console.log('\nOK', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.message ? e.message : e);
  process.exit(1);
});
