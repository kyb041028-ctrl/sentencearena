'use strict';

/**
 * 데일리 이슈 관리자 API — Supabase Auth 기반 관리자 권한 가드
 *
 * 역할 공식 원본: app_metadata.role ∈ ADMIN/OWNER 만.
 * 인증 실패 → 401, 역할 부족 → 403 (전역 500으로 떨어지지 않도록 가드에서 응답).
 */

const { createClient } = require('@supabase/supabase-js');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');

const ADMIN_AUTH_PUBLIC_MESSAGE = Object.freeze({
  ADMIN_TOKEN_MISSING: 'Admin authorization required',
  ADMIN_TOKEN_INVALID: 'Admin authorization invalid',
  ADMIN_AUTH_NOT_CONFIGURED: 'Admin auth is not configured',
  ADMIN_ROLE_MISSING: 'Admin role is missing',
  ADMIN_ROLE_FORBIDDEN: 'Admin role is not allowed',
  QUERY_TOKEN_FORBIDDEN: 'Token must not be passed via query string',
});

function readAllowedRoles(options) {
  const opt = options || {};
  const src = Array.isArray(opt.allowedRoles) ? opt.allowedRoles : ['ADMIN', 'OWNER'];
  return src
    .map(function (v) {
      return String(v || '').trim().toUpperCase();
    })
    .filter(Boolean);
}

function normalizeRole(v) {
  return String(v || '')
    .trim()
    .toUpperCase();
}

/**
 * 관리자 역할 공식 원본: Supabase Auth app_metadata.role 만.
 * user_metadata / request body / 기타 필드는 절대 신뢰하지 않는다.
 */
function resolveUserRole(user) {
  const u = user || {};
  const appMeta = u.app_metadata || {};
  return normalizeRole(appMeta.role);
}

function extractBearer(req) {
  const h = String((req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : '';
}

/**
 * @returns {number|null} 401 | 403 | null(관리자 인증 오류 아님)
 */
function resolveAdminAuthHttpStatus(code) {
  const c = String(code || '');
  if (
    c === 'ADMIN_TOKEN_MISSING' ||
    c === 'ADMIN_TOKEN_INVALID' ||
    c === 'ADMIN_AUTH_NOT_CONFIGURED' ||
    c === 'ADMIN_TOKEN_NOT_CONFIGURED' ||
    c === 'UNAUTHORIZED'
  ) {
    return 401;
  }
  if (c === 'ADMIN_ROLE_MISSING' || c === 'ADMIN_ROLE_FORBIDDEN' || c === 'QUERY_TOKEN_FORBIDDEN' || c === 'FORBIDDEN') {
    return 403;
  }
  return null;
}

function adminAuthPublicMessage(code) {
  const c = String(code || '');
  return ADMIN_AUTH_PUBLIC_MESSAGE[c] || 'Request failed';
}

/**
 * 인증/권한 거부를 HTTP로 직접 응답. 처리했으면 true.
 * 응답 형식은 Daily Issue sendFail 과 호환 (error.code).
 */
function sendAdminAuthFailure(res, code) {
  const status = resolveAdminAuthHttpStatus(code);
  if (!status) return false;
  if (res.headersSent) return true;
  const requestId = (res.locals && res.locals.requestId) || null;
  res.status(status).json({
    ok: false,
    requestId: requestId,
    error: {
      code: String(code),
      message: adminAuthPublicMessage(code),
      details: null,
    },
  });
  return true;
}

function createUserClient(supabaseUrl, supabaseAnonKey, accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: 'Bearer ' + accessToken },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
  });
}

/**
 * Express middleware factory
 */
function createAdminAccessGuard(options) {
  const opt = options || {};
  const resolved = resolveSupabaseServerAuthConfig();
  const supabaseUrl = String(opt.supabaseUrl || resolved.url || '').trim();
  const supabaseAnonKey = String(opt.supabaseAnonKey || resolved.key || '').trim();
  const allowedRoles = readAllowedRoles(opt);
  const getUserFromAccessToken =
    typeof opt.getUserFromAccessToken === 'function' ? opt.getUserFromAccessToken : null;

  return async function adminAccessGuard(req, res, next) {
    function deny(code) {
      const err = new Error(code);
      err.code = code;
      err.status = resolveAdminAuthHttpStatus(code) || 401;
      // 전역 Express 500 핸들러로 가지 않도록 가드에서 바로 응답한다.
      // Daily Issue withAdminAuth 는 next(err) 를 기대할 수 있으므로,
      // 응답 후 next(err) 도 호출해 handleRouteError 가 headersSent 를 만나지 않게
      // → 응답만 하고 next 미호출이 안전 (이중 응답 방지).
      sendAdminAuthFailure(res, code);
      return;
    }

    try {
      if (!supabaseUrl || !supabaseAnonKey) {
        return deny('ADMIN_AUTH_NOT_CONFIGURED');
      }

      if (req.query && (req.query.token != null || req.query.access_token != null || req.query.api_token != null)) {
        return deny('QUERY_TOKEN_FORBIDDEN');
      }

      const accessToken = extractBearer(req);
      if (!accessToken) {
        return deny('ADMIN_TOKEN_MISSING');
      }

      let user = null;
      if (getUserFromAccessToken) {
        user = await getUserFromAccessToken(accessToken, req);
      } else {
        const userClient = createUserClient(supabaseUrl, supabaseAnonKey, accessToken);
        const userResp = await userClient.auth.getUser();
        user = userResp && userResp.data && userResp.data.user;
        if (userResp.error || !user) {
          return deny('ADMIN_TOKEN_INVALID');
        }
      }

      if (!user) {
        return deny('ADMIN_TOKEN_INVALID');
      }

      const role = resolveUserRole(user);
      if (!role) {
        return deny('ADMIN_ROLE_MISSING');
      }
      if (allowedRoles.indexOf(role) < 0) {
        return deny('ADMIN_ROLE_FORBIDDEN');
      }

      req.dailyIssueAdmin = {
        authenticated: true,
        mode: getUserFromAccessToken ? 'TEST_OR_INJECTED' : 'SUPABASE_AUTH',
        userId: user.id,
        email: user.email || '',
        role: role,
      };
      return next();
    } catch (e) {
      // getUser 등 예상치 못한 예외만 next — 진짜 500 경로 유지
      return next(e);
    }
  };
}

module.exports = {
  readAllowedRoles: readAllowedRoles,
  normalizeRole: normalizeRole,
  resolveUserRole: resolveUserRole,
  extractBearer: extractBearer,
  resolveAdminAuthHttpStatus: resolveAdminAuthHttpStatus,
  adminAuthPublicMessage: adminAuthPublicMessage,
  sendAdminAuthFailure: sendAdminAuthFailure,
  createAdminAccessGuard: createAdminAccessGuard,
};
