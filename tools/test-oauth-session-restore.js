'use strict';

/**
 * OAuth session restore is the static browser callback, not server SSR.
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
const authJs = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
const callbackHtml = fs.readFileSync(path.join(root, 'public', 'auth-v2', 'callback.html'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const board = fs.readFileSync(path.join(root, 'public', 'board-api-client.js'), 'utf8');

const meBlock = serverSrc.match(/app\.get\('\/api\/auth\/me'[\s\S]*?app\.get\('\/api\/me\/profile'/);
assert(meBlock, 'GET /api/auth/me block missing');
assert(/requireAuthenticatedUser/.test(meBlock[0]), '/api/auth/me uses requireAuthenticatedUser');
assert(/requireSupabase/.test(meBlock[0]), '/api/auth/me checks Supabase before the bearer');
assert(!/exchangeCodeForSession/.test(serverSrc), 'server does not SSR-exchange the code');
assert(/function finishOAuthCallback\(\)[\s\S]*exchangeCodeForSession/.test(authJs), 'browser finishOAuthCallback exchanges the code');
assert(/finishOAuthCallback/.test(callbackHtml), 'static callback calls finishOAuthCallback');
assert(!/renderOAuthHandoffHtml\(payload\)/.test(serverSrc), 'no sessionStorage handoff in callback');
assert(/\/auth\.js/.test(indexSrc), 'index uses auth.js');
assert(!/auth-v2\/auth-client\.js/.test(indexSrc), 'index does not use the removed auth-v2 client');
assert(/app-bootstrap\.js/.test(indexSrc), 'index uses app-bootstrap');
assert(/startSentenceArena/.test(indexSrc) || /app-entry\.js/.test(indexSrc), 'current entry is loaded');
assert(/Authorization/.test(board), 'board uses Bearer');

(async () => {
  const noAuth = await request('GET', '/api/auth/me');
  assert(
    noAuth.status === 401 ||
      (noAuth.status === 503 && noAuth.json && noAuth.json.error === 'SUPABASE_NOT_CONFIGURED'),
    'me without bearer is 401, or 503 only when local Supabase is absent',
  );

  const cb = await request('GET', '/auth-v2/callback.html');
  assert(cb.status === 200 && cb.body.includes('finishOAuthCallback'), 'static callback served');

  console.log('PASS oauth session restore is browser PKCE');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
