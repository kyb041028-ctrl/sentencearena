/**
 * 센텐스아레나 — 정치성향 배치 read-only simulation
 * canonical input 재사용. 점수 DB WRITE / scheduler / 영토 이동 없음.
 *
 * BETA V1: Daily Issue(스키마 미연결) + ACTOR_SELF + AUTHOR_RECEIVED
 * WINDOW_COMBINATION_POLICY = CONFIRMED
 *   combined = SUM99 * 0.5 + SUM30 * 0.5
 *   rawDelta = combined - previousSignal
 *
 * 레거시 배치코어 CENTRAL 분기(현재 점수로 부호 결정)는 삭제됨.
 * magnitude SSOT = alignment-batch-core.computeSignedDelta
 * BETA V1 signed = political-alignment-beta-v1-core
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./political-reaction-input-core'),
      require('./alignment-batch-core'),
      require('./political-alignment-beta-v1-core')
    );
  } else {
    root.PoliticalAlignmentSimulationCore = factory(
      root.PoliticalReactionInputCore,
      root.AlignmentBatchCore,
      root.PoliticalAlignmentBetaV1Core
    );
  }
})(typeof self !== 'undefined' ? self : this, function (inputCore, batchCore, betaV1) {
  'use strict';

  var POLICIES = Object.freeze({
    POLITICAL_REACTION_INPUT: 'ACTIVE_CANONICAL',
    POLITICAL_SIMULATION: 'ACTIVE_READ_ONLY',
    POLITICAL_SCORE_WRITE: 'NOT_CONNECTED',
    POLITICAL_BATCH_SCHEDULER: 'READY_DISABLED',
    TERRITORY_MOVE: 'NOT_CONNECTED',
    WINDOW_COMBINATION_POLICY: 'CONFIRMED',
    CENTRAL_SIGN_POLICY: 'CONFIRMED',
    PIONEER_SIGN_POLICY: 'CONFIRMED',
    GUARDIAN_SIGN_POLICY: 'CONFIRMED',
    ALIGNMENT_MODEL: 'BETA_V1',
    ACTOR_SELF: 'ACTIVE',
    AUTHOR_RECEIVED: 'ACTIVE',
    DAILY_ISSUE: 'BLOCKED_BY_CONTENT_SCHEMA',
  });

  var SIGNED_STATUS = Object.freeze({
    CONFIRMED: 'CONFIRMED',
  });

  function getBatchConfig() {
    if (inputCore && typeof inputCore.getBatchConfig === 'function') {
      return inputCore.getBatchConfig();
    }
    if (batchCore && typeof batchCore.getAlignmentBatchProcessorConfig === 'function') {
      return batchCore.getAlignmentBatchProcessorConfig();
    }
    return {
      rollingWindowDays: 99,
      recentWindowDays: 30,
      rollingWindowRatio: 0.5,
      recentWindowRatio: 0.5,
      maxScoreChangePerBatch: 500,
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function polarityToType(polarity) {
    return polarity === 'NEGATIVE' ? 'DISLIKE' : 'LIKE';
  }

  /**
   * AUTHOR_RECEIVED helper for tests. SSOT magnitude = computeSignedDelta.
   */
  function confirmedSignedWeight(input) {
    var actor = String((input && input.actorTerritory) || '').toUpperCase();
    var target = String((input && input.targetTerritory) || '').toUpperCase();
    var type = input && input.reactionType ? input.reactionType : polarityToType(input && input.polarity);
    if (actor !== 'PIONEER' && actor !== 'GUARDIAN' && actor !== 'CENTRAL') {
      return { policy: 'UNDEFINED', actor: actor || null, target: target || null, signed: null };
    }
    if (actor === 'CENTRAL' && target !== 'PIONEER' && target !== 'GUARDIAN' && target !== 'CENTRAL') {
      return { policy: 'UNDEFINED', actor: actor, target: target || null, signed: null };
    }
    var signed;
    if (batchCore && typeof batchCore.computeSignedDelta === 'function') {
      signed = batchCore.computeSignedDelta({
        reactionType: type,
        actorTerritoryAtReaction: actor,
        targetTerritoryAtReaction: target,
      });
    } else {
      return { policy: 'UNDEFINED', actor: actor, target: target, signed: null };
    }
    return { policy: 'CONFIRMED', actor: actor, target: target, signed: signed };
  }

  function emptyUserStats(userId) {
    return {
      userId: userId,
      eligibleReactionCount: 0,
      reactionCount99: 0,
      reactionCount30: 0,
      positiveCount: 0,
      negativeCount: 0,
      sameTerritoryCount: 0,
      otherTerritoryCount: 0,
      pioneerActorCount: 0,
      guardianActorCount: 0,
      centralActorCount: 0,
      unsignedMagnitude99: 0,
      unsignedMagnitude30: 0,
      weighted99: null,
      weighted30: null,
      combinedSignal: null,
      previousSignal: 0,
      rawDelta: null,
      cappedDelta: null,
      capApplied: false,
      currentScore: null,
      simulatedNextScore: null,
      signedStatus: null,
      excludedFromSignedCount: 0,
    };
  }

  function inWindow(input, asOf, days) {
    if (inputCore && typeof inputCore.inWindowDays === 'function') {
      return inputCore.inWindowDays(input.createdAt, asOf, days);
    }
    var created = new Date(input.createdAt).getTime();
    var end = new Date(asOf).getTime();
    if (!isFinite(created) || !isFinite(end)) return false;
    return (end - created) / 86400000 >= 0 && (end - created) / 86400000 <= days;
  }

  function pairKey(affected, counterparty) {
    return String(affected) + '\0' + String(counterparty);
  }

  function sortCalculable(list) {
    return list.slice().sort(function (a, b) {
      var ta = new Date(a.createdAt).getTime();
      var tb = new Date(b.createdAt).getTime();
      if (ta !== tb) return ta - tb;
      return String(a.reactionId || '').localeCompare(String(b.reactionId || ''));
    });
  }

  function applyPairThenDaily(ctx, affected, counterparty, createdAt, signed) {
    var pKey = pairKey(affected, counterparty);
    var priorAbs = 0;
    var storedPairs = ctx.pairAbs[pKey] || [];
    var i;
    for (i = 0; i < storedPairs.length; i++) {
      if (betaV1.inWindow(storedPairs[i].createdAt, createdAt, 7)) {
        priorAbs += storedPairs[i].abs;
      }
    }
    var pair = betaV1.applyPairAlignmentCap(priorAbs, signed, betaV1.POLICIES.PAIR_ALIGNMENT_7D_CAP);
    var day = betaV1.seoulDayKey(createdAt) || '';
    var dKey = String(affected) + '\0' + day;
    var priorDaily = ctx.dailySum[dKey] || 0;
    var daily = betaV1.applySignedDailyCap(priorDaily, pair.stored, betaV1.POLICIES.COMMUNITY_ALIGNMENT_DAILY_CAP);
    if (!ctx.pairAbs[pKey]) ctx.pairAbs[pKey] = [];
    ctx.pairAbs[pKey].push({ createdAt: createdAt, abs: Math.abs(daily.stored) });
    ctx.dailySum[dKey] = daily.nextSum;
    return daily.stored;
  }

  function simulateFromNormalized(normalized, options) {
    var opts = options || {};
    var asOf = opts.asOf ? new Date(opts.asOf) : new Date(normalized && normalized.asOf ? normalized.asOf : Date.now());
    var cfg = getBatchConfig();
    var filter = opts.userIds;
    var filterSet = null;
    var i;
    if (Array.isArray(filter) && filter.length) {
      filterSet = {};
      for (i = 0; i < filter.length; i++) filterSet[String(filter[i])] = true;
    }

    var calculable = sortCalculable((normalized && normalized.calculable) || []);
    var byUser = {};
    var capCtx = { pairAbs: {}, dailySum: {} };

    function ensure(userId) {
      if (!byUser[userId]) byUser[userId] = emptyUserStats(userId);
      return byUser[userId];
    }

    function includeUser(userId) {
      return !filterSet || filterSet[String(userId)];
    }

    if (filterSet) {
      var keys = Object.keys(filterSet);
      for (i = 0; i < keys.length; i++) ensure(keys[i]);
    }

    function addContribution(st, row, stored, asOfDate) {
      st.eligibleReactionCount += 1;
      if (row.polarity === 'POSITIVE') st.positiveCount += 1;
      else if (row.polarity === 'NEGATIVE') st.negativeCount += 1;
      if (row.sameTerritory) st.sameTerritoryCount += 1;
      else st.otherTerritoryCount += 1;
      var actor = String(row.actorTerritory || '').toUpperCase();
      if (actor === 'PIONEER') st.pioneerActorCount += 1;
      else if (actor === 'GUARDIAN') st.guardianActorCount += 1;
      else if (actor === 'CENTRAL') st.centralActorCount += 1;

      var mag = Number(row.weight) || 0;
      var in99 = inWindow(row, asOfDate, cfg.rollingWindowDays);
      var in30 = inWindow(row, asOfDate, cfg.recentWindowDays);
      if (in99) {
        st.reactionCount99 += 1;
        st.unsignedMagnitude99 += mag;
      }
      if (in30) {
        st.reactionCount30 += 1;
        st.unsignedMagnitude30 += mag;
      }
      if (st.weighted99 == null) st.weighted99 = 0;
      if (st.weighted30 == null) st.weighted30 = 0;
      if (in99) st.weighted99 += stored;
      if (in30) st.weighted30 += stored;
    }

    for (i = 0; i < calculable.length; i++) {
      var row = calculable[i];
      if (!row) continue;
      var actorId = row.actorUserId;
      var authorId = row.targetAuthorUserId;
      var selfReaction = !!(actorId && authorId && actorId === authorId);
      var actorSelf = betaV1.computeActorSelfSigned({
        reactionType: row.reactionType,
        actorTerritory: row.actorTerritory,
        targetTerritory: row.targetTerritory,
        targetAlignmentScoreAtReaction: row.targetAlignmentScoreAtReaction,
        actorAlignmentScoreAtReaction: row.actorAlignmentScoreAtReaction,
        selfReaction: selfReaction,
      });
      var authorRecv = betaV1.computeAuthorReceivedSigned({
        reactionType: row.reactionType,
        actorTerritory: row.actorTerritory,
        targetTerritory: row.targetTerritory,
        targetAlignmentScoreAtReaction: row.targetAlignmentScoreAtReaction,
        actorAlignmentScoreAtReaction: row.actorAlignmentScoreAtReaction,
        selfReaction: selfReaction,
      });

      if (actorId && includeUser(actorId)) {
        var actorStored = applyPairThenDaily(capCtx, actorId, authorId, row.createdAt, actorSelf.signed);
        addContribution(ensure(actorId), row, actorStored, asOf);
      } else if (actorId) {
        applyPairThenDaily(capCtx, actorId, authorId, row.createdAt, actorSelf.signed);
      }

      if (authorId && includeUser(authorId)) {
        var authorStored = applyPairThenDaily(capCtx, authorId, actorId, row.createdAt, authorRecv.signed);
        addContribution(ensure(authorId), row, authorStored, asOf);
      } else if (authorId) {
        applyPairThenDaily(capCtx, authorId, actorId, row.createdAt, authorRecv.signed);
      }
    }

    var previousByUser = opts.previousByUser || {};
    var currentScoreByUser = opts.currentScoreByUser || {};
    var users = [];
    var userIds = Object.keys(byUser);
    userIds.sort();

    var cap = isFiniteNumber(cfg.maxScoreChangePerBatch) ? cfg.maxScoreChangePerBatch : 500;
    var r99 = isFiniteNumber(cfg.rollingWindowRatio) ? cfg.rollingWindowRatio : 0.5;
    var r30 = isFiniteNumber(cfg.recentWindowRatio) ? cfg.recentWindowRatio : 0.5;

    for (i = 0; i < userIds.length; i++) {
      var stOut = byUser[userIds[i]];
      var prev = previousByUser[stOut.userId];
      stOut.previousSignal = isFiniteNumber(prev) ? prev : 0;
      var cur = currentScoreByUser[stOut.userId];
      stOut.currentScore = isFiniteNumber(cur) ? cur : null;

      var hasSigned =
        isFiniteNumber(stOut.weighted99) && isFiniteNumber(stOut.weighted30);
      if (hasSigned) {
        stOut.signedStatus = SIGNED_STATUS.CONFIRMED;
        stOut.combinedSignal = stOut.weighted99 * r99 + stOut.weighted30 * r30;
        stOut.rawDelta = stOut.combinedSignal - stOut.previousSignal;
        stOut.cappedDelta = clamp(stOut.rawDelta, -cap, cap);
        stOut.capApplied = stOut.cappedDelta !== stOut.rawDelta;
        if (stOut.currentScore != null) {
          stOut.simulatedNextScore = stOut.currentScore + stOut.cappedDelta;
        }
      } else {
        stOut.weighted99 = null;
        stOut.weighted30 = null;
        stOut.combinedSignal = null;
        stOut.rawDelta = null;
        stOut.cappedDelta = null;
        stOut.capApplied = false;
        stOut.simulatedNextScore = null;
        stOut.signedStatus = null;
      }

      stOut.territoryMoveEvaluated = false;
      stOut.scoreWrite = false;
      users.push(stOut);
    }

    return {
      asOf: asOf.toISOString(),
      policies: POLICIES,
      windowFormula: 'combined = SUM99 * rollingWindowRatio + SUM30 * recentWindowRatio; rawDelta = combined - previousSignal',
      windowRatios: { rolling99: r99, recent30: r30 },
      maxScoreChangePerBatch: cap,
      scoreWrite: false,
      territoryMoveEvaluated: false,
      userCount: users.length,
      users: users,
      eligibleReactionCount: calculable.length,
      excludedReactionCount: (normalized && normalized.excludedCount) || 0,
      excludeReasons: (normalized && normalized.excludeReasons) || {},
      polarityCount: (normalized && normalized.polarityCount) || { POSITIVE: 0, NEGATIVE: 0 },
    };
  }

  function simulateAlignmentBatch(options) {
    var opts = options || {};
    var asOf = opts.asOf ? new Date(opts.asOf) : new Date();
    var rows = Array.isArray(opts.rows) ? opts.rows : [];
    var normalized = inputCore.normalizeBoardReactionRows(rows, asOf);
    return simulateFromNormalized(normalized, {
      asOf: asOf,
      userIds: opts.userIds,
      previousByUser: opts.previousByUser,
      currentScoreByUser: opts.currentScoreByUser,
    });
  }

  return {
    POLICIES: POLICIES,
    SIGNED_STATUS: SIGNED_STATUS,
    confirmedSignedWeight: confirmedSignedWeight,
    simulateAlignmentBatch: simulateAlignmentBatch,
    simulateFromNormalized: simulateFromNormalized,
    POLITICAL_SIMULATION: POLICIES.POLITICAL_SIMULATION,
    POLITICAL_SCORE_WRITE: POLICIES.POLITICAL_SCORE_WRITE,
    POLITICAL_BATCH_SCHEDULER: POLICIES.POLITICAL_BATCH_SCHEDULER,
    TERRITORY_MOVE: POLICIES.TERRITORY_MOVE,
    CENTRAL_SIGN_POLICY: POLICIES.CENTRAL_SIGN_POLICY,
    WINDOW_COMBINATION_POLICY: POLICIES.WINDOW_COMBINATION_POLICY,
  };
});
