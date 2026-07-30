/**
 * progression event plan — 확정 XP만, reputation 감점 금지
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./user-data-config-core'),
      require('./user-domain-event-core'),
      require('./user-rank-core')
    );
  } else {
    root.UserProgressionEventCore = factory(
      root.UserDataConfigCore, root.UserDomainEventCore, root.UserRankCore
    );
  }
})(typeof self !== 'undefined' ? self : this, function factory(cfg, eventCore, rankCore) {
  'use strict';

  var XP_BY_EVENT = Object.freeze({
    POST_CREATED: cfg.PROGRESSION_RULES.xpRewards.post_write,
    COMMENT_CREATED: cfg.PROGRESSION_RULES.xpRewards.board_comment,
  });

  function applyProgressionPolicy(event) {
    var e = event || {};
    if (!XP_BY_EVENT[e.eventType] && e.eventType !== eventCore.EVENT_TYPE.EMPATHY_RECEIVED) {
      return { ok: false, policy: 'NO_POLICY', xpDelta: 0, reputationDelta: 0 };
    }
    var xpDelta = XP_BY_EVENT[e.eventType] || 0;
    var reputationDelta = 0;
    if (e.eventType === eventCore.EVENT_TYPE.EMPATHY_RECEIVED) {
      if (e.payload && e.payload.reputationAmount != null) {
        var rawRep = Number(e.payload.reputationAmount);
        if (isFinite(rawRep) && rawRep < 0) {
          return { ok: false, policy: 'REPUTATION_DEDUCT_FORBIDDEN', xpDelta: 0, reputationDelta: 0 };
        }
        var rep = rankCore.normalizeReputationScore(e.payload.reputationAmount);
        reputationDelta = rep.valid ? rep.score : 0;
      } else {
        return { ok: false, policy: 'NO_POLICY', xpDelta: 0, reputationDelta: 0,
          note: 'EMPATHY_REPUTATION_AMOUNT_NOT_FINALIZED' };
      }
    }
    if (reputationDelta < 0) {
      return { ok: false, policy: 'REPUTATION_DEDUCT_FORBIDDEN', xpDelta: 0, reputationDelta: 0 };
    }
    return { ok: true, policy: 'APPLY', xpDelta: xpDelta, reputationDelta: reputationDelta };
  }

  function buildProgressionEventPlan(input) {
    var src = input || {};
    var frozen = eventCore.clone(src);
    void frozen;
    var current = src.currentProgression || { xp: 0, level: 1, reputation_score: 0 };
    var policy = applyProgressionPolicy(src.event);
    if (!policy.ok) {
      return {
        userId: src.userId,
        event: src.event,
        shouldPersist: false,
        policy: policy.policy,
        xpDelta: 0,
        reputationDelta: 0,
        levelBefore: current.level,
        levelAfter: current.level,
        note: policy.note || null,
      };
    }
    var xpBefore = Math.max(0, Math.floor(Number(current.xp) || 0));
    var repBefore = Math.max(0, Math.floor(Number(current.reputation_score) || 0));
    var xpAfter = xpBefore + policy.xpDelta;
    var repAfter = repBefore + policy.reputationDelta;
    var levelBefore = cfg.clampLevel(current.level);
    var levelAfter = cfg.computeAutoLevelFromXp(xpAfter);
    if (levelAfter > cfg.PROGRESSION_RULES.autoLevelCap && levelBefore <= cfg.PROGRESSION_RULES.autoLevelCap) {
      levelAfter = cfg.PROGRESSION_RULES.autoLevelCap;
    }
    levelAfter = cfg.clampLevel(levelAfter);
    return {
      userId: src.userId,
      event: src.event,
      currentProgression: current,
      nextProgression: Object.assign({}, current, {
        xp: xpAfter,
        reputation_score: repAfter,
        level: levelAfter,
      }),
      xpDelta: policy.xpDelta,
      reputationDelta: policy.reputationDelta,
      levelBefore: levelBefore,
      levelAfter: levelAfter,
      reputationBefore: repBefore,
      reputationAfter: repAfter,
      generatedDomainEvents: detectLevelUpEvents(levelBefore, levelAfter, src.event),
      dedupeKey: 'progression:' + (src.event && src.event.dedupeKey),
      shouldPersist: false,
    };
  }

  function detectLevelUpEvents(levelBefore, levelAfter, sourceEvent) {
    if (levelAfter <= levelBefore) return [];
    return [{
      eventType: eventCore.EVENT_TYPE.LEVEL_UP,
      userId: sourceEvent.userId,
      dedupeKey: 'levelup:' + sourceEvent.dedupeKey + ':' + levelAfter,
      payload: { levelBefore: levelBefore, levelAfter: levelAfter },
      sourceSystem: 'PROGRESSION_DERIVED',
    }];
  }

  function detectReputationGradeChange(beforeState, afterState) {
    var b = rankCore.getReputationGrade(beforeState || {});
    var a = rankCore.getReputationGrade(afterState || {});
    if (!b.available || !a.available || b.grade === a.grade) return null;
    return {
      eventType: eventCore.EVENT_TYPE.REPUTATION_GRADE_CHANGED,
      payload: { gradeBefore: b.grade, gradeAfter: a.grade },
    };
  }

  function validateProgressionPlan(plan) {
    if (!plan) return { valid: false, error: 'PLAN_MISSING' };
    if (plan.levelAfter > cfg.USER_LEVEL_MAX) return { valid: false, error: 'LEVEL_ABOVE_MAX' };
    if (plan.reputationDelta < 0) return { valid: false, error: 'REPUTATION_DEDUCT_FORBIDDEN' };
    return { valid: true };
  }

  return {
    XP_BY_EVENT: XP_BY_EVENT,
    applyProgressionPolicy: applyProgressionPolicy,
    buildProgressionEventPlan: buildProgressionEventPlan,
    detectLevelUpEvents: detectLevelUpEvents,
    detectReputationGradeChange: detectReputationGradeChange,
    validateProgressionPlan: validateProgressionPlan,
  };
});
