'use strict';

const crypto = require('crypto');
const core = require('../shared/rights-infringement-core');

let _repo = null;
let _now = function () { return new Date().toISOString(); };
let _board = null;
let _retention = null;
let _sanction = null;

function setRepository(repo) {
  _repo = repo;
}

function setNow(fn) {
  _now = fn || _now;
}

function setBoardAdapter(adapter) {
  _board = adapter || null;
}

function setRetentionAdapter(adapter) {
  _retention = adapter || null;
}

function setSanctionAdapter(adapter) {
  _sanction = adapter || null;
}

function nowIso() {
  return _now();
}

function fail(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 400;
  return err;
}

function requireRepo() {
  if (!_repo) throw fail('RIGHTS_REPOSITORY_UNAVAILABLE', 503);
  return _repo;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function snapshotTarget(src) {
  if (!_board) return null;
  try {
    if (src.targetKind === core.TARGET_KIND.POST && src.postId && typeof _board.getPost === 'function') {
      const post = await _board.getPost(src.postId);
      if (!post) return { missing: true, kind: 'POST', id: src.postId };
      return {
        kind: 'POST',
        id: post.id,
        title: post.title || '',
        body: post.content || post.body || '',
        status: post.status || null,
        authorUserId: post.authorUserId || null,
        authorDisplayName: post.authorDisplayName || null,
      };
    }
    if (src.targetKind === core.TARGET_KIND.COMMENT && src.commentId && typeof _board.getComment === 'function') {
      const comment = await _board.getComment(src.commentId);
      if (!comment) return { missing: true, kind: 'COMMENT', id: src.commentId };
      return {
        kind: 'COMMENT',
        id: comment.id,
        postId: comment.postId || null,
        body: comment.content || '',
        status: comment.status || null,
        authorUserId: comment.authorUserId || null,
      };
    }
  } catch (_) {}
  return null;
}

async function resolveAuthorUserId(src, snapshot) {
  if (snapshot && snapshot.authorUserId) return snapshot.authorUserId;
  if (!_board) return null;
  try {
    if (src.postId && typeof _board.getPost === 'function') {
      const post = await _board.getPost(src.postId);
      if (post && post.authorUserId) return post.authorUserId;
    }
    if (src.commentId && typeof _board.getComment === 'function') {
      const comment = await _board.getComment(src.commentId);
      if (comment && comment.authorUserId) return comment.authorUserId;
    }
  } catch (_) {}
  return null;
}

async function submitRequest(input, context) {
  const ctx = context || {};
  const repo = requireRepo();
  const now = nowIso();
  const raw = Object.assign({}, input || {}, {
    claimantUserId: ctx.userId || input.claimantUserId || null,
  });
  const check = core.validateSubmission(raw);
  if (!check.ok) {
    throw fail(check.errors[0] || 'RIGHTS_VALIDATION_FAILED', 400);
  }
  const src = core.sanitizeSubmission(raw);
  src.claimantUserId = ctx.userId || src.claimantUserId;

  if (src.claimantUserId) {
    try {
      const abuse = await repo.getAbuseState(src.claimantUserId);
      if (core.isRestrictionActive(abuse, now)) {
        throw fail('RIGHTS_REQUEST_RESTRICTED', 403);
      }
    } catch (e) {
      if (e && e.code === 'RIGHTS_REQUEST_RESTRICTED') throw e;
    }
  }

  const openDup = await repo.findOpenDuplicate(src);
  if (openDup) {
    const err = fail('RIGHTS_DUPLICATE_OPEN', 409);
    err.existing = core.mapPublicSubmit(openDup);
    throw err;
  }
  const latest = await repo.findLatestSame(src);
  if (latest && (latest.status === core.STATUS.INTAKE_REJECTED || latest.status === core.STATUS.COMPLETED)) {
    if (!core.canResubmitRejected(Object.assign({}, src, raw))) {
      const err = fail('RIGHTS_DUPLICATE_REJECTED', 409);
      err.existing = core.mapPublicSubmit(latest);
      throw err;
    }
  }

  const id = uuid();
  const snapshot = await snapshotTarget(src);
  const authorUserId = await resolveAuthorUserId(src, snapshot);
  const row = Object.assign({}, src, {
    id: id,
    caseNumber: core.makeCaseNumber(now, id),
    status: core.STATUS.RECEIVED,
    isFormal: false,
    highRiskPrivacy: src.claimType === core.CLAIM_TYPE.PRIVACY && core.isHighRiskPrivacy(src),
    targetAuthorUserId: authorUserId,
    targetSnapshot: snapshot,
    createdAt: now,
    updatedAt: now,
    legalHold: false,
  });
  const saved = await repo.insertRequest(row);
  await repo.insertEvent({
    requestId: saved.id,
    actorKind: 'CLAIMANT',
    actorUserId: src.claimantUserId || null,
    action: 'SUBMITTED',
    note: null,
  });
  return {
    request: core.mapPublicSubmit(saved),
    autoDeleted: false,
    autoSanctioned: false,
  };
}

async function listAuthorNotices(userId) {
  if (!userId) return [];
  const rows = await requireRepo().listAuthorNotices(userId);
  return rows.map(core.mapAuthorNotice);
}

async function submitObjection(userId, requestId, input) {
  const repo = requireRepo();
  const row = await repo.getRequest(requestId);
  if (!row) throw fail('RIGHTS_REQUEST_NOT_FOUND', 404);
  if (!userId || String(row.targetAuthorUserId || '') !== String(userId)) {
    throw fail('RIGHTS_OBJECTION_FORBIDDEN', 403);
  }
  if (row.status !== core.STATUS.TEMP_TAKEDOWN && !row.tempTakedownAt) {
    throw fail('RIGHTS_OBJECTION_NOT_AVAILABLE', 400);
  }
  const now = nowIso();
  if (row.authorObjectionDeadline && new Date(row.authorObjectionDeadline).getTime() < new Date(now).getTime()) {
    throw fail('RIGHTS_OBJECTION_EXPIRED', 400);
  }
  const check = core.validateObjection(input || {});
  if (!check.ok) throw fail(check.errors[0] || 'OBJECTION_INVALID', 400);
  const saved = await repo.insertObjection({
    requestId: row.id,
    authorUserId: userId,
    ground: String(input.ground || '').toUpperCase(),
    explanation: core.trimText(input.explanation),
  });
  const next = Object.assign({}, row, {
    status: core.STATUS.AUTHOR_OBJECTED,
    authorObjectedAt: now,
    updatedAt: now,
  });
  await repo.updateRequest(row.id, next);
  await repo.insertEvent({
    requestId: row.id,
    actorKind: 'AUTHOR',
    actorUserId: userId,
    action: 'AUTHOR_OBJECTED',
    note: saved.ground,
  });
  return { ok: true, objection: { id: saved.id, createdAt: saved.createdAt, ground: saved.ground } };
}

async function listAdmin() {
  const rows = await requireRepo().listRequests();
  return rows.map(core.mapAdminList);
}

function mapAdminDetail(row, extras) {
  const src = row || {};
  return {
    list: core.mapAdminList(src),
    claimantKind: src.claimantKind,
    claimantName: src.claimantName,
    claimantEmail: src.claimantEmail,
    representativeOf: src.representativeOf,
    representativeRelation: src.representativeRelation,
    representativeAuthority: src.representativeAuthority,
    problemExcerpt: src.problemExcerpt,
    claimedRight: src.claimedRight,
    infringementReason: src.infringementReason,
    caseNarrative: src.caseNarrative,
    requestedAction: src.requestedAction,
    requestedActionDetail: src.requestedActionDetail,
    evidenceDescription: src.evidenceDescription,
    evidenceUrl: src.evidenceUrl,
    extra: {
      defamationStatement: src.defamationStatement,
      defamationRefersTo: src.defamationRefersTo,
      defamationNature: src.defamationNature,
      defamationFalsehood: src.defamationFalsehood,
      defamationHonorHarm: src.defamationHonorHarm,
      privacyInfoType: src.privacyInfoType,
      privacyWhose: src.privacyWhose,
      privacyLocation: src.privacyLocation,
      privacyBasis: src.privacyBasis,
      privacyConsent: src.privacyConsent,
      privacyHarm: src.privacyHarm,
      likenessWho: src.likenessWho,
      likenessRelation: src.likenessRelation,
      likenessSelfOrAgent: src.likenessSelfOrAgent,
      likenessPermitted: src.likenessPermitted,
      likenessInfringement: src.likenessInfringement,
      copyrightWork: src.copyrightWork,
      copyrightBasis: src.copyrightBasis,
      copyrightSource: src.copyrightSource,
      copyrightPortion: src.copyrightPortion,
      copyrightLicensed: src.copyrightLicensed,
      deletedPeriodApprox: src.deletedPeriodApprox,
      rememberedTitle: src.rememberedTitle,
      rememberedAuthor: src.rememberedAuthor,
      rememberedBody: src.rememberedBody,
      rememberedPhrase: src.rememberedPhrase,
      discoveredAt: src.discoveredAt,
    },
    targetSnapshot: src.targetSnapshot,
    deletedEvidenceId: src.deletedEvidenceId,
    operatorNotes: src.operatorNotes,
    supplementNote: src.supplementNote,
    rejectionReason: src.rejectionReason,
    politicalProtection: core.POLITICAL_PROTECTION,
    highRiskPrivacy: !!src.highRiskPrivacy,
    isFormal: !!src.isFormal,
    events: (extras && extras.events) || [],
    objections: ((extras && extras.objections) || []).map(function (o) {
      return {
        id: o.id,
        ground: o.ground,
        explanation: o.explanation,
        createdAt: o.createdAt,
      };
    }),
    linkedEvidence: extras && extras.evidence ? extras.evidence : null,
  };
}

async function getAdmin(id) {
  const repo = requireRepo();
  const row = await repo.getRequest(id);
  if (!row) throw fail('RIGHTS_REQUEST_NOT_FOUND', 404);
  const events = await repo.listEvents(id);
  const objections = await repo.listObjections(id);
  let evidence = null;
  if (row.deletedEvidenceId && _retention && typeof _retention.getEvidence === 'function') {
    try { evidence = await _retention.getEvidence(row.deletedEvidenceId); } catch (_) {}
  }
  return mapAdminDetail(row, { events: events, objections: objections, evidence: evidence });
}

async function hideTarget(row) {
  if (!_board) return { hidden: false };
  const reason = core.BLIND_REASON;
  if (row.targetKind === 'POST' && row.postId && typeof _board.hidePost === 'function') {
    await _board.hidePost(row.postId, reason);
    return { hidden: true };
  }
  if (row.targetKind === 'COMMENT' && row.commentId && typeof _board.hideComment === 'function') {
    await _board.hideComment(row.commentId, reason);
    return { hidden: true };
  }
  return { hidden: false };
}

async function restoreTarget(row) {
  if (!_board) return { restored: false };
  if (row.targetKind === 'POST' && row.postId && typeof _board.restorePost === 'function') {
    await _board.restorePost(row.postId, core.BLIND_REASON);
    return { restored: true };
  }
  if (row.targetKind === 'COMMENT' && row.commentId && typeof _board.restoreComment === 'function') {
    await _board.restoreComment(row.commentId, core.BLIND_REASON);
    return { restored: true };
  }
  return { restored: false };
}

async function applyAdminAction(id, body, operatorUserId) {
  const repo = requireRepo();
  const row = await repo.getRequest(id);
  if (!row) throw fail('RIGHTS_REQUEST_NOT_FOUND', 404);
  const action = String((body && body.action) || '').toUpperCase();
  const now = nowIso();
  const note = core.trimText((body && (body.note || body.resolutionNote || body.operatorNotes)) || '');

  if (action === core.OPERATOR_ACTION.LINK_EVIDENCE) {
    const evidenceId = body && body.evidenceId;
    if (!evidenceId) throw fail('EVIDENCE_ID_REQUIRED', 400);
    if (!row.isFormal && row.status !== core.STATUS.FORMAL_CASE) {
      throw fail('EVIDENCE_LINK_REQUIRES_FORMAL', 400);
    }
    let evidence = null;
    if (_retention && typeof _retention.getEvidence === 'function') {
      evidence = await _retention.getEvidence(evidenceId);
    }
    if (!evidence && _retention && typeof _retention.getEvidenceBySource === 'function') {
      evidence = await _retention.getEvidenceBySource(row.targetKind, row.postId || row.commentId);
    }
    if (!evidence) throw fail('EVIDENCE_NOT_FOUND', 404);
    const next = Object.assign({}, row, {
      deletedEvidenceId: evidence.id,
      isFormal: true,
      updatedAt: now,
      reviewedBy: operatorUserId || row.reviewedBy,
    });
    if (_retention && typeof _retention.extendEvidenceRetention === 'function') {
      const until = row.retentionUntil || core.retentionUntilFor(core.STATUS.COMPLETED, true, now);
      await _retention.extendEvidenceRetention(evidence.id, until);
    }
    const saved = await repo.updateRequest(row.id, next);
    await repo.insertEvent({
      requestId: row.id,
      actorKind: 'OPERATOR',
      actorUserId: operatorUserId || null,
      action: action,
      note: note || evidence.id,
    });
    return { ok: true, request: core.mapAdminList(saved), autoSanctioned: false };
  }

  const packed = core.applyOperatorAction(Object.assign({}, row, { operatorNotes: note || row.operatorNotes }), action, now);
  if (!packed.ok) throw fail(packed.error, 400);
  const next = packed.row;
  next.reviewedBy = operatorUserId || row.reviewedBy;
  if (note && action === core.OPERATOR_ACTION.REQUEST_SUPPLEMENT) next.supplementNote = note;
  if (note && action === core.OPERATOR_ACTION.REJECT_INTAKE) next.rejectionReason = note;
  if (note) next.operatorNotes = [row.operatorNotes, note].filter(Boolean).join('\n');

  if (action === core.OPERATOR_ACTION.TEMP_TAKEDOWN) {
    await hideTarget(next);
  }
  if (action === core.OPERATOR_ACTION.LIFT_TAKEDOWN) {
    await restoreTarget(row);
  }

  if (action === core.OPERATOR_ACTION.ABUSE_WARNING ||
      action === core.OPERATOR_ACTION.RESTRICT_30D ||
      action === core.OPERATOR_ACTION.RESTRICT_6M) {
    const targetUser = row.claimantUserId;
    if (!targetUser) throw fail('ABUSE_ACTION_REQUIRES_MEMBER', 400);
    const abuse = await repo.getAbuseState(targetUser);
    if (action === core.OPERATOR_ACTION.ABUSE_WARNING) {
      abuse.warningCount = (abuse.warningCount || 0) + 1;
      abuse.lastAbuseAt = now;
    } else {
      const kind = action === core.OPERATOR_ACTION.RESTRICT_30D
        ? core.ABUSE_RESTRICTION.DAYS_30
        : core.ABUSE_RESTRICTION.MONTHS_6;
      abuse.restrictionKind = kind;
      abuse.restrictedUntil = core.restrictionUntil(kind, now);
      abuse.lastAbuseAt = now;
    }
    await repo.upsertAbuseState(abuse);
  }

  let sanctionHandoff = null;
  if (action === core.OPERATOR_ACTION.SANCTION_REVIEW) {
    if (!row.targetAuthorUserId && !row.claimantUserId) {
      throw fail('SANCTION_REVIEW_USER_REQUIRED', 400);
    }
    const userId = body && body.sanctionUserId
      ? body.sanctionUserId
      : (row.claimantUserId || row.targetAuthorUserId);
    const sanctionAction = String((body && body.sanctionAction) || '').toUpperCase();
    if (sanctionAction === 'PERMANENT_BAN' && (body && body.confirmPermanent) !== true) {
      throw fail('PERMANENT_BAN_NOT_AUTOMATIC', 400);
    }
    if (_sanction && typeof _sanction.applyOperatorDirect === 'function' && sanctionAction) {
      sanctionHandoff = await _sanction.applyOperatorDirect({
        userId: userId,
        action: sanctionAction,
        operatorUserId: operatorUserId,
        reasonCode: 'RIGHTS_ABUSE_REVIEW',
      });
    } else {
      sanctionHandoff = { queued: true, automaticPermanentBan: false };
    }
  }

  const saved = await repo.updateRequest(row.id, next);
  await repo.insertEvent({
    requestId: row.id,
    actorKind: 'OPERATOR',
    actorUserId: operatorUserId || null,
    action: action,
    note: note || null,
  });
  return {
    ok: true,
    request: core.mapAdminList(saved),
    autoSanctioned: false,
    automaticPermanentBan: false,
    sanctionHandoff: sanctionHandoff,
  };
}

async function purgeExpired(now) {
  const repo = requireRepo();
  const n = await repo.deleteExpired(now || nowIso());
  return { ok: true, deleted: n };
}

module.exports = {
  setRepository: setRepository,
  setNow: setNow,
  setBoardAdapter: setBoardAdapter,
  setRetentionAdapter: setRetentionAdapter,
  setSanctionAdapter: setSanctionAdapter,
  submitRequest: submitRequest,
  listAuthorNotices: listAuthorNotices,
  submitObjection: submitObjection,
  listAdmin: listAdmin,
  getAdmin: getAdmin,
  applyAdminAction: applyAdminAction,
  purgeExpired: purgeExpired,
  core: core,
};
