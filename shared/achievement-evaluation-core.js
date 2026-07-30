/**
 * 업적 조건 판정 engine (plan only — 실제 grant RPC 미호출)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./achievement-definitions-core'),
      require('./user-domain-event-core')
    );
  } else {
    root.AchievementEvaluationCore = factory(null, root.UserDomainEventCore);
  }
})(typeof self !== 'undefined' ? self : this, function achievementEvaluationCoreFactory(defCore, eventCore) {
  'use strict';

  var TRIGGER_MAP = {
    POST_CREATED: ['first-post', 'record-builder'],
    COMMENT_CREATED: ['first-comment', 'conversation-bridge'],
    EMPATHY_RECEIVED: ['first-empathy-received', 'empathy-from-many'],
    LEVEL_UP: ['territory-citizen'],
    TERRITORY_CHANGED: ['territory-citizen'],
    ALIEN_WEEKLY_LEGEND_SELECTED: [],
  };

  function getAchievementDefinitionsForEvent(eventType) {
    if (!defCore) return [];
    var keys = TRIGGER_MAP[eventType] || [];
    return keys.map(function (k) { return defCore.getAchievementDefinition(k); }).filter(Boolean);
  }

  function evaluateAchievementCondition(definition, context) {
    var def = definition || {};
    var ctx = context || {};
    if (!def.enabled) return { eligible: false, reason: 'NOT_ENABLED' };
    if (def.implementationStatus !== 'CONFIRMED') {
      return { eligible: false, reason: 'NOT_CONFIRMED' };
    }
    var owned = (ctx.ownedAchievements || []).some(function (a) {
      return a.achievement_key === def.achievementKey || a.achievementKey === def.achievementKey;
    });
    if (owned && def.repeatPolicy === 'ONCE') {
      return { eligible: false, reason: 'ALREADY_OWNED' };
    }
    if (def.conditionType === 'LEVEL_REACHED') {
      var lvl = ctx.userProgression && ctx.userProgression.level;
      if (lvl == null) return { eligible: false, reason: 'INSUFFICIENT_DATA' };
      var target = Number(def.conditionConfig);
      return { eligible: lvl >= target, reason: lvl >= target ? 'LEVEL_MET' : 'LEVEL_NOT_MET' };
    }
    if (def.conditionType === 'VALID_POST_COUNT' || def.conditionType === 'VALID_COMMENT_ON_OTHERS_POST_COUNT'
      || def.conditionType === 'VALID_EMPATHY_RECEIVED_COUNT') {
      return { eligible: false, reason: 'CONDITION_DATA_NOT_CONNECTED' };
    }
    return { eligible: false, reason: 'CONDITION_NOT_IMPLEMENTED' };
  }

  function buildAchievementGrantPlan(input) {
    var src = input || {};
    return {
      userId: src.userId,
      achievementKey: src.achievementKey,
      seasonKey: src.seasonKey || null,
      acquiredAt: src.acquiredAt || new Date().toISOString(),
      acquisitionSequence: src.acquisitionSequence,
      shouldPersist: false,
      dedupeKey: 'achievement:' + (src.eventId || 'evt') + ':' + src.achievementKey + ':' + (src.seasonKey || 'none'),
    };
  }

  function evaluateAchievementsForDomainEvent(event, context) {
    var defs = getAchievementDefinitionsForEvent(event.eventType);
    var grants = [];
    var eligible = [];
    var unavailable = [];
    var alreadyOwned = [];
    defs.forEach(function (def) {
      var r = evaluateAchievementCondition(def, context);
      if (r.reason === 'ALREADY_OWNED') alreadyOwned.push(def.achievementKey);
      else if (r.reason === 'INSUFFICIENT_DATA' || r.reason === 'CONDITION_DATA_NOT_CONNECTED'
        || r.reason === 'CONDITION_NOT_IMPLEMENTED') unavailable.push({ key: def.achievementKey, reason: r.reason });
      else if (r.eligible) {
        eligible.push(def.achievementKey);
        grants.push(buildAchievementGrantPlan({
          userId: event.userId,
          achievementKey: def.achievementKey,
          seasonKey: event.seasonKey,
          eventId: event.eventId || event.dedupeKey,
          acquisitionSequence: null,
        }));
      }
    });
    return {
      evaluated: defs.length,
      eligible: eligible,
      unavailable: unavailable,
      alreadyOwned: alreadyOwned,
      grants: grants,
      warnings: [],
    };
  }

  function validateAchievementGrantPlan(plan) {
    if (!plan || !plan.achievementKey) return { valid: false, error: 'ACHIEVEMENT_KEY_REQUIRED' };
    if (!plan.acquiredAt) return { valid: false, error: 'ACQUIRED_AT_REQUIRED' };
    if (plan.acquisitionSequence == null) return { valid: false, error: 'SEQUENCE_REQUIRED_IN_PERSIST' };
    return { valid: true };
  }

  function planNextAcquisitionSequence(owned) {
    var max = 0;
    (owned || []).forEach(function (a) {
      var s = Number(a.acquisition_sequence != null ? a.acquisition_sequence : a.acquisitionSequence);
      if (isFinite(s) && s > max) max = s;
    });
    return max + 1;
  }

  return {
    TRIGGER_MAP: TRIGGER_MAP,
    getAchievementDefinitionsForEvent: getAchievementDefinitionsForEvent,
    evaluateAchievementCondition: evaluateAchievementCondition,
    buildAchievementGrantPlan: buildAchievementGrantPlan,
    evaluateAchievementsForDomainEvent: evaluateAchievementsForDomainEvent,
    validateAchievementGrantPlan: validateAchievementGrantPlan,
    planNextAcquisitionSequence: planNextAcquisitionSequence,
  };
});
