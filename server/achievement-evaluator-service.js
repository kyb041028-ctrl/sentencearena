'use strict';

/**
 * 서버 내부 업적 evaluator → grantAchievementForUser 파이프라인.
 * 브라우저 self-grant / 클라이언트 count·level 입력 사용 금지.
 */

const achCore = require('../shared/achievement-evaluation-core');
const eventCore = require('../shared/user-domain-event-core');
const persist = require('./achievement-persist-service');
const statsService = require('./achievement-stats-service');

function mapOwnedForEval(rows) {
  return (rows || []).map(function (r) {
    return {
      achievement_key: r.achievementId,
      achievementKey: r.achievementId,
      season_key: r.seasonId,
      seasonKey: r.seasonId,
    };
  });
}

function uniqueGrantPlans(plans) {
  var seen = {};
  var out = [];
  (plans || []).forEach(function (p) {
    if (!p || !p.achievementKey || seen[p.achievementKey]) return;
    seen[p.achievementKey] = true;
    out.push(p);
  });
  return out;
}

function buildEvalContext(stats, ownedRows) {
  return {
    achievementStats: stats,
    userProgression: stats && stats.progression ? stats.progression : null,
    ownedAchievements: mapOwnedForEval(ownedRows),
  };
}

function collectGrantsForEvent(userId, eventType, payload, context) {
  var event = {
    userId: userId,
    eventType: eventType,
    payload: payload || {},
    eventId: eventType + ':' + userId + ':' + Date.now(),
    dedupeKey: eventType + ':' + userId + ':' + Date.now(),
  };
  if (eventCore && typeof eventCore.buildDomainEvent === 'function') {
    try {
      event = eventCore.buildDomainEvent(event);
    } catch (_) {}
  }
  var result = achCore.evaluateAchievementsForDomainEvent(event, context);
  return result.grants || [];
}

async function evaluateAndGrantForDomainEvent(userId, eventType, payload, options) {
  var uid = String(userId || '').trim();
  if (!uid || !eventType) {
    return { ok: false, error: 'INVALID_INPUT', granted: [] };
  }
  var opts = options || {};

  var stats;
  var owned;
  try {
    stats = await statsService.loadAchievementStats(uid);
    owned = await persist.listAchievementsForUser(uid);
  } catch (e) {
    return {
      ok: false,
      error: (e && e.code) || 'ACHIEVEMENT_EVAL_SETUP_FAILED',
      granted: [],
    };
  }

  var context = buildEvalContext(stats, owned);
  var grantPlans = collectGrantsForEvent(uid, eventType, payload, context);

  if (
    opts.includeLevelReached !== false &&
    stats.progression &&
    Number(stats.progression.level) >= 5
  ) {
    var levelPlans = collectGrantsForEvent(
      uid,
      'LEVEL_UP',
      { levelAfter: Number(stats.progression.level) },
      context
    );
    grantPlans = grantPlans.concat(levelPlans);
  }

  grantPlans = uniqueGrantPlans(grantPlans);
  var granted = [];

  for (var i = 0; i < grantPlans.length; i++) {
    var plan = grantPlans[i];
    try {
      var result = await persist.grantAchievementForUser(uid, {
        achievementId: plan.achievementKey,
        seasonId: plan.seasonKey || null,
      });
      if (result && result.granted && result.record) {
        granted.push({
          achievementKey: plan.achievementKey,
          record: result.record,
        });
        owned.push(result.record);
        context.ownedAchievements = mapOwnedForEval(owned);
      }
    } catch (e) {
      console.error(
        '[achievement-evaluator grant]',
        plan.achievementKey,
        e && e.message ? e.message : e
      );
    }
  }

  return { ok: true, granted: granted, evaluatedEvent: eventType };
}

async function evaluateAfterPostCreated(userId) {
  return evaluateAndGrantForDomainEvent(userId, 'POST_CREATED', {}, { includeLevelReached: false });
}

async function evaluateAfterCommentCreated(userId) {
  return evaluateAndGrantForDomainEvent(userId, 'COMMENT_CREATED', {});
}

async function evaluateAfterEmpathyReceived(userId) {
  return evaluateAndGrantForDomainEvent(userId, 'EMPATHY_RECEIVED', {});
}

async function evaluateAfterActivityRecorded(userId) {
  return evaluateAndGrantForDomainEvent(userId, 'ACTIVITY_RECORDED', {});
}

async function evaluateAfterLevelUp(userId, levelAfter) {
  return evaluateAndGrantForDomainEvent(userId, 'LEVEL_UP', {
    levelAfter: levelAfter,
  });
}

function fireAndForget(promise) {
  promise.catch(function (e) {
    console.error('[achievement-evaluator async]', e && e.message ? e.message : e);
  });
}

module.exports = {
  evaluateAndGrantForDomainEvent,
  evaluateAfterPostCreated,
  evaluateAfterCommentCreated,
  evaluateAfterEmpathyReceived,
  evaluateAfterActivityRecorded,
  evaluateAfterLevelUp,
  fireAndForget,
  mapOwnedForEval,
  buildEvalContext,
};
