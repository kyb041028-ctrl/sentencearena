#!/usr/bin/env node
'use strict';

/**
 * Phase 17 잔여 — REPORT_01~08 (MOCK / ISOLATED DB / BLOCKED / FAIL / NOT_TESTED).
 * REAL AUTH PASS 금지. 운영 Supabase·실회원·Daily Issue AI 15~16 미포함.
 */

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

const report = {
  1: { title: '팔로우·알림·피드·영토·랭킹·통계·검색·전환 캐시', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  2: { title: '격리 Postgres 철회·부분실패·감사·탈퇴·법적보존', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  3: { title: '고정 시각·생일 경계·미국 18·2/29·누락', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  4: { title: '관리자 API·RLS·파라미터 위조·비로그인 쓰기', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  5: { title: '격리 Auth·실가입·로그인·세션', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  6: { title: '베타 전 필수(격리 Auth·철회 PG) 요약', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  7: { title: '공통 계정·활동 분리 설계(팔로우 등)', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  8: { title: 'service_role·관리자 DB 클라이언트 위치', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
};

let orchestratorFailed = 0;

function bumpFail() {
  orchestratorFailed += 1;
}

function runTool(rel, envExtra) {
  const res = spawnSync(NODE, [path.join(ROOT, rel)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, envExtra || {}),
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 24 * 1024 * 1024,
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || ''), signal: res.signal };
}

function spawnOk(label, rel, envExtra, onDone) {
  const r = runTool(rel, envExtra);
  if (r.signal) {
    console.log('SPAWN_SIGNAL', label, r.signal);
    bumpFail();
    return false;
  }
  if (typeof onDone === 'function') onDone(r.out, r.code);
  const ok = r.code === 0 || r.code === 2;
  if (!ok) {
    console.log('SPAWN_FAIL', label, 'exit', r.code);
    bumpFail();
  } else {
    console.log('SPAWN_OK', label, 'exit', r.code);
  }
  return ok;
}

function setMock(n, v) {
  report[n].mock = v;
}

function setIso(n, v) {
  report[n].iso = v;
}

function commandExists(name) {
  try {
    execFileSync('where.exe', [name], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function staticFollowDesign() {
  const v2 = fs.readFileSync(path.join(ROOT, 'supabase', 'migration_activity_region_v2.sql'), 'utf8');
  const userData = fs.readFileSync(path.join(ROOT, 'supabase', 'migration_user_data_system.sql'), 'utf8');
  const okFollowGlobal =
    v2.indexOf('user_follows') === -1 &&
    userData.indexOf('user_follows') !== -1 &&
    userData.indexOf('activity_region') === -1;
  if (okFollowGlobal) {
    console.log('DESIGN_OK follow account-global activity-region-split elsewhere');
    setMock(7, 'MOCK PASS');
  } else {
    console.log('DESIGN_FAIL follow vs region');
    setMock(7, 'FAIL');
    bumpFail();
  }
}

function runReport1() {
  let mockOk = true;
  mockOk = spawnOk('isolation-mem', 'tools/test-activity-region-isolation.js', {}, function (out, code) {
    if (code === 0 && out.indexOf('TEMP_STORE_TESTS_PASS') >= 0) {
      /* covers feed notices ranking search cache in store */
    } else setMock(1, 'FAIL');
  }) && mockOk;
  mockOk = spawnOk('supabase-mock', 'tools/test-activity-region-supabase-mock.js', {}, function (out, code) {
    if (code === 0 && out.indexOf('SUPABASE_MOCK_CHECKS_OK') >= 0) setMock(1, 'MOCK PASS');
    else if (report[1].mock !== 'FAIL') setMock(1, 'FAIL');
  }) && mockOk;
  if (mockOk && report[1].mock !== 'FAIL') setMock(1, 'MOCK PASS');

  spawnOk('region-db', 'tools/test-activity-region-db.js', {}, function (out, code) {
    if (code === 0 && out.indexOf('LOCAL_POSTGRES_TESTS_PASS') >= 0) {
      setIso(1, 'ISOLATED DB PASS');
    } else if (out.indexOf('LOCAL_POSTGRES_UNAVAILABLE') >= 0) {
      setIso(1, 'BLOCKED');
    } else {
      setIso(1, 'FAIL');
    }
  });
}

function runReport2() {
  spawnOk('consent-withdraw-mem', 'tools/test-consent-withdrawal-races.js', {}, function (out, code) {
    setMock(2, code === 0 ? 'MOCK PASS' : 'FAIL');
  });
  spawnOk('consent-withdraw-error', 'tools/test-consent-withdraw-delete-error.js', {}, function (out, code) {
    if (code !== 0 && report[2].mock === 'MOCK PASS') setMock(2, 'FAIL');
  });

  const url = process.env.CONSENT_ISOLATED_DATABASE_URL;
  if (!url || !String(url).trim()) {
    setIso(2, 'BLOCKED');
    console.log('ISO_BLOCK_REASON', 'CONSENT_ISOLATED_DATABASE_URL missing');
    return;
  }
  spawnOk('consent-five-sql', 'tools/test-consent-five-sql-integration.js', {}, function (out, code) {
    if (out.indexOf('RESULT: PASS') >= 0 && code === 0) setIso(2, 'ISOLATED DB PASS');
    else if (out.indexOf('UNVERIFIED') >= 0 || out.indexOf('RESULT: UNVERIFIED') >= 0) setIso(2, 'BLOCKED');
    else setIso(2, 'FAIL');
  });
}

function runReport3() {
  spawnOk('age-boundaries', 'tools/test-phase17-legal-age-boundaries.js', {}, function (out, code) {
    setMock(3, code === 0 && out.indexOf('PHASE17_AGE_BOUNDARIES_OK') >= 0 ? 'MOCK PASS' : 'FAIL');
  });
  setIso(3, 'NOT_TESTED');
}

function runReport4() {
  let mockOk = true;
  mockOk = spawnOk('service-role-grants', 'tools/test-service-role-route-min-grants.js', {}, function (out, code) {
    setMock(8, code === 0 ? 'MOCK PASS' : 'FAIL');
  }) && mockOk;
  mockOk = spawnOk('user-data-system', 'tools/test-user-data-system.js', {}, function (out, code) {
    if (code !== 0) setMock(4, 'FAIL');
  }) && mockOk;
  if (report[4].mock !== 'FAIL') setMock(4, mockOk ? 'MOCK PASS' : 'FAIL');

  spawnOk('auth-storage-pg', 'tools/test-activity-region-auth-storage.js', {}, function (out, code) {
    if (out.indexOf('LOCAL_POSTGRES_STORAGE_OK') >= 0) setIso(4, 'ISOLATED DB PASS');
    else if (out.indexOf('LOCAL_POSTGRES_UNAVAILABLE') >= 0) setIso(4, 'BLOCKED');
    else setIso(4, code === 0 ? 'ISOLATED DB PASS' : 'FAIL');
  });

  const pwFile = process.env.CONSENT_ISOLATED_PW_FILE;
  if (pwFile && String(pwFile).trim()) {
    spawnOk('admin-ops22-pg', 'tools/test-admin-ops22-pg.js', {}, function (out, code) {
      if (code === 0 && out.indexOf('SKIPPED') < 0) {
        if (report[4].iso === 'NOT_TESTED' || report[4].iso === 'BLOCKED') setIso(4, 'ISOLATED DB PASS');
      }
    });
  }
}

function runReport5() {
  const docker = commandExists('docker');
  const podman = commandExists('podman');
  let reason = 'SA_PHASE17_REAL_AUTH not set; isolated Supabase Auth session not run';
  if (!docker && !podman) reason = 'docker-and-podman-missing; ' + reason;

  spawnOk('auth-v2-static', 'tools/test-auth-v2.js', {}, function (out, code) {
    if (code === 0) setMock(5, 'BLOCKED');
    else if (out.indexOf('ECONNREFUSED') >= 0) setMock(5, 'BLOCKED');
    else setMock(5, 'FAIL');
  });

  setIso(5, 'BLOCKED');
  console.log('AUTH_ISOLATED', 'BLOCKED', reason);
  console.log('REAL_AUTH_PASS', 'FORBIDDEN');
}

function runReport6() {
  const r5 = report[5].iso;
  const r2 = report[2].iso;
  if (r5 === 'BLOCKED' && (r2 === 'BLOCKED' || r2 === 'ISOLATED DB PASS')) {
    setMock(6, 'BLOCKED');
    setIso(6, 'BLOCKED');
    console.log('BETA_GATE', 'isolated-auth=BLOCKED consent-pg=' + r2);
  } else if (r2 === 'FAIL' || report[5].mock === 'FAIL') {
    setMock(6, 'FAIL');
    setIso(6, r2);
  } else {
    setMock(6, 'BLOCKED');
    setIso(6, r2);
  }
}

function printReports() {
  console.log('PHASE17_REMAINDER_BASE', '09ee1b1');
  console.log('PHASE17_REMAINDER_BRANCH', 'cursor/map-layout-cards-bc3c');
  for (let i = 1; i <= 8; i += 1) {
    const r = report[i];
    console.log(
      'REPORT_' + String(i).padStart(2, '0'),
      r.title,
      'MOCK=' + r.mock,
      'ISOLATED=' + r.iso
    );
  }
  if (orchestratorFailed) {
    console.log('PHASE17_REMAINDER_ORCHESTRATOR_FAIL', orchestratorFailed);
    process.exitCode = 1;
  } else {
    console.log('PHASE17_REMAINDER_ORCHESTRATOR_OK');
  }
}

function main() {
  staticFollowDesign();
  runReport1();
  runReport2();
  runReport3();
  runReport4();
  runReport5();
  runReport6();
  printReports();
}

main();
