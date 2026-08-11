'use strict';

/**
 * OAuth cookie session — PKCE via @supabase/ssr + server callback
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
assert(/requireAuthenticatedUser/.test(meBlock[0]), '/api/auth/me uses cookie auth helper');
assert(/auth-v2\/callback\.html/.test(serverSrc), 'server uses auth-v2 callback');
assert(/exchangeCodeForSession/.test(serverSrc), 'callback uses SSR exchange');
assert(!/renderOAuthHandoffHtml\(payload\)/.test(serverSrc), 'no sessionStorage handoff in callback');

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
assert(/auth-v2\/auth-client\.js/.test(indexSrc), 'index uses auth-v2');
assert(/app-bootstrap\.js/.test(indexSrc), 'index uses app-bootstrap');
assert(/startSentenceArenaCore/.test(indexSrc), 'core entry in index');

const authClient = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-v2', 'auth-client.js'), 'utf8');
assert(/ScAuthV2/.test(authClient), 'auth-v2 exports ScAuthV2');
assert(!authClient.includes('sc_sb_auth_session'), 'auth-v2 no sessionStorage auth');

const board = fs.readFileSync(path.join(__dirname, '..', 'public', 'board-api-client.js'), 'utf8');
assert(!board.includes('Authorization'), 'board uses cookie not Bearer');

(async () => {
  const noAuth = await request('GET', '/api/auth/me');
  assert(noAuth.status === 401 || noAuth.status === 503, 'no cookie → 401');

  const oauth = await request('GET', '/api/auth/oauth/google');
  assert(oauth.status === 302 || oauth.status === 503, 'oauth start responds');
  if (oauth.status === 302) {
    const loc = String(oauth.headers.location || '');
    assert(!loc.includes('oauth-bridge'), 'oauth direct redirect (no bridge)');
    const cookies = oauth.headers['set-cookie'];
    assert(cookies, 'oauth start sets cookies');
  }

  console.log('PASS oauth cookie session static + HTTP checks');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
