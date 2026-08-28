'use strict';

/**
 * 데일리 이슈 승인대기 운영 서비스
 * — 버전 보존 · 운영자 승인 없이 공개 금지 · 예약 재취합은 DB/JSON persist
 */

const path = require('path');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const opsCore = require('../shared/daily-issue-ops-core');
const qualityCore = require('../shared/daily-issue-quality-core');
const freshnessCore = require('../shared/daily-issue-freshness-core');
const jsonRepoMod = require('./daily-issue-review-json-repository');
const { createRecollectJobStore } = require('./daily-issue-recollect-job-store');

function settle(v) {
  if (v && typeof v.then === 'function') return v;
  return Promise.resolve(v);
}

function resolveReviewService() {
  return require('./daily-issue-review-service');
}

function resolveRepo(opt) {
  return resolveReviewService().resolveRepo(opt || {});
}

function resolveJobStore(opt) {
  const o = opt || {};
  if (o.jobStore) return o.jobStore;
  return createRecollectJobStore({
    kind: o.repository || o.repositoryKind,
    reviewRoot: o.reviewRoot || jsonRepoMod.DEFAULT_REVIEW_ROOT,
    executor: o.executor,
    databaseUrl: o.databaseUrl,
    schemaName: o.schemaName,
  });
}

async function persistItem(repo, current, next, audit) {
  const result = await settle(
    repo.transitionReviewItem({
      id: current.id,
      expectedStatus: current.status,
      expectedLockVersion: current.lockVersion,
      nextItem: next,
      targetBucket: lifecycle.storageBucketForStatus(next.status || current.status),
      auditEvents: audit ? [audit] : [],
    }),
  );
  return result;
}

function auditEvent(item, action, opt) {
  const o = opt || {};
  return {
    entityId: item.id,
    fromStatus: item.status,
    toStatus: item.status,
    action: action,
    actorId: o.actorId || o.reviewer || 'operator',
    reasonCode: o.reasonCode || action,
    reasonText: o.reasonText || o.instruction || '',
    timestamp: o.asOf || new Date().toISOString(),
    snapshotHash: jsonRepoMod.snapshotHash(item),
    payload: o.payload || null,
  };
}

async function loadItem(opt, id) {
  const repo = resolveRepo(opt);
  const found = await settle(repo.getById(id));
  if (!found || !found.ok) return { ok: false, error: (found && found.error) || 'ITEM_NOT_FOUND' };
  const item = opsCore.ensureOpsMeta(Object.assign({}, found.item), opt && opt.asOf);
  return { ok: true, repo: repo, item: item };
}

function applyEditablePatch(snapshot, patch) {
  const next = opsCore.applySnapshot({}, snapshot);
  const p = patch || {};
  if (p.title != null) next.title = String(p.title).trim();
  if (p.confirmedSummary != null) next.confirmedSummary = String(p.confirmedSummary).trim();
  if (p.discussionPrompt != null) next.discussionPrompt = String(p.discussionPrompt).trim();
  if (Array.isArray(p.claims)) {
    next.claims = p.claims.map(function (c, idx) {
      const prev = (next.claims || [])[idx] || {};
      return Object.assign({}, prev, c, {
        id: c.id || prev.id,
        text: String(c.text != null ? c.text : prev.text || '').trim(),
      });
    });
  }
  if (Array.isArray(p.sourceRefs)) {
    next.sourceRefs = p.sourceRefs.map(function (s, idx) {
      const prev = (next.sourceRefs || [])[idx] || {};
      return Object.assign({}, prev, s, {
        id: s.id || prev.id,
        title: s.title != null ? String(s.title).trim() : prev.title,
        url: s.url != null ? String(s.url).trim() : prev.url,
        publisher: s.publisher != null ? String(s.publisher).trim() : prev.publisher,
      });
    });
  }
  if (p.displayGroups && typeof p.displayGroups === 'object') next.displayGroups = p.displayGroups;
  return next;
}

async function saveNewVersion(opt, current, snapshotItem, originMethod, instruction) {
  const asOf = (opt && opt.asOf) || new Date().toISOString();
  const appended = opsCore.appendVersion(current, {
    asOf: asOf,
    originMethod: originMethod,
    operatorInstruction: instruction,
    snapshotItem: snapshotItem,
    revisedAt: asOf,
  });
  const selected = opsCore.selectVersion(appended.item, appended.version.versionNumber);
  const next = selected.ok ? selected.item : appended.item;
  next.lifecycleMeta = Object.assign({}, next.lifecycleMeta || {}, {
    lastOriginMethod: originMethod,
    lastOperatorInstruction: instruction || '',
  });
  const saved = await persistItem(
    opt.repo,
    current,
    next,
    auditEvent(next, 'ops_version_' + String(originMethod).toLowerCase(), {
      asOf: asOf,
      actorId: opt.actorId,
      instruction: instruction,
      payload: { versionNumber: appended.version.versionNumber, originMethod: originMethod },
    }),
  );
  if (!saved.ok) return saved;
  return { ok: true, item: opsCore.ensureOpsMeta(saved.item, asOf), version: appended.version };
}

function rebuildFromExisting(item, instruction, asOf) {
  const snap = opsCore.extractSnapshot(item);
  const filtered = opsCore.applyInstructionFilters(snap, instruction);
  const built = qualityCore.buildDailyIssueCandidate({
    title: filtered.title,
    discussionPrompt: filtered.discussionPrompt || item.discussionPrompt || '이 사안을 어떻게 평가하시나요?',
    sources: filtered.sourceRefs || item.sourceRefs || [],
    evidences: filtered.evidenceRefs || item.evidenceRefs || [],
    candidateClaims: filtered.claims || item.claims || [],
    retrievedAt: asOf,
  });
  const gated = freshnessCore.applyFreshnessGateToCandidate(built, {
    asOf: asOf,
    category: item.category,
  });
  return Object.assign({}, item, {
    title: gated.title || filtered.title || item.title,
    confirmedSummary: gated.confirmedSummary || filtered.confirmedSummary,
    discussionPrompt: gated.discussionPrompt || filtered.discussionPrompt,
    claims: gated.claims || filtered.claims,
    sourceRefs: gated.sourceRefs || gated.normalizedSources || filtered.sourceRefs,
    evidenceRefs: gated.evidences || gated.normalizedEvidences || filtered.evidenceRefs,
    displayGroups: gated.displayGroups || filtered.displayGroups,
    qualityMeta: Object.assign({}, item.qualityMeta || {}, {
      ok: gated.ok === true,
      publicationStatus: gated.publicationStatus,
      qualityFailureReasons: gated.qualityFailureReasons || [],
      qualityCheckedAt: asOf,
    }),
    freshnessMeta: Object.assign({}, item.freshnessMeta || {}, {
      ok: gated.freshnessOk === true,
      freshnessOk: gated.freshnessOk === true,
      freshnessClass: gated.freshnessClass,
      freshnessFailureReasons: gated.freshnessFailureReasons || [],
      freshnessCheckedAt: asOf,
    }),
  });
}

async function manualEdit(options) {
  const opt = options || {};
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  const gate = opsCore.canOperatorMutate(loaded.item, opt.asOf);
  if (!gate.ok) return { ok: false, error: 'OPS_BLOCKED', reasons: gate.reasons };
  if (String(loaded.item.status) === 'PUBLISHED') {
    // published: still create a draft version, do not go live
  } else if (!opsCore.isPendingQueueStatus(loaded.item.status) && loaded.item.status !== 'PUBLISHED') {
    return { ok: false, error: 'OPS_BLOCKED', reasons: ['NOT_EDITABLE_STATUS'] };
  }
  const selected = opsCore.getVersion(loaded.item, loaded.item.selectedVersionNumber) || {
    snapshot: opsCore.extractSnapshot(loaded.item),
  };
  const patched = applyEditablePatch(selected.snapshot, opt.patch || {});
  const snapshotItem = opsCore.applySnapshot(loaded.item, patched);
  return saveNewVersion(
    Object.assign({}, opt, { repo: loaded.repo }),
    loaded.item,
    snapshotItem,
    opsCore.ORIGIN.MANUAL_EDIT,
    opt.instruction || '',
  );
}

async function aiRevise(options) {
  const opt = options || {};
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  const gate = opsCore.canOperatorMutate(loaded.item, opt.asOf);
  if (!gate.ok) return { ok: false, error: 'OPS_BLOCKED', reasons: gate.reasons };
  const instruction = String(opt.instruction || '').trim();
  if (!instruction) return { ok: false, error: 'INSTRUCTION_REQUIRED' };
  const asOf = opt.asOf || new Date().toISOString();
  const rebuilt = rebuildFromExisting(loaded.item, instruction, asOf);
  return saveNewVersion(
    Object.assign({}, opt, { repo: loaded.repo }),
    loaded.item,
    rebuilt,
    opsCore.ORIGIN.AI_REVISE,
    instruction,
  );
}

function pickRecollectCandidate(item, ingestResult) {
  const ready =
    (ingestResult && ingestResult.readyCandidates) ||
    (ingestResult && ingestResult.candidates) ||
    [];
  let best = null;
  let bestScore = 0;
  ready.forEach(function (c) {
    if (!c || c.ok === false) return;
    const score = opsCore.scoreCandidateMatch(item, c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });
  if (best && bestScore >= 20) return { candidate: best, score: bestScore };
  return { candidate: null, score: bestScore };
}

async function runIngestForRecollect(opt) {
  if (typeof opt.ingestRunner === 'function') {
    return settle(
      opt.ingestRunner({
        dryRun: true,
        asOf: opt.asOf,
        language: opt.language || 'ko',
        skipNetwork: opt.skipNetwork,
        feedBodies: opt.feedBodies,
        sinceHours: opt.sinceHours != null ? opt.sinceHours : 12,
        maxItems: opt.maxItems,
      }),
    );
  }
  const ingest = require('./daily-issue-ingest-service').runDailyIssueIngest;
  return settle(
    ingest({
      dryRun: true,
      language: opt.language || 'ko',
      skipNetwork: !!opt.skipNetwork,
      feedBodies: opt.feedBodies,
      sinceHours: opt.sinceHours != null ? opt.sinceHours : 12,
      maxItems: opt.maxItems,
      cacheRoot: opt.cacheRoot,
      asOf: opt.asOf,
    }),
  );
}

function candidateToSnapshotItem(item, candidate, asOf) {
  return Object.assign({}, item, {
    title: candidate.title || candidate.topic || item.title,
    confirmedSummary: candidate.confirmedSummary || item.confirmedSummary,
    discussionPrompt: candidate.discussionPrompt || item.discussionPrompt,
    claims: candidate.claims || item.claims,
    sourceRefs: candidate.sourceRefs || candidate.normalizedSources || item.sourceRefs,
    evidenceRefs: candidate.evidences || candidate.evidenceRefs || item.evidenceRefs,
    displayGroups: candidate.displayGroups || item.displayGroups,
    qualityMeta: Object.assign({}, item.qualityMeta || {}, {
      ok: candidate.ok === true,
      publicationStatus: candidate.publicationStatus,
      qualityFailureReasons: candidate.qualityFailureReasons || [],
      qualityCheckedAt: asOf,
    }),
    freshnessMeta: Object.assign({}, item.freshnessMeta || {}, {
      ok: candidate.freshnessOk === true,
      freshnessOk: candidate.freshnessOk === true,
      freshnessClass: candidate.freshnessClass,
      freshnessFailureReasons: candidate.freshnessFailureReasons || [],
      freshnessCheckedAt: asOf,
    }),
    noveltySignals: candidate.noveltySignals || item.noveltySignals || [],
  });
}

async function recrawlNow(options) {
  const opt = options || {};
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  const gate = opsCore.canOperatorMutate(loaded.item, opt.asOf);
  if (!gate.ok) return { ok: false, error: 'OPS_BLOCKED', reasons: gate.reasons };
  const asOf = opt.asOf || new Date().toISOString();
  const origin = opt.originMethod || opsCore.ORIGIN.RECOLLECT;
  const ingestResult = await runIngestForRecollect(Object.assign({}, opt, { asOf: asOf }));
  let snapshotItem;
  const picked = pickRecollectCandidate(loaded.item, ingestResult);
  if (picked.candidate) {
    snapshotItem = candidateToSnapshotItem(loaded.item, picked.candidate, asOf);
  } else {
    snapshotItem = rebuildFromExisting(loaded.item, opt.instruction || '', asOf);
  }
  const saved = await saveNewVersion(
    Object.assign({}, opt, { repo: loaded.repo }),
    loaded.item,
    snapshotItem,
    origin,
    opt.instruction || '',
  );
  if (!saved.ok) return saved;
  saved.ingestMatched = !!picked.candidate;
  saved.matchScore = picked.score;
  saved.ingest = ingestResult;
  return saved;
}

async function scheduleRecollect(options) {
  const opt = options || {};
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  const gate = opsCore.canOperatorMutate(loaded.item, opt.asOf);
  if (!gate.ok) return { ok: false, error: 'OPS_BLOCKED', reasons: gate.reasons };
  const delay = opsCore.resolveDelayMinutes(opt);
  if (!delay.ok) return delay;
  const asOf = opt.asOf || new Date().toISOString();
  const scheduledAt = new Date(Date.parse(asOf) + delay.minutes * 60 * 1000).toISOString();
  const store = resolveJobStore(opt);
  await settle(store.initialize && store.initialize());
  const existing = await settle(store.listJobs({ reviewItemId: loaded.item.id, status: opsCore.JOB_STATUS.PENDING }));
  const pendingSame = ((existing && existing.items) || []).some(function (j) {
    return j && j.scheduledAt === scheduledAt;
  });
  if (pendingSame) return { ok: false, error: 'DUPLICATE_JOB' };
  const inserted = await settle(
    store.insertJob({
      reviewItemId: loaded.item.id,
      scheduledAt: scheduledAt,
      createdAt: asOf,
      status: opsCore.JOB_STATUS.PENDING,
      delayMinutes: delay.minutes,
      instruction: String(opt.instruction || '').trim(),
      originMethod: opsCore.ORIGIN.SCHEDULED_RECOLLECT,
      meta: { issueDate: loaded.item.issueDate },
    }),
  );
  if (!inserted.ok) return inserted;
  return { ok: true, job: inserted.job, item: loaded.item };
}

async function cancelRecollect(options) {
  const opt = options || {};
  const store = resolveJobStore(opt);
  await settle(store.initialize && store.initialize());
  const runKey = opt.runKey || opt.jobId;
  if (!runKey) return { ok: false, error: 'JOB_KEY_REQUIRED' };
  let jobRes = await settle(store.getByRunKey(runKey));
  if ((!jobRes.job) && store.getById) {
    jobRes = await settle(store.getById(runKey));
  }
  const job = jobRes.job;
  if (!job) return { ok: false, error: 'NOT_FOUND' };
  return settle(store.cancelJob(job.runKey, opt.asOf || new Date().toISOString()));
}

async function selectDraftVersion(options) {
  const opt = options || {};
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  const gate = opsCore.canOperatorMutate(loaded.item, opt.asOf);
  if (!gate.ok && loaded.item.status !== 'PUBLISHED') {
    return { ok: false, error: 'OPS_BLOCKED', reasons: gate.reasons };
  }
  const selected = opsCore.selectVersion(loaded.item, opt.versionNumber);
  if (!selected.ok) return selected;
  if (loaded.item.status === 'PUBLISHED') {
    // selecting a draft on published does not go live
    const next = Object.assign({}, loaded.item, {
      draftVersions: selected.item.draftVersions,
      selectedVersionNumber: selected.item.selectedVersionNumber,
      lifecycleMeta: selected.item.lifecycleMeta,
    });
    const saved = await persistItem(
      loaded.repo,
      loaded.item,
      next,
      auditEvent(next, 'ops_select_version', {
        asOf: opt.asOf,
        actorId: opt.actorId,
        payload: { versionNumber: opt.versionNumber },
      }),
    );
    if (!saved.ok) return saved;
    return { ok: true, item: opsCore.ensureOpsMeta(saved.item, opt.asOf), liveUnchanged: true };
  }
  const saved = await persistItem(
    loaded.repo,
    loaded.item,
    selected.item,
    auditEvent(selected.item, 'ops_select_version', {
      asOf: opt.asOf,
      actorId: opt.actorId,
      payload: { versionNumber: opt.versionNumber },
    }),
  );
  if (!saved.ok) return saved;
  return { ok: true, item: opsCore.ensureOpsMeta(saved.item, opt.asOf) };
}

async function discardItem(options) {
  const opt = options || {};
  const reviewService = resolveReviewService();
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  if (loaded.item.status === 'PUBLISHED') {
    return { ok: false, error: 'OPS_BLOCKED', reasons: ['PUBLISHED_NOT_DISCARDABLE'] };
  }
  const asOf = opt.asOf || new Date().toISOString();
  const rejected = await settle(
    reviewService.transitionItem(loaded.item.id, lifecycle.REVIEW_STATUS.REJECTED, {
      repositoryInstance: loaded.repo,
      asOf: asOf,
      actorId: opt.actorId || 'operator',
      reviewer: opt.actorId || 'operator',
      reason: lifecycle.REJECT_REASONS.UNSUITABLE_FOR_DAILY_ISSUE,
      rejectReason: lifecycle.REJECT_REASONS.UNSUITABLE_FOR_DAILY_ISSUE,
      reasonText: opt.reasonText || 'operator discard',
      expectedStatus: loaded.item.status,
      expectedLockVersion: loaded.item.lockVersion,
      itemPatch: {
        discardedAt: asOf,
        lifecycleMeta: Object.assign({}, loaded.item.lifecycleMeta || {}, { discardedAt: asOf }),
      },
    }),
  );
  return rejected;
}

async function alreadyPublishedSame(repo, item) {
  const listed = await settle(repo.getPublishedIssues({}));
  const published = (listed && listed.items) || [];
  return published.some(function (p) {
    if (!p || p.id === item.id) return false;
    if (String(p.candidateId || '') && String(p.candidateId) === String(item.candidateId || '')) return true;
    if (p.contentSignature && item.contentSignature && p.contentSignature === item.contentSignature) return true;
    return false;
  });
}

async function approveAndPublish(options) {
  const opt = options || {};
  const reviewService = resolveReviewService();
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  const asOf = opt.asOf || new Date().toISOString();
  const gate = opsCore.canOperatorApprove(loaded.item, asOf);
  if (!gate.ok) return { ok: false, error: 'OPS_BLOCKED', reasons: gate.reasons };

  let working = loaded.item;
  const versionNumber = opt.versionNumber != null ? opt.versionNumber : working.selectedVersionNumber;
  const selected = opsCore.selectVersion(working, versionNumber);
  if (!selected.ok) return selected;
  working = selected.item;

  if (working.status === 'PUBLISHED') {
    const prevSnap = opsCore.extractSnapshot(loaded.item);
    working.contentUpdatedAt = asOf;
    working.lifecycleMeta = Object.assign({}, working.lifecycleMeta || {}, {
      contentUpdatedAt: asOf,
      selectedVersionNumber: Number(versionNumber),
    });
    working.updateHistory = (working.updateHistory || []).concat([
      { at: asOf, type: 'OPERATOR_UPDATE', note: 'approved draft version ' + versionNumber },
    ]);
    const saved = await persistItem(
      loaded.repo,
      loaded.item,
      working,
      auditEvent(working, 'ops_publish_update', {
        asOf: asOf,
        actorId: opt.actorId,
        payload: { versionNumber: versionNumber, previous: prevSnap.title },
      }),
    );
    if (!saved.ok) return saved;
    return {
      ok: true,
      published: true,
      updatedExisting: true,
      item: opsCore.ensureOpsMeta(saved.item, asOf),
      issueDate: working.issueDate,
    };
  }

  if (await alreadyPublishedSame(loaded.repo, working)) {
    return { ok: false, error: 'ALREADY_PUBLISHED_SAME', reasons: ['ALREADY_PUBLISHED_SAME_CANDIDATE'] };
  }

  const actor = opt.actorId || opt.reviewer || 'operator';
  const itemPatch = {
    issueDate: working.issueDate,
    selectedVersionNumber: Number(versionNumber),
    draftVersions: working.draftVersions,
    title: working.title,
    confirmedSummary: working.confirmedSummary,
    discussionPrompt: working.discussionPrompt,
    claims: working.claims,
    sourceRefs: working.sourceRefs,
    evidenceRefs: working.evidenceRefs,
    displayGroups: working.displayGroups,
    lifecycleMeta: Object.assign({}, working.lifecycleMeta || {}, {
      issueDate: working.issueDate,
      operatorApproved: true,
      autoMorningPublished: false,
      publishedBy: actor,
    }),
  };

  let approved = working;
  if (working.status !== lifecycle.REVIEW_STATUS.APPROVED) {
    const apr = await settle(
      reviewService.transitionItem(working.id, lifecycle.REVIEW_STATUS.APPROVED, {
        repositoryInstance: loaded.repo,
        asOf: asOf,
        actorId: actor,
        reviewer: actor,
        expectedStatus: loaded.item.status,
        expectedLockVersion: loaded.item.lockVersion,
        action: 'operator_approve',
        reasonText: opt.reasonText || 'operator approve and publish',
        itemPatch: itemPatch,
        operatorApproval: true,
      }),
    );
    if (!apr.ok) return apr;
    approved = apr.item;
  }

  const pub = await settle(
    reviewService.transitionItem(approved.id, lifecycle.REVIEW_STATUS.PUBLISHED, {
      repositoryInstance: loaded.repo,
      asOf: asOf,
      actorId: actor,
      reviewer: actor,
      expectedStatus: lifecycle.REVIEW_STATUS.APPROVED,
      expectedLockVersion: approved.lockVersion,
      action: 'operator_publish',
      reasonText: opt.reasonText || 'operator approve and publish',
      itemPatch: Object.assign({}, itemPatch, {
        issueDate: working.issueDate,
        publishedIssueDate: working.issueDate,
      }),
      operatorApproval: true,
    }),
  );
  if (!pub.ok) return pub;
  const published = opsCore.ensureOpsMeta(pub.item, asOf);
  published.issueDate = working.issueDate;
  return { ok: true, published: true, item: published, issueDate: working.issueDate };
}

async function createUpdateDraft(options) {
  const opt = options || {};
  const loaded = await loadItem(opt, opt.id);
  if (!loaded.ok) return loaded;
  if (loaded.item.status !== lifecycle.REVIEW_STATUS.PUBLISHED) {
    return { ok: false, error: 'OPS_BLOCKED', reasons: ['NOT_PUBLISHED'] };
  }
  return recrawlNow(
    Object.assign({}, opt, {
      originMethod: opsCore.ORIGIN.UPDATE_DRAFT,
    }),
  );
}

async function expirePendingApprovals(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const repo = resolveRepo(opt);
  const listed = await settle(repo.list({}));
  const items = (listed && listed.items) || [];
  const reviewService = resolveReviewService();
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (!raw || !opsCore.isPendingQueueStatus(raw.status)) continue;
    const item = opsCore.ensureOpsMeta(Object.assign({}, raw), asOf);
    if (!opsCore.isApprovalExpired(item, asOf)) continue;
    const res = await settle(
      reviewService.transitionItem(item.id, lifecycle.REVIEW_STATUS.EXPIRED, {
        repositoryInstance: repo,
        asOf: asOf,
        forceExpire: true,
        action: 'ops_approval_expire',
        reviewer: opt.reviewer || 'system',
        reasonText: 'APPROVAL_WINDOW_ENDED',
        itemPatch: {
          approvalExpiresAt: item.approvalExpiresAt,
          purgeEligibleAt: item.purgeEligibleAt,
          lifecycleMeta: Object.assign({}, item.lifecycleMeta || {}, {
            approvalExpired: true,
            purgeEligibleAt: item.purgeEligibleAt,
          }),
        },
      }),
    );
    results.push(res);
  }
  return {
    ok: true,
    expiredCount: results.filter(function (r) {
      return r && r.ok;
    }).length,
    results: results,
  };
}

async function processDueRecollectJobs(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const store = resolveJobStore(opt);
  await settle(store.initialize && store.initialize());
  const listed = await settle(store.listJobs({ status: opsCore.JOB_STATUS.PENDING }));
  const running = await settle(store.listJobs({ status: opsCore.JOB_STATUS.RUNNING }));
  const jobs = []
    .concat((listed && listed.items) || [])
    .concat((running && running.items) || []);
  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!opsCore.jobIsDue(job, asOf) && !opsCore.jobIsStaleRunning(job, asOf)) continue;
    const claim = await settle(store.tryClaimJob(job.runKey, asOf));
    if (!claim.claimed) {
      results.push({ ok: true, skipped: true, runKey: job.runKey, reason: claim.reason });
      continue;
    }
    try {
      const rec = await recrawlNow(
        Object.assign({}, opt, {
          id: job.reviewItemId,
          instruction: job.instruction,
          originMethod: opsCore.ORIGIN.SCHEDULED_RECOLLECT,
          asOf: asOf,
        }),
      );
      if (!rec.ok) {
        await settle(
          store.finishJob(job.runKey, {
            status: opsCore.JOB_STATUS.FAILED,
            finishedAt: new Date().toISOString(),
            errorCode: rec.error || 'RECOLLECT_FAILED',
            errorSummary: (rec.reasons || []).join(',') || rec.error,
          }),
        );
        results.push({ ok: false, runKey: job.runKey, error: rec.error });
        continue;
      }
      await settle(
        store.finishJob(job.runKey, {
          status: opsCore.JOB_STATUS.SUCCESS,
          finishedAt: new Date().toISOString(),
          resultVersionNumber: rec.version && rec.version.versionNumber,
        }),
      );
      results.push({
        ok: true,
        runKey: job.runKey,
        versionNumber: rec.version && rec.version.versionNumber,
        published: false,
      });
    } catch (e) {
      await settle(
        store.finishJob(job.runKey, {
          status: opsCore.JOB_STATUS.FAILED,
          finishedAt: new Date().toISOString(),
          errorCode: 'RECOLLECT_EXCEPTION',
          errorSummary: String(e && e.message ? e.message : e).slice(0, 500),
        }),
      );
      results.push({ ok: false, runKey: job.runKey, error: 'RECOLLECT_EXCEPTION' });
    }
  }
  return { ok: true, processed: results.length, results: results };
}

async function listPending(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const repo = resolveRepo(opt);
  const listed = await settle(repo.list({}));
  const items = ((listed && listed.items) || [])
    .map(function (it) {
      return opsCore.ensureOpsMeta(Object.assign({}, it), asOf);
    })
    .filter(function (it) {
      if (!opsCore.isPendingQueueStatus(it.status)) return false;
      if (opsCore.isDiscarded(it)) return false;
      if (opsCore.isApprovalExpired(it, asOf)) return false;
      return true;
    });
  return { ok: true, items: items, count: items.length };
}

function describeItem(item, asOf) {
  const it = opsCore.ensureOpsMeta(Object.assign({}, item || {}), asOf);
  const selected = opsCore.getVersion(it, it.selectedVersionNumber);
  const prevNum = Number(it.selectedVersionNumber) - 1;
  const prev = prevNum >= 1 ? opsCore.getVersion(it, prevNum) : null;
  return {
    id: it.id,
    issueDate: it.issueDate,
    createdAt: it.createdAt,
    queuedAt: it.queuedAt,
    status: it.status,
    approvalExpiresAt: it.approvalExpiresAt,
    purgeEligibleAt: it.purgeEligibleAt,
    approvalExpired: opsCore.isApprovalExpired(it, asOf),
    discarded: opsCore.isDiscarded(it),
    selectedVersionNumber: it.selectedVersionNumber,
    versions: (it.draftVersions || []).map(function (v) {
      return {
        versionNumber: v.versionNumber,
        createdAt: v.createdAt,
        revisedAt: v.revisedAt,
        originMethod: v.originMethod,
        operatorInstruction: v.operatorInstruction,
        selected: !!v.selected,
      };
    }),
    selectedVersion: selected || null,
    previousVersion: prev || null,
    diff: prev && selected ? opsCore.diffSnapshots(prev.snapshot, selected.snapshot) : [],
    contentUpdatedAt: it.contentUpdatedAt,
  };
}

module.exports = {
  resolveJobStore: resolveJobStore,
  loadItem: loadItem,
  manualEdit: manualEdit,
  aiRevise: aiRevise,
  recrawlNow: recrawlNow,
  scheduleRecollect: scheduleRecollect,
  cancelRecollect: cancelRecollect,
  selectDraftVersion: selectDraftVersion,
  discardItem: discardItem,
  approveAndPublish: approveAndPublish,
  createUpdateDraft: createUpdateDraft,
  expirePendingApprovals: expirePendingApprovals,
  processDueRecollectJobs: processDueRecollectJobs,
  listPending: listPending,
  describeItem: describeItem,
};
