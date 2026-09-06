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
  const holds = Object.create(null);
  let allowControlledPurge = false;

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
    if (allowControlledPurge) {
      return Promise.resolve({ ok: true });
    }
    const err = new Error('ADMIN_AUDIT_APPEND_ONLY');
    err.code = 'ADMIN_AUDIT_APPEND_ONLY';
    return Promise.reject(err);
  }

  function getLegalHold(auditEventId) {
    return getEvent(auditEventId).then(function (ev) {
      if (!ev) return { ok: false, error: 'ADMIN_AUDIT_NOT_FOUND' };
      const hold = holds[auditEventId] || { legalHold: false };
      return {
        ok: true,
        legalHold: !!hold.legalHold,
        legalHoldReason: hold.legalHoldReason || null,
        releasedAt: hold.releasedAt || null,
        retentionUntil: require('../shared/retention-policy-core').adminAuditRetentionUntil(ev.createdAt),
      };
    });
  }

  function setLegalHold(input) {
    const src = input || {};
    const id = src.auditEventId;
    return getEvent(id).then(function (ev) {
      if (!ev) return { ok: false, error: 'ADMIN_AUDIT_NOT_FOUND' };
      const prev = holds[id] || { legalHold: false };
      if (src.hold) {
        if (prev.legalHold) {
          return {
            ok: true,
            idempotent: true,
            legalHold: true,
            legalHoldReason: prev.legalHoldReason || null,
            releasedAt: null,
          };
        }
        holds[id] = {
          legalHold: true,
          legalHoldReason: src.reason || null,
          heldAt: src.nowIso || nowIso(),
          heldBy: src.actorUserId || null,
          releasedAt: null,
          releaseReason: null,
        };
        return {
          ok: true,
          idempotent: false,
          legalHold: true,
          legalHoldReason: src.reason || null,
          releasedAt: null,
        };
      }
      if (!prev.legalHold) {
        return {
          ok: true,
          idempotent: true,
          legalHold: false,
          legalHoldReason: prev.legalHoldReason || null,
          releasedAt: prev.releasedAt || null,
        };
      }
      holds[id] = Object.assign({}, prev, {
        legalHold: false,
        releasedAt: src.nowIso || nowIso(),
        releasedBy: src.actorUserId || null,
        releaseReason: src.reason || null,
      });
      return {
        ok: true,
        idempotent: false,
        legalHold: false,
        legalHoldReason: prev.legalHoldReason || null,
        releasedAt: holds[id].releasedAt,
      };
    });
  }

  function purgeExpired(nowIsoArg) {
    const retentionCore = require('../shared/retention-policy-core');
    let deleted = 0;
    allowControlledPurge = true;
    try {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const hold = holds[ev.id] || null;
        if (!retentionCore.shouldPurgeAdminAudit(ev, hold, nowIsoArg)) continue;
        events.splice(i, 1);
        delete holds[ev.id];
        deleted += 1;
      }
    } finally {
      allowControlledPurge = false;
    }
    return Promise.resolve({ ok: true, deleted: deleted });
  }

  function _reset() {
    events.length = 0;
    Object.keys(holds).forEach(function (k) { delete holds[k]; });
    Object.keys(names).forEach(function (k) { delete names[k]; });
  }

  return {
    insertEvent: insertEvent,
    listEvents: listEvents,
    getEvent: getEvent,
    loadDisplayNames: loadDisplayNames,
    setDisplayName: setDisplayName,
    updateEvent: updateEvent,
    deleteEvent: deleteEvent,
    getLegalHold: getLegalHold,
    setLegalHold: setLegalHold,
    purgeExpired: purgeExpired,
    _debug: { events: events, holds: holds },
    _reset: _reset,
  };
}

module.exports = {
  createAdminModerationAuditMemoryRepository: createAdminModerationAuditMemoryRepository,
};
