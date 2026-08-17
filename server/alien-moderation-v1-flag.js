'use strict';
/**
 * ALIEN_MODERATION_V1 feature flag.
 * Explicit true/false always wins.
 * Unset/empty: ON only when NODE_ENV=development. production and missing NODE_ENV stay OFF.
 */

function readEnv(name, env) {
  const src = env || process.env;
  return String(src[name] || '').trim();
}

function parseExplicit(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  return null;
}

function resolveAlienModerationV1Enabled(env) {
  const src = env || process.env;
  const explicit = parseExplicit(readEnv('ALIEN_MODERATION_V1', src));
  if (explicit !== null) return explicit;
  return readEnv('NODE_ENV', src).toLowerCase() === 'development';
}

module.exports = {
  resolveAlienModerationV1Enabled,
};
