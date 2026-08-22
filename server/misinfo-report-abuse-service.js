'use strict';

const core = require('../shared/misinfo-report-core');

let _repo = null;
let _now = function () { return new Date().toISOString(); };

function setRepository(repo) {
  _repo = repo;
}

function setNow(fn) {
  _now = fn || _now;
}

function fail(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 400;
  return err;
}

function requireRepo() {
  if (!_repo) return null;
  return _repo;
}

async function getState(userId) {
  const repo = requireRepo();
  if (!repo || !userId) return core.emptyAbuseState(userId);
  try {
    return await repo.getState(userId);
  } catch (_) {
    return core.emptyAbuseState(userId);
  }
}

async function assertAllowed(userId) {
  if (!userId) return true;
  const state = await getState(userId);
  if (core.isRestrictionActive(state, _now())) {
    throw fail('MISINFO_REPORT_RESTRICTED', 403);
  }
  return true;
}

async function applyAction(userId, action, note) {
  if (!userId) throw fail('MISINFO_ABUSE_USER_REQUIRED', 400);
  const repo = requireRepo();
  if (!repo) throw fail('MISINFO_ABUSE_UNAVAILABLE', 503);
  const now = _now();
  const state = await getState(userId);
  const act = String(action || '').toUpperCase();
  if (act === core.ABUSE_ACTION.WARNING) {
    state.warningCount = (state.warningCount || 0) + 1;
    state.noticeReason = note || '허위정보 신고 악용이 확인되어 경고합니다.';
  } else if (act === core.ABUSE_ACTION.RESTRICT_30D) {
    state.restrictionKind = core.ABUSE_RESTRICTION.DAYS_30;
    state.restrictedUntil = core.restrictionUntil(core.ABUSE_RESTRICTION.DAYS_30, now);
    state.noticeReason = note || '허위정보 신고 악용 반복이 확인되어 30일 동안 허위정보 신고 기능을 제한합니다.';
    state.appealStatus = null;
  } else if (act === core.ABUSE_ACTION.RESTRICT_6M) {
    state.restrictionKind = core.ABUSE_RESTRICTION.MONTHS_6;
    state.restrictedUntil = core.restrictionUntil(core.ABUSE_RESTRICTION.MONTHS_6, now);
    state.noticeReason = note || '허위정보 신고 악용이 재확인되어 6개월 동안 허위정보 신고 기능을 제한합니다.';
    state.appealStatus = null;
  } else if (act === core.ABUSE_ACTION.SANCTION_REVIEW) {
    return {
      ok: true,
      queued: true,
      automaticPermanentBan: false,
      state: state,
    };
  } else {
    throw fail('MISINFO_ABUSE_ACTION_INVALID', 400);
  }
  state.updatedAt = now;
  const saved = await repo.upsertState(state);
  return {
    ok: true,
    automaticPermanentBan: false,
    state: core.publicRestrictionNotice(saved),
    warningCount: saved.warningCount,
  };
}

async function submitAppeal(userId, body) {
  if (!userId) throw fail('AUTH_REQUIRED', 401);
  const repo = requireRepo();
  if (!repo) throw fail('MISINFO_ABUSE_UNAVAILABLE', 503);
  const state = await getState(userId);
  if (!core.isRestrictionActive(state, _now())) throw fail('MISINFO_APPEAL_NOT_AVAILABLE', 400);
  if (String(state.appealStatus || '').toUpperCase() === 'SUBMITTED') {
    throw fail('MISINFO_APPEAL_ALREADY_OPEN', 409);
  }
  const text = core.trimText(body);
  if (core.meaningfulLen(text) < core.MIN.appeal) throw fail('MISINFO_APPEAL_TOO_SHORT', 400);
  state.appealStatus = 'SUBMITTED';
  state.appealBody = text.slice(0, 2000);
  state.appealReply = null;
  state.updatedAt = _now();
  const saved = await repo.upsertState(state);
  return { ok: true, appeal: { status: saved.appealStatus, createdAt: saved.updatedAt } };
}

async function decideAppeal(userId, decision, operatorReply) {
  const repo = requireRepo();
  if (!repo) throw fail('MISINFO_ABUSE_UNAVAILABLE', 503);
  const state = await getState(userId);
  const dec = String(decision || '').toUpperCase();
  if (dec === 'RELEASED') {
    state.restrictionKind = core.ABUSE_RESTRICTION.NONE;
    state.restrictedUntil = null;
    state.appealStatus = 'RELEASED';
  } else if (dec === 'SHORTENED') {
    state.restrictionKind = core.ABUSE_RESTRICTION.DAYS_30;
    state.restrictedUntil = core.restrictionUntil(core.ABUSE_RESTRICTION.DAYS_30, _now());
    state.appealStatus = 'SHORTENED';
  } else if (dec === 'UPHELD') {
    state.appealStatus = 'UPHELD';
  } else {
    throw fail('MISINFO_APPEAL_DECISION_INVALID', 400);
  }
  state.appealReply = core.trimText(operatorReply).slice(0, 1000) || null;
  state.updatedAt = _now();
  const saved = await repo.upsertState(state);
  return { ok: true, state: core.publicRestrictionNotice(saved) };
}

async function publicNotice(userId) {
  const state = await getState(userId);
  return { ok: true, restriction: core.publicRestrictionNotice(state) };
}

module.exports = {
  setRepository: setRepository,
  setNow: setNow,
  getState: getState,
  assertAllowed: assertAllowed,
  applyAction: applyAction,
  submitAppeal: submitAppeal,
  decideAppeal: decideAppeal,
  publicNotice: publicNotice,
  core: core,
};
