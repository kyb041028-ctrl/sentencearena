/**
 * domain event → progression/achievement/notification/activity 정책 테이블
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./user-domain-event-core'));
  } else {
    root.UserEventPolicyCore = factory(root.UserDomainEventCore);
  }
})(typeof self !== 'undefined' ? self : this, function userEventPolicyCoreFactory(eventCore) {
  'use strict';

  var ET = eventCore.EVENT_TYPE;

  var POLICY = Object.freeze({
    POST_CREATED: { progression: true, achievement: true, notification: false, activity: true, reputation: false },
    COMMENT_CREATED: { progression: true, achievement: true, notification: false, activity: true, reputation: false },
    EMPATHY_RECEIVED: { progression: false, achievement: true, notification: true, activity: true, reputation: true },
    LIKE_RECEIVED: { progression: false, achievement: false, notification: false, activity: false, reputation: false },
    FOLLOWER_GAINED: { progression: false, achievement: false, notification: true, activity: true, reputation: false },
    LEVEL_UP: { progression: false, achievement: true, notification: true, activity: true, reputation: false },
    REPUTATION_GRADE_CHANGED: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
    CITIZEN_RANK_CHANGED: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
    TERRITORY_ASSIGNED: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
    TERRITORY_CHANGED: { progression: false, achievement: true, notification: true, activity: true, reputation: false },
    ACHIEVEMENT_ACQUIRED: { progression: false, achievement: false, notification: true, activity: true, reputation: false },
    ALIEN_WARNING: { progression: false, achievement: false, notification: true, activity: true, reputation: false },
    ALIEN_TRANSFERRED: { progression: false, achievement: false, notification: true, activity: true, reputation: false },
    ALIEN_RETURN_ELIGIBLE: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
    ALIEN_RETURNED: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
    ALIEN_PENALTY_EXTENDED: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
    ALIEN_RANK_CHANGED: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
    ALIEN_WEEKLY_LEGEND_SELECTED: { progression: false, achievement: true, notification: true, activity: false, reputation: false },
    TERRITORY_EVOLUTION_STAGE_CHANGED: { progression: false, achievement: false, notification: true, activity: false, reputation: false },
  });

  function getPolicyForEventType(eventType) {
    return POLICY[eventType] || {
      progression: false, achievement: false, notification: false, activity: false, reputation: false,
    };
  }

  function isProgressionEvent(eventType) {
    return !!getPolicyForEventType(eventType).progression;
  }

  function isReputationEvent(eventType) {
    return !!getPolicyForEventType(eventType).reputation;
  }

  function isAchievementEvaluationEvent(eventType) {
    return !!getPolicyForEventType(eventType).achievement;
  }

  function isImportantNotificationEvent(eventType) {
    var p = getPolicyForEventType(eventType);
    return p.notification && [
      ET.LEVEL_UP, ET.TERRITORY_CHANGED, ET.CITIZEN_RANK_CHANGED, ET.ACHIEVEMENT_ACQUIRED,
      ET.ALIEN_WARNING, ET.ALIEN_TRANSFERRED, ET.ALIEN_RETURN_ELIGIBLE, ET.ALIEN_RETURNED,
      ET.ALIEN_PENALTY_EXTENDED, ET.ALIEN_WEEKLY_LEGEND_SELECTED, ET.TERRITORY_EVOLUTION_STAGE_CHANGED,
      ET.REPUTATION_GRADE_CHANGED, ET.TERRITORY_ASSIGNED,
    ].indexOf(eventType) !== -1;
  }

  function isActivityFeedEvent(eventType) {
    return !!getPolicyForEventType(eventType).activity;
  }

  function isOperatorOnlyEvent(eventType) {
    return [ET.ALIEN_PENALTY_EXTENDED].indexOf(eventType) !== -1;
  }

  function isPublicEvent() { return true; }

  function isPrivateEvent(eventType) {
    return [ET.ALIEN_WARNING, ET.ALIEN_TRANSFERRED, ET.ALIEN_RETURN_ELIGIBLE,
      ET.ALIEN_RETURNED, ET.ALIEN_PENALTY_EXTENDED].indexOf(eventType) !== -1;
  }

  return {
    POLICY: POLICY,
    getPolicyForEventType: getPolicyForEventType,
    isProgressionEvent: isProgressionEvent,
    isReputationEvent: isReputationEvent,
    isAchievementEvaluationEvent: isAchievementEvaluationEvent,
    isImportantNotificationEvent: isImportantNotificationEvent,
    isActivityFeedEvent: isActivityFeedEvent,
    isOperatorOnlyEvent: isOperatorOnlyEvent,
    isPublicEvent: isPublicEvent,
    isPrivateEvent: isPrivateEvent,
  };
});
