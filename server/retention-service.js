'use strict';

const core = require('../shared/retention-policy-core');
const identity = require('./retention-identity');
const { createRetentionMemoryRepository } = require('./retention-memory-repository');

let _repo = createRetentionMemoryRepository();
let _nowFn = function () { return new Date(); };
let _boardWipe = null;
let _reportLister = null;
let _extraPurgers = [];

function setRepository(repo) {
  _repo = repo || createRetentionMemoryRepository();
}

function setNow(fn) {
  _nowFn = typeof fn === 'function' ? fn : function () { return new Date(); };
}

function setBoardWiper(fn) {
  _boardWipe = typeof fn === 'function' ? fn : null;
}

function setReportLister(fn) {
  _reportLister = typeof fn === 'function' ? fn : null;
}

function addExtraPurger(fn) {
  if (typeof fn === 'function') _extraPurgers.push(fn);
}

function nowIso() {
  return _nowFn().toISOString();
}

function safeLog(event, counts) {
  console.log('[retention]', event, JSON.stringify(counts || {}));
}

async function captureDeletedContent(input) {
  const built = core.buildDeletedEvidence(Object.assign({}, input || {}, {
    deletedAt: (input && input.deletedAt) || nowIso(),
  }));
  if (!built.ok) return built;
  const saved = await _repo.upsertDeletedEvidence(built.row);
  if (saved && saved.row && saved.row.id && typeof _reportLister === 'function') {
    try {
      const reports = await _reportLister(built.row.contentKind, built.row.sourceContentId);
      const list = Array.isArray(reports) ? reports : [];
      for (let i = 0; i < list.length; i++) {
        const report = list[i];
        if (!report || !report.id) continue;
        const patch = { evidenceId: saved.row.id };
        if (core.isFinalReportStatus(report.status) && (report.retentionUntil || report.retention_until)) {
          const extended = core.maxRetention(saved.row.retentionUntil, report.retentionUntil || report.retention_until);
          if (extended !== saved.row.retentionUntil) {
            await _repo.upsertDeletedEvidence(Object.assign({}, saved.row, { retentionUntil: extended }));
          }
        }
        await _repo.upsertReportRetention(report.id, patch);
      }
    } catch (e) {
      safeLog('link-reports-failed', { error: e && e.code ? e.code : 'LINK_FAILED' });
    }
  }
  return saved;
}

async function syncReportReview(report) {
  const src = report || {};
  const existing = _repo.getReportRetention ? await _repo.getReportRetention(src.id) : null;
  const patch = core.reportReviewPatch(src.status, nowIso(), existing || src);
  const saved = await _repo.upsertReportRetention(src.id, patch);
  if (patch.retentionUntil && (src.postId || src.commentId)) {
    const kind = src.postId ? 'POST' : 'COMMENT';
    const sourceId = src.postId || src.commentId;
    const evidence = await _repo.getEvidenceBySource(kind, sourceId);
    if (evidence && patch.retentionUntil) {
      const until = core.maxRetention(evidence.retentionUntil, patch.retentionUntil);
      if (until !== evidence.retentionUntil) {
        await _repo.upsertDeletedEvidence(Object.assign({}, evidence, { retentionUntil: until }));
      }
    }
  }
  return saved;
}

async function recordSanction(input) {
  const built = core.buildSanctionRecord(Object.assign({}, input || {}));
  if (!built.ok) return built;
  return _repo.insertSanctionRecord(built.row);
}

async function recordBannedRejoin(input) {
  const src = input || {};
  const hashes = Array.isArray(src.hashes) ? src.hashes : [];
  if (!hashes.length && src.user) {
    const packed = identity.hashIdentities(src.pepper, src.user);
    if (!packed.ok) {
      safeLog('rejoin-pepper-missing', { error: packed.error });
      return packed;
    }
    hashes.push.apply(hashes, packed.hashes);
  }
  let created = 0;
  for (let i = 0; i < hashes.length; i++) {
    const built = core.buildBannedRejoinRecord(Object.assign({}, src, hashes[i]));
    if (!built.ok) continue;
    const saved = await _repo.insertRejoinBlock(built.row);
    if (saved && saved.ok && !saved.duplicate) created += 1;
  }
  return { ok: true, created: created };
}

async function setLegalHold(target, hold, reason) {
  const src = target || {};
  if (src.evidenceId) {
    return _repo.setEvidenceLegalHold(src.evidenceId, hold, reason);
  }
  if (src.contentKind && src.sourceContentId) {
    const row = await _repo.getEvidenceBySource(src.contentKind, src.sourceContentId);
    if (!row) return { ok: false, error: 'EVIDENCE_NOT_FOUND' };
    return _repo.setEvidenceLegalHold(row.id, hold, reason);
  }
  if (src.reportId) {
    return _repo.upsertReportRetention(src.reportId, {
      legalHold: !!hold,
      legalHoldReason: hold ? (reason || null) : null,
      retentionUntil: hold ? null : undefined,
    });
  }
  if (src.sanctionRecordId && _repo.listSanctionRecords) {
    const list = await _repo.listSanctionRecords();
    const found = list.filter(function (r) { return r.id === src.sanctionRecordId; })[0];
    if (!found) return { ok: false, error: 'SANCTION_RECORD_NOT_FOUND' };
    found.legalHold = !!hold;
    return { ok: true, row: found };
  }
  return { ok: false, error: 'HOLD_TARGET_INVALID' };
}

async function getEvidenceForOperator(query) {
  const q = query || {};
  if (q.id) return _repo.getEvidenceById(q.id);
  if (q.contentKind && q.sourceContentId) return _repo.getEvidenceBySource(q.contentKind, q.sourceContentId);
  return null;
}

async function wipeSource(kind, sourceId) {
  if (_repo.wipeBoardSource) {
    try { await _repo.wipeBoardSource(kind, sourceId); } catch (_) {}
  }
  if (typeof _boardWipe === 'function') {
    try { await _boardWipe(kind, sourceId); } catch (_) {}
  }
}

async function purgeExpired(now) {
  const asOf = now || nowIso();
  const counts = { evidence: 0, reports: 0, sanctions: 0, rejoin: 0 };
  try {
    const evidence = await _repo.listEvidence();
    for (let i = 0; i < evidence.length; i++) {
      if (!core.shouldPurge(evidence[i], asOf)) continue;
      const del = await _repo.deleteEvidence(evidence[i].id);
      if (del && del.deleted) {
        counts.evidence += del.deleted;
        if (del.wiped) await wipeSource(del.wiped.kind, del.wiped.sourceId);
      }
    }
  } catch (e) {
    safeLog('purge-evidence-error', { error: e && e.code ? e.code : 'PURGE_EVIDENCE_FAILED' });
  }
  try {
    const reports = await _repo.listReportRetention();
    for (let r = 0; r < reports.length; r++) {
      if (!core.shouldPurge(reports[r], asOf)) continue;
      if (!core.isFinalReportStatus(reports[r].status)) continue;
      const del = await _repo.deleteReportRetention(reports[r].id);
      if (del && del.deleted) counts.reports += del.deleted;
    }
  } catch (e) {
    safeLog('purge-reports-error', { error: e && e.code ? e.code : 'PURGE_REPORTS_FAILED' });
  }
  try {
    const sanctions = await _repo.listSanctionRecords();
    for (let s = 0; s < sanctions.length; s++) {
      const row = sanctions[s];
      if (row.permanent) continue;
      if (!core.shouldPurge(row, asOf)) continue;
      const del = await _repo.deleteSanctionRecord(row.id);
      if (del && del.deleted) counts.sanctions += del.deleted;
    }
  } catch (e) {
    safeLog('purge-sanctions-error', { error: e && e.code ? e.code : 'PURGE_SANCTIONS_FAILED' });
  }
  try {
    const blocks = await _repo.listRejoinBlocks();
    for (let b = 0; b < blocks.length; b++) {
      if (!core.shouldPurge(blocks[b], asOf)) continue;
      const del = await _repo.deleteRejoinBlock(blocks[b].id);
      if (del && del.deleted) counts.rejoin += del.deleted;
    }
  } catch (e) {
    safeLog('purge-rejoin-error', { error: e && e.code ? e.code : 'PURGE_REJOIN_FAILED' });
  }
  counts.rights = 0;
  for (let x = 0; x < _extraPurgers.length; x++) {
    try {
      const extra = await _extraPurgers[x](asOf);
      if (extra && extra.deleted) counts.rights += Number(extra.deleted) || 0;
    } catch (e) {
      safeLog('purge-extra-error', { error: e && e.code ? e.code : 'PURGE_EXTRA_FAILED' });
    }
  }
  safeLog('purge-complete', counts);
  return { ok: true, counts: counts };
}

module.exports = {
  setRepository,
  setNow,
  setBoardWiper,
  setReportLister,
  addExtraPurger,
  extendEvidenceRetention: async function (evidenceId, until) {
    const row = await _repo.getEvidenceById(evidenceId);
    if (!row) return { ok: false, error: 'EVIDENCE_NOT_FOUND' };
    const nextUntil = core.maxRetention(row.retentionUntil, until);
    return _repo.upsertDeletedEvidence(Object.assign({}, row, { retentionUntil: nextUntil }));
  },
  captureDeletedContent,
  syncReportReview,
  recordSanction,
  recordBannedRejoin,
  setLegalHold,
  getEvidenceForOperator,
  purgeExpired,
  getRepository: function () { return _repo; },
};
