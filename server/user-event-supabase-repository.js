'use strict';

async function hasProcessedEvent() { return false; }

async function getUserEventContext(userId) {
  return { userId, progression: null, ownedAchievements: [], note: 'NOT_CONNECTED' };
}

async function getOwnedAchievements() { return []; }

async function getNextAchievementSequence() { return 1; }

async function persistUserEventPlan() {
  return { ok: false, error: 'USER_EVENT_SUPABASE_WRITE_DISABLED' };
}

async function listEventProcessingHistory() {
  return { items: [], total: 0 };
}

async function healthCheck() {
  return { ok: true, backend: 'supabase-stub', persistEnabled: false, note: 'MIGRATION_NOT_APPLIED' };
}

module.exports = {
  hasProcessedEvent,
  getUserEventContext,
  getOwnedAchievements,
  getNextAchievementSequence,
  persistUserEventPlan,
  listEventProcessingHistory,
  healthCheck,
};
