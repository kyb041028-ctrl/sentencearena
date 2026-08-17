'use strict';

/**
 * production 부트 게이트 — 개발 전용 플래그·JSON repository fail-closed/경고
 * Canonical public origin: https://sentencearena.com
 */

const CANONICAL_PRODUCTION_PUBLIC_ORIGIN = 'https://sentencearena.com';

function readEnv(name, env) {
  const src = env || process.env;
  return String(src[name] || '').trim();
}

function isTruthy(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function normalizeOrigin(origin) {
  return String(origin || '')
    .trim()
    .replace(/\/$/, '');
}

function isLocalOrWildcardOrigin(origin) {
  const o = normalizeOrigin(origin).toLowerCase();
  if (!o) return false;
  if (o === '*') return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o)) return true;
  if (/^https?:\/\/.*\.local(:\d+)?$/i.test(o)) return true;
  return false;
}

function isHttpsOrigin(origin) {
  return /^https:\/\/[^/\s]+$/i.test(normalizeOrigin(origin));
}

function sanitizeReadyError(code) {
  const allowed = {
    DATABASE_UNAVAILABLE: true,
    SCHEMA_NOT_PROVISIONED: true,
    REPOSITORY_NOT_DB: true,
    DAILY_ISSUE_DATABASE_URL_MISSING: true,
    HEALTH_FAILED: true,
    READY_CHECK_FAILED: true,
  };
  const c = String(code || '').trim();
  if (allowed[c]) return c;
  if (/DATABASE_UNAVAILABLE/i.test(c)) return 'DATABASE_UNAVAILABLE';
  if (/SCHEMA/i.test(c) && /PROVISION|MISSING|NOT_FOUND/i.test(c)) return 'SCHEMA_NOT_PROVISIONED';
  return 'READY_CHECK_FAILED';
}

/**
 * @returns {{ ok: boolean, fatal: Array, warnings: Array }}
 */
function evaluateProductionBootGuards(env) {
  const src = env || process.env;
  const nodeEnv = readEnv('NODE_ENV', src).toLowerCase();
  const fatal = [];
  const warnings = [];

  if (nodeEnv !== 'production') {
    return { ok: true, skipped: true, fatal: [], warnings: [], nodeEnv: nodeEnv || '' };
  }

  const repo = readEnv('DAILY_ISSUE_REPOSITORY', src).toLowerCase() || 'json';
  if (repo !== 'db') {
    fatal.push({
      code: 'PRODUCTION_JSON_REPOSITORY_FORBIDDEN',
      message: 'production requires DAILY_ISSUE_REPOSITORY=db (JSON/.cache persistence forbidden)',
    });
  }

  const schema = readEnv('DAILY_ISSUE_DB_SCHEMA', src);
  if (!schema || schema === 'public' || /^daily_issue_test/i.test(schema) || /^daily_issue_dev/i.test(schema)) {
    fatal.push({
      code: 'PRODUCTION_SCHEMA_FORBIDDEN',
      message: 'production requires DAILY_ISSUE_DB_SCHEMA=daily_issue',
      schema: schema || '',
    });
  } else if (schema !== 'daily_issue') {
    fatal.push({
      code: 'PRODUCTION_SCHEMA_NOT_DAILY_ISSUE',
      message: 'production schema must be exactly daily_issue',
      schema: schema,
    });
  }

  if (isTruthy(readEnv('DAILY_ISSUE_ALLOW_TEST_RESET', src))) {
    fatal.push({
      code: 'PRODUCTION_TEST_RESET_FORBIDDEN',
      message: 'DAILY_ISSUE_ALLOW_TEST_RESET must not be enabled in production',
    });
  }

  if (isTruthy(readEnv('DAILY_ISSUE_APPLY_MIGRATION_IN_TEST', src))) {
    fatal.push({
      code: 'PRODUCTION_TEST_MIGRATION_FLAG_FORBIDDEN',
      message: 'DAILY_ISSUE_APPLY_MIGRATION_IN_TEST must not be enabled in production',
    });
  }

  if (readEnv('DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE', src)) {
    fatal.push({
      code: 'PRODUCTION_RUN_KEY_NAMESPACE_FORBIDDEN',
      message: 'DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE must be empty in production',
    });
  }

  if (readEnv('DAILY_ISSUE_ADMIN_API_TOKEN', src)) {
    warnings.push({
      code: 'LEGACY_ADMIN_TOKEN_PRESENT',
      message: 'DAILY_ISSUE_ADMIN_API_TOKEN is legacy and unused for Auth; remove from production env',
    });
  }

  if (isTruthy(readEnv('BOARD_DEV_MEMORY', src))) {
    fatal.push({
      code: 'PRODUCTION_BOARD_DEV_MEMORY_FORBIDDEN',
      message: 'BOARD_DEV_MEMORY must not be enabled in production',
    });
  }

  if (isTruthy(readEnv('OPEN_BROWSER', src))) {
    fatal.push({
      code: 'PRODUCTION_OPEN_BROWSER_FORBIDDEN',
      message: 'OPEN_BROWSER must not be enabled in production',
    });
  }

  if (isTruthy(readEnv('ALIGNMENT_LIVE_VERIFY', src))) {
    fatal.push({
      code: 'PRODUCTION_ALIGNMENT_LIVE_VERIFY_FORBIDDEN',
      message: 'ALIGNMENT_LIVE_VERIFY must not be enabled in production',
    });
  }

  if (isTruthy(readEnv('ALIEN_MODERATION_ADMIN_BYPASS', src))) {
    fatal.push({
      code: 'PRODUCTION_ALIEN_ADMIN_BYPASS_FORBIDDEN',
      message: 'ALIEN_MODERATION_ADMIN_BYPASS must not be enabled in production',
    });
  }

  if (readEnv('BOARD_OPERATIONAL', src) !== 'true') {
    fatal.push({
      code: 'PRODUCTION_BOARD_NOT_OPERATIONAL',
      message: 'production requires BOARD_OPERATIONAL=true',
    });
  }

  if (readEnv('TERRITORY_EVOLUTION_OPERATIONAL', src) !== 'true') {
    fatal.push({
      code: 'PRODUCTION_TERRITORY_EVOLUTION_NOT_OPERATIONAL',
      message: 'production requires TERRITORY_EVOLUTION_OPERATIONAL=true',
    });
  }

  const publicOrigin = normalizeOrigin(readEnv('APP_PUBLIC_ORIGIN', src));
  if (!publicOrigin) {
    fatal.push({
      code: 'PRODUCTION_PUBLIC_ORIGIN_REQUIRED',
      message: 'production requires APP_PUBLIC_ORIGIN=' + CANONICAL_PRODUCTION_PUBLIC_ORIGIN,
    });
  } else if (isLocalOrWildcardOrigin(publicOrigin) || !isHttpsOrigin(publicOrigin)) {
    fatal.push({
      code: 'PRODUCTION_PUBLIC_ORIGIN_INVALID',
      message: 'production APP_PUBLIC_ORIGIN cannot be localhost, http, or wildcard',
    });
  } else if (publicOrigin !== CANONICAL_PRODUCTION_PUBLIC_ORIGIN) {
    fatal.push({
      code: 'PRODUCTION_PUBLIC_ORIGIN_NOT_CANONICAL',
      message: 'production APP_PUBLIC_ORIGIN must be ' + CANONICAL_PRODUCTION_PUBLIC_ORIGIN,
    });
  }

  const schedulerOn = isTruthy(readEnv('DAILY_ISSUE_MORNING_SCHEDULER_ENABLED', src));
  if (schedulerOn) {
    warnings.push({
      code: 'SCHEDULER_SINGLE_INSTANCE_POLICY',
      message:
        'Morning scheduler enabled: run exactly one web instance. First open-beta deploy keeps this OFF until smoke passes.',
    });
  }

  if (isTruthy(readEnv('POLITICAL_ALIGNMENT_SCHEDULER_ENABLED', src))) {
    warnings.push({
      code: 'POLITICAL_SCHEDULER_ENABLED',
      message: 'Political alignment scheduler is ON. First open-beta deploy keeps this OFF until smoke passes.',
    });
  }

  if (isTruthy(readEnv('ALIEN_MODERATION_V1', src))) {
    warnings.push({
      code: 'ALIEN_MODERATION_ENABLED',
      message: 'ALIEN_MODERATION_V1 is ON. First open-beta deploy keeps this OFF until smoke passes.',
    });
  }

  return {
    ok: fatal.length === 0,
    skipped: false,
    fatal: fatal,
    warnings: warnings,
    nodeEnv: 'production',
    publicOrigin: publicOrigin || '',
  };
}

function assertProductionBootGuardsOrThrow(env) {
  const result = evaluateProductionBootGuards(env);
  if (result.skipped) return result;
  (result.warnings || []).forEach(function (w) {
    console.warn('[boot-guard:warn]', w.code, w.message);
  });
  if (!result.ok) {
    const err = new Error('PRODUCTION_BOOT_GUARD_FAILED');
    err.code = 'PRODUCTION_BOOT_GUARD_FAILED';
    err.fatal = result.fatal;
    throw err;
  }
  return result;
}

module.exports = {
  CANONICAL_PRODUCTION_PUBLIC_ORIGIN: CANONICAL_PRODUCTION_PUBLIC_ORIGIN,
  evaluateProductionBootGuards: evaluateProductionBootGuards,
  assertProductionBootGuardsOrThrow: assertProductionBootGuardsOrThrow,
  normalizeOrigin: normalizeOrigin,
  sanitizeReadyError: sanitizeReadyError,
};
