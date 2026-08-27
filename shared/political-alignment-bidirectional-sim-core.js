/**
 * Offline BIDIRECTIONAL political-alignment simulation core.
 *
 * NOT production. Does not write DB / scheduler / territory / tracked files.
 * Reuses live beta-v1 math only by require (read-only).
 *
 * actualOrientation is a sim oracle. It is never a production column.
 */
'use strict';

const betaV1 = require('./political-alignment-beta-v1-core');
const batchCore = require('./alignment-batch-core');

const TERRITORY = Object.freeze({
  PIONEER: 'PIONEER',
  CENTRAL: 'CENTRAL',
  GUARDIAN: 'GUARDIAN',
});

const BASE_UNIT = 100;

const LIVE = Object.freeze({
  rollingWindowDays: 99,
  recentWindowDays: 30,
  rollingWindowRatio: 0.5,
  recentWindowRatio: 0.5,
  communityDailyCap: 240,
  pair7dCap: 120,
  dailyIssueDailyCap: 180,
  batchCap: 500,
  exitAbs: 360,
  returnAbs: 160,
  requiredConsecutiveBatches: 2,
  minTerritoryStayHours: 48,
  gradualDeadzone: 40,
  postWrite: 0,
  commentWrite: 0,
  empathy: 0,
  report: 0,
  weights: batchCore.getAlignmentBatchProcessorConfig().reactionWeights,
});

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function authorEffectSpec(authorTerr, reactorTerr, isLike, expected, mid, unexpected) {
  const a = String(authorTerr || '').toUpperCase();
  const r = String(reactorTerr || '').toUpperCase();
  const e = expected;
  const m = mid;
  const u = unexpected;
  const like = !!isLike;

  if (a === 'PIONEER') {
    if (r === 'PIONEER') return { dir: 'PIONEER', mag: like ? e : -u };
    if (r === 'GUARDIAN') return { dir: 'GUARDIAN', mag: like ? u : -e };
    if (r === 'CENTRAL') return { dir: 'CENTRAL', mag: like ? m : -m };
  }
  if (a === 'GUARDIAN') {
    if (r === 'GUARDIAN') return { dir: 'GUARDIAN', mag: like ? e : -u };
    if (r === 'PIONEER') return { dir: 'PIONEER', mag: like ? u : -e };
    if (r === 'CENTRAL') return { dir: 'CENTRAL', mag: like ? m : -m };
  }
  if (a === 'CENTRAL') {
    if (r === 'CENTRAL') return { dir: 'CENTRAL', mag: like ? e : -u };
    if (r === 'PIONEER') return { dir: 'PIONEER', mag: like ? m : -m };
    if (r === 'GUARDIAN') return { dir: 'GUARDIAN', mag: like ? m : -m };
  }
  return { dir: null, mag: 0 };
}

function centralAxisDelta(magRatio, authorScore) {
  const pull = Math.abs(magRatio) * BASE_UNIT;
  const score = Number(authorScore) || 0;
  if (magRatio > 0) {
    if (score > 0) return -Math.min(pull, score);
    if (score < 0) return Math.min(pull, -score);
    return 0;
  }
  if (magRatio < 0) {
    if (score > 0) return pull;
    if (score < 0) return -pull;
    return 0;
  }
  return 0;
}

function directionToAxisDelta(dir, magRatio, authorScore) {
  if (!dir || !magRatio) return 0;
  if (dir === 'PIONEER') return magRatio * BASE_UNIT;
  if (dir === 'GUARDIAN') return -magRatio * BASE_UNIT;
  if (dir === 'CENTRAL') return centralAxisDelta(magRatio, authorScore);
  return 0;
}

function authorPositionSign(authorTerr, authorScore) {
  const t = String(authorTerr || '').toUpperCase();
  if (t === 'PIONEER') return 1;
  if (t === 'GUARDIAN') return -1;
  const s = Number(authorScore) || 0;
  if (Math.abs(s) <= LIVE.gradualDeadzone) return 0;
  return s > 0 ? 1 : -1;
}

function computeNewAuthorSigned(input, weights) {
  const w = weights || { expected: 0.8, mid: 1.0, unexpected: 1.2 };
  const spec = authorEffectSpec(
    input.authorTerritory,
    input.reactorTerritory,
    input.isLike,
    w.expected,
    w.mid,
    w.unexpected
  );
  const signed = directionToAxisDelta(spec.dir, spec.mag, input.authorScore);
  return {
    signed: signed,
    dir: spec.dir,
    magRatio: spec.mag,
    absMagRatio: Math.abs(spec.mag),
  };
}

function computeNewReactorSigned(input, authorPack, reactorShare, centralDislikeMode) {
  const share = Number(reactorShare) || 0;
  if (!(share > 0) || !authorPack) return { signed: 0, reason: 'REACTOR_SHARE_ZERO' };
  const mag = authorPack.absMagRatio * share * BASE_UNIT;
  const authorTerr = String(input.authorTerritory || '').toUpperCase();
  const pos = authorPositionSign(authorTerr, input.authorScore);
  const isLike = !!input.isLike;

  if (authorTerr === 'CENTRAL' && pos === 0) {
    if (isLike) {
      return {
        signed: centralAxisDelta(authorPack.absMagRatio * share, input.reactorScore),
        reason: 'REACTOR_LIKE_CENTRAL_TOWARD_ZERO',
      };
    }
    if (centralDislikeMode === 'REINFORCE_EXISTING_LEAN') {
      const rs = Number(input.reactorScore) || 0;
      if (Math.abs(rs) <= LIVE.gradualDeadzone) return { signed: 0, reason: 'CENTRAL_DISLIKE_UNKNOWN_ZERO' };
      const away = rs > 0 ? mag : -mag;
      return { signed: away, reason: 'CENTRAL_DISLIKE_REINFORCE_LEAN' };
    }
    return { signed: 0, reason: 'CENTRAL_DISLIKE_UNKNOWN_ZERO' };
  }

  if (pos === 0) return { signed: 0, reason: 'NO_AUTHOR_POSITION' };
  const signed = (isLike ? 1 : -1) * pos * mag;
  return { signed: signed, reason: isLike ? 'TOWARD_AUTHOR' : 'AWAY_FROM_AUTHOR' };
}

function computeLegacySigned(actorTerr, targetTerr, isLike) {
  const actor = String(actorTerr || '').toUpperCase();
  const target = String(targetTerr || '').toUpperCase();
  const positive = !!isLike;
  let mag = 0;
  if (actor === 'CENTRAL' && target === 'CENTRAL') mag = 0;
  else {
    const same = actor === target;
    mag = positive ? (same ? 80 : 120) : (same ? 120 : 80);
  }
  if (actor === 'PIONEER') return positive ? mag : -mag;
  if (actor === 'GUARDIAN') return positive ? -mag : mag;
  if (actor === 'CENTRAL') {
    if (target === 'PIONEER') return positive ? mag : -mag;
    if (target === 'GUARDIAN') return positive ? -mag : mag;
  }
  return 0;
}

function computeLegacyProductionPair(input) {
  const type = input.isLike ? 'LIKE' : 'DISLIKE';
  const actor = String(input.reactorTerritory || '').toUpperCase();
  const targetTerr = String(input.authorTerritory || '').toUpperCase();
  if (input.selfReaction) {
    return {
      actorSelf: { signed: 0, reason: 'SELF_REACTION' },
      authorRecv: { signed: 0, reason: 'SELF_REACTION' },
    };
  }
  let recvTarget = targetTerr;
  if (targetTerr === 'CENTRAL' && actor !== 'CENTRAL') {
    recvTarget = actor === 'PIONEER' ? 'GUARDIAN' : 'PIONEER';
  }
  const authorSigned = computeLegacySigned(actor, recvTarget, input.isLike);
  let actorSigned = 0;
  if (targetTerr === 'CENTRAL') {
    const pos = authorPositionSign(targetTerr, input.authorScore);
    const mag = Math.abs(authorSigned);
    if (input.isLike) actorSigned = centralAxisDelta(mag / BASE_UNIT, input.reactorScore);
    else actorSigned = 0;
    if (pos !== 0) actorSigned = (input.isLike ? 1 : -1) * pos * mag;
  } else {
    const toward = authorPositionSign(targetTerr, input.authorScore);
    actorSigned = (input.isLike ? 1 : -1) * toward * Math.abs(authorSigned);
  }
  return {
    actorSelf: { signed: actorSigned, reason: 'LEGACY_ACTOR_SELF_100' },
    authorRecv: { signed: authorSigned, reason: 'LEGACY_AUTHOR_RECEIVED' },
  };
}

function computeProductionPair(input) {
  const type = input.isLike ? 'LIKE' : 'DISLIKE';
  const actorSelf = betaV1.computeActorSelfSigned({
    reactionType: type,
    actorTerritory: input.reactorTerritory,
    targetTerritory: input.authorTerritory,
    targetAlignmentScoreAtReaction: input.authorScore,
    actorAlignmentScoreAtReaction: input.reactorScore,
    selfReaction: !!input.selfReaction,
  });
  const authorRecv = betaV1.computeAuthorReceivedSigned({
    reactionType: type,
    actorTerritory: input.reactorTerritory,
    targetTerritory: input.authorTerritory,
    targetAlignmentScoreAtReaction: input.authorScore,
    actorAlignmentScoreAtReaction: input.reactorScore,
    selfReaction: !!input.selfReaction,
  });
  return { actorSelf: actorSelf, authorRecv: authorRecv };
}

function applyCaps(ctx, affectedId, counterpartyId, dayIndex, incoming, communityCap, pairCap) {
  const pKey = String(affectedId) + '>' + String(counterpartyId);
  if (!ctx.pair[pKey]) ctx.pair[pKey] = [];
  const hist = ctx.pair[pKey];
  let priorAbs = 0;
  let i;
  for (i = 0; i < hist.length; i++) {
    if (dayIndex - hist[i].day <= 6 && hist[i].day <= dayIndex) priorAbs += hist[i].abs;
  }
  const pair = betaV1.applyPairAlignmentCap(priorAbs, incoming, pairCap);
  const dKey = String(affectedId) + '@' + String(dayIndex);
  const priorDaily = ctx.daily[dKey] || 0;
  const daily = betaV1.applySignedDailyCap(priorDaily, pair.stored, communityCap);
  ctx.daily[dKey] = daily.nextSum;
  hist.push({ day: dayIndex, abs: Math.abs(daily.stored) });
  return {
    stored: daily.stored,
    pairHit: pair.capHit,
    dailyHit: daily.capHit,
  };
}

function windowSums(dailySeries, dayIndex, days) {
  let sum = 0;
  const start = Math.max(0, dayIndex - (days - 1));
  let d;
  for (d = start; d <= dayIndex; d++) sum += dailySeries[d] || 0;
  return sum;
}

function applyDayScoreAndTerritory(user, daySigned, dayIndex, batchCap) {
  const sum99 = windowSums(user.dailySeries, dayIndex, LIVE.rollingWindowDays);
  const sum30 = windowSums(user.dailySeries, dayIndex, LIVE.recentWindowDays);
  const combined = sum99 * LIVE.rollingWindowRatio + sum30 * LIVE.recentWindowRatio;
  const rawDelta = combined - user.previousSignal;
  const cappedDelta = clamp(rawDelta, -batchCap, batchCap);
  user.score += cappedDelta;
  user.previousSignal = combined;
  user.lastRawDelta = rawDelta;
  user.lastCappedDelta = cappedDelta;
  user.batchCapHit = cappedDelta !== rawDelta;
  user.daySigned = daySigned;
  user.sum99 = sum99;
  user.sum30 = sum30;
  user.combined = combined;

  const evalState = {
    alignmentScore: user.score,
    currentTerritory: user.territory,
    pendingTerritory: user.pendingTerritory,
    pendingTerritoryBatchCount: user.pendingCount,
    pendingTerritoryStartedAt: user.pendingStartedAt,
    lastTerritoryChangedAt: user.lastTerritoryChangedAt,
  };
  const batchIso = user.dayIso;
  const ev = betaV1.evaluateTerritoryTransition(evalState, batchIso);
  if (ev.territoryChanged) {
    user.moveCount += 1;
    user.lastMoveDay = dayIndex;
    user.moveHistory.push({
      day: dayIndex,
      from: user.territory,
      to: ev.nextTerritory,
      score: user.score,
    });
  }
  user.territory = ev.nextTerritory;
  user.pendingTerritory = ev.pendingTerritory;
  user.pendingCount = ev.pendingTerritoryBatchCount || 0;
  user.pendingStartedAt = ev.pendingTerritoryStartedAt;
  user.lastTerritoryChangedAt = ev.lastTerritoryChangedAt || user.lastTerritoryChangedAt;
  user.candidateTerritory = ev.candidateTerritory;
  user.transitionReason = ev.transitionReason;
  return ev;
}

function judgedBand(score) {
  const s = Number(score) || 0;
  if (s >= LIVE.exitAbs) return 'PIONEER';
  if (s <= -LIVE.exitAbs) return 'GUARDIAN';
  return 'CENTRAL';
}

function reactionProbs(actual, intensity, postLean) {
  const a = actual;
  const p = postLean;
  const iv = intensity;
  const table = {
    PIONEER: {
      weak: {
        PIONEER: [0.52, 0.22, 0.26],
        CENTRAL: [0.4, 0.32, 0.28],
        GUARDIAN: [0.28, 0.5, 0.22],
      },
      mid: {
        PIONEER: [0.7, 0.15, 0.15],
        CENTRAL: [0.45, 0.3, 0.25],
        GUARDIAN: [0.15, 0.7, 0.15],
      },
      strong: {
        PIONEER: [0.85, 0.08, 0.07],
        CENTRAL: [0.4, 0.35, 0.25],
        GUARDIAN: [0.05, 0.85, 0.1],
      },
    },
    GUARDIAN: {
      weak: {
        GUARDIAN: [0.52, 0.22, 0.26],
        CENTRAL: [0.4, 0.32, 0.28],
        PIONEER: [0.28, 0.5, 0.22],
      },
      mid: {
        GUARDIAN: [0.7, 0.15, 0.15],
        CENTRAL: [0.45, 0.3, 0.25],
        PIONEER: [0.15, 0.7, 0.15],
      },
      strong: {
        GUARDIAN: [0.85, 0.08, 0.07],
        CENTRAL: [0.4, 0.35, 0.25],
        PIONEER: [0.05, 0.85, 0.1],
      },
    },
    CENTRAL: {
      weak: {
        PIONEER: [0.42, 0.28, 0.3],
        CENTRAL: [0.5, 0.25, 0.25],
        GUARDIAN: [0.3, 0.4, 0.3],
      },
      mid: {
        PIONEER: [0.35, 0.35, 0.3],
        CENTRAL: [0.6, 0.2, 0.2],
        GUARDIAN: [0.35, 0.35, 0.3],
      },
      strong: {
        PIONEER: [0.28, 0.32, 0.4],
        CENTRAL: [0.8, 0.1, 0.1],
        GUARDIAN: [0.28, 0.32, 0.4],
      },
    },
  };
  const row = table[a] && table[a][iv] && table[a][iv][p];
  if (!row) return { LIKE: 0.33, DISLIKE: 0.33, NONE: 0.34 };
  return { LIKE: row[0], DISLIKE: row[1], NONE: row[2] };
}

function activityCount(level) {
  if (level === 'low') return 2;
  if (level === 'high') return 12;
  return 6;
}

function startScoreForTerritory(terr) {
  if (terr === 'PIONEER') return 420;
  if (terr === 'GUARDIAN') return -420;
  return 0;
}

function classifyFailure(user, horizonDay) {
  const actual = user.actual;
  const terr = user.territory;
  const judged = judgedBand(user.score);
  const highAct = user.activity === 'high';
  const writer = !!user.writer;
  const reasons = [];

  if (actual !== terr) {
    if (user.dailyCapHits > horizonDay * 0.35 && highAct) reasons.push('G_DAILY_CAP');
    if (user.pendingCount > 0 && judged === actual) reasons.push('I_CONSECUTIVE_BATCH');
    if (actual === 'CENTRAL' && judged !== 'CENTRAL') reasons.push('K_CENTRAL_BAND');
    if (user.sameExpectedLikeShare > 0.62 && actual !== terr) reasons.push('C_EXPECTED_LIKE_LOCK');
    if (user.crossExpectedDislikeShare > 0.62 && actual !== terr) reasons.push('D_EXPECTED_DISLIKE_LOCK');
    if (!highAct && user.activity === 'low') reasons.push('L_WEAK_BEHAVIOR');
    if (!writer && user.authorRecvAbs < 40) reasons.push('B_AUTHOR_SIGNAL_WEAK_OR_LURKER');
    if (Math.abs(user.sum99) > Math.abs(user.sum30) * 1.8 && horizonDay >= 60) reasons.push('F_LONG_WINDOW_DOMINANCE');
    if (reasons.length === 0) reasons.push('L_WEAK_BEHAVIOR');
  }
  return reasons;
}

module.exports = {
  TERRITORY: TERRITORY,
  BASE_UNIT: BASE_UNIT,
  LIVE: LIVE,
  clone: clone,
  clamp: clamp,
  authorEffectSpec: authorEffectSpec,
  directionToAxisDelta: directionToAxisDelta,
  authorPositionSign: authorPositionSign,
  computeNewAuthorSigned: computeNewAuthorSigned,
  computeNewReactorSigned: computeNewReactorSigned,
  computeLegacyProductionPair: computeLegacyProductionPair,
  computeProductionPair: computeProductionPair,
  applyCaps: applyCaps,
  windowSums: windowSums,
  applyDayScoreAndTerritory: applyDayScoreAndTerritory,
  judgedBand: judgedBand,
  reactionProbs: reactionProbs,
  activityCount: activityCount,
  startScoreForTerritory: startScoreForTerritory,
  classifyFailure: classifyFailure,
  betaV1: betaV1,
};
