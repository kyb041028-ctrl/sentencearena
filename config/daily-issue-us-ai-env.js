'use strict';

/**
 * US Daily Issue AI — server env only (never expose to browser).
 */

function trim(v) {
  return String(v == null ? '' : v).trim();
}

function readUsAiEnv(env) {
  const e = env || process.env;
  const apiKey = trim(e.DAILY_ISSUE_US_AI_API_KEY || e.OPENAI_API_KEY);
  const model = trim(e.DAILY_ISSUE_US_AI_MODEL || e.OPENAI_MODEL || 'gpt-4o-mini');
  const enabledFlag = trim(e.DAILY_ISSUE_US_AI_ENABLED).toLowerCase();
  const explicitlyOff = enabledFlag === '0' || enabledFlag === 'false';
  const configured = !explicitlyOff && apiKey.length > 0;
  return {
    provider: 'openai',
    apiKey: apiKey,
    model: model,
    configured: configured,
    blockedReason: configured ? null : explicitlyOff ? 'DISABLED_BY_FLAG' : 'BLOCKED_NOT_CONFIGURED',
    timeoutMs: Math.min(Math.max(Number(e.DAILY_ISSUE_US_AI_TIMEOUT_MS) || 45000, 5000), 120000),
    maxRetries: Math.min(Math.max(Number(e.DAILY_ISSUE_US_AI_MAX_RETRIES) || 1, 0), 3),
    maxCallsPerRun: Math.min(Math.max(Number(e.DAILY_ISSUE_US_AI_MAX_CALLS_PER_RUN) || 1, 1), 5),
    maxEstimatedUsdPerRun: Math.max(Number(e.DAILY_ISSUE_US_AI_MAX_USD_PER_RUN) || 0.08, 0),
    liveTestAllowed:
      trim(e.DAILY_ISSUE_US_AI_ISOLATED_LIVE_TEST).toLowerCase() === '1' ||
      trim(e.DAILY_ISSUE_US_AI_ISOLATED_LIVE_TEST).toLowerCase() === 'true',
  };
}

module.exports = {
  readUsAiEnv: readUsAiEnv,
};
