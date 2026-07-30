'use strict';

const eventCore = require('../shared/user-domain-event-core');
const citizenCore = require('../shared/citizen-rank-evaluation-core');

function buildTerritoryChangedPlan(input) {
  const src = input || {};
  if (!src.userId || !src.nextTerritory) {
    return { ok: false, error: 'TERRITORY_CHANGE_INCOMPLETE' };
  }
  return {
    ok: true,
    event: eventCore.buildDomainEvent({
      eventType: eventCore.EVENT_TYPE.TERRITORY_CHANGED,
      userId: src.userId,
      dedupeKey: 'alignment:territory:' + src.userId + ':' + (src.batchId || 'batch'),
      payload: {
        previousTerritory: src.previousTerritory || null,
        nextTerritory: src.nextTerritory,
        batchId: src.batchId || null,
      },
      sourceSystem: 'ALIGNMENT_BATCH',
    }),
    citizenRankEvaluation: citizenCore.evaluateCitizenRank({
      currentRank: src.currentCitizenRank,
      batchContext: src.batchContext,
    }),
    note: 'ALIGNMENT_BATCH_NOT_CONNECTED',
  };
}

function buildCitizenRankChangedPlan() {
  return {
    ok: false,
    error: 'CITIZEN_RANK_POLICY_NOT_FINALIZED',
    note: 'NO_EVENT_WITHOUT_FINALIZED_POLICY',
  };
}

module.exports = {
  buildTerritoryChangedPlan,
  buildCitizenRankChangedPlan,
  note: 'PLAN_ONLY_ALIGNMENT_NOT_WIRED',
};
