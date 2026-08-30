'use strict';

const crypto = require('crypto');
const core = require('../shared/rights-infringement-core');
const attachmentCore = require('../shared/rights-attachment-core');

let _repo = null;
let _now = function () { return new Date().toISOString(); };
let _board = null;
let _retention = null;
let _sanction = null;
let _emailVerify = null;

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

function setEmailVerify(adapter) {
  _emailVerify = adapter || null;
}

function isGuestEmailReady() {
  return !!(!_emailVerify ? false : typeof _emailVerify.isMailerConfigured === 'function' && _emailVerify.isMailerConfigured());
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

async function collectAttachments(raw, ctx) {
  const src = raw || {};
  const out = [];
  if (Array.isArray(src.attachments)) {
    src.attachments.forEach(function (item) { out.push(item); });
  }
  const stagingIds = Array.isArray(src.stagingIds) ? src.stagingIds : [];
  if (stagingIds.length && _repo && typeof _repo.getStaging === 'function') {
    for (let i = 0; i < stagingIds.length; i++) {
      const row = await _repo.getStaging(stagingIds[i]);
      if (!row) throw fail('ATTACHMENT_STAGING_NOT_FOUND', 400);
      if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
        throw fail('ATTACHMENT_STAGING_EXPIRED', 400);
      }
      if (ctx.userId && row.uploadedByUserId && String(row.uploadedByUserId) !== String(ctx.userId)) {
        throw fail('ATTACHMENT_STAGING_FORBIDDEN', 403);
      }
      out.push({
        filename: row.filename,
        bytes: row.bytes || row.fileBytes,
        contentType: row.contentType,
      });
    }
  }
  return out;
}

async function persistAttachments(requestId, items, userId) {
  if (!_repo || typeof _repo.insertAttachment !== 'function') return [];
  const saved = [];
  for (let i = 0; i < items.length; i++) {
    const row = await _repo.insertAttachment({
      requestId: requestId,
      filename: items[i].filename,
      contentType: items[i].contentType,
      kind: items[i].kind,
      byteSize: items[i].byteSize,
      sha256: items[i].sha256,
      bytes: items[i].bytes,
      uploadedByUserId: userId || null,
      createdAt: nowIso(),
    });
    saved.push(attachmentCore.mapPublicMeta(row));
  }
  return saved;
}

async function consumeStaging(ids) {
  if (!Array.isArray(ids) || !_repo || typeof _repo.deleteStaging !== 'function') return;
  for (let i = 0; i < ids.length; i++) {
    try { await _repo.deleteStaging(ids[i]); } catch (_) {}
  }
}

async function submitRequest(input, context) {
  const ctx = context || {};
  const repo = requireRepo();
  const now = nowIso();
  const raw = Object.assign({}, input || {}, {
    claimantUserId: ctx.userId || input.claimantUserId || null,
  });

  const collected = await collectAttachments(raw, ctx);
  raw.attachments = collected;
  raw.attachmentCount = collected.length;

  const check = core.validateSubmission(raw);
  if (!check.ok) {
    throw fail(check.errors[0] || 'RIGHTS_VALIDATION_FAILED', 400);
  }
  const files = attachmentCore.validateList(collected);
  if (!files.ok) throw fail(files.error || 'EVIDENCE_FILE_REQUIRED', 400);

  if (!ctx.userId) {
    if (!isGuestEmailReady()) {
      throw fail('GUEST_VERIFICATION_UNAVAILABLE', 503);
    }
    try {
      _emailVerify.assertVerified({
        email: raw.claimantEmail,
        proof: raw.emailProof,
      });
    } catch (e) {
      if (e && e.code) throw e;
      throw fail('EMAIL_NOT_VERIFIED', 400);
    }
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
  await persistAttachments(saved.id, files.items, src.claimantUserId);
  await consumeStaging(raw.stagingIds);
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
    claimantIsMember: !!src.claimantUserId,
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
    rejectionCode: src.rejectionCode || null,
    publicRejectionNote: src.publicRejectionNote || null,
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
    attachments: extras && extras.attachments ? extras.attachments : [],
    confirmedAbuseCount: extras && extras.confirmedAbuseCount != null ? extras.confirmedAbuseCount : 0,
    claimantRequestCount: extras && extras.claimantRequestCount != null ? extras.claimantRequestCount : 0,
  };
}

async function getAdmin(id) {
  const repo = requireRepo();
  const row = await repo.getRequest(id);
  if (!row) throw fail('RIGHTS_REQUEST_NOT_FOUND', 404);
  const events = await repo.listEvents(id);
  const objections = await repo.listObjections(id);
  let attachments = [];
  if (typeof repo.listAttachments === 'function') {
    const rows = await repo.listAttachments(id);
    attachments = (rows || []).map(attachmentCore.mapPublicMeta);
  }
  let confirmedAbuseCount = 0;
  let claimantRequestCount = 0;
  if (row.claimantUserId) {
    try {
      const abuse = await repo.getAbuseState(row.claimantUserId);
      confirmedAbuseCount = Number(abuse && abuse.warningCount ? abuse.warningCount : 0);
    } catch (_) {}
    try {
      const all = await repo.listRequests();
      claimantRequestCount = (all || []).filter(function (r) {
        return String(r.claimantUserId || '') === String(row.claimantUserId);
      }).length;
    } catch (_) {}
  }
  let evidence = null;
  if (row.deletedEvidenceId && _retention && typeof _retention.getEvidence === 'function') {
    try { evidence = await _retention.getEvidence(row.deletedEvidenceId); } catch (_) {}
  }
  return mapAdminDetail(row, {
    events: events,
    objections: objections,
    evidence: evidence,
    attachments: attachments,
    confirmedAbuseCount: confirmedAbuseCount,
    claimantRequestCount: claimantRequestCount,
  });
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
  if (action === core.OPERATOR_ACTION.REJECT_INTAKE) {
    const code = String((body && body.rejectionCode) || '').toUpperCase();
    if (!core.REJECTION_CODE[code]) throw fail('REJECTION_CODE_REQUIRED', 400);
    next.rejectionCode = code;
    next.publicRejectionNote = core.trimText((body && body.publicRejectionNote) || '') || core.REJECTION_CODE_LABEL[code];
    next.rejectionReason = note || next.publicRejectionNote;
  }
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
  if (typeof repo.deleteExpiredStaging === 'function') {
    try { await repo.deleteExpiredStaging(now || nowIso()); } catch (_) {}
  }
  const n = await repo.deleteExpired(now || nowIso());
  return { ok: true, deleted: n };
}

async function createStaging(input, userId) {
  if (!userId) throw fail('GUEST_VERIFICATION_UNAVAILABLE', 503);
  const checked = attachmentCore.validateOne(input || {});
  if (!checked.ok) throw fail(checked.error || 'ATTACHMENT_TYPE_BLOCKED', 400);
  const repo = requireRepo();
  if (typeof repo.insertStaging !== 'function') throw fail('ATTACHMENT_STORE_UNAVAILABLE', 503);
  const now = nowIso();
  const row = await repo.insertStaging({
    id: uuid(),
    filename: checked.filename,
    contentType: checked.contentType,
    kind: checked.kind,
    byteSize: checked.byteSize,
    sha256: checked.sha256,
    bytes: checked.bytes,
    uploadedByUserId: userId,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + attachmentCore.STAGING_TTL_MS).toISOString(),
  });
  return { ok: true, staging: { id: row.id, filename: row.filename, byteSize: row.byteSize, contentType: row.contentType } };
}

async function getAttachmentForAdmin(requestId, attachmentId) {
  const repo = requireRepo();
  if (typeof repo.getAttachment !== 'function') throw fail('ATTACHMENT_STORE_UNAVAILABLE', 503);
  const row = await repo.getAttachment(attachmentId);
  if (!row || String(row.requestId) !== String(requestId)) throw fail('ATTACHMENT_NOT_FOUND', 404);
  return row;
}

async function getAttachmentForClaimant(userId, requestId, attachmentId) {
  if (!userId) throw fail('AUTH_REQUIRED', 401);
  const repo = requireRepo();
  const request = await repo.getRequest(requestId);
  if (!request) throw fail('RIGHTS_REQUEST_NOT_FOUND', 404);
  if (String(request.claimantUserId || '') !== String(userId)) throw fail('ATTACHMENT_FORBIDDEN', 403);
  return getAttachmentForAdmin(requestId, attachmentId);
}

module.exports = {
  setRepository: setRepository,
  setNow: setNow,
  setBoardAdapter: setBoardAdapter,
  setRetentionAdapter: setRetentionAdapter,
  setSanctionAdapter: setSanctionAdapter,
  setEmailVerify: setEmailVerify,
  isGuestEmailReady: isGuestEmailReady,
  submitRequest: submitRequest,
  listAuthorNotices: listAuthorNotices,
  submitObjection: submitObjection,
  listAdmin: listAdmin,
  getAdmin: getAdmin,
  applyAdminAction: applyAdminAction,
  purgeExpired: purgeExpired,
  createStaging: createStaging,
  getAttachmentForAdmin: getAttachmentForAdmin,
  getAttachmentForClaimant: getAttachmentForClaimant,
  core: core,
};
