'use strict';

const crypto = require('crypto');
const core = require('../shared/admin-moderation-audit-core');

function nowIso() {
  return new Date().toISOString();
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function createAdminModerationAuditMemoryRepository() {
  const events = [];
  const names = Object.create(null);

  function insertEvent(input) {
    const packed = core.normalizeWrite(input);
    if (!packed.ok) {
      const err = new Error(packed.error);
      err.code = packed.error;
      return Promise.reject(err);
    }
    const row = Object.assign(
      {
        id: crypto.randomUUID(),
        createdAt: nowIso(),
      },
      packed.event,
    );
    events.push(row);
    return Promise.resolve(clone(row));
  }

  function listEvents(query) {
    const q = query || {};
    const matched = events.filter(function (row) {
      return core.eventMatches(row, q);
    });
    matched.sort(function (a, b) {
      if (a.createdAt === b.createdAt) return String(b.id).localeCompare(String(a.id));
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    const limit = q.limit || core.DEFAULT_LIMIT;
    const slice = matched.slice(0, limit);
    const last = slice[slice.length - 1];
    return Promise.resolve({
      events: slice.map(clone),
      nextCursor: matched.length > slice.length && last ? core.encodeCursor(last.createdAt, last.id) : null,
    });
  }

  function getEvent(id) {
    for (let i = 0; i < events.length; i++) {
      if (events[i].id === id) return Promise.resolve(clone(events[i]));
    }
    return Promise.resolve(null);
  }

  function setDisplayName(userId, name) {
    if (userId) names[userId] = name;
  }

  function loadDisplayNames(userIds) {
    const out = Object.create(null);
    (userIds || []).forEach(function (id) {
      if (id && names[id]) out[id] = names[id];
    });
    return Promise.resolve(out);
  }

  function updateEvent() {
    const err = new Error('ADMIN_AUDIT_APPEND_ONLY');
    err.code = 'ADMIN_AUDIT_APPEND_ONLY';
    return Promise.reject(err);
  }

  function deleteEvent() {
    const err = new Error('ADMIN_AUDIT_APPEND_ONLY');
    err.code = 'ADMIN_AUDIT_APPEND_ONLY';
    return Promise.reject(err);
  }

  return {
    insertEvent: insertEvent,
    listEvents: listEvents,
    getEvent: getEvent,
    loadDisplayNames: loadDisplayNames,
    setDisplayName: setDisplayName,
    updateEvent: updateEvent,
    deleteEvent: deleteEvent,
    _debug: { events: events },
  };
}

module.exports = {
  createAdminModerationAuditMemoryRepository: createAdminModerationAuditMemoryRepository,
};
