'use strict';

/**
 * Graceful shutdown controller (SIGTERM / SIGINT)
 * — 비밀값 미출력 · 중복 호출 안전 · 강제 timeout
 */

function createGracefulShutdown(options) {
  const opt = options || {};
  const timeoutMs = Number(opt.timeoutMs) > 0 ? Number(opt.timeoutMs) : 10000;
  const logger = opt.logger || console;
  let shuttingDown = false;
  let exitCode = 0;

  async function runShutdown(signal) {
    if (shuttingDown) {
      logger.log('[shutdown] already in progress (' + signal + ')');
      return { ok: true, duplicate: true };
    }
    shuttingDown = true;
    logger.log('[shutdown] begin', signal);

    const forceTimer = setTimeout(function () {
      logger.error('[shutdown] force exit after timeoutMs=' + timeoutMs);
      process.exit(exitCode || 1);
    }, timeoutMs);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    try {
      if (typeof opt.stopScheduler === 'function') {
        try {
          opt.stopScheduler();
          logger.log('[shutdown] morning scheduler stopped');
        } catch (e) {
          logger.error('[shutdown] scheduler stop failed', e && e.message ? e.message : e);
        }
      }

      if (opt.server && typeof opt.server.close === 'function') {
        await new Promise(function (resolve) {
          opt.server.close(function (err) {
            if (err) {
              logger.error('[shutdown] http close error', err && err.message ? err.message : err);
              exitCode = 1;
            } else {
              logger.log('[shutdown] http server closed');
            }
            resolve();
          });
        });
      }

      if (typeof opt.closePools === 'function') {
        try {
          await opt.closePools();
          logger.log('[shutdown] db pools closed');
        } catch (e) {
          logger.error('[shutdown] db pool close failed', e && e.message ? e.message : e);
          exitCode = 1;
        }
      }

      if (typeof opt.onAfterClose === 'function') {
        await opt.onAfterClose();
      }
    } finally {
      clearTimeout(forceTimer);
      if (opt.exitProcess !== false) {
        process.exit(exitCode);
      }
    }

    return { ok: exitCode === 0, duplicate: false, exitCode: exitCode };
  }

  function attachSignals() {
    ['SIGTERM', 'SIGINT'].forEach(function (sig) {
      process.on(sig, function () {
        runShutdown(sig).catch(function (e) {
          logger.error('[shutdown] unexpected', e && e.message ? e.message : e);
          process.exit(1);
        });
      });
    });
  }

  return {
    shutdown: runShutdown,
    attachSignals: attachSignals,
    isShuttingDown: function () {
      return shuttingDown;
    },
    timeoutMs: timeoutMs,
  };
}

module.exports = {
  createGracefulShutdown: createGracefulShutdown,
};
