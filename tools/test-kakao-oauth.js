'use strict';

/**
 * Kakao OAuth — scope fix + shared cookie auth path
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  KAKAO_OAUTH_SCOPES,
  rewriteKakaoLoginScope,
} = require('../server/auth/kakao-oauth-scopes');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

class CookieJar {
  constructor() {
    this.store = new Map();
  }
  absorb(header) {
    const list = Array.isArray(header) ? header : header ? [header] : [];
    for (const raw of list) {
      const part = String(raw).split(';')[0];
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      let value = part.slice(eq + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch (_) {}
      if (!value) this.store.delete(name);
      else this.store.set(name, value);
    }
  }
  header() {
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
  }
}

function request(method, urlPath, jar) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (jar && jar.header()) headers.Cookie = jar.header();
    const req = http.request(
      { hostname: 'localhost', port: Number(process.env.PORT) || 3000, path: urlPath, method, headers },
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
    req.end();
  });
}

function extractKakaoScopeFromRedirect(loc) {
  const outer = new URL(loc);
  const cont = outer.searchParams.get('continue');
  if (!cont) return outer.searchParams.get('scope') || '';
  return new URL(cont).searchParams.get('scope') || '';
}

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');

assert(KAKAO_OAUTH_SCOPES === 'profile_nickname profile_image', 'kakao scope constant');
assert(serverSrc.includes('KAKAO_OAUTH_SCOPES'), 'server uses kakao scope helper');
assert(serverSrc.includes('resolveKakaoOAuthRedirect'), 'server rewrites kakao authorize scope');
assert(indexSrc.includes('/api/auth/oauth/kakao'), 'Kakao button href correct');
assert(!bootstrapSrc.includes("goBoard('COMMON')"), 'bootstrap no auto COMMON');

{
  const inner =
    'https://kauth.kakao.com/oauth/authorize?client_id=x&scope=account_email%20profile_image%20profile_nickname&response_type=code';
  const login = `https://accounts.kakao.com/login?continue=${encodeURIComponent(inner)}`;
  const fixed = rewriteKakaoLoginScope(login);
  const scope = extractKakaoScopeFromRedirect(fixed);
  assert(scope === 'profile_nickname profile_image', 'rewrite drops account_email');
  assert(!scope.includes('account_email'), 'rewrite no account_email');
}

(async () => {
  const jar = new CookieJar();
  const kakaoStart = await request('GET', '/api/auth/oauth/kakao', jar);
  assert(
    kakaoStart.status === 302 || kakaoStart.status === 503 || kakaoStart.status === 400,
    `kakao oauth start got ${kakaoStart.status}`,
  );

  if (kakaoStart.status === 302) {
    const loc = String(kakaoStart.headers.location || '');
    assert(loc.includes('kakao.com'), 'kakao redirect to kakao domain');
    assert(jar.store.size > 0, 'kakao PKCE cookies set');
    const scope = extractKakaoScopeFromRedirect(loc);
    assert(scope === 'profile_nickname profile_image', `kakao scope fixed: "${scope}"`);
    assert(!scope.includes('account_email'), 'authorize URL has no account_email');
  }

  const googleJar = new CookieJar();
  const googleStart = await request('GET', '/api/auth/oauth/google', googleJar);
  assert(googleStart.status === 302 || googleStart.status === 503, 'google oauth start ok');
  if (googleStart.status === 302) {
    const gloc = String(googleStart.headers.location || '');
    assert(!gloc.includes('profile_nickname'), 'google redirect unchanged by kakao scope fix');
    assert(googleJar.store.size > 0, 'google PKCE cookies still set');
  }

  const noAuth = await request('GET', '/api/auth/me', new CookieJar());
  assert(noAuth.status === 401 || noAuth.status === 503, 'me 401 without cookie');

  console.log('PASS kakao oauth scope + google regression');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
