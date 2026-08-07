#!/usr/bin/env node
'use strict';

/**
 * 서버 안정화 단위 테스트 — graceful shutdown · CORS · boot guards
 * 실제 배포/운영 migration/npm start 미실행
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const cors = require('cors');

const {
  resolveCorsAllowlist,
  isOriginAllowed,
  createExpressCorsOptions,
} = require('../server/http-cors-config');
const { evaluateProductionBootGuards } = require('../server/production-boot-guards');
const { createGracefulShutdown } = require('../server/graceful-shutdown');
const {
  closeAllDailyIssuePools,
  registerPool,
} = require('../server/daily-issue-pg-client');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

function prodEnv(extra) {
  return Object.assign(
    {
      NODE_ENV: 'production',
      DAILY_ISSUE_REPOSITORY: 'db',
      DAILY_ISSUE_DB_SCHEMA: 'daily_issue',
      DAILY_ISSUE_API_CORS_ORIGINS: 'https://app.example.com',
      APP_PUBLIC_ORIGIN: 'https://app.example.com',
    },
    extra || {},
  );
}

// --- CORS ---
ok(
  'production 허용 origin',
  isOriginAllowed('https://app.example.com', prodEnv()) === true,
);
ok(
  'production 비허용 origin 차단',
  isOriginAllowed('http://evil.test', prodEnv()) === false,
);
ok(
  'production localhost 자동 허용 없음',
  resolveCorsAllowlist(prodEnv()).indexOf('http://localhost:3000') < 0,
);
ok(
  'development localhost 유지',
  resolveCorsAllowlist({ NODE_ENV: 'development' }).indexOf('http://localhost:3000') >= 0,
);
ok('Origin 없음 허용', isOriginAllowed('', prodEnv()) === true);

// Express cors integration
(async function () {
  {
    const app = express();
    app.use(cors(createExpressCorsOptions(prodEnv())));
    app.get('/ping', function (req, res) {
      res.json({ ok: true });
    });
    const server = await new Promise(function (resolve) {
      const s = app.listen(0, function () {
        resolve(s);
      });
    });
    const port = server.address().port;

    function req(origin) {
      return new Promise(function (resolve, reject) {
        const r = http.request(
          {
            hostname: '127.0.0.1',
            port: port,
            path: '/ping',
            method: 'GET',
            headers: origin ? { Origin: origin } : {},
          },
          function (res) {
            let raw = '';
            res.on('data', function (c) {
              raw += c;
            });
            res.on('end', function () {
              resolve({ status: res.statusCode, headers: res.headers, raw: raw });
            });
          },
        );
        r.on('error', reject);
        r.end();
      });
    }

    const allowed = await req('https://app.example.com');
    ok(
      'express production 허용 ACAO',
      allowed.status === 200 &&
        allowed.headers['access-control-allow-origin'] === 'https://app.example.com',
    );

    const denied = await req('http://evil.test');
    ok(
      'express production 비허용 ACAO 없음',
      denied.status === 200 && !denied.headers['access-control-allow-origin'],
    );

    await new Promise(function (resolve) {
      server.close(resolve);
    });
  }

  // --- boot guards ---
  {
    const good = evaluateProductionBootGuards(prodEnv());
    ok('boot guards 정상', good.ok === true);

    const jsonFatal = evaluateProductionBootGuards(prodEnv({ DAILY_ISSUE_REPOSITORY: 'json' }));
    ok(
      'production JSON repository fail-closed',
      !jsonFatal.ok &&
        jsonFatal.fatal.some(function (f) {
          return f.code === 'PRODUCTION_JSON_REPOSITORY_FORBIDDEN';
        }),
    );

    const testSchema = evaluateProductionBootGuards(
      prodEnv({ DAILY_ISSUE_DB_SCHEMA: 'daily_issue_test' }),
    );
    ok('production test schema fail-closed', !testSchema.ok);

    const reset = evaluateProductionBootGuards(prodEnv({ DAILY_ISSUE_ALLOW_TEST_RESET: '1' }));
    ok('ALLOW_TEST_RESET fail-closed', !reset.ok);

    const ns = evaluateProductionBootGuards(
      prodEnv({ DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE: 'e2e' }),
    );
    ok('MORNING_RUN_KEY_NAMESPACE fail-closed', !ns.ok);

    const tokenWarn = evaluateProductionBootGuards(
      prodEnv({ DAILY_ISSUE_ADMIN_API_TOKEN: 'x' }),
    );
    ok(
      'ADMIN_API_TOKEN 경고',
      tokenWarn.ok &&
        tokenWarn.warnings.some(function (w) {
          return w.code === 'LEGACY_ADMIN_TOKEN_PRESENT';
        }),
    );

    const skipDev = evaluateProductionBootGuards({ NODE_ENV: 'development' });
    ok('development boot guards skipped', skipDev.skipped === true && skipDev.ok);
  }

  // --- graceful shutdown ---
  {
    let schedulerStopped = 0;
    let poolClosed = 0;
    const app = express();
    app.get('/x', function (req, res) {
      res.end('ok');
    });
    const server = await new Promise(function (resolve) {
      const s = app.listen(0, function () {
        resolve(s);
      });
    });

    const fakePool = {
      end: async function () {
        poolClosed += 1;
      },
    };
    registerPool(fakePool);

    let ticks = 0;
    const timer = setInterval(function () {
      ticks += 1;
    }, 20);
    const stopTimer = function () {
      clearInterval(timer);
      schedulerStopped += 1;
    };

    const ctrl = createGracefulShutdown({
      timeoutMs: 5000,
      exitProcess: false,
      server: server,
      stopScheduler: stopTimer,
      closePools: async function () {
        await closeAllDailyIssuePools();
      },
      logger: { log: function () {}, error: function () {} },
    });

    await new Promise(function (r) {
      setTimeout(r, 50);
    });
    const r1 = await ctrl.shutdown('SIGTERM');
    ok('SIGTERM 정상 종료', r1.ok === true && r1.duplicate !== true);
    ok('scheduler interval 종료', schedulerStopped === 1);
    ok('DB pool close', poolClosed === 1);
    const ticksAfter = ticks;
    await new Promise(function (r) {
      setTimeout(r, 60);
    });
    ok('scheduler 중지 후 tick 증가 없음', ticks === ticksAfter);

    const r2 = await ctrl.shutdown('SIGINT');
    ok('중복 shutdown 안전', r2.duplicate === true);

    const server2 = await new Promise(function (resolve) {
      const s = express().listen(0, function () {
        resolve(s);
      });
    });
    const ctrl2 = createGracefulShutdown({
      timeoutMs: 3000,
      exitProcess: false,
      server: server2,
      stopScheduler: function () {},
      closePools: async function () {},
      logger: { log: function () {}, error: function () {} },
    });
    const r3 = await ctrl2.shutdown('SIGINT');
    ok('SIGINT 정상 종료', r3.ok === true);

    const morningSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'server', 'daily-issue-morning-scheduler-service.js'),
      'utf8',
    );
    ok('morning scheduler stop API', /stop:\s*function\s*\(\)\s*\{/.test(morningSrc));
  }

  // health route shape (smoke via minimal handler contract from server source)
  {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    ok('health 유지', /app\.get\(\s*'\/health'/.test(src));
    ok('ready 추가', /app\.get\(\s*'\/ready'/.test(src));
    ok('origin:true 제거', !/origin:\s*true/.test(src));
    ok('graceful shutdown 연결', /createGracefulShutdown/.test(src) && /attachSignals/.test(src));
    ok('단일 인스턴스 정책 로그', /single web instance only/.test(src));
  }

  console.log('\nOK', passed);
})().catch(function (e) {
  console.error('FAIL', e);
  process.exit(1);
});
