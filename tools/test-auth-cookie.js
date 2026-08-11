'use strict';

/**
 * Supabase SSR cookie auth — integration + static checks
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

class CookieJar {
  constructor() {
    this.store = new Map();
  }

  absorb(setCookieHeader) {
    if (!setCookieHeader) return;
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const raw of list) {
      const part = String(raw).split(';')[0];
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      let value = part.slice(eq + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch (_) {}
      if (!value) {
        this.store.delete(name);
      } else {
        this.store.set(name, value);
      }
    }
  }

  header() {
    if (!this.store.size) return '';
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
  }
}

function request(method, urlPath, jar, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (jar && jar.header()) headers.Cookie = jar.header();
    if (body) headers['Content-Type'] = 'application/json';
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => {
          if (jar) jar.absorb(res.headers['set-cookie']);
          resolve({ status: res.statusCode, body: d, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');
const authClient = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'auth-client.js'), 'utf8');
const boardClient = fs.readFileSync(path.join(root, 'public', 'board-api-client.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

assert(fs.existsSync(path.join(root, 'server', 'auth', 'supabase-server.js')), 'supabase-server module');
assert(/createRequestSupabaseClient/.test(serverSrc), 'server uses createRequestSupabaseClient');
assert(/exchangeCodeForSession/.test(serverSrc), 'callback uses exchangeCodeForSession');
assert(!/renderOAuthHandoffHtml\(payload\)/.test(serverSrc), 'callback no handoff html');
assert(/res\.redirect\(302, '\/'\)/.test(serverSrc), 'callback redirects home');
assert(/requireAuthenticatedUser/.test(serverSrc), '/me uses requireAuthenticatedUser');
assert(/app\.post\('\/api\/auth\/logout'/.test(serverSrc), 'logout route exists');
assert(!/oauth-bridge\.html/.test(serverSrc.match(/app\.get\('\/api\/auth\/oauth[\s\S]*?\n\}\);/)?.[0] || ''), 'oauth no bridge redirect');

assert(!bootstrapSrc.includes('sc_sb_auth_session'), 'bootstrap no sessionStorage auth');
assert(bootstrapSrc.includes("fetch('/api/auth/me'"), 'bootstrap fetches /api/auth/me');
assert(!bootstrapSrc.includes("goBoard('COMMON')"), 'bootstrap no auto COMMON board');
assert(bootstrapSrc.includes('clearLegacyBoardTarget'), 'bootstrap clears legacy board target');
assert(!bootstrapSrc.includes('setInterval'), 'bootstrap no polling');

assert(!authClient.includes('sc_sb_auth_session'), 'auth client no sessionStorage');
assert(authClient.includes('/api/auth/logout'), 'auth client uses cookie logout');

assert(!boardClient.includes('Authorization'), 'board client no Bearer header');
assert(boardClient.includes("credentials: 'same-origin'"), 'board client sends cookies');

const activeAuthPaths = [bootstrapSrc, authClient, boardClient];
for (const src of activeAuthPaths) {
  assert(!src.includes('sc_sb_auth_session'), 'active path free of sessionStorage auth key');
}

function runBootstrapVm() {
  return new Promise((resolve, reject) => {
    const calls = { core: 0, board: 0, login: 0, bar: 0 };
    const loc = { search: '?postLogin=board', pathname: '/', hash: '' };
    const history = { replaceState() {} };
    const sandbox = {
      document: { readyState: 'complete', addEventListener() {}, getElementById: () => null },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      history: history,
      location: loc,
      URLSearchParams: global.URLSearchParams,
      setTimeout,
      clearTimeout,
      fetch(url) {
        if (String(url).includes('/api/auth/me')) {
          return Promise.resolve({
            status: 200,
            json() {
              return Promise.resolve({ ok: true, user: { id: 'u-cookie-1', email: 'c@test.com' } });
            },
          });
        }
        return Promise.reject(new Error('unexpected fetch'));
      },
      __scRenderAuthUserBar(v) {
        calls.bar += 1;
      },
      startSentenceArenaCore() {
        calls.core += 1;
      },
      __scApp: {
        goBoard(t) {
          calls.board += 1;
          assert(t === 'COMMON', 'goBoard COMMON');
        },
        showLoginOnly() {
          calls.login += 1;
        },
      },
      ScAuthV2: { wireLoginButtons() {} },
      addEventListener() {},
      console,
    };
    vm.runInNewContext(bootstrapSrc, sandbox);
    setTimeout(() => {
      try {
        assert(calls.core === 1, 'VM: core started after /me 200');
        assert(calls.board === 0, 'VM: no auto board navigation after login');
        assert(calls.login === 0, 'VM: login hidden');
        assert(calls.bar === 1, 'VM: user bar rendered');
        resolve();
      } catch (e) {
        reject(e);
      }
    }, 50);
  });
}

function parseIndexDomChecks(html) {
  assert(html.includes('id="screen-board"'), 'index has board screen');
  assert(html.includes('id="view-login"'), 'index has login view');
  assert(html.includes('app-bootstrap.js'), 'index loads bootstrap');
}

parseIndexDomChecks(indexSrc);

(async () => {
  await runBootstrapVm();

  const jar = new CookieJar();

  const noAuth = await request('GET', '/api/auth/me', jar);
  assert(noAuth.status === 401 || noAuth.status === 503, 'no cookie → 401/503');

  const oauth = await request('GET', '/api/auth/oauth/google', jar);
  assert(oauth.status === 302 || oauth.status === 503, 'oauth start responds');
  if (oauth.status === 302) {
    const loc = String(oauth.headers.location || '');
    assert(!loc.includes('oauth-bridge'), 'oauth direct to provider');
    assert(jar.store.size > 0, 'oauth start sets PKCE cookies');
    const names = Array.from(jar.store.keys()).join(' ');
    assert(/sb-|code-verifier|auth-token/i.test(names), 'PKCE/auth cookie names present');
  }

  const cbFail = await request('GET', '/auth-v2/callback.html?code=invalid-test-code', jar);
  assert(cbFail.status === 401 || cbFail.status === 400 || cbFail.status === 503, 'bad code fails');
  assert(!String(cbFail.body).includes('sc_sb_auth_session'), 'callback no sessionStorage handoff');
  assert(!String(cbFail.body).includes('sessionStorage.setItem'), 'callback no sessionStorage write');

  if (String(process.env.SC_AUTH_COOKIE_TEST || '').trim() === '1') {
    const seedJar = new CookieJar();
    const seed = await request('POST', '/api/auth/test/establish-session', seedJar);
    assert(seed.status === 200, 'test seed session 200');
    const me = await request('GET', '/api/auth/me', seedJar);
    assert(me.status === 200, 'cookie /me 200');
    const meJson = JSON.parse(me.body);
    assert(meJson.user && meJson.user.id, 'cookie /me user.id');

    const mockCb = await request('GET', '/api/auth/test/mock-callback-success', new CookieJar());
    assert(mockCb.status === 302, 'mock callback 302');
    assert(String(mockCb.headers.location || '') === '/' || String(mockCb.headers.location || '').endsWith('/'), 'mock callback redirects home');
    assert(
      (mockCb.headers['set-cookie'] && String(mockCb.headers['set-cookie']).length > 0) ||
        (Array.isArray(mockCb.headers['set-cookie']) && mockCb.headers['set-cookie'].length > 0),
      'mock callback Set-Cookie',
    );

    const boardJar = new CookieJar();
    await request('POST', '/api/auth/test/establish-session', boardJar);
    const board = await request('GET', '/api/board/posts?territory=COMMON', boardJar);
    assert(board.status === 200 || board.status === 503, 'board API with cookie auth');

    await request('POST', '/api/auth/logout', boardJar);
    const afterLogout = await request('GET', '/api/auth/me', boardJar);
    assert(afterLogout.status === 401, 'logout clears session');
  }

  console.log('PASS auth-cookie integration + static checks');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
