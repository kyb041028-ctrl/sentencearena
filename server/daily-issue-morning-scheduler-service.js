'use strict';

/**
 * 데일리 이슈 아침판 스케줄러 서비스
 * — 04:30 collect / 05:00 publish 분리
 * — 판정·lifecycle 미변경 · runMorningAutoPublish 재사용
 */

const path = require('path');
const core = require('../shared/daily-issue-morning-scheduler-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const { createMorningSchedulerStore } = require('./daily-issue-morning-scheduler-store');
const reviewService = require('./daily-issue-review-service');

function settle(v) {
  if (v && typeof v.then === 'function') return v;
  return Promise.resolve(v);
}

function loadConfig(opt) {
  return core.resolveScheduleConfig(
    Object.assign({}, process.env, opt || {}, {
      enabled: opt && opt.enabled != null ? opt.enabled : process.env.DAILY_ISSUE_MORNING_SCHEDULER_ENABLED,
      collectCron: (opt && opt.collectCron) || process.env.DAILY_ISSUE_MORNING_COLLECT_CRON,
      publishCron: (opt && opt.publishCron) || process.env.DAILY_ISSUE_MORNING_PUBLISH_CRON,
      catchupMinutes:
        opt && opt.catchupMinutes != null
          ? opt.catchupMinutes
          : process.env.DAILY_ISSUE_MORNING_CATCHUP_MINUTES,
    }),
  );
}

function resolveStore(opt) {
  if (opt.schedulerStore) return opt.schedulerStore;
  if (opt.executor) {
    return createMorningSchedulerStore({
      kind: 'sql',
      executor: opt.executor,
      schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
    });
  }
  const kind = String(opt.repository || opt.repositoryKind || process.env.DAILY_ISSUE_REPOSITORY || 'json').toLowerCase();
  if (kind === 'db' || kind === 'sql') {
    const { createDailyIssuePgExecutor } = require('./daily-issue-pg-client');
    const executor = createDailyIssuePgExecutor({
      databaseUrl: opt.databaseUrl,
      schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
    });
    return createMorningSchedulerStore({
      kind: 'sql',
      executor: executor,
      schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
    });
  }
  return createMorningSchedulerStore({
    kind: 'json',
    reviewRoot: opt.reviewRoot || path.join(process.cwd(), 'data', 'daily-issue-review'),
  });
}

function countDecisions(items) {
  let auto = 0;
  let manual = 0;
  (items || []).forEach(function (it) {
    const d =
      it.publicationDecision ||
      (it.lifecycleMeta && it.lifecycleMeta.publicationDecision) ||
      '';
    if (d === decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE) auto += 1;
    else manual += 1;
  });
  return { autoEligibleCount: auto, manualReviewCount: manual };
}

async function defaultCollectAndEnqueue(options) {
  const opt = options || {};
  const ingest = opt.ingestRunner || require('./daily-issue-ingest-service').runDailyIssueIngest;
  const asOf = opt.asOf || new Date().toISOString();

  const ingestResult = await settle(
    ingest({
      dryRun: true,
      language: opt.language || 'ko',
      group: opt.group || undefined,
      maxItems: opt.maxItems,
      feedBodies: opt.feedBodies,
      skipNetwork: opt.skipNetwork,
      sinceHours: opt.sinceHours != null ? opt.sinceHours : 36,
      cacheRoot: opt.cacheRoot,
      asOf: asOf,
    }),
  );

  if (!ingestResult || ingestResult.ok === false) {
    return {
      ok: false,
      errorCode: (ingestResult && ingestResult.error) || 'COLLECT_INGEST_FAILED',
      errorSummary: String((ingestResult && (ingestResult.message || ingestResult.error)) || 'ingest failed'),
      collectedSourceCount: 0,
      candidateCount: 0,
      autoEligibleCount: 0,
      manualReviewCount: 0,
      ingest: ingestResult,
    };
  }

  const readyFromIngest = ingestResult.readyCandidates || [];
  const ready =
    readyFromIngest.length > 0
      ? readyFromIngest.filter(function (c) {
          return c && c.ok === true && c.publicationStatus === 'READY' && c.freshnessOk !== false;
        })
      : (ingestResult.candidates || []).filter(function (c) {
          return c && c.ok === true && c.publicationStatus === 'READY' && c.freshnessOk !== false;
        });

  const enq = await settle(
    reviewService.enqueueCandidates(ready, {
      repositoryInstance: opt.repositoryInstance,
      repository: opt.repository,
      reviewRoot: opt.reviewRoot,
      asOf: asOf,
      dryRun: !!opt.dryRun,
    }),
  );

  if (!enq || enq.ok === false) {
    return {
      ok: false,
      errorCode: (enq && enq.error) || 'ENQUEUE_FAILED',
      errorSummary: String((enq && (enq.message || enq.error)) || 'enqueue failed'),
      collectedSourceCount: (ingestResult.sourceResults || []).length || (ingestResult.sources && ingestResult.sources.length) || 0,
      candidateCount: ready.length,
      autoEligibleCount: 0,
      manualReviewCount: 0,
      ingest: ingestResult,
      enqueue: enq,
    };
  }

  const created = (enq.results || [])
    .filter(function (r) {
      return r && r.ok && r.item;
    })
    .map(function (r) {
      return r.item;
    });
  let decisionItems = created;
  if ((!decisionItems || !decisionItems.length) && opt.repositoryInstance) {
    const listed = await settle(opt.repositoryInstance.list({ status: 'READY_FOR_REVIEW' }));
    decisionItems = (listed && listed.items) || [];
  }
  const counts = countDecisions(decisionItems);
  const sourceCount =
    (ingestResult.sourceResults || []).filter(function (s) {
      return s && s.ok;
    }).length ||
    (ingestResult.manifest && ingestResult.manifest.sourceCount) ||
    0;

  const enqueueFailed = (enq.results || []).filter(function (r) {
    return r && !r.ok;
  }).length;
  const enqueuedCount = enq.enqueuedCount != null ? enq.enqueuedCount : created.length;

  let status = core.RUN_STATUS.SUCCESS;
  let errorCode = null;
  let errorSummary = null;
  if (enqueuedCount === 0 && ready.length === 0) {
    // empty collect is not a hidden failure — mark SUCCESS with note (alert via AUTO/zero candidates)
    errorCode = 'NO_CANDIDATES';
    errorSummary = 'Collect finished with 0 READY candidates';
  }
  if (enqueueFailed > 0 && enqueuedCount > 0) {
    status = core.RUN_STATUS.PARTIAL_SUCCESS;
    errorCode = 'PARTIAL_ENQUEUE';
    errorSummary = enqueueFailed + ' rejected, ' + enqueuedCount + ' enqueued';
  }
  if (enq.ok === false) {
    status = core.RUN_STATUS.FAILED;
  }

  return {
    ok: status !== core.RUN_STATUS.FAILED,
    status: status,
    errorCode: errorCode,
    errorSummary: errorSummary,
    collectedSourceCount: sourceCount,
    candidateCount: enqueuedCount || ready.length,
    autoEligibleCount: counts.autoEligibleCount,
    manualReviewCount: counts.manualReviewCount,
    skippedDuplicateCount: (enq.duplicates || []).length || 0,
    ingest: ingestResult,
    enqueue: enq,
  };
}

async function runCollect(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const cfg = loadConfig(opt);
  const parts = core.kstParts(asOf);
  const dateKey = opt.dateKey || parts.dateKey;
  const runKey = opt.runKey || core.collectRunKey(dateKey, opt);
  const scheduledAt = opt.scheduledAt || core.scheduledAtIso(dateKey, cfg.collectHour, cfg.collectMinute);
  const store = resolveStore(opt);

  await settle(store.initialize && store.initialize());

  if (!opt.force && !opt.manual) {
    const win = core.evaluateWindow(asOf, scheduledAt, cfg.catchupMinutes);
    if (win.phase === 'before') {
      return { ok: true, skipped: true, reason: 'BEFORE_WINDOW', runKey: runKey };
    }
    if (win.phase === 'missed') {
      const missed = await settle(
        store.insertMissed({
          runKey: runKey,
          runType: core.RUN_TYPE.COLLECT,
          scheduledAt: scheduledAt,
          asOf: asOf,
        }),
      );
      return {
        ok: true,
        missed: true,
        runKey: runKey,
        run: missed.run,
        status: core.RUN_STATUS.MISSED,
      };
    }
  }

  const claim = await settle(
    store.tryClaimRun({
      runKey: runKey,
      runType: core.RUN_TYPE.COLLECT,
      scheduledAt: scheduledAt,
      startedAt: asOf,
      allowRetryAfterFailure: !!opt.allowRetryAfterFailure || !!opt.manual,
      meta: { actor: opt.actorId || 'MORNING_SCHEDULER', manual: !!opt.manual },
    }),
  );

  if (!claim.claimed) {
    return {
      ok: true,
      skipped: true,
      reason: claim.reason || 'DUPLICATE_RUN_KEY',
      status: core.RUN_STATUS.SKIPPED_DUPLICATE,
      runKey: runKey,
      run: claim.run,
    };
  }

  try {
    const runner = opt.collectRunner || defaultCollectAndEnqueue;
    const result = await settle(
      runner({
        asOf: asOf,
        repositoryInstance: opt.repositoryInstance,
        repository: opt.repository,
        reviewRoot: opt.reviewRoot,
        dryRun: opt.dryRun,
        feedBodies: opt.feedBodies,
        skipNetwork: opt.skipNetwork,
        ingestRunner: opt.ingestRunner,
        language: opt.language,
        group: opt.group,
        maxItems: opt.maxItems,
        cacheRoot: opt.cacheRoot,
      }),
    );

    if (result && result.ok === false) {
      const finished = await settle(
        store.finishRun(runKey, {
          status: core.RUN_STATUS.FAILED,
          finishedAt: new Date().toISOString(),
          collectedSourceCount: result.collectedSourceCount || 0,
          candidateCount: result.candidateCount || 0,
          autoEligibleCount: result.autoEligibleCount || 0,
          manualReviewCount: result.manualReviewCount || 0,
          skippedDuplicateCount: result.skippedDuplicateCount || 0,
          errorCode: result.errorCode || 'COLLECT_FAILED',
          errorSummary: result.errorSummary || 'collect failed',
          meta: claim.run.meta,
        }),
      );
      return {
        ok: false,
        runKey: runKey,
        status: core.RUN_STATUS.FAILED,
        run: finished.run,
        result: result,
      };
    }

    const status = result.status || core.RUN_STATUS.SUCCESS;
    const finished = await settle(
      store.finishRun(runKey, {
        status: status,
        finishedAt: new Date().toISOString(),
        collectedSourceCount: result.collectedSourceCount || 0,
        candidateCount: result.candidateCount || 0,
        autoEligibleCount: result.autoEligibleCount || 0,
        manualReviewCount: result.manualReviewCount || 0,
        skippedDuplicateCount: result.skippedDuplicateCount || 0,
        errorCode: result.errorCode || null,
        errorSummary: result.errorSummary || null,
        meta: claim.run.meta,
      }),
    );
    return {
      ok: true,
      runKey: runKey,
      status: status,
      run: finished.run,
      result: result,
    };
  } catch (e) {
    const finished = await settle(
      store.finishRun(runKey, {
        status: core.RUN_STATUS.FAILED,
        finishedAt: new Date().toISOString(),
        errorCode: 'COLLECT_EXCEPTION',
        errorSummary: String(e && e.message ? e.message : e).slice(0, 500),
        meta: claim.run.meta,
      }),
    );
    return { ok: false, runKey: runKey, status: core.RUN_STATUS.FAILED, run: finished.run, error: e };
  }
}

async function runPublish(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const cfg = loadConfig(opt);
  const parts = core.kstParts(asOf);
  const dateKey = opt.dateKey || parts.dateKey;
  const runKey = opt.runKey || core.publishRunKey(dateKey, opt);
  const scheduledAt = opt.scheduledAt || core.scheduledAtIso(dateKey, cfg.publishHour, cfg.publishMinute);
  const store = resolveStore(opt);

  await settle(store.initialize && store.initialize());

  if (!opt.force && !opt.manual) {
    const win = core.evaluateWindow(asOf, scheduledAt, cfg.catchupMinutes);
    if (win.phase === 'before') {
      return { ok: true, skipped: true, reason: 'BEFORE_WINDOW', runKey: runKey };
    }
    if (win.phase === 'missed') {
      const missed = await settle(
        store.insertMissed({
          runKey: runKey,
          runType: core.RUN_TYPE.PUBLISH,
          scheduledAt: scheduledAt,
          asOf: asOf,
        }),
      );
      return {
        ok: true,
        missed: true,
        runKey: runKey,
        run: missed.run,
        status: core.RUN_STATUS.MISSED,
      };
    }
  }

  // Gate: collect must succeed first (unless explicitly bypassed for unit isolation — never for production path)
  if (!opt.skipCollectGate) {
    const collectKey = core.collectRunKey(dateKey, opt);
    const collectGot = await settle(store.getByRunKey(collectKey));
    const gate = core.collectAllowsPublish(collectGot.run);
    if (!gate.ok) {
      const claimBlocked = await settle(
        store.tryClaimRun({
          runKey: runKey,
          runType: core.RUN_TYPE.PUBLISH,
          scheduledAt: scheduledAt,
          startedAt: asOf,
          allowRetryAfterFailure: !!opt.manual,
          meta: { blocked: true, collectGate: gate.errorCode },
        }),
      );
      if (!claimBlocked.claimed) {
        return {
          ok: true,
          skipped: true,
          reason: claimBlocked.reason || 'DUPLICATE_RUN_KEY',
          status: core.RUN_STATUS.SKIPPED_DUPLICATE,
          runKey: runKey,
          run: claimBlocked.run,
        };
      }
      const finished = await settle(
        store.finishRun(runKey, {
          status: core.RUN_STATUS.BLOCKED,
          finishedAt: new Date().toISOString(),
          errorCode: gate.errorCode || 'BLOCKED',
          errorSummary: 'Publish blocked: collect not successful for ' + dateKey,
          meta: claimBlocked.run.meta,
        }),
      );
      return {
        ok: false,
        blocked: true,
        runKey: runKey,
        status: core.RUN_STATUS.BLOCKED,
        run: finished.run,
        errorCode: gate.errorCode,
      };
    }
  }

  const claim = await settle(
    store.tryClaimRun({
      runKey: runKey,
      runType: core.RUN_TYPE.PUBLISH,
      scheduledAt: scheduledAt,
      startedAt: asOf,
      allowRetryAfterFailure: !!opt.allowRetryAfterFailure || !!opt.manual,
      meta: { actor: opt.actorId || decisionCore.ACTOR_AUTO_MORNING, manual: !!opt.manual },
    }),
  );

  if (!claim.claimed) {
    return {
      ok: true,
      skipped: true,
      reason: claim.reason || 'DUPLICATE_RUN_KEY',
      status: core.RUN_STATUS.SKIPPED_DUPLICATE,
      runKey: runKey,
      run: claim.run,
    };
  }

  try {
    const publisher = opt.publishRunner || reviewService.runMorningAutoPublish;
    const morning = await settle(
      publisher({
        repositoryInstance: opt.repositoryInstance,
        repository: opt.repository,
        reviewRoot: opt.reviewRoot,
        asOf: asOf,
        force: true,
        dryRun: !!opt.dryRun,
        ignoreMorningWindow: true,
      }),
    );

    const summary = core.summarizePublishOutcome(morning);
    // Re-count MANUAL still READY
    let manualCount = summary.counters.manualReviewCount;
    let autoEligible = 0;
    if (opt.repositoryInstance) {
      const listed = await settle(opt.repositoryInstance.list({ status: 'READY_FOR_REVIEW' }));
      const counts = countDecisions((listed && listed.items) || []);
      manualCount = counts.manualReviewCount;
      autoEligible = counts.autoEligibleCount;
    }

    const finished = await settle(
      store.finishRun(runKey, {
        status: summary.status,
        finishedAt: new Date().toISOString(),
        autoPublishedCount: summary.counters.autoPublishedCount,
        autoEligibleCount: autoEligible,
        manualReviewCount: manualCount,
        skippedDuplicateCount: summary.counters.skippedDuplicateCount,
        errorCode: summary.errorCode,
        errorSummary: summary.errorSummary,
        meta: Object.assign({}, claim.run.meta || {}, {
          publishedIds: morning.publishedIds || [],
          warningZeroPublish: !!summary.warningZeroPublish,
        }),
      }),
    );

    return {
      ok: summary.status !== core.RUN_STATUS.FAILED,
      runKey: runKey,
      status: summary.status,
      run: finished.run,
      morning: morning,
      warningZeroPublish: !!summary.warningZeroPublish,
    };
  } catch (e) {
    const finished = await settle(
      store.finishRun(runKey, {
        status: core.RUN_STATUS.FAILED,
        finishedAt: new Date().toISOString(),
        errorCode: 'PUBLISH_EXCEPTION',
        errorSummary: String(e && e.message ? e.message : e).slice(0, 500),
        meta: claim.run.meta,
      }),
    );
    return { ok: false, runKey: runKey, status: core.RUN_STATUS.FAILED, run: finished.run, error: e };
  }
}

/**
 * Tick: catch-up / miss for today's collect & publish. Safe to call often.
 */
async function tick(options) {
  const opt = options || {};
  const cfg = loadConfig(opt);
  if (!cfg.enabled && !opt.forceEnabled) {
    return { ok: true, skipped: true, reason: 'SCHEDULER_DISABLED' };
  }
  const asOf = opt.asOf || new Date().toISOString();
  const parts = core.kstParts(asOf);
  const dateKey = parts.dateKey;
  const results = { dateKey: dateKey, collect: null, publish: null };

  const collectScheduled = core.scheduledAtIso(dateKey, cfg.collectHour, cfg.collectMinute);
  const publishScheduled = core.scheduledAtIso(dateKey, cfg.publishHour, cfg.publishMinute);

  const collectWin = core.evaluateWindow(asOf, collectScheduled, cfg.catchupMinutes);
  if (collectWin.phase === 'in_window' || collectWin.phase === 'missed') {
    results.collect = await runCollect(
      Object.assign({}, opt, {
        asOf: asOf,
        dateKey: dateKey,
        scheduledAt: collectScheduled,
        force: false,
      }),
    );
  }

  const publishWin = core.evaluateWindow(asOf, publishScheduled, cfg.catchupMinutes);
  if (publishWin.phase === 'in_window' || publishWin.phase === 'missed') {
    results.publish = await runPublish(
      Object.assign({}, opt, {
        asOf: asOf,
        dateKey: dateKey,
        scheduledAt: publishScheduled,
        force: false,
      }),
    );
  }

  return { ok: true, results: results, config: cfg };
}

async function getStatus(options) {
  const opt = options || {};
  const cfg = loadConfig(opt);
  const asOf = opt.asOf || new Date().toISOString();
  const store = resolveStore(opt);
  await settle(store.initialize && store.initialize());
  const listed = await settle(store.listRuns({ limit: 40 }));
  const items = (listed && listed.items) || [];
  const lastCollect = items.find(function (r) {
    return r.runType === core.RUN_TYPE.COLLECT;
  });
  const lastPublish = items.find(function (r) {
    return r.runType === core.RUN_TYPE.PUBLISH;
  });
  const alerts = core.buildAlerts({ lastCollect: lastCollect, lastPublish: lastPublish });
  return {
    ok: true,
    enabled: cfg.enabled,
    timezone: core.TIMEZONE,
    catchupMinutes: cfg.catchupMinutes,
    nextCollectAt: core.nextOccurrence(asOf, cfg.collectHour, cfg.collectMinute),
    nextPublishAt: core.nextOccurrence(asOf, cfg.publishHour, cfg.publishMinute),
    collectCron: cfg.collectMinute + ' ' + cfg.collectHour + ' * * *',
    publishCron: cfg.publishMinute + ' ' + cfg.publishHour + ' * * *',
    lastCollect: lastCollect || null,
    lastPublish: lastPublish || null,
    alerts: alerts,
    asOf: asOf,
  };
}

async function getHistory(options) {
  const opt = options || {};
  const store = resolveStore(opt);
  await settle(store.initialize && store.initialize());
  return settle(
    store.listRuns({
      runType: opt.runType,
      status: opt.status,
      limit: opt.limit,
      offset: opt.offset,
    }),
  );
}

function allowManualRun(options) {
  const opt = options || {};
  if (opt.allowManual === true) return { ok: true };
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  if (env === 'production') {
    if (core.isTruthy(process.env.DAILY_ISSUE_MORNING_MANUAL_RUN_ENABLED)) return { ok: true };
    return { ok: false, error: 'MANUAL_RUN_DISABLED_IN_PRODUCTION' };
  }
  return { ok: true };
}

function startMorningScheduler(options) {
  const opt = options || {};
  const cfg = loadConfig(opt);
  if (!cfg.enabled && !opt.forceEnabled) {
    return { ok: true, started: false, reason: 'SCHEDULER_DISABLED' };
  }
  const intervalMs = Number(opt.intervalMs) > 0 ? Number(opt.intervalMs) : 30000;
  const timer = setInterval(function () {
    tick(opt).catch(function (e) {
      console.error('[daily-issue-morning-scheduler]', String(e && e.message ? e.message : e));
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // immediate catch-up check
  tick(opt).catch(function () {});
  return { ok: true, started: true, intervalMs: intervalMs, stop: function () {
    clearInterval(timer);
  } };
}

module.exports = {
  loadConfig: loadConfig,
  resolveStore: resolveStore,
  runCollect: runCollect,
  runPublish: runPublish,
  tick: tick,
  getStatus: getStatus,
  getHistory: getHistory,
  allowManualRun: allowManualRun,
  startMorningScheduler: startMorningScheduler,
  defaultCollectAndEnqueue: defaultCollectAndEnqueue,
  countDecisions: countDecisions,
};
