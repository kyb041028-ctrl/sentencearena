'use strict';
/**
 * Canonical alignment SCORE persistence — admin/dev only.
 * No public HTTP. Scheduler (if enabled) reuses this service.
 * No territory transition.
 * RPC apply_alignment_score_batch locks rows and computes
 * nextScore = currentScore + clamp(combinedSignal - previousSignal, ±500).
 */

const simSvc = require('./political-alignment-simulation-service');
const simCore = require('../shared/political-alignment-simulation-core');
const persistCore = require('../shared/political-alignment-persist-core');
const { createAlignmentBatchId } = require('./alignment-batch-id');

function getAdminClient() {
  const persist = require('./achievement-persist-service');
  return persist.getAdminClient();
}

function redactPlanUsers(users) {
  const list = Array.isArray(users) ? users : [];
  return list.map(function (u, i) {
    return {
      userAlias: 'U' + (i + 1),
      combinedSignal: u.combinedSignal,
    };
  });
}

function createMemoryAlignmentStore() {
  const batches = {};
  const states = {};
  const history = [];

  async function applyPlan(plan) {
    if (!plan || !plan.batchId) {
      const err = new Error('ALIGNMENT_PLAN_BATCH_ID_REQUIRED');
      err.code = 'ALIGNMENT_PLAN_BATCH_ID_REQUIRED';
      throw err;
    }
    if (plan.score != null || plan.nextScore != null || plan.cappedDelta != null) {
      const err = new Error('ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN');
      err.code = 'ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN';
      throw err;
    }
    if (batches[plan.batchId]) {
      return {
        success: true,
        skipped: true,
        committed: false,
        skipReason: 'ALREADY_APPLIED',
        batchId: plan.batchId,
      };
    }
    batches[plan.batchId] = { status: 'PROCESSING' };
    await Promise.resolve();
    const snapStates = JSON.parse(JSON.stringify(states));
    const snapHistory = history.slice();
    try {
      const users = Array.isArray(plan.users) ? plan.users : [];
      let processed = 0;
      let skipped = 0;
      let i;
      for (i = 0; i < users.length; i++) {
        const rec = users[i] || {};
        if (rec.score != null || rec.nextScore != null || rec.cappedDelta != null || rec.signedDelta != null) {
          const err = new Error('ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN');
          err.code = 'ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN';
          throw err;
        }
        if (!rec.userId || typeof rec.combinedSignal !== 'number' || !isFinite(rec.combinedSignal)) {
          const err = new Error('ALIGNMENT_PLAN_USER_INVALID');
          err.code = 'ALIGNMENT_PLAN_USER_INVALID';
          throw err;
        }
        if (!states[rec.userId]) {
          states[rec.userId] = persistCore.defaultInitialState();
        }
        const st = states[rec.userId];
        if (st.lastProcessedBatchId === plan.batchId) {
          skipped += 1;
          continue;
        }
        const step = persistCore.applyScoreStep(st, rec.combinedSignal);
        if (!step.ok) {
          const err = new Error(step.error);
          err.code = step.error;
          throw err;
        }
        states[rec.userId] = {
          score: step.nextScore,
          previousSignal: step.nextSignal,
          lastProcessedBatchId: plan.batchId,
        };
        history.push({
          batchId: plan.batchId,
          userId: rec.userId,
          previousScore: step.previousScore,
          nextScore: step.nextScore,
          previousSignal: step.previousSignal,
          nextSignal: step.nextSignal,
          capApplied: step.capApplied,
        });
        processed += 1;
      }
      batches[plan.batchId] = { status: 'COMPLETED' };
      return {
        success: true,
        skipped: false,
        committed: true,
        skipReason: null,
        batchId: plan.batchId,
        processedUsers: processed,
        skippedUsers: skipped,
        totalUsers: users.length,
      };
    } catch (e) {
      Object.keys(states).forEach(function (k) {
        delete states[k];
      });
      Object.keys(snapStates).forEach(function (k) {
        states[k] = snapStates[k];
      });
      history.length = 0;
      snapHistory.forEach(function (h) {
        history.push(h);
      });
      delete batches[plan.batchId];
      throw e;
    }
  }

  return {
    applyPlan: applyPlan,
    getState: function (userId) {
      return states[userId] ? JSON.parse(JSON.stringify(states[userId])) : null;
    },
    getHistory: function () {
      return history.slice();
    },
    hasBatch: function (batchId) {
      return !!batches[batchId];
    },
  };
}

async function runPoliticalAlignmentBatch(options) {
  const opts = options || {};
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const apply = opts.apply === true;
  const batchId = opts.batchId || createAlignmentBatchId(asOf);
  const simulation = opts.simulation || (await simSvc.simulateAlignmentBatch({
    asOf: asOf,
    client: opts.client,
    includeUserIds: true,
  }));
  const simUsers = Array.isArray(simulation.users)
    ? simulation.users
    : Array.isArray(simulation.usersRedacted)
      ? []
      : [];
  const plan = persistCore.buildApplyPlan({
    batchId: batchId,
    processedAt: asOf.toISOString(),
    simulation: { asOf: simulation.asOf, users: simUsers },
  });

  const drySummary = {
    status: apply ? 'POLITICAL_SCORE_WRITE' : 'POLITICAL_SCORE_DRY_RUN',
    scoreWrite: false,
    applyAttempted: apply,
    batchId: batchId,
    asOf: asOf.toISOString(),
    userCount: plan.users.length,
    usersRedacted: redactPlanUsers(plan.users),
    simPolicies: simulation.policies || simCore.POLICIES,
    schedulerConnected: false,
    territoryMoveEvaluated: false,
    nonzeroCombined: plan.users.filter(function (u) {
      return u.combinedSignal !== 0;
    }).length,
  };

  if (!apply) {
    return drySummary;
  }

  let result;
  if (opts.store && typeof opts.store.applyPlan === 'function') {
    result = await opts.store.applyPlan(plan);
  } else {
    const sb = opts.client || getAdminClient();
    const rpc = await sb.rpc('apply_alignment_score_batch', { plan: plan });
    if (rpc.error) {
      const err = new Error('ALIGNMENT_RPC_FAILED');
      err.code = 'ALIGNMENT_RPC_FAILED';
      err.detail = rpc.error.message;
      throw err;
    }
    result = rpc.data;
  }

  return Object.assign({}, drySummary, {
    scoreWrite: !!(result && result.committed),
    rpc: {
      success: !!(result && result.success),
      skipped: !!(result && result.skipped),
      committed: !!(result && result.committed),
      skipReason: (result && result.skipReason) || null,
      processedUsers: result && result.processedUsers,
      skippedUsers: result && result.skippedUsers,
    },
  });
}

module.exports = {
  runPoliticalAlignmentBatch,
  createMemoryAlignmentStore,
  redactPlanUsers,
  POLITICAL_REACTION_INPUT: 'ACTIVE_CANONICAL',
  POLITICAL_SIMULATION: 'ACTIVE_READ_ONLY',
  POLITICAL_SCORE_WRITE: 'MANUAL_RPC',
  POLITICAL_BATCH_SCHEDULER: 'READY_DISABLED',
  TERRITORY_MOVE: 'NOT_CONNECTED',
  CENTRAL_SIGN_POLICY: 'CONFIRMED',
};
