'use strict';

const core = require('../shared/user-sanction-core');
const reviewCore = require('../shared/board-report-review-core');
const reportCore = require('../shared/alien-report-moderation-core');
const memoryRepo = require('./alien-moderation-memory-repository');

let _repo = memoryRepo;
let _boardHide = null;
let _boardReportReader = null;
let _nowFn = function () { return new Date(); };

function setRepository(repo) {
  _repo = repo || memoryRepo;
}

function setBoardHider(fn) {
  _boardHide = typeof fn === 'function' ? fn : null;
}

function setBoardReportReader(reader) {
  _boardReportReader = reader || null;
}

function setNow(fn) {
  _nowFn = typeof fn === 'function' ? fn : function () { return new Date(); };
}

function nowIso() {
  return _nowFn().toISOString();
}

function makeError(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 403;
  return err;
}

async function readReports(userId) {
  const reader = _boardReportReader || _repo;
  if (reader && typeof reader.listReportsByTargetAuthor === 'function') {
    return reader.listReportsByTargetAuthor(userId);
  }
  return [];
}

function isAlienState(state) {
  return !!(state && (
    state.citizenshipStatus === reportCore.CITIZENSHIP.ALIEN
    || state.status === 'ALIEN_ACTIVE'
  ));
}

function noticeType(sanctionType, v1AlienWarn) {
  if (v1AlienWarn && sanctionType === core.SANCTION_TYPE.WARNING) return 'alien_warn';
  const map = {
    WARNING: 'sanction_warning',
    FINAL_WARNING: 'sanction_final_warning',
    ALIEN_TRANSFER: 'sanction_alien_transfer',
    WRITE_RESTRICT_24H: 'sanction_write_restrict',
    ACCOUNT_RESTRICT_7D: 'sanction_account_restrict',
    ACCOUNT_RESTRICT_30D: 'sanction_account_restrict',
    TEMP_SUSPEND: 'sanction_temp_suspend',
    PERMANENT_BAN: 'sanction_permanent_ban',
    PERMANENT_REVIEW: 'sanction_permanent_review',
  };
  return map[sanctionType] || 'sanction_notice';
}

function noticeTitle(sanctionType) {
  const map = {
    WARNING: '일반 경고',
    FINAL_WARNING: '최종 경고',
    ALIEN_TRANSFER: '외계행성 이동',
    WRITE_RESTRICT_24H: '24시간 작성 제한',
    ACCOUNT_RESTRICT_7D: '7일 계정 이용 제한',
    ACCOUNT_RESTRICT_30D: '30일 계정 이용 제한',
    TEMP_SUSPEND: '임시 활동중지',
    PERMANENT_BAN: '영구정지',
    PERMANENT_REVIEW: '영구정지 검토',
  };
  return map[sanctionType] || '제재 안내';
}

async function countsForUser(userId, state) {
  const reports = await readReports(userId);
  const alreadyAlien = isAlienState(state);
  const earthCycle = alreadyAlien
    ? (state && state.enteredAt)
    : (state && (state.lastReturnedAt || state.cycleStartAt));
  const conductEarth = reviewCore.countConfirmedConductBehaviors(reports, {
    targetUserId: userId,
    cycleStartAt: alreadyAlien ? null : earthCycle,
  });
  const conductAlien = alreadyAlien
    ? reviewCore.countConfirmedConductBehaviors(reports, {
      targetUserId: userId,
      cycleStartAt: state && state.enteredAt,
    })
    : { count: 0, behaviors: [] };
  const harm = reviewCore.countConfirmedHarmBehaviors
    ? reviewCore.countConfirmedHarmBehaviors(reports, { targetUserId: userId })
    : core.countConfirmedByClass(reports, {
      targetUserId: userId,
      sanctionClass: reviewCore.SANCTION_CLASS.SERVICE_HARM,
    });
  return {
    reports: reports,
    alreadyAlien: alreadyAlien,
    conductCount: alreadyAlien ? conductEarth.count : conductEarth.count,
    alienConductCount: conductAlien.count,
    harmCount: harm.count,
  };
}

async function applyRecord(userId, chosen, context) {
  const ctx = context || {};
  const type = chosen.type;
  const schedule = core.buildSchedule(type, nowIso(), ctx.endsAt);
  const pendingReview = type === core.SANCTION_TYPE.PERMANENT_REVIEW
    || !!ctx.pendingPermanentReview;
  const metadata = core.stripPolitical({
    sanctionType: type,
    ladder: chosen.ladder,
    behaviorKey: ctx.behaviorKey || null,
    reasonCode: ctx.reasonCode || null,
    severeCode: ctx.severeCode || null,
    operatorUserId: ctx.operatorUserId || null,
    decidedAt: schedule.startsAt,
  });
  if (_repo && typeof _repo.persistUserSanction === 'function') {
    await _repo.persistUserSanction({
      userId: userId,
      sanctionType: type,
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
      permanent: schedule.permanent,
      status: schedule.status,
      reasonCode: ctx.reasonCode || null,
      behaviorKey: ctx.behaviorKey || null,
      ladder: chosen.ladder || null,
      pendingPermanentReview: pendingReview,
      eventType: core.eventTypeFor(type),
      sourceType: ctx.sourceType || 'REPORT_REVIEW',
      sourceId: ctx.behaviorKey || null,
      dedupeKey: ctx.dedupeKey || ('SANCTION:' + type + ':' + userId + ':' + (ctx.behaviorKey || schedule.startsAt)),
      metadata: metadata,
      operatorUserId: ctx.operatorUserId || null,
    });
  }
  const publicNotice = core.toPublicNotice({
    currentSanctionType: type,
    currentSanctionStartsAt: schedule.startsAt,
    currentSanctionEndsAt: schedule.endsAt,
    currentSanctionPermanent: schedule.permanent,
    currentSanctionStatus: schedule.status,
    currentSanctionReasonCode: ctx.reasonCode || null,
    currentSanctionBehaviorKey: ctx.behaviorKey || null,
    currentSanctionLadder: chosen.ladder,
    pendingPermanentReview: pendingReview,
    sanctionClass: ctx.sanctionClass,
  });
  let notification = null;
  if (type !== core.SANCTION_TYPE.NONE && _repo && typeof _repo.issueNotification === 'function') {
    const v1Warn = !!ctx.v1AlienWarn;
    const issued = await _repo.issueNotification({
      userId: userId,
      type: noticeType(type, v1Warn),
      title: noticeTitle(type),
      message: publicNotice.userMessage,
      dedupeKey: ctx.dedupeKey || ('SANCTION_NOTI:' + type + ':' + userId + ':' + (ctx.behaviorKey || '')),
    });
    notification = issued && issued.notification;
  }
  if (chosen.hideContent && ctx.behaviorKey && _boardHide) {
    try { await _boardHide(ctx.behaviorKey); } catch (_) {}
  }
  const state = _repo.getModerationState ? await _repo.getModerationState(userId) : null;
  return {
    ok: true,
    applied: type !== core.SANCTION_TYPE.NONE,
    action: type,
    sanctionType: type,
    ladder: chosen.ladder,
    alienForbidden: !!chosen.alienForbidden,
    hideContent: !!chosen.hideContent,
    publicNotice: publicNotice,
    notification: notification,
    pendingPermanentReview: pendingReview,
    autoPermanentBan: false,
    state: state,
    schedule: schedule,
  };
}

async function applyFromBehaviorReview(input) {
  const src = core.stripPolitical(input || {});
  if (!reviewCore.isConfirmedViolation({ status: src.status, resolutionNote: src.resolutionNote })) {
    return { ok: true, applied: false, action: 'NONE', autoSanction: false };
  }
  const userId = src.targetAuthorUserId;
  if (!userId) return { ok: false, error: 'TARGET_USER_MISSING' };
  const state = _repo.getModerationState ? await _repo.getModerationState(userId) : null;
  const counts = await countsForUser(userId, state);
  const sanctionClass = src.sanctionClass || reviewCore.classifySanctionClass(src.primaryReasonCode);
  if (state && state.lastSanctionedBehaviorKey && src.behaviorKey
    && state.lastSanctionedBehaviorKey === src.behaviorKey
    && (!src.operatorSanction || String(src.operatorSanction).toUpperCase() === 'AUTO')) {
    return {
      ok: true,
      applied: false,
      action: 'NONE',
      duplicate: true,
      sanctionType: state.currentSanctionType || 'NONE',
      confirmedConductCount: counts.conductCount,
      harmCount: counts.harmCount,
    };
  }

  const chosen = core.resolveChosen({
    sanctionClass: sanctionClass,
    conductCount: counts.alreadyAlien ? 0 : counts.conductCount,
    alienConductCount: counts.alreadyAlien ? counts.alienConductCount : 0,
    harmCount: counts.harmCount,
    alreadyAlien: counts.alreadyAlien,
    operatorSanction: src.operatorSanction,
    severeCode: src.severeCode,
    massHarm: src.massHarm,
  });
  if (chosen.ok === false) {
    return { ok: false, error: chosen.error, autoSanction: false };
  }
  if (chosen.type === core.SANCTION_TYPE.NONE) {
    return {
      ok: true,
      applied: false,
      action: 'NONE',
      autoSanction: false,
      reviewOnly: !!chosen.reviewOnly,
      sanctionClass: sanctionClass,
      confirmedConductCount: counts.conductCount,
      harmCount: counts.harmCount,
      alreadyAlien: counts.alreadyAlien,
    };
  }

  const result = await applyRecord(userId, chosen, {
    behaviorKey: src.behaviorKey,
    reasonCode: src.primaryReasonCode,
    sanctionClass: sanctionClass,
    severeCode: src.severeCode || null,
    operatorUserId: src.operatorUserId || null,
    v1AlienWarn: !!src.v1AlienWarn,
    pendingPermanentReview: chosen.type === core.SANCTION_TYPE.PERMANENT_REVIEW,
  });
  result.autoSanction = true;
  result.autoPermanentBan = false;
  result.sanctionClass = sanctionClass;
  result.confirmedConductCount = counts.conductCount;
  result.alienConductCount = counts.alienConductCount;
  result.harmCount = counts.harmCount;
  result.alreadyAlien = counts.alreadyAlien;
  result.alienEligible = chosen.type === core.SANCTION_TYPE.ALIEN_TRANSFER
    && core.canSelectAlien(sanctionClass, chosen.ladder, src.severeCode, src.massHarm);
  return result;
}

async function applyOperatorAction(input) {
  const src = core.stripPolitical(input || {});
  src.operatorSanction = src.operatorSanction || src.action;
  return applyFromBehaviorReview(src);
}

async function getPublicNotice(userId) {
  if (!userId) return null;
  const state = await _repo.getModerationState(userId);
  return core.toPublicNotice(state || {});
}

async function getState(userId) {
  if (!userId) return null;
  return _repo.getModerationState(userId);
}

async function assertAllows(userId, kind) {
  if (!userId) return { ok: true, allowed: true };
  const state = await _repo.getModerationState(userId);
  const check = core.assertAllows(state || {}, kind, _nowFn().getTime());
  if (!check.ok) throw makeError(check.error, 403);
  return check;
}

async function submitAppeal(input) {
  const src = input || {};
  const userId = src.userId;
  if (!userId) throw makeError('AUTH_REQUIRED', 401);
  const state = await _repo.getModerationState(userId);
  const type = state && state.currentSanctionType;
  if (!core.canAppealType(type)) throw makeError('SANCTION_APPEAL_NOT_ALLOWED', 400);
  const existing = typeof _repo.listSanctionAppeals === 'function'
    ? await _repo.listSanctionAppeals(userId)
    : [];
  const open = (existing || []).some(function (a) {
    return a.sanctionType === type && String(a.status || '').toUpperCase() === 'SUBMITTED';
  });
  if (open) throw makeError('SANCTION_APPEAL_ALREADY_SUBMITTED', 409);
  const body = String(src.body || '').trim();
  if (!body) throw makeError('SANCTION_APPEAL_BODY_REQUIRED', 400);
  return _repo.createSanctionAppeal({
    userId: userId,
    sanctionType: type,
    body: body,
    status: 'SUBMITTED',
  });
}

async function listAppeals(userId) {
  if (!_repo || typeof _repo.listSanctionAppeals !== 'function') return [];
  return _repo.listSanctionAppeals(userId);
}

async function resolveAppeal(input) {
  const src = input || {};
  const decision = String(src.decision || '').toUpperCase();
  if (decision !== core.APPEAL_DECISION.UPHELD
    && decision !== core.APPEAL_DECISION.SHORTENED
    && decision !== core.APPEAL_DECISION.RELEASED) {
    throw makeError('SANCTION_APPEAL_DECISION_INVALID', 400);
  }
  const updated = await _repo.updateSanctionAppeal(src.appealId, {
    status: decision,
    operatorReply: src.operatorReply || null,
    decidedAt: nowIso(),
    decidedBy: src.operatorUserId || null,
  });
  if (!updated.ok) throw makeError(updated.error || 'APPEAL_NOT_FOUND', 404);
  const appeal = updated.appeal;
  if (decision === core.APPEAL_DECISION.RELEASED) {
    await applyRecord(appeal.userId, { type: core.SANCTION_TYPE.NONE, ladder: null }, {
      behaviorKey: null,
      sourceType: 'OPERATOR',
    });
  } else if (decision === core.APPEAL_DECISION.SHORTENED) {
    const state = await _repo.getModerationState(appeal.userId);
    const type = state && state.currentSanctionType;
    const ms = core.durationMsFor(type);
    const shorter = ms ? Math.floor(ms / 2) : 24 * 60 * 60 * 1000;
    const endsAt = new Date(_nowFn().getTime() + shorter).toISOString();
    await applyRecord(appeal.userId, { type: type, ladder: state && state.currentSanctionLadder }, {
      behaviorKey: state && state.currentSanctionBehaviorKey,
      reasonCode: state && state.currentSanctionReasonCode,
      endsAt: endsAt,
      sourceType: 'OPERATOR',
      operatorUserId: src.operatorUserId,
    });
  }
  return updated;
}

module.exports = {
  setRepository,
  setBoardHider,
  setBoardReportReader,
  setNow,
  applyFromBehaviorReview,
  applyOperatorAction,
  applyRecord,
  getPublicNotice,
  getState,
  assertAllows,
  submitAppeal,
  listAppeals,
  resolveAppeal,
};
