'use strict';

/**
 * 데일리 이슈 관리자 API — Supabase Auth 기반 관리자 권한 가드
 */

const { createClient } = require('@supabase/supabase-js');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');

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

  return async function adminAccessGuard(req, res, next) {
    if (!supabaseUrl || !supabaseAnonKey) {
      const cfgErr = new Error('ADMIN_AUTH_NOT_CONFIGURED');
      cfgErr.code = 'ADMIN_AUTH_NOT_CONFIGURED';
      return next(cfgErr);
    }

    if (req.query && (req.query.token != null || req.query.access_token != null || req.query.api_token != null)) {
      const err = new Error('QUERY_TOKEN_FORBIDDEN');
      err.code = 'QUERY_TOKEN_FORBIDDEN';
      return next(err);
    }

    const accessToken = extractBearer(req);
    if (!accessToken) {
      const err = new Error('ADMIN_TOKEN_MISSING');
      err.code = 'ADMIN_TOKEN_MISSING';
      return next(err);
    }

    const userClient = createUserClient(supabaseUrl, supabaseAnonKey, accessToken);
    const userResp = await userClient.auth.getUser();
    const user = userResp && userResp.data && userResp.data.user;
    if (userResp.error || !user) {
      const err = new Error('ADMIN_TOKEN_INVALID');
      err.code = 'ADMIN_TOKEN_INVALID';
      return next(err);
    }

    const role = resolveUserRole(user);
    if (!role) {
      const roleErr = new Error('ADMIN_ROLE_MISSING');
      roleErr.code = 'ADMIN_ROLE_MISSING';
      return next(roleErr);
    }
    if (allowedRoles.indexOf(role) < 0) {
      const denyErr = new Error('ADMIN_ROLE_FORBIDDEN');
      denyErr.code = 'ADMIN_ROLE_FORBIDDEN';
      return next(denyErr);
    }

    req.dailyIssueAdmin = {
      authenticated: true,
      mode: 'SUPABASE_AUTH',
      userId: user.id,
      email: user.email || '',
      role: role,
    };
    return next();
  };
}

module.exports = {
  readAllowedRoles: readAllowedRoles,
  normalizeRole: normalizeRole,
  resolveUserRole: resolveUserRole,
  extractBearer: extractBearer,
  createAdminAccessGuard: createAdminAccessGuard,
};
