'use strict';

/**
 * 미국 데일리 이슈 슬롯 run 기록 (한국 morning store 와 분리).
 */

function createUsSchedulerStore(options) {
  const opt = options || {};
  const runs = opt.initialRuns || {};

  function getByRunKey(runKey) {
    return runs[runKey] || null;
  }

  return {
    getByRunKey: getByRunKey,
    tryClaimRun: function (params) {
      const p = params || {};
      const key = String(p.runKey || '');
      if (!key) return { claimed: false, reason: 'RUN_KEY_MISSING' };
      const existing = runs[key];
      if (existing && (existing.status === 'SUCCESS' || existing.status === 'RUNNING')) {
        return { claimed: false, reason: 'ALREADY_PUBLISHED', run: existing, runKey: key };
      }
      if (existing && existing.status === 'FAILED' && p.allowRetryAfterFailure !== true) {
        return { claimed: false, reason: 'ALREADY_PUBLISHED', run: existing, runKey: key };
      }
      const run = {
        runKey: key,
        status: 'RUNNING',
        startedAt: p.startedAt || new Date().toISOString(),
        activityRegion: 'US',
        meta: p.meta || {},
      };
      runs[key] = run;
      return { claimed: true, run: run, runKey: key };
    },
    finishRun: function (runKey, patch) {
      const key = String(runKey || '');
      const cur = runs[key] || { runKey: key };
      const next = Object.assign({}, cur, patch || {}, { runKey: key, finishedAt: (patch && patch.finishedAt) || new Date().toISOString() });
      runs[key] = next;
      return { ok: true, run: next };
    },
    listForDate: function (dateKey) {
      const prefix = 'us-daily-issue:' + String(dateKey || '') + ':';
      return Object.keys(runs)
        .filter(function (k) {
          return k.indexOf(prefix) === 0;
        })
        .map(function (k) {
          return runs[k];
        });
    },
    _runs: runs,
  };
}

module.exports = {
  createUsSchedulerStore: createUsSchedulerStore,
};
