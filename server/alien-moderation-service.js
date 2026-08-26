'use strict';

const modCore = require('../shared/alien-moderation-core');
const reportCore = require('../shared/alien-report-moderation-core');
const reviewCore = require('../shared/board-report-review-core');
const mapper = require('./alien-moderation-mapper');
const memoryRepo = require('./alien-moderation-memory-repository');
const accessCore = require('../shared/alien-access-core');
const sanctionService = require('./user-sanction-service');
const sanctionCore = require('../shared/user-sanction-core');

let _repo = memoryRepo;
let _mode = 'LEGACY_LOCAL';
let _v1Enabled = false;
let _boardReportReader = null;
let _citizenshipWriter = null;
let _nowFn = function () { return new Date(); };
const _transferLocks = new Map();

function invalidatePopulationCacheSafe() {
  try {
    const pop = require('./territory-population-supabase-repository');
    if (pop && typeof pop.invalidateEarthCountCache === 'function') {
      pop.invalidateEarthCountCache();
    }
  } catch (_) {}
  try {
    const adapter = require('./territory-population-adapter');
    if (adapter && typeof adapter.invalidateEarthCountCache === 'function') {
      adapter.invalidateEarthCountCache();
    }
  } catch (_) {}
}

function withUserTransferLock(userId, fn) {
  const key = String(userId || '');
  const prev = _transferLocks.get(key) || Promise.resolve();
  const next = prev.catch(function () {}).then(fn);
  _transferLocks.set(key, next.then(function () {}, function () {}));
  return next;
}

function isPermanentBanActive(state, nowMs) {
  if (!state) return false;
  if (String(state.currentSanctionType || '').toUpperCase() !== 'PERMANENT_BAN') return false;
  return sanctionCore.isActiveRecord({
    currentSanctionType: 'PERMANENT_BAN',
    currentSanctionStatus: state.currentSanctionStatus || 'ACTIVE',
    currentSanctionEndsAt: state.currentSanctionEndsAt,
    currentSanctionPermanent: true,
  }, nowMs);
}

function setRepository(repo) {
  _repo = repo || memoryRepo;
  sanctionService.setRepository(_repo);
}

function setBoardReportReader(reader) {
  _boardReportReader = reader;
  sanctionService.setBoardReportReader(reader);
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

function setCitizenshipWriter(writer) {
  _citizenshipWriter = writer;
}

function setNow(fn) {
  _nowFn = typeof fn === 'function' ? fn : function () { return new Date(); };
  sanctionService.setNow(_nowFn);
}

function cycleKeyFromState(state) {
  if (!state) return '0';
  return String(state.strikeCount || 0) + ':' + String(state.lastReturnedAt || state.cycleStartAt || '0');
}

async function getFullModerationState(userId) {
  await ensureLazyAutoReturn(userId);
  return _repo.getModerationState(userId);
}

async function getModerationState(userId, audience) {
  await ensureLazyAutoReturn(userId);
  const state = await _repo.getModerationState(userId);
  if (audience === 'operator') return mapper.mapStateForOperator(state);
  if (audience === 'public') return mapper.mapStateForPublic(state);
  if (audience === 'full') return state;
  return mapper.mapStateForSelf(state);
}

async function getAccessContext(userId) {
  await ensureLazyAutoReturn(userId);
  const state = await _repo.getModerationState(userId);
  const citizenship = String((state && state.citizenshipStatus) || '').toUpperCase();
  let status = (state && state.status) || modCore.STATUS.EARTH;
  if (citizenship === reportCore.CITIZENSHIP.ALIEN && !modCore.isAlienRestrictedStatus(status)) {
    status = modCore.STATUS.ALIEN_ACTIVE;
  }
  return accessCore.getAlienUserContextFromStatus({
    userId,
    status,
    alienOriginTerritory: state && (state.alienOriginTerritory || state.earthTerritory),
  });
}

/**
 * On normal authenticated requests: auto-return trips 1–3 when past releaseEligibleAt.
 * Trip 4+ → mark RETURN_ELIGIBLE only (admin return required). Permanent ban blocks auto-return.
 */
async function ensureLazyAutoReturn(userId) {
  if (!_v1Enabled || !userId) return { ok: true, skipped: true };
  const state = await _repo.getModerationState(userId);
  if (!state) return { ok: true, skipped: true };
  const isAlien = state.citizenshipStatus === reportCore.CITIZENSHIP.ALIEN
    || modCore.isAlienRestrictedStatus(state.status);
  if (!isAlien) return { ok: true, skipped: true, reason: 'NOT_ALIEN' };
  if (state.operatorHold) return { ok: true, skipped: true, reason: 'OPERATOR_HOLD' };
  if (isPermanentBanActive(state, _nowFn().getTime())) {
    return { ok: true, skipped: true, reason: 'PERMANENT_BAN' };
  }
  const nowIso = _nowFn().toISOString();
  const release = modCore.calculateAlienReleaseEligibility({
    strikeCount: state.strikeCount,
    enteredAt: state.enteredAt,
    seasonEndAt: null,
    now: nowIso,
    returnPolicy: state.returnPolicy,
  });
  if (!release.available || release.returnStatus !== modCore.RETURN_STATUS.ELIGIBLE) {
    return { ok: true, skipped: true, reason: 'NOT_YET_ELIGIBLE' };
  }
  const policy = reportCore.resolveReturnPolicy(state.strikeCount);
  const adminOnly = !!(policy && policy.adminReturnOnly)
    || state.returnPolicy === 'OPERATOR_REVIEW'
    || state.returnPolicy === 'SEASON_END'
    || !!release.requiresOperatorReturn;
  if (adminOnly) {
    if (state.status !== modCore.STATUS.RETURN_ELIGIBLE && typeof _repo.markReturnEligible === 'function') {
      await _repo.markReturnEligible({ userId: userId });
    }
    return { ok: true, skipped: true, reason: 'OPERATOR_RETURN_REQUIRED', returnEligible: true };
  }
  return returnToEarth(userId, { operatorForced: false, now: nowIso, lazy: true });
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
    invalidatePopulationCacheSafe();
  }
  return saved;
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
    invalidatePopulationCacheSafe();
  }
  return saved;
}

async function planAlienReturn(input) {
  return _repo.planAlienReturn(input);
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
  return withUserTransferLock(src.userId, async function () {
    const state = await _repo.getModerationState(src.userId);
    if (state && (
      state.citizenshipStatus === reportCore.CITIZENSHIP.ALIEN
      || state.status === modCore.STATUS.ALIEN_ACTIVE
    )) {
      return {
        ok: true,
        duplicate: true,
        alreadyAlien: true,
        transfer: null,
        state: state,
        event: null,
      };
    }
    let earthTerritory = (state && state.earthTerritory) || src.earthTerritory || null;
    if (!earthTerritory || !/^(PIONEER|CENTRAL|GUARDIAN)$/.test(String(earthTerritory).toUpperCase())) {
      console.log('[alien-moderation] earthTerritory fallback CENTRAL for user', src.userId, 'raw=', earthTerritory);
      earthTerritory = 'CENTRAL';
    }
    const apply = reportCore.buildTransferApplyInput({
      userId: src.userId,
      strikeBefore: state && state.strikeCount ? state.strikeCount : 0,
      enteredAt: src.enteredAt || _nowFn().toISOString(),
      previousStatus: state && state.status,
      earthTerritory: earthTerritory,
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
  });
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
  if (_repo.appendWarningEvent) {
    await _repo.appendWarningEvent({
      userId: userId,
      dedupeKey: dedupeKey,
      createdAt: _nowFn().toISOString(),
    });
  } else if (_repo.findEventByDedupe && !_repo.findEventByDedupe(dedupeKey) && typeof _repo.listModerationEvents === 'function') {
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
  const row = report || {};
  return {
    ok: true,
    action: 'ADMIN_REVIEW',
    autoSanction: false,
    skipped: !_v1Enabled,
    reason: 'AWAIT_ADMIN_CONFIRMATION',
    classification: reportCore.classifyReportReason(row.reasonCode),
  };
}

function mapAlienHookAction(sanction, sanctionClass) {
  if (sanctionClass !== reviewCore.SANCTION_CLASS.CONDUCT) return 'NONE';
  const type = String((sanction && (sanction.sanctionType || sanction.action)) || 'NONE').toUpperCase();
  if (type === 'WARNING') return 'WARN';
  if (type === 'ALIEN_TRANSFER') return 'TRANSFER';
  return type;
}

async function onBehaviorReviewed(input) {
  const src = input || {};
  if (!reviewCore.isConfirmedViolation({ status: src.status, resolutionNote: src.resolutionNote })) {
    return { ok: true, action: 'NONE', autoSanction: false };
  }
  const targetUserId = src.targetAuthorUserId;
  if (!targetUserId) return { ok: false, error: 'TARGET_USER_MISSING' };
  const sanctionClass = reviewCore.classifySanctionClass(src.primaryReasonCode);

  const sanction = await sanctionService.applyFromBehaviorReview(Object.assign({}, src, {
    v1AlienWarn: _v1Enabled,
  }));
  if (sanction && sanction.ok === false) {
    return { ok: false, error: sanction.error, sanction: sanction };
  }

  const state = await _repo.getModerationState(targetUserId);
  const alreadyAlien = !!(state && (
    state.citizenshipStatus === reportCore.CITIZENSHIP.ALIEN || state.status === modCore.STATUS.ALIEN_ACTIVE
  ));

  if (sanction && sanction.duplicate && alreadyAlien) {
    return {
      ok: true,
      action: 'NONE',
      duplicate: true,
      alreadyAlien: true,
      confirmedConductCount: sanction.confirmedConductCount,
      sanction: sanction,
    };
  }

  let transferred = null;
  if (
    sanctionClass === reviewCore.SANCTION_CLASS.CONDUCT
    && sanction
    && sanction.sanctionType === 'ALIEN_TRANSFER'
    && _v1Enabled
    && !alreadyAlien
  ) {
    transferred = await applyTransfer({
      userId: targetUserId,
      transferReason: reportCore.TRANSFER_REASON.AUTO_SIMPLE_REPORT_THRESHOLD,
      sourceId: src.behaviorKey || src.sourceId,
      sourceType: 'REPORT_REVIEW',
      earthTerritory: state && state.earthTerritory,
      reasonCodes: [src.primaryReasonCode].filter(Boolean),
    });
    if (sanction && transferred && transferred.ok) {
      sanction.publicNotice = sanctionCore.toPublicNotice(Object.assign({}, sanction.publicNotice || {}, {
        currentSanctionType: 'ALIEN_TRANSFER',
        citizenshipStatus: reportCore.CITIZENSHIP.ALIEN,
        status: 'ALIEN_ACTIVE',
        alienTransferCompleted: true,
      }));
    }
    return {
      ok: true,
      action: 'TRANSFER',
      duplicate: !!transferred.duplicate,
      confirmedConductCount: sanction.confirmedConductCount,
      citizenshipStatus: reportCore.CITIZENSHIP.ALIEN,
      strikeCount: transferred.transfer && transferred.transfer.strikeAfter,
      returnPolicy: transferred.transfer && transferred.transfer.returnPolicy,
      durationDays: transferred.transfer && transferred.transfer.durationDays,
      state: transferred.state,
      sanction: sanction,
    };
  }

  const alienAction = mapAlienHookAction(sanction, sanctionClass);
  return {
    ok: true,
    action: alienAction,
    skipped: !_v1Enabled && alienAction === 'TRANSFER',
    reason: !_v1Enabled && alienAction === 'TRANSFER' ? 'ALIEN_MODERATION_V1_DISABLED' : undefined,
    autoSanction: !!(sanction && sanction.applied),
    autoPermanentBan: false,
    sanctionClass: sanctionClass,
    sanctionType: sanction && sanction.sanctionType,
    sanction: sanction,
    confirmedConductCount: sanction && sanction.confirmedConductCount,
    harmCount: sanction && sanction.harmCount,
    alreadyAlien: alreadyAlien,
    warningIssued: alienAction === 'WARN' && !!(sanction && sanction.notification),
    warningDuplicate: !!(sanction && sanction.duplicate),
    notification: sanction && sanction.notification,
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
  const reportClass = reviewCore.classifySanctionClass(report && report.reasonCode);
  if (reportClass === reviewCore.SANCTION_CLASS.SERVICE_HARM) {
    return { ok: false, error: 'ALIEN_FORBIDDEN_FOR_CLASS', sanctionClass: reportClass };
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
  const now = opts.now || _nowFn().toISOString();
  if (isPermanentBanActive(state, _nowFn().getTime()) && !opts.operatorForced) {
    return { ok: false, error: 'PERMANENT_BAN_BLOCKS_RETURN' };
  }
  if (opts.operatorForced) {
    const saved = await persistAlienReturnPlan({
      ok: true,
      userId: userId,
      previousStatus: state.status,
      nextStatus: modCore.STATUS.RETURNED,
      returnedAt: now,
      strikeCount: state.strikeCount,
      operatorForced: true,
      operatorUserId: opts.operatorUserId || null,
      operatorReason: opts.operatorReason || 'OPERATOR_FORCE_RETURN',
    });
    if (saved && saved.ok && _repo.appendModerationSignal) {
      try {
        await _repo.appendModerationSignal({
          userId: userId,
          signalType: 'OPERATOR_FLAG',
          note: 'FORCE_RETURN:' + String(opts.operatorReason || 'OPERATOR_FORCE_RETURN'),
          createdAt: now,
          metadata: {
            operatorUserId: opts.operatorUserId || null,
            reason: opts.operatorReason || 'OPERATOR_FORCE_RETURN',
          },
        });
      } catch (_) {}
    }
    return saved;
  }
  const policy = reportCore.resolveReturnPolicy(state.strikeCount);
  if (policy && policy.adminReturnOnly) {
    return {
      ok: false,
      error: 'OPERATOR_RETURN_REQUIRED',
      returnPolicy: policy.returnPolicy || state.returnPolicy || 'OPERATOR_REVIEW',
    };
  }
  if (state.returnPolicy === 'SEASON_END' || state.returnPolicy === 'OPERATOR_REVIEW') {
    return {
      ok: false,
      error: 'OPERATOR_RETURN_REQUIRED',
      returnPolicy: state.returnPolicy,
    };
  }
  const plan = await planAlienReturn({
    userId: userId,
    strikeCount: state.strikeCount,
    enteredAt: state.enteredAt,
    seasonEndAt: opts.seasonEndAt || null,
    now: now,
    operatorForced: false,
    operatorHold: !!state.operatorHold,
    previousStatus: state.status,
    returnPolicy: state.returnPolicy,
  });
  if (!plan.ok) return plan;
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
  ensureLazyAutoReturn,
  listModerationEvents,
  appendModerationSignal,
  planAlienTransfer,
  persistAlienTransferPlan,
  planAlienReturn,
  persistAlienReturnPlan,
  markReturnEligible,
  listInbox,
  onReportCreated,
  onBehaviorReviewed,
  applyAdminReportAction,
  applyTransfer,
  returnToEarth,
  healthCheck,
};
