'use strict';

/**
 * 미국 데일리 이슈 — 한국 ingest·품질·검수 엔진 재사용 (activityRegion US).
 * 한국 아침 스케줄·runKey·morning store 는 건드리지 않는다.
 */

const usOps = require('../shared/daily-issue-us-ops-core');
const reviewService = require('./daily-issue-review-service');
const morningScheduler = require('./daily-issue-morning-scheduler-service');
const { createUsSchedulerStore } = require('./daily-issue-us-scheduler-store');
const { createDailyIssueReviewRepository } = require('./daily-issue-review-repository');

function settle(v) {
  if (v && typeof v.then === 'function') return v;
  return Promise.resolve(v);
}

function isUsAutoPublishEnabled(env) {
  const e = env || process.env;
  return (
    usOps.isSchedulerEnabled(e) &&
    (String(e.DAILY_ISSUE_US_AUTO_PUBLISH || '').trim() === '1' ||
      String(e.DAILY_ISSUE_US_AUTO_PUBLISH || '').trim().toLowerCase() === 'true')
  );
}

function resolveReviewRepo(opt) {
  if (opt.repositoryInstance) return opt.repositoryInstance;
  return createDailyIssueReviewRepository({
    kind: opt.repository || opt.repositoryKind,
    reviewRoot: opt.reviewRoot,
    schemaName: opt.schemaName,
    databaseUrl: opt.databaseUrl,
    executor: opt.executor,
    client: opt.client,
  });
}

function collectionModeFromOpt(opt) {
  if (opt.skipNetwork || opt.feedBodies) return 'FIXTURE';
  if (opt.mockIngest === true) return 'MOCK';
  return 'LIVE';
}

function buildLiveAssessBundle(cand, ingestResult, opt) {
  const sources = (cand.normalizedSources || cand.sourceRefs || []).map(function (s) {
    return {
      url: s.url,
      date: String(s.publishedAt || s.updatedAt || '').slice(0, 10) || null,
    };
  });
  const claims = (cand.claims || []).filter(function (c) {
    return c && c.classification === 'CONFIRMED_FACT';
  });
  return {
    liveAiConfirmed: collectionModeFromOpt(opt) === 'LIVE' && ingestResult && ingestResult.ok !== false,
    mock: collectionModeFromOpt(opt) !== 'LIVE',
    sample: opt.sample === true,
    sources: sources,
    eventDate: cand.latestPublishedAt || cand.latestSourcePublishedAt,
    articleDate: cand.latestPublishedAt || cand.latestSourcePublishedAt,
    relevant: true,
    duplicate: false,
    issue: {
      title: cand.title,
      verifiedFactSummary: cand.confirmedSummary || cand.summary,
      keyPoints: claims.length ? claims.map(function (c) { return c.text; }).slice(0, 5) : [cand.confirmedSummary || cand.title],
      discussionQuestion: cand.discussionPrompt,
      sources: sources,
    },
  };
}

async function countPublishedUsOnDate(repo, dateKey, asOf) {
  const pub = await settle(repo.getPublishedIssues({}));
  if (!pub || pub.ok === false) return { ok: false, count: 0, error: (pub && pub.error) || 'DATABASE_UNAVAILABLE' };
  const items = (pub.items || []).filter(function (it) {
    return usOps.issueRegion(it) === 'US';
  });
  let count = 0;
  items.forEach(function (it) {
    const when = it.publishedAt || it.approvedAt || it.reviewedAt;
    if (!when) return;
    const slot = usOps.slotFor(when);
    if (slot.dateKey === dateKey) count += 1;
  });
  return { ok: true, count: count, asOf: asOf };
}

function classifyOutcome(result) {
  const r = result || {};
  if (r.reason === 'ALREADY_PUBLISHED' || r.duplicateBlocked) return 'DUPLICATE_BLOCKED';
  if (r.outcome) return r.outcome;
  if (r.publishedCount > 0) return 'PUBLISH_SUCCESS';
  if (r.collectionFailed) return 'COLLECT_FAILED';
  if (r.aiNotConfigured) return 'AI_NOT_CONFIGURED';
  if (r.aiValidationFailed) return 'AI_OUTPUT_VALIDATION_FAILED';
  if (r.aiCallFailed) return 'AI_CALL_FAILED';
  if (r.qualityEvalFailed) return 'AI_EVAL_FAILED';
  if (r.dbSaveFailed) return 'DB_SAVE_FAILED';
  if (r.publishedCount === 0 && r.ok !== false) return 'ZERO_NORMAL';
  return r.error || 'UNKNOWN';
}

async function usCollectAndEnqueue(options) {
  const opt = options || {};
  return morningScheduler.defaultCollectAndEnqueue(
    Object.assign({}, opt, {
      language: opt.language || 'en',
      group: opt.group || 'us-national',
      activityRegion: 'US',
      dryRun: opt.dryRun === true,
    }),
  );
}

async function runUsDailyIssueSlot(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const env = opt.env || process.env;
  const slot = usOps.slotFor(asOf);
  const store = opt.usStore || createUsSchedulerStore(opt.usStoreSeed ? { initialRuns: opt.usStoreSeed } : {});
  const notices = opt.notices;
  const repo = resolveReviewRepo(opt);

  if (!slot.due && opt.forceEnabled !== true && opt.forceSlot !== true) {
    return { ok: true, started: false, reason: 'NOT_DUE', slot: slot };
  }

  const runKey = opt.runKey || slot.runKey;
  if (!runKey) return { ok: true, started: false, reason: 'NOT_DUE' };

  const existing = store.getByRunKey(runKey);
  if (existing && existing.status === 'SUCCESS') {
    return {
      ok: true,
      started: false,
      reason: 'ALREADY_PUBLISHED',
      runKey: runKey,
      outcome: 'DUPLICATE_BLOCKED',
      published: existing.publishedCount || 0,
      publishedIds: existing.publishedIds || [],
    };
  }

  const claim = store.tryClaimRun({
    runKey: runKey,
    startedAt: asOf,
    allowRetryAfterFailure: opt.allowRetryAfterFailure === true,
    meta: { activityRegion: 'US', hour: slot.hour },
  });
  if (!claim.claimed) {
    return {
      ok: true,
      started: false,
      reason: claim.reason || 'ALREADY_PUBLISHED',
      runKey: runKey,
      outcome: 'DUPLICATE_BLOCKED',
    };
  }

  const dayCount = await countPublishedUsOnDate(repo, slot.dateKey, asOf);
  if (opt.publishedTodayOverride != null) {
    dayCount.count = Number(opt.publishedTodayOverride);
    dayCount.ok = true;
  }
  if (!dayCount.ok) {
    store.finishRun(runKey, { status: 'FAILED', errorCode: 'DB_READ_FAILED', dbStatus: 'UNKNOWN' });
    if (notices) notices.notify({ kind: 'MAJOR_PUBLISH_ERROR', runKey: runKey, error: dayCount.error });
    return { ok: false, runKey: runKey, dbSaveFailed: true, outcome: 'DB_SAVE_FAILED', error: dayCount.error };
  }
  if (dayCount.count >= usOps.slotFor(asOf).maxPerDay) {
    store.finishRun(runKey, { status: 'SUCCESS', publishedCount: 0, outcome: 'ZERO_NORMAL', note: 'DAILY_MAX_REACHED' });
    return { ok: true, published: 0, publishedCount: 0, runKey: runKey, outcome: 'ZERO_NORMAL', reason: 'DAILY_MAX_REACHED' };
  }

  const collect = await settle(
    usCollectAndEnqueue(
      Object.assign({}, opt, {
        asOf: asOf,
        repositoryInstance: repo,
        skipNetwork: opt.skipNetwork,
        feedBodies: opt.feedBodies,
        ingestRunner: opt.ingestRunner,
        cacheRoot: opt.cacheRoot,
        dryRun: opt.persist === false,
      }),
    ),
  );

  if (!collect || collect.ok === false) {
    const code = (collect && collect.errorCode) || 'COLLECT_FAILED';
    const retry = usOps.retryDecision({ error: code, attempt: Number((existing && existing.attempt) || 0) });
    store.finishRun(runKey, {
      status: 'FAILED',
      errorCode: code,
      attempt: Number((existing && existing.attempt) || 0) + 1,
      collectionFailed: true,
      outcome: 'COLLECT_FAILED',
    });
    if (retry.retry && notices) notices.notify({ kind: 'REPEATED_FAILURE', runKey: runKey, error: code });
    return {
      ok: false,
      runKey: runKey,
      collectionFailed: true,
      outcome: 'COLLECT_FAILED',
      error: code,
      retry: retry,
      ingest: collect && collect.ingest,
    };
  }

  const readyCount = collect.candidateCount || 0;
  const usAiRun = collect.usAiRun || collect.regionAiRun || null;
  if (usAiRun && usAiRun.blockedNotConfigured) {
    const ingestReady =
      (collect.ingest &&
        (collect.ingest.readyCandidates || []).filter(function (c) {
          return c && c.ok && c.publicationStatus === 'READY';
        }).length) ||
      0;
    if (ingestReady > 0) {
    store.finishRun(runKey, {
      status: 'SUCCESS',
      publishedCount: 0,
      outcome: 'AI_NOT_CONFIGURED',
      usAiRun: usAiRun,
    });
    return {
      ok: true,
      published: 0,
      publishedCount: 0,
      runKey: runKey,
      outcome: 'AI_NOT_CONFIGURED',
      aiNotConfigured: true,
      collect: collect,
    };
    }
  }
  if (readyCount === 0) {
    store.finishRun(runKey, { status: 'SUCCESS', publishedCount: 0, outcome: 'ZERO_NORMAL' });
    return {
      ok: true,
      published: 0,
      publishedCount: 0,
      runKey: runKey,
      outcome: 'ZERO_NORMAL',
      collectionStatus: collectionModeFromOpt(opt) === 'LIVE' ? 'LIVE_EMPTY' : 'FIXTURE_EMPTY',
      collect: collect,
    };
  }

  const mode = collectionModeFromOpt(opt);
  if (mode === 'LIVE' && usAiRun && usAiRun.eligible > 0 && usAiRun.aiCallOk === 0 && !usAiRun.blockedNotConfigured) {
    const failOutcome =
      usAiRun.validationFailed > 0 ? 'AI_OUTPUT_VALIDATION_FAILED' : 'AI_CALL_FAILED';
    store.finishRun(runKey, {
      status: 'SUCCESS',
      publishedCount: 0,
      outcome: failOutcome,
      usAiRun: usAiRun,
    });
    return {
      ok: true,
      published: 0,
      publishedCount: 0,
      runKey: runKey,
      outcome: failOutcome,
      aiCallFailed: failOutcome === 'AI_CALL_FAILED',
      aiValidationFailed: failOutcome === 'AI_OUTPUT_VALIDATION_FAILED',
      collect: collect,
    };
  }

  const allowPublish = opt.forceAutoPublish === true || isUsAutoPublishEnabled(env);
  if (!allowPublish) {
    store.finishRun(runKey, {
      status: 'SUCCESS',
      publishedCount: 0,
      enqueuedOnly: true,
      outcome: 'ZERO_NORMAL',
      note: 'US_AUTO_PUBLISH_DISABLED',
    });
    return {
      ok: true,
      published: 0,
      publishedCount: 0,
      runKey: runKey,
      outcome: 'ZERO_NORMAL',
      reason: 'US_AUTO_PUBLISH_DISABLED',
      collect: collect,
    };
  }

  const pub = await settle(
    reviewService.runMorningAutoPublish({
      repositoryInstance: repo,
      asOf: asOf,
      ignoreMorningWindow: true,
      forceAutoPublish: true,
      activityRegion: 'US',
      maxPublishCount: 1,
      env: env,
    }),
  );

  if (!pub || pub.ok === false) {
    store.finishRun(runKey, { status: 'FAILED', dbSaveFailed: true, dbStatus: 'UNKNOWN', outcome: 'DB_SAVE_FAILED' });
    if (notices) notices.notify({ kind: 'MAJOR_PUBLISH_ERROR', runKey: runKey, error: (pub && pub.error) || 'PUBLISH_FAILED' });
    return { ok: false, runKey: runKey, dbSaveFailed: true, outcome: 'DB_SAVE_FAILED', publish: pub };
  }

  const publishedIds = pub.publishedIds || [];
  if (publishedIds.length === 0 && (pub.blocked || []).length) {
    store.finishRun(runKey, {
      status: 'SUCCESS',
      publishedCount: 0,
      outcome: 'AI_EVAL_FAILED',
      blocked: pub.blocked,
    });
    return {
      ok: true,
      published: 0,
      publishedCount: 0,
      runKey: runKey,
      outcome: 'AI_EVAL_FAILED',
      qualityEvalFailed: true,
      blocked: pub.blocked,
    };
  }

  store.finishRun(runKey, {
    status: 'SUCCESS',
    publishedCount: publishedIds.length,
    publishedIds: publishedIds,
    outcome: publishedIds.length ? 'PUBLISH_SUCCESS' : 'ZERO_NORMAL',
  });

  return {
    ok: true,
    started: true,
    published: publishedIds.length,
    publishedCount: publishedIds.length,
    publishedIds: publishedIds,
    runKey: runKey,
    outcome: publishedIds.length ? 'PUBLISH_SUCCESS' : 'ZERO_NORMAL',
    collectionStatus: mode === 'LIVE' ? 'LIVE_AI_ACCEPTED' : 'FIXTURE_PIPELINE',
    collect: collect,
    publish: pub,
  };
}

module.exports = {
  runUsDailyIssueSlot: runUsDailyIssueSlot,
  usCollectAndEnqueue: usCollectAndEnqueue,
  classifyOutcome: classifyOutcome,
  collectionModeFromOpt: collectionModeFromOpt,
  isUsAutoPublishEnabled: isUsAutoPublishEnabled,
  countPublishedUsOnDate: countPublishedUsOnDate,
  createUsSchedulerStore: createUsSchedulerStore,
};
