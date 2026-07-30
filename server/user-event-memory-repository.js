'use strict';

const eventCore = require('../shared/user-domain-event-core');

const store = {
  processed: new Set(),
  history: [],
  sequences: new Map(),
  contexts: new Map(),
};

function _reset() {
  store.processed.clear();
  store.history = [];
  store.sequences.clear();
  store.contexts.clear();
}

async function hasProcessedEvent(dedupeKey) {
  return store.processed.has(String(dedupeKey));
}

async function getUserEventContext(userId) {
  if (store.contexts.has(userId)) return cloneContext(store.contexts.get(userId));
  return {
    userId,
    progression: { xp: 0, level: 1, reputation_score: 0, citizen_rank: null },
    ownedAchievements: [],
    notifications: [],
    activities: [],
  };
}

function cloneContext(ctx) {
  return JSON.parse(JSON.stringify(ctx));
}

function _seedContext(userId, partial) {
  const base = {
    userId,
    progression: { xp: 0, level: 1, reputation_score: 0, citizen_rank: null },
    ownedAchievements: [],
    notifications: [],
    activities: [],
  };
  store.contexts.set(userId, Object.assign(base, partial || {}, {
    progression: Object.assign(base.progression, (partial && partial.progression) || {}),
    ownedAchievements: (partial && partial.ownedAchievements) ? partial.ownedAchievements.slice() : [],
  }));
}

async function getOwnedAchievements(userId) {
  const ctx = await getUserEventContext(userId);
  return ctx.ownedAchievements.slice();
}

async function getNextAchievementSequence(userId) {
  const cur = store.sequences.get(userId) || 0;
  const next = cur + 1;
  store.sequences.set(userId, next);
  return next;
}

async function persistUserEventPlan(plan) {
  void plan;
  return { ok: false, error: 'USER_EVENT_PERSIST_DISABLED', note: 'DRY_RUN_ONLY' };
}

async function listEventProcessingHistory(userId, paging) {
  const page = paging || {};
  const limit = Math.min(Number(page.limit) || 20, 100);
  const items = store.history.filter(function (h) { return h.userId === userId; });
  return { items: items.slice(0, limit), total: items.length };
}

async function markProcessedDryRun(dedupeKey, userId) {
  store.processed.add(String(dedupeKey));
  store.history.push({ userId, dedupeKey, at: new Date().toISOString(), dryRun: true });
  return { ok: true };
}

async function healthCheck() {
  return {
    ok: true,
    backend: 'memory',
    processedCount: store.processed.size,
    persistEnabled: false,
  };
}

module.exports = {
  hasProcessedEvent,
  getUserEventContext,
  getOwnedAchievements,
  getNextAchievementSequence,
  persistUserEventPlan,
  listEventProcessingHistory,
  markProcessedDryRun,
  healthCheck,
  _reset,
  _seedContext,
};
