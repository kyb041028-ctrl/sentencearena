#!/usr/bin/env node
'use strict';

/**
 * Phase 19 step 1 — Daily Issue 격리 DB·운영 검증 (보고 1~13).
 * 15~18 PASS 대형 재실행 금지. exit 0 SKIP ≠ PASS. REAL AUTH·LIVE AI = BLOCKED 유지.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const BASE = 'e66cabf';

const reports = {};
for (let i = 1; i <= 13; i += 1) {
  reports[i] = {
    title: '',
    impl: 'NOT_ASSESSED',
    verified: 'NOT_VERIFIED',
    mock: 'NOT_TESTED',
    iso: 'NOT_TESTED',
  };
}

const titles = {
  1: 'Daily Issue 격리 DB 부트·127.0.0.1·스키마 거부',
  2: '격리 DB 기사·run 이력 저장·재조회',
  3: 'KR/US/both 자동발행 중지·force 우회(함수)',
  4: 'READY vs AUTO_PUBLISH_ELIGIBLE·Fed+NPR·클러스터',
  5: '격리 DB 발행·숨김·다른국가 무영향',
  6: '승인 RSS 무료 진단(네트워크)',
  7: 'phase18 orchestrator impl/verified 분리',
  8: 'morning-scheduler-pg-smoke(embedded)',
  9: 'publication-decision-pg-smoke(embedded)',
  10: '격리 URL 거부 단위',
  11: '15~18 PASS 재실행',
  12: 'REAL Supabase Auth',
  13: 'LIVE OpenAI / 실 AI',
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

function setIso(n, v) {
  reports[n].iso = v;
}

function setVerified(n, v) {
  reports[n].verified = v;
}

function setImpl(n, v) {
  reports[n].impl = v;
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

function spawnChild(label, rel, envExtra, onDone) {
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
  if (r.code === 2) {
    console.log('SPAWN_BLOCKED_OR_SKIPPED', label);
    return r.out.indexOf('SKIPPED') >= 0 ? 'SKIPPED' : 'BLOCKED';
  }
  console.log('SPAWN_FAIL', label, 'exit', r.code);
  bumpFail();
  return 'FAIL';
}

function overall(r) {
  if (r.mock === 'FAIL' || r.iso === 'FAIL') return 'FAIL';
  if (r.iso === 'ISOLATED DB PASS') return 'ISOLATED DB PASS';
  if (r.mock === 'MOCK PASS') return 'MOCK PASS';
  if (r.mock === 'BLOCKED' || r.iso === 'BLOCKED' || r.mock === 'SKIPPED' || r.iso === 'SKIPPED') {
    return r.iso === 'SKIPPED' || r.mock === 'SKIPPED' ? 'SKIPPED' : 'BLOCKED';
  }
  return 'NOT_TESTED';
}

function staticTargetGate() {
  const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');
  const bad = assertDailyIssueIsolatedTarget('postgresql://postgres:pw@db.supabase.co:5432/postgres', 'daily_issue_test');
  const good = assertDailyIssueIsolatedTarget('postgresql://postgres:password@127.0.0.1:55440/daily_issue_isolated_x', 'daily_issue_test');
  if (bad.ok === false && good.ok === true) {
    setMock(10, 'MOCK PASS');
    setVerified(10, 'VERIFIED');
    setImpl(10, 'IMPLEMENTED');
  } else {
    setMock(10, 'FAIL');
    bumpFail();
  }
}

function auditPhase18Orchestrator() {
  const src = fs.readFileSync(path.join(ROOT, 'tools/test-phase18-daily-issue-ops.js'), 'utf8');
  const ok = /verified:\s*'NOT_VERIFIED'/.test(src) && /IMPL=/.test(src) && !/IMPLEMENTED=' \+ r\.impl/.test(src);
  if (ok) {
    setImpl(7, 'IMPLEMENTED');
    setVerified(7, 'VERIFIED');
    setMock(7, 'MOCK PASS');
    console.log('CHECK_OK phase18 impl/verified separated');
  } else {
    setImpl(7, 'STRUCTURE_DEBT');
    setVerified(7, 'FAIL');
    setMock(7, 'FAIL');
    bumpFail();
  }
}

function runEmbeddedChild(label, childRel, onDone) {
  const child = spawnSync(
    NODE,
    [path.join(ROOT, 'tools/test-daily-issue-pg-embedded-isolated.js'), childRel],
    { cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 },
  );
  const out = (child.stdout || '') + (child.stderr || '');
  process.stdout.write(child.stdout || '');
  if (onDone) onDone(out, child.status);
  return child.status;
}

function main() {
  console.log('PHASE19_STEP1_BASE', BASE);
  console.log('SKIP_RERUN', 'phase15-18 full suites not re-run');

  staticTargetGate();

  runEmbeddedChild('morning-smoke', 'tools/test-daily-issue-morning-scheduler-pg-smoke.js', function (out, code) {
    if (code === 0 && out.indexOf('PG_SMOKE_VERDICT PASS') >= 0) {
      setIso(1, 'ISOLATED DB PASS');
      setIso(8, 'ISOLATED DB PASS');
      setVerified(1, 'VERIFIED');
      setVerified(8, 'VERIFIED');
      setImpl(1, 'IMPLEMENTED');
      setImpl(8, 'IMPLEMENTED');
    } else if (code === 2) {
      setIso(1, 'BLOCKED');
      setIso(8, 'BLOCKED');
    } else {
      setIso(1, 'FAIL');
      setIso(8, 'FAIL');
      bumpFail();
    }
  });

  runEmbeddedChild('iso-persist', 'tools/test-phase19-daily-issue-isolated-persistence.js', function (out, code) {
    if (code === 0 && out.indexOf('PHASE19_ISO_PERSIST_VERDICT PASS') >= 0) {
      setIso(2, 'ISOLATED DB PASS');
      setVerified(2, 'VERIFIED');
      setImpl(2, 'IMPLEMENTED');
    } else if (code === 2) {
      setIso(2, 'BLOCKED');
    } else {
      setIso(2, 'FAIL');
      bumpFail();
    }
  });

  spawnChild('halt-runtime', 'tools/test-phase19-daily-issue-halt-runtime.js', {}, function (out, code) {
    const ok = code === 0 && out.indexOf('PHASE19_HALT_VERDICT PASS') >= 0;
    setMock(3, ok ? 'MOCK PASS' : 'FAIL');
    setVerified(3, ok ? 'VERIFIED' : 'FAIL');
    setImpl(3, 'IMPLEMENTED');
    if (!ok) bumpFail();
  });

  spawnChild('decision-ready', 'tools/test-phase19-daily-issue-decision-ready.js', {}, function (out, code) {
    const ok = code === 0 && out.indexOf('PHASE19_DECISION_VERDICT PASS') >= 0;
    setMock(4, ok ? 'MOCK PASS' : 'FAIL');
    setVerified(4, ok ? 'VERIFIED' : 'FAIL');
    setImpl(4, 'IMPLEMENTED');
    if (!ok) bumpFail();
  });

  runEmbeddedChild('lifecycle-pg', 'tools/test-phase19-daily-issue-lifecycle-pg.js', function (out, code) {
    if (code === 0 && out.indexOf('PHASE19_LIFECYCLE_VERDICT PASS') >= 0) {
      setIso(5, 'ISOLATED DB PASS');
      setVerified(5, 'VERIFIED');
      setImpl(5, 'IMPLEMENTED');
    } else if (code === 2) {
      setIso(5, 'BLOCKED');
    } else {
      setIso(5, 'FAIL');
      bumpFail();
    }
  });

  spawnChild('rss-free', 'tools/test-phase19-daily-issue-rss-free.js', {}, function (out, code) {
    if (code === 0 && out.indexOf('PHASE19_RSS_VERDICT PASS') >= 0) {
      setMock(6, 'MOCK PASS');
      setVerified(6, 'VERIFIED');
    } else if (code === 2) {
      setMock(6, 'BLOCKED');
      setVerified(6, 'NOT_VERIFIED');
    } else {
      setMock(6, 'FAIL');
      bumpFail();
    }
    setImpl(6, 'IMPLEMENTED');
  });

  auditPhase18Orchestrator();

  runEmbeddedChild('pubdec-smoke', 'tools/test-daily-issue-publication-decision-pg-smoke.js', function (out, code) {
    if (code === 0 && out.indexOf('PUBDEC_PG_VERDICT PASS') >= 0) {
      setIso(9, 'ISOLATED DB PASS');
      setVerified(9, 'VERIFIED');
      setImpl(9, 'IMPLEMENTED');
    } else if (code === 2) {
      setIso(9, 'BLOCKED');
    } else if (code !== 0) {
      setIso(9, 'FAIL');
      bumpFail();
    }
  });

  setMock(11, 'SKIP_RERUN');
  setVerified(11, 'NOT_APPLICABLE');
  setImpl(11, 'IMPLEMENTED');

  setMock(12, 'BLOCKED');
  setIso(12, 'BLOCKED');
  setVerified(12, 'NOT_VERIFIED');
  setImpl(12, 'IMPLEMENTED');
  console.log('REAL_AUTH', 'BLOCKED pre-beta');

  setMock(13, 'BLOCKED');
  setIso(13, 'BLOCKED');
  setVerified(13, 'NOT_VERIFIED');
  setImpl(13, 'IMPLEMENTED');
  console.log('LIVE_AI', 'BLOCKED pre-beta');

  for (let i = 1; i <= 13; i += 1) {
    const r = reports[i];
    console.log(
      'REPORT_' + String(i).padStart(2, '0'),
      r.title,
      'IMPL=' + r.impl,
      'VERIFIED=' + r.verified,
      'MOCK=' + r.mock,
      'ISOLATED=' + r.iso,
      'OVERALL=' + overall(r),
    );
  }

  const anyFail = Object.keys(reports).some(function (k) {
    return overall(reports[k]) === 'FAIL';
  });
  if (anyFail || hardFail) {
    console.log('PHASE19_STEP1_VERDICT', 'FAIL');
    process.exitCode = 1;
  } else {
    console.log('PHASE19_STEP1_VERDICT', 'COMPLETE_NOT_PRODUCTION');
  }
}

main();
