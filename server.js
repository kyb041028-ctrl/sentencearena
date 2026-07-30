/**
 * =============================================================================
 * 센텐스크래프트 Ver 1.0 베타 — 백엔드 서버 (server.js) + Supabase 연동
 * =============================================================================
 *
 * 【환경변수】
 * - `.env`에 SUPABASE_URL, SUPABASE_ANON_KEY 를 넣으세요. (소스에 직접 쓰지 마세요.)
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
 *   POST /api/auth/signout  — 로그아웃 (Authorization: Bearer <access_token>)
 *   POST /api/auth/refresh  — 세션 갱신 (body: { refresh_token })
 *   GET  /api/auth/me       — 현재 유저 (Bearer)
 *   GET  /api/auth/oauth/:provider — 소셜 로그인 시작 (google|apple|kakao|naver) → 302
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

const { createBoardRouter } = require('./server/board-routes');
const userDataRoutes = require('./server/user-data-routes');
const userDataService = require('./server/user-data-service');
const userDataMemoryRepo = require('./server/user-data-memory-repository');
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

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
const PORT = Number(process.env.PORT) || 3000;

/** 서버 전용(세션 없이 가입/로그인 호출) — anon 키 */
let supabaseAdmin = null;
if (supabaseUrl && supabaseAnonKey) {
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
  if (!supabaseUrl || !supabaseAnonKey) return null;
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

const app = express();

/** 리버스 프록시 뒤에서 `x-forwarded-proto` 를 쓰려면 `.env` 에 TRUST_PROXY=1 */
if (String(process.env.TRUST_PROXY || '').trim() === '1') {
  app.set('trust proxy', 1);
}

/** CORS: 로컬 개발에서 브라우저가 API를 부를 수 있게 */
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
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
      message: '.env 에 SUPABASE_URL 과 SUPABASE_ANON_KEY 를 설정한 뒤 서버를 다시 시작하세요.',
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
 * — Supabase가 로그인 후 redirectTo 로 돌려보냄 (fragment에 access_token 등).
 */
app.get('/api/auth/oauth/:provider', requireSupabase, async (req, res) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase().trim();
    if (!OAUTH_PROVIDERS.has(provider)) {
      return res.status(400).json({ ok: false, error: 'UNKNOWN_OAUTH_PROVIDER' });
    }

    const origin = getPublicOrigin(req);
    const redirectTo = `${origin}/auth/callback.html`;

    const { data, error } = await supabaseAdmin.auth.signInWithOAuth({
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

    return res.redirect(302, url);
  } catch (e) {
    console.error('[oauth]', e);
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
 * POST /api/auth/signout
 * header: Authorization: Bearer <access_token>
 */
app.post('/api/auth/signout', requireSupabase, async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'NO_ACCESS_TOKEN' });
    }

    const userClient = createUserClient(token);
    if (!userClient) {
      return res.status(500).json({ ok: false, error: 'CLIENT_INIT_FAILED' });
    }

    const { error } = await userClient.auth.signOut();

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
 * GET /api/auth/me
 * header: Authorization: Bearer <access_token>
 */
app.get('/api/auth/me', requireSupabase, async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'NO_ACCESS_TOKEN' });
    }

    const userClient = createUserClient(token);
    if (!userClient) {
      return res.status(500).json({ ok: false, error: 'CLIENT_INIT_FAILED' });
    }

    const { data, error } = await userClient.auth.getUser();

    if (error || !data?.user) {
      return res.status(401).json({ ok: false, error: 'INVALID_TOKEN', message: error?.message });
    }

    return res.json({ ok: true, user: data.user });
  } catch (e) {
    console.error('[me]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

/**
 * GET /api/me/profile
 * — schema_profiles_identity_history.sql 의 public.profiles
 */
app.get('/api/me/profile', requireSupabase, async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'NO_ACCESS_TOKEN' });
    }

    const userClient = createUserClient(token);
    if (!userClient) {
      return res.status(500).json({ ok: false, error: 'CLIENT_INIT_FAILED' });
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
    }

    const uid = userData.user.id;

    const { data: profile, error: pErr } = await userClient.from('profiles').select('*').eq('id', uid).maybeSingle();

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
    const { data, error } = await userClient.auth.getUser();
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
    service: 'sentence-craft-api',
    time: new Date().toISOString(),
    supabaseConfigured: Boolean(supabaseAdmin),
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
    operational: String(process.env.BOARD_OPERATIONAL || '').trim() === 'true',
    useMemory: String(process.env.BOARD_DEV_MEMORY || '').trim() === 'true',
  }),
);

// -----------------------------------------------------------------------------
// 프론트 — public 폴더 (화면 파일은 여기만 두면 덜 꼬입니다)
// -----------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('territory-layout.json') || filePath.endsWith('territory-hit-zones.json')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
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

app.listen(PORT, () => {
  console.log(`[센텐스크래프트] http://localhost:${PORT}/`);
  console.log(`- 헬스: http://localhost:${PORT}/health`);
  if (!supabaseAdmin) {
    console.log('[안내] Supabase 미설정: .env 에 SUPABASE_URL, SUPABASE_ANON_KEY 를 넣고 서버를 다시 시작하세요.');
  } else {
    console.log('[안내] Supabase 클라이언트 준비 완료 (anon, 서버 사이드).');
  }
  tryOpenBrowser(PORT);
});
