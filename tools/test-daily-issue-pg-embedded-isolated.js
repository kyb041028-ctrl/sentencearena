#!/usr/bin/env node
'use strict';

/**
 * embedded-postgres로 Daily Issue 격리 DB만 띄운 뒤 자식 스크립트 실행.
 * DAILY_ISSUE_DATABASE_URL은 이 프로세스·자식에만 전달. 종료 후 클러스터 정리.
 *
 * Usage: node tools/test-daily-issue-pg-embedded-isolated.js tools/test-daily-issue-morning-scheduler-pg-smoke.js
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { bootDailyIssueIsolated } = require('./lib/daily-issue-isolated-embedded-pg');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const childRel = process.argv[2] || 'tools/test-daily-issue-morning-scheduler-pg-smoke.js';

async function main() {
  const boot = await bootDailyIssueIsolated({});
  if (!boot.ok) {
    console.log('DAILY_ISSUE_EMBEDDED', 'BLOCKED', boot.reason || 'boot-failed');
    process.exitCode = 2;
    return;
  }

  const childEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: 'test',
    DAILY_ISSUE_DATABASE_URL: boot.url,
    DAILY_ISSUE_DB_SCHEMA: boot.schemaName,
  };

  console.log('DAILY_ISSUE_EMBEDDED', 'RUN', childRel);
  const res = spawnSync(NODE, [path.join(ROOT, childRel)], {
    cwd: ROOT,
    env: childEnv,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });

  await boot.shutdown();

  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');

  if (res.signal) {
    console.log('DAILY_ISSUE_EMBEDDED', 'FAIL', 'signal', res.signal);
    process.exitCode = 1;
    return;
  }

  const out = (res.stdout || '') + (res.stderr || '');
  if (res.status === 0 && out.indexOf('_VERDICT PASS') >= 0) {
    console.log('DAILY_ISSUE_EMBEDDED', 'ISOLATED DB PASS');
    return;
  }
  if (res.status === 2 || out.indexOf('_VERDICT SKIPPED') >= 0) {
    console.log('DAILY_ISSUE_EMBEDDED', 'SKIPPED');
    process.exitCode = 2;
    return;
  }
  console.log('DAILY_ISSUE_EMBEDDED', 'FAIL', 'exit', res.status);
  process.exitCode = res.status === 0 ? 1 : res.status;
}

main().catch(function (err) {
  console.log('DAILY_ISSUE_EMBEDDED', 'FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
