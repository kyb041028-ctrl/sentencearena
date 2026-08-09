/**
 * 센텐스아레나 — 사용자 domain event 공용 계약
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./user-data-config-core'));
  } else {
    root.UserDomainEventCore = factory(root.UserDataConfigCore);
  }
})(typeof self !== 'undefined' ? self : this, function userDomainEventCoreFactory(cfg) {
  'use strict';

  var SCHEMA_VERSION = 1;

  var EVENT_TYPE = Object.freeze({
    POST_CREATED: 'POST_CREATED',
    COMMENT_CREATED: 'COMMENT_CREATED',
    POST_DELETED: 'POST_DELETED',
    COMMENT_DELETED: 'COMMENT_DELETED',
    LIKE_RECEIVED: 'LIKE_RECEIVED',
    RECOMMEND_RECEIVED: 'RECOMMEND_RECEIVED',
    EMPATHY_RECEIVED: 'EMPATHY_RECEIVED',
    FOLLOWER_GAINED: 'FOLLOWER_GAINED',
    FOLLOWER_LOST: 'FOLLOWER_LOST',
    XP_GAINED: 'XP_GAINED',
    LEVEL_UP: 'LEVEL_UP',
    REPUTATION_GAINED: 'REPUTATION_GAINED',
    REPUTATION_GRADE_CHANGED: 'REPUTATION_GRADE_CHANGED',
    CITIZEN_RANK_CHANGED: 'CITIZEN_RANK_CHANGED',
    TERRITORY_ASSIGNED: 'TERRITORY_ASSIGNED',
    TERRITORY_CHANGED: 'TERRITORY_CHANGED',
    ACHIEVEMENT_ACQUIRED: 'ACHIEVEMENT_ACQUIRED',
    FEATURED_ACHIEVEMENTS_CHANGED: 'FEATURED_ACHIEVEMENTS_CHANGED',
    ALIEN_WARNING: 'ALIEN_WARNING',
    ALIEN_TRANSFERRED: 'ALIEN_TRANSFERRED',
    ALIEN_RETURN_ELIGIBLE: 'ALIEN_RETURN_ELIGIBLE',
    ALIEN_RETURNED: 'ALIEN_RETURNED',
    ALIEN_PENALTY_EXTENDED: 'ALIEN_PENALTY_EXTENDED',
    ALIEN_RANK_CHANGED: 'ALIEN_RANK_CHANGED',
    ALIEN_WEEKLY_LEGEND_SELECTED: 'ALIEN_WEEKLY_LEGEND_SELECTED',
    TERRITORY_EVOLUTION_STAGE_CHANGED: 'TERRITORY_EVOLUTION_STAGE_CHANGED',
  });

  var SENSITIVE_PAYLOAD_KEYS = Object.freeze([
    'alignmentScore', 'alignment_score', 'internalScore', 'moderationReason',
    'operatorNote', 'reporterId', 'reporter_id', 'signalScore', 'signal_score',
    'authMetadata', 'email', 'rawAuthorUserId',
  ]);

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function validateUserId(userId) {
    if (!cfg || !cfg.isOperationalUserId) {
      return /^[0-9a-f-]{36}$/i.test(String(userId || ''))
        ? { valid: true, userId: String(userId).trim() }
        : { valid: false, error: 'USER_EVENT_USER_ID_INVALID' };
    }
    if (!cfg.isOperationalUserId(userId)) {
      if (cfg.isGuestId && cfg.isGuestId(userId)) return { valid: false, error: 'USER_EVENT_GUEST_NOT_ALLOWED' };
      if (cfg.isEmailLikeId && cfg.isEmailLikeId(userId)) return { valid: false, error: 'USER_EVENT_EMAIL_NOT_ALLOWED' };
      return { valid: false, error: 'USER_EVENT_USER_ID_INVALID' };
    }
    return { valid: true, userId: String(userId).trim() };
  }

  function validateDomainEvent(input) {
    var src = input || {};
    var frozen = clone(src);
    void frozen;
    var errors = [];
    if (!src.eventType || !EVENT_TYPE[src.eventType]) errors.push('USER_EVENT_TYPE_INVALID');
    var uid = validateUserId(src.userId);
    if (!uid.valid) errors.push(uid.error);
    if (src.actorUserId != null) {
      var aid = validateUserId(src.actorUserId);
      if (!aid.valid) errors.push('USER_EVENT_ACTOR_INVALID');
    }
    if (!src.dedupeKey || !String(src.dedupeKey).trim()) errors.push('USER_EVENT_DEDUPE_REQUIRED');
    if (src.occurredAt) {
      var d = new Date(src.occurredAt);
      if (isNaN(d.getTime())) errors.push('USER_EVENT_OCCURRED_AT_INVALID');
    }
    var sens = sanitizePayload(src.payload);
    if (sens.removedKeys.length) errors.push('USER_EVENT_SENSITIVE_PAYLOAD');
    return { valid: errors.length === 0, errors: errors };
  }

  function buildDomainEvent(parts) {
    var p = parts || {};
    var event = {
      eventId: p.eventId || null,
      eventType: p.eventType,
      userId: p.userId,
      actorUserId: p.actorUserId != null ? p.actorUserId : null,
      sourceType: p.sourceType || null,
      sourceId: p.sourceId != null ? String(p.sourceId) : null,
      targetType: p.targetType || null,
      targetId: p.targetId != null ? String(p.targetId) : null,
      occurredAt: p.occurredAt || new Date().toISOString(),
      dedupeKey: p.dedupeKey,
      seasonKey: p.seasonKey != null ? p.seasonKey : null,
      payload: sanitizePayload(p.payload).payload,
      metadata: p.metadata || {},
      sourceSystem: p.sourceSystem || 'UNKNOWN',
      schemaVersion: SCHEMA_VERSION,
    };
    return event;
  }

  function sanitizePayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var out = {};
    var removedKeys = [];
    Object.keys(src).forEach(function (k) {
      if (SENSITIVE_PAYLOAD_KEYS.indexOf(k) !== -1) {
        removedKeys.push(k);
        return;
      }
      var v = src[k];
      if (typeof v === 'string' && /<script|javascript:/i.test(v)) {
        removedKeys.push(k);
        return;
      }
      out[k] = v;
    });
    return { payload: out, removedKeys: removedKeys };
  }

  function buildDedupeKey(prefix, parts) {
    var p = parts || {};
    var season = p.seasonKey == null ? 'none' : String(p.seasonKey);
    return String(prefix) + ':' + String(p.eventId || p.sourceId || 'unknown') + ':' + season;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    EVENT_TYPE: EVENT_TYPE,
    SENSITIVE_PAYLOAD_KEYS: SENSITIVE_PAYLOAD_KEYS,
    clone: clone,
    validateUserId: validateUserId,
    validateDomainEvent: validateDomainEvent,
    buildDomainEvent: buildDomainEvent,
    sanitizePayload: sanitizePayload,
    buildDedupeKey: buildDedupeKey,
  };
});
