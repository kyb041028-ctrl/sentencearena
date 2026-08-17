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
 *   GET  /api/auth/me       — 현재 유저 (Bearer JWT)
 *   GET  /api/supabase-config — browser client publishable config
 *   GET  /api/me/profile    — public.profiles 한 줄 (Bearer, RLS)
 *   GET  /api/chat/messages — 채팅 목록 (room=global|territory, territoryId, afterId)
 *   POST /api/chat/messages — 채팅 전송 (인메모리·폴링용 베타)
 * =============================================================================
 */

'use strict';

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
const { createBoardService } = require('./server/board-service');
const { createBoardMemoryRepository } = require('./server/board-memory-repository');
const { createCanonicalUserContextAdapter } = require('./server/board-user-context-adapter');
const { createActivityNameRouter } = require('./server/activity-name-routes');
const CanonicalUserTerritoryCore = require('./shared/canonical-user-territory-core');
const userDataRoutes = require('./server/user-data-routes');
const userDataService = require('./server/user-data-service');
const userDataMemoryRepo = require('./server/user-data-memory-repository');
const { createAchievementPersistRouter } = require('./server/achievement-persist-routes');
const { createUserProgressionRouter } = require('./server/user-progression-routes');
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
const { resolveAlienModerationV1Enabled } = require('./server/alien-moderation-v1-flag');
const { createAlienModerationSupabaseRepository } = require('./server/alien-moderation-supabase-repository');
const { createAlienCitizenshipWriter } = require('./server/alien-citizenship-writer');
const { createBoardSupabaseRepository } = require('./server/board-supabase-repository');

const { resolveSupabaseServerAuthConfig } = require('./server/supabase-server-auth-config');
const { requireAuthenticatedUser } = require('./server/auth/require-authenticated-user');
const { resolveKakaoOAuthRedirect } = require('./server/auth/kakao-oauth-scopes');
const {
  fetchNormalizedNaverUserinfo,
} = require('./server/auth/naver-userinfo-proxy');
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

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
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
 * POST /api/auth/kakao-resolve-authorize
 * body: { authorizeUrl } — Supabase /auth/v1/authorize?provider=kakao…
 * browser PKCE는 그대로 두고 Kakao authorize URL의 scope만 정리한다.
 */
app.post('/api/auth/kakao-resolve-authorize', requireSupabase, async (req, res) => {
  try {
    const raw = req.body && req.body.authorizeUrl;
    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_REQUEST' });
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      return res.status(400).json({ ok: false, error: 'INVALID_URL' });
    }
    if (!/\.supabase\.co$/i.test(parsed.hostname) || parsed.pathname.indexOf('/auth/v1/authorize') === -1) {
      return res.status(400).json({ ok: false, error: 'INVALID_AUTHORIZE_URL' });
    }
    if (parsed.searchParams.get('provider') !== 'kakao') {
      return res.status(400).json({ ok: false, error: 'INVALID_PROVIDER' });
    }
    const url = await resolveKakaoOAuthRedirect(raw);
    if (/account_email/i.test(url)) {
      return res.status(502).json({ ok: false, error: 'SCOPE_FIX_FAILED' });
    }
    return res.json({ ok: true, url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'RESOLVE_FAILED' });
  }
});

/**
 * GET /api/auth/naver-userinfo
 * Supabase Custom OAuth2 Userinfo URL proxy.
 * Authorization: Bearer <Naver access_token> (not a Supabase JWT).
 * Flattens Naver response.id → OIDC-style { sub }.
 */
app.get('/api/auth/naver-userinfo', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await fetchNormalizedNaverUserinfo(req.get('authorization') || '');
    if (!result.ok) {
      return res.status(result.status || 502).json({
        error: result.error || 'NAVER_USERINFO_FAILED',
      });
    }
    return res.status(200).json(result.body);
  } catch (_) {
    return res.status(500).json({ error: 'NAVER_USERINFO_PROXY_FAILED' });
  }
});

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
 * GET /api/auth/me — Bearer session (Supabase JWT)
 */
app.get('/api/auth/me', requireSupabase, async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res, {
      url: supabaseUrl,
      key: supabaseAnonKey,
    });
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }
    return res.json({ ok: true, user: auth.user });
  } catch (e) {
    console.error('[me]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * GET /api/me/profile
 * — schema_profiles_identity_history.sql 의 public.profiles
 * — level / xp / expPercent: user_progression (ensure-on-read · ProfileFrame 공통)
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

    let level = null;
    let xp = null;
    let expPercent = null;
    let fame = null;
    try {
      const progression = require('./server/user-progression-service');
      const ensured = await progression.ensureAndGetProgression(uid);
      level = ensured.level;
      xp = ensured.xp;
      expPercent = ensured.expPercent;
      fame = ensured.fame;
      console.log(
        '[profile] progression',
        String(uid).slice(0, 8),
        'level=' + level,
        'xp=' + xp,
        'expPercent=' + expPercent,
        'fame=' + fame,
      );
    } catch (progErr) {
      console.warn('[profile] progression ensure skipped:', progErr && progErr.message ? progErr.message : progErr);
    }

    let activityStats = null;
    try {
      const activityService = require('./server/user-activity-stats-service');
      activityStats = await activityService.loadActivityStats(uid);
      console.log(
        '[profile] activity',
        String(uid).slice(0, 8),
        'posts=' + activityStats.posts,
        'comments=' + activityStats.comments,
        'receivedLikes=' + activityStats.receivedLikes,
        'discussions=' + activityStats.discussions,
      );
    } catch (actErr) {
      console.warn('[profile] activity stats skipped:', actErr && actErr.message ? actErr.message : actErr);
    }

    let territory = null;
    try {
      const parsed = CanonicalUserTerritoryCore.normalizeCanonicalMembershipTerritory(
        profile && profile.territory,
      );
      if (parsed.ok) territory = parsed.territory;
    } catch (_) {
      territory = null;
    }

    return res.json({ ok: true, profile, level, xp, expPercent, fame, activityStats, territory });
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

/** Browser Supabase client — publishable/anon key only (no secrets) */
app.get('/api/supabase-config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!supabaseAuthConfig.configured) {
    return res.status(503).json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
  }
  return res.json({
    ok: true,
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  });
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
app.use('/api', createActivityNameRouter());
/** 실회원 업적 영구 저장 — user-data USER_DATA_OPERATIONAL 과 독립 · 동일 테이블/RPC 재사용 */
app.use('/api', createAchievementPersistRouter());
/** ProfileFrame LEVEL — user_progression ensure-on-read (USER_DATA_OPERATIONAL 독립) */
app.use('/api', createUserProgressionRouter());
app.use('/api', userDataRoutes);
app.use('/api', userContentRoutes);

// 영토 발전 API — production 기본 비활성. 개발은 Earth profiles.territory count.
(function () {
  const tevoMode = (process.env.TERRITORY_EVOLUTION_MODE || 'LEGACY_LOCAL').trim().toUpperCase();
  const tevoOperational = String(process.env.TERRITORY_EVOLUTION_OPERATIONAL || '').trim() === 'true';
  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const enableEarthPopulationRead = tevoOperational || !isProduction;
  if (enableEarthPopulationRead) {
    try {
      const { getAlignmentSupabaseAdminClient } = require('./server/alignment-supabase-admin');
      const supabasePopRepo = require('./server/territory-population-supabase-repository');
      supabasePopRepo.setAdminClient(getAlignmentSupabaseAdminClient());
      territoryPopulationAdapter.setRepository(supabasePopRepo);
      territoryEvolutionService.setDataMode('API_OPERATIONAL');
      console.log(
        '[territory-evolution] 모드: API_OPERATIONAL — Earth count excludes KANTAPBIYA_RESIDENT · ALIEN = citizenship count · snapshot persist 비활성',
      );
      return;
    } catch (e) {
      console.log(
        '[territory-evolution] Earth count 연결 실패, Mock fallback:',
        (e && e.code) || (e && e.message) || 'UNKNOWN',
      );
    }
  }
  territoryPopulationAdapter.setRepository(territoryPopulationMemoryRepo);
  territoryEvolutionService.setDataMode(
    tevoMode === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL',
  );
  console.log(
    '[territory-evolution] 모드:',
    territoryEvolutionService.getDataMode(),
    '— TERRITORY_EVOLUTION_NOT_ACTIVATED (운영 비활성)',
  );
})();
app.use('/api', territoryEvolutionRoutes);

// 외계 시스템 API — development 기본 ON, production 기본 OFF (환경변수 없으면 자동 ON 금지)
(function () {
  const alienMode = (process.env.ALIEN_DATA_MODE || 'LEGACY_LOCAL').trim().toUpperCase();
  const alienOperational = String(process.env.ALIEN_SYSTEM_OPERATIONAL || '').trim() === 'true';
  const alienModerationV1 = resolveAlienModerationV1Enabled();
  const resolved = alienOperational ? 'LEGACY_LOCAL' : alienMode;
  let alienRepo = alienModerationMemoryRepo;
  if (alienModerationV1) {
    try {
      const { getAlignmentSupabaseAdminClient } = require('./server/alignment-supabase-admin');
      const adminClient = getAlignmentSupabaseAdminClient();
      alienRepo = createAlienModerationSupabaseRepository({ client: adminClient });
      alienModerationService.setCitizenshipWriter(createAlienCitizenshipWriter(adminClient));
      alienModerationService.setBoardReportReader(createBoardSupabaseRepository({ client: adminClient }));
      console.log('[alien-system] persist: supabase user_moderation_* + profiles.citizenship_status');
    } catch (e) {
      console.log(
        '[alien-system] supabase persist 연결 실패, memory fallback:',
        (e && e.code) || (e && e.message) || 'UNKNOWN',
      );
      alienRepo = alienModerationMemoryRepo;
    }
  }
  alienModerationService.setRepository(alienRepo);
  alienModerationService.setDataMode(resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  alienModerationService.setV1Enabled(alienModerationV1);
  alienObservationService.setRepository(alienObservationMemoryRepo);
  alienObservationService.setDataMode(resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  alienRankService.setRepository(alienRankMemoryRepo);
  alienRankService.setDataMode(resolved === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL');
  console.log('[alien-system] 모드:', alienModerationService.getDataMode(),
    alienModerationV1
      ? '— ALIEN_MODERATION_V1 persist+simple-report auto (political score unused)'
      : '— ALIEN_SYSTEM_NOT_ACTIVATED (운영·자동판정·실이동 비활성)');
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

// 게시판 API — board_posts migration 적용 후 BOARD_OPERATIONAL=true
const boardDevMemory = String(process.env.BOARD_DEV_MEMORY || '').trim() === 'true';
const sharedBoardMemory = boardDevMemory ? createBoardMemoryRepository() : null;
if (sharedBoardMemory) {
  alienModerationService.setBoardReportReader(sharedBoardMemory);
}
app.use(
  '/api/board',
  createBoardRouter({
    supabaseUrl,
    supabaseAnonKey,
    createUserClient,
    repository: sharedBoardMemory || undefined,
    onReportCreated: function (row) {
      return alienModerationService.onReportCreated(row);
    },
    resolveActorFromRequest: async (req, res) => {
      const auth = await requireAuthenticatedUser(req, res, {
        url: supabaseUrl,
        key: supabaseAnonKey,
      });
      if (!auth.ok || !auth.user?.id) return null;
      return { userId: auth.user.id, supabase: auth.supabase };
    },
    operational: String(process.env.BOARD_OPERATIONAL || '').trim() === 'true',
    useMemory: boardDevMemory,
    userContext:
      String(process.env.BOARD_OPERATIONAL || '').trim() === 'true'
        ? createCanonicalUserContextAdapter()
        : undefined,
  }),
);
app.use(
  '/api/admin/moderation',
  alienModerationRoutes.mountAdminRoutes({
    adminBypass: String(process.env.ALIEN_MODERATION_ADMIN_BYPASS || '').trim() === 'true',
    adminAuth: { supabaseUrl: supabaseUrl, supabaseAnonKey: supabaseAnonKey },
    getBoardService: function () {
      if (sharedBoardMemory) {
        return createBoardService({
          repository: sharedBoardMemory,
          operational: true,
          onReportCreated: function (row) {
            return alienModerationService.onReportCreated(row);
          },
        });
      }
      try {
        const { getAlignmentSupabaseAdminClient } = require('./server/alignment-supabase-admin');
        return createBoardService({
          repository: createBoardSupabaseRepository({ client: getAlignmentSupabaseAdminClient() }),
          operational: true,
          onReportCreated: function (row) {
            return alienModerationService.onReportCreated(row);
          },
        });
      } catch (_) {
        return null;
      }
    },
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
      resolveActorFromRequest: async (req, res) => {
        const auth = await requireAuthenticatedUser(req, res, {
          url: supabaseUrl,
          key: supabaseAnonKey,
        });
        if (!auth.ok || !auth.user?.id) return null;
        return { userId: auth.user.id, supabase: auth.supabase };
      },
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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
let alignmentSchedulerStop = null;

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

  // 정치성향 05:00/17:00 Asia/Seoul (기본 disabled). 점수 공식은 persist service SSOT.
  // missed catch-up 없음. 다중 인스턴스 최종 lock은 alignment_batches.batch_id + apply RPC.
  if (
    String(process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED || '').trim() === '1' ||
    String(process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED || '').trim().toLowerCase() === 'true'
  ) {
    try {
      const alignmentScheduler = require('./server/political-alignment-scheduler-service');
      const started = alignmentScheduler.startAlignmentScheduler({
        intervalMs: Number(process.env.POLITICAL_ALIGNMENT_SCHEDULER_INTERVAL_MS) || 10000,
      });
      if (started.started) {
        alignmentSchedulerStop = started.stop || null;
        console.log('[political-alignment-scheduler] enabled (Asia/Seoul 05:00 / 17:00)');
        console.log(
          '[political-alignment-scheduler] policy: DB batch_id idempotency; missed-batch catch-up PENDING',
        );
      }
    } catch (e) {
      console.error('[political-alignment-scheduler] failed to start', e && e.message ? e.message : e);
    }
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
    if (typeof alignmentSchedulerStop === 'function') {
      alignmentSchedulerStop();
      alignmentSchedulerStop = null;
    }
  },
  closePools: closeAllDailyIssuePools,
});
shutdown.attachSignals();
