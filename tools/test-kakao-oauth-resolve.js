#!/usr/bin/env node
'use strict';

/**
 * Kakao authorize URL scope fix — account_email 제거 검증
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { KAKAO_OAUTH_SCOPES } = require('../server/auth/kakao-oauth-scopes');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function scopeFromUrl(url) {
  try {
    const u = new URL(url);
    const direct = u.searchParams.get('scope');
    if (direct) return direct;
    const cont = u.searchParams.get('continue');
    if (cont) return new URL(cont).searchParams.get('scope') || '';
  } catch (_) {}
  return '';
}

function postJson(urlPath, body) {
  return new Promise(function (resolve, reject) {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
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
          resolve({ status: res.statusCode, json: j });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const root = path.join(__dirname, '..');
const authJs = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert(authJs.includes('skipBrowserRedirect'), 'kakao uses skipBrowserRedirect');
assert(authJs.includes('/api/auth/kakao-resolve-authorize'), 'auth.js calls resolve endpoint');
assert(authJs.includes('KAKAO_SCOPE_FIX_FAILED'), 'auth.js guards against account_email in resolved url');
assert(serverJs.includes('kakao-resolve-authorize'), 'server exposes resolve endpoint');
assert(serverJs.includes('resolveKakaoOAuthRedirect'), 'server uses scope rewriter');
assert(!serverJs.includes('/api/auth/oauth/kakao'), 'legacy server oauth route not restored');

(async function () {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!supabaseUrl || !anonKey) {
    console.log('SKIP kakao oauth resolve live: SUPABASE not configured');
    process.exit(0);
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false },
  });
  const start = await client.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: 'http://localhost:3000/auth-v2/callback.html', skipBrowserRedirect: true },
  });
  assert(!start.error && start.data && start.data.url, 'signInWithOAuth kakao url');

  const resolved = await postJson('/api/auth/kakao-resolve-authorize', {
    authorizeUrl: start.data.url,
  });
  assert(resolved.status === 200, 'resolve endpoint status ' + resolved.status);
  assert(resolved.json && resolved.json.ok && resolved.json.url, 'resolve ok payload');

  const scope = scopeFromUrl(resolved.json.url);
  assert(scope === KAKAO_OAUTH_SCOPES, 'scope fixed: "' + scope + '"');
  assert(!/account_email/i.test(resolved.json.url), 'no account_email in resolved url');
  assert(
    resolved.json.url.includes('kakao.com'),
    'resolved url targets kakao domain',
  );

  console.log('PASS kakao oauth resolve scope fix');
})().catch(function (e) {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
