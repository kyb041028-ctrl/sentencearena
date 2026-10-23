'use strict';

/**
 * Auth transport is browser PKCE + Bearer. Cookie SSR session-controller is removed.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: urlPath,
        method,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(d);
          } catch (_) {}
          resolve({ status: res.statusCode, body: d, json: json });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');
const boardClient = fs.readFileSync(path.join(root, 'public', 'board-api-client.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const authJs = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
const requireAuth = fs.readFileSync(path.join(root, 'server', 'auth', 'require-authenticated-user.js'), 'utf8');

assert(!fs.existsSync(path.join(root, 'public', 'session-controller.js')), 'session-controller removed');
assert(!fs.existsSync(path.join(root, 'shared', 'session-bootstrap-core.js')), 'session-bootstrap-core removed');
assert(!/createRequestSupabaseClient/.test(serverSrc), 'server does not create a cookie SSR client');
assert(!/exchangeCodeForSession/.test(serverSrc), 'server does not exchange the OAuth code');
assert(/exchangeCodeForSession/.test(authJs), 'browser client exchanges the OAuth code');
assert(/requireAuthenticatedUser/.test(serverSrc), '/me uses requireAuthenticatedUser');
assert(/extractBearerToken|Bearer /.test(requireAuth), 'requireAuthenticatedUser reads Bearer');
assert(!bootstrapSrc.includes('ScSessionController'), 'bootstrap does not delegate to session controller');
assert(/startSentenceArena/.test(bootstrapSrc), 'bootstrap starts the current app entry');
assert(/Authorization/.test(boardClient), 'board client sends Bearer');
assert(/credentials:\s*'same-origin'/.test(boardClient), 'board client keeps same-origin credentials');
assert(!indexSrc.includes('session-controller.js'), 'index does not load session-controller');
assert(indexSrc.includes('id="screen-board"'), 'index has board screen');
assert(indexSrc.includes('id="view-login"'), 'index has login view');
assert(indexSrc.includes('app-bootstrap.js'), 'index loads bootstrap');

(async () => {
  const noAuth = await request('GET', '/api/auth/me');
  assert(
    noAuth.status === 401 ||
      (noAuth.status === 503 && noAuth.json && noAuth.json.error === 'SUPABASE_NOT_CONFIGURED'),
    'me without bearer is 401, or 503 only when local Supabase is absent',
  );

  const cb = await request('GET', '/auth-v2/callback.html');
  assert(cb.status === 200, 'callback page is the static client page');
  assert(!String(cb.body).includes('sessionStorage.setItem'), 'callback no sessionStorage write');
  assert(String(cb.body).includes('finishOAuthCallback'), 'callback finishes in the browser');

  console.log('PASS auth transport is PKCE Bearer, not cookie SSR');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
