'use strict';

const modCore = require('../shared/alien-moderation-core');
const reportCore = require('../shared/alien-report-moderation-core');
const mapper = require('./alien-moderation-mapper');
const memoryRepo = require('./alien-moderation-memory-repository');
const accessCore = require('../shared/alien-access-core');

let _repo = memoryRepo;
let _mode = 'LEGACY_LOCAL';
let _v1Enabled = false;
let _boardReportReader = null;
let _citizenshipWriter = null;
let _nowFn = function () { return new Date(); };

function setRepository(repo) {
  _repo = repo || memoryRepo;
}

function setDataMode(mode) {
  const m = String(mode || 'LEGACY_LOCAL').toUpperCase();
  if (m === 'API_OPERATIONAL') {
    _mode = 'LEGACY_LOCAL';
    return;
  }
  _mode = m === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL';
}

function getDataMode() {
  return _mode;
}

function setV1Enabled(enabled) {
  _v1Enabled = !!enabled;
  if (_repo && typeof _repo.setPersistEnabled === 'function') {
    _repo.setPersistEnabled(_v1Enabled);
  }
}

function isActivated() {
  return _v1Enabled;
}

function isAutoDecisionEnabled() {
  return _v1Enabled;
}

function setBoardReportReader(reader) {
  _boardReportReader = reader;
}

function setCitizenshipWriter(writer) {
  _citizenshipWriter = writer;
}

function setNow(fn) {
  _nowFn = typeof fn === 'function' ? fn : function () { return new Date(); };
}

function cycleKeyFromState(state) {
  if (!state) return '0';
  return String(state.strikeCount || 0) + ':' + String(state.lastReturnedAt || state.cycleStartAt || '0');
}

async function getFullModerationState(userId) {
  return _repo.getModerationState(userId);
}

async function getModerationState(userId, audience) {
  const state = await _repo.getModerationState(userId);
  if (audience === 'operator') return mapper.mapStateForOperator(state);
  if (audience === 'public') return mapper.mapStateForPublic(state);
  if (audience === 'full') return state;
  return mapper.mapStateForSelf(state);
}

async function getAccessContext(userId) {
  const state = await _repo.getModerationState(userId);
  return accessCore.getAlienUserContextFromStatus({
    userId,
    status: (state && state.status) || modCore.STATUS.EARTH,
  });
}

async function listModerationEvents(userId, paging) {
  return _repo.listModerationEvents(userId, paging);
}

async function appendModerationSignal(signal) {
  if (_mode === 'API_OPERATIONAL') {
    return { ok: false, error: 'ALIEN_OPERATIONAL_FORBIDDEN' };
  }
  if (_mode === 'API_DRY_RUN') {
    return { ok: true, dryRun: true, signal: signal || null, note: 'NO_WRITE' };
  }
  return _repo.appendModerationSignal(signal);
}

async function planAlienTransfer(input) {
  return _repo.planAlienTransfer(input);
}

async function persistAlienTransferPlan(plan) {
  if (!_v1Enabled) {
    return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'REAL_TRANSFER_FORBIDDEN' };
  }
  const saved = await _repo.persistAlienTransferPlan(plan);
  if (saved && saved.ok && !saved.duplicate && _citizenshipWriter && typeof _citizenshipWriter.setCitizenship === 'function') {
    await _citizenshipWriter.setCitizenship({
      userId: plan.userId,
      citizenshipStatus: reportCore.CITIZENSHIP.ALIEN,
      exileStrikeCount: plan.strikeAfter,
      preserveTerritory: true,
    });
  }
  return saved;
}

async function planAlienReturn(input) {
  return _repo.planAlienReturn(input);
}

async function persistAlienReturnPlan(plan) {
  if (!_v1Enabled) {
    return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'REAL_RETURN_FORBIDDEN' };
  }
  const saved = await _repo.persistAlienReturnPlan(plan);
  if (saved && saved.ok && _citizenshipWriter && typeof _citizenshipWriter.setCitizenship === 'function') {
    await _citizenshipWriter.setCitizenship({
      userId: plan.userId,
      citizenshipStatus: reportCore.CITIZENSHIP.EARTH,
      preserveTerritory: true,
    });
  }
  return saved;
}

async function markReturnEligible(input) {
  if (!_v1Enabled) return { ok: false, error: 'ALIEN_PERSIST_DISABLED' };
  return _repo.markReturnEligible(input);
}

async function listInbox(userId) {
  if (!_repo.listNotifications) return [];
  return _repo.listNotifications(userId);
}

async function readReportsForUser(userId) {
  if (!_boardReportReader || typeof _boardReportReader.listReportsByTargetAuthor !== 'function') {
    return [];
  }
  return _boardReportReader.listReportsByTargetAuthor(userId);
}

async function applyTransfer(params) {
  const src = params || {};
  const state = await _repo.getModerationState(src.userId);
  const apply = reportCore.buildTransferApplyInput({
    userId: src.userId,
    strikeBefore: state && state.strikeCount ? state.strikeCount : 0,
    enteredAt: src.enteredAt || _nowFn().toISOString(),
    previousStatus: state && state.status,
    earthTerritory: (state && state.earthTerritory) || src.earthTerritory || 'CENTRAL',
    transferReason: src.transferReason,
    sourceId: src.sourceId,
    sourceType: src.sourceType,
    reasonCodes: src.reasonCodes,
  });
  if (!apply.ok) return apply;
  const saved = await persistAlienTransferPlan(apply);
  if (!saved.ok) return saved;
  if (!saved.duplicate && _repo.issueNotification) {
    await _repo.issueNotification({
      userId: src.userId,
      type: 'alien_move',
      title: '외계행성 이동',
      message: reportCore.TRANSFER_MESSAGE,
      dedupeKey: reportCore.transferDedupeKey(src.sourceId || ('trip:' + apply.strikeAfter)),
    });
  }
  return {
    ok: true,
    duplicate: !!saved.duplicate,
    transfer: apply,
    state: saved.state,
    event: saved.event || null,
  };
}

async function issueCycleWarning(userId, cycleKey) {
  if (_repo.hasWarningForCycle && await _repo.hasWarningForCycle(userId, cycleKey)) {
    return { ok: true, duplicate: true, warningIssued: false };
  }
  const dedupeKey = reportCore.warningDedupeKey(userId, cycleKey);
  const noti = await _repo.issueNotification({
    userId: userId,
    type: 'alien_warn',
    title: '외계행성 경고',
    message: reportCore.WARNING_MESSAGE,
    dedupeKey: dedupeKey,
  });
  if (_repo.findEventByDedupe && !_repo.findEventByDedupe(dedupeKey) && typeof _repo.listModerationEvents === 'function') {
    const store = _repo._getStore && _repo._getStore();
    if (store && Array.isArray(store.events)) {
      store.events.push({
        id: 'evt_warn_' + store.events.length,
        userId: userId,
        eventType: modCore.EVENT_TYPE.WARNING_ISSUED,
        dedupeKey: dedupeKey,
        createdAt: _nowFn().toISOString(),
      });
    }
  }
  return {
    ok: true,
    duplicate: !!(noti && noti.duplicate),
    warningIssued: !(noti && noti.duplicate),
    notification: noti && noti.notification,
  };
}

async function onReportCreated(report) {
  if (!_v1Enabled) {
    return { ok: true, skipped: true, reason: 'ALIEN_MODERATION_V1_DISABLED' };
  }
  const row = report || {};
  const targetUserId = row.targetAuthorUserId;
  if (!targetUserId) return { ok: false, error: 'TARGET_USER_MISSING' };

  const classification = reportCore.classifyReportReason(row.reasonCode);
  if (classification === reportCore.CLASSIFICATION.OTHER) {
    return {
      ok: true,
      classification: classification,
      autoTransfer: false,
      action: 'ADMIN_REVIEW',
    };
  }
  if (classification !== reportCore.CLASSIFICATION.SIMPLE) {
    return { ok: true, classification: classification, action: 'NONE' };
  }

  const state = await _repo.getModerationState(targetUserId);
  const reports = await readReportsForUser(targetUserId);
  if (row && row.id && !reports.some(function (r) { return r && r.id === row.id; })) {
    reports.push(row);
  }
  const evalResult = reportCore.evaluateSimpleReportCycle({
    targetUserId: targetUserId,
    reports: reports,
    cycleStartAt: state && (state.lastReturnedAt || state.cycleStartAt),
    citizenshipStatus: state && state.citizenshipStatus,
    status: state && state.status,
    warningAlreadyIssued: await (_repo.hasWarningForCycle
      ? _repo.hasWarningForCycle(targetUserId, cycleKeyFromState(state))
      : Promise.resolve(false)),
    includeFixture: false,
  });

  if (evalResult.alreadyAlien) {
    return {
      ok: true,
      classification: classification,
      simpleCount: evalResult.simpleCount,
      action: 'NONE',
      duplicate: true,
      alreadyAlien: true,
    };
  }

  if (evalResult.action === 'WARN') {
    const warned = await issueCycleWarning(targetUserId, cycleKeyFromState(state));
    return {
      ok: true,
      classification: classification,
      simpleCount: evalResult.simpleCount,
      action: 'WARN',
      warningIssued: warned.warningIssued,
      warningDuplicate: warned.duplicate,
      notification: warned.notification || null,
    };
  }

  if (evalResult.action === 'TRANSFER') {
    const transferred = await applyTransfer({
      userId: targetUserId,
      transferReason: reportCore.TRANSFER_REASON.AUTO_SIMPLE_REPORT_THRESHOLD,
      sourceId: row.id,
      sourceType: 'SIMPLE_REPORT',
      earthTerritory: state && state.earthTerritory,
      reasonCodes: [row.reasonCode],
    });
    return {
      ok: true,
      classification: classification,
      simpleCount: evalResult.simpleCount,
      action: 'TRANSFER',
      duplicate: !!transferred.duplicate,
      citizenshipStatus: reportCore.CITIZENSHIP.ALIEN,
      strikeCount: transferred.transfer && transferred.transfer.strikeAfter,
      returnPolicy: transferred.transfer && transferred.transfer.returnPolicy,
      durationDays: transferred.transfer && transferred.transfer.durationDays,
      state: transferred.state,
    };
  }

  return {
    ok: true,
    classification: classification,
    simpleCount: evalResult.simpleCount,
    action: 'NONE',
  };
}

async function applyAdminReportAction(report, action, actorUserId) {
  if (!_v1Enabled) return { ok: false, error: 'ALIEN_MODERATION_V1_DISABLED' };
  const act = String(action || '').toUpperCase();
  if (act === reportCore.ADMIN_ACTION.NONE || act === reportCore.ADMIN_ACTION.NORMAL) {
    return { ok: true, action: act, autoTransfer: false };
  }
  if (act !== reportCore.ADMIN_ACTION.IMMEDIATE_ALIEN) {
    return { ok: false, error: 'ADMIN_ACTION_INVALID' };
  }
  const targetUserId = report && report.targetAuthorUserId;
  if (!targetUserId) return { ok: false, error: 'TARGET_USER_MISSING' };
  const state = await _repo.getModerationState(targetUserId);
  const transferred = await applyTransfer({
    userId: targetUserId,
    transferReason: reportCore.TRANSFER_REASON.ADMIN_IMMEDIATE_ALIEN,
    sourceId: report && report.id,
    sourceType: 'ADMIN',
    earthTerritory: state && state.earthTerritory,
    reasonCodes: [report && report.reasonCode].filter(Boolean),
  });
  void actorUserId;
  return {
    ok: true,
    action: act,
    duplicate: !!transferred.duplicate,
    citizenshipStatus: reportCore.CITIZENSHIP.ALIEN,
    strikeCount: transferred.transfer && transferred.transfer.strikeAfter,
    returnPolicy: transferred.transfer && transferred.transfer.returnPolicy,
    durationDays: transferred.transfer && transferred.transfer.durationDays,
    transferReason: reportCore.TRANSFER_REASON.ADMIN_IMMEDIATE_ALIEN,
    state: transferred.state,
  };
}

async function returnToEarth(userId, options) {
  if (!_v1Enabled) return { ok: false, error: 'ALIEN_MODERATION_V1_DISABLED' };
  const opts = options || {};
  const state = await _repo.getModerationState(userId);
  if (!state || state.citizenshipStatus !== reportCore.CITIZENSHIP.ALIEN) {
    return { ok: false, error: 'NOT_ALIEN' };
  }
  const policy = reportCore.resolveReturnPolicy(state.strikeCount);
  if (policy && policy.adminReturnOnly && !opts.operatorForced) {
    return { ok: false, error: 'SEASON_END_ADMIN_ONLY', returnPolicy: 'SEASON_END' };
  }
  const now = opts.now || _nowFn().toISOString();
  const plan = await planAlienReturn({
    userId: userId,
    strikeCount: state.strikeCount,
    enteredAt: state.enteredAt,
    seasonEndAt: opts.seasonEndAt || null,
    now: now,
    operatorForced: !!opts.operatorForced,
    operatorHold: !!state.operatorHold,
    previousStatus: state.status,
  });
  if (!plan.ok) return plan;
  if (state.returnPolicy === 'SEASON_END' && !opts.operatorForced) {
    return { ok: false, error: 'SEASON_END_ADMIN_ONLY', returnPolicy: 'SEASON_END' };
  }
  plan.returnedAt = now;
  return persistAlienReturnPlan(plan);
}

async function healthCheck() {
  const repoHealth = await _repo.healthCheck();
  return {
    mode: _mode,
    activated: isActivated(),
    autoDecisionEnabled: isAutoDecisionEnabled(),
    schedulerEnabled: false,
    repository: repoHealth,
  };
}

module.exports = {
  setRepository,
  setDataMode,
  getDataMode,
  setV1Enabled,
  isActivated,
  isAutoDecisionEnabled,
  setBoardReportReader,
  setCitizenshipWriter,
  setNow,
  getModerationState,
  getFullModerationState,
  getAccessContext,
  listModerationEvents,
  appendModerationSignal,
  planAlienTransfer,
  persistAlienTransferPlan,
  planAlienReturn,
  persistAlienReturnPlan,
  markReturnEligible,
  listInbox,
  onReportCreated,
  applyAdminReportAction,
  returnToEarth,
  healthCheck,
};
