'use strict';

const core = require('../shared/rights-email-verify-core');

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function createRightsEmailVerifyMemoryRepository() {
  const rows = new Map();

  async function upsertByEmailHash(row) {
    const next = clone(row);
    rows.set(next.emailHash, next);
    return clone(next);
  }

  async function getByEmailHash(emailHash) {
    const row = rows.get(emailHash);
    return row ? clone(row) : null;
  }

  async function deleteByEmailHash(emailHash) {
    return rows.delete(emailHash);
  }

  async function deleteExpired(nowIso) {
    const nowMs = new Date(nowIso || Date.now()).getTime();
    let n = 0;
    Array.from(rows.entries()).forEach(function (pair) {
      if (!core.shouldPurge(pair[1], nowMs)) return;
      rows.delete(pair[0]);
      n += 1;
    });
    return n;
  }

  function reset() {
    rows.clear();
  }

  return {
    upsertByEmailHash: upsertByEmailHash,
    getByEmailHash: getByEmailHash,
    deleteByEmailHash: deleteByEmailHash,
    deleteExpired: deleteExpired,
    reset: reset,
  };
}

module.exports = {
  createRightsEmailVerifyMemoryRepository: createRightsEmailVerifyMemoryRepository,
};
