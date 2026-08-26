'use strict';

const core = require('../shared/user-sanction-core');
const reviewCore = require('../shared/board-report-review-core');
const reportCore = require('../shared/alien-report-moderation-core');
const memoryRepo = require('./alien-moderation-memory-repository');
const retentionService = require('./retention-service');

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

function noticeTitle(sanctionType, transferred) {
  if (sanctionType === core.SANCTION_TYPE.ALIEN_TRANSFER && !transferred) {
    return '운영정책 위반 반복';
  }
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
  // 동일 위반행동(behaviorKey)당 제재 1회. 식별자 없는 순수 수동제재는 startsAt 기반(기존).
  let dedupeKey = ctx.dedupeKey || null;
  if (!dedupeKey) {
    if (ctx.behaviorKey && type !== core.SANCTION_TYPE.NONE) {
      dedupeKey = 'SANCTION_BEHAVIOR:' + userId + ':' + ctx.behaviorKey;
    } else {
      dedupeKey = 'SANCTION:' + type + ':' + userId + ':' + (ctx.behaviorKey || schedule.startsAt);
    }
  }
  if (_repo && typeof _repo.persistUserSanction === 'function') {
    const persisted = await _repo.persistUserSanction({
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
      eventType: type === core.SANCTION_TYPE.ALIEN_TRANSFER ? 'OPERATOR_ASSIGNED' : core.eventTypeFor(type),
      sourceType: ctx.sourceType || 'REPORT_REVIEW',
      sourceId: ctx.behaviorKey || null,
      dedupeKey: dedupeKey,
      metadata: metadata,
      operatorUserId: ctx.operatorUserId || null,
    });
    if (persisted && persisted.ok === false) {
      const code = persisted.error || 'SANCTION_PERSIST_FAILED';
      const status = code === 'SANCTION_BEHAVIOR_ALREADY_SANCTIONED' ? 409 : 500;
      throw makeError(code, status);
    }
  }
  const priorState = _repo.getModerationState ? await _repo.getModerationState(userId) : null;
  const transferDone = ctx.alienTransferCompleted === true || isAlienState(priorState);
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
    citizenshipStatus: priorState && priorState.citizenshipStatus,
    status: priorState && priorState.status,
    alienTransferCompleted: ctx.alienTransferCompleted === true,
  });
  let notification = null;
  if (type !== core.SANCTION_TYPE.NONE && _repo && typeof _repo.issueNotification === 'function') {
    const v1Warn = !!ctx.v1AlienWarn;
    const issued = await _repo.issueNotification({
      userId: userId,
      type: noticeType(type, v1Warn),
      title: noticeTitle(type, transferDone),
      message: publicNotice.userMessage,
      dedupeKey: 'SANCTION_NOTI:' + type + ':' + userId + ':' + (ctx.behaviorKey || ''),
    });
    notification = issued && issued.notification;
  }
  if (chosen.hideContent && ctx.behaviorKey && _boardHide) {
    try { await _boardHide(ctx.behaviorKey); } catch (_) {}
  }
  if (type !== core.SANCTION_TYPE.NONE) {
    try {
      await retentionService.recordSanction({
        userId: userId,
        sanctionType: type,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        permanent: schedule.permanent,
        reasonCode: ctx.reasonCode || null,
      });
    } catch (_) {}
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

async function wasBehaviorAlreadySanctioned(userId, behaviorKey, state) {
  const key = String(behaviorKey || '');
  if (!userId || !key) return false;
  if (state) {
    if (String(state.lastSanctionedBehaviorKey || '') === key) return true;
    if (String(state.currentSanctionBehaviorKey || '') === key) return true;
  }
  if (_repo && typeof _repo.listModerationEvents === 'function') {
    const listed = await _repo.listModerationEvents(userId, { limit: 100 });
    const items = (listed && listed.items) || [];
    for (let i = 0; i < items.length; i++) {
      if (String(items[i].sourceId || '') === key) return true;
      const dk = String((items[i].dedupeKey || (items[i].metadata && items[i].metadata.dedupeKey) || ''));
      if (dk === 'SANCTION_BEHAVIOR:' + userId + ':' + key) return true;
    }
  }
  return false;
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
  const opRaw = src.operatorSanction ? String(src.operatorSanction).toUpperCase() : 'AUTO';
  const isAuto = !src.operatorSanction || opRaw === 'AUTO';
  const already = await wasBehaviorAlreadySanctioned(userId, src.behaviorKey, state);
  if (already) {
    if (isAuto) {
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
    throw makeError('SANCTION_BEHAVIOR_ALREADY_SANCTIONED', 409);
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
    sourceType: isAuto ? 'REPORT_REVIEW' : 'OPERATOR',
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

async function applyOperatorDirect(input) {
  const src = core.stripPolitical(input || {});
  const userId = src.userId;
  if (!userId) throw makeError('USER_ID_REQUIRED', 400);
  const action = String(src.action || src.operatorSanction || '').toUpperCase();
  const behaviorKey = src.behaviorKey || src.sourceId || null;
  if (action === 'RELEASE' || action === 'NONE') {
    return applyRecord(userId, { type: core.SANCTION_TYPE.NONE, ladder: null }, {
      sourceType: 'OPERATOR',
      operatorUserId: src.operatorUserId || null,
      behaviorKey: null,
    });
  }
  const allowed = {
    WARNING: true,
    FINAL_WARNING: true,
    WRITE_RESTRICT_24H: true,
    ACCOUNT_RESTRICT_7D: true,
    ACCOUNT_RESTRICT_30D: true,
    TEMP_SUSPEND: true,
    PERMANENT_BAN: true,
  };
  if (!allowed[action]) throw makeError('OPERATOR_ACTION_INVALID', 400);
  if (behaviorKey) {
    const state = _repo.getModerationState ? await _repo.getModerationState(userId) : null;
    if (await wasBehaviorAlreadySanctioned(userId, behaviorKey, state)) {
      throw makeError('SANCTION_BEHAVIOR_ALREADY_SANCTIONED', 409);
    }
  }
  return applyRecord(userId, { type: action, ladder: src.ladder || null }, {
    sourceType: 'OPERATOR',
    operatorUserId: src.operatorUserId || null,
    reasonCode: src.reasonCode || 'OPERATOR',
    behaviorKey: behaviorKey,
  });
}

async function getPublicNotice(userId) {
  if (!userId) return null;
  try {
    const alienMod = require('./alien-moderation-service');
    if (typeof alienMod.ensureLazyAutoReturn === 'function') {
      await alienMod.ensureLazyAutoReturn(userId);
    }
  } catch (_) {}
  const state = await _repo.getModerationState(userId);
  return core.toPublicNotice(state || {});
}

async function getState(userId) {
  if (!userId) return null;
  return _repo.getModerationState(userId);
}

async function assertAllows(userId, kind) {
  if (!userId) return { ok: true, allowed: true };
  try {
    const alienMod = require('./alien-moderation-service');
    if (typeof alienMod.ensureLazyAutoReturn === 'function') {
      await alienMod.ensureLazyAutoReturn(userId);
    }
  } catch (_) {}
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

function publicAppeal(row) {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.userId,
    sanctionType: row.sanctionType,
    body: row.body,
    status: row.status,
    operatorReply: row.operatorReply,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt || null,
  };
}

async function listAppeals(userId) {
  if (!_repo || typeof _repo.listSanctionAppeals !== 'function') return [];
  return (await _repo.listSanctionAppeals(userId) || []).map(publicAppeal);
}

async function listAppealsAdmin() {
  if (!_repo || typeof _repo.listSanctionAppeals !== 'function') return [];
  return _repo.listSanctionAppeals(null);
}

async function listActiveSanctions() {
  if (!_repo || typeof _repo.listActiveSanctions !== 'function') return [];
  const rows = await _repo.listActiveSanctions();
  return (rows || []).map(function (st) {
    return Object.assign({ userId: st.userId }, core.toPublicNotice(st || {}));
  });
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
  if (!updated.ok) {
    if (updated.error === 'APPEAL_ALREADY_DECIDED') {
      throw makeError('APPEAL_ALREADY_DECIDED', 409);
    }
    throw makeError(updated.error || 'APPEAL_NOT_FOUND', 404);
  }
  const appeal = updated.appeal;
  if (decision === core.APPEAL_DECISION.RELEASED) {
    const appealedType = String(appeal.sanctionType || '').toUpperCase();
    // Clear only the appealed sanction slot. Do not auto-clear separate account restrictions.
    await applyRecord(appeal.userId, { type: core.SANCTION_TYPE.NONE, ladder: null }, {
      behaviorKey: null,
      sourceType: 'OPERATOR',
    });
    if (appealedType === core.SANCTION_TYPE.ALIEN_TRANSFER) {
      try {
        const alienMod = require('./alien-moderation-service');
        await alienMod.returnToEarth(appeal.userId, {
          operatorForced: true,
          operatorUserId: src.operatorUserId || null,
          operatorReason: 'APPEAL_RELEASED_ALIEN_TRANSFER',
        });
      } catch (_) {}
    }
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
      // 기간 단축은 동일 행동의 기존 제재 갱신 — 행동 중복키 사용 금지
      dedupeKey: 'SANCTION_SHORTEN:' + appeal.id + ':' + endsAt,
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
  applyOperatorDirect,
  applyRecord,
  getPublicNotice,
  getState,
  assertAllows,
  submitAppeal,
  listAppeals,
  listAppealsAdmin,
  listActiveSanctions,
  resolveAppeal,
};
