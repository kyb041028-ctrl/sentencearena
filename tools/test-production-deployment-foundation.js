#!/usr/bin/env node
'use strict';
/**
 * Production deployment foundation — boot/config/static/secret scan.
 * Does not deploy Railway, write production DB, or print secrets.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const { evaluateProductionBootGuards, CANONICAL_PRODUCTION_PUBLIC_ORIGIN } = require('../server/production-boot-guards');
const { resolveCorsAllowlist, isOriginAllowed } = require('../server/http-cors-config');
const teardown = require('./test-process-teardown');

const root = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log('  PASS: ' + label);
    pass += 1;
  } else {
    console.log('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail += 1;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', function () {
      const port = s.address().port;
      s.close(function () {
        resolve(port);
      });
    });
    s.on('error', reject);
  });
}

function httpGet(port, urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: urlPath,
        method: 'GET',
      },
      function (res) {
        const chunks = [];
        res.on('data', function (c) {
          chunks.push(c);
        });
        res.on('end', function () {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, function () {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

function spawnServer(envExtra) {
  const env = Object.assign({}, process.env, envExtra || {});
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', function (d) {
    out += String(d);
  });
  child.stderr.on('data', function (d) {
    out += String(d);
  });
  child.collected = function () {
    return out;
  };
  return child;
}

function waitFor(child, pattern, ms) {
  const deadline = Date.now() + ms;
  return new Promise(function (resolve, reject) {
    function tick() {
      if (pattern.test(child.collected())) return resolve(true);
      if (child.exitCode != null) return resolve(false);
      if (Date.now() > deadline) return reject(new Error('wait timeout'));
      setTimeout(tick, 80);
    }
    tick();
  });
}

function stopChild(child) {
  return new Promise(function (resolve) {
    if (!child || child.exitCode != null) return resolve();
    child.once('exit', function () {
      resolve();
    });
    try {
      child.kill();
    } catch (_) {}
    setTimeout(function () {
      if (child.exitCode == null) {
        try {
          child.kill('SIGKILL');
        } catch (_) {}
      }
    }, 2000);
  });
}

function productionSimEnv(port) {
  return {
    NODE_ENV: 'production',
    APP_PUBLIC_ORIGIN: CANONICAL_PRODUCTION_PUBLIC_ORIGIN,
    BOARD_OPERATIONAL: 'true',
    TERRITORY_EVOLUTION_OPERATIONAL: 'true',
    DAILY_ISSUE_REPOSITORY: 'db',
    DAILY_ISSUE_DB_SCHEMA: 'daily_issue',
    DAILY_ISSUE_DATABASE_URL: '',
    DAILY_ISSUE_MORNING_SCHEDULER_ENABLED: '0',
    POLITICAL_ALIGNMENT_SCHEDULER_ENABLED: 'false',
    ALIEN_MODERATION_V1: 'false',
    BOARD_DEV_MEMORY: '',
    OPEN_BROWSER: '',
    ALIGNMENT_LIVE_VERIFY: '',
    DAILY_ISSUE_ALLOW_TEST_RESET: '',
    DAILY_ISSUE_APPLY_MIGRATION_IN_TEST: '',
    DAILY_ISSUE_ADMIN_API_TOKEN: '',
    ALIEN_MODERATION_ADMIN_BYPASS: '',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    PORT: String(port),
    HOST: '127.0.0.1',
  };
}

(async function main() {
  const pkg = JSON.parse(read('package.json'));
  const serverSrc = read('server.js');
  const envEx = read('.env.production.example');
  const railway = JSON.parse(read('railway.json'));
  const nix = read('nixpacks.toml');

  ok('engines node 22.x', pkg.engines && pkg.engines.node === '22.x');
  ok('npm start', pkg.scripts && pkg.scripts.start === 'node server.js');
  ok('HOST default 0.0.0.0', /HOST \|\| '0\.0\.0\.0'/.test(serverSrc));
  ok('PORT from env', /process\.env\.PORT/.test(serverSrc));
  ok('GET /health', /app\.get\(\s*'\/health'/.test(serverSrc));
  ok('GET /ready', /app\.get\(\s*'\/ready'/.test(serverSrc));
  ok('health no DB query in handler', !/app\.get\(\s*'\/health'[\s\S]{0,400}createDailyIssuePgExecutor/.test(serverSrc));
  ok('canonical origin https://sentencearena.com', CANONICAL_PRODUCTION_PUBLIC_ORIGIN === 'https://sentencearena.com');
  ok('example APP_PUBLIC_ORIGIN canonical', /APP_PUBLIC_ORIGIN=https:\/\/sentencearena\.com/.test(envEx));
  ok('example BOARD_OPERATIONAL=true', /BOARD_OPERATIONAL=true/.test(envEx));
  ok('example TERRITORY_EVOLUTION_OPERATIONAL=true', /TERRITORY_EVOLUTION_OPERATIONAL=true/.test(envEx));
  ok('example political scheduler false', /POLITICAL_ALIGNMENT_SCHEDULER_ENABLED=false/.test(envEx));
  ok('example alien false', /ALIEN_MODERATION_V1=false/.test(envEx));
  ok('example morning scheduler 0', /DAILY_ISSUE_MORNING_SCHEDULER_ENABLED=0/.test(envEx));
  ok('example schema daily_issue', /^DAILY_ISSUE_DB_SCHEMA=daily_issue$/m.test(envEx));
  ok('example no real secret values', !/eyJ[A-Za-z0-9_-]{40,}/.test(envEx) && !/postgres:\/\/[^:]+:[^@]+@/.test(envEx));
  ok('railway nixpacks + npm start + /health', railway.build && railway.build.builder === 'NIXPACKS' && railway.deploy.startCommand === 'npm start' && railway.deploy.healthcheckPath === '/health');
  ok('nixpacks node 22', /NIXPACKS_NODE_VERSION\s*=\s*"22"/.test(nix));
  ok('no Dockerfile', !fs.existsSync(path.join(root, 'Dockerfile')));
  ok('no Procfile', !fs.existsSync(path.join(root, 'Procfile')));

  const good = evaluateProductionBootGuards(productionSimEnv(3000));
  ok('production guards ok with canonical env', good.ok === true && good.skipped !== true);

  const testSchema = evaluateProductionBootGuards(
    Object.assign({}, productionSimEnv(3000), { DAILY_ISSUE_DB_SCHEMA: 'daily_issue_test' }),
  );
  ok('daily_issue_test fail-fast', !testSchema.ok);

  const localOrigin = evaluateProductionBootGuards(
    Object.assign({}, productionSimEnv(3000), { APP_PUBLIC_ORIGIN: 'http://localhost:3000' }),
  );
  ok('localhost origin fail-fast', !localOrigin.ok);

  ok(
    'production CORS allows sentencearena.com',
    isOriginAllowed('https://sentencearena.com', productionSimEnv(3000)),
  );
  ok(
    'production CORS denies localhost',
    !isOriginAllowed('http://localhost:3000', productionSimEnv(3000)),
  );
  ok(
    'production CORS no wildcard list',
    resolveCorsAllowlist(productionSimEnv(3000)).indexOf('*') < 0,
  );
  ok(
    'www not auto-added',
    resolveCorsAllowlist(productionSimEnv(3000)).indexOf('https://www.sentencearena.com') < 0,
  );

  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  ok('.env not tracked', tracked.indexOf('.env') < 0);
  ok('.env.production not tracked', tracked.indexOf('.env.production') < 0);

  let secretHits = 0;
  tracked.forEach(function (rel) {
    if (/\.(png|jpg|jpeg|webp|gif|ico|woff2?|pdf|zip)$/i.test(rel)) return;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (_) {
      return;
    }
    if (/eyJ[A-Za-z0-9_-]{80,}\.[A-Za-z0-9_-]{20,}\./.test(text)) secretHits += 1;
    const pg = text.match(/postgres:\/\/[^:\s]+:[^@\s]+@([A-Za-z0-9._-]+)/i);
    if (pg && pg[1] && pg[1].indexOf('.') !== -1 && !/\.example\.|localhost|invalid/i.test(pg[1])) secretHits += 1;
  });
  ok('tracked files have no live JWT/DB password', secretHits === 0, 'hits=' + secretHits);

  const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  ok(
    'auth files not in this working diff',
    !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
      !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
      !/(^|\n)public\/auth-v2\//.test(authDiff),
  );

  let childFail = spawnServer(
    Object.assign({}, productionSimEnv(3991), { DAILY_ISSUE_DB_SCHEMA: 'daily_issue_test' }),
  );
  await new Promise(function (r) {
    childFail.once('exit', r);
    setTimeout(r, 8000);
  });
  ok(
    'NODE_ENV=production + daily_issue_test exits non-zero',
    childFail.exitCode === 1 && /PRODUCTION_SCHEMA_FORBIDDEN|boot-guard:fatal/.test(childFail.collected()),
  );
  await stopChild(childFail);

  const port = await freePort();
  const child = spawnServer(productionSimEnv(port));
  let listening = false;
  try {
    listening = await waitFor(child, /헬스|레디|센텐스아레나/, 15000);
  } catch (_) {
    listening = false;
  }
  ok('production-mode listen without production secrets', listening && child.exitCode == null, child.collected().slice(0, 240));

  if (listening && child.exitCode == null) {
    const health = await httpGet(port, '/health');
    let healthJson = {};
    try {
      healthJson = JSON.parse(health.body);
    } catch (_) {}
    ok('GET /health 200', health.status === 200 && healthJson.ok === true);
    ok(
      'GET /health does not leak secrets',
      !/eyJ[A-Za-z0-9_-]{20,}/.test(health.body) && !/SERVICE_ROLE/i.test(health.body),
    );

    const ready = await httpGet(port, '/ready');
    let readyJson = {};
    try {
      readyJson = JSON.parse(ready.body);
    } catch (_) {}
    ok('GET /ready not-ready is explicit 503', ready.status === 503 && readyJson.ok === false);
    ok(
      'GET /ready reports missing Daily Issue URL or supabase without hiding',
      readyJson.database &&
        (readyJson.database.error === 'DAILY_ISSUE_DATABASE_URL_MISSING' ||
          readyJson.database.error === 'DATABASE_UNAVAILABLE' ||
          readyJson.database.error === 'SCHEMA_NOT_PROVISIONED'),
    );
    ok('GET /ready nodeEnv production', readyJson.checks && readyJson.checks.nodeEnv === 'production');
    ok('GET /ready board operational', readyJson.checks && readyJson.checks.boardOperational === true);
    ok('GET /ready scheduler flags off', readyJson.checks && readyJson.checks.politicalSchedulerEnabled === false && readyJson.checks.alienModerationV1 === false && readyJson.checks.dailyIssueMorningSchedulerEnabled === false);
    ok(
      'GET /ready no secret values',
      !/eyJ[A-Za-z0-9_-]{20,}/.test(ready.body) && !/postgres:\/\//i.test(ready.body),
    );

    const index = await httpGet(port, '/');
    ok('GET / 200', index.status === 200 && /app-entry\.js|센텐스아레나/.test(index.body));
    const entryMatch = index.body.match(/src=["']([^"']*app-entry\.js)["']/);
    if (entryMatch) {
      const asset = await httpGet(port, entryMatch[1].indexOf('/') === 0 ? entryMatch[1] : '/' + entryMatch[1]);
      ok('app-entry.js asset 200', asset.status === 200 && asset.body.length > 20);
    } else {
      const asset = await httpGet(port, '/app-entry.js');
      ok('app-entry.js asset 200', asset.status === 200 && asset.body.length > 20);
    }
    const cb = await httpGet(port, '/auth-v2/callback.html');
    ok('GET /auth-v2/callback.html 200', cb.status === 200 && /finishOAuthCallback|callback/.test(cb.body));
  } else {
    ok('GET /health 200', false, 'server did not listen');
    ok('GET /ready not-ready is explicit 503', false);
    ok('GET / 200', false);
    ok('GET /auth-v2/callback.html 200', false);
  }

  await stopChild(child);

  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail);
})().catch(function (e) {
  console.error(e);
  return teardown.finishTest(fail || 1);
});
