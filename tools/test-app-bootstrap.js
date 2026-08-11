'use strict';

/**
 * app-bootstrap.js — cookie /api/auth/me → core (territory screen, no auto board)
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
assert(bootstrapSrc.includes('bootstrapSentenceArena'), 'bootstrap fn exists');
assert(bootstrapSrc.includes("fetch('/api/auth/me'"), 'cookie auth check');
assert(!bootstrapSrc.includes("goBoard('COMMON')"), 'no auto COMMON board');
assert(bootstrapSrc.includes('clearLegacyBoardTarget'), 'legacy board target cleanup');
assert(!bootstrapSrc.includes('setInterval'), 'no polling');
assert(!bootstrapSrc.includes('MutationObserver'), 'no mutation observer');

function runBootstrap(meResponse, locationSearch, storageInitial) {
  return new Promise((resolve) => {
    const calls = { core: 0, board: 0, login: 0, bar: 0 };
    const mem = { ...(storageInitial || {}) };
    const storage = {
      getItem(k) {
        return mem[k] || null;
      },
      setItem(k, v) {
        mem[k] = String(v);
      },
      removeItem(k) {
        delete mem[k];
      },
    };
    const sandbox = {
      document: { readyState: 'complete', addEventListener() {}, getElementById: () => null },
      sessionStorage: storage,
      history: { replaceState() {} },
      location: { search: locationSearch || '', pathname: '/', hash: '' },
      URLSearchParams: global.URLSearchParams,
      setTimeout,
      clearTimeout,
      addEventListener() {},
      console,
      fetch(url) {
        if (String(url).includes('/api/auth/me')) {
          return Promise.resolve(meResponse);
        }
        return Promise.reject(new Error('unexpected'));
      },
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
      ScAuthV2: { wireLoginButtons() {} },
    };
    sandbox.window = sandbox;
    vm.runInNewContext(bootstrapSrc, sandbox);
    setTimeout(() => resolve({ calls, mem, storage }), 50);
  });
}

(async () => {
  {
    const c = await runBootstrap({
      status: 401,
      json: async () => ({ ok: false }),
    });
    assert(c.calls.login === 1 && c.calls.core === 0, '1 no cookie shows login');
  }

  {
    const c = await runBootstrap({
      status: 200,
      json: async () => ({ ok: true, user: { id: 'u1', email: 'a@b.c' } }),
    });
    assert(c.calls.core === 1 && c.calls.bar === 1, '2 /me 200 starts core + user bar');
    assert(c.calls.board === 0, '2 no auto board navigation');
  }

  {
    const c = await runBootstrap(
      {
        status: 200,
        json: async () => ({ ok: true, user: { id: 'u1' } }),
      },
      '?postLogin=board',
      { sc_post_login_target: 'board' },
    );
    assert(c.calls.board === 0, '3 postLogin query does not auto board');
    assert(!c.mem.sc_post_login_target, '3 legacy board target cleared');
  }

  {
    let count = 0;
    const sandbox = {
      document: { readyState: 'complete', addEventListener() {} },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      history: { replaceState() {} },
      location: { search: '', pathname: '/', hash: '' },
      URLSearchParams: global.URLSearchParams,
      setTimeout,
      clearTimeout,
      addEventListener() {},
      console,
      fetch: async () => ({ status: 401, json: async () => ({ ok: false }) }),
      __scApp: {
        showLoginOnly() {
          count++;
        },
      },
      ScAuthV2: { wireLoginButtons() {} },
    };
    sandbox.window = sandbox;
    vm.runInNewContext(bootstrapSrc, sandbox);
    sandbox.bootstrapSentenceArena();
    sandbox.bootstrapSentenceArena();
    await new Promise((r) => setTimeout(r, 50));
    assert(count === 1, '4 bootstrap runs once');
  }

  const idx = await request('/');
  assert(idx.status === 200 && idx.body.includes('app-bootstrap.js'), 'live index has bootstrap');
  assert(idx.body.includes('id="screen-main"'), 'index has territory selection DOM');
  assert(idx.body.includes('id="screen-board"'), 'index has board DOM for manual navigation');

  const bs = await request('/app-bootstrap.js');
  assert(bs.status === 200, 'bootstrap served');
  assert(!bs.body.includes("goBoard('COMMON')"), 'served bootstrap no auto COMMON');

  console.log('PASS app-bootstrap territory screen (no auto board)');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
