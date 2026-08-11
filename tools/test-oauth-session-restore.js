'use strict';

/**
 * Google OAuth 세션 복원 — PKCE bridge + auth-v2 callback
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(method, urlPath, headers, body) {
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
        res.on('end', () => {
          resolve({ status: res.statusCode, body: d, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const meBlock = serverSrc.match(/app\.get\('\/api\/auth\/me'[\s\S]*?app\.get\('\/api\/me\/profile'/);
assert(meBlock, 'GET /api/auth/me block missing');
assert(/userClient\.auth\.getUser\(\s*token\s*\)/.test(meBlock[0]), '/api/auth/me must call getUser(token)');
assert(/auth-v2\/callback\.html/.test(serverSrc), 'server uses auth-v2 callback');
assert(/auth-v2\/oauth-bridge\.html/.test(serverSrc), 'server uses auth-v2 bridge');

const bridge = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-v2', 'oauth-bridge.html'), 'utf8');
assert(/sc_oauth_sid/.test(bridge), 'bridge stores sid');
assert(/sc_oauth_verifier/.test(bridge), 'bridge stores verifier');

const cb = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-v2', 'callback.html'), 'utf8');
assert(/oauth\/exchange/.test(cb), 'callback exchanges PKCE code');
assert(/session\.access_token/.test(cb), 'callback requires access_token');
assert(/\/api\/auth\/me/.test(cb), 'callback verifies /me once');
assert(!/finishWithTokens/.test(cb), 'callback PKCE-only');

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
assert(/auth-v2\/auth-client\.js/.test(indexSrc), 'index uses auth-v2');
assert(/bootAppView/.test(indexSrc), 'index bootAppView');
assert(/__scConsumePostLoginTarget/.test(indexSrc), 'post-login board consumer');
assert(!/tryEnterAuthenticatedApp/.test(indexSrc), 'no auth-app gate');

const authClient = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-v2', 'auth-client.js'), 'utf8');
assert(/ScAuthV2/.test(authClient), 'auth-v2 exports ScAuthV2');

const board = fs.readFileSync(path.join(__dirname, '..', 'public', 'board-api-client.js'), 'utf8');
assert(/parsed\.session && parsed\.session\.access_token/.test(board), 'board reads nested access_token');

(async () => {
  const noAuth = await request('GET', '/api/auth/me');
  assert(noAuth.status === 401, 'no token → 401');

  const oauth = await request('GET', '/api/auth/oauth/google');
  assert(oauth.status === 302 || oauth.status === 503, 'oauth start responds');
  if (oauth.status === 302) {
    const loc = String(oauth.headers.location || '');
    assert(/auth-v2\/oauth-bridge\.html/.test(loc), 'oauth redirects via auth-v2 bridge');
  }

  const ex = await request(
    'POST',
    '/api/auth/oauth/exchange',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ code: '00000000-0000-0000-0000-000000000000' }),
  );
  assert(ex.status === 400 || ex.status === 401, 'exchange without verifier fails safely');

  console.log('PASS oauth session restore auth-v2 static + PKCE + /api/auth/me checks');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
