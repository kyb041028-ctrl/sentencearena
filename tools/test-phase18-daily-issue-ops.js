#!/usr/bin/env node
'use strict';

/**
 * Phase 18 — Daily Issue 운영·스케줄·검수·KR/US (MOCK/ISOLATED, LIVE OpenAI 금지).
 * 보고 1~15. exit 0/2만으로 전체 PASS 금지.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const BASE = 'a7d90a7';

const reports = {};
for (let i = 1; i <= 15; i += 1) {
  reports[i] = {
    title: '',
    impl: 'NOT_ASSESSED',
    verified: 'NOT_VERIFIED',
    mock: 'NOT_TESTED',
    iso: 'NOT_TESTED',
  };
}

const titles = {
  1: 'KR/US 수집·상태·공개 분리',
  2: 'READY 0 실행별 원인 기록',
  3: '독립출처·근거·발행판정(가짜 READY 금지)',
  4: '클러스터·중복·사건 혼합 구분',
  5: '장애 알림·감사(실발송 없음)',
  6: 'KR/US 자동발행 기본 OFF·독립',
  7: '한국 아침·미국 ET 회차·DST',
  8: '정정·숨김·재공개·버전',
  9: 'KR/US AI 비용 상한(모의)',
  10: '관리자 데이터 공개 API 미노출',
  11: 'ops-service·예약·버전',
  12: 'review-service·검수 흐름',
  13: '스케줄 저장·동시 실행·재시도',
  14: '격리 DB 스케줄·발행 원자성',
  15: 'forceAutoPublish·운영 우회 차단',
};
Object.keys(titles).forEach(function (k) {
  reports[Number(k)].title = titles[k];
});

let hardFail = 0;

function bumpFail() {
  hardFail += 1;
}

function setMock(n, v) {
  reports[n].mock = v;
}

function setVerified(n, v) {
  reports[n].verified = v;
}

function setImpl(n, v) {
  reports[n].impl = v;
}

function setIso(n, v) {
  reports[n].iso = v;
}

function syncImplVerified(n, mockVal) {
  setMock(n, mockVal);
  if (mockVal === 'MOCK PASS') {
    setVerified(n, 'VERIFIED');
    setImpl(n, 'IMPLEMENTED');
  } else if (mockVal === 'FAIL') {
    setVerified(n, 'FAIL');
    setImpl(n, 'IMPLEMENTED');
    bumpFail();
  }
}

function runTool(rel, envExtra) {
  const res = spawnSync(NODE, [path.join(ROOT, rel)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, envExtra || {}),
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || ''), signal: res.signal };
}

function spawnRequired(label, rel, envExtra, onDone) {
  const r = runTool(rel, envExtra);
  if (r.signal) {
    console.log('SPAWN_SIGNAL', label, r.signal);
    bumpFail();
    if (onDone) onDone(r.out, 'FAIL');
    return 'FAIL';
  }
  if (onDone) onDone(r.out, r.code);
  if (r.code === 0) {
    console.log('SPAWN_OK', label);
    return 'PASS';
  }
  console.log('SPAWN_FAIL', label, 'exit', r.code);
  bumpFail();
  return 'FAIL';
}

function overall(r) {
  if (r.mock === 'FAIL' || r.iso === 'FAIL') return 'FAIL';
  if (r.iso === 'ISOLATED DB PASS') return 'ISOLATED DB PASS';
  if (r.mock === 'MOCK PASS') return 'MOCK PASS';
  if (r.mock === 'BLOCKED' || r.iso === 'BLOCKED') return 'BLOCKED';
  return r.mock === 'NOT_TESTED' && r.iso === 'NOT_TESTED' ? 'NOT_TESTED' : r.iso !== 'NOT_TESTED' ? r.iso : r.mock;
}

function staticForceAutoPublishGuard() {
  const r = runTool('tools/test-phase19-daily-issue-halt-runtime.js', {});
  const runtimeOk = r.code === 0 && r.out.indexOf('PHASE19_HALT_VERDICT PASS') >= 0;
  if (runtimeOk) {
    syncImplVerified(15, 'MOCK PASS');
    console.log('CHECK_OK forceAutoPublish runtime halt test');
  } else {
    syncImplVerified(15, 'FAIL');
  }
}

function main() {
  console.log('PHASE18_BASE', BASE);
  console.log('LIVE_OPENAI', 'FORBIDDEN_THIS_PHASE');

  spawnRequired('us-ops', 'tools/test-daily-issue-us-ops.js', {}, function (out, code) {
    const ok = code === 0 && out.indexOf('US_DAILY_ISSUE_LOCAL_OK') >= 0;
    const v = ok ? 'MOCK PASS' : 'FAIL';
    syncImplVerified(1, v);
    syncImplVerified(5, v);
    if (ok) {
      syncImplVerified(6, reports[6].mock === 'FAIL' ? 'FAIL' : 'MOCK PASS');
    } else {
      syncImplVerified(6, 'FAIL');
    }
    syncImplVerified(7, v);
    syncImplVerified(8, v);
  });

  spawnRequired('ready-zero-mock', 'tools/test-phase18-ready-zero-mock.js', {}, function (out, code) {
    syncImplVerified(2, code === 0 && out.indexOf('PHASE18_READY_ZERO_OK') >= 0 ? 'MOCK PASS' : 'FAIL');
  });

  spawnRequired('us-phase13', 'tools/test-daily-issue-us-phase13-publication.js', {}, function (out, code) {
    const ok = code === 0 && out.indexOf('PHASE13_OK') >= 0;
    syncImplVerified(3, ok ? 'MOCK PASS' : 'FAIL');
    syncImplVerified(4, ok ? 'MOCK PASS' : 'FAIL');
  });

  spawnRequired('ops-workflow', 'tools/test-daily-issue-ops-workflow.js', {}, function (out, code) {
    const ok = code === 0 && out.indexOf('failed=0') >= 0;
    syncImplVerified(8, reports[8].mock === 'FAIL' ? 'FAIL' : ok ? 'MOCK PASS' : 'FAIL');
    syncImplVerified(11, ok ? 'MOCK PASS' : 'FAIL');
  });

  spawnRequired('morning-scheduler', 'tools/test-daily-issue-morning-scheduler.js', {}, function (out, code) {
    const ok = code === 0 && /,\s*0 failed/.test(out);
    syncImplVerified(6, reports[6].mock === 'FAIL' ? 'FAIL' : ok ? 'MOCK PASS' : 'FAIL');
    syncImplVerified(7, ok ? 'MOCK PASS' : 'FAIL');
    syncImplVerified(13, ok ? 'MOCK PASS' : 'FAIL');
  });

  spawnRequired('ai-cost-mock', 'tools/test-phase18-ai-cost-mock.js', {}, function (out, code) {
    syncImplVerified(9, code === 0 && out.indexOf('PHASE18_AI_COST_MOCK_OK') >= 0 ? 'MOCK PASS' : 'FAIL');
  });

  spawnRequired('public-api', 'tools/test-daily-issue-public-api.js', {}, function (out, code) {
    syncImplVerified(10, code === 0 && /0 failed/.test(out) ? 'MOCK PASS' : 'FAIL');
  });

  spawnRequired('review-system', 'tools/test-daily-issue-review-system.js', {}, function (out, code) {
    syncImplVerified(12, code === 0 && /,\s*0 failed/.test(out) ? 'MOCK PASS' : 'FAIL');
  });

  setIso(14, 'NOT_TESTED');
  setImpl(14, 'IMPLEMENTED');
  setVerified(14, 'NOT_VERIFIED');
  console.log('ISO_SKIP', 'morning-scheduler-pg-smoke', 'requires isolated DAILY_ISSUE DB URL; not run in phase18');

  staticForceAutoPublishGuard();

  for (let i = 1; i <= 15; i += 1) {
    const r = reports[i];
    console.log(
      'REPORT_' + String(i).padStart(2, '0'),
      r.title,
      'IMPL=' + r.impl,
      'VERIFIED=' + r.verified,
      'MOCK=' + r.mock,
      'ISOLATED=' + r.iso,
      'OVERALL=' + overall(r)
    );
  }

  const anyFail = Object.keys(reports).some(function (k) {
    return overall(reports[k]) === 'FAIL';
  });
  if (anyFail || hardFail) {
    console.log('PHASE18_VERDICT', 'FAIL');
    process.exitCode = 1;
  } else {
    console.log('PHASE18_VERDICT', 'COMPLETE_NOT_PRODUCTION');
  }
}

main();
