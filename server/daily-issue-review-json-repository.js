'use strict';

/**
 * 데일리 이슈 검수 — JSON 파일 repository 구현체
 * 원자성 B방식: 상태 snapshot → write → history append → 실패 시 rollback
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const publicationPolicy = require('../config/daily-issue-publication-policy');
const contract = require('../shared/daily-issue-review-repository-contract');

const DEFAULT_REVIEW_ROOT = path.join(__dirname, '..', '.cache', 'daily-issue', 'review');

const STATE_FILES = Object.freeze([
  'review-queue.json',
  'published.json',
  'rejected.json',
  'retired.json',
  'review-manifest.json',
]);

let _testHooks = {};

function setTestHooks(hooks) {
  _testHooks = hooks && typeof hooks === 'object' ? hooks : {};
}

function clearTestHooks() {
  _testHooks = {};
}

function hookFlag(name) {
  const v = _testHooks[name];
  if (typeof v === 'function') return !!v();
  return !!v;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveReviewRoot(root) {
  const resolved = path.resolve(root || DEFAULT_REVIEW_ROOT);
  if (resolved.includes('\0')) {
    throw Object.assign(new Error('INVALID_PATH'), { code: 'INVALID_PATH' });
  }
  return resolved;
}

function safeJoin(root, name) {
  const base = resolveReviewRoot(root);
  const clean = String(name || '').replace(/\\/g, '/');
  if (clean.includes('..') || clean.includes('\0') || path.isAbsolute(clean)) {
    throw Object.assign(new Error(contract.ERROR_CODES.PATH_TRAVERSAL_BLOCKED), {
      code: contract.ERROR_CODES.PATH_TRAVERSAL_BLOCKED,
    });
  }
  const full = path.resolve(base, clean);
  if (!full.startsWith(base + path.sep) && full !== base) {
    throw Object.assign(new Error(contract.ERROR_CODES.PATH_TRAVERSAL_BLOCKED), {
      code: contract.ERROR_CODES.PATH_TRAVERSAL_BLOCKED,
    });
  }
  return full;
}

function cleanupTmpFiles(root) {
  if (!fs.existsSync(root)) return;
  fs.readdirSync(root).forEach(function (name) {
    if (!/\.tmp$/i.test(name)) return;
    try {
      fs.unlinkSync(path.join(root, name));
    } catch (_) {}
  });
}

function atomicWriteJson(filePath, obj, opts) {
  const o = opts || {};
  const maxBytes = Number(o.maxBytes) || publicationPolicy.PUBLICATION_POLICY.maxJsonFileBytes || 8e6;
  const text = JSON.stringify(obj, null, 2);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw Object.assign(new Error('JSON_TOO_LARGE'), { code: 'JSON_TOO_LARGE' });
  }
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
    throw e;
  }
}

function atomicWriteBytes(filePath, buf) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
    throw e;
  }
}

function captureStateSnapshots(root) {
  const snaps = {};
  STATE_FILES.forEach(function (name) {
    const p = safeJoin(root, name);
    snaps[name] = fs.existsSync(p) ? fs.readFileSync(p) : null;
  });
  return snaps;
}

function restoreStateSnapshots(root, snaps) {
  if (hookFlag('failRollback')) {
    throw Object.assign(new Error('ROLLBACK_FAILED'), { code: 'ROLLBACK_FAILED' });
  }
  STATE_FILES.forEach(function (name) {
    const p = safeJoin(root, name);
    const prev = snaps[name];
    if (prev === null || prev === undefined) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } else {
      atomicWriteBytes(p, prev);
    }
  });
  cleanupTmpFiles(root);
}

function buildManifest(store) {
  return {
    updatedAt: new Date().toISOString(),
    queueCount: (store.queue.items || []).length,
    publishedCount: (store.published.items || []).length,
    rejectedCount: (store.rejected.items || []).length,
    retiredCount: (store.retired.items || []).length,
  };
}

function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const st = fs.statSync(filePath);
  const maxBytes = publicationPolicy.PUBLICATION_POLICY.maxJsonFileBytes || 8e6;
  if (st.size > maxBytes) {
    throw Object.assign(new Error('JSON_TOO_LARGE'), { code: 'JSON_TOO_LARGE' });
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw Object.assign(new Error('READ_FAILED'), { code: 'READ_FAILED', cause: e });
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw Object.assign(new Error(contract.ERROR_CODES.JSON_PARSE_FAILED), {
      code: contract.ERROR_CODES.JSON_PARSE_FAILED,
      cause: e,
    });
  }
}

function loadStore(reviewRoot) {
  const root = resolveReviewRoot(reviewRoot);
  return {
    root: root,
    queue: readJsonSafe(safeJoin(root, 'review-queue.json'), { version: 1, items: [] }),
    published: readJsonSafe(safeJoin(root, 'published.json'), { version: 1, items: [] }),
    rejected: readJsonSafe(safeJoin(root, 'rejected.json'), { version: 1, items: [] }),
    retired: readJsonSafe(safeJoin(root, 'retired.json'), { version: 1, items: [] }),
  };
}

function allItems(store) {
  return []
    .concat(store.queue.items || [])
    .concat(store.published.items || [])
    .concat(store.rejected.items || [])
    .concat(store.retired.items || [])
    .map(contract.normalizeReviewItem);
}

function findItem(store, id) {
  const key = String(id || '');
  const pools = [
    { bucket: 'queue', list: store.queue.items },
    { bucket: 'published', list: store.published.items },
    { bucket: 'rejected', list: store.rejected.items },
    { bucket: 'retired', list: store.retired.items },
  ];
  for (let i = 0; i < pools.length; i++) {
    const hit = (pools[i].list || []).find(function (it) {
      return it && (it.id === key || it.candidateId === key || it.issueId === key);
    });
    if (hit) return { item: contract.normalizeReviewItem(hit), bucket: pools[i].bucket };
  }
  return null;
}

function removeFromBucket(store, bucket, id) {
  const key = String(id || '');
  const pack = store[bucket];
  if (!pack) return false;
  const before = pack.items.length;
  pack.items = pack.items.filter(function (it) {
    return !(it && (it.id === key || it.candidateId === key));
  });
  return pack.items.length !== before;
}

function insertIntoBucket(store, bucket, item) {
  if (!store[bucket]) throw new Error('UNKNOWN_BUCKET');
  store[bucket].items.push(contract.normalizeReviewItem(item));
}

function persistStore(store) {
  if (hookFlag('failPersist')) {
    throw Object.assign(new Error(contract.ERROR_CODES.PERSIST_FAILED), {
      code: contract.ERROR_CODES.PERSIST_FAILED,
    });
  }
  const root = store.root;
  atomicWriteJson(safeJoin(root, 'review-queue.json'), store.queue);
  atomicWriteJson(safeJoin(root, 'published.json'), store.published);
  atomicWriteJson(safeJoin(root, 'rejected.json'), store.rejected);
  atomicWriteJson(safeJoin(root, 'retired.json'), store.retired);
  atomicWriteJson(safeJoin(root, 'review-manifest.json'), buildManifest(store));
}

function appendHistoryEvents(store, payloads) {
  if (hookFlag('failAppend')) {
    throw Object.assign(new Error(contract.ERROR_CODES.HISTORY_APPEND_FAILED), {
      code: contract.ERROR_CODES.HISTORY_APPEND_FAILED,
    });
  }
  const list = Array.isArray(payloads) ? payloads : [payloads];
  const events = list.map(function (payload) {
    return {
      eventId: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      entityId: payload.entityId,
      entityType: payload.entityType || 'review_item',
      fromStatus: payload.fromStatus,
      toStatus: payload.toStatus,
      action: payload.action,
      actorId: payload.actorId || null,
      reasonCode: payload.reasonCode || null,
      reasonText: String(payload.reasonText || '').slice(
        0,
        publicationPolicy.PUBLICATION_POLICY.maxReasonTextLength,
      ),
      timestamp: payload.timestamp || new Date().toISOString(),
      snapshotHash: payload.snapshotHash || null,
      transactionId: payload.transactionId || null,
      payload: payload.payload || null,
    };
  });
  if (!events.length) return;
  const filePath = safeJoin(store.root, 'review-history.jsonl');
  const chunk =
    events
      .map(function (e) {
        return JSON.stringify(e);
      })
      .join('\n') + '\n';
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, chunk, 'utf8');
}

function commitStoreWithHistory(store, historyPayloads, opts) {
  const o = opts || {};
  if (o.dryRun) return { ok: true, dryRun: true };
  const root = store.root;
  ensureDir(root);
  const snapshots = captureStateSnapshots(root);
  let persisted = false;
  try {
    persistStore(store);
    persisted = true;
    if (typeof _testHooks.afterPersist === 'function') _testHooks.afterPersist();
    appendHistoryEvents(store, historyPayloads);
    cleanupTmpFiles(root);
    return { ok: true };
  } catch (e) {
    const code = e.code || (persisted ? contract.ERROR_CODES.HISTORY_APPEND_FAILED : contract.ERROR_CODES.PERSIST_FAILED);
    try {
      restoreStateSnapshots(root, snapshots);
      cleanupTmpFiles(root);
      return {
        ok: false,
        error: code,
        message: String(e.message || e),
        rolledBack: true,
      };
    } catch (rb) {
      return {
        ok: false,
        error: contract.ERROR_CODES.FATAL_ROLLBACK_FAILED,
        persistError: code,
        rollbackError: rb.code || 'ROLLBACK_FAILED',
        message: String(rb.message || rb),
        rolledBack: false,
      };
    }
  }
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

function listAuditEvents(reviewRoot) {
  const file = safeJoin(resolveReviewRoot(reviewRoot), 'review-history.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map(function (line) {
      try {
        return JSON.parse(line);
      } catch (_) {
        return { parseError: true, line: line.slice(0, 80) };
      }
    });
}

/**
 * @param {object} options
 * @param {string} [options.reviewRoot]
 */
function createJsonDailyIssueReviewRepository(options) {
  const opt = options || {};
  const reviewRoot = resolveReviewRoot(opt.reviewRoot);
  let initialized = false;

  function requireInit() {
    if (!initialized) {
      return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
    }
    return null;
  }

  const repo = {
    kind: contract.REPOSITORY_KINDS.JSON,
    reviewRoot: reviewRoot,
    setTestHooks: setTestHooks,
    clearTestHooks: clearTestHooks,

    initialize: function () {
      ensureDir(reviewRoot);
      initialized = true;
      return { ok: true, kind: this.kind };
    },

    healthCheck: function () {
      return { ok: true, kind: this.kind, reviewRoot: reviewRoot, initialized: initialized };
    },

    loadStore: function () {
      return loadStore(reviewRoot);
    },

    getById: function (id) {
      const bad = requireInit();
      if (bad) return bad;
      const found = findItem(loadStore(reviewRoot), id);
      if (!found) return contract.repoError(contract.ERROR_CODES.ITEM_NOT_FOUND);
      return { ok: true, item: found.item, bucket: found.bucket };
    },

    getByCandidateId: function (candidateId) {
      return this.getById(candidateId);
    },

    findByStatus: function (statuses) {
      const bad = requireInit();
      if (bad) return bad;
      const want = Array.isArray(statuses) ? statuses : [statuses];
      const items = allItems(loadStore(reviewRoot)).filter(function (it) {
        return want.indexOf(it.status) >= 0;
      });
      return { ok: true, items: items };
    },

    list: function (filters) {
      const bad = requireInit();
      if (bad) return bad;
      const f = filters || {};
      let items = allItems(loadStore(reviewRoot));
      if (f.status) {
        const st = String(f.status);
        items = items.filter(function (it) {
          return it.status === st;
        });
      }
      return { ok: true, items: items, count: items.length };
    },

    findDuplicateMatches: function (signatures) {
      const bad = requireInit();
      if (bad) return bad;
      const sig = signatures || {};
      const items = allItems(loadStore(reviewRoot)).filter(function (it) {
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
      const bad = requireInit();
      if (bad) return bad;
      const o = opts || {};
      if (o.dryRun) {
        return { ok: true, dryRun: true, items: (items || []).map(contract.normalizeReviewItem) };
      }
      const store = loadStore(reviewRoot);
      const existingKeys = {};
      allItems(store).forEach(function (it) {
        existingKeys[contract.candidateVersionKey(it)] = 1;
      });
      const normalized = [];
      for (let i = 0; i < (items || []).length; i++) {
        const item = contract.normalizeReviewItem(items[i]);
        const key = contract.candidateVersionKey(item);
        if (existingKeys[key]) {
          return contract.repoError(contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION, key);
        }
        existingKeys[key] = 1;
        normalized.push(item);
      }
      normalized.forEach(function (item) {
        insertIntoBucket(store, 'queue', item);
      });
      const committed = commitStoreWithHistory(store, auditEvents || [], { dryRun: false });
      if (!committed.ok) return committed;
      return { ok: true, items: normalized };
    },

    transitionReviewItem: function (params) {
      const bad = requireInit();
      if (bad) return bad;
      const p = params || {};
      if (p.dryRun) {
        return { ok: true, dryRun: true, item: contract.normalizeReviewItem(p.nextItem) };
      }
      const store = loadStore(reviewRoot);
      const found = findItem(store, p.id);
      if (!found) return contract.repoError(contract.ERROR_CODES.ITEM_NOT_FOUND);

      const current = found.item;
      if (p.expectedStatus != null && current.status !== p.expectedStatus) {
        return contract.repoError(contract.ERROR_CODES.STATUS_CHANGED, null, {
          expectedStatus: p.expectedStatus,
          actualStatus: current.status,
        });
      }
      if (p.expectedLockVersion != null && Number(current.lockVersion) !== Number(p.expectedLockVersion)) {
        return contract.repoError(contract.ERROR_CODES.STALE_VERSION, null, {
          expectedLockVersion: p.expectedLockVersion,
          actualLockVersion: current.lockVersion,
        });
      }

      const next = contract.normalizeReviewItem(p.nextItem || current);
      next.lockVersion = Number(current.lockVersion || 1) + 1;
      const targetBucket = p.targetBucket || lifecycle.storageBucketForStatus(next.status);
      if (!targetBucket) return contract.repoError(contract.ERROR_CODES.INVALID_STATE_TRANSITION);

      removeFromBucket(store, found.bucket, current.id);
      insertIntoBucket(store, targetBucket, next);

      const committed = commitStoreWithHistory(store, p.auditEvents || [], { dryRun: false });
      if (!committed.ok) return committed;
      return { ok: true, item: next, fromStatus: current.status, toStatus: next.status };
    },

    applyExistingIssueUpdate: function (params) {
      const bad = requireInit();
      if (bad) return bad;
      const p = params || {};
      if (p.dryRun) return { ok: true, dryRun: true, issue: p.mergedIssue };
      const store = loadStore(reviewRoot);
      removeFromBucket(store, 'published', p.targetId);
      insertIntoBucket(store, 'published', contract.normalizeReviewItem(p.mergedIssue));
      if (p.closedItem) {
        removeFromBucket(store, p.closedFromBucket || 'queue', p.closedItem.id || p.closedItem.candidateId);
        insertIntoBucket(store, 'rejected', contract.normalizeReviewItem(p.closedItem));
      }
      const committed = commitStoreWithHistory(store, p.auditEvents || [], { dryRun: false });
      if (!committed.ok) return committed;
      return { ok: true, issue: contract.normalizeReviewItem(p.mergedIssue) };
    },

    getPublishedIssues: function (filters) {
      const bad = requireInit();
      if (bad) return bad;
      const f = filters || {};
      let items = (loadStore(reviewRoot).published.items || [])
        .map(contract.normalizeReviewItem)
        .filter(function (it) {
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
      const bad = requireInit();
      if (bad) return bad;
      const lookbackDays = Number((filters && filters.lookbackDays) || 30);
      const asOfMs = Date.parse((filters && filters.asOf) || new Date().toISOString()) || Date.now();
      const cutoff = asOfMs - lookbackDays * 864e5;
      const store = loadStore(reviewRoot);
      const items = []
        .concat(store.published.items || [])
        .concat(store.retired.items || [])
        .concat(store.rejected.items || [])
        .map(contract.normalizeReviewItem)
        .filter(function (it) {
          const t = Date.parse(it.publishedAt || it.retiredAt || it.reviewedAt || it.queuedAt || '');
          return isFinite(t) && t >= cutoff;
        });
      return { ok: true, items: items };
    },

    listAuditEvents: function (filters) {
      const bad = requireInit();
      if (bad) return bad;
      let events = listAuditEvents(reviewRoot);
      if (filters && filters.entityId) {
        events = events.filter(function (e) {
          return e.entityId === filters.entityId;
        });
      }
      return { ok: true, events: events };
    },

    buildManifestSnapshot: function () {
      const bad = requireInit();
      if (bad) return bad;
      return { ok: true, manifest: buildManifest(loadStore(reviewRoot)) };
    },

    withTransaction: function (callback) {
      const bad = requireInit();
      if (bad) return Promise.resolve(bad);
      // JSON repo: callback receives helpers; commit is caller's responsibility via insert/transition
      try {
        const result = callback({
          loadStore: function () {
            return loadStore(reviewRoot);
          },
          commitStoreWithHistory: commitStoreWithHistory,
        });
        return Promise.resolve(result);
      } catch (e) {
        return Promise.resolve(
          contract.repoError(contract.ERROR_CODES.TRANSACTION_FAILED, String(e.message || e)),
        );
      }
    },

    // low-level exports used by service/tests
    commitStoreWithHistory: commitStoreWithHistory,
    findItemInStore: findItem,
    allItemsInStore: allItems,
    removeFromBucket: removeFromBucket,
    insertIntoBucket: insertIntoBucket,
  };

  return repo;
}

module.exports = {
  DEFAULT_REVIEW_ROOT: DEFAULT_REVIEW_ROOT,
  createJsonDailyIssueReviewRepository: createJsonDailyIssueReviewRepository,
  resolveReviewRoot: resolveReviewRoot,
  safeJoin: safeJoin,
  atomicWriteJson: atomicWriteJson,
  loadStore: loadStore,
  commitStoreWithHistory: commitStoreWithHistory,
  captureStateSnapshots: captureStateSnapshots,
  restoreStateSnapshots: restoreStateSnapshots,
  setTestHooks: setTestHooks,
  clearTestHooks: clearTestHooks,
  buildManifest: buildManifest,
  snapshotHash: snapshotHash,
  findItem: findItem,
  allItems: allItems,
  removeFromBucket: removeFromBucket,
  insertIntoBucket: insertIntoBucket,
  listAuditEvents: listAuditEvents,
};
