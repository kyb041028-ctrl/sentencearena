'use strict';

/**
 * Daily Issue AI — shared env (server only). KR/US overrides on common defaults.
 */

function trim(v) {
  return String(v == null ? '' : v).trim();
}

function flagOn(e, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const raw = trim(e[keys[i]]).toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
  }
  return null;
}

function normalizeRegion(region) {
  const r = String(region || 'KR').trim().toUpperCase();
  return r === 'US' ? 'US' : 'KR';
}

function readRegionAiEnv(region, env) {
  const e = env || process.env;
  const r = normalizeRegion(region);
  const commonKey = trim(e.DAILY_ISSUE_AI_API_KEY || e.OPENAI_API_KEY);
  const regionKey =
    r === 'US' ? trim(e.DAILY_ISSUE_US_AI_API_KEY || commonKey) : trim(e.DAILY_ISSUE_KR_AI_API_KEY || commonKey);
  const model =
    r === 'US'
      ? trim(e.DAILY_ISSUE_US_AI_MODEL || e.DAILY_ISSUE_AI_MODEL || e.OPENAI_MODEL || 'gpt-4o-mini')
      : trim(e.DAILY_ISSUE_KR_AI_MODEL || e.DAILY_ISSUE_AI_MODEL || e.OPENAI_MODEL || 'gpt-4o-mini');

  const disabledUs = trim(e.DAILY_ISSUE_US_AI_ENABLED).toLowerCase() === 'false';
  const disabledKr =
    trim(e.DAILY_ISSUE_KR_AI_ENABLED).toLowerCase() === 'false' ||
    trim(e.DAILY_ISSUE_AI_ENABLED).toLowerCase() === 'false';

  const usConfigured = regionKey.length > 0 && !disabledUs;
  const krEnabled = flagOn(e, ['DAILY_ISSUE_KR_AI_ENABLED', 'DAILY_ISSUE_AI_ENABLED']) === true;
  const krConfigured = regionKey.length > 0 && krEnabled && !disabledKr;

  const activeConfigured = r === 'US' ? usConfigured : krConfigured;

  return {
    region: r,
    provider: 'openai',
    apiKey: regionKey,
    model: model,
    configured: activeConfigured,
    blockedReason: activeConfigured ? null : disabledUs || disabledKr ? 'DISABLED_BY_FLAG' : 'BLOCKED_NOT_CONFIGURED',
    timeoutMs: Math.min(
      Math.max(Number(e.DAILY_ISSUE_AI_TIMEOUT_MS || e.DAILY_ISSUE_US_AI_TIMEOUT_MS) || 45000, 5000),
      120000,
    ),
    maxRetries: Math.min(Math.max(Number(e.DAILY_ISSUE_AI_MAX_RETRIES || e.DAILY_ISSUE_US_AI_MAX_RETRIES) || 1, 0), 3),
    maxCallsPerRun: Math.min(
      Math.max(Number(e.DAILY_ISSUE_AI_MAX_CALLS_PER_RUN || e.DAILY_ISSUE_US_AI_MAX_CALLS_PER_RUN) || 1, 1),
      5,
    ),
    maxEstimatedUsdPerRun: Math.max(
      Number(e.DAILY_ISSUE_AI_MAX_USD_PER_RUN || e.DAILY_ISSUE_US_AI_MAX_USD_PER_RUN) || 0.08,
      0,
    ),
    liveTestAllowed:
      trim(e.DAILY_ISSUE_AI_ISOLATED_LIVE_TEST).toLowerCase() === '1' ||
      trim(e.DAILY_ISSUE_AI_ISOLATED_LIVE_TEST).toLowerCase() === 'true' ||
      trim(e.DAILY_ISSUE_US_AI_ISOLATED_LIVE_TEST).toLowerCase() === '1' ||
      trim(e.DAILY_ISSUE_KR_AI_ISOLATED_LIVE_TEST).toLowerCase() === '1',
    pipelineEnabled: r === 'US' ? true : krEnabled,
  };
}

function isAiPipelineEnabledForRegion(region, env) {
  const r = normalizeRegion(region);
  const e = env || process.env;
  if (r === 'US') {
    const off = trim(e.DAILY_ISSUE_US_AI_ENABLED).toLowerCase() === 'false';
    if (off) return false;
    return true;
  }
  const kr = flagOn(e, ['DAILY_ISSUE_KR_AI_ENABLED', 'DAILY_ISSUE_AI_ENABLED']);
  return kr === true;
}

module.exports = {
  readRegionAiEnv: readRegionAiEnv,
  isAiPipelineEnabledForRegion: isAiPipelineEnabledForRegion,
  normalizeRegion: normalizeRegion,
  readUsAiEnv: function (env) {
    return readRegionAiEnv('US', env);
  },
};
