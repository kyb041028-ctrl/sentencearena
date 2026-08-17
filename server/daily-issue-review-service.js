'use strict';

/**
 * 데일리 이슈 검수·게시 서비스 (정책 계층)
 * — 저장은 repository 인터페이스만 사용 (JSON/DB)
 * — 상태·품질·최신성 정책은 shared core
 */

const path = require('path');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const reviewCore = require('../shared/daily-issue-review-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const contract = require('../shared/daily-issue-review-repository-contract');
const seedCore = require('../shared/daily-issue-alignment-seed-core');
const { createDailyIssueReviewRepository } = require('./daily-issue-review-repository');
const jsonRepoMod = require('./daily-issue-review-json-repository');

const DEFAULT_REVIEW_ROOT = jsonRepoMod.DEFAULT_REVIEW_ROOT;

function resolveRepo(options) {
  const opt = options || {};
  const kind = opt.repositoryKind || opt.repository || process.env.DAILY_ISSUE_REPOSITORY || 'json';
  if (opt.repositoryInstance) return opt.repositoryInstance;
  if (String(kind).toLowerCase() === 'fake-db' || String(kind).toLowerCase() === 'fake') {
    const repo = createDailyIssueReviewRepository({ kind: 'fake-db' });
    repo.initialize();
    return repo;
  }
  if (String(kind).toLowerCase() === 'db') {
    const repo = createDailyIssueReviewRepository({
      kind: 'db',
      client: opt.client,
      databaseUrl: opt.databaseUrl,
      enabled: opt.enabled,
      schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
      executor: opt.executor,
      query: opt.query,
      withTransaction: opt.withTransaction,
    });
    // initialize may be async — callers using DB should await Promise.resolve(repo.initialize())
    const init = repo.initialize();
    if (init && typeof init.then === 'function') {
      repo.__initPromise = init;
    } else if (init && !init.ok) {
      return repo;
    }
    return repo;
  }
  const repo = createDailyIssueReviewRepository({
    kind: 'json',
    reviewRoot: opt.reviewRoot || DEFAULT_REVIEW_ROOT,
  });
  repo.initialize();
  return repo;
}

function candidatesFromFreshOutput(src) {
  if (!src || typeof src !== 'object') return [];
  if (Array.isArray(src)) return src;
  if (Array.isArray(src.readyCandidates) && src.readyCandidates.length) {
    return src.readyCandidates.filter(function (c) {
      return (
        c &&
        c.ok &&
        c.publicationStatus === 'READY' &&
        (c.normalizedSources || c.sourceRefs || c.sources)
      );
    });
  }
  if (src.bundle && src.bundle.categories) {
    const out = [];
    Object.keys(src.bundle.categories).forEach(function (cat) {
      (src.bundle.categories[cat].issues || []).forEach(function (issue) {
        out.push({
          candidateId: issue.id,
          clusterId: String(issue.id || '').replace(/^ingest_/, 'cl_'),
          title: issue.topic || issue.title,
          category: cat,
          discussionPrompt: issue.discussionPrompt,
          confirmedSummary: issue.confirmedSummary,
          claims: issue.claims || [],
          sourceRefs: issue.sourceRefs || [],
          evidences: issue.evidences || [],
          displayGroups: issue.displayGroups,
          ok: true,
          freshnessOk: true,
          publicationStatus: 'READY',
          qualityReadyBeforeFreshness: true,
          freshnessClass: issue.freshnessClass,
          qualityCheckedAt: issue.qualityCheckedAt,
          freshnessCheckedAt: issue.freshnessCheckedAt,
          noveltySignals: issue.noveltySignals || [],
          staleSignals: [],
          qualityFailureReasons: [],
          freshnessFailureReasons: [],
          sourceFactMeta: issue.sourceFactMeta,
        });
      });
    });
    if (out.length) return out;
  }
  if (Array.isArray(src.candidates)) {
    return src.candidates.filter(function (c) {
      return c && c.ok && c.publicationStatus === 'READY' && c.freshnessOk && (c.normalizedSources || c.sourceRefs);
    });
  }
  if (src.item) return [src.item];
  return [];
}

function existingItemsFromRepo(repo) {
  const listed = repo.list({});
  if (listed && typeof listed.then === 'function') {
    return listed.then(function (res) {
      if (!res.ok) return [];
      return res.items || [];
    });
  }
  if (!listed.ok) return [];
  return listed.items || [];
}

function enqueueCandidates(input, options) {
  const opt = options || {};
  const dryRun = !!opt.dryRun;
  const asOf = opt.asOf || new Date().toISOString();
  const repo = resolveRepo(opt);
  if (repo.kind === 'db' && typeof repo.healthCheck === 'function') {
    const hc = repo.healthCheck();
    if (hc && typeof hc.then === 'function') {
      // async DB path — return promise chain (CLI awaits Promise.resolve)
      return hc.then(function (h) {
        if (!h.ok) {
          return { ok: false, error: h.error || contract.ERROR_CODES.DATABASE_UNAVAILABLE, results: [], enqueuedCount: 0 };
        }
        return enqueueCandidatesAfterHealth(input, opt, repo);
      });
    }
    if (!hc.ok) {
      return { ok: false, error: hc.error || contract.ERROR_CODES.DATABASE_UNAVAILABLE, results: [], enqueuedCount: 0 };
    }
  }

  return enqueueCandidatesAfterHealth(input, opt, repo);
}

function enqueueCandidatesAfterHealth(input, opt, repo) {
  const dryRun = !!opt.dryRun;
  const asOf = opt.asOf || new Date().toISOString();
  const existingOrP = existingItemsFromRepo(repo);
  if (existingOrP && typeof existingOrP.then === 'function') {
    return existingOrP.then(function (existing) {
      return enqueueCandidatesWithExisting(input, opt, repo, dryRun, asOf, existing);
    });
  }
  return enqueueCandidatesWithExisting(input, opt, repo, dryRun, asOf, existingOrP);
}

function enqueueCandidatesWithExisting(input, opt, repo, dryRun, asOf, existing) {
  const list = candidatesFromFreshOutput(input);
  const results = [];
  const enqueued = [];

  list.forEach(function (cand) {
    const created = reviewCore.createReviewItem(cand, {
      asOf: asOf,
      existingItems: existing.concat(enqueued),
    });
    if (!created.ok) {
      results.push({
        ok: false,
        candidateId: reviewCore.buildCandidateId(cand),
        reasons: created.reasons,
        duplicate: created.duplicate || null,
      });
      return;
    }
    const item = contract.normalizeReviewItem(created.item);
    enqueued.push(item);
    results.push({ ok: true, candidateId: item.candidateId, status: item.status, item: item });
  });

  if (!dryRun && enqueued.length) {
    const audits = enqueued.map(function (item) {
      return {
        entityId: item.id,
        fromStatus: null,
        toStatus: item.status,
        action: 'enqueue',
        actorId: opt.reviewer || 'system',
        reasonCode: item.duplicateMeta && item.duplicateMeta.decision,
        timestamp: asOf,
        snapshotHash: jsonRepoMod.snapshotHash(item),
      };
    });
    const inserted = repo.insertReviewItems(enqueued, audits, { dryRun: false });
    if (inserted && typeof inserted.then === 'function') {
      return inserted.then(function (ins) {
        if (!ins.ok) {
          return {
            ok: false,
            error: ins.error || 'PERSIST_FAILED',
            message: ins.message,
            rolledBack: ins.rolledBack,
            results: results,
            enqueuedCount: 0,
          };
        }
        return {
          ok: true,
          dryRun: dryRun,
          enqueuedCount: enqueued.length,
          skippedCount: results.filter(function (r) {
            return !r.ok;
          }).length,
          results: results,
          items: enqueued,
        };
      });
    }
    if (!inserted.ok) {
      return {
        ok: false,
        error: inserted.error || 'PERSIST_FAILED',
        message: inserted.message,
        rolledBack: inserted.rolledBack,
        results: results,
        enqueuedCount: 0,
      };
    }
  }

  return {
    ok: true,
    dryRun: dryRun,
    enqueuedCount: enqueued.length,
    skippedCount: results.filter(function (r) {
      return !r.ok;
    }).length,
    results: results,
    items: enqueued,
  };
}

function isThenable(v) {
  return !!(v && typeof v.then === 'function');
}

function transitionItem(id, toStatus, options) {
  const opt = options || {};
  const dryRun = !!opt.dryRun;
  const asOf = opt.asOf || new Date().toISOString();
  const repo = resolveRepo(opt);

  const foundOrP = repo.getById(id);
  if (isThenable(foundOrP)) {
    return foundOrP.then(function (found) {
      return transitionItemWithFound(found, id, toStatus, opt, repo, dryRun, asOf);
    });
  }
  return transitionItemWithFound(foundOrP, id, toStatus, opt, repo, dryRun, asOf);
}

function transitionItemWithFound(found, id, toStatus, opt, repo, dryRun, asOf) {
  if (!found.ok) return { ok: false, error: found.error || 'NOT_FOUND' };

  const item = found.item;
  const fromStatus = item.status;
  if (opt.expectedStatus != null && String(opt.expectedStatus) !== String(fromStatus)) {
    return {
      ok: false,
      error: contract.ERROR_CODES.STATUS_CHANGED || 'STATUS_CHANGED',
      fromStatus: fromStatus,
      expectedStatus: opt.expectedStatus,
    };
  }
  const tr = lifecycle.assertTransition(fromStatus, toStatus);
  if (!tr.ok) {
    return {
      ok: false,
      error: contract.ERROR_CODES.INVALID_STATE_TRANSITION || 'INVALID_STATE_TRANSITION',
      message: tr.message,
      fromStatus: fromStatus,
      toStatus: toStatus,
    };
  }

  if (toStatus === lifecycle.REVIEW_STATUS.HELD) {
    const code = String(opt.reason || opt.holdReason || '');
    if (!code || !lifecycle.HOLD_REASONS[code]) {
      return { ok: false, error: 'HOLD_REASON_REQUIRED' };
    }
  }
  if (toStatus === lifecycle.REVIEW_STATUS.REJECTED) {
    const code = String(opt.reason || opt.rejectReason || '');
    if (!code || !lifecycle.REJECT_REASONS[code]) {
      return { ok: false, error: 'REJECT_REASON_REQUIRED' };
    }
  }
  if (toStatus === lifecycle.REVIEW_STATUS.RETIRED || toStatus === lifecycle.REVIEW_STATUS.SUPERSEDED) {
    const code = String(opt.reason || opt.retireReason || '');
    if (!code || !lifecycle.RETIRE_REASONS[code]) {
      return { ok: false, error: 'RETIRE_REASON_REQUIRED' };
    }
  }

  if (toStatus === lifecycle.REVIEW_STATUS.APPROVED) {
    if (opt.autoMorning === true && String(opt.actorId || opt.reviewer) === decisionCore.ACTOR_AUTO_MORNING) {
      const d = decisionCore.classifyPublicationDecision(item, { asOf: asOf });
      if (d.publicationDecision !== decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE) {
        return {
          ok: false,
          error: 'APPROVE_BLOCKED',
          reasons: d.autoPublishBlockedReasons || ['NOT_AUTO_ELIGIBLE'],
        };
      }
      if (!decisionCore.qualityPassed(item) || !decisionCore.freshnessPassed(item)) {
        return { ok: false, error: 'APPROVE_BLOCKED', reasons: ['STORED_GATES_NOT_PASSED'] };
      }
      if (reviewCore.isExpired(item, asOf)) {
        return { ok: false, error: 'APPROVE_BLOCKED', reasons: ['EXPIRED'] };
      }
      if (item.status === lifecycle.REVIEW_STATUS.HELD || item.status === lifecycle.REVIEW_STATUS.REJECTED) {
        return { ok: false, error: 'APPROVE_BLOCKED', reasons: ['STATUS_' + item.status] };
      }
    } else {
      const check = reviewCore.canApprove(item, { asOf: asOf });
      if (!check.ok) return { ok: false, error: 'APPROVE_BLOCKED', reasons: check.reasons };
    }
  }

  function continueWithPublishMeta(publishMeta) {
    if (toStatus === lifecycle.REVIEW_STATUS.EXPIRED) {
      if (!reviewCore.isExpired(item, asOf) && !opt.forceExpire) {
        return { ok: false, error: 'NOT_YET_EXPIRED' };
      }
    }

    const next = Object.assign({}, item, { status: toStatus });
    if (opt.itemPatch && typeof opt.itemPatch === 'object') {
      Object.keys(opt.itemPatch).forEach(function (k) {
        if (k === 'lifecycleMeta') {
          next.lifecycleMeta = Object.assign({}, item.lifecycleMeta || {}, opt.itemPatch.lifecycleMeta || {});
        } else if (k !== 'status' && k !== 'id' && k !== 'lockVersion') {
          next[k] = opt.itemPatch[k];
        }
      });
    }
    next.reviewedAt = asOf;
    if (toStatus === lifecycle.REVIEW_STATUS.HELD) {
      next.holdReason = String(opt.reason || opt.holdReason);
      next.reviewReason = String(opt.reasonText || '').slice(0, 500);
    }
    if (toStatus === lifecycle.REVIEW_STATUS.REJECTED) {
      next.rejectReason = String(opt.reason || opt.rejectReason);
      next.reviewReason = String(opt.reasonText || '').slice(0, 500);
    }
    if (toStatus === lifecycle.REVIEW_STATUS.APPROVED) {
      next.approvedAt = asOf;
      next.reviewerId = opt.reviewer || opt.actorId || null;
      next.reviewReason = String(opt.reasonText || '').slice(0, 500);
    }
    if (toStatus === lifecycle.REVIEW_STATUS.PUBLISHED) {
      next.publishedAt = asOf;
      next.publishExpiresAt = publishMeta.publishExpiresAt;
      next.displayPriority = Number(opt.displayPriority) || 0;
      next.reviewerId = next.reviewerId || opt.reviewer || null;
    }
    if (toStatus === lifecycle.REVIEW_STATUS.RETIRED || toStatus === lifecycle.REVIEW_STATUS.SUPERSEDED) {
      next.retiredAt = asOf;
      next.retireReason = String(opt.reason || opt.retireReason);
    }
    if (toStatus === lifecycle.REVIEW_STATUS.EXPIRED) {
      next.reviewReason = String(opt.reasonText || 'FRESHNESS_WINDOW_ENDED').slice(0, 500);
    }
    if (opt.followUpOf) next.followUpOf = opt.followUpOf;
    if (opt.updateExisting) next.priorIssueId = opt.updateExisting;

    if (dryRun) {
      return { ok: true, dryRun: true, fromStatus: fromStatus, toStatus: toStatus, item: next };
    }

    const result = repo.transitionReviewItem({
      id: item.id,
      expectedStatus: opt.expectedStatus != null ? opt.expectedStatus : fromStatus,
      expectedLockVersion: opt.expectedLockVersion != null ? opt.expectedLockVersion : item.lockVersion,
      nextItem: next,
      targetBucket: lifecycle.storageBucketForStatus(toStatus),
      auditEvents: [
        {
          entityId: next.id,
          fromStatus: fromStatus,
          toStatus: toStatus,
          action: String(opt.action || toStatus.toLowerCase()),
          actorId: opt.reviewer || opt.actorId || 'cli',
          reasonCode:
            opt.reasonCode ||
            next.holdReason ||
            next.rejectReason ||
            next.retireReason ||
            null,
          reasonText: opt.reasonText || '',
          timestamp: asOf,
          snapshotHash: jsonRepoMod.snapshotHash(next),
          payload: opt.auditPayload || null,
        },
      ],
    });

    if (isThenable(result)) {
      return result.then(function (r) {
        if (!r.ok) {
          return {
            ok: false,
            error: r.error || 'PERSIST_FAILED',
            message: r.message,
            rolledBack: r.rolledBack,
            rollbackError: r.rollbackError,
          };
        }
        return { ok: true, fromStatus: fromStatus, toStatus: toStatus, item: r.item };
      });
    }

    if (!result.ok) {
      return {
        ok: false,
        error: result.error || 'PERSIST_FAILED',
        message: result.message,
        rolledBack: result.rolledBack,
        rollbackError: result.rollbackError,
      };
    }

    return { ok: true, fromStatus: fromStatus, toStatus: toStatus, item: result.item };
  }

  if (toStatus === lifecycle.REVIEW_STATUS.PUBLISHED) {
    const autoMorningPublish =
      opt.autoMorning === true && String(opt.actorId || opt.reviewer) === decisionCore.ACTOR_AUTO_MORNING;

    function runPublishGate(publishedList) {
      const publishedIssues = (publishedList.items || []).filter(function (p) {
        return p.status === 'PUBLISHED';
      });
      if (autoMorningPublish) {
        const reasons = [];
        const tr = lifecycle.assertTransition(item && item.status, lifecycle.REVIEW_STATUS.PUBLISHED);
        if (!tr.ok) reasons.push(tr.error);
        if ((item && item.status) !== lifecycle.REVIEW_STATUS.APPROVED) reasons.push('NOT_APPROVED');
        if (reviewCore.isExpired(item, asOf)) reasons.push('EXPIRED');
        if (item && item.duplicateMeta && item.duplicateMeta.decision === 'EXACT_DUPLICATE') {
          reasons.push('EXACT_DUPLICATE');
        }
        if (!decisionCore.qualityPassed(item) || !decisionCore.freshnessPassed(item)) {
          reasons.push('STORED_GATES_NOT_PASSED');
        }
        const d = decisionCore.classifyPublicationDecision(item, { asOf: asOf });
        if (d.publicationDecision !== decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE) {
          reasons.push('NOT_AUTO_ELIGIBLE');
        }
        const policy = { maxTotalPublished: 8, maxPublishedPerCategory: 3 };
        if (publishedIssues.length >= policy.maxTotalPublished) {
          reasons.push('MAX_TOTAL_PUBLISHED');
        }
        const cat = String((item && item.category) || 'world').trim() || 'world';
        const catCount = publishedIssues.filter(function (p) {
          return String(p.category || '') === cat;
        }).length;
        if (catCount >= policy.maxPublishedPerCategory) {
          reasons.push('MAX_CATEGORY_PUBLISHED');
        }
        const sig = item && item.contentSignature;
        if (sig && publishedIssues.some(function (p) {
          return p && p.contentSignature === sig;
        })) {
          reasons.push('ALREADY_PUBLISHED_SAME_SIGNATURE');
        }
        if (reasons.length) return { ok: false, error: 'PUBLISH_BLOCKED', reasons: reasons };
        return continueWithPublishMeta({
          ok: true,
          publishExpiresAt: item.publishExpiresAt || item.expiresAt || null,
          autoMorning: true,
        });
      }
      const check = reviewCore.canPublish(item, { asOf: asOf, publishedIssues: publishedIssues });
      if (!check.ok) return { ok: false, error: 'PUBLISH_BLOCKED', reasons: check.reasons };
      return continueWithPublishMeta(check);
    }

    const publishedOrP = repo.getPublishedIssues({});
    if (isThenable(publishedOrP)) {
      return publishedOrP.then(runPublishGate);
    }
    return runPublishGate(publishedOrP);
  }

  return continueWithPublishMeta(null);
}

function expireDueItems(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const repo = resolveRepo(opt);
  const listed = repo.list({});
  const due = (listed.items || []).filter(function (it) {
    return (
      it &&
      (it.status === 'READY_FOR_REVIEW' ||
        it.status === 'HELD' ||
        it.status === 'APPROVED' ||
        it.status === 'UPDATE_PENDING') &&
      reviewCore.isExpired(it, asOf)
    );
  });
  const results = [];
  due.forEach(function (it) {
    results.push(
      transitionItem(it.id, lifecycle.REVIEW_STATUS.EXPIRED, {
        reviewRoot: opt.reviewRoot,
        repositoryKind: opt.repositoryKind || opt.repository,
        repositoryInstance: repo,
        dryRun: opt.dryRun,
        asOf: asOf,
        forceExpire: true,
        action: 'expire',
        reviewer: opt.reviewer || 'system',
      }),
    );
  });
  return { ok: true, expiredCount: results.filter(function (r) { return r.ok; }).length, results: results };
}

function retireDuePublished(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const asOfMs = Date.parse(asOf);
  const repo = resolveRepo(opt);
  const published = repo.getPublishedIssues({});
  const due = (published.items || []).filter(function (it) {
    if (!it || it.status !== 'PUBLISHED') return false;
    const exp = Date.parse(it.publishExpiresAt || '');
    return isFinite(exp) && asOfMs > exp;
  });
  const results = [];
  due.forEach(function (it) {
    results.push(
      transitionItem(it.id, lifecycle.REVIEW_STATUS.RETIRED, {
        reviewRoot: opt.reviewRoot,
        repositoryKind: opt.repositoryKind || opt.repository,
        repositoryInstance: repo,
        dryRun: opt.dryRun,
        asOf: asOf,
        reason: lifecycle.RETIRE_REASONS.DISPLAY_WINDOW_ENDED,
        action: 'retire',
        reviewer: opt.reviewer || 'system',
      }),
    );
  });
  return { ok: true, retiredCount: results.filter(function (r) { return r.ok; }).length, results: results };
}

function mapListItemSlim(it) {
  return {
    id: it.id,
    candidateId: it.candidateId,
    status: it.status,
    title: it.title,
    category: it.category,
    version: it.version,
    sourceCount: (it.sourceRefs || []).length,
    independentSourceCount:
      (it.qualityMeta && it.qualityMeta.independentSourceCount) ||
      (it.qualityMeta && it.qualityMeta.sourceFactMeta && it.qualityMeta.sourceFactMeta.independentSourceCount) ||
      0,
    freshnessClass: it.freshnessMeta && it.freshnessMeta.freshnessClass,
    queuedAt: it.queuedAt,
    expiresAt: it.expiresAt,
    publishExpiresAt: it.publishExpiresAt,
    duplicateDecision: it.duplicateMeta && it.duplicateMeta.decision,
    priorIssueId: it.priorIssueId,
    holdReason: it.holdReason,
    rejectReason: it.rejectReason,
    lockVersion: it.lockVersion,
    publicationDecision: it.publicationDecision || (it.lifecycleMeta && it.lifecycleMeta.publicationDecision) || null,
    requiresManualReview:
      it.requiresManualReview != null
        ? !!it.requiresManualReview
        : !!(it.lifecycleMeta && it.lifecycleMeta.requiresManualReview),
  };
}

function listItemsAfterList(listed, opt) {
  if (!listed || listed.ok === false) {
    return { ok: false, error: (listed && listed.error) || 'DATABASE_UNAVAILABLE', count: 0, items: [] };
  }
  let items = listed.items || [];
  if (opt.expired) {
    const asOf = opt.asOf || new Date().toISOString();
    items = items.filter(function (it) {
      return it.status === 'EXPIRED' || reviewCore.isExpired(it, asOf);
    });
  }
  return {
    ok: true,
    count: items.length,
    items: items.map(mapListItemSlim),
  };
}

function listItems(options) {
  const opt = options || {};
  const repo = resolveRepo(opt);
  const listedOrP = repo.list({ status: opt.status });
  if (isThenable(listedOrP)) {
    return listedOrP.then(function (listed) {
      return listItemsAfterList(listed, opt);
    });
  }
  return listItemsAfterList(listedOrP, opt);
}

function showItem(id, options) {
  const repo = resolveRepo(options);
  const foundOrP = repo.getById(id);
  if (isThenable(foundOrP)) {
    return foundOrP.then(function (found) {
      if (!found.ok) return { ok: false, error: found.error || 'NOT_FOUND' };
      return { ok: true, item: found.item, bucket: found.bucket };
    });
  }
  if (!foundOrP.ok) return { ok: false, error: foundOrP.error || 'NOT_FOUND' };
  return { ok: true, item: foundOrP.item, bucket: foundOrP.bucket };
}

function setAlignmentDirection(id, direction, options) {
  const parsed = seedCore.parseDirectionStrict(direction);
  if (!parsed.ok) return { ok: false, error: 'ALIGNMENT_DIRECTION_INVALID' };
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const repo = resolveRepo(opt);
  const foundOrP = repo.getById(id);

  function apply(found) {
    if (!found || !found.ok) return { ok: false, error: (found && found.error) || 'NOT_FOUND' };
    const item = found.item;
    if (opt.expectedLockVersion != null && Number(item.lockVersion) !== Number(opt.expectedLockVersion)) {
      return {
        ok: false,
        error: contract.ERROR_CODES.STALE_VERSION,
        expectedLockVersion: opt.expectedLockVersion,
        actualLockVersion: item.lockVersion,
      };
    }
    const bucket = lifecycle.storageBucketForStatus(item.status);
    if (!bucket) return { ok: false, error: contract.ERROR_CODES.INVALID_STATE_TRANSITION };
    const next = Object.assign({}, item, { alignmentDirection: parsed.value });
    return Promise.resolve(
      repo.transitionReviewItem({
        id: item.id,
        expectedStatus: item.status,
        expectedLockVersion: item.lockVersion,
        nextItem: next,
        targetBucket: bucket,
        auditEvents: [
          {
            entityId: item.id,
            entityType: 'review_item',
            fromStatus: item.status,
            toStatus: item.status,
            action: 'alignment',
            actorId: opt.actorId || opt.reviewer || 'admin',
            timestamp: asOf,
            reasonCode: parsed.value,
          },
        ],
      })
    );
  }

  if (isThenable(foundOrP)) {
    return foundOrP.then(apply);
  }
  return apply(foundOrP);
}

function buildBundle(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const repo = resolveRepo(opt);
  if (opt.autoRetire !== false) {
    retireDuePublished({
      reviewRoot: opt.reviewRoot,
      repositoryInstance: repo,
      dryRun: opt.dryRun,
      asOf: asOf,
    });
  }
  const published = repo.getPublishedIssues({});
  const bundle = reviewCore.buildPublishedCentristBundleFromReviewState({
    publishedIssues: published.items || [],
    generatedAt: asOf,
    bundleVersion: opt.bundleVersion || 'review-v1',
  });
  if (opt.output && !opt.dryRun) {
    jsonRepoMod.atomicWriteJson(path.resolve(opt.output), bundle);
  }
  return { ok: true, bundle: bundle, dryRun: !!opt.dryRun };
}

function readHistory(options) {
  const opt = options || {};
  const repo = resolveRepo(opt);
  const filter = {};
  if (opt.entityId) filter.entityId = opt.entityId;
  if (opt.limit != null) filter.limit = opt.limit;
  const resOrP = repo.listAuditEvents(filter);
  if (isThenable(resOrP)) {
    return resOrP.then(function (res) {
      return { ok: true, events: res.events || [] };
    });
  }
  return { ok: true, events: (resOrP && resOrP.events) || [] };
}

function revalidateItem(id, options) {
  const opt = options || {};
  const foundOrP = showItem(id, opt);
  if (isThenable(foundOrP)) {
    return foundOrP.then(function (found) {
      if (!found.ok) return found;
      const re = reviewCore.revalidateGates(found.item, { asOf: opt.asOf || new Date().toISOString() });
      return { ok: true, itemId: found.item.id, revalidation: re };
    });
  }
  if (!foundOrP.ok) return foundOrP;
  const re = reviewCore.revalidateGates(foundOrP.item, { asOf: opt.asOf || new Date().toISOString() });
  return { ok: true, itemId: foundOrP.item.id, revalidation: re };
}

function applyUpdateExisting(candidateId, options) {
  const opt = options || {};
  const repo = resolveRepo(opt);
  const found = repo.getById(candidateId);
  if (!found.ok) return { ok: false, error: 'NOT_FOUND' };
  const target = repo.getById(opt.updateExisting);
  if (!target.ok || target.item.status !== 'PUBLISHED') return { ok: false, error: 'TARGET_NOT_PUBLISHED' };

  const merged = reviewCore.applyUpdateToExisting(target.item, found.item, {
    asOf: opt.asOf || new Date().toISOString(),
    reasonText: opt.reasonText,
  });
  if (!merged.ok) return merged;
  if (opt.dryRun) return { ok: true, dryRun: true, issue: merged.issue };

  const closed = Object.assign({}, found.item, {
    status: lifecycle.REVIEW_STATUS.REJECTED,
    rejectReason: 'DUPLICATE_EVENT',
    reviewedAt: opt.asOf || new Date().toISOString(),
    reviewReason: 'merged_into_' + target.item.id,
  });

  const result = repo.applyExistingIssueUpdate({
    targetId: target.item.id,
    mergedIssue: merged.issue,
    closedItem: closed,
    closedFromBucket: found.bucket,
    updateRow: {
      issueId: target.item.id,
      candidateId: found.item.candidateId,
      updateType: found.item.updateType || 'FOLLOW_UP',
      createdAt: opt.asOf || new Date().toISOString(),
    },
    auditEvents: [
      {
        entityId: merged.issue.id,
        fromStatus: 'PUBLISHED',
        toStatus: 'PUBLISHED',
        action: 'update_existing',
        actorId: opt.reviewer || 'cli',
        reasonCode: found.item.updateType || 'FOLLOW_UP',
        reasonText: opt.reasonText || '',
        timestamp: opt.asOf || new Date().toISOString(),
        snapshotHash: jsonRepoMod.snapshotHash(merged.issue),
      },
    ],
  });
  if (!result.ok) return result;
  return { ok: true, issue: result.issue };
}

function applyFollowUpPublish(candidateId, options) {
  const opt = options || {};
  return transitionItem(candidateId, lifecycle.REVIEW_STATUS.PUBLISHED, Object.assign({}, opt, {
    followUpOf: opt.publishAsFollowUp || opt.followUpOf,
    action: 'publish_follow_up',
  }));
}

/**
 * 05:00 KST 아침판 — AUTO_PUBLISH_ELIGIBLE 만 APPROVED→PUBLISHED.
 * HOLD/REJECT/수동 후보·중복 게시는 차단. actor = AUTO_MORNING_EDITORIAL
 */
function runMorningAutoPublish(options) {
  const opt = options || {};
  const asOf = opt.asOf || new Date().toISOString();
  const actor = decisionCore.ACTOR_AUTO_MORNING;
  const dryRun = !!opt.dryRun;
  const repo = resolveRepo(opt);

  if (!opt.force && !opt.ignoreMorningWindow && !decisionCore.isMorningWindowKst(asOf, opt)) {
    return Promise.resolve({
      ok: true,
      skipped: true,
      reason: 'NOT_MORNING_WINDOW',
      asOf: asOf,
      publishedIds: [],
      blocked: [],
    });
  }

  function proceed(listed, publishedListed) {
    const queue = (listed && listed.items) || [];
    const published = (publishedListed && publishedListed.items) || [];
    const publishedSigs = {};
    published.forEach(function (p) {
      if (p && p.contentSignature) publishedSigs[String(p.contentSignature)] = p.id;
      if (p && p.candidateId) publishedSigs['cand:' + String(p.candidateId)] = p.id;
    });

    const candidates = queue.filter(function (it) {
      return it && it.status === lifecycle.REVIEW_STATUS.READY_FOR_REVIEW;
    });

    const results = [];
    const blocked = [];

    function handleOne(index) {
      if (index >= candidates.length) {
        return {
          ok: true,
          dryRun: dryRun,
          asOf: asOf,
          actorId: actor,
          publishedIds: results.filter(function (r) {
            return r.ok && r.published;
          }).map(function (r) {
            return r.id;
          }),
          results: results,
          blocked: blocked,
        };
      }

      const item = candidates[index];
      const attached = decisionCore.attachDecisionToItem(Object.assign({}, item), { asOf: asOf });
      const decided = attached.item;

      if (decided.status === 'HELD' || decided.status === 'REJECTED') {
        blocked.push({ id: decided.id, reasons: ['STATUS_' + decided.status] });
        return handleOne(index + 1);
      }
      if (decided.publicationDecision !== decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE) {
        blocked.push({
          id: decided.id,
          reasons: decided.autoPublishBlockedReasons || decided.publicationDecisionReasons || [],
        });
        return handleOne(index + 1);
      }
      if (decided.contentSignature && publishedSigs[String(decided.contentSignature)]) {
        blocked.push({ id: decided.id, reasons: ['ALREADY_PUBLISHED_SAME_SIGNATURE'] });
        return handleOne(index + 1);
      }
      if (publishedSigs['cand:' + String(decided.candidateId || decided.id)]) {
        blocked.push({ id: decided.id, reasons: ['ALREADY_PUBLISHED_SAME_CANDIDATE'] });
        return handleOne(index + 1);
      }

      const auditPayload = {
        publicationDecision: decided.publicationDecision,
        publicationDecisionReasons: decided.publicationDecisionReasons,
        autoPublishBlockedReasons: decided.autoPublishBlockedReasons,
        decisionVersion: (decided.lifecycleMeta && decided.lifecycleMeta.decisionVersion) || 'pub-decision-v1',
      };
      const reasonText = 'AUTO_MORNING:' + (decided.publicationDecisionReasons || []).join(',');

      if (dryRun) {
        results.push({ ok: true, dryRun: true, published: true, id: decided.id, decision: decided.publicationDecision });
        return handleOne(index + 1);
      }

      const itemPatch = {
        publicationDecision: decided.publicationDecision,
        publicationDecisionReasons: decided.publicationDecisionReasons,
        requiresManualReview: decided.requiresManualReview,
        autoPublishEligibleAt: decided.autoPublishEligibleAt,
        autoPublishBlockedReasons: decided.autoPublishBlockedReasons,
        lifecycleMeta: Object.assign({}, decided.lifecycleMeta || {}, {
          autoMorningPublished: true,
          publishedBy: actor,
        }),
      };

      return Promise.resolve(
        transitionItem(item.id, lifecycle.REVIEW_STATUS.APPROVED, {
          repositoryInstance: repo,
          asOf: asOf,
          actorId: actor,
          reviewer: actor,
          expectedStatus: lifecycle.REVIEW_STATUS.READY_FOR_REVIEW,
          expectedLockVersion: item.lockVersion,
          action: 'auto_approve',
          reasonCode: decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE,
          reasonText: reasonText,
          auditPayload: auditPayload,
          itemPatch: itemPatch,
          autoMorning: true,
        }),
      ).then(function (apr) {
        if (!apr.ok) {
          results.push({ ok: false, id: item.id, stage: 'approve', error: apr.error, reasons: apr.reasons });
          return handleOne(index + 1);
        }
        const approved = apr.item;
        return Promise.resolve(
          transitionItem(approved.id, lifecycle.REVIEW_STATUS.PUBLISHED, {
            repositoryInstance: repo,
            asOf: asOf,
            actorId: actor,
            reviewer: actor,
            expectedStatus: lifecycle.REVIEW_STATUS.APPROVED,
            expectedLockVersion: approved.lockVersion,
            action: 'auto_publish',
            reasonCode: decisionCore.DECISION.AUTO_PUBLISH_ELIGIBLE,
            reasonText: reasonText,
            auditPayload: auditPayload,
            itemPatch: itemPatch,
            autoMorning: true,
          }),
        ).then(function (pub) {
          if (!pub.ok) {
            results.push({ ok: false, id: item.id, stage: 'publish', error: pub.error, reasons: pub.reasons });
          } else {
            if (pub.item && pub.item.contentSignature) {
              publishedSigs[String(pub.item.contentSignature)] = pub.item.id;
            }
            results.push({
              ok: true,
              published: true,
              id: item.id,
              decision: decided.publicationDecision,
              item: pub.item,
            });
          }
          return handleOne(index + 1);
        });
      });
    }

    return handleOne(0);
  }

  const listedOrP = repo.list({ status: lifecycle.REVIEW_STATUS.READY_FOR_REVIEW });

  function withList(listed) {
    if (!listed || listed.ok === false) {
      return {
        ok: false,
        error: (listed && listed.error) || 'DATABASE_UNAVAILABLE',
        publishedIds: [],
        blocked: [],
      };
    }
    return withListedOk(listed);
  }

  function withListedOk(listed) {
    const pubOrP = repo.getPublishedIssues({});
    if (isThenable(pubOrP)) {
      return pubOrP.then(function (pub) {
        return proceed(listed, pub);
      });
    }
    return proceed(listed, pubOrP);
  }

  if (isThenable(listedOrP)) {
    return listedOrP.then(withList);
  }
  return Promise.resolve(withList(listedOrP));
}

module.exports = {
  DEFAULT_REVIEW_ROOT: DEFAULT_REVIEW_ROOT,
  resolveRepo: resolveRepo,
  enqueueCandidates: enqueueCandidates,
  transitionItem: transitionItem,
  runMorningAutoPublish: runMorningAutoPublish,
  expireDueItems: expireDueItems,
  retireDuePublished: retireDuePublished,
  listItems: listItems,
  showItem: showItem,
  setAlignmentDirection: setAlignmentDirection,
  buildBundle: buildBundle,
  readHistory: readHistory,
  revalidateItem: revalidateItem,
  applyUpdateExisting: applyUpdateExisting,
  applyFollowUpPublish: applyFollowUpPublish,
  // backward-compatible JSON helpers (tests / atomicity)
  resolveReviewRoot: jsonRepoMod.resolveReviewRoot,
  safeJoin: jsonRepoMod.safeJoin,
  atomicWriteJson: jsonRepoMod.atomicWriteJson,
  loadStore: jsonRepoMod.loadStore,
  commitStoreWithHistory: jsonRepoMod.commitStoreWithHistory,
  captureStateSnapshots: jsonRepoMod.captureStateSnapshots,
  restoreStateSnapshots: jsonRepoMod.restoreStateSnapshots,
  setTestHooks: jsonRepoMod.setTestHooks,
  clearTestHooks: jsonRepoMod.clearTestHooks,
  buildManifest: jsonRepoMod.buildManifest,
  snapshotHash: jsonRepoMod.snapshotHash,
};
