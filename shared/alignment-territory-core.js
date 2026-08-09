/**
 * 센텐스아레나 — alignment 영토 판정 코어
 * Node(CommonJS)와 브라우저(UMD) 양쪽에서 사용
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlignmentTerritoryCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function alignmentTerritoryCoreFactory() {
  'use strict';

  var TERRITORY = Object.freeze({
    PIONEER: 'PIONEER',
    CENTRAL: 'CENTRAL',
    GUARDIAN: 'GUARDIAN',
  });

  var ALIGNMENT_TERRITORY_RULES = Object.freeze({
    centralMin: -1000,
    centralMax: 1000,
    pioneerEntryMin: 1001,
    guardianEntryMax: -1001,
    pioneerExitMax: 800,
    guardianExitMin: -800,
    requiredConsecutiveBatches: 2,
    directSideSwitchAllowed: false,
  });

  var TRANSITION_REASON = Object.freeze({
    HOLD: 'HOLD',
    PENDING_START: 'PENDING_START',
    PENDING_CONTINUE: 'PENDING_CONTINUE',
    CONFIRMED: 'CONFIRMED',
    PENDING_CLEARED: 'PENDING_CLEARED',
    PENDING_RESTARTED: 'PENDING_RESTARTED',
  });

  function normalizeTerritory(value) {
    if (value === TERRITORY.PIONEER || value === TERRITORY.CENTRAL || value === TERRITORY.GUARDIAN) {
      return value;
    }
    return TERRITORY.CENTRAL;
  }

  function normalizeAlignmentScore(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function getAlignmentTerritoryRules() {
    return {
      centralMin: ALIGNMENT_TERRITORY_RULES.centralMin,
      centralMax: ALIGNMENT_TERRITORY_RULES.centralMax,
      pioneerEntryMin: ALIGNMENT_TERRITORY_RULES.pioneerEntryMin,
      guardianEntryMax: ALIGNMENT_TERRITORY_RULES.guardianEntryMax,
      pioneerExitMax: ALIGNMENT_TERRITORY_RULES.pioneerExitMax,
      guardianExitMin: ALIGNMENT_TERRITORY_RULES.guardianExitMin,
      requiredConsecutiveBatches: ALIGNMENT_TERRITORY_RULES.requiredConsecutiveBatches,
      directSideSwitchAllowed: ALIGNMENT_TERRITORY_RULES.directSideSwitchAllowed,
    };
  }

  function createAlignmentTerritoryState(partial) {
    var src = partial || {};
    return {
      alignmentScore: normalizeAlignmentScore(src.alignmentScore),
      currentTerritory: normalizeTerritory(src.currentTerritory),
      pendingTerritory: src.pendingTerritory == null ? null : normalizeTerritory(src.pendingTerritory),
      pendingTerritoryBatchCount: Math.max(0, Number(src.pendingTerritoryBatchCount) || 0),
      pendingTerritoryStartedAt: src.pendingTerritoryStartedAt == null ? null : src.pendingTerritoryStartedAt,
    };
  }

  function resetPendingTerritory(state) {
    var base = createAlignmentTerritoryState(state);
    return {
      alignmentScore: base.alignmentScore,
      currentTerritory: base.currentTerritory,
      pendingTerritory: null,
      pendingTerritoryBatchCount: 0,
      pendingTerritoryStartedAt: null,
    };
  }

  function getTerritoryCandidate(state) {
    var s = createAlignmentTerritoryState(state);
    var score = s.alignmentScore;
    var cur = s.currentTerritory;
    var rules = ALIGNMENT_TERRITORY_RULES;

    if (cur === TERRITORY.CENTRAL) {
      if (score >= rules.pioneerEntryMin) return TERRITORY.PIONEER;
      if (score <= rules.guardianEntryMax) return TERRITORY.GUARDIAN;
      return TERRITORY.CENTRAL;
    }
    if (cur === TERRITORY.PIONEER) {
      if (score <= rules.pioneerExitMax) return TERRITORY.CENTRAL;
      return TERRITORY.PIONEER;
    }
    if (cur === TERRITORY.GUARDIAN) {
      if (score >= rules.guardianExitMin) return TERRITORY.CENTRAL;
      return TERRITORY.GUARDIAN;
    }
    return TERRITORY.CENTRAL;
  }

  function evaluateTerritoryTransition(state, batchTime) {
    var current = createAlignmentTerritoryState(state);
    var previousTerritory = current.currentTerritory;
    var candidateTerritory = getTerritoryCandidate(current);
    var required = ALIGNMENT_TERRITORY_RULES.requiredConsecutiveBatches;
    var score = current.alignmentScore;
    var batchIso = batchTime == null ? null : batchTime;

    if (candidateTerritory === previousTerritory) {
      var hadPending = current.pendingTerritory != null || current.pendingTerritoryBatchCount > 0;
      return {
        previousTerritory: previousTerritory,
        candidateTerritory: candidateTerritory,
        nextTerritory: previousTerritory,
        territoryChanged: false,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        requiredConsecutiveBatches: required,
        transitionReason: hadPending ? TRANSITION_REASON.PENDING_CLEARED : TRANSITION_REASON.HOLD,
        alignmentScore: score,
      };
    }

    var pendingTerritory = current.pendingTerritory;
    var pendingCount = current.pendingTerritoryBatchCount || 0;
    var pendingStartedAt = current.pendingTerritoryStartedAt;
    var reason;

    if (pendingTerritory !== candidateTerritory) {
      pendingTerritory = candidateTerritory;
      pendingCount = 1;
      pendingStartedAt = batchIso;
      reason =
        current.pendingTerritory != null && current.pendingTerritory !== candidateTerritory
          ? TRANSITION_REASON.PENDING_RESTARTED
          : TRANSITION_REASON.PENDING_START;
    } else {
      pendingCount += 1;
      reason = TRANSITION_REASON.PENDING_CONTINUE;
    }

    if (pendingCount >= required) {
      return {
        previousTerritory: previousTerritory,
        candidateTerritory: candidateTerritory,
        nextTerritory: candidateTerritory,
        territoryChanged: true,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        requiredConsecutiveBatches: required,
        transitionReason: TRANSITION_REASON.CONFIRMED,
        alignmentScore: score,
      };
    }

    return {
      previousTerritory: previousTerritory,
      candidateTerritory: candidateTerritory,
      nextTerritory: previousTerritory,
      territoryChanged: false,
      pendingTerritory: pendingTerritory,
      pendingTerritoryBatchCount: pendingCount,
      pendingTerritoryStartedAt: pendingStartedAt,
      requiredConsecutiveBatches: required,
      transitionReason: reason,
      alignmentScore: score,
    };
  }

  function applyEvaluationToState(state, evaluation) {
    return {
      alignmentScore: normalizeAlignmentScore(state && state.alignmentScore),
      currentTerritory: evaluation.nextTerritory,
      pendingTerritory: evaluation.pendingTerritory,
      pendingTerritoryBatchCount: evaluation.pendingTerritoryBatchCount,
      pendingTerritoryStartedAt: evaluation.pendingTerritoryStartedAt,
    };
  }

  return {
    TERRITORY: TERRITORY,
    TRANSITION_REASON: TRANSITION_REASON,
    getAlignmentTerritoryRules: getAlignmentTerritoryRules,
    createAlignmentTerritoryState: createAlignmentTerritoryState,
    resetPendingTerritory: resetPendingTerritory,
    getTerritoryCandidate: getTerritoryCandidate,
    evaluateTerritoryTransition: evaluateTerritoryTransition,
    applyEvaluationToState: applyEvaluationToState,
  };
});
