/**
 * 사용자 이벤트 시스템 개발용 검사
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/achievement-definitions-core'),
      require('../shared/user-rank-core'),
      require('../shared/user-notification-core'),
      require('../shared/user-activity-core')
    );
  } else {
    root.UserEventSystemInspect = factory(
      root.AchievementDefinitionsCore,
      root.UserRankCore,
      root.UserNotificationCore,
      root.UserActivityCore
    );
  }
})(typeof self !== 'undefined' ? self : this, function factory(defCore, rankCore, notifCore, activityCore) {
  'use strict';

  function inspectUserEventSystem(options) {
    var opts = options || {};
    var defIndex = defCore ? defCore.validateDefinitionIndex() : { total: 0, duplicateKeys: [], valid: true };
    return {
      mode: opts.mode || 'LEGACY_LOCAL',
      policies: {
        progression: true,
        reputation: true,
        citizenRank: false,
        achievements: true,
        notifications: true,
        activity: true,
      },
      definitions: {
        achievementCount: defIndex.total,
        invalidAchievementKeys: defIndex.duplicateKeys,
        duplicateKeys: defIndex.duplicateKeys,
      },
      legacy: {
        notificationCount: null,
        activityCount: null,
        unknownTypes: [],
        notificationMax: notifCore.NOTIFICATION_RULES.maxPerUser,
        activityMaxStore: activityCore.LEGACY_LIMITS.maxStore,
        activityMaxDisplay: activityCore.LEGACY_LIMITS.maxDisplay,
      },
      security: {
        publicWriteEnabled: false,
        sensitivePayloadLeakDetected: false,
      },
      integration: {
        boardAdapter: true,
        alignmentAdapter: true,
        alienAdapter: true,
        territoryEvolutionAdapter: true,
      },
      operational: {
        dbWriteEnabled: false,
        schedulerEnabled: false,
      },
      reputationLabels: rankCore.REPUTATION_GRADE_LABELS,
      warnings: defIndex.valid ? [] : ['ACHIEVEMENT_DUPLICATE_KEYS'],
    };
  }

  var api = { inspectUserEventSystem: inspectUserEventSystem };

  if (typeof window !== 'undefined') {
    window.__scInspectUserEventSystem = function () {
      return inspectUserEventSystem({ mode: 'LEGACY_LOCAL' });
    };
  }

  return api;
});
