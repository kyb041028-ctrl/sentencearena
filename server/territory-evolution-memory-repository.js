'use strict';
/**
 * 영토 발전 evolution repository (memory) — snapshot 저장 구조만
 */

const store = { snapshots: [] };

async function saveSnapshot(plan) {
  void plan;
  return { ok: false, error: 'SNAPSHOT_PERSIST_DISABLED' };
}

async function getLatestSnapshot() {
  return null;
}

function _reset() {
  store.snapshots = [];
}

module.exports = {
  saveSnapshot,
  getLatestSnapshot,
  _reset,
};
