/**
 * 중요 알림 plan contract
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./user-domain-event-core'),
      require('./user-event-policy-core'),
      require('./user-data-config-core')
    );
  } else {
    root.UserNotificationCore = factory(
      root.UserDomainEventCore, root.UserEventPolicyCore, root.UserDataConfigCore
    );
  }
})(typeof self !== 'undefined' ? self : this, function factory(eventCore, policyCore, cfg) {
  'use strict';

  var PRIORITY = Object.freeze({ NORMAL: 'NORMAL', IMPORTANT: 'IMPORTANT', CRITICAL: 'CRITICAL' });

  var PRIORITY_BY_TYPE = Object.freeze({
    ALIEN_TRANSFERRED: PRIORITY.CRITICAL,
    ALIEN_PENALTY_EXTENDED: PRIORITY.CRITICAL,
    LEVEL_UP: PRIORITY.IMPORTANT,
    TERRITORY_CHANGED: PRIORITY.IMPORTANT,
    CITIZEN_RANK_CHANGED: PRIORITY.IMPORTANT,
    ACHIEVEMENT_ACQUIRED: PRIORITY.IMPORTANT,
    ALIEN_RETURN_ELIGIBLE: PRIORITY.IMPORTANT,
    ALIEN_RETURNED: PRIORITY.IMPORTANT,
    ALIEN_WEEKLY_LEGEND_SELECTED: PRIORITY.IMPORTANT,
    REPUTATION_GRADE_CHANGED: PRIORITY.NORMAL,
  });

  function buildNotificationDedupeKey(event, notificationType) {
    return 'notification:' + String(event.dedupeKey) + ':' + String(notificationType);
  }

  function sanitizeNotificationPayload(payload) {
    return eventCore.sanitizePayload(payload);
  }

  function getNotificationPolicyForEvent(event) {
    if (!policyCore.isImportantNotificationEvent(event.eventType)) {
      return { create: false, reason: 'NOT_IMPORTANT' };
    }
    return {
      create: true,
      notificationType: event.eventType,
      priority: PRIORITY_BY_TYPE[event.eventType] || PRIORITY.NORMAL,
    };
  }

  function buildNotificationPlan(event) {
    var pol = getNotificationPolicyForEvent(event);
    if (!pol.create) return null;
    var safe = sanitizeNotificationPayload(event.payload || {});
    return {
      notificationType: pol.notificationType,
      userId: event.userId,
      titleKey: 'NOTI_' + pol.notificationType,
      messageKey: 'MSG_' + pol.notificationType,
      payload: safe.payload,
      dedupeKey: buildNotificationDedupeKey(event, pol.notificationType),
      priority: pol.priority,
      createdAt: event.occurredAt || new Date().toISOString(),
      expiresAt: null,
      sourceEventId: event.eventId || event.dedupeKey,
      shouldPersist: false,
    };
  }

  return {
    PRIORITY: PRIORITY,
    PRIORITY_BY_TYPE: PRIORITY_BY_TYPE,
    NOTIFICATION_RULES: cfg.NOTIFICATION_RULES,
    buildNotificationDedupeKey: buildNotificationDedupeKey,
    sanitizeNotificationPayload: sanitizeNotificationPayload,
    getNotificationPolicyForEvent: getNotificationPolicyForEvent,
    buildNotificationPlan: buildNotificationPlan,
  };
});
