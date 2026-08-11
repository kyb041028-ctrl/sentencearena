'use strict';

/**
 * app-bootstrap.js — single login→app entry path
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(
      { hostname: 'localhost', port: Number(process.env.PORT) || 3000, path: urlPath },
      (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      },
    ).on('error', reject);
  });
}

const root = path.join(__dirname, '..');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');

const banned = [
  'bootAppView',
  '__scConsumePostLoginTarget',
  '__scRefreshTerritoryIfAppOpen',
  '__scPostLoginBoardDone',
  'tryEnterAuthenticatedApp',
  '__scAppReady',
  '__scAuthReady',
  'sc:auth-ready',
];

for (const b of banned) {
  assert(!indexSrc.includes(b), 'removed from index: ' + b);
}

assert(/app-bootstrap\.js/.test(indexSrc), 'index loads app-bootstrap.js');
assert(/startSentenceArenaCore/.test(indexSrc), 'core entry extracted');
assert(!/function bootAppView/.test(indexSrc), 'bootAppView removed');
assert(bootstrapSrc.includes('bootstrapSentenceArena'), 'bootstrap fn exists');
assert(bootstrapSrc.includes('readStoredAuth'), 'sync session read');
assert(!bootstrapSrc.includes('setInterval'), 'no polling');
assert(!bootstrapSrc.includes('MutationObserver'), 'no mutation observer');
assert(bootstrapSrc.includes('applyPostLoginTarget'), 'board target handler');
assert(!/await[\s\S]{0,60}applyUserOnce/.test(bootstrapSrc), '/me does not block core');

function makeStorage(initial) {
  const mem = { _m: { ...initial } };
  return {
    getItem(k) {
      return mem._m[k] || null;
    },
    setItem(k, v) {
      mem._m[k] = String(v);
    },
    removeItem(k) {
      delete mem._m[k];
    },
  };
}

function runBootstrap(env) {
  const calls = { core: 0, board: 0, login: 0, bar: 0 };
  const sandbox = {
    document: { readyState: 'complete', addEventListener() {} },
    sessionStorage: env.storage,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    dispatchEvent() {},
    console,
    __scEnterGuestApp() {
      calls.core++;
    },
    startSentenceArenaCore() {
      calls.core++;
    },
    __scRenderAuthUserBar() {
      calls.bar++;
    },
    __scApp: {
      showLoginOnly() {
        calls.login++;
      },
      goBoard() {
        calls.board++;
      },
    },
    __scBoardGoTerritory() {},
    ScAuthV2: {
      wireLoginButtons() {},
      applyUserOnce: env.applyUserOnce || (() => Promise.resolve()),
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(bootstrapSrc, sandbox);
  sandbox.bootstrapSentenceArena();
  return calls;
}

/* 1 no auth → login */
{
  const c = runBootstrap({
    storage: makeStorage({}),
    applyUserOnce: () => Promise.resolve(),
  });
  assert(c.login === 1 && c.core === 0, '1 no auth shows login');
}

/* 2 auth → core */
{
  const c = runBootstrap({
    storage: makeStorage({
      sc_sb_auth_session: JSON.stringify({
        user: { id: 'u1', email: 'a@b.c' },
        session: { access_token: 't', refresh_token: 'r' },
      }),
    }),
  });
  assert(c.core === 1 && c.bar === 1, '2 auth starts core + user bar');
}

/* 3 delayed /me — core first */
{
  let resolveMe;
  const c = runBootstrap({
    storage: makeStorage({
      sc_sb_auth_session: JSON.stringify({
        user: { id: 'u1' },
        session: { access_token: 't', refresh_token: 'r' },
      }),
    }),
    applyUserOnce: () =>
      new Promise((r) => {
        resolveMe = r;
      }),
  });
  assert(c.core === 1, '3 core before /me resolves');
  resolveMe();
}

/* 4 board target once */
{
  const storage = makeStorage({
    sc_post_login_target: 'board',
    sc_sb_auth_session: JSON.stringify({
      user: { id: 'u1' },
      session: { access_token: 't', refresh_token: 'r' },
    }),
  });
  const c = runBootstrap({ storage });
  assert(c.board === 1, '4 board navigation once');
  assert(!storage.getItem('sc_post_login_target'), '4 target cleared');
}

/* 5 bootstrap once */
{
  let count = 0;
  const storage = makeStorage({});
  const sandbox = {
    document: { readyState: 'complete', addEventListener() {} },
    sessionStorage: storage,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    dispatchEvent() {},
    console,
    __scApp: {
      showLoginOnly() {
        count++;
      },
    },
    ScAuthV2: { wireLoginButtons() {}, applyUserOnce: () => Promise.resolve() },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(bootstrapSrc, sandbox);
  sandbox.bootstrapSentenceArena();
  sandbox.bootstrapSentenceArena();
  assert(count === 1, '5 bootstrap runs once');
}

(async () => {
  const idx = await request('/');
  assert(idx.status === 200 && idx.body.includes('app-bootstrap.js'), 'live index has bootstrap');

  const bs = await request('/app-bootstrap.js');
  assert(bs.status === 200, 'bootstrap served');

  console.log('PASS app-bootstrap unit + static');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
