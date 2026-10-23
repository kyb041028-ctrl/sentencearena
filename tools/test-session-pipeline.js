#!/usr/bin/env node
'use strict';

/**
 * Session lookup retry uses the current app entry.
 * The removed session-controller / session-bootstrap-core stack is not required.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: urlPath,
        method: 'GET',
      },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          resolve({ status: res.statusCode, body: d });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const root = path.join(__dirname, '..');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const entrySrc = fs.readFileSync(path.join(root, 'public', 'app-entry.js'), 'utf8');
const authSrc = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert(!fs.existsSync(path.join(root, 'public', 'session-controller.js')), 'session-controller removed');
assert(!fs.existsSync(path.join(root, 'shared', 'session-bootstrap-core.js')), 'session-bootstrap-core removed');
assert(!indexSrc.includes('session-controller.js'), 'index does not load session-controller');
assert(!indexSrc.includes('session-bootstrap-core.js'), 'index does not load session core');
assert(indexSrc.includes('/auth.js'), 'index loads auth.js');
assert(/startSentenceArena/.test(bootstrapSrc), 'app-bootstrap calls startSentenceArena');
assert(!serverSrc.includes('createSessionBootstrapRouter'), 'bootstrap router removed');
assert(!serverSrc.includes('/api/session/bootstrap'), 'session bootstrap API removed');
assert(entrySrc.includes('로그인 정보를 확인하지 못했습니다.'), 'readable session failure notice');
assert(entrySrc.includes('id="sc-auth-error-retry"'), 'retry button exists');
assert(/clearSharedAuthFetch\(\);\s*showAuthError\(\)/.test(entrySrc), 'lookup failure clears the shared session before the notice');
assert(/initPromise = null/.test(authSrc), 'failed auth client init can run again');

function bootEntry() {
  const nodes = {};
  let fetches = 0;
  const sandbox = {
    document: {
      getElementById(id) {
        return nodes[id] || null;
      },
      createElement() {
        const el = {
          id: '',
          hidden: true,
          innerHTML: '',
          dataset: {},
          classList: { add() {}, remove() {} },
          setAttribute() {},
          addEventListener() {},
          querySelector(sel) {
            if (sel === '#sc-auth-error-retry') return el._btn;
            return null;
          },
          _btn: {
            dataset: {},
            addEventListener(_type, fn) {
              this.onclick = fn;
            },
          },
        };
        return el;
      },
      body: {
        classList: { add() {}, remove() {} },
        appendChild(n) {
          if (n && n.id) nodes[n.id] = n;
        },
      },
      documentElement: { classList: { add() {}, remove() {} } },
    },
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    Promise,
    setTimeout(fn, ms) {
      if (ms >= 5000) return 0;
      return setTimeout(fn, ms);
    },
    clearTimeout,
    fetch() {
      fetches += 1;
      return Promise.resolve({
        ok: false,
        json() {
          return Promise.resolve({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
        },
      });
    },
    console,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(authSrc + '\n' + entrySrc, sandbox);
  return { sandbox, nodes, count: () => fetches };
}

(async function () {
  const boot = bootEntry();
  await boot.sandbox.startSentenceArena();
  const err = boot.nodes['sc-auth-error'];
  assert(err && err.hidden === false, 'lookup failure shows the notice');
  assert(String(err.innerHTML).includes('로그인 정보를 확인하지 못했습니다.'), 'notice stays readable');
  assert(boot.count() === 1, 'first lookup checks auth config once');
  err._btn.onclick();
  await new Promise(function (resolve) {
    setTimeout(resolve, 30);
  });
  assert(boot.count() === 2, '다시 시도 runs the auth/session check again');
  assert(boot.nodes['sc-auth-error'].hidden === false, 'absent Supabase keeps the failure notice');

  const idx = await request('/');
  assert(idx.status === 200, 'index 200');
  assert(!idx.body.includes('session-controller.js'), 'served index has no session-controller');
  assert(idx.body.includes('/auth.js'), 'served index loads auth.js');

  console.log('PASS session lookup retry without session-controller');
})().catch(function (e) {
  console.error('FAIL', e.message);
  process.exit(1);
});
