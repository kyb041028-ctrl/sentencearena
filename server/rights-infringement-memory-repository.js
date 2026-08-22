'use strict';

const crypto = require('crypto');
const core = require('../shared/rights-infringement-core');

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createRightsInfringementMemoryRepository() {
  const requests = new Map();
  const events = [];
  const objections = [];
  const abuse = new Map();

  function clone(v) {
    return core.clone(v);
  }

  function reset() {
    requests.clear();
    events.length = 0;
    objections.length = 0;
    abuse.clear();
  }

  async function insertRequest(row) {
    const next = clone(row);
    next.id = next.id || uuid();
    requests.set(next.id, next);
    return clone(next);
  }

  async function updateRequest(id, patch) {
    const prev = requests.get(id);
    if (!prev) return null;
    const next = Object.assign({}, prev, patch || {}, { id: prev.id });
    requests.set(id, next);
    return clone(next);
  }

  async function getRequest(id) {
    const row = requests.get(id);
    return row ? clone(row) : null;
  }

  async function getByCaseNumber(caseNumber) {
    const want = String(caseNumber || '');
    for (const row of requests.values()) {
      if (row.caseNumber === want) return clone(row);
    }
    return null;
  }

  async function listRequests() {
    return Array.from(requests.values())
      .map(clone)
      .sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
  }

  async function findOpenDuplicate(input) {
    const key = core.duplicateKey(input);
    const rows = await listRequests();
    for (let i = 0; i < rows.length; i++) {
      if (!core.isOpenStatus(rows[i].status)) continue;
      if (core.duplicateKey(rows[i]) === key) return clone(rows[i]);
    }
    return null;
  }

  async function findLatestSame(input) {
    const key = core.duplicateKey(input);
    const rows = await listRequests();
    for (let i = 0; i < rows.length; i++) {
      if (core.duplicateKey(rows[i]) === key) return clone(rows[i]);
    }
    return null;
  }

  async function listAuthorNotices(authorUserId) {
    if (!authorUserId) return [];
    const rows = await listRequests();
    return rows.filter(function (r) {
      return String(r.targetAuthorUserId || '') === String(authorUserId) &&
        (r.status === core.STATUS.TEMP_TAKEDOWN || r.tempTakedownAt);
    });
  }

  async function insertEvent(row) {
    const next = Object.assign({ id: uuid(), createdAt: new Date().toISOString() }, row);
    events.push(next);
    return clone(next);
  }

  async function listEvents(requestId) {
    return events.filter(function (e) { return e.requestId === requestId; }).map(clone);
  }

  async function insertObjection(row) {
    const next = Object.assign({ id: uuid(), createdAt: new Date().toISOString() }, row);
    objections.push(next);
    return clone(next);
  }

  async function listObjections(requestId) {
    return objections.filter(function (e) { return e.requestId === requestId; }).map(clone);
  }

  async function getAbuseState(userId) {
    if (!userId) return null;
    const row = abuse.get(userId);
    return row ? clone(row) : {
      userId: userId,
      warningCount: 0,
      restrictionKind: core.ABUSE_RESTRICTION.NONE,
      restrictedUntil: null,
      lastAbuseAt: null,
    };
  }

  async function upsertAbuseState(row) {
    const next = Object.assign({}, row);
    abuse.set(next.userId, next);
    return clone(next);
  }

  async function deleteExpired(nowIso) {
    let n = 0;
    for (const [id, row] of Array.from(requests.entries())) {
      if (!core.shouldPurge(row, nowIso)) continue;
      requests.delete(id);
      n += 1;
    }
    return n;
  }

  return {
    reset: reset,
    insertRequest: insertRequest,
    updateRequest: updateRequest,
    getRequest: getRequest,
    getByCaseNumber: getByCaseNumber,
    listRequests: listRequests,
    findOpenDuplicate: findOpenDuplicate,
    findLatestSame: findLatestSame,
    listAuthorNotices: listAuthorNotices,
    insertEvent: insertEvent,
    listEvents: listEvents,
    insertObjection: insertObjection,
    listObjections: listObjections,
    getAbuseState: getAbuseState,
    upsertAbuseState: upsertAbuseState,
    deleteExpired: deleteExpired,
    _debug: { requests: requests, events: events, objections: objections, abuse: abuse },
  };
}

module.exports = {
  createRightsInfringementMemoryRepository: createRightsInfringementMemoryRepository,
};
