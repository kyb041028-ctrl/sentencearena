'use strict';

/**
 * Current browser auth — PKCE client, no session-controller, Bearer /me.
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
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const callbackHtml = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'callback.html'), 'utf8');
const boardClient = fs.readFileSync(path.join(root, 'public', 'board-api-client.js'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');
const authJs = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
const entryJs = fs.readFileSync(path.join(root, 'public', 'app-entry.js'), 'utf8');
const head = indexSrc.slice(0, indexSrc.indexOf('</head>'));

assert(!fs.existsSync(path.join(root, 'public', 'session-controller.js')), 'session-controller removed');
assert(!indexSrc.includes('session-controller.js'), 'index does not load session-controller');
assert(!indexSrc.includes('auth-v2/auth-client.js'), 'index does not load removed auth-v2 client');
assert(indexSrc.includes('/auth.js'), 'index loads auth.js');
assert(/app-bootstrap\.js/.test(indexSrc), 'index uses app-bootstrap');
assert(/startSentenceArena/.test(bootstrapSrc), 'bootstrap delegates to startSentenceArena');
assert(!bootstrapSrc.includes("goBoard('COMMON')"), 'bootstrap no auto COMMON');
assert(/finishOAuthCallback/.test(callbackHtml), 'static callback uses finishOAuthCallback');
assert(!callbackHtml.includes('sessionStorage.setItem'), 'static callback no sessionStorage');
assert(!/\/api\/auth\/me/.test(head), 'head no /me fetch');
assert(!serverSrc.includes('createSessionBootstrapRouter'), 'server has no session bootstrap router');
assert(!/exchangeCodeForSession/.test(serverSrc), 'server does not SSR-exchange the OAuth code');
assert(/exchangeCodeForSession/.test(authJs), 'browser auth.js exchanges the OAuth code');
assert(/Authorization/.test(boardClient), 'board sends Bearer');
assert(/clearSharedAuthFetch\(\);\s*showAuthError\(\)/.test(entryJs), 'failed session lookup clears cache before the notice');

(async () => {
  const cb = await request('GET', '/auth-v2/callback.html');
  assert(cb.status === 200, 'static callback is served');
  assert(cb.body.includes('finishOAuthCallback'), 'served callback runs finishOAuthCallback');
  assert(!cb.body.includes('sessionStorage.setItem'), 'callback no handoff html');

  const noAuth = await request('GET', '/api/auth/me');
  assert(
    noAuth.status === 401 ||
      (noAuth.status === 503 && noAuth.json && noAuth.json.error === 'SUPABASE_NOT_CONFIGURED'),
    'me without bearer is 401, or 503 only when local Supabase is absent',
  );

  console.log('PASS auth-v2: current PKCE browser auth');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
