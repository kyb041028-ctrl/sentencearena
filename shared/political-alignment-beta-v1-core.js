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
    DAILY_ISSUE: 'ACTIVE_SEED',
    PAIR_ALIGNMENT_7D_CAP: 120,
    COMMUNITY_ALIGNMENT_DAILY_CAP: 240,
    DAILY_ISSUE_DAILY_CAP: 180,
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
    ACTOR_SELF_RATIO: 0.25,
    ACTOR_SELF_DAILY_CAP: 60,
    ACCEL_MIN_DIRECTIONAL: 4,
    ACCEL_CONSISTENCY: 0.7,
    ACCEL_APPROACH_ABS: 240,
    ACCEL_MAX: 1.3,
    STREAK_NO_BACKFILL: true,
  });

  var TERRITORY = Object.freeze({
    PIONEER: 'PIONEER',
    CENTRAL: 'CENTRAL',
    GUARDIAN: 'GUARDIAN',
    ALIEN: 'ALIEN',
    KANTAPBIYA: 'KANTAPBIYA',
  });

  var DAILY_ISSUE_REACTION_MAGNITUDE = 60;

  // Leftover 4-choice helper. Live seed uses LIKE/DISLIKE × issue direction only.
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

  function authorPositionSign(targetTerr) {
    var t = String(targetTerr || '').toUpperCase();
    if (t === TERRITORY.PIONEER) return 1;
    if (t === TERRITORY.GUARDIAN) return -1;
    return 0;
  }

  function signedDirection(signed) {
    var n = Number(signed) || 0;
    if (n > 0) return TERRITORY.PIONEER;
    if (n < 0) return TERRITORY.GUARDIAN;
    return null;
  }

  function classifySelfDirectionDay(signedList) {
    var list = Array.isArray(signedList) ? signedList : [];
    var pioneer = 0;
    var guardian = 0;
    var i;
    for (i = 0; i < list.length; i++) {
      var dir = signedDirection(list[i]);
      if (dir === TERRITORY.PIONEER) pioneer += 1;
      else if (dir === TERRITORY.GUARDIAN) guardian += 1;
    }
    var directional = pioneer + guardian;
    if (directional < POLICIES.ACCEL_MIN_DIRECTIONAL) {
      return { ok: false, direction: null, directional: directional, share: 0, reason: 'TOO_FEW' };
    }
    var top = pioneer >= guardian ? TERRITORY.PIONEER : TERRITORY.GUARDIAN;
    var share = (top === TERRITORY.PIONEER ? pioneer : guardian) / directional;
    if (share < POLICIES.ACCEL_CONSISTENCY) {
      return { ok: false, direction: null, directional: directional, share: share, reason: 'INCONSISTENT' };
    }
    return { ok: true, direction: top, directional: directional, share: share, reason: 'CONSISTENT' };
  }

  function accelerationMultiplier(streakDays) {
    var n = Math.max(0, Number(streakDays) || 0);
    if (n >= 8) return POLICIES.ACCEL_MAX;
    if (n >= 5) return 1.2;
    if (n >= 3) return 1.1;
    return 1;
  }

  function accelerationAllowed(input) {
    var src = input || {};
    var direction = src.direction;
    var territory = String(src.currentTerritory || '').toUpperCase();
    var score = Number(src.score);
    if (direction !== TERRITORY.PIONEER && direction !== TERRITORY.GUARDIAN) return false;
    if (territory === direction) return false;
    if (!isFiniteNumber(score)) score = 0;
    if (direction === TERRITORY.PIONEER && score >= POLICIES.ACCEL_APPROACH_ABS) return false;
    if (direction === TERRITORY.GUARDIAN && score <= -POLICIES.ACCEL_APPROACH_ABS) return false;
    return true;
  }

  function applyActorSelfAcceleration(signed, input) {
    var base = Number(signed) || 0;
    if (!base) return { signed: 0, multiplier: 1, applied: false };
    var direction = signedDirection(base);
    var allowed = accelerationAllowed({
      direction: direction,
      currentTerritory: input && input.currentTerritory,
      score: input && input.score,
    });
    var mult = allowed ? accelerationMultiplier(input && input.streakDays) : 1;
    return { signed: base * mult, multiplier: mult, applied: mult !== 1, direction: direction };
  }

  function emptySelfDirectionState() {
    return {
      direction: null,
      streak: 0,
      lastDate: null,
    };
  }

  function applyCompletedSelfDirectionDay(state, dayKey, signedList) {
    var cur = state && typeof state === 'object' ? state : emptySelfDirectionState();
    var classified = classifySelfDirectionDay(signedList);
    if (!classified.ok) {
      return {
        direction: null,
        streak: 0,
        lastDate: dayKey || cur.lastDate,
        classified: classified,
        reset: true,
      };
    }
    if (classified.direction === cur.direction) {
      return {
        direction: classified.direction,
        streak: (Number(cur.streak) || 0) + 1,
        lastDate: dayKey,
        classified: classified,
        reset: false,
      };
    }
    return {
      direction: classified.direction,
      streak: 1,
      lastDate: dayKey,
      classified: classified,
      reset: true,
    };
  }

  /**
   * ACTOR_SELF: 25% of author-received unsigned magnitude.
   * LIKE → toward author position. DISLIKE → away.
   * CENTRAL author LIKE → pull actor toward 0. CENTRAL author DISLIKE → 0.
   */
  function computeActorSelfSigned(input) {
    var src = input || {};
    var type = String(src.reactionType || '').toUpperCase();
    var actor = String(src.actorTerritory || '').toUpperCase();
    var targetTerr = String(src.targetTerritory || '').toUpperCase();
    if (src.selfReaction) return zero('SELF_REACTION');
    if (!isAlignmentReactionType(type)) return zero('TYPE_EXCLUDED');
    if (isAlien(actor) || isAlien(targetTerr)) return zero('ALIEN_EXCLUDED');

    if (targetTerr === TERRITORY.CENTRAL && isNegativeReaction(type)) {
      return zero('CENTRAL_TARGET_DISLIKE_UNKNOWN');
    }

    var authorRecv = computeAuthorReceivedSigned(src);
    var unsigned = Math.abs(Number(authorRecv.signed) || 0);
    var scaled = unsigned * POLICIES.ACTOR_SELF_RATIO;
    if (!(scaled > 0)) {
      return {
        signed: 0,
        strength: POLICIES.ACTOR_SELF_RATIO,
        effectiveLean: authorRecv.effectiveLean,
        reason: 'ACTOR_SELF_ZERO_AUTHOR',
        authorUnsigned: unsigned,
      };
    }

    if (targetTerr === TERRITORY.CENTRAL) {
      var actorScore = Number(src.actorAlignmentScoreAtReaction);
      if (!isFiniteNumber(actorScore) || actorScore === 0) {
        return {
          signed: 0,
          strength: POLICIES.ACTOR_SELF_RATIO,
          effectiveLean: null,
          reason: 'ACTOR_SELF_CENTRAL_ALREADY_ZERO',
          authorUnsigned: unsigned,
        };
      }
      var pull = actorScore > 0 ? -scaled : scaled;
      return {
        signed: pull,
        strength: POLICIES.ACTOR_SELF_RATIO,
        effectiveLean: null,
        reason: 'ACTOR_SELF_CENTRAL_TOWARD_ZERO',
        authorUnsigned: unsigned,
      };
    }

    var toward = authorPositionSign(targetTerr);
    if (!toward) return zero('NO_TARGET_LEAN');
    var signed = (isPositiveReaction(type) ? 1 : -1) * toward * scaled;
    return {
      signed: signed,
      strength: POLICIES.ACTOR_SELF_RATIO,
      effectiveLean: targetTerr,
      reason: 'ACTOR_SELF',
      authorUnsigned: unsigned,
    };
  }

  /**
   * AUTHOR_RECEIVED: reactor faction enters the author. 70/100/130 magnitudes.
   * CENTRAL actor uses actor score snapshot gradual. CENTRAL→CENTRAL = 0.
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
      if (targetTerr === TERRITORY.CENTRAL) return zero('CENTRAL_TO_CENTRAL');
      return {
        signed: ssotSigned(lean, targetTerr, type) * strength,
        strength: strength,
        effectiveLean: lean,
        reason: 'AUTHOR_RECEIVED_CENTRAL_ACTOR_GRADUAL',
      };
    }

    return {
      signed: ssotSigned(actor, targetTerr, type),
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
      var resetStreak =
        candidateTerritory === TERRITORY.PIONEER || candidateTerritory === TERRITORY.GUARDIAN;
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
        resetSelfDirectionStreak: resetStreak,
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

  function computeDailyIssueReactionSigned(direction, reactionType) {
    var dir = String(direction || '').toUpperCase();
    var type = String(reactionType || '').toUpperCase();
    if (type !== 'LIKE' && type !== 'DISLIKE') return 0;
    if (dir === 'NEUTRAL' || !dir) return 0;
    if (dir === 'PIONEER') return type === 'LIKE' ? DAILY_ISSUE_REACTION_MAGNITUDE : -DAILY_ISSUE_REACTION_MAGNITUDE;
    if (dir === 'GUARDIAN') return type === 'LIKE' ? -DAILY_ISSUE_REACTION_MAGNITUDE : DAILY_ISSUE_REACTION_MAGNITUDE;
    return 0;
  }

  return {
    POLICIES: POLICIES,
    TERRITORY: TERRITORY,
    DAILY_ISSUE_VALUES: DAILY_ISSUE_VALUES,
    DAILY_ISSUE_REACTION_MAGNITUDE: DAILY_ISSUE_REACTION_MAGNITUDE,
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
    computeDailyIssueReactionSigned: computeDailyIssueReactionSigned,
    isAlignmentReactionType: isAlignmentReactionType,
    authorPositionSign: authorPositionSign,
    signedDirection: signedDirection,
    classifySelfDirectionDay: classifySelfDirectionDay,
    accelerationMultiplier: accelerationMultiplier,
    accelerationAllowed: accelerationAllowed,
    applyActorSelfAcceleration: applyActorSelfAcceleration,
    emptySelfDirectionState: emptySelfDirectionState,
    applyCompletedSelfDirectionDay: applyCompletedSelfDirectionDay,
  };
});
