'use strict';

const modCore = require('../shared/alien-moderation-core');
const reportCore = require('../shared/alien-report-moderation-core');

const store = {
  states: new Map(),
  events: [],
  signals: [],
  notifications: [],
  persistEnabled: false,
};

function _reset() {
  store.states.clear();
  store.events = [];
  store.signals = [];
  store.notifications = [];
  store.persistEnabled = false;
}

function setPersistEnabled(enabled) {
  store.persistEnabled = !!enabled;
}

function isPersistEnabled() {
  return !!store.persistEnabled;
}

function defaultState(userId) {
  return {
    userId: userId,
    status: modCore.STATUS.EARTH,
    strikeCount: 0,
    enteredAt: null,
    releaseEligibleAt: null,
    returnPolicy: 'NONE',
    citizenshipStatus: reportCore.CITIZENSHIP.EARTH,
    earthTerritory: 'CENTRAL',
    lastReturnedAt: null,
    cycleStartAt: null,
    dataStatus: modCore.DATA_STATUS.READY,
  };
}

async function getModerationState(userId) {
  if (!userId) return null;
  const row = store.states.get(userId) || defaultState(userId);
  const contract = modCore.buildModerationStateContract(row);
  contract.citizenshipStatus = row.citizenshipStatus || reportCore.CITIZENSHIP.EARTH;
  contract.earthTerritory = row.earthTerritory || null;
  contract.returnPolicy = row.returnPolicy || 'NONE';
  contract.lastReturnedAt = row.lastReturnedAt || null;
  contract.cycleStartAt = row.cycleStartAt || row.lastReturnedAt || null;
  return contract;
}

async function listModerationEvents(userId, paging) {
  const page = paging || {};
  const limit = Math.min(Math.max(Number(page.limit) || 20, 1), 100);
  const offset = Math.max(Number(page.offset) || 0, 0);
  const items = store.events
    .filter((e) => !userId || e.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { items: items.slice(offset, offset + limit), total: items.length };
}

function findEventByDedupe(dedupeKey) {
  if (!dedupeKey) return null;
  for (let i = 0; i < store.events.length; i++) {
    if (store.events[i].dedupeKey === dedupeKey) return store.events[i];
  }
  return null;
}

function appendEvent(event) {
  const row = Object.assign({
    id: event.id || ('evt_' + (store.events.length + 1)),
    createdAt: event.createdAt || new Date().toISOString(),
  }, event);
  store.events.push(row);
  return row;
}

async function appendModerationSignal(signal) {
  const row = Object.assign({}, signal, {
    id: signal.id || ('sig_' + (store.signals.length + 1)),
    status: signal.status || 'PENDING',
    createdAt: new Date().toISOString(),
  });
  store.signals.push(row);
  return { ok: true, signal: row, note: 'MEMORY_ONLY_NOT_AUTO_DECIDED' };
}

async function planAlienTransfer(input) {
  return modCore.buildAlienTransferPlan(input);
}

function applyTransferRow(plan) {
  const userId = plan.userId;
  const prev = store.states.get(userId) || defaultState(userId);
  const next = Object.assign({}, prev, {
    userId: userId,
    status: modCore.STATUS.ALIEN_ACTIVE,
    strikeCount: plan.strikeAfter,
    enteredAt: plan.enteredAt,
    releaseEligibleAt: plan.releaseEligibleAt || null,
    returnPolicy: plan.returnPolicy || (plan.requiresSeasonEnd ? 'SEASON_END' : 'DAYS'),
    citizenshipStatus: reportCore.CITIZENSHIP.ALIEN,
    earthTerritory: plan.earthTerritory || prev.earthTerritory,
    lastReturnedAt: prev.lastReturnedAt || null,
    cycleStartAt: plan.enteredAt,
    alienOriginTerritory: plan.earthTerritory || prev.earthTerritory,
    originCapturedAt: plan.enteredAt,
    originSource: 'MODERATION_TRANSFER_SNAPSHOT',
    updatedAt: new Date().toISOString(),
  });
  store.states.set(userId, next);
  return next;
}

async function persistAlienTransferPlan(plan) {
  if (!store.persistEnabled) {
    return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
  }
  if (!plan || !plan.ok) {
    return { ok: false, error: (plan && plan.error) || 'TRANSFER_PLAN_INVALID' };
  }
  const sourceId = plan.sourceId || null;
  const dedupeKey = sourceId
    ? reportCore.transferDedupeKey(sourceId)
    : ('ALIEN_TRANSFERRED:user:' + plan.userId + ':strike:' + plan.strikeAfter + ':' + plan.enteredAt);
  const existing = findEventByDedupe(dedupeKey);
  if (existing) {
    const state = store.states.get(plan.userId) || defaultState(plan.userId);
    return {
      ok: true,
      duplicate: true,
      state: await getModerationState(plan.userId),
      strikeCount: state.strikeCount,
      event: existing,
    };
  }
  const current = store.states.get(plan.userId) || defaultState(plan.userId);
  if (current.citizenshipStatus === reportCore.CITIZENSHIP.ALIEN) {
    return {
      ok: true,
      duplicate: true,
      alreadyAlien: true,
      state: await getModerationState(plan.userId),
      strikeCount: current.strikeCount,
    };
  }
  const next = applyTransferRow(plan);
  const event = appendEvent({
    userId: plan.userId,
    eventType: modCore.EVENT_TYPE.ALIEN_TRANSFERRED,
    transferReason: plan.transferReason,
    sourceType: plan.sourceType,
    sourceId: sourceId,
    dedupeKey: dedupeKey,
    strikeCount: next.strikeCount,
    citizenshipStatus: next.citizenshipStatus,
    earthTerritory: next.earthTerritory,
    enteredAt: next.enteredAt,
    releaseEligibleAt: next.releaseEligibleAt,
    returnPolicy: next.returnPolicy,
  });
  return { ok: true, duplicate: false, state: await getModerationState(plan.userId), event: event };
}

async function planAlienReturn(input) {
  return modCore.buildAlienReturnPlan(input);
}

async function persistAlienReturnPlan(plan) {
  if (!store.persistEnabled) {
    return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
  }
  if (!plan || !plan.ok) {
    return { ok: false, error: (plan && plan.error) || 'RETURN_PLAN_INVALID' };
  }
  const prev = store.states.get(plan.userId) || defaultState(plan.userId);
  const returnedAt = plan.returnedAt || new Date().toISOString();
  const next = Object.assign({}, prev, {
    status: modCore.STATUS.RETURNED,
    citizenshipStatus: reportCore.CITIZENSHIP.EARTH,
    enteredAt: null,
    releaseEligibleAt: null,
    returnPolicy: 'NONE',
    lastReturnedAt: returnedAt,
    cycleStartAt: returnedAt,
    updatedAt: returnedAt,
  });
  store.states.set(plan.userId, next);
  const event = appendEvent({
    userId: plan.userId,
    eventType: modCore.EVENT_TYPE.RETURNED,
    strikeCount: next.strikeCount,
    citizenshipStatus: next.citizenshipStatus,
    earthTerritory: next.earthTerritory,
    returnedAt: returnedAt,
    dedupeKey: 'ALIEN_RETURNED:' + plan.userId + ':' + returnedAt,
  });
  return { ok: true, state: await getModerationState(plan.userId), event: event };
}

async function markReturnEligible(input) {
  if (!store.persistEnabled) {
    return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
  }
  const src = input || {};
  const prev = store.states.get(src.userId);
  if (!prev) return { ok: false, error: 'STATE_NOT_FOUND' };
  prev.status = modCore.STATUS.RETURN_ELIGIBLE;
  prev.updatedAt = new Date().toISOString();
  store.states.set(src.userId, prev);
  return { ok: true, state: await getModerationState(src.userId) };
}

async function issueNotification(input) {
  const src = input || {};
  const dedupeKey = src.dedupeKey;
  if (dedupeKey) {
    const dup = store.notifications.find((n) => n.dedupeKey === dedupeKey);
    if (dup) return { ok: true, duplicate: true, notification: dup };
  }
  const row = {
    id: src.id || ('noti_' + (store.notifications.length + 1)),
    userId: src.userId,
    type: src.type,
    title: src.title,
    message: src.message,
    dedupeKey: dedupeKey || null,
    createdAt: src.createdAt || new Date().toISOString(),
    read: false,
  };
  store.notifications.push(row);
  return { ok: true, duplicate: false, notification: row };
}

async function listNotifications(userId) {
  return store.notifications.filter((n) => n.userId === userId).slice().reverse();
}

async function hasWarningForCycle(userId, cycleKey) {
  const key = reportCore.warningDedupeKey(userId, cycleKey);
  return store.notifications.some((n) => n.dedupeKey === key)
    || store.events.some((e) => e.dedupeKey === key);
}

async function healthCheck() {
  return {
    ok: true,
    backend: 'memory',
    stateCount: store.states.size,
    eventCount: store.events.length,
    signalCount: store.signals.length,
    notificationCount: store.notifications.length,
    autoDecisionEnabled: store.persistEnabled,
    persistEnabled: store.persistEnabled,
  };
}

function _seedState(userId, partial) {
  store.states.set(userId, Object.assign(defaultState(userId), partial || {}, { userId: userId }));
}

function _getStore() {
  return store;
}

module.exports = {
  getModerationState,
  listModerationEvents,
  appendModerationSignal,
  planAlienTransfer,
  persistAlienTransferPlan,
  planAlienReturn,
  persistAlienReturnPlan,
  markReturnEligible,
  issueNotification,
  listNotifications,
  hasWarningForCycle,
  healthCheck,
  setPersistEnabled,
  isPersistEnabled,
  findEventByDedupe,
  _reset,
  _seedState,
  _getStore,
};
