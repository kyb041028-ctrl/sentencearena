/**
 * 활동 피드 plan contract
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./user-domain-event-core'),
      require('./user-event-policy-core'),
      require('./user-data-config-core')
    );
  } else {
    root.UserActivityCore = factory(
      root.UserDomainEventCore, root.UserEventPolicyCore, root.UserDataConfigCore
    );
  }
})(typeof self !== 'undefined' ? self : this, function factory(eventCore, policyCore, cfg) {
  'use strict';

  var LEGACY_LIMITS = Object.freeze({ maxStore: 30, maxDisplay: 8, dedupeWindowMs: 30000 });

  var LEGACY_TYPE_MAP = Object.freeze({
    POST_CREATED: 'post_created',
    COMMENT_CREATED: 'comment_created',
    EMPATHY_RECEIVED: 'empathy_added',
    LIKE_RECEIVED: 'like_received',
    FOLLOWER_GAINED: 'follow_created',
    LEVEL_UP: 'level_up',
    TERRITORY_CHANGED: 'territory_changed',
    ACHIEVEMENT_ACQUIRED: 'achievement',
    ALIEN_WARNING: 'alien_warn',
    ALIEN_TRANSFERRED: 'alien_move',
  });

  function getActivityPolicyForEvent(event) {
    if (!policyCore.isActivityFeedEvent(event.eventType)) {
      return { create: false, reason: 'NOT_ACTIVITY' };
    }
    return { create: true, activityType: event.eventType };
  }

  function sanitizeActivityPayload(payload) {
    var s = eventCore.sanitizePayload(payload || {});
    delete s.payload.authorUserId;
    delete s.payload.rawAuthorUserId;
    return s;
  }

  function buildActivityEventPlan(event) {
    var pol = getActivityPolicyForEvent(event);
    if (!pol.create) return null;
    var safe = sanitizeActivityPayload(event.payload || {});
    return {
      activityType: pol.activityType,
      legacyType: LEGACY_TYPE_MAP[event.eventType] || null,
      userId: event.userId,
      actorUserId: event.actorUserId || null,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      payload: safe.payload,
      dedupeKey: 'activity:' + String(event.dedupeKey) + ':' + String(pol.activityType),
      occurredAt: event.occurredAt || new Date().toISOString(),
      shouldPersist: false,
    };
  }

  return {
    LEGACY_LIMITS: LEGACY_LIMITS,
    LEGACY_TYPE_MAP: LEGACY_TYPE_MAP,
    ACTIVITY_EVENT_TYPES: cfg.ACTIVITY_EVENT_TYPES,
    getActivityPolicyForEvent: getActivityPolicyForEvent,
    sanitizeActivityPayload: sanitizeActivityPayload,
    buildActivityEventPlan: buildActivityEventPlan,
  };
});
