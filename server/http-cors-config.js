'use strict';

/**
 * HTTP CORS allowlist (전역 + 데일리 이슈 라우터 공유)
 * production: DAILY_ISSUE_API_CORS_ORIGINS / APP_PUBLIC_ORIGIN 만
 * development: 위 목록 + localhost:3000 / 127.0.0.1:3000
 */

function readEnv(name, env) {
  const src = env || process.env;
  return String(src[name] || '').trim();
}

function isProductionEnv(env) {
  return readEnv('NODE_ENV', env).toLowerCase() === 'production';
}

function normalizeOrigin(origin) {
  return String(origin || '')
    .trim()
    .replace(/\/$/, '');
}

function resolveCorsAllowlist(env) {
  const src = env || process.env;
  const raw = readEnv('DAILY_ISSUE_API_CORS_ORIGINS', src) || readEnv('APP_PUBLIC_ORIGIN', src);
  const list = raw
    ? raw
        .split(',')
        .map(function (s) {
          return normalizeOrigin(s);
        })
        .filter(Boolean)
    : [];

  if (!isProductionEnv(src)) {
    ['http://localhost:3000', 'http://127.0.0.1:3000'].forEach(function (o) {
      if (list.indexOf(o) < 0) list.push(o);
    });
  }

  return list;
}

function isOriginAllowed(origin, env) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  const allow = resolveCorsAllowlist(env);
  return allow.indexOf(normalized) >= 0;
}

/**
 * cors 패키지용 origin 콜백
 * — Origin 없음(curl/same-origin): 허용
 * — allowlist 외: 거부 (에러 메시지에 비밀/스택 없음)
 */
function createCorsOriginCallback(env) {
  return function corsOrigin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (isOriginAllowed(origin, env)) {
      return callback(null, true);
    }
    return callback(null, false);
  };
}

function createExpressCorsOptions(env) {
  return {
    origin: createCorsOriginCallback(env),
    credentials: true,
    optionsSuccessStatus: 204,
  };
}

module.exports = {
  resolveCorsAllowlist: resolveCorsAllowlist,
  isOriginAllowed: isOriginAllowed,
  createCorsOriginCallback: createCorsOriginCallback,
  createExpressCorsOptions: createExpressCorsOptions,
  isProductionEnv: isProductionEnv,
  normalizeOrigin: normalizeOrigin,
};
