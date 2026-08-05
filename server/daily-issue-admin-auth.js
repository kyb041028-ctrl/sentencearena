'use strict';

/**
 * 데일리 이슈 관리자 API — 개발용 비밀 토큰 가드
 * 정식 관리자 인증은 후속. 토큰 원문 로그 금지.
 */

const crypto = require('crypto');

function readAdminToken(options) {
  const opt = options || {};
  if (Object.prototype.hasOwnProperty.call(opt, 'token')) {
    return String(opt.token || '').trim();
  }
  return String(process.env.DAILY_ISSUE_ADMIN_API_TOKEN || '').trim();
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    // still compare to keep rough timing shape
    const dummy = Buffer.alloc(left.length || 1);
    crypto.timingSafeEqual(dummy, dummy);
    return false;
  }
  if (left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractBearer(req) {
  const h = String((req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : '';
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex').slice(0, 12);
}

/**
 * Express middleware factory
 */
function createAdminTokenGuard(options) {
  const expected = readAdminToken(options);
  const warnProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  return function adminTokenGuard(req, res, next) {
    if (warnProduction && !(options && options.allowProductionTempGuard === true)) {
      // Temporary guard must not be mistaken for production auth.
      res.setHeader('X-Daily-Issue-Admin-Auth', 'TEMP_DEV_TOKEN');
    }

    if (req.query && (req.query.token != null || req.query.access_token != null || req.query.api_token != null)) {
      const err = new Error('QUERY_TOKEN_FORBIDDEN');
      err.code = 'QUERY_TOKEN_FORBIDDEN';
      return next(err);
    }

    if (!expected) {
      const err = new Error('ADMIN_TOKEN_NOT_CONFIGURED');
      err.code = 'ADMIN_TOKEN_NOT_CONFIGURED';
      return next(err);
    }

    const provided = extractBearer(req);
    if (!provided) {
      const err = new Error('ADMIN_TOKEN_MISSING');
      err.code = 'ADMIN_TOKEN_MISSING';
      return next(err);
    }

    if (!timingSafeEqualString(provided, expected)) {
      const err = new Error('ADMIN_TOKEN_INVALID');
      err.code = 'ADMIN_TOKEN_INVALID';
      return next(err);
    }

    req.dailyIssueAdmin = {
      authenticated: true,
      tokenFingerprint: tokenFingerprint(provided),
      mode: 'TEMP_DEV_TOKEN',
    };
    return next();
  };
}

module.exports = {
  readAdminToken: readAdminToken,
  timingSafeEqualString: timingSafeEqualString,
  extractBearer: extractBearer,
  tokenFingerprint: tokenFingerprint,
  createAdminTokenGuard: createAdminTokenGuard,
};
