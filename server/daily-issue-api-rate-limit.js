'use strict';

/**
 * 개발용 in-memory rate limiter (운영 분산 limiter는 후속)
 */

function createMemoryRateLimiter(options) {
  const opt = options || {};
  const windows = new Map();
  let nowFn = opt.now || function () {
    return Date.now();
  };

  function keyOf(parts) {
    return parts.filter(Boolean).join('|');
  }

  function setNow(fn) {
    nowFn = fn || nowFn;
  }

  function reset() {
    windows.clear();
  }

  function check(bucket, id, limit, windowMs) {
    const lim = Number(limit) || 60;
    const win = Number(windowMs) || 60000;
    const now = nowFn();
    const k = keyOf([bucket, id]);
    let entry = windows.get(k);
    if (!entry || now - entry.start >= win) {
      entry = { start: now, count: 0 };
      windows.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > lim) {
      return {
        ok: false,
        error: 'RATE_LIMITED',
        retryAfterMs: win - (now - entry.start),
      };
    }
    return { ok: true, remaining: lim - entry.count };
  }

  return {
    check: check,
    setNow: setNow,
    reset: reset,
  };
}

function clientKey(req) {
  const fp = req.dailyIssueAdmin && req.dailyIssueAdmin.tokenFingerprint;
  const ip = (req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) ||
    (req.socket && req.socket.remoteAddress) ||
    req.ip ||
    'unknown';
  const ipOne = String(ip).split(',')[0].trim();
  return (fp || 'anon') + ':' + ipOne;
}

module.exports = {
  createMemoryRateLimiter: createMemoryRateLimiter,
  clientKey: clientKey,
};
