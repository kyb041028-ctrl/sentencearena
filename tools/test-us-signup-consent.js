#!/usr/bin/env node
'use strict';

/**
 * 미국 가입 동의. 로컬 메모리 저장이다.
 * Supabase Auth 세션이 아니고, 운영 DB도 아니다.
 */

const express = require('express');
const http = require('http');

const core = require('../shared/legal-gate-core');
const { createLegalGateService } = require('../server/legal-gate-service');
const { createLegalGateRouter } = require('../server/legal-gate-routes');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

function createStore() {
  const kr = {};
  const us = {};
  const profiles = {};
  const known = {};
  known[USER_A] = true;
  known[USER_B] = true;
  return {
    kr: kr,
    us: us,
    profiles: profiles,
    admin: {
      auth: {
        admin: {
          getUserById: function (id) {
            if (!known[id]) return Promise.resolve({ data: null, error: { message: 'missing' } });
            return Promise.resolve({ data: { user: { id: id } }, error: null });
          },
        },
      },
      from: function (table) {
        const state = { action: 'select', filters: {}, payload: null };
        function apply(action) {
          const bag = table === 'user_activity_region_legal_consents' ? us : table === 'user_legal_consents' ? kr : null;
          if (table === 'profiles') {
            const id = state.filters.id;
            if (!profiles[id]) profiles[id] = { id: id, signup_completed_at: null };
            if (action === 'update' && state.filters['is:signup_completed_at'] == null && profiles[id].signup_completed_at == null) {
              profiles[id] = Object.assign({}, profiles[id], state.payload);
            }
            return { data: profiles[id], error: null };
          }
          if (!bag) return { data: null, error: { message: 'missing table' } };
          const id = state.filters.user_id || (state.payload && state.payload.user_id);
          if (action === 'select') {
            const row = bag[id] || null;
            if (row && state.filters.activity_region && row.activity_region !== state.filters.activity_region) {
              return { data: null, error: null };
            }
            return { data: row, error: null };
          }
          if (action === 'upsert') {
            bag[id] = Object.assign({}, bag[id] || {}, state.payload);
            return { data: bag[id], error: null };
          }
          if (action === 'update') {
            const row = bag[id];
            if (!row) return { data: [], error: null };
            if (state.filters.updated_at && row.updated_at !== state.filters.updated_at) return { data: [], error: null };
            if (state.filters.activity_region && row.activity_region !== state.filters.activity_region) return { data: [], error: null };
            bag[id] = Object.assign({}, row, state.payload);
            return { data: [bag[id]], error: null };
          }
          return { data: null, error: null };
        }
        const api = {
          select: function () {
            if (state.action === 'update') return Promise.resolve(apply('update'));
            return api;
          },
          eq: function (col, val) {
            state.filters[col] = val;
            return api;
          },
          is: function (col, val) {
            state.filters['is:' + col] = val;
            return api;
          },
          upsert: function (payload) {
            state.payload = payload;
            return Promise.resolve(apply('upsert'));
          },
          update: function (payload) {
            state.action = 'update';
            state.payload = payload;
            return api;
          },
          maybeSingle: function () {
            return Promise.resolve(apply('select'));
          },
          then: function (resolve, reject) {
            return Promise.resolve(apply(state.action)).then(resolve, reject);
          },
        };
        return api;
      },
    },
  };
}

function request(server, method, urlPath, headers, body) {
  return new Promise(function (resolve, reject) {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: urlPath,
      method: method,
      headers: Object.assign({}, headers || {}, data ? { 'content-length': Buffer.byteLength(data) } : {}),
    }, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, json: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function dobFor(age) {
  const today = core.seoulToday(Date.now());
  return { year: today.year - age, month: today.month, day: today.day };
}

function usConsent(extra) {
  return Object.assign({
    termsViewed: true,
    termsConsented: true,
    termsVersion: core.TERMS_DRAFT_VERSION,
    privacyViewed: true,
    privacyVersion: core.PRIVACY_DRAFT_VERSION,
    consented: true,
    territoryDisclosureConsented: true,
    policyVersion: core.SENSITIVE_POLICY_VERSION,
    territoryDisclosurePolicyVersion: core.TERRITORY_DISCLOSURE_POLICY_VERSION,
    activityRegion: 'US',
  }, extra || {});
}

async function main() {
  console.log('AUTH_MODE', 'local-memory-not-supabase-auth');
  const today = core.seoulToday(Date.now());
  const age17 = core.evaluateAgeForRegion(dobFor(17), 'US', Date.now());
  const age18 = core.evaluateAgeForRegion(dobFor(18), 'US', Date.now());
  const age14 = core.evaluateAge(dobFor(14), Date.now());
  const age13 = core.evaluateAge(dobFor(13), Date.now());
  check('미국 17세는 거절된다', age17.ok === false && age17.error === 'AGE_UNDER_18', age17.error);
  check('미국 18세는 가능하다', age18.ok === true && age18.policyVersion === 'age-policy-us-v1' && age18.policyVersion !== core.AGE_POLICY_VERSION);
  check('한국 만 14세는 유지된다', age14.ok === true && age14.policyVersion === 'age-policy-v1' && age13.ok === false && age13.error === 'AGE_UNDER_14');
  check('오늘 기준 날짜가 계산된다', today.year > 2000);

  const store = createStore();
  store.kr[USER_A] = {
    user_id: USER_A,
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-v1',
    age_gate_method: 'dob-input',
    sensitive_political_consented_at: '2026-01-01T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    territory_disclosure_consented_at: '2026-01-01T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
    political_profile_visibility: 'private',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const krBefore = JSON.stringify(store.kr[USER_A]);
  store.profiles[USER_A] = { id: USER_A, signup_completed_at: '2026-01-02T00:00:00.000Z' };

  const service = createLegalGateService({ getAdminClient: function () { return store.admin; } });
  const app = express();
  app.use(express.json());
  app.use('/api', createLegalGateRouter({
    resolveActor: async function (req) {
      const id = req.headers['x-test-user'];
      return id ? { userId: String(id) } : null;
    },
    service: service,
  }));
  const server = await new Promise(function (resolve) {
    const s = app.listen(0, '127.0.0.1', function () { resolve(s); });
  });

  const guest = await request(server, 'POST', '/api/me/legal/age-confirm', {
    'content-type': 'application/json',
    'accept-language': 'en',
  }, Object.assign({ policyVersion: core.US_AGE_POLICY_VERSION }, dobFor(18)));
  check('비로그인 연령 확인은 401이다', guest.status === 401);

  const under = await request(server, 'POST', '/api/me/legal/age-confirm', {
    'content-type': 'application/json',
    'accept-language': 'en',
    'x-test-user': USER_A,
  }, Object.assign({ policyVersion: core.US_AGE_POLICY_VERSION }, dobFor(17)));
  check('서버가 미국 17세를 막는다', under.status === 403 && under.json && under.json.error === 'AGE_UNDER_18', String(under.status));

  const skipped = await request(server, 'POST', '/api/me/legal/age-confirm', {
    'content-type': 'application/json',
    'accept-language': 'en',
    'x-test-user': USER_A,
  }, { policyVersion: core.US_AGE_POLICY_VERSION, ageConfirmed: true, complete: true });
  check('연령 확인 생략은 서버가 막는다', skipped.status === 400 && skipped.json.error === 'AGE_CONFIRM_REQUIRED');

  const cookieBypass = await request(server, 'POST', '/api/me/legal/age-confirm', {
    'content-type': 'application/json',
    'accept-language': 'en',
    cookie: 'sa_ar=KR; sa_ar_x=1',
    'x-test-user': USER_A,
  }, Object.assign({ policyVersion: 'age-policy-v1', activityRegion: 'KR' }, dobFor(17)));
  check('국가 쿠키와 본문으로 연령을 우회하지 못한다', cookieBypass.status === 403, cookieBypass.json && cookieBypass.json.error);

  const adult = await request(server, 'POST', '/api/me/legal/age-confirm', {
    'content-type': 'application/json',
    'accept-language': 'en',
    'x-test-user': USER_A,
  }, Object.assign({ policyVersion: core.US_AGE_POLICY_VERSION, activityRegion: 'US' }, dobFor(18)));
  check(
    '미국 18세 연령 기록이 남는다',
    adult.status === 200 && adult.json.legal.agePolicyVersion === 'age-policy-us-v1' && adult.json.legal.agePolicyRegion === 'US' && adult.json.legal.legalReviewComplete === false,
    JSON.stringify(adult.json)
  );
  check('연령 응답에 생년월일이 없다', !core.containsDob(adult.json) && !store.us[USER_A].year && !store.us[USER_A].birthDate);

  const noTerms = await request(server, 'POST', '/api/me/legal/us-signup-consent', {
    'content-type': 'application/json',
    'accept-language': 'en',
    'x-test-user': USER_A,
  }, usConsent({ termsConsented: false, complete: true }));
  check('약관 미동의는 가입 기록이 끝나지 않는다', noTerms.status === 400 && noTerms.json.error === 'TERMS_CONSENT_REQUIRED');

  const marketingOff = await request(server, 'POST', '/api/me/legal/us-signup-consent', {
    'content-type': 'application/json',
    'accept-language': 'en',
    'x-test-user': USER_A,
  }, usConsent());
  const again = await request(server, 'GET', '/api/me/legal/us-status', {
    'accept-language': 'en',
    'x-test-user': USER_A,
  });
  check(
    '마케팅을 거부해도 미국 가입 기록이 끝난다',
    marketingOff.status === 200 && marketingOff.json.legal.complete === true && marketingOff.json.legal.marketingOptIn === false && marketingOff.json.legal.privacyProcessingConsented === false && again.json.legal.complete === true,
    JSON.stringify(marketingOff.json && marketingOff.json.legal)
  );
  check(
    '재조회 시각이 같다',
    store.us[USER_A].terms_consented_at && again.json.legal.termsConsented === true && store.us[USER_A].privacy_acknowledged_at && store.us[USER_A].privacy_processing_consent_at == null
  );
  const firstTermsAt = store.us[USER_A].terms_consented_at;
  const duplicate = await request(server, 'POST', '/api/me/legal/us-signup-consent', {
    'content-type': 'application/json',
    'accept-language': 'en',
    'x-test-user': USER_A,
  }, usConsent());
  check('같은 동의 요청은 시각을 덮어쓰지 않는다', duplicate.status === 200 && store.us[USER_A].terms_consented_at === firstTermsAt);

  const other = await request(server, 'POST', '/api/me/legal/us-signup-consent', {
    'content-type': 'application/json',
    'accept-language': 'en',
    'x-test-user': USER_B,
  }, usConsent({ userId: USER_A }));
  check('다른 사용자 기록은 고치지 못한다', other.status === 400 && store.us[USER_B] == null && store.us[USER_A].user_id === USER_A);

  const kr = await request(server, 'POST', '/api/me/legal/age-confirm', {
    'content-type': 'application/json',
    'accept-language': 'ko',
    'x-test-user': USER_B,
  }, Object.assign({ policyVersion: 'age-policy-v1', activityRegion: 'KR' }, dobFor(14)));
  check('한국 14세 확인은 한국 정책으로 남는다', kr.status === 200 && kr.json.legal.agePolicyVersion === 'age-policy-v1' && store.kr[USER_B].age_policy_version === 'age-policy-v1');
  const krUnder = await request(server, 'POST', '/api/me/legal/age-confirm', {
    'content-type': 'application/json',
    'accept-language': 'ko',
    'x-test-user': USER_B,
  }, Object.assign({ policyVersion: 'age-policy-v1' }, dobFor(13)));
  check('한국 13세는 여전히 거절된다', krUnder.status === 403 && krUnder.json.error === 'AGE_UNDER_14');

  check('한국 동의 기록은 미국으로 복사되지 않았다', krBefore === JSON.stringify(store.kr[USER_A]) && store.us[USER_A].sensitive_applies_to === 'US');
  check('기존 한국 가입 시각은 그대로다', store.profiles[USER_A].signup_completed_at === '2026-01-02T00:00:00.000Z');

  const previous = process.env.LEGAL_GATE_ENFORCE;
  process.env.LEGAL_GATE_ENFORCE = '1';
  let open = true;
  try { await service.assertUsCompleteForUser(USER_A); } catch (_) { open = false; }
  const withdrawn = await request(server, 'POST', '/api/me/legal/withdraw-us-sensitive-consent', {
    'content-type': 'application/json',
    'x-test-user': USER_A,
  }, {});
  let blocked = false;
  try { await service.assertUsCompleteForUser(USER_A); } catch (err) { blocked = err && err.code === 'LEGAL_GATE_INCOMPLETE'; }
  if (previous == null) delete process.env.LEGAL_GATE_ENFORCE;
  else process.env.LEGAL_GATE_ENFORCE = previous;
  check('철회 전에는 미국 처리가 가능하다', open === true);
  check('민감정보 철회 후 미국 처리는 멈춘다', withdrawn.status === 200 && withdrawn.json.legal.complete === false && blocked === true);
  check('철회가 한국 기록을 지우지 않는다', krBefore === JSON.stringify(store.kr[USER_A]));

  await new Promise(function (resolve) { server.close(function () { resolve(); }); });
  console.log('SUPABASE_AUTH_NOT_USED');
  console.log('PRODUCTION_SQL_NOT_APPLIED');
  if (failed) {
    console.log('US_SIGNUP_CONSENT_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('US_SIGNUP_CONSENT_LOCAL_OK');
}

main().catch(function (err) {
  console.log('US_SIGNUP_CONSENT_FAIL', err && err.message ? err.message : 'error');
  process.exitCode = 1;
});
