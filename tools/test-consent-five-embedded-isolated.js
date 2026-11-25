#!/usr/bin/env node
'use strict';

/**
 * embedded-postgres로 consent_isolated만 띄운 뒤 test-consent-five-sql-integration.js 실행.
 * CONSENT_ISOLATED_DATABASE_URL은 이 프로세스·자식에만 전달. 종료 후 클러스터 정리.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { bootConsentIsolated } = require('./lib/consent-isolated-embedded-pg');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

async function main() {
  const boot = await bootConsentIsolated({});
  if (!boot.ok) {
    console.log('CONSENT_EMBEDDED', 'BLOCKED', boot.reason || 'boot-failed');
    process.exitCode = 2;
    return;
  }

  const childEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    CONSENT_ISOLATED_DATABASE_URL: boot.url,
  };

  console.log('CONSENT_EMBEDDED', 'RUN', 'tools/test-consent-five-sql-integration.js');
  const res = spawnSync(NODE, [path.join(ROOT, 'tools/test-consent-five-sql-integration.js')], {
    cwd: ROOT,
    env: childEnv,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 24 * 1024 * 1024,
  });

  await boot.stop();

  const out = (res.stdout || '') + (res.stderr || '');
  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');

  if (res.signal) {
    console.log('CONSENT_EMBEDDED', 'FAIL', 'signal', res.signal);
    process.exitCode = 1;
    return;
  }

  if (out.indexOf('RESULT: PASS') >= 0 && res.status === 0) {
    console.log('CONSENT_EMBEDDED', 'ISOLATED DB PASS');
    return;
  }
  if (out.indexOf('UNVERIFIED') >= 0) {
    console.log('CONSENT_EMBEDDED', 'BLOCKED', 'integration-unverified');
    process.exitCode = 2;
    return;
  }
  console.log('CONSENT_EMBEDDED', 'FAIL', 'exit', res.status);
  process.exitCode = 1;
}

main().catch(function (err) {
  console.log('CONSENT_EMBEDDED', 'FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
