'use strict';

const eventCore = require('../shared/user-domain-event-core');

function buildTerritoryEvolutionStageChangedPlan(input) {
  const src = input || {};
  if (!src.territory || src.nextStage == null) {
    return { ok: false, error: 'EVOLUTION_STAGE_INCOMPLETE' };
  }
  return {
    ok: true,
    event: eventCore.buildDomainEvent({
      eventType: eventCore.EVENT_TYPE.TERRITORY_EVOLUTION_STAGE_CHANGED,
      userId: src.userId || '00000000-0000-4000-8000-000000000001',
      dedupeKey: 'tevo:stage:' + src.territory + ':' + src.nextStage + ':' + (src.snapshotKey || 'snap'),
      payload: {
        territory: src.territory,
        previousStage: src.previousStage,
        nextStage: src.nextStage,
        population: src.population,
        snapshotKey: src.snapshotKey || null,
      },
      sourceSystem: 'TERRITORY_EVOLUTION',
    }),
    note: 'BROADCAST_TARGET_POLICY_NOT_FINALIZED',
    broadcastToAllUsers: false,
  };
}

module.exports = {
  buildTerritoryEvolutionStageChangedPlan,
  note: 'PLAN_ONLY_EVOLUTION_NOT_WIRED',
};
