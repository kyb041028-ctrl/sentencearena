/**
 * =============================================================================
 * 센텐스아레나 Ver 1.0 베타 — 백엔드 서버 (server.js) + Supabase 연동
 * =============================================================================
 *
 * 【환경변수】
 * - `.env`에 SUPABASE_URL 과 SUPABASE_ANON_KEY(또는 SUPABASE_PUBLISHABLE_KEY) 를 넣으세요.
 * - 소스에 키를 직접 쓰지 마세요. 서버 전용 폴백은 server/supabase-server-auth-config.js 참고.
 *
 * 【실행】
 *   npm install
 *   npm start
 *   브라우저에서 http://localhost:PORT/ 접속 (기본 3000)
 *   화면 파일: public/index.html
 *
 * 【인증 API】
 *   POST /api/auth/signup   — 회원가입 (Supabase Auth signUp)
 *   POST /api/auth/signin   — 로그인 (signInWithPassword)
 *   POST /api/auth/signout  — 로그아웃 (cookie session, Bearer legacy 호환)
 *   POST /api/auth/logout   — 로그아웃 (cookie session)
 *   POST /api/auth/refresh  — 세션 갱신 (body: { refresh_token })
 *   GET  /api/auth/me       — 현재 유저 (cookie)
 *   GET  /api/auth/oauth/:provider — 소셜 로그인 PKCE cookie → 302 provider
 *   GET  /api/me/profile    — public.profiles 한 줄 (Bearer, RLS)
 *   GET  /api/chat/messages — 채팅 목록 (room=global|territory, territoryId, afterId)
 *   POST /api/chat/messages — 채팅 전송 (인메모리·폴링용 베타)
 * =============================================================================
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const appConfig = require('./app-config');
const { createExpressCorsOptions, resolveCorsAllowlist } = require('./server/http-cors-config');
const { assertProductionBootGuardsOrThrow } = require('./server/production-boot-guards');
const { createGracefulShutdown } = require('./server/graceful-shutdown');
const { closeAllDailyIssuePools } = require('./server/daily-issue-pg-client');

try {
  assertProductionBootGuardsOrThrow(process.env);
} catch (e) {
  const fatal = (e && e.fatal) || [];
  console.error('[boot-guard:fatal]', e && e.code ? e.code : 'BOOT_FAILED');
  fatal.forEach(function (f) {
    console.error('-', f.code, f.message);
  });
  process.exit(1);
}
const { createBoardRouter } = require('./server/board-routes');
const userDataRoutes = require('./server/user-data-routes');
const userDataService = require('./server/user-data-service');
const userDataMemoryRepo = require('./server/user-data-memory-repository');
const userContentRoutes = require('./server/user-content-routes');
const territoryEvolutionRoutes = require('./server/territory-evolution-routes');
const territoryEvolutionService = require('./server/territory-evolution-service');
const territoryPopulationAdapter = require('./server/territory-population-adapter');
const territoryPopulationMemoryRepo = require('./server/territory-population-memory-repository');
const alienModerationRoutes = require('./server/alien-moderation-routes');
const alienObservationRoutes = require('./server/alien-observation-routes');
const alienModerationService = require('./server/alien-moderation-service');
const alienObservationService = require('./server/alien-observation-service');
const alienRankService = require('./server/alien-rank-service');
const alienModerationMemoryRepo = require('./server/alien-moderation-memory-repository');
const alienObservationMemoryRepo = require('./server/alien-observation-memory-repository');
const alienRankMemoryRepo = require('./server/alien-rank-memory-repository');

const { resolveSupabaseServerAuthConfig } = require('./server/supabase-server-auth-config');
const { createRequestSupabaseClient } = require('./server/auth/supabase-server');
const { requireAuthenticatedUser } = require('./server/auth/require-authenticated-user');
const supabaseAuthConfig = resolveSupabaseServerAuthConfig();
const supabaseUrl = supabaseAuthConfig.url;
const supabaseAnonKey = supabaseAuthConfig.key;
const PORT = Number(process.env.PORT) || 3000;
/** Railway/PaaS는 0.0.0.0 바인딩 필요. HOST로 재정의 가능 */
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';

/** 서버 전용(세션 없이 가입/로그인 호출) — anon 또는 publishable 키만 */
let supabaseAdmin = null;
if (supabaseAuthConfig.configured) {
  supabaseAdmin = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      /** 서버에서 OAuth URL만 만들고 브라우저 콜백은 hash(implicit)로 받기 */
      flowType: 'implicit',
    },
  });
}

/**
 * 사용자의 access_token 으로 RLS가 적용된 클라이언트 생성
 * @param {string} accessToken
 */
function createUserClient(accessToken) {
  if (!supabaseAuthConfig.configured) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
  });
}

/** 소셜 로그인 (Supabase 대시보드에서 각 Provider 활성화 필요) */
const OAUTH_PROVIDERS = new Set(['google', 'apple', 'kakao', 'naver']);

function getPublicOrigin(req) {
  const fixed = String(process.env.APP_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (fixed) return fixed;
  const xfProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = xfProto || req.protocol || 'http';
  const safeProto = proto === 'https' || proto === 'http' ? proto : 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || `localhost:${PORT}`;
  return `${safeProto}://${host}`;
}

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

/** OAuth PKCE — 서버 Map(sid) + HttpOnly 쿠키(백업) + bridge sessionStorage */
const OAUTH_PKCE_COOKIE = 'sc_oauth_pkce';
const OAUTH_PKCE_SID_COOKIE = 'sc_oauth_sid';
const OAUTH_PKCE_TTL_MS = 10 * 60 * 1000;
/** @type {Map<string, { verifier: string, exp: number }>} */
const oauthPkceStore = new Map();
const authMeDiag = { total: 0, withBearer: 0, ok: 0, fail: 0 };

function pruneOauthPkceStore(now = Date.now()) {
  for (const [sid, row] of oauthPkceStore.entries()) {
    if (!row || row.exp <= now) oauthPkceStore.delete(sid);
  }
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  if (!raw) return null;
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i].trim();
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    if (piece.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(piece.slice(eq + 1));
    } catch (_) {
      return piece.slice(eq + 1);
    }
  }
  return null;
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  const list = Array.isArray(prev) ? prev.slice() : [String(prev)];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}

function cookieSecureSuffix() {
  return String(process.env.NODE_ENV || '').trim() === 'production' ? '; Secure' : '';
}

function setPkceCookies(res, sid, verifier) {
  const secure = cookieSecureSuffix();
  appendSetCookie(
    res,
    `${OAUTH_PKCE_COOKIE}=${encodeURIComponent(verifier)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  );
  appendSetCookie(
    res,
    `${OAUTH_PKCE_SID_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  );
}

function clearPkceCookies(res) {
  const secure = cookieSecureSuffix();
  appendSetCookie(res, `${OAUTH_PKCE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  appendSetCookie(res, `${OAUTH_PKCE_SID_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function createMemoryAuthStorage() {
  const mem = new Map();
  return {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => {
      mem.set(key, String(value));
    },
    removeItem: (key) => {
      mem.delete(key);
    },
    /** 테스트/디버그용 — Map 직접 조회 */
    _mem: mem,
  };
}

function readStorageJson(storage, key) {
  const raw = storage.getItem(key);
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return raw;
  }
}

function buildAuthSessionPayload(session, user) {
  const access = session && session.access_token;
  const refresh = session && session.refresh_token;
  if (!access || !refresh) return null;
  const expiresIn = Number(session.expires_in) || 3600;
  const expiresAt =
    Number(session.expires_at) || Math.round(Date.now() / 1000) + expiresIn;
  const u = user || session.user || null;
  if (!u || !u.id) return null;
  return {
    user: {
      id: u.id,
      email: u.email || null,
      role: u.role || null,
    },
    session: {
      access_token: access,
      refresh_token: refresh,
      expires_in: expiresIn,
      expires_at: expiresAt,
      token_type: session.token_type || 'bearer',
    },
  };
}

/** JSON safe for embedding in inline script */
function jsonForHtmlScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/<!--/g, '<\\!--');
}

function renderOAuthHandoffHtml(bundle) {
  const payload = jsonForHtmlScript(bundle);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>로그인 완료 — 센텐스아레나</title>
</head>
<body>
  <p id="msg">로그인 저장 중…</p>
  <script>
    (function () {
      var bundle = ${payload};
      var KEY = 'sc_sb_auth_session';
      var TARGET = 'sc_post_login_target';
      var el = document.getElementById('msg');
      try {
        sessionStorage.setItem(KEY, JSON.stringify(bundle));
        sessionStorage.setItem(TARGET, 'board');
        var raw = sessionStorage.getItem(KEY);
        if (!raw) {
          el.textContent = '세션 저장 실패';
          return;
        }
        var parsed = JSON.parse(raw);
        if (
          !parsed ||
          !parsed.session ||
          !parsed.session.access_token ||
          !parsed.user ||
          !parsed.user.id
        ) {
          el.textContent = '세션 검증 실패';
          return;
        }
        window.location.replace('/');
      } catch (_) {
        el.textContent = '세션 저장 오류';
      }
    })();
  </script>
</body>
</html>`;
}

function renderOAuthCallbackErrorHtml(code, detail) {
  const safeCode = String(code || 'UNKNOWN').replace(/[<>&]/g, '');
  const safeDetail = detail
    ? String(detail).replace(/[<>&]/g, '').slice(0, 180)
    : '';
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8" /><title>로그인 실패</title></head>
<body>
  <p>로그인에 실패했습니다.</p>
  <p>오류 코드: <code>${safeCode}</code></p>
  ${safeDetail ? `<p>${safeDetail}</p>` : ''}
  <p><a href="/">처음으로</a></p>
</body>
</html>`;
}

function resolvePkceVerifier(req, body) {
  const sidBody = String((body && body.sid) || '').trim();
  const sidCookie = readCookie(req, OAUTH_PKCE_SID_COOKIE) || '';
  const sid = sidBody || sidCookie;
  pruneOauthPkceStore();
  const fromStore = sid ? oauthPkceStore.get(sid) : null;
  const verifierFromCookie = readCookie(req, OAUTH_PKCE_COOKIE);
  const verifierBody = String((body && body.verifier) || '').trim();
  const verifier =
    (fromStore && fromStore.verifier) || verifierFromCookie || verifierBody || null;
  const verifierSource = fromStore
    ? 'store'
    : verifierFromCookie
      ? 'cookie'
      : verifierBody
        ? 'body'
        : null;
  return { sid, verifier, verifierSource };
}

const OAUTH_DIAG_LOG = path.join(__dirname, '.cache', 'oauth-debug.log');
const oauthDiagRecent = [];

function oauthDiag(event, data) {
  const row = {
    t: new Date().toISOString(),
    event: event,
    ...(data && typeof data === 'object' ? data : {}),
  };
  oauthDiagRecent.push(row);
  if (oauthDiagRecent.length > 80) oauthDiagRecent.shift();
  console.log(`[oauth-diag] ${event}`, data || '');
  try {
    fs.mkdirSync(path.dirname(OAUTH_DIAG_LOG), { recursive: true });
    fs.appendFileSync(OAUTH_DIAG_LOG, JSON.stringify(row) + '\n', 'utf8');
  } catch (_) {}
}

/**
 * PKCE code → session (공식 token endpoint 직접 호출 — 서버 lock/storage 이슈 회피)
 */
async function exchangePkceCodeForSession(code, verifier) {
  const tokenUrl = `${String(supabaseUrl).replace(/\/$/, '')}/auth/v1/token?grant_type=pkce`;
  const tokenResp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: verifier,
    }),
  });
  const tokenJson = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok) {
    return {
      payload: null,
      error: {
        status: tokenResp.status,
        code: tokenJson.error_code || tokenJson.error || 'EXCHANGE_FAILED',
        message: tokenJson.msg || tokenJson.error_description || tokenJson.error || 'PKCE exchange failed',
        name: 'AuthApiError',
      },
    };
  }

  let session = {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    expires_in: tokenJson.expires_in,
    expires_at: tokenJson.expires_at,
    token_type: tokenJson.token_type || 'bearer',
    user: tokenJson.user || null,
  };
  let user = tokenJson.user || null;

  if (session.access_token && (!user || !user.id)) {
    const userClient = createUserClient(session.access_token);
    if (userClient) {
      const gu = await userClient.auth.getUser(session.access_token);
      if (gu.data && gu.data.user) user = gu.data.user;
    }
  }

  const payload = buildAuthSessionPayload(session, user);
  if (!payload) {
    return {
      payload: null,
      error: { message: 'NO_SESSION_OR_USER', name: 'ExchangeIncomplete', code: 'NO_SESSION_OR_USER' },
    };
  }
  return { payload, error: null };
}


const app = express();

/** 리버스 프록시 뒤에서 `x-forwarded-proto` 를 쓰려면 `.env` 에 TRUST_PROXY=1 */
if (String(process.env.TRUST_PROXY || '').trim() === '1') {
  app.set('trust proxy', 1);
}

/** CORS: production은 allowlist만 · development는 localhost 포함 */
app.use(cors(createExpressCorsOptions(process.env)));
console.log(
  '[cors] allowlist',
  resolveCorsAllowlist(process.env).length
    ? resolveCorsAllowlist(process.env).join(', ')
    : '(empty — production cross-origin denied)',
);

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

function requireSupabase(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({
      ok: false,
      error: 'SUPABASE_NOT_CONFIGURED',
      message:
        '.env 에 SUPABASE_URL 과 SUPABASE_ANON_KEY(또는 SUPABASE_PUBLISHABLE_KEY) 를 설정한 뒤 서버를 다시 시작하세요.',
    });
  }
  next();
}

// -----------------------------------------------------------------------------
// 인증 (Supabase Auth)
// -----------------------------------------------------------------------------

/**
 * POST /api/auth/signup
 * body: { email, password, nickname, home_country }
 * — home_country: ISO 3166-1 alpha-2 (예: KR, US). 목록은 config/signup-countries.js
 */
app.post('/api/auth/signup', requireSupabase, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const nickname = String(req.body?.nickname || '').trim();
    let homeCountry = String(req.body?.home_country || 'KR')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(homeCountry)) {
      homeCountry = 'KR';
    }
    if (!appConfig.isSignupCountryCode(homeCountry)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_HOME_COUNTRY',
        message: '가입 시 선택한 국가 코드가 목록에 없습니다. ISO 2글자(예: KR, US)를 보내 주세요.',
      });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'INVALID_EMAIL' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: '비밀번호는 6자 이상이 안전합니다.' });
    }
    if (nickname.length < 2) {
      return res.status(400).json({ ok: false, error: 'INVALID_NICKNAME' });
    }

    const { data, error } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: nickname,
          home_country: homeCountry,
        },
      },
    });

    if (error) {
      return res.status(400).json({ ok: false, error: error.code || 'SIGNUP_FAILED', message: error.message });
    }

    const session = data.session;
    const user = data.user;

    return res.json({
      ok: true,
      user,
      session,
      needsEmailConfirmation: !session,
      message: session
        ? '가입이 완료되어 로그인되었습니다.'
        : '가입 메일을 확인해 주세요. (이메일 인증을 켜 둔 경우 세션은 인증 후 생깁니다.)',
    });
  } catch (e) {
    console.error('[signup]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/signin
 * body: { email, password }
 */
app.post('/api/auth/signin', requireSupabase, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
    }

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(401).json({ ok: false, error: error.code || 'SIGNIN_FAILED', message: error.message });
    }

    return res.json({
      ok: true,
      user: data.user,
      session: data.session,
    });
  } catch (e) {
    console.error('[signin]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * GET /api/auth/oauth/:provider
 * provider: google | apple | kakao | naver
 * — 공식 PKCE(flowType)로 authorize URL 생성 → bridge에서 sid/verifier를 sessionStorage에 저장 후 provider로 이동
 */
app.get('/api/auth/diag', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    recent: oauthDiagRecent.slice(-40),
    me: { ...authMeDiag },
  });
});

app.get('/api/auth/oauth/:provider', requireSupabase, async (req, res) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase().trim();
    if (!OAUTH_PROVIDERS.has(provider)) {
      return res.status(400).json({ ok: false, error: 'UNKNOWN_OAUTH_PROVIDER' });
    }

    const origin = getPublicOrigin(req);
    const redirectTo = `${origin}/auth-v2/callback.html`;
    const supabase = createRequestSupabaseClient(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.code || 'OAUTH_START_FAILED',
        message: error.message,
      });
    }

    const url = data?.url;
    if (!url) {
      return res.status(502).json({ ok: false, error: 'NO_OAUTH_URL' });
    }

    oauthDiag('oauth-start', {
      provider,
      hasCodeChallenge: String(url).includes('code_challenge='),
      redirectTo,
      cookiePkce: true,
    });

    return res.redirect(302, url);
  } catch (e) {
    console.error('[oauth]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/oauth/exchange
 * body: { code, sid? } — PKCE auth code → session
 * verifier: 서버 Map(sid) 우선, HttpOnly 쿠키 백업
 */
app.post('/api/auth/oauth/exchange', requireSupabase, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    const { sid, verifier, verifierSource } = resolvePkceVerifier(req, req.body || {});

    if (!code) {
      oauthDiag('oauth-exchange', { result: 'NO_AUTH_CODE' });
      return res.status(400).json({ ok: false, error: 'NO_AUTH_CODE' });
    }

    if (!verifier) {
      oauthDiag('oauth-exchange', {
        result: 'NO_PKCE_VERIFIER',
        hasSid: Boolean(sid),
        hasCookie: Boolean(readCookie(req, OAUTH_PKCE_COOKIE)),
        hasBodyVerifier: Boolean(req.body?.verifier),
      });
      return res.status(400).json({ ok: false, error: 'NO_PKCE_VERIFIER' });
    }

    const { payload, error } = await exchangePkceCodeForSession(code, verifier);
    if (sid) oauthPkceStore.delete(sid);
    clearPkceCookies(res);

    if (error || !payload) {
      oauthDiag('oauth-exchange', {
        result: 'FAIL',
        error: (error && (error.code || error.name || error.message)) || 'EXCHANGE_FAILED',
        status: error && error.status ? error.status : null,
        verifierSource,
      });
      return res.status(401).json({
        ok: false,
        error: (error && (error.code || error.name)) || 'EXCHANGE_FAILED',
        message: (error && error.message) || 'PKCE exchange failed',
      });
    }

    oauthDiag('oauth-exchange', {
      result: 'OK',
      hasUser: Boolean(payload.user && payload.user.id),
      expiresIn: payload.session.expires_in,
      verifierSource,
    });

    return res.json({ ok: true, user: payload.user, session: payload.session });
  } catch (e) {
    oauthDiag('oauth-exchange', { result: 'SERVER_ERROR', message: e && e.message ? e.message : 'error' });
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/refresh
 * body: { refresh_token }
 */
app.post('/api/auth/refresh', requireSupabase, async (req, res) => {
  try {
    const refresh_token = String(req.body?.refresh_token || '');
    if (!refresh_token) {
      return res.status(400).json({ ok: false, error: 'MISSING_REFRESH_TOKEN' });
    }

    const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });

    if (error) {
      return res.status(401).json({ ok: false, error: error.code || 'REFRESH_FAILED', message: error.message });
    }

    return res.json({
      ok: true,
      user: data.user,
      session: data.session,
    });
  } catch (e) {
    console.error('[refresh]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/logout — cookie session sign out (primary)
 */
app.post('/api/auth/logout', requireSupabase, async (req, res) => {
  try {
    const supabase = createRequestSupabaseClient(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    const { error } = await supabase.auth.signOut();
    if (error) {
      return res.status(400).json({ ok: false, error: error.code || 'SIGNOUT_FAILED', message: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[logout]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/signout — legacy Bearer alias → cookie logout
 */
app.post('/api/auth/signout', requireSupabase, async (req, res) => {
  try {
    const supabase = createRequestSupabaseClient(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    const { error } = await supabase.auth.signOut();
    if (error) {
      return res.status(400).json({ ok: false, error: error.code || 'SIGNOUT_FAILED', message: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[signout]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * GET /api/auth/me — cookie session (Supabase SSR)
 */
app.get('/api/auth/me', requireSupabase, async (req, res) => {
  authMeDiag.total += 1;
  const callId = authMeDiag.total;
  try {
    const auth = await requireAuthenticatedUser(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    if (!auth.ok) {
      authMeDiag.fail += 1;
      console.log('[auth-me]', {
        callId,
        status: auth.status,
        result: auth.error,
        totals: { ...authMeDiag },
      });
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    authMeDiag.ok += 1;
    console.log('[auth-me]', {
      callId,
      status: 200,
      result: 'OK',
      userId: auth.user.id,
      totals: { ...authMeDiag },
    });
    return res.json({ ok: true, user: auth.user });
  } catch (e) {
    authMeDiag.fail += 1;
    console.error('[me]', e && e.message ? e.message : e);
    console.log('[auth-me]', {
      callId,
      status: 500,
      result: 'SERVER_ERROR',
      totals: { ...authMeDiag },
    });
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * GET /api/me/profile
 * — schema_profiles_identity_history.sql 의 public.profiles
 */
app.get('/api/me/profile', requireSupabase, async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    const uid = auth.user.id;

    const { data: profile, error: pErr } = await auth.supabase.from('profiles').select('*').eq('id', uid).maybeSingle();

    if (pErr) {
      return res.status(400).json({ ok: false, error: pErr.code || 'PROFILE_QUERY_FAILED', message: pErr.message });
    }

    return res.json({ ok: true, profile });
  } catch (e) {
    console.error('[profile]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// -----------------------------------------------------------------------------
// 채팅 (베타: 서버 인메모리, 클라이언트 폴링 — 재시작 시 초기화)
// -----------------------------------------------------------------------------

const CHAT_MAX_PER_ROOM = 400;
const CHAT_TERRITORY_IDS = new Set([
  'COMMON',
  'CONSERVATIVE',
  'PROGRESSIVE',
  'KANTAPBIYA',
  'UNASSIGNED',
]);

let chatSeq = 1;
/** @type {Map<string, Array<{ id: number, ts: string, userId: string, affiliation: string, text: string }>>} */
const chatRooms = new Map();

function chatRoomKey(room, territoryId) {
  if (room === 'global') return 'global';
  if (room === 'territory' && territoryId) return `territory:${territoryId}`;
  return null;
}

function chatGetOrCreateRoom(key) {
  if (!chatRooms.has(key)) chatRooms.set(key, []);
  return chatRooms.get(key);
}

function chatTrimRoom(arr) {
  while (arr.length > CHAT_MAX_PER_ROOM) arr.shift();
}

function sanitizeChatText(s) {
  const t = String(s || '').replace(/\r\n/g, '\n').trim();
  if (!t) return '';
  return t.length > 500 ? t.slice(0, 500) : t;
}

function sanitizeChatLabel(s, max) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) : t;
}

async function chatResolveUserId(req) {
  const token = getBearerToken(req);
  if (!token || !supabaseAdmin) return null;
  try {
    const userClient = createUserClient(token);
    if (!userClient) return null;
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data?.user) return null;
    const u = data.user;
    return String(u.email || u.id || '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/chat/messages?room=global&afterId=0
 * GET /api/chat/messages?room=territory&territoryId=CONSERVATIVE&afterId=0
 */
app.get('/api/chat/messages', async (req, res) => {
  try {
    const room = String(req.query.room || '').trim();
    const afterId = Math.max(0, Number(req.query.afterId ?? 0) || 0);
    let territoryId = String(req.query.territoryId || '').trim();

    if (room === 'territory') {
      if (!CHAT_TERRITORY_IDS.has(territoryId)) {
        return res.status(400).json({ ok: false, error: 'INVALID_TERRITORY_ID' });
      }
    } else if (room !== 'global') {
      return res.status(400).json({ ok: false, error: 'INVALID_ROOM' });
    } else {
      territoryId = '';
    }

    const key = chatRoomKey(room, territoryId || undefined);
    if (!key) return res.status(400).json({ ok: false, error: 'INVALID_ROOM' });

    const arr = chatGetOrCreateRoom(key);
    const list = afterId > 0 ? arr.filter((m) => m.id > afterId) : arr.slice();

    return res.json({ ok: true, room, territoryId: room === 'territory' ? territoryId : null, messages: list });
  } catch (e) {
    console.error('[chat/messages get]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/chat/messages
 * body: { room, text, territoryId?, affiliation?, guestUserId? }
 * — 화면 표기: userId(affiliation) : text (affiliation 은 소속 라벨)
 */
app.post('/api/chat/messages', async (req, res) => {
  try {
    const room = String(req.body?.room || '').trim();
    let territoryId = String(req.body?.territoryId || '').trim();
    const text = sanitizeChatText(req.body?.text);
    const affiliationIn = sanitizeChatLabel(req.body?.affiliation, 64) || '미정';
    const guestUserId = sanitizeChatLabel(req.body?.guestUserId, 48);

    if (!text) {
      return res.status(400).json({ ok: false, error: 'EMPTY_TEXT' });
    }

    if (room === 'territory') {
      if (!CHAT_TERRITORY_IDS.has(territoryId)) {
        return res.status(400).json({ ok: false, error: 'INVALID_TERRITORY_ID' });
      }
    } else if (room === 'global') {
      territoryId = '';
    } else {
      return res.status(400).json({ ok: false, error: 'INVALID_ROOM' });
    }

    const key = chatRoomKey(room, territoryId || undefined);
    if (!key) return res.status(400).json({ ok: false, error: 'INVALID_ROOM' });

    let userId = await chatResolveUserId(req);
    if (!userId) {
      userId = guestUserId || 'guest';
    }

    const msg = {
      id: chatSeq++,
      ts: new Date().toISOString(),
      userId,
      affiliation: affiliationIn,
      text,
    };

    const arr = chatGetOrCreateRoom(key);
    arr.push(msg);
    chatTrimRoom(arr);

    return res.json({ ok: true, message: msg });
  } catch (e) {
    console.error('[chat/messages post]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// -----------------------------------------------------------------------------
// 기존 API
// -----------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'sentencearena-api',
    time: new Date().toISOString(),
    supabaseConfigured: Boolean(supabaseAdmin),
  });
});

app.get('/ready', async (req, res) => {
  const checks = {
    supabaseConfigured: Boolean(supabaseAdmin),
    dailyIssueRepository: String(process.env.DAILY_ISSUE_REPOSITORY || 'json').toLowerCase() || 'json',
    dailyIssueSchema: String(process.env.DAILY_ISSUE_DB_SCHEMA || '').trim() || null,
  };
  let dbReady = null;
  let dbError = null;
  if (checks.dailyIssueRepository === 'db') {
    const { createDailyIssuePgExecutor } = require('./server/daily-issue-pg-client');
    const executor = createDailyIssuePgExecutor({
      schemaName: process.env.DAILY_ISSUE_DB_SCHEMA,
    });
    try {
      if (!executor.ok) {
        dbReady = false;
        dbError = executor.error || 'DATABASE_UNAVAILABLE';
      } else {
        const health = await executor.healthCheck();
        dbReady = !!(health && health.ok);
        if (!dbReady) dbError = (health && (health.error || health.code)) || 'HEALTH_FAILED';
      }
    } catch (e) {
      dbReady = false;
      dbError = e && e.code ? e.code : 'READY_CHECK_FAILED';
    } finally {
      if (executor && typeof executor.end === 'function') {
        try {
          await executor.end();
        } catch (_) {
          /* ignore */
        }
      }
    }
  } else {
    dbReady = false;
    dbError = 'REPOSITORY_NOT_DB';
  }

  const ready =
    checks.supabaseConfigured &&
    (checks.dailyIssueRepository !== 'db' || dbReady === true);
  const status = ready ? 200 : 503;
  return res.status(status).json({
    ok: ready,
    service: 'sentencearena-api',
    time: new Date().toISOString(),
    checks: checks,
    database: { ready: dbReady, error: dbError },
  });
});

app.get('/api/public-config', (req, res) => {
  res.json(appConfig.getPublicClientConfig());
});

app.get('/api/demo/territory-scale', (req, res) => {
  const population = Number(req.query.population ?? 0);
  res.json(appConfig.getTerritoryVisualVariables(population));
});

/** 인구 수 → 영토 “발전 단계” 라벨 (기획용, world-territories) */
app.get('/api/demo/world-stage', (req, res) => {
  const population = Number(req.query.population ?? 0);
  res.json(appConfig.worldTerritories.getStageForPopulation(population));
});

app.post('/api/demo/validate-comment', (req, res) => {
  const text = req.body?.text ?? '';
  res.json(appConfig.validateCommentLength(text));
});

// 사용자 데이터 API — USER_DATA_OPERATIONAL 미설정 시 기본 비활성
// API_OPERATIONAL 은 migration_user_data_system.sql 실제 적용 후에만 활성화
(function () {
  const userDataMode = (process.env.USER_DATA_MODE || 'LEGACY_LOCAL').trim().toUpperCase();
  const userDataOperational = String(process.env.USER_DATA_OPERATIONAL || '').trim() === 'true';
  const resolvedMode = userDataOperational ? 'API_OPERATIONAL' : userDataMode;
  userDataService.setDataMode(resolvedMode === 'API_OPERATIONAL' ? 'API_OPERATIONAL'
    : resolvedMode === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  userDataService.setRepository(userDataMemoryRepo);
  if (resolvedMode === 'API_OPERATIONAL') {
    console.log('[user-data] API_OPERATIONAL — 실제 DB 연결 필요 (migration_user_data_system.sql 적용 확인)');
  } else {
    console.log('[user-data] 모드:', resolvedMode, '— USER_DATA_API_NOT_ACTIVATED (운영 비활성)');
  }
})();
app.use('/api', userDataRoutes);
app.use('/api', userContentRoutes);

// 영토 발전 API — TERRITORY_EVOLUTION_OPERATIONAL 미설정 시 기본 비활성
(function () {
  const tevoMode = (process.env.TERRITORY_EVOLUTION_MODE || 'LEGACY_LOCAL').trim().toUpperCase();
  const tevoOperational = String(process.env.TERRITORY_EVOLUTION_OPERATIONAL || '').trim() === 'true';
  const resolved = tevoOperational ? 'API_OPERATIONAL' : tevoMode;
  territoryPopulationAdapter.setRepository(territoryPopulationMemoryRepo);
  territoryEvolutionService.setDataMode(
    resolved === 'API_OPERATIONAL' ? 'API_OPERATIONAL'
      : resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL'
  );
  console.log('[territory-evolution] 모드:', territoryEvolutionService.getDataMode(),
    '— TERRITORY_EVOLUTION_NOT_ACTIVATED (운영 비활성)');
})();
app.use('/api', territoryEvolutionRoutes);

// 외계 시스템 API — ALIEN_SYSTEM_OPERATIONAL 미설정 시 기본 비활성 (실제 이동·자동판정 없음)
(function () {
  const alienMode = (process.env.ALIEN_DATA_MODE || 'LEGACY_LOCAL').trim().toUpperCase();
  const alienOperational = String(process.env.ALIEN_SYSTEM_OPERATIONAL || '').trim() === 'true';
  // 이번 단계에서 API_OPERATIONAL 강제 비활성
  const resolved = alienOperational ? 'LEGACY_LOCAL' : alienMode;
  alienModerationService.setRepository(alienModerationMemoryRepo);
  alienModerationService.setDataMode(resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  alienObservationService.setRepository(alienObservationMemoryRepo);
  alienObservationService.setDataMode(resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  alienRankService.setRepository(alienRankMemoryRepo);
  alienRankService.setDataMode(resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  console.log('[alien-system] 모드:', alienModerationService.getDataMode(),
    '— ALIEN_SYSTEM_NOT_ACTIVATED (운영·자동판정·실이동 비활성)');
})();

// 사용자 이벤트 파이프라인 — USER_EVENT_SYSTEM_OPERATIONAL 미설정 시 기본 비활성
(function () {
  const userEventService = require('./server/user-event-service');
  const userEventMemoryRepo = require('./server/user-event-memory-repository');
  const evtMode = (process.env.USER_EVENT_DATA_MODE || 'LEGACY_LOCAL').trim().toUpperCase();
  const evtOperational = String(process.env.USER_EVENT_SYSTEM_OPERATIONAL || '').trim() === 'true';
  const resolved = evtOperational ? 'LEGACY_LOCAL' : evtMode;
  userEventService.setRepository(userEventMemoryRepo);
  userEventService.setDataMode(resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  console.log('[user-event] 모드:', userEventService.getDataMode(),
    '— USER_EVENT_SYSTEM_NOT_ACTIVATED (실이벤트·DB write 비활성)');
})();
app.use('/api', alienModerationRoutes);
app.use('/api', alienObservationRoutes);

// 게시판 API — migration 미적용 시 기본 비활성 (BOARD_OPERATIONAL / BOARD_DEV_MEMORY)
app.use(
  '/api/board',
  createBoardRouter({
    supabaseUrl,
    supabaseAnonKey,
    createUserClient,
    resolveActorFromRequest: async (req, res) => {
      const auth = await requireAuthenticatedUser(req, res, {
        url: supabaseUrl,
        key: supabaseAnonKey,
      });
      if (!auth.ok || !auth.user?.id) return null;
      return { userId: auth.user.id, supabase: auth.supabase };
    },
    operational: String(process.env.BOARD_OPERATIONAL || '').trim() === 'true',
    useMemory: String(process.env.BOARD_DEV_MEMORY || '').trim() === 'true',
  }),
);

// 데일리 이슈 API 1차 — Supabase 관리자 인증(ADMIN/OWNER) / 공개 PUBLISHED 조회
(function () {
  const { createDailyIssueRouter } = require('./server/daily-issue-routes');
  const adminAuthConfigured = supabaseAuthConfig.configured;
  app.use(
    '/api',
    createDailyIssueRouter({
      repositoryKind: process.env.DAILY_ISSUE_REPOSITORY || 'json',
      schemaName: process.env.DAILY_ISSUE_DB_SCHEMA,
      supabaseUrl: supabaseUrl,
      supabaseAnonKey: supabaseAnonKey,
    }),
  );
  console.log(
    '[daily-issue-api] mounted — admin auth',
    adminAuthConfigured
      ? 'supabase configured (ADMIN/OWNER gate, ' + supabaseAuthConfig.keySource + ')'
      : 'NOT configured (admin routes fail-closed)',
  );
})();

// -----------------------------------------------------------------------------
// 프론트 — public 폴더 (화면 파일은 여기만 두면 덜 꼬입니다)
// -----------------------------------------------------------------------------
app.get('/', (req, res) => {
  const qKeys = Object.keys(req.query || {});
  if (qKeys.length) {
    console.log('[oauth-return:/]', {
      hasCode: Boolean(req.query.code),
      hasError: Boolean(req.query.error),
      queryKeys: qKeys,
    });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * GET /auth-v2/callback.html — SSR PKCE exchange → Set-Cookie → redirect
 * (express.static 보다 먼저 등록 — Supabase Redirect URL 유지)
 */
app.get('/auth-v2/callback.html', requireSupabase, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  console.log('[oauth] callback received', {
    hasCode: Boolean(req.query && req.query.code),
    hasError: Boolean(req.query && req.query.error),
  });

  const oauthErr = req.query && (req.query.error || req.query.error_code);
  if (oauthErr) {
    console.log('[oauth] exchange failed:', String(oauthErr));
    return res
      .status(400)
      .type('text/html')
      .send(
        renderOAuthCallbackErrorHtml(
          String(oauthErr),
          req.query.error_description ? String(req.query.error_description) : '',
        ),
      );
  }

  const code = String((req.query && req.query.code) || '').trim();
  if (!code) {
    console.log('[oauth] exchange failed: NO_AUTH_CODE');
    return res.status(400).type('text/html').send(renderOAuthCallbackErrorHtml('NO_AUTH_CODE'));
  }

  try {
    const supabase = createRequestSupabaseClient(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (
      error ||
      !data?.session?.access_token ||
      !data?.user?.id
    ) {
      const errCode = (error && (error.code || error.name)) || 'EXCHANGE_FAILED';
      console.log('[oauth] exchange failed:', errCode);
      oauthDiag('oauth-callback', { result: 'FAIL', error: errCode });
      return res.status(401).type('text/html').send(renderOAuthCallbackErrorHtml(errCode));
    }

    console.log('[oauth] exchange success — cookie session set');
    oauthDiag('oauth-callback', {
      result: 'OK',
      hasUser: Boolean(data.user && data.user.id),
    });
    return res.redirect(302, '/');
  } catch (e) {
    console.log('[oauth] exchange failed: SERVER_ERROR');
    return res.status(500).type('text/html').send(renderOAuthCallbackErrorHtml('SERVER_ERROR'));
  }
});

if (String(process.env.SC_AUTH_COOKIE_TEST || '').trim() === '1') {
  /**
   * Test-only: establish cookie session (requires SC_TEST_AUTH_EMAIL/PASSWORD).
   */
  app.post('/api/auth/test/establish-session', requireSupabase, async (req, res) => {
    const email = String(process.env.SC_TEST_AUTH_EMAIL || '').trim();
    const password = String(process.env.SC_TEST_AUTH_PASSWORD || '');
    if (!email || !password) {
      return res.status(503).json({ ok: false, error: 'TEST_CREDENTIALS_MISSING' });
    }
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error || !data?.session?.access_token) {
      return res.status(401).json({ ok: false, error: 'TEST_SIGNIN_FAILED', message: error?.message });
    }
    const supabase = createRequestSupabaseClient(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    const { error: setErr } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (setErr) {
      return res.status(500).json({ ok: false, error: 'TEST_SET_SESSION_FAILED', message: setErr.message });
    }
    return res.json({ ok: true, user: data.user });
  });

  /**
   * Test-only: simulate callback success (Set-Cookie + redirect).
   */
  app.get('/api/auth/test/mock-callback-success', requireSupabase, async (req, res) => {
    const email = String(process.env.SC_TEST_AUTH_EMAIL || '').trim();
    const password = String(process.env.SC_TEST_AUTH_PASSWORD || '');
    if (!email || !password) {
      return res.status(503).type('text/html').send(renderOAuthCallbackErrorHtml('TEST_CREDENTIALS_MISSING'));
    }
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error || !data?.session?.access_token || !data?.user?.id) {
      return res.status(401).type('text/html').send(renderOAuthCallbackErrorHtml('TEST_SIGNIN_FAILED'));
    }
    const supabase = createRequestSupabaseClient(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    return res.redirect(302, '/');
  });
}

app.get('/auth/callback.html', (req, res, next) => {
  console.log('[oauth-callback-hit]', {
    hasCode: Boolean(req.query.code),
    hasError: Boolean(req.query.error),
    queryKeys: Object.keys(req.query || {}),
    hasPkceCookie: Boolean(readCookie(req, OAUTH_PKCE_COOKIE)),
    hasSidCookie: Boolean(readCookie(req, OAUTH_PKCE_SID_COOKIE)),
  });
  next();
});

// 데일리 이슈 관리자 검수 화면 1차 (사용자 UI 링크 없음 · 로그인 필요)
app.get(['/admin/daily-issues', '/admin/daily-issues/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'daily-issues', 'index.html'));
});
app.use(
  '/admin/daily-issues',
  express.static(path.join(__dirname, 'public', 'admin', 'daily-issues'), {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    },
  }),
);

app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('territory-layout.json') || filePath.endsWith('territory-hit-zones.json')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
      }
      if (/[/\\]auth[/\\].+\.html$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }),
);

// -----------------------------------------------------------------------------
// 404
// -----------------------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND', path: req.path });
  }
  return res.status(404).type('text/plain').send('Not Found');
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
});

function shouldOpenBrowserOnStart() {
  const flag = String(process.env.OPEN_BROWSER || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function tryOpenBrowser(port) {
  if (!shouldOpenBrowserOnStart()) return;
  const url = `http://localhost:${port}/`;
  const { exec } = require('child_process');
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, { windowsHide: true });
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

let morningSchedulerStop = null;

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[센텐스아레나] http://${HOST}:${PORT}/`);
  console.log(`- 헬스: http://${HOST}:${PORT}/health`);
  console.log(`- 레디: http://${HOST}:${PORT}/ready`);
  if (!supabaseAdmin) {
    console.log(
      '[안내] Supabase 미설정: .env 에 SUPABASE_URL, SUPABASE_ANON_KEY(또는 SUPABASE_PUBLISHABLE_KEY) 를 넣고 서버를 다시 시작하세요.',
    );
  } else {
    console.log(
      '[안내] Supabase Auth 클라이언트 준비 완료 (' +
        supabaseAuthConfig.keySource +
        ', 서버 사이드). service-role은 Auth 로그인 경로에 사용하지 않습니다.',
    );
  }
  tryOpenBrowser(PORT);

  // 데일리 이슈 아침판 정식 스케줄러 (기본 disabled · Asia/Seoul · collect/publish 분리)
  // 베타 정책: 단일 웹 인스턴스에서만 ENABLED=1. scale-out 전 worker 분리 필수.
  if (
    String(process.env.DAILY_ISSUE_MORNING_SCHEDULER_ENABLED || '').trim() === '1' ||
    String(process.env.DAILY_ISSUE_MORNING_SCHEDULER_ENABLED || '').trim().toLowerCase() === 'true'
  ) {
    try {
      const morningScheduler = require('./server/daily-issue-morning-scheduler-service');
      const started = morningScheduler.startMorningScheduler({
        repository: process.env.DAILY_ISSUE_REPOSITORY || 'json',
        schemaName: process.env.DAILY_ISSUE_DB_SCHEMA,
        intervalMs: 30000,
      });
      if (started.started) {
        morningSchedulerStop = started.stop || null;
        console.log('[daily-issue-morning-scheduler] enabled (Asia/Seoul collect 04:30 / publish 05:00)');
        console.log(
          '[daily-issue-morning-scheduler] policy: single web instance only; disable before horizontal scale-out',
        );
      }
    } catch (e) {
      console.error('[daily-issue-morning-scheduler] failed to start', e && e.message ? e.message : e);
    }
  } else if (String(process.env.DAILY_ISSUE_MORNING_AUTO_PUBLISH || '').trim() === '1') {
    console.log(
      '[daily-issue-morning] DAILY_ISSUE_MORNING_AUTO_PUBLISH is deprecated; set DAILY_ISSUE_MORNING_SCHEDULER_ENABLED=1',
    );
  }
});

const shutdown = createGracefulShutdown({
  timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000,
  server: httpServer,
  stopScheduler: function () {
    if (typeof morningSchedulerStop === 'function') {
      morningSchedulerStop();
      morningSchedulerStop = null;
    }
  },
  closePools: closeAllDailyIssuePools,
});
shutdown.attachSignals();
