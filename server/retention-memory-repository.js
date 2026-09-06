'use strict';

const crypto = require('crypto');
const core = require('../shared/retention-policy-core');

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createRetentionMemoryRepository() {
  const store = {
    evidence: new Map(),
    sanctions: [],
    rejoin: [],
    reports: new Map(),
    boardWipes: [],
    holdEvents: [],
  };

  function reset() {
    store.evidence.clear();
    store.sanctions = [];
    store.rejoin = [];
    store.reports.clear();
    store.boardWipes = [];
    store.holdEvents = [];
  }

  async function upsertDeletedEvidence(row) {
    const key = String(row.contentKind) + ':' + String(row.sourceContentId);
    const prev = store.evidence.get(key);
    const next = Object.assign({}, prev || {}, row, {
      id: (prev && prev.id) || row.id || uuid(),
    });
    if (prev && prev.retentionUntil) {
      next.retentionUntil = core.maxRetention(prev.retentionUntil, row.retentionUntil);
    }
    if (prev && prev.legalHold && row.legalHold !== false) next.legalHold = true;
    store.evidence.set(key, next);
    return { ok: true, duplicate: !!prev, row: Object.assign({}, next) };
  }

  async function getEvidenceBySource(kind, sourceId) {
    const row = store.evidence.get(String(kind) + ':' + String(sourceId));
    return row ? Object.assign({}, row) : null;
  }

  async function getEvidenceById(id) {
    const want = String(id || '');
    let found = null;
    store.evidence.forEach(function (row) {
      if (row.id === want) found = row;
    });
    return found ? Object.assign({}, found) : null;
  }

  async function listEvidence() {
    return Array.from(store.evidence.values()).map(function (r) { return Object.assign({}, r); });
  }

  async function setEvidenceLegalHold(id, hold, reason, opts) {
    const row = await getEvidenceById(id);
    if (!row) return { ok: false, error: 'EVIDENCE_NOT_FOUND' };
    const key = row.contentKind + ':' + row.sourceContentId;
    const next = Object.assign({}, row, {
      legalHold: !!hold,
      legalHoldReason: hold ? (reason || null) : null,
    });
    if (opts && opts.retentionUntil) next.retentionUntil = opts.retentionUntil;
    store.evidence.set(key, next);
    return { ok: true, row: Object.assign({}, next) };
  }

  async function deleteEvidence(id) {
    const row = await getEvidenceById(id);
    if (!row) return { ok: true, deleted: 0 };
    store.evidence.delete(row.contentKind + ':' + row.sourceContentId);
    store.boardWipes.push({ kind: row.contentKind, sourceId: row.sourceContentId });
    return { ok: true, deleted: 1, wiped: { kind: row.contentKind, sourceId: row.sourceContentId } };
  }

  async function upsertReportRetention(reportId, patch) {
    const prev = store.reports.get(reportId) || { id: reportId };
    const next = Object.assign({}, prev, patch, { id: reportId });
    store.reports.set(reportId, next);
    return { ok: true, row: Object.assign({}, next) };
  }

  async function getReportRetention(reportId) {
    const row = store.reports.get(reportId);
    return row ? Object.assign({}, row) : null;
  }

  async function listReportRetention() {
    return Array.from(store.reports.values()).map(function (r) { return Object.assign({}, r); });
  }

  async function deleteReportRetention(reportId) {
    const had = store.reports.delete(reportId);
    return { ok: true, deleted: had ? 1 : 0 };
  }

  async function insertSanctionRecord(row) {
    const next = Object.assign({ id: uuid() }, row);
    store.sanctions.push(next);
    return { ok: true, row: Object.assign({}, next) };
  }

  async function listSanctionRecords() {
    return store.sanctions.map(function (r) { return Object.assign({}, r); });
  }

  async function getSanctionRecord(id) {
    const found = store.sanctions.filter(function (r) { return r.id === id; })[0];
    return found ? Object.assign({}, found) : null;
  }

  async function setSanctionLegalHold(id, hold, reason, nowIso) {
    const found = store.sanctions.filter(function (r) { return r.id === id; })[0];
    if (!found) return { ok: false, error: 'SANCTION_RECORD_NOT_FOUND' };
    if (hold) {
      if (found.legalHold) {
        return { ok: true, idempotent: true, row: Object.assign({}, found) };
      }
      found.legalHold = true;
      found.legalHoldReason = reason || null;
      return { ok: true, idempotent: false, row: Object.assign({}, found) };
    }
    if (!found.legalHold) {
      return { ok: true, idempotent: true, row: Object.assign({}, found) };
    }
    found.legalHold = false;
    found.legalHoldReason = null;
    found.retentionUntil = core.resolveRetentionUntilAfterRelease(found.retentionUntil, nowIso || new Date().toISOString());
    return { ok: true, idempotent: false, row: Object.assign({}, found) };
  }

  async function deleteSanctionRecord(id) {
    const before = store.sanctions.length;
    store.sanctions = store.sanctions.filter(function (r) { return r.id !== id; });
    return { ok: true, deleted: before - store.sanctions.length };
  }

  async function insertRejoinBlock(row) {
    const exists = store.rejoin.some(function (r) { return r.identityHash === row.identityHash; });
    if (exists) return { ok: true, duplicate: true };
    const next = Object.assign({ id: uuid() }, row);
    store.rejoin.push(next);
    return { ok: true, duplicate: false, row: Object.assign({}, next) };
  }

  async function listRejoinBlocks() {
    return store.rejoin.map(function (r) { return Object.assign({}, r); });
  }

  async function deleteRejoinBlock(id) {
    const before = store.rejoin.length;
    store.rejoin = store.rejoin.filter(function (r) { return r.id !== id; });
    return { ok: true, deleted: before - store.rejoin.length };
  }

  async function insertLegalHoldEvent(row) {
    const next = Object.assign({ id: uuid(), createdAt: new Date().toISOString() }, row);
    store.holdEvents.push(next);
    return { ok: true, row: Object.assign({}, next) };
  }

  return {
    upsertDeletedEvidence,
    getEvidenceBySource,
    getEvidenceById,
    listEvidence,
    setEvidenceLegalHold,
    deleteEvidence,
    upsertReportRetention,
    getReportRetention,
    listReportRetention,
    deleteReportRetention,
    insertSanctionRecord,
    listSanctionRecords,
    getSanctionRecord,
    setSanctionLegalHold,
    deleteSanctionRecord,
    insertRejoinBlock,
    listRejoinBlocks,
    deleteRejoinBlock,
    insertLegalHoldEvent,
    _reset: reset,
    _store: store,
  };
}

module.exports = {
  createRetentionMemoryRepository,
};
