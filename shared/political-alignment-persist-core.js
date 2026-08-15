/**
 * Alignment score persistence math (no territory transition).
 * previousSignal and currentScore are separate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./alignment-batch-core'));
  } else {
    root.PoliticalAlignmentPersistCore = factory(root.AlignmentBatchCore);
  }
})(typeof self !== 'undefined' ? self : this, function (batchCore) {
  'use strict';

  var POLICIES = Object.freeze({
    POLITICAL_SCORE_WRITE: 'MANUAL_RPC',
    POLITICAL_BATCH_SCHEDULER: 'NOT_CONNECTED',
    TERRITORY_MOVE: 'NOT_CONNECTED',
  });

  function getCap() {
    if (batchCore && typeof batchCore.getAlignmentBatchProcessorConfig === 'function') {
      var cfg = batchCore.getAlignmentBatchProcessorConfig();
      if (cfg && typeof cfg.maxScoreChangePerBatch === 'number') return cfg.maxScoreChangePerBatch;
    }
    return 500;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /**
   * Apply one batch step using stored state + combinedSignal.
   * Does not read nextScore from the caller.
   */
  function applyScoreStep(state, combinedSignal, capOpt) {
    var cap = isFiniteNumber(capOpt) ? capOpt : getCap();
    var currentScore = state && isFiniteNumber(state.score) ? state.score : 0;
    var previousSignal = state && isFiniteNumber(state.previousSignal) ? state.previousSignal : 0;
    if (!isFiniteNumber(combinedSignal)) {
      return { ok: false, error: 'COMBINED_SIGNAL_INVALID' };
    }
    var rawDelta = combinedSignal - previousSignal;
    var cappedDelta = clamp(rawDelta, -cap, cap);
    return {
      ok: true,
      previousScore: currentScore,
      nextScore: currentScore + cappedDelta,
      rawDelta: rawDelta,
      cappedDelta: cappedDelta,
      capApplied: cappedDelta !== rawDelta,
      previousSignal: previousSignal,
      nextSignal: combinedSignal,
    };
  }

  function defaultInitialState() {
    return { score: 0, previousSignal: 0 };
  }

  function buildApplyPlan(options) {
    var opts = options || {};
    var sim = opts.simulation || {};
    var users = Array.isArray(sim.users) ? sim.users : [];
    var payload = [];
    var i;
    for (i = 0; i < users.length; i++) {
      var u = users[i];
      if (!u || !u.userId) continue;
      if (!isFiniteNumber(u.combinedSignal)) continue;
      payload.push({
        userId: u.userId,
        combinedSignal: u.combinedSignal,
      });
    }
    return {
      batchId: opts.batchId,
      processedAt: opts.processedAt || (sim.asOf ? sim.asOf : new Date().toISOString()),
      users: payload,
    };
  }

  return {
    POLICIES: POLICIES,
    applyScoreStep: applyScoreStep,
    defaultInitialState: defaultInitialState,
    buildApplyPlan: buildApplyPlan,
    getCap: getCap,
  };
});
