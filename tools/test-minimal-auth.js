#!/usr/bin/env node
'use strict';

/**
 * Minimal browser-auth structure checks
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function request(urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: urlPath,
        method: 'GET',
      },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          let j = null;
          try {
            j = JSON.parse(d);
          } catch (_) {}
          resolve({ status: res.statusCode, body: d, json: j });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const authJs = read('public/auth.js');
const entryJs = read('public/app-entry.js');
const bootstrapJs = read('public/app-bootstrap.js');
const callbackHtml = read('public/auth-v2/callback.html');
const indexHtml = read('public/index.html');
const serverJs = read('server.js');
const requireAuth = read('server/auth/require-authenticated-user.js');

assert(/flowType:\s*'pkce'/.test(authJs), 'auth.js uses PKCE');
assert(/signInWithOAuth/.test(authJs), 'auth.js uses signInWithOAuth');
assert(/global\.ScAuth/.test(authJs), 'auth.js exports ScAuth');
assert(/startSentenceArena/.test(entryJs), 'app-entry defines startSentenceArena');
assert(/getSession/.test(entryJs), 'app-entry checks session');
assert(/startSentenceArena/.test(bootstrapJs), 'app-bootstrap delegates to startSentenceArena');
assert(/finishOAuthCallback/.test(callbackHtml), 'callback uses finishOAuthCallback');
assert(!indexHtml.includes('session-controller.js'), 'index removed session-controller');
assert(!indexHtml.includes('session-bootstrap-core.js'), 'index removed session bootstrap core');
assert(!indexHtml.includes('auth-v2/auth-client.js'), 'index removed auth-v2 client');
assert(indexHtml.includes('/auth.js'), 'index loads auth.js');
assert(indexHtml.includes('data-provider="google"'), 'google button uses data-provider');
assert(!serverJs.includes('createSessionBootstrapRouter'), 'server removed session bootstrap router');
assert(!serverJs.includes('/api/auth/oauth/:provider'), 'server removed oauth redirect route');
assert(!serverJs.includes('createRequestSupabaseClient'), 'server removed SSR cookie client');
assert(/extractBearerToken|Bearer /.test(requireAuth), 'requireAuthenticatedUser uses Bearer');
assert(!fs.existsSync(path.join(root, 'public/session-controller.js')), 'session-controller deleted');
assert(!fs.existsSync(path.join(root, 'server/session-bootstrap-routes.js')), 'bootstrap routes deleted');

(async function live() {
  const cfg = await request('/api/supabase-config');
  assert(cfg.status === 200 || cfg.status === 503, 'supabase-config reachable');
  const idx = await request('/');
  assert(idx.status === 200 && idx.body.includes('/app-entry.js'), 'index served');
  const cb = await request('/auth-v2/callback.html');
  assert(cb.status === 200 && cb.body.includes('finishOAuthCallback'), 'static callback served');
  const me = await request('/api/auth/me');
  assert(me.status === 401, 'me without bearer is 401');
  console.log('PASS minimal browser auth structure');
})().catch(function (e) {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
