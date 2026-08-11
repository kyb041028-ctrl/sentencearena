'use strict';

/**
 * Google OAuth 세션 복원 — 정적 + PKCE bridge + /api/auth/me 검증
 * (auth rebuild 이후: auth-client.js + slim callback)
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
assert(!/userClient\.auth\.getUser\(\s*\)/.test(meBlock[0]), '/api/auth/me must not call getUser() without jwt');
assert(/grant_type=pkce/.test(serverSrc) || /grant_type=pkce/.test(serverSrc.replace(/\\/g, '')), 'token grant_type=pkce');
assert(/auth_code/.test(serverSrc) && /code_verifier/.test(serverSrc), 'exchange sends auth_code + code_verifier');
assert(/oauthPkceStore/.test(serverSrc), 'server PKCE sid store missing');
assert(/oauth-bridge\.html/.test(serverSrc), 'oauth bridge redirect missing');
assert(/flowType:\s*'pkce'/.test(serverSrc), 'oauth start must use flowType pkce');
assert(/req\.body\?\.verifier/.test(serverSrc) || /body\?\.verifier/.test(serverSrc) || /verifierBody/.test(serverSrc), 'exchange accepts body verifier');

const bridge = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'auth', 'oauth-bridge.html'),
  'utf8',
);
assert(/sc_oauth_sid/.test(bridge), 'bridge stores sid');
assert(/sc_oauth_verifier/.test(bridge), 'bridge stores verifier');
assert(/target/.test(bridge), 'bridge redirects to authorize url');

const cb = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth', 'callback.html'), 'utf8');
assert(/oauth\/exchange/.test(cb), 'callback exchanges PKCE code');
assert(/j\.user\.id/.test(cb), 'callback requires user.id before home');
assert(/session\.access_token/.test(cb), 'callback requires access_token');
assert(/오류 코드/.test(cb), 'callback shows safe error codes');
assert(!/finishWithTokens/.test(cb), 'callback PKCE-only (no hash implicit)');

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
assert(/auth-client\.js/.test(indexSrc), 'index uses auth-client');
assert(/bootAppEntry/.test(indexSrc), 'index bootAppEntry');
assert(/sc:auth-user/.test(indexSrc), 'index sc:auth-user listener');
assert(!/tryEnterAuthenticatedApp/.test(indexSrc), 'no auth-app gate');
assert(/preload="none"/.test(indexSrc), 'login video preload=none');
assert(/auth\.session && auth\.session\.access_token/.test(indexSrc), 'nested session.access_token');
assert(!/captureOAuthSessionFromUrl/.test(indexSrc), 'no index OAuth capture');
assert(!/refreshAuthUiInFlight/.test(indexSrc), 'no legacy refreshAuthUi');
assert(!/앱 불러오는/.test(indexSrc), 'no app loading gate copy');

const authClient = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'auth', 'auth-client.js'),
  'utf8',
);
assert(/ScAuth/.test(authClient), 'auth-client exports ScAuth');
assert(/\/api\/auth\/me/.test(authClient), 'auth-client calls /me');

const board = fs.readFileSync(path.join(__dirname, '..', 'public', 'board-api-client.js'), 'utf8');
assert(/parsed\.session && parsed\.session\.access_token/.test(board), 'board reads nested access_token');

(async () => {
  const noAuth = await request('GET', '/api/auth/me');
  assert(noAuth.status === 401, 'no token → 401');
  assert(/NO_ACCESS_TOKEN/.test(noAuth.body), 'no token error code');

  const bad = await request('GET', '/api/auth/me', { Authorization: 'Bearer not-a-jwt' });
  assert(bad.status === 401, 'invalid token → 401');
  assert(/INVALID_TOKEN/.test(bad.body), 'invalid token error code');

  const oauth = await request('GET', '/api/auth/oauth/google');
  assert(oauth.status === 302, 'oauth start → 302');
  const loc = String(oauth.headers.location || '');
  assert(/oauth-bridge\.html/.test(loc), 'oauth redirects via bridge');
  assert(/[#&?]sid=/.test(loc) || /sid=/.test(loc), 'bridge location includes sid');
  assert(/[#&]v=/.test(loc) || /v=/.test(loc), 'bridge location includes verifier');
  assert(/target=/.test(loc), 'bridge location includes target');
  const setCookie = oauth.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie || '');
  assert(/sc_oauth_pkce=/.test(cookieStr), 'oauth sets pkce cookie');
  assert(/sc_oauth_sid=/.test(cookieStr), 'oauth sets sid cookie');

  const hash = loc.includes('#') ? loc.slice(loc.indexOf('#') + 1) : '';
  const hp = new URLSearchParams(hash);
  const target = hp.get('target') || '';
  assert(target, 'bridge target present');
  assert(/code_challenge=/.test(target), 'authorize URL includes code_challenge');
  assert(/code_challenge_method=/.test(target), 'authorize URL includes challenge method');

  const ex = await request(
    'POST',
    '/api/auth/oauth/exchange',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ code: '00000000-0000-0000-0000-000000000000' }),
  );
  assert(ex.status === 400 || ex.status === 401, 'exchange without verifier/code fails safely');
  assert(/NO_PKCE_VERIFIER|EXCHANGE_FAILED|FlowState|flow state/i.test(ex.body), 'exchange error code present');

  console.log('PASS oauth session restore static + PKCE bridge + /api/auth/me checks');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
