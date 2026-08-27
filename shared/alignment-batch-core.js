/**
 * 센텐스아레나 — alignment 배치 처리 코어
 * Node(CommonJS)와 브라우저(UMD) 양쪽에서 사용
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./alignment-territory-core'));
  } else {
    root.AlignmentBatchCore = factory(root.AlignmentTerritoryCore);
  }
})(typeof self !== 'undefined' ? self : this, function (territoryCore) {
  'use strict';

  var TERRITORY = Object.freeze({
    PIONEER: 'PIONEER',
    CENTRAL: 'CENTRAL',
    GUARDIAN: 'GUARDIAN',
    ALIEN: 'ALIEN',
    KANTAPBIYA: 'KANTAPBIYA',
  });

  var REACTION_TYPES = Object.freeze({
    LIKE: 'LIKE',
    RECOMMEND: 'RECOMMEND',
    DISLIKE: 'DISLIKE',
    DOWNVOTE: 'DOWNVOTE',
  });

  var CONFIG = Object.freeze({
    calculationMode: 'DELTA_WINDOW_SCORE',
    rollingWindowDays: 99,
    recentWindowDays: 30,
    rollingWindowRatio: 0.5,
    recentWindowRatio: 0.5,
    maxScoreChangePerBatch: 500,
    reactionWeights: Object.freeze({
      sameTerritoryPositive: 70,
      otherTerritoryPositive: 130,
      sameTerritoryNegative: 130,
      otherTerritoryNegative: 70,
      centralRelation: 100,
    }),
    territoryRulesSource: 'alignment-territory-rules.js',
    persistenceConnected: false,
    schedulerConnected: false,
  });

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function isValidDate(v) {
    return isFinite(new Date(v).getTime());
  }
  function isPositiveReaction(type) {
    return type === REACTION_TYPES.LIKE || type === REACTION_TYPES.RECOMMEND;
  }

  function getAlignmentBatchProcessorConfig() {
    return clone(CONFIG);
  }

  function normalizeState(raw) {
    var src = raw || {};
    return {
      userId: src.userId,
      alignmentScore: src.alignmentScore == null ? 0 : src.alignmentScore,
      currentTerritory: src.currentTerritory == null ? TERRITORY.CENTRAL : src.currentTerritory,
      previousAlignmentSignal: src.previousAlignmentSignal == null ? 0 : src.previousAlignmentSignal,
      pendingTerritory: src.pendingTerritory == null ? null : src.pendingTerritory,
      pendingTerritoryBatchCount: src.pendingTerritoryBatchCount == null ? 0 : src.pendingTerritoryBatchCount,
      pendingTerritoryStartedAt: src.pendingTerritoryStartedAt == null ? null : src.pendingTerritoryStartedAt,
      lastProcessedAlignmentBatchId: src.lastProcessedAlignmentBatchId == null ? null : src.lastProcessedAlignmentBatchId,
    };
  }

  function validateState(state) {
    var e = [];
    if (!state || typeof state !== 'object') return ['ALIGNMENT_STATE_OBJECT_REQUIRED'];
    if (!state.userId || typeof state.userId !== 'string' || !state.userId.trim()) e.push('ALIGNMENT_USER_ID_REQUIRED');
    if (!isFiniteNumber(state.alignmentScore)) e.push('ALIGNMENT_SCORE_INVALID');
    if (state.currentTerritory !== TERRITORY.PIONEER && state.currentTerritory !== TERRITORY.CENTRAL && state.currentTerritory !== TERRITORY.GUARDIAN) e.push('ALIGNMENT_TERRITORY_INVALID');
    if (!isFiniteNumber(state.previousAlignmentSignal)) e.push('ALIGNMENT_SIGNAL_INVALID');
    if (state.pendingTerritory != null && state.pendingTerritory !== TERRITORY.PIONEER && state.pendingTerritory !== TERRITORY.CENTRAL && state.pendingTerritory !== TERRITORY.GUARDIAN) e.push('ALIGNMENT_PENDING_TERRITORY_INVALID');
    if (!Number.isInteger(state.pendingTerritoryBatchCount) || state.pendingTerritoryBatchCount < 0) e.push('ALIGNMENT_PENDING_COUNT_INVALID');
    if (state.pendingTerritoryStartedAt != null && !isValidDate(state.pendingTerritoryStartedAt)) e.push('ALIGNMENT_PENDING_TIME_INVALID');
    return e;
  }

  function isKnownTerritory(v) {
    return v === TERRITORY.PIONEER || v === TERRITORY.CENTRAL || v === TERRITORY.GUARDIAN || v === TERRITORY.ALIEN || v === TERRITORY.KANTAPBIYA;
  }
  function isAlienTerritory(v) {
    return v === TERRITORY.ALIEN || v === TERRITORY.KANTAPBIYA;
  }

  function validateReaction(reaction) {
    var e = [];
    if (!reaction || typeof reaction !== 'object') return ['ALIGNMENT_REACTION_OBJECT_REQUIRED'];
    if (!reaction.reactionId || typeof reaction.reactionId !== 'string') e.push('ALIGNMENT_REACTION_ID_REQUIRED');
    if (!reaction.targetUserId || typeof reaction.targetUserId !== 'string') e.push('ALIGNMENT_TARGET_USER_ID_REQUIRED');
    if (reaction.reactionType !== REACTION_TYPES.LIKE && reaction.reactionType !== REACTION_TYPES.RECOMMEND && reaction.reactionType !== REACTION_TYPES.DISLIKE && reaction.reactionType !== REACTION_TYPES.DOWNVOTE) e.push('ALIGNMENT_REACTION_TYPE_INVALID');
    if (!isValidDate(reaction.createdAt)) e.push('ALIGNMENT_CREATED_AT_INVALID');
    if (reaction.cancelledAt != null && !isValidDate(reaction.cancelledAt)) e.push('ALIGNMENT_CANCELLED_AT_INVALID');
    if (!isKnownTerritory(reaction.actorTerritoryAtReaction)) e.push('ALIGNMENT_ACTOR_TERRITORY_INVALID');
    if (!isKnownTerritory(reaction.targetTerritoryAtReaction)) e.push('ALIGNMENT_TARGET_TERRITORY_INVALID');
    return e;
  }

  function relationMagnitude(actor, target, positive) {
    var w = CONFIG.reactionWeights;
    if (actor === TERRITORY.CENTRAL && target === TERRITORY.CENTRAL) return 0;
    if (actor === TERRITORY.CENTRAL || target === TERRITORY.CENTRAL) {
      return Number(w.centralRelation) || 100;
    }
    var same = actor === target;
    if (positive) return same ? w.sameTerritoryPositive : w.otherTerritoryPositive;
    return same ? w.sameTerritoryNegative : w.otherTerritoryNegative;
  }

  /**
   * Canonical signed delta.
   * Expected same-faction LIKE / opposite DISLIKE = 70.
   * Unexpected same-faction DISLIKE / opposite LIKE = 130.
   * Any CENTRAL↔pole relation = 100.
   * CENTRAL→CENTRAL = 0.
   * PIONEER actor: +positive / -negative
   * GUARDIAN actor: -positive / +negative
   * CENTRAL actor: uses TARGET territory.
   */
  function computeSignedDelta(reaction) {
    var positive = isPositiveReaction(reaction.reactionType);
    var actor = reaction && reaction.actorTerritoryAtReaction;
    var target = reaction && reaction.targetTerritoryAtReaction;
    var magnitude = relationMagnitude(actor, target, positive);

    if (actor === TERRITORY.PIONEER) return positive ? magnitude : -magnitude;
    if (actor === TERRITORY.GUARDIAN) return positive ? -magnitude : magnitude;
    if (actor === TERRITORY.CENTRAL) {
      if (target === TERRITORY.PIONEER) return positive ? magnitude : -magnitude;
      if (target === TERRITORY.GUARDIAN) return positive ? -magnitude : magnitude;
      if (target === TERRITORY.CENTRAL) return 0;
    }
    return 0;
  }

  function sumWindowSignal(reactions, targetUserId, batchTime, windowDays, scoreBeforeBatch, counters) {
    var batchMs = batchTime.getTime();
    var windowMs = windowDays * 86400000;
    var sum = 0;
    var i;
    for (i = 0; i < reactions.length; i++) {
      var reaction = reactions[i];
      if (!reaction || reaction.targetUserId !== targetUserId) continue;
      var created = new Date(reaction.createdAt).getTime();
      if (!isFinite(created) || created > batchMs) continue;
      if (batchMs - created > windowMs) continue;
      if (reaction.cancelledAt != null) {
        var cancelled = new Date(reaction.cancelledAt).getTime();
        if (isFinite(cancelled) && cancelled <= batchMs) {
          if (counters) counters.cancelledReactionExcludedCount += 1;
          continue;
        }
      }
      sum += computeSignedDelta(reaction);
    }
    return sum;
  }

  function processAlignmentUserBatch(input) {
    var raw = input || {};
    if (!raw.batchId || typeof raw.batchId !== 'string' || !raw.batchId.trim()) return { success: false, errors: ['ALIGNMENT_BATCH_ID_REQUIRED'], warnings: [], batchId: raw.batchId || null, batchTime: raw.batchTime || null, userId: raw.userState && raw.userState.userId ? raw.userState.userId : null };
    if (!isValidDate(raw.batchTime)) return { success: false, errors: ['ALIGNMENT_BATCH_TIME_INVALID'], warnings: [], batchId: raw.batchId, batchTime: raw.batchTime || null, userId: raw.userState && raw.userState.userId ? raw.userState.userId : null };
    if (!Array.isArray(raw.reactions)) return { success: false, errors: ['ALIGNMENT_REACTIONS_ARRAY_REQUIRED'], warnings: [], batchId: raw.batchId, batchTime: raw.batchTime, userId: raw.userState && raw.userState.userId ? raw.userState.userId : null };

    var batchId = raw.batchId;
    var batchTime = new Date(raw.batchTime);
    var batchTimeIso = batchTime.toISOString();
    var warnings = [];
    var errors = [];

    var state = normalizeState(raw.userState);
    var stateErrors = validateState(state);
    if (stateErrors.length) return { success: false, errors: stateErrors, warnings: warnings, batchId: batchId, batchTime: batchTimeIso, userId: state.userId || null };

    if (state.lastProcessedAlignmentBatchId === batchId) {
      return {
        success: true,
        skipped: true,
        skipReason: 'ALIGNMENT_BATCH_ALREADY_PROCESSED',
        batchId: batchId,
        batchTime: batchTimeIso,
        userId: state.userId,
        previousState: {
          alignmentScore: state.alignmentScore,
          currentTerritory: state.currentTerritory,
          previousAlignmentSignal: state.previousAlignmentSignal,
          pendingTerritory: state.pendingTerritory,
          pendingTerritoryBatchCount: state.pendingTerritoryBatchCount,
          pendingTerritoryStartedAt: state.pendingTerritoryStartedAt,
          lastProcessedAlignmentBatchId: state.lastProcessedAlignmentBatchId,
        },
        nextState: clone(state),
        errors: [],
        warnings: [],
      };
    }

    var validReactions = [];
    var invalidReactionCount = 0;
    var excludedAlienReactionCount = 0;
    var i;
    for (i = 0; i < raw.reactions.length; i++) {
      var reaction = raw.reactions[i];
      var reactionErrors = validateReaction(reaction);
      if (reactionErrors.length) {
        invalidReactionCount += 1;
        warnings.push({ code: 'ALIGNMENT_REACTION_EXCLUDED', reactionId: reaction && reaction.reactionId ? reaction.reactionId : null, detail: reactionErrors });
        continue;
      }
      if (reaction.targetUserId !== state.userId) continue;
      if (isAlienTerritory(reaction.actorTerritoryAtReaction) || isAlienTerritory(reaction.targetTerritoryAtReaction)) {
        excludedAlienReactionCount += 1;
        continue;
      }
      validReactions.push(reaction);
    }

    var previousAlignmentScore = state.alignmentScore;
    var previousAlignmentSignal = state.previousAlignmentSignal;
    var counters = { cancelledReactionExcludedCount: 0 };
    var rolling99DayScore = sumWindowSignal(validReactions, state.userId, batchTime, CONFIG.rollingWindowDays, previousAlignmentScore, counters);
    var recent30DayScore = sumWindowSignal(validReactions, state.userId, batchTime, CONFIG.recentWindowDays, previousAlignmentScore, null);
    var currentAlignmentSignal = rolling99DayScore * CONFIG.rollingWindowRatio + recent30DayScore * CONFIG.recentWindowRatio;
    var batchRawChange = currentAlignmentSignal - previousAlignmentSignal;
    var cappedChange = clamp(batchRawChange, -CONFIG.maxScoreChangePerBatch, CONFIG.maxScoreChangePerBatch);
    var capApplied = cappedChange !== batchRawChange;
    var nextAlignmentScore = previousAlignmentScore + cappedChange;

    if (!territoryCore || typeof territoryCore.evaluateTerritoryTransition !== 'function') {
      return { success: false, errors: ['ALIGNMENT_RULES_MODULE_NOT_AVAILABLE'], warnings: warnings, batchId: batchId, batchTime: batchTimeIso, userId: state.userId };
    }

    var territoryTransition = territoryCore.evaluateTerritoryTransition({
      alignmentScore: nextAlignmentScore,
      currentTerritory: state.currentTerritory,
      pendingTerritory: state.pendingTerritory,
      pendingTerritoryBatchCount: state.pendingTerritoryBatchCount,
      pendingTerritoryStartedAt: state.pendingTerritoryStartedAt,
    }, batchTimeIso);

    var nextState = {
      userId: state.userId,
      alignmentScore: nextAlignmentScore,
      currentTerritory: territoryTransition.nextTerritory,
      previousAlignmentSignal: currentAlignmentSignal,
      pendingTerritory: territoryTransition.pendingTerritory,
      pendingTerritoryBatchCount: territoryTransition.pendingTerritoryBatchCount,
      pendingTerritoryStartedAt: territoryTransition.pendingTerritoryStartedAt,
      lastProcessedAlignmentBatchId: batchId,
    };

    return {
      success: true,
      batchId: batchId,
      batchTime: batchTimeIso,
      userId: state.userId,
      previousState: {
        alignmentScore: previousAlignmentScore,
        currentTerritory: state.currentTerritory,
        previousAlignmentSignal: previousAlignmentSignal,
        pendingTerritory: state.pendingTerritory,
        pendingTerritoryBatchCount: state.pendingTerritoryBatchCount,
        pendingTerritoryStartedAt: state.pendingTerritoryStartedAt,
        lastProcessedAlignmentBatchId: state.lastProcessedAlignmentBatchId,
      },
      scoreCalculation: {
        rolling99DayScore: rolling99DayScore,
        recent30DayScore: recent30DayScore,
        previousAlignmentSignal: previousAlignmentSignal,
        currentAlignmentSignal: currentAlignmentSignal,
        batchRawChange: batchRawChange,
        cappedChange: cappedChange,
        capApplied: capApplied,
        previousAlignmentScore: previousAlignmentScore,
        nextAlignmentScore: nextAlignmentScore,
      },
      territoryTransition: {
        previousTerritory: territoryTransition.previousTerritory,
        candidateTerritory: territoryTransition.candidateTerritory,
        nextTerritory: territoryTransition.nextTerritory,
        territoryChanged: !!territoryTransition.territoryChanged,
        pendingTerritory: territoryTransition.pendingTerritory,
        pendingTerritoryBatchCount: territoryTransition.pendingTerritoryBatchCount,
        pendingTerritoryStartedAt: territoryTransition.pendingTerritoryStartedAt,
        transitionReason: territoryTransition.transitionReason,
      },
      nextState: nextState,
      metrics: {
        invalidReactionCount: invalidReactionCount,
        excludedAlienReactionCount: excludedAlienReactionCount,
        cancelledReactionExcludedCount: counters.cancelledReactionExcludedCount,
      },
      errors: errors,
      warnings: warnings,
    };
  }

  function buildSummary(totalUsers, batchId, batchTimeIso) {
    return {
      totalUsers: totalUsers,
      processedUsers: 0,
      skippedUsers: 0,
      failedUsers: 0,
      totalScoreIncrease: 0,
      totalScoreDecrease: 0,
      unchangedScoreUsers: 0,
      positiveScoreChangeUsers: 0,
      negativeScoreChangeUsers: 0,
      zeroScoreChangeUsers: 0,
      capAppliedUsers: 0,
      territoryChangedUsers: 0,
      pendingStartedUsers: 0,
      pendingContinuedUsers: 0,
      pendingResetUsers: 0,
      pioneerEntries: 0,
      guardianEntries: 0,
      centralReturns: 0,
      invalidReactionCount: 0,
      excludedAlienReactionCount: 0,
      cancelledReactionExcludedCount: 0,
      batchId: batchId,
      batchTime: batchTimeIso,
    };
  }

  function processAlignmentBatch(input) {
    var raw = input || {};
    if (!raw.batchId || typeof raw.batchId !== 'string' || !raw.batchId.trim()) return { success: false, batchId: raw.batchId || null, batchTime: raw.batchTime || null, summary: buildSummary(0, raw.batchId || null, raw.batchTime || null), userResults: [], errors: ['ALIGNMENT_BATCH_ID_REQUIRED'], warnings: [] };
    if (!isValidDate(raw.batchTime)) return { success: false, batchId: raw.batchId, batchTime: raw.batchTime || null, summary: buildSummary(Array.isArray(raw.users) ? raw.users.length : 0, raw.batchId, raw.batchTime || null), userResults: [], errors: ['ALIGNMENT_BATCH_TIME_INVALID'], warnings: [] };
    if (!Array.isArray(raw.users)) return { success: false, batchId: raw.batchId, batchTime: raw.batchTime, summary: buildSummary(0, raw.batchId, raw.batchTime), userResults: [], errors: ['ALIGNMENT_USERS_ARRAY_REQUIRED'], warnings: [] };
    if (!Array.isArray(raw.reactions)) return { success: false, batchId: raw.batchId, batchTime: raw.batchTime, summary: buildSummary(raw.users.length, raw.batchId, raw.batchTime), userResults: [], errors: ['ALIGNMENT_REACTIONS_ARRAY_REQUIRED'], warnings: [] };

    var batchTimeIso = new Date(raw.batchTime).toISOString();
    var summary = buildSummary(raw.users.length, raw.batchId, batchTimeIso);
    var userResults = [];
    var errors = [];
    var warnings = [];
    var i;

    for (i = 0; i < raw.users.length; i++) {
      var result = processAlignmentUserBatch({
        batchId: raw.batchId,
        batchTime: batchTimeIso,
        userState: clone(raw.users[i]),
        reactions: raw.reactions.slice(),
      });
      userResults.push(result);

      if (!result.success) {
        summary.failedUsers += 1;
        errors.push({ code: 'ALIGNMENT_BATCH_ERROR', userId: result.userId || null, detail: result.errors || [] });
        continue;
      }
      if (result.skipped) {
        summary.skippedUsers += 1;
        continue;
      }

      summary.processedUsers += 1;
      if (result.scoreCalculation.capApplied) summary.capAppliedUsers += 1;
      if (result.territoryTransition.territoryChanged) summary.territoryChangedUsers += 1;
      if (result.territoryTransition.transitionReason === 'PENDING_START' || result.territoryTransition.transitionReason === 'PENDING_RESTARTED') summary.pendingStartedUsers += 1;
      if (result.territoryTransition.transitionReason === 'PENDING_CONTINUE') summary.pendingContinuedUsers += 1;
      if (result.territoryTransition.transitionReason === 'PENDING_CLEARED') summary.pendingResetUsers += 1;

      var diff = result.scoreCalculation.cappedChange;
      if (diff > 0) {
        summary.positiveScoreChangeUsers += 1;
        summary.totalScoreIncrease += diff;
      } else if (diff < 0) {
        summary.negativeScoreChangeUsers += 1;
        summary.totalScoreDecrease += diff;
      } else {
        summary.zeroScoreChangeUsers += 1;
        summary.unchangedScoreUsers += 1;
      }

      var prev = result.territoryTransition.previousTerritory;
      var next = result.territoryTransition.nextTerritory;
      if (prev === TERRITORY.CENTRAL && next === TERRITORY.PIONEER) summary.pioneerEntries += 1;
      if (prev === TERRITORY.CENTRAL && next === TERRITORY.GUARDIAN) summary.guardianEntries += 1;
      if ((prev === TERRITORY.PIONEER || prev === TERRITORY.GUARDIAN) && next === TERRITORY.CENTRAL) summary.centralReturns += 1;

      summary.invalidReactionCount += result.metrics.invalidReactionCount || 0;
      summary.excludedAlienReactionCount += result.metrics.excludedAlienReactionCount || 0;
      summary.cancelledReactionExcludedCount += result.metrics.cancelledReactionExcludedCount || 0;
      if (result.warnings && result.warnings.length) warnings = warnings.concat(result.warnings);
    }

    return {
      success: errors.length === 0,
      batchId: raw.batchId,
      batchTime: batchTimeIso,
      summary: summary,
      userResults: userResults,
      errors: errors,
      warnings: warnings,
    };
  }

  return {
    getAlignmentBatchProcessorConfig: getAlignmentBatchProcessorConfig,
    processAlignmentUserBatch: processAlignmentUserBatch,
    processAlignmentBatch: processAlignmentBatch,
    computeSignedDelta: computeSignedDelta,
    relationMagnitude: relationMagnitude,
    CONFIG: CONFIG,
    TERRITORY: TERRITORY,
    REACTION_TYPES: REACTION_TYPES,
  };
});
