#!/usr/bin/env node
'use strict';

/**
 * Daily Issue pg client TLS.
 * supabase.com 은 인증서 검증 실패 시 거부한다.
 * 로컬 Postgres 는 connectionString 경로를 유지한다.
 * 아래 PFX 는 테스트 전용 자체 서명 인증서다. 운영 CA 가 아니다.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const {
  buildDailyIssuePgSsl,
  createDailyIssuePgExecutor,
} = require('../server/daily-issue-pg-client');
const { writeTempTestCa } = require('./lib/temp-test-ca');

const tempCa = writeTempTestCa();
process.env.DAILY_ISSUE_PG_SSL_CA_FILE = tempCa.path;

const SUPABASE_URL = 'postgresql://user:do-not-print@db.example.supabase.com:5432/postgres?sslmode=no-verify';
const LOCAL_URL = 'postgresql://user:do-not-print@127.0.0.1:5432/postgres';
const PASSPHRASE = 'test-only';
const PFX_BASE64 = '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';

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

function capturePool(url, extra) {
  let seen = null;
  function CapturePool(cfg) {
    seen = cfg;
    this.end = function () { return Promise.resolve(); };
    this.query = function () { return Promise.resolve({ rows: [] }); };
  }
  const exec = createDailyIssuePgExecutor(Object.assign({
    databaseUrl: url,
    Pool: CapturePool,
  }, extra || {}));
  return { exec: exec, config: seen };
}

const productSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'daily-issue-pg-client.js'), 'utf8');
ok('1. 제품 코드에 rejectUnauthorized false 없음', !/rejectUnauthorized\s*:\s*false/.test(productSrc));

const forced = buildDailyIssuePgSsl(SUPABASE_URL, { ssl: { rejectUnauthorized: false, ca: 'KEEP' } });
ok(
  '2. supabase.com 은 검증 강제',
  forced &&
    forced.rejectUnauthorized === true &&
    String(forced.ca).indexOf('BEGIN CERTIFICATE') >= 0 &&
    String(forced.ca).indexOf('KEEP') < 0,
);
ok('3. ssl false 로 supabase.com 검증을 끄지 못함', buildDailyIssuePgSsl(SUPABASE_URL, { ssl: false }).rejectUnauthorized === true);

const supabasePool = capturePool(SUPABASE_URL);
ok('4. supabase.com Pool 이 검증 옵션을 받음', supabasePool.exec.ok === true && supabasePool.config.ssl.rejectUnauthorized === true);
ok('5. sslmode=no-verify 연결 문자열이 검증을 덮어쓰지 않음', supabasePool.config.connectionString == null && supabasePool.config.host === 'db.example.supabase.com');
ok('6. 로컬 Postgres 는 connectionString 유지', (function () {
  const local = capturePool(LOCAL_URL);
  return local.exec.ok === true && local.config.connectionString === LOCAL_URL && local.config.ssl == null;
})());
ok('7. 로컬 명시 ssl 객체는 유지', (function () {
  const local = capturePool(LOCAL_URL, { ssl: { rejectUnauthorized: true } });
  return local.config.ssl && local.config.ssl.rejectUnauthorized === true && local.config.connectionString === LOCAL_URL;
})());

const savedCa = process.env.DAILY_ISSUE_PG_SSL_CA_FILE;
delete process.env.DAILY_ISSUE_PG_SSL_CA_FILE;
let missingThrew = false;
let poolBuilds = 0;
try {
  buildDailyIssuePgSsl(SUPABASE_URL, { ssl: { rejectUnauthorized: false, ca: 'KEEP' } });
} catch (e) {
  missingThrew = e && e.code === 'SSL_CA_REQUIRED';
}
const missingExec = createDailyIssuePgExecutor({
  databaseUrl: SUPABASE_URL,
  Pool: function () {
    poolBuilds += 1;
    this.end = function () { return Promise.resolve(); };
  },
});
ok('10. CA 환경변수가 없으면 접속 전에 실패', missingThrew && missingExec.ok === false && poolBuilds === 0);
process.env.DAILY_ISSUE_PG_SSL_CA_FILE = path.join(__dirname, 'missing-daily-issue-ca.crt');
let unreadable = false;
try {
  buildDailyIssuePgSsl(SUPABASE_URL, {});
} catch (e) {
  unreadable = e && e.code === 'SSL_CA_FILE_UNREADABLE';
}
ok('11. CA 경로를 읽지 못하면 실패', unreadable);
fs.writeFileSync(tempCa.path + '.invalid', 'not-a-certificate\n', 'utf8');
process.env.DAILY_ISSUE_PG_SSL_CA_FILE = tempCa.path + '.invalid';
let invalid = false;
try {
  buildDailyIssuePgSsl(SUPABASE_URL, {});
} catch (e) {
  invalid = e && e.code === 'SSL_CA_FILE_INVALID';
}
ok('12. CA 형식이 아니면 실패', invalid);
process.env.DAILY_ISSUE_PG_SSL_CA_FILE = '"' + savedCa + '"';
const quoted = buildDailyIssuePgSsl(SUPABASE_URL, {});
ok('13. 따옴표 경로는 같은 CA를 읽음', quoted && String(quoted.ca).indexOf('BEGIN CERTIFICATE') >= 0 && quoted.rejectUnauthorized === true);
process.env.DAILY_ISSUE_PG_SSL_CA_FILE = savedCa;
try { fs.unlinkSync(tempCa.path + '.invalid'); } catch (_) { /* ignore */ }

function listen(options) {
  return new Promise(function (resolve, reject) {
    const server = tls.createServer(options, function (socket) {
      socket.end();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

function connectTls(port, ssl) {
  return new Promise(function (resolve) {
    let settled = false;
    const socket = tls.connect(Object.assign({
      host: '127.0.0.1',
      port: port,
      servername: 'db.example.supabase.com',
    }, ssl), function () {
      if (settled) return;
      settled = true;
      const result = { event: 'secure', authorized: socket.authorized, authorizationError: socket.authorizationError ? String(socket.authorizationError) : '' };
      socket.end();
      resolve(result);
    });
    socket.once('error', function (err) {
      if (settled) return;
      settled = true;
      resolve({ event: 'error', code: err && err.code ? err.code : '', message: String(err && err.message ? err.message : err) });
    });
  });
}

(async function () {
  const server = await listen({
    pfx: Buffer.from(PFX_BASE64, 'base64'),
    passphrase: PASSPHRASE,
  });
  try {
    const port = server.address().port;
    const rejected = await connectTls(port, supabasePool.config.ssl);
    const certError = rejected.event === 'error' && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|certificate/i.test(rejected.code + ' ' + rejected.message);
    ok('8. supabase.com 검증 실패 시 연결 거부', certError);

    const control = await connectTls(port, { rejectUnauthorized: false });
    ok('9. 같은 서버는 검증을 끄면 TLS 가 성립', control.event === 'secure');
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
  console.log('\nOK', passed);
  tempCa.cleanup();
})().catch(function (err) {
  tempCa.cleanup();
  console.error('FAIL', err && err.message ? err.message : err);
  process.exit(1);
});
