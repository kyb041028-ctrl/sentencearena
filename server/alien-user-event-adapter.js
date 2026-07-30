'use strict';

const eventCore = require('../shared/user-domain-event-core');

function buildAlienWarningPlan(input) {
  return buildAlienEventPlan(eventCore.EVENT_TYPE.ALIEN_WARNING, input);
}

function buildAlienTransferredPlan(input) {
  return buildAlienEventPlan(eventCore.EVENT_TYPE.ALIEN_TRANSFERRED, input);
}

function buildAlienReturnEligiblePlan(input) {
  return buildAlienEventPlan(eventCore.EVENT_TYPE.ALIEN_RETURN_ELIGIBLE, input);
}

function buildAlienReturnedPlan(input) {
  return buildAlienEventPlan(eventCore.EVENT_TYPE.ALIEN_RETURNED, input);
}

function buildAlienPenaltyExtendedPlan(input) {
  return buildAlienEventPlan(eventCore.EVENT_TYPE.ALIEN_PENALTY_EXTENDED, input);
}

function buildAlienRankChangedPlan(input) {
  return buildAlienEventPlan(eventCore.EVENT_TYPE.ALIEN_RANK_CHANGED, input);
}

function buildWeeklyLegendPlan(input) {
  const src = input || {};
  return {
    ok: true,
    event: eventCore.buildDomainEvent({
      eventType: eventCore.EVENT_TYPE.ALIEN_WEEKLY_LEGEND_SELECTED,
      userId: src.userId,
      dedupeKey: 'alien:legend:' + (src.weekKey || 'week') + ':' + src.userId,
      payload: { weekKey: src.weekKey, rankPosition: src.rankPosition },
      sourceSystem: 'ALIEN_RANK',
    }),
    achievementInterface: { keyHint: 'became-legend', granted: false },
    note: 'WEEKLY_LEGEND_NOT_EXECUTED',
  };
}

function buildAlienEventPlan(type, input) {
  const src = input || {};
  if (!src.userId) return { ok: false, error: 'ALIEN_USER_REQUIRED' };
  const safe = eventCore.sanitizePayload({
    strikeCount: src.strikeCount,
    status: src.status,
  });
  return {
    ok: true,
    event: eventCore.buildDomainEvent({
      eventType: type,
      userId: src.userId,
      dedupeKey: 'alien:' + type + ':' + src.userId + ':' + (src.sourceId || 'evt'),
      payload: safe.payload,
      sourceSystem: 'ALIEN_MODERATION',
    }),
    note: 'MODERATION_NOT_CONNECTED',
  };
}

module.exports = {
  buildAlienWarningPlan,
  buildAlienTransferredPlan,
  buildAlienReturnEligiblePlan,
  buildAlienReturnedPlan,
  buildAlienPenaltyExtendedPlan,
  buildAlienRankChangedPlan,
  buildWeeklyLegendPlan,
};
