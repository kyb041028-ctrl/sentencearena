/**
 * BETA ALIGNMENT V1 canonical math.
 * Daily Issue + actor-self + author-received. Does not revive browser 3-axis localStorage.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./alignment-batch-core'));
  } else {
    root.PoliticalAlignmentBetaV1Core = factory(root.AlignmentBatchCore);
  }
})(typeof self !== 'undefined' ? self : this, function (batchCore) {
  'use strict';

  var POLICIES = Object.freeze({
    VERSION: 'BETA_V1',
    SCORE_AXIS: 'PIONEER_PLUS_GUARDIAN_MINUS',
    ACTOR_SELF: 'ACTIVE',
    AUTHOR_RECEIVED: 'ACTIVE',
    DAILY_ISSUE: 'BLOCKED_BY_CONTENT_SCHEMA',
    PAIR_ALIGNMENT_7D_CAP: 120,
    COMMUNITY_ALIGNMENT_DAILY_CAP: 240,
    DAILY_ISSUE_DAILY_CAP: 120,
    BATCH_CAP: 500,
    EXIT_ABS: 360,
    RETURN_ABS: 160,
    REQUIRED_CONSECUTIVE_BATCHES: 2,
    MIN_TERRITORY_STAY_HOURS: 48,
    GRADUAL_DEADZONE: 40,
    GRADUAL_FULL_AT: 200,
    TERRITORY_MOVE: 'SERVER_INTERNAL_BATCH',
    TERRITORY_SELF_WRITE: 'NOT_ALLOWED',
    DIRECT_SIDE_SWITCH: false,
    ALIEN_EXCLUDED: true,
    EMPATHY: 0,
    REPORT: 0,
    POST_WRITE: 0,
    COMMENT_WRITE: 0,
  });

  var TERRITORY = Object.freeze({
    PIONEER: 'PIONEER',
    CENTRAL: 'CENTRAL',
    GUARDIAN: 'GUARDIAN',
    ALIEN: 'ALIEN',
    KANTAPBIYA: 'KANTAPBIYA',
  });

  var DAILY_ISSUE_VALUES = Object.freeze({
    STRONG_PIONEER: 120,
    MODERATE_PIONEER: 60,
    NEUTRAL_OR_UNSURE: 0,
    MODERATE_GUARDIAN: -60,
    STRONG_GUARDIAN: -120,
  });

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function isAlien(v) {
    var t = String(v || '').toUpperCase();
    return t === TERRITORY.ALIEN || t === TERRITORY.KANTAPBIYA;
  }

  function isPositiveReaction(type) {
    var t = String(type || '').toUpperCase();
    return t === 'LIKE' || t === 'RECOMMEND';
  }

  function isNegativeReaction(type) {
    var t = String(type || '').toUpperCase();
    return t === 'DISLIKE' || t === 'DOWNVOTE';
  }

  function isAlignmentReactionType(type) {
    return isPositiveReaction(type) || isNegativeReaction(type);
  }

  function gradualStrength(scoreSnapshot) {
    if (scoreSnapshot == null || !isFiniteNumber(Number(scoreSnapshot))) return 0;
    var n = Math.abs(Number(scoreSnapshot) || 0);
    if (n <= POLICIES.GRADUAL_DEADZONE) return 0;
    var span = POLICIES.GRADUAL_FULL_AT - POLICIES.GRADUAL_DEADZONE;
    if (!(span > 0)) return 1;
    return Math.min((n - POLICIES.GRADUAL_DEADZONE) / span, 1);
  }

  function effectiveLean(territory, scoreSnapshot) {
    var terr = String(territory || '').toUpperCase();
    if (terr === TERRITORY.PIONEER) return TERRITORY.PIONEER;
    if (terr === TERRITORY.GUARDIAN) return TERRITORY.GUARDIAN;
    if (terr === TERRITORY.CENTRAL) {
      if (scoreSnapshot == null || !isFiniteNumber(Number(scoreSnapshot))) return null;
      var s = Number(scoreSnapshot) || 0;
      if (s > 0 && gradualStrength(s) > 0) return TERRITORY.PIONEER;
      if (s < 0 && gradualStrength(s) > 0) return TERRITORY.GUARDIAN;
      return null;
    }
    return null;
  }

  function ssotSigned(actorTerr, targetTerr, type) {
    if (batchCore && typeof batchCore.computeSignedDelta === 'function') {
      return Number(
        batchCore.computeSignedDelta({
          reactionType: type,
          actorTerritoryAtReaction: actorTerr,
          targetTerritoryAtReaction: targetTerr,
        })
      ) || 0;
    }
    return 0;
  }

  function targetLeanSign(lean, positive) {
    if (lean === TERRITORY.PIONEER) return positive ? 1 : -1;
    if (lean === TERRITORY.GUARDIAN) return positive ? -1 : 1;
    return 0;
  }

  function zero(reason) {
    return { signed: 0, strength: 0, effectiveLean: null, reason: reason || 'ZERO' };
  }

  /**
   * ACTOR_SELF: target-lean sign * 80/120 magnitude * CENTRAL target strength.
   */
  function computeActorSelfSigned(input) {
    var src = input || {};
    var type = String(src.reactionType || '').toUpperCase();
    var actor = String(src.actorTerritory || '').toUpperCase();
    var targetTerr = String(src.targetTerritory || '').toUpperCase();
    if (src.selfReaction) return zero('SELF_REACTION');
    if (!isAlignmentReactionType(type)) return zero('TYPE_EXCLUDED');
    if (isAlien(actor) || isAlien(targetTerr)) return zero('ALIEN_EXCLUDED');
    var scoreSnap = src.targetAlignmentScoreAtReaction;
    var lean;
    var strength = 1;
    if (targetTerr === TERRITORY.CENTRAL) {
      if (scoreSnap == null) return zero('CENTRAL_TARGET_NO_SNAPSHOT');
      strength = gradualStrength(scoreSnap);
      lean = effectiveLean(TERRITORY.CENTRAL, scoreSnap);
      if (!lean || strength === 0) return zero('TARGET_STRENGTH_ZERO');
    } else {
      lean = effectiveLean(targetTerr, scoreSnap);
    }
    if (!lean) return zero('NO_TARGET_LEAN');
    var unsigned = Math.abs(ssotSigned(actor, lean, type));
    var signed = targetLeanSign(lean, isPositiveReaction(type)) * unsigned * strength;
    return {
      signed: signed,
      strength: strength,
      effectiveLean: lean,
      reason: targetTerr === TERRITORY.CENTRAL ? 'ACTOR_SELF_CENTRAL_GRADUAL' : 'ACTOR_SELF',
    };
  }

  /**
   * AUTHOR_RECEIVED: existing actor-sign 80/120. CENTRAL actor uses actor score snapshot.
   * CENTRAL author still receives PIONEER/GUARDIAN source as other-territory signal.
   * Legacy rows with null actor score snapshot keep computeSignedDelta(CENTRAL, target).
   */
  function computeAuthorReceivedSigned(input) {
    var src = input || {};
    var type = String(src.reactionType || '').toUpperCase();
    var actor = String(src.actorTerritory || '').toUpperCase();
    var targetTerr = String(src.targetTerritory || '').toUpperCase();
    if (src.selfReaction) return zero('SELF_REACTION');
    if (!isAlignmentReactionType(type)) return zero('TYPE_EXCLUDED');
    if (isAlien(actor) || isAlien(targetTerr)) return zero('ALIEN_EXCLUDED');

    if (actor === TERRITORY.CENTRAL) {
      var actorSnap = src.actorAlignmentScoreAtReaction;
      if (actorSnap == null) {
        return {
          signed: ssotSigned(TERRITORY.CENTRAL, targetTerr === TERRITORY.CENTRAL ? TERRITORY.CENTRAL : targetTerr, type),
          strength: 1,
          effectiveLean: null,
          reason: 'AUTHOR_RECEIVED_LEGACY_CENTRAL_ACTOR',
        };
      }
      var strength = gradualStrength(actorSnap);
      var lean = effectiveLean(TERRITORY.CENTRAL, actorSnap);
      if (!lean || strength === 0) return zero('ACTOR_STRENGTH_ZERO');
      var magTarget = targetTerr === TERRITORY.CENTRAL ? (lean === TERRITORY.PIONEER ? TERRITORY.GUARDIAN : TERRITORY.PIONEER) : targetTerr;
      return {
        signed: ssotSigned(lean, magTarget, type) * strength,
        strength: strength,
        effectiveLean: lean,
        reason: 'AUTHOR_RECEIVED_CENTRAL_ACTOR_GRADUAL',
      };
    }

    var hasScoreSnapshot =
      src.actorAlignmentScoreAtReaction != null || src.targetAlignmentScoreAtReaction != null;
    if (targetTerr === TERRITORY.CENTRAL && !hasScoreSnapshot) {
      return {
        signed: ssotSigned(actor, TERRITORY.CENTRAL, type),
        strength: 1,
        effectiveLean: actor,
        reason: 'AUTHOR_RECEIVED_LEGACY_CENTRAL_AUTHOR',
      };
    }

    var recvTarget = targetTerr;
    if (targetTerr === TERRITORY.CENTRAL) {
      recvTarget = actor === TERRITORY.PIONEER ? TERRITORY.GUARDIAN : TERRITORY.PIONEER;
    }
    return {
      signed: ssotSigned(actor, recvTarget, type),
      strength: 1,
      effectiveLean: actor,
      reason: targetTerr === TERRITORY.CENTRAL ? 'AUTHOR_RECEIVED_CENTRAL_AUTHOR' : 'AUTHOR_RECEIVED',
    };
  }

  function applyPairAlignmentCap(priorAbsSum, incomingSigned, cap) {
    var lim = isFiniteNumber(cap) ? Math.abs(cap) : POLICIES.PAIR_ALIGNMENT_7D_CAP;
    var used = Math.max(0, Number(priorAbsSum) || 0);
    var remaining = Math.max(0, lim - used);
    var add = Number(incomingSigned) || 0;
    var mag = Math.abs(add);
    if (remaining <= 0 || add === 0) {
      return { stored: 0, capHit: mag > 0, remaining: remaining };
    }
    if (mag <= remaining) {
      return { stored: add, capHit: false, remaining: remaining - mag };
    }
    return { stored: (add < 0 ? -1 : 1) * remaining, capHit: true, remaining: 0 };
  }

  function applySignedDailyCap(existingSum, incoming, cap) {
    var lim = isFiniteNumber(cap) ? Math.abs(cap) : POLICIES.COMMUNITY_ALIGNMENT_DAILY_CAP;
    var have = Number(existingSum) || 0;
    var add = Number(incoming) || 0;
    var next = clamp(have + add, -lim, lim);
    var stored = next - have;
    return { stored: stored, capHit: stored !== add, nextSum: next, cap: lim };
  }

  function seoulDayKey(iso) {
    var dt = new Date(iso);
    if (!isFinite(dt.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dt);
  }

  function inWindow(createdAt, asOf, days) {
    var created = new Date(createdAt).getTime();
    var end = new Date(asOf).getTime();
    if (!isFinite(created) || !isFinite(end)) return false;
    var age = (end - created) / 86400000;
    return age >= 0 && age <= days;
  }

  function getTerritoryCandidate(state) {
    var score = Number(state && state.alignmentScore) || 0;
    var cur = String((state && state.currentTerritory) || TERRITORY.CENTRAL).toUpperCase();
    if (cur === TERRITORY.ALIEN || cur === TERRITORY.KANTAPBIYA) return cur;
    if (cur === TERRITORY.CENTRAL) {
      if (score >= POLICIES.EXIT_ABS) return TERRITORY.PIONEER;
      if (score <= -POLICIES.EXIT_ABS) return TERRITORY.GUARDIAN;
      return TERRITORY.CENTRAL;
    }
    if (cur === TERRITORY.PIONEER) {
      if (score <= POLICIES.RETURN_ABS) return TERRITORY.CENTRAL;
      return TERRITORY.PIONEER;
    }
    if (cur === TERRITORY.GUARDIAN) {
      if (score >= -POLICIES.RETURN_ABS) return TERRITORY.CENTRAL;
      return TERRITORY.GUARDIAN;
    }
    return TERRITORY.CENTRAL;
  }

  function evaluateTerritoryTransition(state, batchTime) {
    var currentTerritory = String((state && state.currentTerritory) || TERRITORY.CENTRAL).toUpperCase();
    var score = Number(state && state.alignmentScore) || 0;
    var required = POLICIES.REQUIRED_CONSECUTIVE_BATCHES;
    if (currentTerritory === TERRITORY.ALIEN || currentTerritory === TERRITORY.KANTAPBIYA) {
      return {
        previousTerritory: currentTerritory,
        candidateTerritory: currentTerritory,
        nextTerritory: currentTerritory,
        territoryChanged: false,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        lastTerritoryChangedAt: state && state.lastTerritoryChangedAt,
        transitionReason: 'ALIEN_EXCLUDED',
        alignmentScore: score,
      };
    }

    var candidateTerritory = getTerritoryCandidate({
      alignmentScore: score,
      currentTerritory: currentTerritory,
    });
    if (
      (currentTerritory === TERRITORY.PIONEER || currentTerritory === TERRITORY.GUARDIAN) &&
      candidateTerritory === TERRITORY.CENTRAL &&
      state &&
      state.lastTerritoryChangedAt
    ) {
      var enteredMs = new Date(state.lastTerritoryChangedAt).getTime();
      var batchMs = new Date(batchTime).getTime();
      if (isFinite(enteredMs) && isFinite(batchMs) && batchMs - enteredMs < POLICIES.MIN_TERRITORY_STAY_HOURS * 3600000) {
        candidateTerritory = currentTerritory;
      }
    }

    if (candidateTerritory === currentTerritory) {
      var hadPending = (state && state.pendingTerritory) != null || (state && Number(state.pendingTerritoryBatchCount) > 0);
      return {
        previousTerritory: currentTerritory,
        candidateTerritory: candidateTerritory,
        nextTerritory: currentTerritory,
        territoryChanged: false,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        lastTerritoryChangedAt: state && state.lastTerritoryChangedAt,
        transitionReason: hadPending ? 'PENDING_CLEARED' : 'HOLD',
        alignmentScore: score,
      };
    }

    var pendingTerritory = state && state.pendingTerritory != null ? state.pendingTerritory : null;
    var pendingCount = Math.max(0, Number(state && state.pendingTerritoryBatchCount) || 0);
    var pendingStartedAt = state && state.pendingTerritoryStartedAt;
    var reason;
    if (pendingTerritory !== candidateTerritory) {
      pendingTerritory = candidateTerritory;
      pendingCount = 1;
      pendingStartedAt = batchTime || null;
      reason = state && state.pendingTerritory != null && state.pendingTerritory !== candidateTerritory ? 'PENDING_RESTARTED' : 'PENDING_START';
    } else {
      pendingCount += 1;
      reason = 'PENDING_CONTINUE';
    }

    if (pendingCount >= required) {
      return {
        previousTerritory: currentTerritory,
        candidateTerritory: candidateTerritory,
        nextTerritory: candidateTerritory,
        territoryChanged: true,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        lastTerritoryChangedAt: batchTime || null,
        transitionReason: 'CONFIRMED',
        alignmentScore: score,
      };
    }

    return {
      previousTerritory: currentTerritory,
      candidateTerritory: candidateTerritory,
      nextTerritory: currentTerritory,
      territoryChanged: false,
      pendingTerritory: pendingTerritory,
      pendingTerritoryBatchCount: pendingCount,
      pendingTerritoryStartedAt: pendingStartedAt,
      lastTerritoryChangedAt: state && state.lastTerritoryChangedAt,
      transitionReason: reason,
      alignmentScore: score,
    };
  }

  function dailyIssueSignedDelta(band) {
    var key = String(band || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(DAILY_ISSUE_VALUES, key)) return 0;
    return DAILY_ISSUE_VALUES[key];
  }

  return {
    POLICIES: POLICIES,
    TERRITORY: TERRITORY,
    DAILY_ISSUE_VALUES: DAILY_ISSUE_VALUES,
    gradualStrength: gradualStrength,
    effectiveLean: effectiveLean,
    computeActorSelfSigned: computeActorSelfSigned,
    computeAuthorReceivedSigned: computeAuthorReceivedSigned,
    applyPairAlignmentCap: applyPairAlignmentCap,
    applySignedDailyCap: applySignedDailyCap,
    seoulDayKey: seoulDayKey,
    inWindow: inWindow,
    evaluateTerritoryTransition: evaluateTerritoryTransition,
    getTerritoryCandidate: getTerritoryCandidate,
    dailyIssueSignedDelta: dailyIssueSignedDelta,
    isAlignmentReactionType: isAlignmentReactionType,
  };
});
