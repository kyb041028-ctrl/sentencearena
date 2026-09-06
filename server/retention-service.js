'use strict';

const core = require('../shared/retention-policy-core');
const identity = require('./retention-identity');
const { createRetentionMemoryRepository } = require('./retention-memory-repository');

let _repo = createRetentionMemoryRepository();
let _nowFn = function () { return new Date(); };
let _boardWipe = null;
let _reportLister = null;
let _extraPurgers = [];
let _rightsHoldAdapter = null;
let _adminAuditHoldAdapter = null;
let _adminAuditPurger = null;

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

function setRightsHoldAdapter(adapter) {
  _rightsHoldAdapter = adapter || null;
}

function setAdminAuditHoldAdapter(adapter) {
  _adminAuditHoldAdapter = adapter || null;
}

function setAdminAuditPurger(fn) {
  _adminAuditPurger = typeof fn === 'function' ? fn : null;
}

function nowIso() {
  return _nowFn().toISOString();
}

function safeLog(event, counts) {
  console.log('[retention]', event, JSON.stringify(counts || {}));
}

function fail(code) {
  return { ok: false, error: code };
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

function normalizeTarget(input) {
  const src = input || {};
  let targetType = String(src.targetType || src.target_type || '').trim().toUpperCase();
  let targetId = src.targetId || src.target_id || null;

  if (!targetType) {
    if (src.evidenceId || src.id && (src.contentKind || src.sourceContentId)) {
      targetType = core.LEGAL_HOLD_TARGET_TYPE.EVIDENCE;
      targetId = src.evidenceId || src.id || null;
    } else if (src.reportId) {
      targetType = core.LEGAL_HOLD_TARGET_TYPE.REPORT;
      targetId = src.reportId;
    } else if (src.sanctionRecordId || src.sanctionId) {
      targetType = core.LEGAL_HOLD_TARGET_TYPE.SANCTION;
      targetId = src.sanctionRecordId || src.sanctionId;
    } else if (src.rightsCaseId || src.requestId) {
      targetType = core.LEGAL_HOLD_TARGET_TYPE.RIGHTS_CASE;
      targetId = src.rightsCaseId || src.requestId;
    } else if (src.auditEventId || src.adminAuditId) {
      targetType = core.LEGAL_HOLD_TARGET_TYPE.ADMIN_AUDIT;
      targetId = src.auditEventId || src.adminAuditId;
    }
  }

  if (
    targetType === core.LEGAL_HOLD_TARGET_TYPE.EVIDENCE
    && !targetId
    && src.contentKind
    && src.sourceContentId
  ) {
    return {
      ok: true,
      targetType: targetType,
      targetId: null,
      contentKind: src.contentKind,
      sourceContentId: src.sourceContentId,
    };
  }

  if (!core.isLegalHoldTargetType(targetType)) {
    return fail('HOLD_TARGET_TYPE_INVALID');
  }
  if (!targetId) return fail('HOLD_TARGET_ID_REQUIRED');
  return { ok: true, targetType: targetType, targetId: String(targetId) };
}

async function appendHoldEvent(actionType, targetType, targetId, actorUserId, reason) {
  if (!_repo || typeof _repo.insertLegalHoldEvent !== 'function') return;
  try {
    await _repo.insertLegalHoldEvent({
      actionType: actionType,
      targetType: targetType,
      targetId: targetId,
      actorUserId: actorUserId || null,
      reason: reason,
      createdAt: nowIso(),
    });
  } catch (e) {
    safeLog('hold-event-failed', { error: e && e.code ? e.code : 'HOLD_EVENT_FAILED' });
  }
}

async function applyReleaseRetentionPatch(row) {
  const releasedAt = nowIso();
  const nextUntil = core.resolveRetentionUntilAfterRelease(
    row && (row.retentionUntil || row.retention_until),
    releasedAt,
  );
  return { retentionUntil: nextUntil, releasedAt: releasedAt };
}

async function setEvidenceHold(evidenceId, hold, reason) {
  const row = await _repo.getEvidenceById(evidenceId);
  if (!row) return fail('EVIDENCE_NOT_FOUND');
  if (hold) {
    if (row.legalHold) {
      return { ok: true, idempotent: true, targetType: 'EVIDENCE', targetId: row.id, legalHold: true, row: row };
    }
    const saved = await _repo.setEvidenceLegalHold(row.id, true, reason);
    return Object.assign({ idempotent: false, targetType: 'EVIDENCE', targetId: row.id, legalHold: true }, saved);
  }
  if (!row.legalHold) {
    return { ok: true, idempotent: true, targetType: 'EVIDENCE', targetId: row.id, legalHold: false, row: row };
  }
  const patch = await applyReleaseRetentionPatch(row);
  const saved = await _repo.setEvidenceLegalHold(row.id, false, null, {
    retentionUntil: patch.retentionUntil,
  });
  return Object.assign({
    idempotent: false,
    targetType: 'EVIDENCE',
    targetId: row.id,
    legalHold: false,
  }, saved);
}

async function setReportHold(reportId, hold, reason) {
  const existing = _repo.getReportRetention ? await _repo.getReportRetention(reportId) : null;
  if (!existing) return fail('REPORT_NOT_FOUND');
  if (hold) {
    if (existing.legalHold) {
      return { ok: true, idempotent: true, targetType: 'REPORT', targetId: reportId, legalHold: true, row: existing };
    }
    const saved = await _repo.upsertReportRetention(reportId, {
      legalHold: true,
      legalHoldReason: reason,
    });
    return Object.assign({ idempotent: false, targetType: 'REPORT', targetId: reportId, legalHold: true }, saved);
  }
  if (!existing.legalHold) {
    return { ok: true, idempotent: true, targetType: 'REPORT', targetId: reportId, legalHold: false, row: existing };
  }
  const patch = await applyReleaseRetentionPatch(existing);
  const saved = await _repo.upsertReportRetention(reportId, {
    legalHold: false,
    legalHoldReason: null,
    retentionUntil: patch.retentionUntil,
  });
  return Object.assign({ idempotent: false, targetType: 'REPORT', targetId: reportId, legalHold: false }, saved);
}

async function setSanctionHold(sanctionId, hold, reason) {
  if (typeof _repo.setSanctionLegalHold === 'function') {
    const saved = await _repo.setSanctionLegalHold(sanctionId, hold, reason, nowIso());
    if (!saved || saved.ok === false) return saved || fail('SANCTION_RECORD_NOT_FOUND');
    return Object.assign({
      targetType: 'SANCTION',
      targetId: sanctionId,
      legalHold: !!hold,
      idempotent: !!saved.idempotent,
    }, saved);
  }
  if (!_repo.listSanctionRecords) return fail('SANCTION_RECORD_NOT_FOUND');
  const list = await _repo.listSanctionRecords();
  const found = list.filter(function (r) { return r.id === sanctionId; })[0];
  if (!found) return fail('SANCTION_RECORD_NOT_FOUND');
  if (hold) {
    if (found.legalHold) {
      return { ok: true, idempotent: true, targetType: 'SANCTION', targetId: sanctionId, legalHold: true, row: found };
    }
    found.legalHold = true;
    found.legalHoldReason = reason;
    return { ok: true, idempotent: false, targetType: 'SANCTION', targetId: sanctionId, legalHold: true, row: found };
  }
  if (!found.legalHold) {
    return { ok: true, idempotent: true, targetType: 'SANCTION', targetId: sanctionId, legalHold: false, row: found };
  }
  const patch = await applyReleaseRetentionPatch(found);
  found.legalHold = false;
  found.legalHoldReason = null;
  found.retentionUntil = patch.retentionUntil;
  return { ok: true, idempotent: false, targetType: 'SANCTION', targetId: sanctionId, legalHold: false, row: found };
}

async function setRightsHold(requestId, hold, reason) {
  if (!_rightsHoldAdapter || typeof _rightsHoldAdapter.setLegalHold !== 'function') {
    return fail('RIGHTS_HOLD_UNAVAILABLE');
  }
  const saved = await _rightsHoldAdapter.setLegalHold({
    requestId: requestId,
    hold: !!hold,
    reason: reason,
    nowIso: nowIso(),
  });
  if (!saved || saved.ok === false) return saved || fail('RIGHTS_CASE_NOT_FOUND');
  return Object.assign({
    targetType: 'RIGHTS_CASE',
    targetId: requestId,
    legalHold: !!hold,
  }, saved);
}

async function setAdminAuditHold(auditEventId, hold, reason, actorUserId) {
  if (!_adminAuditHoldAdapter || typeof _adminAuditHoldAdapter.setLegalHold !== 'function') {
    return fail('ADMIN_AUDIT_HOLD_UNAVAILABLE');
  }
  const saved = await _adminAuditHoldAdapter.setLegalHold({
    auditEventId: auditEventId,
    hold: !!hold,
    reason: reason,
    actorUserId: actorUserId || null,
    nowIso: nowIso(),
  });
  if (!saved || saved.ok === false) return saved || fail('ADMIN_AUDIT_NOT_FOUND');
  return Object.assign({
    targetType: 'ADMIN_AUDIT',
    targetId: auditEventId,
    legalHold: !!hold,
  }, saved);
}

/**
 * DEC-021 OWNER legal_hold set/release.
 * hold=true → HOLD_SET, hold=false → HOLD_RELEASE. reason required both ways.
 */
async function setLegalHold(target, hold, reason, meta) {
  const packedReason = core.normalizeLegalHoldReason(reason);
  if (!packedReason.ok) return fail(packedReason.error);

  const normalized = normalizeTarget(target);
  if (!normalized.ok) return normalized;

  let targetType = normalized.targetType;
  let targetId = normalized.targetId;
  const wantHold = !!hold;
  const actorUserId = meta && meta.actorUserId ? meta.actorUserId : null;

  let result;
  if (targetType === core.LEGAL_HOLD_TARGET_TYPE.EVIDENCE) {
    if (!targetId && normalized.contentKind && normalized.sourceContentId) {
      const row = await _repo.getEvidenceBySource(normalized.contentKind, normalized.sourceContentId);
      if (!row) return fail('EVIDENCE_NOT_FOUND');
      targetId = row.id;
    }
    result = await setEvidenceHold(targetId, wantHold, packedReason.reason);
  } else if (targetType === core.LEGAL_HOLD_TARGET_TYPE.REPORT) {
    result = await setReportHold(targetId, wantHold, packedReason.reason);
  } else if (targetType === core.LEGAL_HOLD_TARGET_TYPE.SANCTION) {
    result = await setSanctionHold(targetId, wantHold, packedReason.reason);
  } else if (targetType === core.LEGAL_HOLD_TARGET_TYPE.RIGHTS_CASE) {
    result = await setRightsHold(targetId, wantHold, packedReason.reason);
  } else if (targetType === core.LEGAL_HOLD_TARGET_TYPE.ADMIN_AUDIT) {
    result = await setAdminAuditHold(targetId, wantHold, packedReason.reason, actorUserId);
  } else {
    return fail('HOLD_TARGET_TYPE_INVALID');
  }

  if (!result || result.ok === false) return result || fail('HOLD_FAILED');

  if (!result.idempotent) {
    await appendHoldEvent(
      wantHold ? core.LEGAL_HOLD_ACTION.HOLD_SET : core.LEGAL_HOLD_ACTION.HOLD_RELEASE,
      targetType,
      result.targetId || targetId,
      actorUserId,
      packedReason.reason,
    );
  }

  return {
    ok: true,
    idempotent: !!result.idempotent,
    hold: wantHold,
    legalHold: !!result.legalHold,
    targetType: targetType,
    targetId: result.targetId || targetId,
    reason: wantHold ? packedReason.reason : packedReason.reason,
    row: result.row || null,
  };
}

async function getLegalHoldStatus(query) {
  const normalized = normalizeTarget(query);
  if (!normalized.ok) return normalized;

  const targetType = normalized.targetType;
  let targetId = normalized.targetId;

  if (targetType === core.LEGAL_HOLD_TARGET_TYPE.EVIDENCE) {
    let row = null;
    if (targetId) row = await _repo.getEvidenceById(targetId);
    else if (normalized.contentKind && normalized.sourceContentId) {
      row = await _repo.getEvidenceBySource(normalized.contentKind, normalized.sourceContentId);
      if (row) targetId = row.id;
    }
    if (!row) return fail('EVIDENCE_NOT_FOUND');
    return {
      ok: true,
      targetType: targetType,
      targetId: row.id,
      legalHold: !!row.legalHold,
      legalHoldReason: row.legalHoldReason || null,
      retentionUntil: row.retentionUntil || null,
    };
  }

  if (targetType === core.LEGAL_HOLD_TARGET_TYPE.REPORT) {
    const row = _repo.getReportRetention ? await _repo.getReportRetention(targetId) : null;
    if (!row) return fail('REPORT_NOT_FOUND');
    return {
      ok: true,
      targetType: targetType,
      targetId: targetId,
      legalHold: !!row.legalHold,
      legalHoldReason: row.legalHoldReason || null,
      retentionUntil: row.retentionUntil || null,
    };
  }

  if (targetType === core.LEGAL_HOLD_TARGET_TYPE.SANCTION) {
    if (typeof _repo.getSanctionRecord === 'function') {
      const row = await _repo.getSanctionRecord(targetId);
      if (!row) return fail('SANCTION_RECORD_NOT_FOUND');
      return {
        ok: true,
        targetType: targetType,
        targetId: targetId,
        legalHold: !!row.legalHold,
        legalHoldReason: row.legalHoldReason || null,
        retentionUntil: row.retentionUntil || null,
      };
    }
    const list = _repo.listSanctionRecords ? await _repo.listSanctionRecords() : [];
    const found = list.filter(function (r) { return r.id === targetId; })[0];
    if (!found) return fail('SANCTION_RECORD_NOT_FOUND');
    return {
      ok: true,
      targetType: targetType,
      targetId: targetId,
      legalHold: !!found.legalHold,
      legalHoldReason: found.legalHoldReason || null,
      retentionUntil: found.retentionUntil || null,
    };
  }

  if (targetType === core.LEGAL_HOLD_TARGET_TYPE.RIGHTS_CASE) {
    if (!_rightsHoldAdapter || typeof _rightsHoldAdapter.getLegalHold !== 'function') {
      return fail('RIGHTS_HOLD_UNAVAILABLE');
    }
    const row = await _rightsHoldAdapter.getLegalHold(targetId);
    if (!row || row.ok === false) return row || fail('RIGHTS_CASE_NOT_FOUND');
    return Object.assign({ ok: true, targetType: targetType, targetId: targetId }, row);
  }

  if (targetType === core.LEGAL_HOLD_TARGET_TYPE.ADMIN_AUDIT) {
    if (!_adminAuditHoldAdapter || typeof _adminAuditHoldAdapter.getLegalHold !== 'function') {
      return fail('ADMIN_AUDIT_HOLD_UNAVAILABLE');
    }
    const row = await _adminAuditHoldAdapter.getLegalHold(targetId);
    if (!row || row.ok === false) return row || fail('ADMIN_AUDIT_NOT_FOUND');
    return Object.assign({ ok: true, targetType: targetType, targetId: targetId }, row);
  }

  return fail('HOLD_TARGET_TYPE_INVALID');
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
  const counts = { evidence: 0, reports: 0, sanctions: 0, rejoin: 0, rights: 0, audit: 0 };
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
  for (let x = 0; x < _extraPurgers.length; x++) {
    try {
      const extra = await _extraPurgers[x](asOf);
      if (extra && extra.deleted) counts.rights += Number(extra.deleted) || 0;
    } catch (e) {
      safeLog('purge-extra-error', { error: e && e.code ? e.code : 'PURGE_EXTRA_FAILED' });
    }
  }
  if (typeof _adminAuditPurger === 'function') {
    try {
      const audit = await _adminAuditPurger(asOf);
      if (audit && audit.deleted) counts.audit += Number(audit.deleted) || 0;
    } catch (e) {
      safeLog('purge-audit-error', { error: e && e.code ? e.code : 'PURGE_AUDIT_FAILED' });
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
  setRightsHoldAdapter,
  setAdminAuditHoldAdapter,
  setAdminAuditPurger,
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
  getLegalHoldStatus,
  getEvidenceForOperator,
  purgeExpired,
  getRepository: function () { return _repo; },
};
