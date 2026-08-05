'use strict';

/**
 * 데일리 이슈 검수 — DB repository
 * - 실제 운영 DB 연결 없음 (client 미주입 시 DATABASE_UNAVAILABLE)
 * - fake 모드: 동일 계약을 in-memory transaction으로 검증
 * SQL은 migration 파일에 정의. repository는 계약을 구현한다.
 */

const crypto = require('crypto');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const contract = require('../shared/daily-issue-review-repository-contract');

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function snapshotHash(item) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        id: item && item.id,
        status: item && item.status,
        contentSignature: item && item.contentSignature,
        version: item && item.version,
        lockVersion: item && item.lockVersion,
      }),
    )
    .digest('hex')
    .slice(0, 24);
}

function createFakeDbState() {
  return {
    items: new Map(), // id -> item
    audits: [],
    updates: [],
    meta: { schema_version: '1', repository_contract_version: '1' },
  };
}

/**
 * In-memory transactional fake used for contract tests (not a real Postgres).
 */
function createFakeDbDailyIssueReviewRepository(options) {
  const opt = options || {};
  let state = createFakeDbState();
  let initialized = false;
  let failAudit = false;
  let failWrite = false;

  function setTestHooks(hooks) {
    const h = hooks || {};
    failAudit = !!h.failAppend || !!h.failAudit;
    failWrite = !!h.failPersist || !!h.failWrite;
  }

  function clearTestHooks() {
    failAudit = false;
    failWrite = false;
  }

  function allItems() {
    return Array.from(state.items.values()).map(contract.normalizeReviewItem);
  }

  function getRaw(id) {
    const key = String(id || '');
    if (state.items.has(key)) return state.items.get(key);
    for (const it of state.items.values()) {
      if (it.candidateId === key) return it;
    }
    return null;
  }

  function withTxn(mutator) {
    const snap = {
      items: new Map(Array.from(state.items.entries()).map(function (e) {
        return [e[0], clone(e[1])];
      })),
      audits: state.audits.slice(),
      updates: state.updates.slice(),
      meta: clone(state.meta),
    };
    try {
      if (failWrite) {
        throw Object.assign(new Error(contract.ERROR_CODES.PERSIST_FAILED), {
          code: contract.ERROR_CODES.PERSIST_FAILED,
        });
      }
      const result = mutator(state);
      if (failAudit) {
        throw Object.assign(new Error(contract.ERROR_CODES.AUDIT_WRITE_FAILED), {
          code: contract.ERROR_CODES.AUDIT_WRITE_FAILED,
        });
      }
      return result;
    } catch (e) {
      state = snap;
      return {
        ok: false,
        error: e.code || contract.ERROR_CODES.TRANSACTION_FAILED,
        message: String(e.message || e),
        rolledBack: true,
      };
    }
  }

  function appendAudits(txState, events) {
    (events || []).forEach(function (payload) {
      txState.audits.push({
        id: 'aud_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        entityId: payload.entityId,
        entityType: payload.entityType || 'review_item',
        fromStatus: payload.fromStatus,
        toStatus: payload.toStatus,
        action: payload.action,
        actorId: payload.actorId || null,
        reasonCode: payload.reasonCode || null,
        reasonText: payload.reasonText || '',
        snapshotHash: payload.snapshotHash || null,
        transactionId: payload.transactionId || null,
        createdAt: payload.timestamp || new Date().toISOString(),
        payload: payload.payload || null,
      });
    });
  }

  const repo = {
    kind: contract.REPOSITORY_KINDS.FAKE_DB,
    setTestHooks: setTestHooks,
    clearTestHooks: clearTestHooks,
    snapshotHash: snapshotHash,

    initialize: function () {
      initialized = true;
      return { ok: true, kind: this.kind };
    },

    healthCheck: function () {
      return { ok: true, kind: this.kind, initialized: initialized };
    },

    getById: function (id) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const item = getRaw(id);
      if (!item) return contract.repoError(contract.ERROR_CODES.ITEM_NOT_FOUND);
      return { ok: true, item: contract.normalizeReviewItem(clone(item)) };
    },

    getByCandidateId: function (candidateId) {
      return this.getById(candidateId);
    },

    findByStatus: function (statuses) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const want = Array.isArray(statuses) ? statuses : [statuses];
      return {
        ok: true,
        items: allItems().filter(function (it) {
          return want.indexOf(it.status) >= 0;
        }),
      };
    },

    list: function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const f = filters || {};
      let items = allItems();
      if (f.status) {
        items = items.filter(function (it) {
          return it.status === f.status;
        });
      }
      return { ok: true, items: items, count: items.length };
    },

    findDuplicateMatches: function (signatures) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const sig = signatures || {};
      const items = allItems().filter(function (it) {
        if (sig.candidateId && (it.candidateId === sig.candidateId || it.id === sig.candidateId)) return true;
        if (sig.contentSignature && it.contentSignature === sig.contentSignature) return true;
        if (sig.clusterSignature && it.clusterSignature === sig.clusterSignature) return true;
        if (sig.sourceSetSignature && it.sourceSetSignature === sig.sourceSetSignature) return true;
        if (sig.claimSetSignature && it.claimSetSignature === sig.claimSetSignature) return true;
        if (
          sig.eventIdentitySignature &&
          ((it.eventIdentity && it.eventIdentity.signature) || it.eventIdentitySignature) ===
            sig.eventIdentitySignature
        ) {
          return true;
        }
        return false;
      });
      return { ok: true, items: items };
    },

    insertReviewItems: function (items, auditEvents, opts) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      if (opts && opts.dryRun) {
        return { ok: true, dryRun: true, items: (items || []).map(contract.normalizeReviewItem) };
      }
      return withTxn(function (tx) {
        const normalized = [];
        for (let i = 0; i < (items || []).length; i++) {
          const item = contract.normalizeReviewItem(items[i]);
          const key = contract.candidateVersionKey(item);
          for (const existing of tx.items.values()) {
            if (contract.candidateVersionKey(existing) === key) {
              throw Object.assign(new Error(contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION), {
                code: contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION,
              });
            }
          }
          tx.items.set(item.id, clone(item));
          normalized.push(item);
        }
        appendAudits(tx, auditEvents);
        return { ok: true, items: normalized };
      });
    },

    transitionReviewItem: function (params) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const p = params || {};
      if (p.dryRun) {
        return { ok: true, dryRun: true, item: contract.normalizeReviewItem(p.nextItem) };
      }
      return withTxn(function (tx) {
        let cur = null;
        for (const it of tx.items.values()) {
          if (it.id === p.id || it.candidateId === p.id) {
            cur = it;
            break;
          }
        }
        if (!cur) {
          throw Object.assign(new Error(contract.ERROR_CODES.ITEM_NOT_FOUND), {
            code: contract.ERROR_CODES.ITEM_NOT_FOUND,
          });
        }
        cur = contract.normalizeReviewItem(cur);
        if (p.expectedStatus != null && cur.status !== p.expectedStatus) {
          throw Object.assign(new Error(contract.ERROR_CODES.STATUS_CHANGED), {
            code: contract.ERROR_CODES.STATUS_CHANGED,
          });
        }
        if (p.expectedLockVersion != null && Number(cur.lockVersion) !== Number(p.expectedLockVersion)) {
          throw Object.assign(new Error(contract.ERROR_CODES.STALE_VERSION), {
            code: contract.ERROR_CODES.STALE_VERSION,
          });
        }
        const next = contract.normalizeReviewItem(p.nextItem || cur);
        next.lockVersion = Number(cur.lockVersion || 1) + 1;
        tx.items.set(next.id, clone(next));
        if (cur.id !== next.id) tx.items.delete(cur.id);
        appendAudits(tx, p.auditEvents);
        return { ok: true, item: next, fromStatus: cur.status, toStatus: next.status };
      });
    },

    applyExistingIssueUpdate: function (params) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const p = params || {};
      if (p.dryRun) return { ok: true, dryRun: true, issue: p.mergedIssue };
      return withTxn(function (tx) {
        const merged = contract.normalizeReviewItem(p.mergedIssue);
        merged.lockVersion = Number(merged.lockVersion || 1) + 1;
        tx.items.set(merged.id, clone(merged));
        if (p.closedItem) {
          const closed = contract.normalizeReviewItem(p.closedItem);
          tx.items.set(closed.id, clone(closed));
        }
        if (p.updateRow) tx.updates.push(clone(p.updateRow));
        appendAudits(tx, p.auditEvents);
        return { ok: true, issue: merged };
      });
    },

    getPublishedIssues: function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const f = filters || {};
      let items = allItems().filter(function (it) {
        return it.status === 'PUBLISHED';
      });
      if (f.category) {
        items = items.filter(function (it) {
          return it.category === f.category;
        });
      }
      return { ok: true, items: items };
    },

    getRecentHistoricalIssues: function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const lookbackDays = Number((filters && filters.lookbackDays) || 30);
      const asOfMs = Date.parse((filters && filters.asOf) || new Date().toISOString()) || Date.now();
      const cutoff = asOfMs - lookbackDays * 864e5;
      const items = allItems().filter(function (it) {
        if (['PUBLISHED', 'RETIRED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'].indexOf(it.status) < 0) return false;
        const t = Date.parse(it.publishedAt || it.retiredAt || it.reviewedAt || it.queuedAt || '');
        return isFinite(t) && t >= cutoff;
      });
      return { ok: true, items: items };
    },

    listAuditEvents: function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      let events = state.audits.slice();
      if (filters && filters.entityId) {
        events = events.filter(function (e) {
          return e.entityId === filters.entityId;
        });
      }
      return { ok: true, events: events };
    },

    buildManifestSnapshot: function () {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const items = allItems();
      return {
        ok: true,
        manifest: {
          updatedAt: new Date().toISOString(),
          queueCount: items.filter(function (i) {
            return lifecycle.isQueueStatus(i.status);
          }).length,
          publishedCount: items.filter(function (i) {
            return i.status === 'PUBLISHED';
          }).length,
          rejectedCount: items.filter(function (i) {
            return i.status === 'REJECTED';
          }).length,
          retiredCount: items.filter(function (i) {
            return i.status === 'RETIRED' || i.status === 'SUPERSEDED';
          }).length,
        },
      };
    },

    withTransaction: function (callback) {
      if (!initialized) return Promise.resolve(contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED));
      return Promise.resolve(
        withTxn(function (tx) {
          return callback({
            state: tx,
            appendAudits: function (events) {
              appendAudits(tx, events);
            },
          });
        }),
      );
    },
  };

  return repo;
}

/**
 * DB repository factory
 * - fake: in-memory contract double
 * - executor / query+withTransaction: 실 SQL repository
 * - DAILY_ISSUE_DATABASE_URL: pg pool (운영 DATABASE_URL 자동 사용 금지)
 * - 연결 실패 시 JSON 자동 fallback 금지
 */
function unavailableDbRepo(message) {
  const err = function () {
    return contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, message || 'DATABASE_UNAVAILABLE');
  };
  return {
    kind: contract.REPOSITORY_KINDS.DB,
    initialize: err,
    healthCheck: err,
    getById: err,
    getByCandidateId: err,
    findByStatus: err,
    list: err,
    findDuplicateMatches: err,
    insertReviewItems: err,
    transitionReviewItem: err,
    applyExistingIssueUpdate: err,
    getPublishedIssues: err,
    getRecentHistoricalIssues: err,
    listAuditEvents: err,
    buildManifestSnapshot: err,
    withTransaction: function () {
      return Promise.resolve(err());
    },
  };
}

function createDbDailyIssueReviewRepository(options) {
  const opt = options || {};
  if (opt.mode === 'fake' || opt.fake === true) {
    return createFakeDbDailyIssueReviewRepository(opt);
  }

  const { createSqlDailyIssueReviewRepository } = require('./daily-issue-review-sql-repository');
  const { createDailyIssuePgExecutor, resolveDailyIssueDatabaseUrl } = require('./daily-issue-pg-client');

  // Injected executor (unit tests / custom)
  if (opt.executor && typeof opt.executor.withTransaction === 'function') {
    return createSqlDailyIssueReviewRepository({
      executor: opt.executor,
      schemaName: opt.schemaName,
    });
  }

  // Injected query + withTransaction
  if (typeof opt.query === 'function' && typeof opt.withTransaction === 'function') {
    return createSqlDailyIssueReviewRepository({
      executor: {
        query: opt.query,
        withTransaction: opt.withTransaction,
        healthCheck: opt.healthCheck,
        end: opt.end,
        schemaName: opt.schemaName || 'public',
      },
      schemaName: opt.schemaName,
    });
  }

  // Legacy: client with query+withTransaction
  const client = opt.client || null;
  if (client && typeof client.withTransaction === 'function' && typeof client.query === 'function') {
    return createSqlDailyIssueReviewRepository({
      executor: {
        query: client.query.bind(client),
        withTransaction: client.withTransaction.bind(client),
        healthCheck: client.healthCheck && client.healthCheck.bind(client),
        end: client.end && client.end.bind(client),
        schemaName: opt.schemaName || client.schemaName || 'public',
      },
      schemaName: opt.schemaName || client.schemaName,
    });
  }

  const databaseUrl = Object.prototype.hasOwnProperty.call(opt, 'databaseUrl')
    ? String(opt.databaseUrl || '').trim()
    : resolveDailyIssueDatabaseUrl(opt);
  const enabled =
    opt.enabled === false
      ? false
      : opt.enabled === true ||
        String(process.env.DAILY_ISSUE_DB_ENABLED || '') === '1' ||
        !!databaseUrl;

  if (!databaseUrl || !enabled) {
    return unavailableDbRepo(
      'DB repository selected but DAILY_ISSUE_DATABASE_URL missing (no JSON fallback; DATABASE_URL not auto-used)',
    );
  }

  const executor = createDailyIssuePgExecutor({
    databaseUrl: databaseUrl,
    schemaName: opt.schemaName,
    Pool: opt.Pool,
    pool: opt.pool,
  });

  if (!executor.ok) {
    return unavailableDbRepo(executor.message || 'pg executor unavailable');
  }

  return createSqlDailyIssueReviewRepository({
    executor: executor,
    schemaName: executor.schemaName,
  });
}

module.exports = {
  createDbDailyIssueReviewRepository: createDbDailyIssueReviewRepository,
  createFakeDbDailyIssueReviewRepository: createFakeDbDailyIssueReviewRepository,
  snapshotHash: snapshotHash,
};
