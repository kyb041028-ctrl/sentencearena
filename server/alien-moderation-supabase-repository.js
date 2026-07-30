'use strict';

/**
 * Supabase alien moderation repository stub — 실제 RPC/쓰기 호출 금지
 */

async function getModerationState() {
  return null;
}

async function listModerationEvents() {
  return { items: [], total: 0 };
}

async function appendModerationSignal() {
  return { ok: false, error: 'ALIEN_SUPABASE_WRITE_DISABLED' };
}

async function planAlienTransfer() {
  return { ok: false, error: 'USE_SERVICE_PLAN' };
}

async function persistAlienTransferPlan() {
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED' };
}

async function persistAlienReturnPlan() {
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED' };
}

async function markReturnEligible() {
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED' };
}

async function healthCheck() {
  return {
    ok: true,
    backend: 'supabase-stub',
    autoDecisionEnabled: false,
    persistEnabled: false,
    note: 'MIGRATION_NOT_APPLIED',
  };
}

module.exports = {
  getModerationState,
  listModerationEvents,
  appendModerationSignal,
  planAlienTransfer,
  persistAlienTransferPlan,
  persistAlienReturnPlan,
  markReturnEligible,
  healthCheck,
};
