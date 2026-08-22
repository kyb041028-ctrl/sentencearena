'use strict';

const core = require('../shared/misinfo-report-core');

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function createMisinfoAbuseMemoryRepository() {
  const rows = new Map();

  async function getState(userId) {
    const row = rows.get(userId);
    return row ? clone(row) : core.emptyAbuseState(userId);
  }

  async function upsertState(row) {
    const next = clone(row);
    rows.set(next.userId, next);
    return clone(next);
  }

  function reset() {
    rows.clear();
  }

  return {
    getState: getState,
    upsertState: upsertState,
    reset: reset,
  };
}

module.exports = {
  createMisinfoAbuseMemoryRepository: createMisinfoAbuseMemoryRepository,
};
