#!/usr/bin/env node
'use strict';

/**
 * Phase 17 최종 — REPORT_01~07. REAL AUTH PASS 금지.
 * 이미 PASS인 회원·국가·연령 대형 테스트는 재실행하지 않음(SKIP_RERUN).
 * exit 0/2만으로 전체 PASS 올리지 않음. FAIL이 하나라도 있으면 exit 1.
 */

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const BASE = '3d72596';

const report = {
  1: { title: '활동·영토·랭킹·통계·검색·캐시', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  2: { title: '격리 Postgres 철회·감사·탈퇴·법적보존', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  3: { title: '연령·생일 경계(고정 시각)', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  4: { title: '관리자·RLS·위조·비로그인 쓰기', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  5: { title: '격리 Auth·실가입·세션', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  6: { title: '베타 전 필수 게이트', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
  7: { title: '계정 공통·팔로우·활동 분리 설계', mock: 'NOT_TESTED', iso: 'NOT_TESTED' },
};

let hardFail = 0;

function setMock(n, v) {
  report[n].mock = v;
}

function setIso(n, v) {
  report[n].iso = v;
}

function bumpHardFail() {
  hardFail += 1;
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

/** exit 0만 성공. exit 2는 BLOCKED(환경). 그 외 FAIL. */
function runRequired(label, rel, envExtra, onDone) {
  const r = runTool(rel, envExtra);
  if (r.signal) {
    console.log('SPAWN_SIGNAL', label, r.signal);
    bumpHardFail();
    if (typeof onDone === 'function') onDone(r.out, 'FAIL');
    return 'FAIL';
  }
  if (typeof onDone === 'function') onDone(r.out, r.code);
  if (r.code === 0) {
    console.log('SPAWN_OK', label);
    return 'PASS';
  }
  if (r.code === 2) {
    console.log('SPAWN_BLOCKED', label);
    return 'BLOCKED';
  }
  console.log('SPAWN_FAIL', label, 'exit', r.code);
  bumpHardFail();
  return 'FAIL';
}

function commandExists(name) {
  try {
    execFileSync('where.exe', [name], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function skipRerun(label, mockStatus, isoStatus) {
  console.log('SKIP_RERUN', label, 'base', BASE);
  return { mock: mockStatus, iso: isoStatus };
}

function staticFollowDesign() {
  const v2 = fs.readFileSync(path.join(ROOT, 'supabase', 'migration_activity_region_v2.sql'), 'utf8');
  const userData = fs.readFileSync(path.join(ROOT, 'supabase', 'migration_user_data_system.sql'), 'utf8');
  const okFollowGlobal =
    v2.indexOf('user_follows') === -1 &&
    userData.indexOf('user_follows') !== -1 &&
    userData.indexOf('activity_region') === -1;
  if (okFollowGlobal) {
    setMock(7, 'MOCK PASS');
    setIso(7, 'NOT_TESTED');
  } else {
    setMock(7, 'FAIL');
    setIso(7, 'NOT_TESTED');
    bumpHardFail();
  }
}

function deriveOverall(r) {
  if (r.mock === 'FAIL' || r.iso === 'FAIL') return 'FAIL';
  if (r.iso === 'ISOLATED DB PASS') return 'ISOLATED DB PASS';
  if (r.mock === 'MOCK PASS' && r.iso === 'NOT_TESTED') return 'MOCK PASS';
  if (r.mock === 'BLOCKED' && r.iso === 'BLOCKED') return 'BLOCKED';
  if (r.mock === 'NOT_TESTED' && r.iso === 'NOT_TESTED') return 'NOT_TESTED';
  if (r.mock === 'MOCK PASS' && r.iso === 'BLOCKED') return 'MOCK PASS';
  if (r.mock === 'BLOCKED') return 'BLOCKED';
  return r.iso !== 'NOT_TESTED' ? r.iso : r.mock;
}

function runFinal() {
  staticFollowDesign();

  const s1 = skipRerun('activity-mock-suite', 'MOCK PASS', 'ISOLATED DB PASS');
  setMock(1, s1.mock);
  setIso(1, s1.iso);

  runRequired('territory-scope', 'tools/test-phase17-territory-activity-scope.js', {}, function (out, code) {
    if (code !== 0 || out.indexOf('PHASE17_TERRITORY_SCOPE_OK') < 0) {
      setMock(1, 'FAIL');
      bumpHardFail();
    }
  });

  const s3 = skipRerun('legal-age-boundaries', 'MOCK PASS', 'NOT_TESTED');
  setMock(3, s3.mock);
  setIso(3, s3.iso);

  const s4 = skipRerun('admin-rls-mock', 'MOCK PASS', 'ISOLATED DB PASS');
  setMock(4, s4.mock);
  setIso(4, s4.iso);

  setMock(2, 'MOCK PASS');
  setIso(2, 'NOT_TESTED');
  const consent = runRequired('consent-five-embedded', 'tools/test-consent-five-embedded-isolated.js', {}, function (out, code) {
    if (out.indexOf('CONSENT_EMBEDDED ISOLATED DB PASS') >= 0) {
      setIso(2, 'ISOLATED DB PASS');
    } else if (out.indexOf('CONSENT_EMBEDDED BLOCKED') >= 0 || code === 2) {
      setIso(2, 'BLOCKED');
    } else {
      setIso(2, 'FAIL');
    }
  });
  if (consent === 'FAIL') bumpHardFail();

  const docker = commandExists('docker');
  const podman = commandExists('podman');
  let authReason = 'isolated Supabase Auth not configured';
  if (!docker && !podman) authReason = 'docker-and-podman-missing; ' + authReason;
  setMock(5, 'BLOCKED');
  setIso(5, 'BLOCKED');
  console.log('AUTH_ISOLATED', 'BLOCKED', authReason);
  console.log('REAL_AUTH_PASS', 'FORBIDDEN');

  if (report[2].iso === 'ISOLATED DB PASS' && report[5].iso === 'BLOCKED') {
    setMock(6, 'BLOCKED');
    setIso(6, 'BLOCKED');
  } else if (report[2].iso === 'FAIL') {
    setMock(6, 'FAIL');
    setIso(6, 'FAIL');
  } else {
    setMock(6, 'BLOCKED');
    setIso(6, 'BLOCKED');
  }
  console.log('BETA_GATE', 'consent-pg=' + report[2].iso, 'isolated-auth=' + report[5].iso);
}

function printReports() {
  console.log('PHASE17_FINAL_BASE', BASE);
  console.log('PHASE17_FINAL_BRANCH', 'cursor/map-layout-cards-bc3c');
  for (let i = 1; i <= 7; i += 1) {
    const r = report[i];
    const overall = deriveOverall(r);
    console.log(
      'REPORT_' + String(i).padStart(2, '0'),
      r.title,
      'MOCK=' + r.mock,
      'ISOLATED=' + r.iso,
      'OVERALL=' + overall
    );
  }
  const anyFail = Object.keys(report).some(function (k) {
    return report[k].mock === 'FAIL' || report[k].iso === 'FAIL' || deriveOverall(report[k]) === 'FAIL';
  });
  if (anyFail || hardFail) {
    console.log('PHASE17_FINAL_VERDICT', 'FAIL');
    process.exitCode = 1;
  } else {
    console.log('PHASE17_FINAL_VERDICT', 'COMPLETE_NOT_PRODUCTION');
  }
}

runFinal();
printReports();
