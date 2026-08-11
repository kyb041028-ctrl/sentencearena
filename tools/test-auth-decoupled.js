'use strict';

/**
 * Auth decoupled from app boot — session/UI only, no gates
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(method, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: urlPath,
        method,
        headers: headers || {},
      },
      (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const root = path.join(__dirname, '..');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const authClient = fs.readFileSync(path.join(root, 'public', 'auth', 'auth-client.js'), 'utf8');
const head = indexSrc.slice(0, indexSrc.indexOf('</head>'));

/* No auth-app gates */
const banned = [
  'tryEnterAuthenticatedApp',
  '__scAppReady',
  '__scAuthenticatedEnterDone',
  '__scAuthState',
  'sc:auth-ready',
  'hasEntered',
  'markEntered',
  '앱 불러오는 중',
  'setChecking',
];
for (const b of banned) {
  assert(!indexSrc.includes(b) && !authClient.includes(b), 'gate removed: ' + b);
}

assert(indexSrc.includes('bootAppShell'), 'bootAppShell present');
assert(indexSrc.includes('__scRefreshTerritoryIfAppOpen'), 'territory refresh deferred');
assert(!indexSrc.includes('__scBootAppEntry'), 'removed deferred bootAppEntry');
assert(indexSrc.includes('sc:auth-user'), 'sc:auth-user listener');
assert(!/\/api\/auth\/me/.test(head), 'head no /me');
assert(/auth-client\.js/.test(indexSrc), 'auth-client linked');
assert(/href="\/api\/auth\/oauth\/google"/.test(indexSrc), 'Google button preserved');

/* auth-client: apply only, no checking class */
assert(/sc:auth-user/.test(authClient), 'emits sc:auth-user');
assert(/applyStarted/.test(authClient), 'single apply guard');
assert(!/sc-auth-checking/.test(authClient), 'no checking UI in auth-client');

function loadScAuth(fetchImpl, storage) {
  const events = [];
  const sandbox = {
    document: { documentElement: { classList: { add() {}, remove() {}, contains() { return false; } } } },
    sessionStorage: storage,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    AbortController,
    CustomEvent: function (n, i) {
      this.type = n;
      this.detail = i && i.detail;
    },
    dispatchEvent(ev) {
      events.push(ev);
      return true;
    },
    addEventListener() {},
    console,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(authClient, sandbox);
  return { ScAuth: sandbox.ScAuth, events };
}

(async () => {
  /* A. no session — no /me */
  {
    const mem = { _m: {}, getItem() { return null; }, setItem() {}, removeItem() {} };
    let fetches = 0;
    const { ScAuth, events } = loadScAuth(function () {
      fetches++;
      return Promise.resolve({});
    }, mem);
    await ScAuth.applyUserOnce();
    await ScAuth.applyUserOnce();
    assert(fetches === 0, 'A: no session no fetch');
    assert(!events.some((e) => e.type === 'sc:auth-user'), 'A: no user event');
  }

  /* B. session + 200 → user event once */
  {
    const mem = {
      _m: {},
      getItem(k) {
        return this._m[k] || null;
      },
      setItem(k, v) {
        this._m[k] = String(v);
      },
      removeItem(k) {
        delete this._m[k];
      },
    };
    mem.setItem(
      'sc_sb_auth_session',
      JSON.stringify({
        user: { id: 'u1', email: 'a@b.c' },
        session: { access_token: 't', refresh_token: 'r', token_type: 'bearer' },
      }),
    );
    let fetches = 0;
    const { ScAuth, events } = loadScAuth(function () {
      fetches++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, user: { id: 'u1', email: 'a@b.c' } }),
      });
    }, mem);
    await ScAuth.applyUserOnce();
    await ScAuth.applyUserOnce();
    assert(fetches === 1, 'B: /me once');
    assert(events.filter((e) => e.type === 'sc:auth-user').length === 1, 'B: user once');
  }

  /* C. shell boot sync; territory refresh deferred; auth /me does not gate shell */
  assert(/bootAppShell\(\)/.test(indexSrc), 'C: sync bootAppShell');
  assert(/__scRefreshTerritoryIfAppOpen/.test(indexSrc), 'C: territory refresh after APIs');
  const authBootSlice = indexSrc.slice(
    indexSrc.indexOf('function bootAppShell'),
    indexSrc.indexOf('function wireLoginIntroPlayback'),
  );
  assert(authBootSlice.indexOf('bootAppShell();') !== -1, 'C: bootAppShell invoked in auth block');
  assert(!/await.*applyUserOnce/.test(indexSrc), 'C: boot does not await auth');

  /* D. 401 clears session */
  {
    const mem = {
      _m: {
        sc_sb_auth_session: JSON.stringify({
          user: { id: 'u1' },
          session: { access_token: 'bad', refresh_token: 'r' },
        }),
      },
      getItem(k) {
        return this._m[k] || null;
      },
      setItem(k, v) {
        this._m[k] = String(v);
      },
      removeItem(k) {
        delete this._m[k];
      },
    };
    const { ScAuth, events } = loadScAuth(function () {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: 'INVALID_TOKEN' }),
      });
    }, mem);
    await ScAuth.applyUserOnce();
    assert(!mem.getItem('sc_sb_auth_session'), 'D: session cleared');
    assert(events.some((e) => e.type === 'sc:auth-session-cleared'), 'D: cleared event');
  }

  /* E. OAuth static */
  const oauth = await request('GET', '/api/auth/oauth/google');
  assert(oauth.status === 302, 'E: oauth 302');

  /* F. enterAppMain not duplicated via tryEnter */
  assert(!indexSrc.includes('tryEnterAuthenticatedApp'), 'F: no tryEnter');

  const noAuth = await request('GET', '/api/auth/me');
  assert(noAuth.status === 401, 'live 401 no token');

  console.log('PASS auth decoupled: no gates, boot independent, user apply async');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
