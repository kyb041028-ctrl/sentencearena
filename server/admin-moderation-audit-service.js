'use strict';

const core = require('../shared/admin-moderation-audit-core');
const { createAdminModerationAuditMemoryRepository } = require('./admin-moderation-audit-memory-repository');

let _repo = createAdminModerationAuditMemoryRepository();

function setRepository(repo) {
  _repo = repo || createAdminModerationAuditMemoryRepository();
}

function getRepository() {
  return _repo;
}

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

async function record(input) {
  const packed = core.normalizeWrite(input);
  if (!packed.ok) throw fail(packed.error);
  if (!_repo || typeof _repo.insertEvent !== 'function') throw fail('ADMIN_AUDIT_UNAVAILABLE');
  return _repo.insertEvent(packed.event);
}

async function list(input) {
  const packed = core.normalizeListQuery(input);
  if (!packed.ok) throw fail(packed.error);
  if (!_repo || typeof _repo.listEvents !== 'function') throw fail('ADMIN_AUDIT_UNAVAILABLE');
  const result = await _repo.listEvents(packed.query);
  const events = (result && result.events) || [];
  const ids = [];
  events.forEach(function (ev) {
    if (ev.actorUserId) ids.push(ev.actorUserId);
    if (ev.targetUserId) ids.push(ev.targetUserId);
  });
  let names = {};
  if (typeof _repo.loadDisplayNames === 'function') {
    try {
      names = await _repo.loadDisplayNames(ids);
    } catch (_) {
      names = {};
    }
  }
  return {
    events: events.map(function (ev) {
      return core.publicEvent(ev, names);
    }),
    nextCursor: (result && result.nextCursor) || null,
  };
}

async function setLegalHold(input) {
  if (!_repo || typeof _repo.setLegalHold !== 'function') throw fail('ADMIN_AUDIT_HOLD_UNAVAILABLE');
  return _repo.setLegalHold(input || {});
}

async function getLegalHold(auditEventId) {
  if (!_repo || typeof _repo.getLegalHold !== 'function') throw fail('ADMIN_AUDIT_HOLD_UNAVAILABLE');
  return _repo.getLegalHold(auditEventId);
}

async function purgeExpired(nowIso) {
  if (!_repo || typeof _repo.purgeExpired !== 'function') return { ok: true, deleted: 0 };
  return _repo.purgeExpired(nowIso);
}

module.exports = {
  setRepository: setRepository,
  getRepository: getRepository,
  record: record,
  list: list,
  setLegalHold: setLegalHold,
  getLegalHold: getLegalHold,
  purgeExpired: purgeExpired,
};
