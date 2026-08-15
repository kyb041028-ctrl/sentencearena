'use strict';
/**
 * Canonical political alignment scheduler.
 * Asia/Seoul 05:00 / 17:00 slots only. Default disabled.
 * Does not copy signed/weight/window/cap formulas.
 * Persistence = existing runPoliticalAlignmentBatch + apply_alignment_score_batch.
 * No territory / catch-up / dedicated retry engine.
 */

const schedCore = require('../shared/political-alignment-scheduler-core');
const persistSvc = require('./political-alignment-persist-service');

function resolveNow(opt) {
  if (opt && opt.asOf) return new Date(opt.asOf);
  if (opt && typeof opt.nowFn === 'function') return new Date(opt.nowFn());
  return new Date();
}

function makeLogger(logger) {
  const log = logger || console;
  return {
    info: function (payload) {
      if (typeof log.info === 'function') log.info('[political-alignment-scheduler]', payload);
      else log.log('[political-alignment-scheduler]', payload);
    },
    error: function (payload) {
      if (typeof log.error === 'function') log.error('[political-alignment-scheduler]', payload);
      else log.log('[political-alignment-scheduler]', payload);
    },
  };
}

function summarizeOutcome(report) {
  if (!report) return 'FAILED';
  if (report.rpc && report.rpc.skipped) return 'ALREADY_APPLIED';
  if (report.scoreWrite && report.rpc && report.rpc.committed) return 'APPLIED';
  return 'FAILED';
}

function safeLogPayload(fields) {
  return {
    batchId: fields.batchId || null,
    scheduledTime: fields.scheduledTime || null,
    event: fields.event,
    userCount: fields.userCount,
    outcome: fields.outcome || null,
    durationMs: fields.durationMs,
  };
}

async function tick(options) {
  const opt = options || {};
  const enabled = schedCore.resolveEnabled(opt);
  if (!enabled) {
    return { ok: true, skipped: true, reason: 'SCHEDULER_DISABLED', due: false, crashed: false };
  }

  const now = resolveNow(opt);
  const decision = schedCore.evaluateTick(now);
  if (!decision.due) {
    return {
      ok: true,
      skipped: true,
      reason: decision.skipReason || 'NOT_SLOT',
      due: false,
      batchId: null,
      timezone: decision.timezone,
      crashed: false,
    };
  }

  const logger = makeLogger(opt.logger);
  const startedAt = Date.now();
  logger.info(
    safeLogPayload({
      event: 'started',
      batchId: decision.batchId,
      scheduledTime: decision.scheduledLabel,
    })
  );

  try {
    const runner = opt.persistRunner || persistSvc.runPoliticalAlignmentBatch;
    const report = await runner({
      apply: true,
      batchId: decision.batchId,
      asOf: now,
      store: opt.store,
      client: opt.client,
      simulation: opt.simulation,
    });
    const outcome = summarizeOutcome(report);
    const durationMs = Date.now() - startedAt;
    logger.info(
      safeLogPayload({
        event: outcome,
        batchId: decision.batchId,
        scheduledTime: decision.scheduledLabel,
        userCount: report && report.userCount,
        outcome: outcome,
        durationMs: durationMs,
      })
    );
    return {
      ok: outcome !== 'FAILED',
      skipped: outcome === 'ALREADY_APPLIED',
      due: true,
      reason: outcome === 'ALREADY_APPLIED' ? 'ALREADY_APPLIED' : null,
      outcome: outcome,
      batchId: decision.batchId,
      scheduledTime: decision.scheduledLabel,
      userCount: report && report.userCount,
      durationMs: durationMs,
      report: report,
      crashed: false,
    };
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    logger.error(
      safeLogPayload({
        event: 'FAILED',
        batchId: decision.batchId,
        scheduledTime: decision.scheduledLabel,
        durationMs: durationMs,
      })
    );
    if (opt.logger && typeof opt.logger.error === 'function') {
      opt.logger.error('[political-alignment-scheduler] error', String(e && e.message ? e.message : e));
    } else {
      console.error('[political-alignment-scheduler] error', String(e && e.message ? e.message : e));
    }
    return {
      ok: false,
      skipped: false,
      due: true,
      outcome: 'FAILED',
      reason: 'BATCH_FAILED',
      batchId: decision.batchId,
      scheduledTime: decision.scheduledLabel,
      durationMs: durationMs,
      error: String(e && e.message ? e.message : e),
      crashed: false,
    };
  }
}

function startAlignmentScheduler(options) {
  const opt = options || {};
  const enabled = schedCore.resolveEnabled(opt);
  if (!enabled) {
    return {
      ok: true,
      started: false,
      reason: 'SCHEDULER_DISABLED',
      status: schedCore.POLITICAL_BATCH_SCHEDULER,
    };
  }

  const intervalMs = schedCore.resolveIntervalMs(opt);
  const logger = makeLogger(opt.logger);
  const timer = setInterval(function () {
    tick(opt).catch(function (e) {
      logger.error({
        event: 'FAILED',
        batchId: null,
        scheduledTime: null,
        durationMs: null,
      });
      console.error('[political-alignment-scheduler] tick', String(e && e.message ? e.message : e));
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  // Immediate tick is due-slot only. Not a missed-batch catch-up.
  let startTick = Promise.resolve({ ok: true, skipped: true, reason: 'TICK_ON_START_DISABLED' });
  if (opt.tickOnStart !== false) {
    startTick = tick(opt).catch(function (e) {
      console.error('[political-alignment-scheduler] start tick', String(e && e.message ? e.message : e));
      return { ok: false, outcome: 'FAILED', crashed: false, error: String(e && e.message ? e.message : e) };
    });
  }

  logger.info({
    event: 'scheduler-started',
    batchId: null,
    scheduledTime: 'Asia/Seoul 05:00/17:00',
  });

  return {
    ok: true,
    started: true,
    intervalMs: intervalMs,
    timezone: schedCore.TIMEZONE,
    missedBatchPolicy: schedCore.MISSED_BATCH_POLICY,
    retryPolicy: schedCore.RETRY_POLICY,
    status: 'ACTIVE',
    startTick: startTick,
    stop: function () {
      clearInterval(timer);
    },
  };
}

module.exports = {
  tick: tick,
  startAlignmentScheduler: startAlignmentScheduler,
  POLITICAL_BATCH_SCHEDULER: schedCore.POLITICAL_BATCH_SCHEDULER,
  MISSED_BATCH_POLICY: schedCore.MISSED_BATCH_POLICY,
  RETRY_POLICY: schedCore.RETRY_POLICY,
  TERRITORY_MOVE: schedCore.TERRITORY_MOVE,
  ENV_ENABLED_KEY: schedCore.ENV_ENABLED_KEY,
};
