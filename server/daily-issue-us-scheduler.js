'use strict';

const usOps = require('../shared/daily-issue-us-ops-core');
const { createUsNoticeAdapter } = require('./daily-issue-us-notice');
const usRun = require('./daily-issue-us-run-service');
const { createUsSchedulerStore } = require('./daily-issue-us-scheduler-store');

function createUsScheduler(options) {
  const opt = options || {};
  const claims = {};
  const notices = opt.notices || createUsNoticeAdapter();
  const usStore = opt.usStore || createUsSchedulerStore();

  function claim(runKey) {
    if (!runKey) return { ok: false, error: 'SLOT_NOT_DUE' };
    if (claims[runKey]) return { ok: false, error: 'ALREADY_PUBLISHED', runKey: runKey };
    claims[runKey] = { runKey: runKey, at: new Date().toISOString() };
    return { ok: true, runKey: runKey };
  }

  function runSlotLegacyAssess(src, slot, got) {
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

  function runSlot(input) {
    const src = input || {};
    if (!usOps.isSchedulerEnabled(src.env || process.env) && src.forceEnabled !== true) {
      return { ok: true, started: false, reason: 'US_SCHEDULER_DISABLED' };
    }
    if (src.dependsOnKoreanScheduler === true) {
      return { ok: false, error: 'US_SCHEDULER_INDEPENDENT' };
    }
    const slot = usOps.slotFor(src.asOf || new Date());
    if (!slot.due && src.forceSlot !== true) {
      return { ok: true, started: false, reason: 'NOT_DUE', slot: slot };
    }

    const usesPipeline =
      src.runPipeline === true ||
      src.repositoryInstance != null ||
      src.ingestRunner != null ||
      src.feedBodies != null ||
      src.skipNetwork === true ||
      src.forceAutoPublish === true ||
      src.persist === true;

    if (!usesPipeline && src.candidate) {
      const got = claim(slot.runKey);
      if (!got.ok) {
        return { ok: true, started: false, reason: got.error, runKey: slot.runKey };
      }
      return runSlotLegacyAssess(src, slot, got);
    }

    return usRun.runUsDailyIssueSlot(
      Object.assign({}, opt, src, {
        notices: notices,
        usStore: src.usStore || usStore,
        forceSlot: src.forceSlot,
      }),
    );
  }

  return {
    claim: claim,
    runSlot: runSlot,
    notices: notices,
    usStore: usStore,
  };
}

function startUsScheduler(options) {
  const opt = options || {};
  if (!usOps.isSchedulerEnabled(process.env) && opt.forceEnabled !== true) {
    return { ok: true, started: false, reason: 'US_SCHEDULER_DISABLED' };
  }
  const scheduler = createUsScheduler(opt);
  const timer = setInterval(function () {
    Promise.resolve(
      scheduler.runSlot({
        asOf: new Date(),
        env: process.env,
        repository: opt.repository,
        schemaName: opt.schemaName,
        databaseUrl: opt.databaseUrl,
        reviewRoot: opt.reviewRoot,
      }),
    ).catch(function (e) {
      console.error('[daily-issue-us-scheduler]', String(e && e.message ? e.message : e));
    });
  }, Number(opt.intervalMs) > 0 ? Number(opt.intervalMs) : 30000);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    ok: true,
    started: true,
    stop: function () {
      clearInterval(timer);
    },
  };
}

module.exports = {
  createUsScheduler: createUsScheduler,
  startUsScheduler: startUsScheduler,
};
