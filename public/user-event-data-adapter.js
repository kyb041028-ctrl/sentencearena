/**
 * legacy notification/activity ↔ 공용 contract adapter
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/user-notification-core'),
      require('../shared/user-activity-core'),
      require('../shared/user-domain-event-core')
    );
  } else {
    root.UserEventDataAdapter = factory(
      root.UserNotificationCore, root.UserActivityCore, root.UserDomainEventCore
    );
  }
})(typeof self !== 'undefined' ? self : this, function factory(notifCore, activityCore, eventCore) {
  'use strict';

  function toLegacyNotificationModel(plan) {
    if (!plan) return null;
    var safe = notifCore.sanitizeNotificationPayload(plan.payload || {});
    return {
      id: plan.sourceEventId || plan.dedupeKey,
      type: plan.notificationType,
      title: plan.titleKey,
      message: plan.messageKey,
      payload: safe.payload,
      priority: plan.priority,
      read: false,
      createdAt: plan.createdAt,
    };
  }

  function toLegacyActivityModel(plan) {
    if (!plan) return null;
    var safe = activityCore.sanitizeActivityPayload(plan.payload || {});
    return {
      type: plan.legacyType || plan.activityType,
      userId: plan.userId,
      actorUserId: plan.actorUserId,
      payload: safe.payload,
      occurredAt: plan.occurredAt,
      dedupeKey: plan.dedupeKey,
    };
  }

  function fromLegacyNotification(row) {
    if (!row) return null;
    return {
      notificationType: row.type,
      userId: row.userId || null,
      titleKey: row.title,
      messageKey: row.message,
      payload: eventCore.sanitizePayload(row.payload || {}).payload,
      dedupeKey: row.id ? 'legacy:noti:' + row.id : null,
      priority: notifCore.PRIORITY.NORMAL,
      createdAt: row.createdAt || row.created_at,
    };
  }

  function fromLegacyActivity(row) {
    if (!row) return null;
    return {
      activityType: row.type,
      userId: row.userId || null,
      actorUserId: row.actorUserId || null,
      payload: eventCore.sanitizePayload(row.payload || {}).payload,
      dedupeKey: row.id ? 'legacy:activity:' + row.id : null,
      occurredAt: row.occurredAt || row.created_at,
    };
  }

  return {
    toLegacyNotificationModel: toLegacyNotificationModel,
    toLegacyActivityModel: toLegacyActivityModel,
    fromLegacyNotification: fromLegacyNotification,
    fromLegacyActivity: fromLegacyActivity,
    LEGACY_ACTIVITY_LIMITS: activityCore.LEGACY_LIMITS,
    NOTIFICATION_RULES: notifCore.NOTIFICATION_RULES,
  };
});
