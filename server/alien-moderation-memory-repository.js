'use strict';

const modCore = require('../shared/alien-moderation-core');

const store = {
  states: new Map(),
  events: [],
  signals: [],
};

function _reset() {
  store.states.clear();
  store.events = [];
  store.signals = [];
}

async function getModerationState(userId) {
  if (!userId) return null;
  const row = store.states.get(userId);
  if (!row) {
    return modCore.buildModerationStateContract({
      userId,
      status: modCore.STATUS.EARTH,
      strikeCount: 0,
      dataStatus: modCore.DATA_STATUS.READY,
    });
  }
  return modCore.buildModerationStateContract(row);
}

async function listModerationEvents(userId, paging) {
  const page = paging || {};
  const limit = Math.min(Math.max(Number(page.limit) || 20, 1), 100);
  const offset = Math.max(Number(page.offset) || 0, 0);
  const items = store.events
    .filter((e) => e.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { items: items.slice(offset, offset + limit), total: items.length };
}

async function appendModerationSignal(signal) {
  const row = Object.assign({}, signal, {
    id: signal.id || ('sig_' + store.signals.length + 1),
    status: signal.status || 'PENDING',
    createdAt: new Date().toISOString(),
  });
  store.signals.push(row);
  return { ok: true, signal: row, note: 'MEMORY_ONLY_NOT_AUTO_DECIDED' };
}

async function planAlienTransfer(input) {
  return modCore.buildAlienTransferPlan(input);
}

async function persistAlienTransferPlan(plan) {
  void plan;
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
}

async function planAlienReturn(input) {
  return modCore.buildAlienReturnPlan(input);
}

async function persistAlienReturnPlan(plan) {
  void plan;
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
}

async function markReturnEligible(input) {
  void input;
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
}

async function healthCheck() {
  return {
    ok: true,
    backend: 'memory',
    stateCount: store.states.size,
    eventCount: store.events.length,
    signalCount: store.signals.length,
    autoDecisionEnabled: false,
    persistEnabled: false,
  };
}

/** 테스트용 seed — 실제 사용자 이동 아님 */
function _seedState(userId, partial) {
  store.states.set(userId, Object.assign({
    userId,
    status: modCore.STATUS.EARTH,
    strikeCount: 0,
  }, partial || {}));
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
  healthCheck,
  _reset,
  _seedState,
};
