'use strict';

/**
 * auth-v2 — cookie session login, app boot separation, board post-login
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
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const authV2 = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'auth-client.js'), 'utf8');
const callbackHtml = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'callback.html'), 'utf8');
const boardClient = fs.readFileSync(path.join(root, 'public', 'board-api-client.js'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');
const controllerSrc = fs.readFileSync(path.join(root, 'public', 'session-controller.js'), 'utf8');
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
assert(/app-bootstrap\.js/.test(indexSrc), 'index uses app-bootstrap');
assert(!callbackHtml.includes('sessionStorage.setItem'), 'static callback no sessionStorage');
assert(!/\/api\/auth\/me/.test(head), 'head no /me fetch');

const staticIdx = serverSrc.indexOf("express.static(path.join(__dirname, 'public')");
const callbackRouteIdx = serverSrc.indexOf("app.get('/auth-v2/callback.html'");
assert(callbackRouteIdx > 0 && callbackRouteIdx < staticIdx, 'server callback route before static');
assert(/exchangeCodeForSession/.test(serverSrc), 'SSR exchange in callback');
assert(/res\.redirect\(302, '\/'\)/.test(serverSrc), 'callback redirect home');
assert(!bootstrapSrc.includes("goBoard('COMMON')"), 'bootstrap no auto COMMON');

assert(!authV2.includes('sc_sb_auth_session'), 'auth-v2 no sessionStorage auth');
assert(!authV2.includes('enterAppMain'), 'auth-v2 no app enter');
assert(authV2.includes('/api/auth/logout'), 'auth-v2 cookie logout');

assert(
  bootstrapSrc.includes('ScSessionController') || /session-controller\.js/.test(indexSrc),
  'unified session controller entry',
);
assert(/session-controller\.js/.test(indexSrc), 'index loads session-controller');
assert(serverSrc.includes('createSessionBootstrapRouter') || serverSrc.includes('/session/bootstrap'), 'session bootstrap API');
assert(!/href="\/api\/auth\/oauth\/apple"/.test(indexSrc), 'Apple UI removed');
assert(controllerSrc.includes('clearLegacyBoardTarget'), 'controller clears legacy board target');
assert(!bootstrapSrc.includes('sc_sb_auth_session'), 'bootstrap no sessionStorage auth');
assert(!controllerSrc.includes('sc_sb_auth_session'), 'controller no sessionStorage token auth');

assert(!boardClient.includes('Authorization'), 'board cookie auth only');

function loadAuthV2(fetchImpl) {
  const sandbox = {
    document: { getElementById: () => null, readyState: 'complete', addEventListener: () => {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fetchImpl,
    location: { assign() {} },
    addEventListener() {},
    console,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(authV2, sandbox);
  return sandbox.ScAuthV2;
}

(async () => {
  const oauth = await request('GET', '/api/auth/oauth/google');
  assert(oauth.status === 302 || oauth.status === 503, 'oauth start responds');

  const cbNoCode = await request('GET', '/auth-v2/callback.html');
  assert(cbNoCode.status === 400, 'callback no code 400');
  assert(!cbNoCode.body.includes('sessionStorage.setItem'), 'callback no handoff html');

  const ScAuthV2 = loadAuthV2(function (url, opts) {
    assert(url === '/api/auth/logout', 'signOut hits logout');
    assert(opts && opts.credentials === 'same-origin', 'logout sends cookies');
    return Promise.resolve({ ok: true });
  });
  await ScAuthV2.signOut();

  assert(/app-bootstrap\.js/.test(indexSrc), 'app-bootstrap linked');
  assert(/startSentenceArenaCore/.test(indexSrc), 'core entry');
  assert(!bootstrapSrc.includes('setInterval'), 'no auth polling');

  const noAuth = await request('GET', '/api/auth/me');
  assert(noAuth.status === 401 || noAuth.status === 503, 'live /me 401 without cookie');

  console.log('PASS auth-v2: cookie login, app separation, board target');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
