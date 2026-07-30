'use strict';
/**
 * 영토 발전 Supabase repository — snapshot 쓰기 구조만 (미실행)
 */

let _adminClient = null;

function setAdminClient(client) {
  _adminClient = client;
}

async function saveSnapshot(plan) {
  void plan;
  if (!_adminClient) {
    return { ok: false, error: 'SUPABASE_CLIENT_NOT_CONFIGURED', persisted: false };
  }
  return { ok: false, error: 'SNAPSHOT_PERSIST_DISABLED', persisted: false, role: 'service_role' };
}

async function getLatestSnapshot() {
  return null;
}

module.exports = {
  setAdminClient,
  saveSnapshot,
  getLatestSnapshot,
};
