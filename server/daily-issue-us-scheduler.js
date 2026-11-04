'use strict';

const usOps = require('../shared/daily-issue-us-ops-core');
const { createUsNoticeAdapter } = require('./daily-issue-us-notice');

function createUsScheduler(options) {
  const opt = options || {};
  const claims = {};
  const notices = opt.notices || createUsNoticeAdapter();

  function claim(runKey) {
    if (!runKey) return { ok: false, error: 'SLOT_NOT_DUE' };
    if (claims[runKey]) return { ok: false, error: 'ALREADY_PUBLISHED', runKey: runKey };
    claims[runKey] = { runKey: runKey, at: new Date().toISOString() };
    return { ok: true, runKey: runKey };
  }

  function runSlot(input) {
    const src = input || {};
    if (!usOps.isSchedulerEnabled(src.env || process.env) && src.forceEnabled !== true) {
      return { ok: true, started: false, reason: 'US_SCHEDULER_DISABLED' };
    }
    if (src.dependsOnKoreanScheduler === true) {
      return { ok: false, error: 'US_SCHEDULER_INDEPENDENT' };
    }
    const slot = usOps.slotFor(src.asOf || new Date());
    if (!slot.due) return { ok: true, started: false, reason: 'NOT_DUE', slot: slot };
    const got = claim(slot.runKey);
    if (!got.ok) return { ok: true, started: false, reason: got.error, runKey: slot.runKey };
    const assessed = usOps.assessCandidate(src.candidate || {});
    if (!assessed.publish) {
      const kind = assessed.error === 'FACT_VERIFICATION_FAILED' ? 'MAJOR_PUBLISH_ERROR' : 'ZERO_PUBLISHED';
      if (assessed.collectionStatus === 'NOT_RUN') {
        return {
          ok: true,
          published: 0,
          collectionStatus: 'NOT_RUN',
          error: assessed.error,
          runKey: slot.runKey,
        };
      }
      notices.notify({ kind: kind === 'ZERO_PUBLISHED' ? 'ZERO_PUBLISHED' : 'MAJOR_PUBLISH_ERROR', runKey: slot.runKey });
      return {
        ok: true,
        published: 0,
        collectionStatus: assessed.collectionStatus,
        error: assessed.error,
        runKey: slot.runKey,
      };
    }
    return {
      ok: true,
      published: 1,
      collectionStatus: assessed.collectionStatus,
      runKey: slot.runKey,
    };
  }

  return {
    claim: claim,
    runSlot: runSlot,
    notices: notices,
  };
}

function startUsScheduler(options) {
  const opt = options || {};
  if (!usOps.isSchedulerEnabled(process.env) && opt.forceEnabled !== true) {
    return { ok: true, started: false, reason: 'US_SCHEDULER_DISABLED' };
  }
  const scheduler = createUsScheduler(opt);
  const timer = setInterval(function () {
    scheduler.runSlot({ asOf: new Date(), env: process.env });
  }, Number(opt.intervalMs) > 0 ? Number(opt.intervalMs) : 30000);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    ok: true,
    started: true,
    stop: function () { clearInterval(timer); },
  };
}

module.exports = {
  createUsScheduler: createUsScheduler,
  startUsScheduler: startUsScheduler,
};
