'use strict';

/**
 * production 부트 게이트 — 개발 전용 플래그·JSON repository fail-closed/경고
 */

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
    warnings.push({
      code: 'BOARD_DEV_MEMORY_PRESENT',
      message: 'BOARD_DEV_MEMORY should not be set in production',
    });
  }

  if (isTruthy(readEnv('OPEN_BROWSER', src))) {
    warnings.push({
      code: 'OPEN_BROWSER_PRESENT',
      message: 'OPEN_BROWSER should not be set in production',
    });
  }

  const schedulerOn =
    isTruthy(readEnv('DAILY_ISSUE_MORNING_SCHEDULER_ENABLED', src));
  if (schedulerOn) {
    warnings.push({
      code: 'SCHEDULER_SINGLE_INSTANCE_POLICY',
      message:
        'Morning scheduler enabled: run exactly one web instance. Before scale-out, disable web scheduler and use a dedicated worker.',
    });
  }

  return {
    ok: fatal.length === 0,
    skipped: false,
    fatal: fatal,
    warnings: warnings,
    nodeEnv: 'production',
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
  evaluateProductionBootGuards: evaluateProductionBootGuards,
  assertProductionBootGuardsOrThrow: assertProductionBootGuardsOrThrow,
};
