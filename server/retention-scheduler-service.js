'use strict';

const retention = require('./retention-service');

function startRetentionPurgeScheduler(options) {
  const opt = options || {};
  const enabled = opt.enabled != null
    ? !!opt.enabled
    : (
      String(process.env.RETENTION_PURGE_ENABLED || '').trim() === '1'
      || String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    );
  if (!enabled) {
    return { started: false, reason: 'DISABLED' };
  }
  const intervalMs = Number(opt.intervalMs) || (60 * 60 * 1000);
  let stopped = false;
  async function tick() {
    if (stopped) return;
    try {
      await retention.purgeExpired();
    } catch (e) {
      console.log('[retention]', 'purge-tick-error', JSON.stringify({
        error: e && e.code ? e.code : 'PURGE_TICK_FAILED',
      }));
    }
  }
  const timer = setInterval(tick, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  if (opt.runOnStart !== false) {
    tick();
  }
  return {
    started: true,
    intervalMs: intervalMs,
    stop: function () {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  startRetentionPurgeScheduler,
};
