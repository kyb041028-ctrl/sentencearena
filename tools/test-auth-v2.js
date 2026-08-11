'use strict';

/**
 * auth-v2 — independent login, app boot separation, board post-login
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: Number(process.env.PORT) || 3000,
      path: urlPath,
      method,
      headers: headers || {},
    };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => {
        d += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const root = path.join(__dirname, '..');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const authV2 = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'auth-client.js'), 'utf8');
const callbackHtml = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'callback.html'), 'utf8');
const probeHtml = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'probe.html'), 'utf8');
const boardClient = fs.readFileSync(path.join(root, 'public', 'board-api-client.js'), 'utf8');
const head = indexSrc.slice(0, indexSrc.indexOf('</head>'));

const bannedGates = [
  'tryEnterAuthenticatedApp',
  '__scAppReady',
  '__scAuthenticatedEnterDone',
  '__scAuthState',
  '__scTryEnterAppFromAuth',
  '__scAuthReady',
  'sc:auth-ready',
  'bootAppShell',
  'captureOAuthSessionFromUrl',
  'refreshAuthUi',
  'refreshAuthUiInFlight',
];

for (const b of bannedGates) {
  assert(!indexSrc.includes(b), 'gate/glue removed from index: ' + b);
}

assert(/auth-v2\/auth-client\.js/.test(indexSrc), 'index uses auth-v2 client');
assert(!/\/auth\/auth-client\.js/.test(indexSrc), 'old auth client not in index');
assert(fs.existsSync(path.join(root, 'public', 'auth-v2', 'callback.html')), 'auth-v2 callback exists');
assert(fs.existsSync(path.join(root, 'public', 'auth-v2', 'probe.html')), 'auth-v2 probe exists');
assert(!callbackHtml.includes('index.html'), 'callback does not load app');
assert(!probeHtml.includes('index.html'), 'probe does not load app');
assert(!callbackHtml.includes('territory'), 'callback lightweight');
assert(!/\/api\/auth\/me/.test(head), 'head no /me fetch');

assert(authV2.includes('sc_post_login_target'), 'post login target key');
assert(authV2.includes('sc_sb_auth_session'), 'session key unified');
assert(authV2.includes('session.access_token'), 'nested token only');
assert(!authV2.includes('enterAppMain'), 'auth-v2 no app enter');
assert(!authV2.includes('bootMap'), 'auth-v2 no territory');

assert(indexSrc.includes('__scConsumePostLoginTarget'), 'post-login consumer in index');
assert(indexSrc.includes("goBoard('COMMON')"), 'board navigation uses existing goBoard');
assert(!/setInterval[\s\S]{0,120}(auth|\/me|ScAuth)/i.test(indexSrc), 'no auth polling in index');

assert(boardClient.includes('sc_sb_auth_session'), 'board uses unified session key');
assert(boardClient.includes('parsed.session.access_token'), 'board nested token path');

function loadAuthV2(fetchImpl, storage, doc) {
  const events = [];
  const sandbox = {
    document: doc || {
      getElementById: () => null,
      readyState: 'complete',
      addEventListener: () => {},
    },
    sessionStorage: storage,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    location: { assign() {} },
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
  vm.runInNewContext(authV2, sandbox);
  return { ScAuthV2: sandbox.ScAuthV2, events, sandbox };
}

(async () => {
  /* A OAuth start 302 */
  const oauth = await request('GET', '/api/auth/oauth/google');
  assert(oauth.status === 302 || oauth.status === 503, 'A1 oauth start responds');

  /* auth-v2 static */
  const cb = await request('GET', '/auth-v2/callback.html');
  assert(cb.status === 200, 'A2 callback static 200');
  const probe = await request('GET', '/auth-v2/probe.html');
  assert(probe.status === 200, 'A3 probe static 200');
  const bridge = await request('GET', '/auth-v2/oauth-bridge.html');
  assert(bridge.status === 200, 'A4 bridge static 200');

  /* B session structure + 401 + no loop */
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
    const { ScAuthV2, events } = loadAuthV2(function () {
      fetches++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, user: { id: 'u1', email: 'a@b.c' } }),
      });
    }, mem);
    await ScAuthV2.applyUserOnce();
    await ScAuthV2.applyUserOnce();
    assert(fetches === 1, 'B1 /me once');
    assert(events.filter((e) => e.type === 'sc:auth-user').length === 1, 'B2 user event once');
    const raw = JSON.parse(mem.getItem('sc_sb_auth_session'));
    assert(raw.session.access_token === 't', 'B3 nested token');
  }

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
    const { ScAuthV2, events } = loadAuthV2(function () {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: 'INVALID_TOKEN' }),
      });
    }, mem);
    await ScAuthV2.applyUserOnce();
    assert(!mem.getItem('sc_sb_auth_session'), 'B4 401 clears session');
    assert(events.some((e) => e.type === 'sc:auth-session-cleared'), 'B5 cleared event');
  }

  {
    const mem = { _m: {}, getItem() { return null; }, setItem() {}, removeItem() {} };
    let fetches = 0;
    const { ScAuthV2 } = loadAuthV2(function () {
      fetches++;
      return Promise.reject(new Error('net'));
    }, mem);
    await ScAuthV2.applyUserOnce();
    assert(fetches === 0, 'B6 no session no fetch');
  }

  /* C app boot not auth gated */
  assert(/function bootAppView/.test(indexSrc), 'C1 bootAppView present');
  assert(!/enterAppMain\(\)[\s\S]{0,80}readAuth/.test(indexSrc), 'C2 no token enterAppMain at boot');
  assert(!indexSrc.includes('__scBootAppEntry'), 'C3 no deferred bootAppEntry');

  /* D board post-login */
  assert(indexSrc.includes('sc_post_login_target'), 'D1 target key in index');
  assert(indexSrc.includes('sessionStorage.removeItem(\'sc_post_login_target\')'), 'D2 target cleared');
  assert(indexSrc.includes('__scPostLoginBoardDone'), 'D3 duplicate guard');

  /* E performance */
  const authBootSlice = indexSrc.slice(
    indexSrc.indexOf('function bootAppView'),
    indexSrc.indexOf('function wireLoginIntroPlayback'),
  );
  assert(!/await\s+fetch\s*\(\s*['"]\/api\/auth\/me/.test(authBootSlice), 'E1 no await /me in auth boot');
  assert(!/\/api\/auth\/me/.test(head), 'E2 head no /me');
  assert(!callbackHtml.includes('.png'), 'E3 callback no large assets');

  const noAuth = await request('GET', '/api/auth/me');
  assert(noAuth.status === 401, 'live /me 401 without token');

  console.log('PASS auth-v2: independent login, app separation, board target, performance');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
