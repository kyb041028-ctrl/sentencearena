#!/usr/bin/env node
'use strict';

/**
 * Phase 17 — 회원·국가·인증·동의·데이터 분리·GeoIP (Daily Issue AI 제외).
 * 운영 DB/배포/실 Auth 없이 REAL AUTH PASS 금지.
 * SA_PHASE17_REAL_AUTH=1 + SA_PHASE17_BEARER_TOKEN + PORT(서버) 없으면 REPORT_02 REAL AUTH = BLOCKED.
 */

const { spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

const reports = {
  1: { title: '단일 계정 KR/US 전환·중복 계정 없음', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  2: { title: '가입·로그인·세션·토큰·국가 전환 Auth', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'BLOCKED' },
  3: { title: '미국 18+ / 17 차단·생년월일 검증', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  4: { title: '한국 연령·약관 정책 유지', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  5: { title: '한국 계정 미국 첫 이용·동의·철회', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  6: { title: '필수/선택 동의·버전·우회 차단', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  7: { title: '부분 DB 실패·감사·재시도 fail-closed', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  8: { title: '글·댓글·반응 국가 분리(메모리)', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  9: { title: '글·댓글·반응·RLS(격리 Postgres)', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  10: { title: 'GeoIP·선택·언어·폴백', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  11: { title: '/kr /us / 경로·조회 국가', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  12: { title: '국가 판별만으로 권한 부여 금지', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  13: { title: '서버 쓰기 인증·타인 수정 차단', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  14: { title: '한국 성향 유지·미국 성향 점수 금지', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  15: { title: '탈퇴·법적 보존·legal hold', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
  16: { title: '한국 로그인·게시판·세션 회귀(영향 범위)', impl: 'IMPLEMENTED', mock: 'NOT_TESTED', iso: 'NOT_TESTED', real: 'NOT_TESTED' },
};

const suites = { A: 'NOT_RUN', B: 'NOT_RUN', C: 'NOT_RUN', D: 'NOT_RUN', E: 'NOT_RUN' };
let orchestratorFailed = 0;

function setReport(n, field, value) {
  if (reports[n] && reports[n][field] !== undefined) reports[n][field] = value;
}

function bumpFail() {
  orchestratorFailed += 1;
}

function runTool(rel, envExtra) {
  const res = spawnSync(NODE, [path.join(ROOT, rel)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, envExtra || {}),
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const out = (res.stdout || '') + (res.stderr || '');
  return { code: res.status, out: out, signal: res.signal };
}

function outHas(out, needle) {
  return out.indexOf(needle) >= 0;
}

function applyChild(label, rel, envExtra, onOk) {
  const r = runTool(rel, envExtra);
  if (r.signal) {
    console.log('SPAWN_SIGNAL', label, r.signal);
    bumpFail();
    return false;
  }
  const ok = r.code === 0 || r.code === 2;
  if (typeof onOk === 'function') onOk(r.out, r.code);
  if (r.code !== 0 && r.code !== 2) {
    console.log('SPAWN_FAIL', label, 'exit', r.code);
    bumpFail();
    return false;
  }
  console.log('SPAWN_OK', label, 'exit', r.code);
  return ok;
}

function realAuthGateReason() {
  if (String(process.env.SA_PHASE17_REAL_AUTH || '') !== '1') return 'SA_PHASE17_REAL_AUTH not set';
  const token = String(process.env.SA_PHASE17_BEARER_TOKEN || '').trim();
  if (!token) return 'SA_PHASE17_BEARER_TOKEN missing';
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return 'supabase url/key missing';
  return '';
}

function requestMe(token) {
  return new Promise(function (resolve, reject) {
    const port = Number(process.env.PORT) || 3000;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: '/api/auth/me',
        method: 'GET',
        headers: { authorization: 'Bearer ' + token },
      },
      function (res) {
        let d = '';
        res.on('data', function (c) { d += c; });
        res.on('end', function () {
          let json = null;
          try { json = d ? JSON.parse(d) : null; } catch (_) {}
          resolve({ status: res.statusCode, json: json });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function tryRealAuthMe() {
  const block = realAuthGateReason();
  if (block) {
    console.log('REAL_AUTH', 'BLOCKED', block);
    setReport(2, 'real', 'BLOCKED');
    return;
  }
  try {
    const me = await requestMe(process.env.SA_PHASE17_BEARER_TOKEN);
    if (me.status === 200 && me.json && me.json.user && me.json.user.id) {
      console.log('REAL_AUTH', 'PASS', 'session-user', me.json.user.id);
      setReport(2, 'real', 'REAL AUTH PASS');
    } else {
      console.log('REAL_AUTH', 'FAIL', me.status, me.json && me.json.error ? me.json.error : '');
      setReport(2, 'real', 'FAIL');
      bumpFail();
    }
  } catch (err) {
    console.log('REAL_AUTH', 'NOT_TESTED', err && err.code ? err.code : 'request-failed');
    setReport(2, 'real', 'NOT_TESTED');
  }
}

function runSuiteA() {
  let ok = true;
  ok = applyChild('auth-v2-static', 'tools/test-auth-v2.js', {}, function (out, code) {
    if (code === 0) setReport(2, 'mock', 'MOCK PASS');
    else if (out.indexOf('ECONNREFUSED') >= 0 || out.indexOf('connect') >= 0) {
      setReport(2, 'mock', 'BLOCKED');
    } else setReport(2, 'mock', 'FAIL');
  }) && ok;
  ok = applyChild('oauth-restore-static', 'tools/test-oauth-session-restore.js', {}, function () {}) && ok;
  suites.A = ok && reports[2].mock === 'MOCK PASS' ? 'MOCK PASS' : ok ? 'PARTIAL' : 'FAIL';
}

function runSuiteB() {
  let ok = true;
  ok = applyChild('us-signup-consent', 'tools/test-us-signup-consent.js', {}, function (out) {
    if (outHas(out, 'US_SIGNUP_CONSENT_LOCAL_OK')) {
      setReport(3, 'mock', 'MOCK PASS');
      setReport(4, 'mock', 'MOCK PASS');
      setReport(5, 'mock', 'MOCK PASS');
    } else setReport(3, 'mock', 'FAIL');
  }) && ok;
  ok = applyChild('legal-gate', 'tools/test-legal-gate.js', {}, function (out, code) {
    if (code === 0) setReport(6, 'mock', 'MOCK PASS');
    else setReport(6, 'mock', 'FAIL');
  }) && ok;
  ok = applyChild('consent-withdraw-races', 'tools/test-consent-withdrawal-races.js', {}, function (out, code) {
    if (code === 0) setReport(7, 'mock', 'MOCK PASS');
    else setReport(7, 'mock', 'FAIL');
  }) && ok;
  ok = applyChild('withdraw-tx-static', 'tools/test-sensitive-consent-withdraw-tx.js', {}, function () {}) && ok;
  ok = applyChild('write-time-consent', 'tools/test-write-time-consent-races.js', {}, function () {}) && ok;
  suites.B = ok ? 'MOCK PASS' : 'FAIL';
}

function runSuiteC() {
  let ok = true;
  ok = applyChild('region-isolation-mem', 'tools/test-activity-region-isolation.js', {}, function (out) {
    if (outHas(out, 'TEMP_STORE_TESTS_PASS')) {
      setReport(8, 'mock', 'MOCK PASS');
      setReport(12, 'mock', 'MOCK PASS');
      setReport(13, 'mock', 'MOCK PASS');
    } else setReport(8, 'mock', 'FAIL');
  }) && ok;
  ok = applyChild('region-supabase-mock', 'tools/test-activity-region-supabase-mock.js', {}, function (out, code) {
    if (code === 0) setReport(1, 'mock', 'MOCK PASS');
    else setReport(1, 'mock', 'FAIL');
  }) && ok;
  ok = applyChild('region-auth-storage-pg', 'tools/test-activity-region-auth-storage.js', {}, function (out, code) {
    if (outHas(out, 'LOCAL_POSTGRES_STORAGE_OK')) {
      setReport(9, 'iso', 'ISOLATED DB PASS');
      setReport(13, 'iso', 'ISOLATED DB PASS');
      setReport(14, 'iso', 'ISOLATED DB PASS');
    } else if (outHas(out, 'LOCAL_POSTGRES_UNAVAILABLE')) {
      setReport(9, 'iso', 'BLOCKED');
      setReport(13, 'iso', 'BLOCKED');
      setReport(14, 'iso', 'BLOCKED');
    } else if (code !== 0) setReport(9, 'iso', 'FAIL');
  }) && ok;
  ok = applyChild('region-auth-env-pg', 'tools/test-activity-region-auth-env.js', {}, function (out, code) {
    if (out.indexOf('LOCAL_POSTGRES') >= 0 && out.indexOf('CHECKS_OK') >= 0 && (code === 0 || code === 2)) {
      setReport(9, 'iso', reports[9].iso === 'BLOCKED' ? 'BLOCKED' : 'ISOLATED DB PASS');
      setReport(14, 'iso', reports[14].iso === 'BLOCKED' ? 'BLOCKED' : 'ISOLATED DB PASS');
    }
    if (outHas(out, 'AUTH_ENVIRONMENT_BLOCKED') || outHas(out, 'AUTH_REAL BLOCKED')) {
      setReport(2, 'iso', 'BLOCKED');
    }
  }) && ok;
  ok = applyChild('region-db-pg', 'tools/test-activity-region-db.js', {}, function (out) {
    if (outHas(out, 'LOCAL_POSTGRES_TESTS_PASS')) {
      if (reports[9].iso === 'NOT_TESTED') setReport(9, 'iso', 'ISOLATED DB PASS');
    }
  }) && ok;
  suites.C = ok ? 'MIXED' : 'FAIL';
}

function runSuiteD() {
  let ok = true;
  ok = applyChild('activity-region-core', 'tools/test-activity-region.js', {}, function (out, code) {
    if (code === 0) {
      setReport(10, 'mock', 'MOCK PASS');
      setReport(11, 'mock', 'MOCK PASS');
      setReport(16, 'mock', 'MOCK PASS');
    } else {
      setReport(10, 'mock', 'FAIL');
      setReport(11, 'mock', 'FAIL');
    }
  }) && ok;
  ok = applyChild('geoip', 'tools/test-activity-region-geoip.js', {}, function (out) {
    if (outHas(out, 'GEOIP_CHECKS_OK')) setReport(10, 'mock', 'MOCK PASS');
    else setReport(10, 'mock', 'FAIL');
  }) && ok;
  suites.D = ok ? 'MOCK PASS' : 'FAIL';
}

function runSuiteE() {
  let ok = true;
  ok = applyChild('legal-hold-audit', 'tools/test-legal-hold-and-audit-purge.js', {}, function (out, code) {
    if (code === 0) setReport(15, 'mock', 'MOCK PASS');
    else setReport(15, 'mock', 'FAIL');
  }) && ok;
  ok = applyChild('retention-policy', 'tools/test-retention-policy.js', {}, function () {}) && ok;
  suites.E = ok ? 'MOCK PASS' : 'FAIL';
}

function finalizeReports() {
  for (let i = 1; i <= 16; i += 1) {
    const r = reports[i];
    if (r.mock === 'NOT_TESTED' && r.iso === 'NOT_TESTED') {
      /* keep */
    }
    if (r.real === 'BLOCKED' && i !== 2) r.real = 'NOT_TESTED';
  }
}

function printReports() {
  console.log('PHASE17_BASE', 'ecab671');
  console.log('PHASE17_BRANCH', 'cursor/map-layout-cards-bc3c');
  console.log('SUITE_A', suites.A);
  console.log('SUITE_B', suites.B);
  console.log('SUITE_C', suites.C);
  console.log('SUITE_D', suites.D);
  console.log('SUITE_E', suites.E);
  for (let i = 1; i <= 16; i += 1) {
    const r = reports[i];
    const line = [
      'IMPLEMENTED=' + r.impl,
      'MOCK=' + r.mock,
      'ISOLATED=' + r.iso,
      'REAL=' + r.real,
    ].join(' ');
    console.log('REPORT_' + String(i).padStart(2, '0'), r.title, line);
  }
  if (orchestratorFailed) {
    console.log('PHASE17_ORCHESTRATOR_FAIL', orchestratorFailed);
    process.exitCode = 1;
  } else {
    console.log('PHASE17_ORCHESTRATOR_OK');
  }
}

async function main() {
  runSuiteA();
  runSuiteB();
  runSuiteC();
  runSuiteD();
  runSuiteE();
  await tryRealAuthMe();
  finalizeReports();
  printReports();
}

main().catch(function (err) {
  console.log('PHASE17_ORCHESTRATOR_CRASH', err && err.message ? err.message : err);
  process.exitCode = 1;
});
