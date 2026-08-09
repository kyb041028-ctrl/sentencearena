/**
 * 센텐스아레나 — 진영 전황(Faction Battle) 공용 규칙·계약
 * 브라우저(UMD) · Node(CommonJS)
 *
 * 베타 Mock UI용. 실제 DB/API·alignment·moderation과 독립.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FactionBattleCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function factionBattleCoreFactory() {
  'use strict';

  var FACTIONS = Object.freeze(['pioneer', 'central', 'guardian']);

  var FACTION_LABELS = Object.freeze({
    pioneer: '개척',
    central: '중앙',
    guardian: '수호',
  });

  var FACTION_DATA_TERRITORY = Object.freeze({
    pioneer: 'reform',
    central: 'centrist',
    guardian: 'order',
  });

  var LEGACY_TO_OPERATIONAL = Object.freeze({
    COMMON: 'CENTRAL',
    CENTRAL: 'CENTRAL',
    CENTRIST: 'CENTRAL',
    PROGRESSIVE: 'PIONEER',
    PIONEER: 'PIONEER',
    CONSERVATIVE: 'GUARDIAN',
    GUARDIAN: 'GUARDIAN',
    KANTAPBIYA: 'ALIEN',
    KANTAPBIYA_LEFT: 'ALIEN',
    KANTAPBIYA_CENTER: 'ALIEN',
    KANTAPBIYA_RIGHT: 'ALIEN',
    ALIEN: 'ALIEN',
  });

  var SUPPORTED_BOARDS = Object.freeze(['CENTRAL', 'ALIEN']);

  var SCORE_WEIGHTS = Object.freeze({
    uniqueReactors: 3,
    positiveReactions: 1,
    negativeReactions: 1,
    uniqueCommenters: 4,
    replyParticipants: 2,
  });

  var THRESHOLDS = Object.freeze({
    minUniqueParticipants: 3,
    minTotalScore: 12,
    dominantShare: 0.62,
    dominantGap: 0.22,
    leadingShare: 0.48,
    leadingGap: 0.1,
  });

  var STATES = Object.freeze({
    DOMINANT: 'DOMINANT',
    LEADING: 'LEADING',
    BALANCED: 'BALANCED',
    INSUFFICIENT: 'INSUFFICIENT',
  });

  function clamp01(n) {
    var v = Number(n);
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function nonNegInt(n) {
    var v = Math.floor(Number(n));
    if (!isFinite(v) || v < 0) return 0;
    return v;
  }

  function normalizeBoardType(boardType) {
    var raw = String(boardType || '')
      .trim()
      .toUpperCase();
    if (!raw) return null;
    if (LEGACY_TO_OPERATIONAL[raw]) return LEGACY_TO_OPERATIONAL[raw];
    return null;
  }

  function supportsFactionBattleUi(boardType) {
    var op = normalizeBoardType(boardType);
    return op === 'CENTRAL' || op === 'ALIEN';
  }

  function getFactionBattleContext(boardType) {
    var op = normalizeBoardType(boardType);
    return {
      supported: supportsFactionBattleUi(op),
      boardType: op,
      factions: FACTIONS.slice(),
      usesEarthOriginFactions: true,
      alienAsFourthFaction: false,
      affectsEarthAlignment: false,
    };
  }

  function emptyFactionMetrics() {
    return {
      uniqueReactors: 0,
      positiveReactions: 0,
      negativeReactions: 0,
      uniqueCommenters: 0,
      replyParticipants: 0,
    };
  }

  function normalizeFactionMetrics(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      uniqueReactors: nonNegInt(src.uniqueReactors),
      positiveReactions: nonNegInt(src.positiveReactions),
      negativeReactions: nonNegInt(src.negativeReactions),
      uniqueCommenters: nonNegInt(src.uniqueCommenters),
      replyParticipants: nonNegInt(src.replyParticipants),
    };
  }

  function scoreFactionMetrics(metrics) {
    var m = normalizeFactionMetrics(metrics);
    return (
      m.uniqueReactors * SCORE_WEIGHTS.uniqueReactors +
      m.positiveReactions * SCORE_WEIGHTS.positiveReactions +
      m.negativeReactions * SCORE_WEIGHTS.negativeReactions +
      m.uniqueCommenters * SCORE_WEIGHTS.uniqueCommenters +
      m.replyParticipants * SCORE_WEIGHTS.replyParticipants
    );
  }

  function calculateFactionBattleScores(factionsInput) {
    var src = factionsInput && typeof factionsInput === 'object' ? factionsInput : {};
    var scores = {};
    var metrics = {};
    var total = 0;
    var uniqueParticipants = 0;
    var i;
    for (i = 0; i < FACTIONS.length; i++) {
      var key = FACTIONS[i];
      var m = normalizeFactionMetrics(src[key]);
      metrics[key] = m;
      scores[key] = scoreFactionMetrics(m);
      total += scores[key];
      uniqueParticipants += m.uniqueReactors + m.uniqueCommenters + m.replyParticipants;
    }
    return {
      scores: scores,
      metrics: metrics,
      totalScore: total,
      uniqueParticipants: uniqueParticipants,
    };
  }

  function normalizeFactionBattleShares(scoresInput) {
    var scores = scoresInput && typeof scoresInput === 'object' ? scoresInput : {};
    var total = 0;
    var i;
    for (i = 0; i < FACTIONS.length; i++) {
      total += Math.max(0, Number(scores[FACTIONS[i]]) || 0);
    }
    var shares = {};
    if (total <= 0) {
      for (i = 0; i < FACTIONS.length; i++) shares[FACTIONS[i]] = 0;
      return { shares: shares, totalScore: 0 };
    }
    for (i = 0; i < FACTIONS.length; i++) {
      shares[FACTIONS[i]] = clamp01((Number(scores[FACTIONS[i]]) || 0) / total);
    }
    return { shares: shares, totalScore: total };
  }

  function rankedFactions(scores) {
    return FACTIONS.slice()
      .map(function (key) {
        return { key: key, score: Math.max(0, Number(scores[key]) || 0) };
      })
      .sort(function (a, b) {
        return b.score - a.score || a.key.localeCompare(b.key);
      });
  }

  function determineFactionBattleState(calcOrScores, opts) {
    var calc =
      calcOrScores && calcOrScores.scores
        ? calcOrScores
        : calculateFactionBattleScores(
            (function () {
              var fake = {};
              var i;
              for (i = 0; i < FACTIONS.length; i++) {
                fake[FACTIONS[i]] = { uniqueReactors: Number(calcOrScores && calcOrScores[FACTIONS[i]]) || 0 };
              }
              return fake;
            })()
          );

    var options = opts || {};
    var minUnique =
      options.minUniqueParticipants != null
        ? nonNegInt(options.minUniqueParticipants)
        : THRESHOLDS.minUniqueParticipants;
    var minScore =
      options.minTotalScore != null ? nonNegInt(options.minTotalScore) : THRESHOLDS.minTotalScore;

    if (calc.uniqueParticipants < minUnique || calc.totalScore < minScore) {
      return {
        state: STATES.INSUFFICIENT,
        winner: null,
        topShare: 0,
        gapToSecond: 0,
        ranking: rankedFactions(calc.scores),
      };
    }

    var sharePack = normalizeFactionBattleShares(calc.scores);
    var ranking = rankedFactions(calc.scores);
    var top = ranking[0];
    var second = ranking[1] || { score: 0 };
    var topShare = sharePack.shares[top.key] || 0;
    var secondShare = sharePack.shares[second.key] || 0;
    var gap = topShare - secondShare;

    var state = STATES.BALANCED;
    if (topShare >= THRESHOLDS.dominantShare && gap >= THRESHOLDS.dominantGap) {
      state = STATES.DOMINANT;
    } else if (topShare >= THRESHOLDS.leadingShare && gap >= THRESHOLDS.leadingGap) {
      state = STATES.LEADING;
    }

    return {
      state: state,
      winner: state === STATES.BALANCED || state === STATES.INSUFFICIENT ? null : top.key,
      topShare: topShare,
      gapToSecond: gap,
      ranking: ranking,
      shares: sharePack.shares,
      scores: calc.scores,
      metrics: calc.metrics,
      totalScore: calc.totalScore,
      uniqueParticipants: calc.uniqueParticipants,
    };
  }

  /** postId → 안정적 32bit */
  function hashPostId(postId) {
    var s = String(postId || '');
    var h = 2166136261;
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Deterministic Mock 참여 지표 (렌더마다 동일).
   * Math.random 사용 금지.
   */
  function buildDeterministicMockFactions(postId, boardType) {
    var seed = hashPostId(String(postId || '') + '|' + String(normalizeBoardType(boardType) || 'CENTRAL'));
    var rnd = mulberry32(seed);
    var modeRoll = rnd();
    var factions = {};
    var i;

    function metricsFromParts(uReact, pos, neg, uComment, reply) {
      return {
        uniqueReactors: nonNegInt(uReact),
        positiveReactions: nonNegInt(pos),
        negativeReactions: nonNegInt(neg),
        uniqueCommenters: nonNegInt(uComment),
        replyParticipants: nonNegInt(reply),
      };
    }

    if (modeRoll < 0.12) {
      for (i = 0; i < FACTIONS.length; i++) {
        factions[FACTIONS[i]] = metricsFromParts(
          Math.floor(rnd() * 2),
          Math.floor(rnd() * 2),
          Math.floor(rnd() * 2),
          Math.floor(rnd() * 1),
          0
        );
      }
    } else if (modeRoll < 0.34) {
      var base = 4 + Math.floor(rnd() * 4);
      for (i = 0; i < FACTIONS.length; i++) {
        var wobble = Math.floor(rnd() * 3) - 1;
        var u = Math.max(2, base + wobble);
        factions[FACTIONS[i]] = metricsFromParts(u, u + 1, Math.floor(u / 2), Math.max(1, u - 1), Math.floor(u / 2));
      }
    } else {
      var order = FACTIONS.slice();
      var oi;
      for (oi = order.length - 1; oi > 0; oi--) {
        var j = Math.floor(rnd() * (oi + 1));
        var tmp = order[oi];
        order[oi] = order[j];
        order[j] = tmp;
      }
      var dominantish = modeRoll > 0.72;
      var amounts = dominantish
        ? [14 + Math.floor(rnd() * 8), 3 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 3)]
        : [9 + Math.floor(rnd() * 5), 5 + Math.floor(rnd() * 3), 3 + Math.floor(rnd() * 3)];
      for (i = 0; i < FACTIONS.length; i++) {
        var n = amounts[i];
        factions[order[i]] = metricsFromParts(
          n,
          n + Math.floor(rnd() * 4),
          Math.floor(n * 0.4 + rnd() * 3),
          Math.max(1, Math.floor(n * 0.7)),
          Math.floor(n * 0.45)
        );
      }
    }

    return {
      postId: String(postId || ''),
      boardType: normalizeBoardType(boardType) || 'CENTRAL',
      factions: factions,
      dataStatus: 'MOCK',
    };
  }

  function evaluateFactionBattleContract(contract) {
    var c = contract && typeof contract === 'object' ? contract : {};
    var calc = calculateFactionBattleScores(c.factions);
    var state = determineFactionBattleState(calc);
    var shares = normalizeFactionBattleShares(calc.scores).shares;
    return {
      postId: String(c.postId || ''),
      boardType: normalizeBoardType(c.boardType),
      dataStatus: c.dataStatus === 'LIVE' ? 'LIVE' : 'MOCK',
      factions: calc.metrics,
      scores: calc.scores,
      shares: shares,
      state: state.state,
      winner: state.winner,
      topShare: state.topShare,
      gapToSecond: state.gapToSecond,
      totalScore: calc.totalScore,
      uniqueParticipants: calc.uniqueParticipants,
      ranking: state.ranking,
    };
  }

  function resolveFactionBattleForPost(postId, boardType, optionalContract) {
    if (!supportsFactionBattleUi(boardType)) {
      return {
        supported: false,
        postId: String(postId || ''),
        boardType: normalizeBoardType(boardType),
        state: STATES.INSUFFICIENT,
        winner: null,
        detailMode: 'NONE',
      };
    }
    var contract =
      optionalContract && optionalContract.factions
        ? {
            postId: postId,
            boardType: boardType,
            factions: optionalContract.factions,
            dataStatus: optionalContract.dataStatus || 'MOCK',
          }
        : buildDeterministicMockFactions(postId, boardType);
    var evaluated = evaluateFactionBattleContract(contract);
    var detailMode = 'NONE';
    if (evaluated.state === STATES.DOMINANT || evaluated.state === STATES.LEADING) {
      detailMode = 'SINGLE_WINNER';
    } else if (evaluated.state === STATES.BALANCED) {
      detailMode = 'BALANCED_THREE';
    }
    evaluated.supported = true;
    evaluated.detailMode = detailMode;
    evaluated.context = getFactionBattleContext(boardType);
    return evaluated;
  }

  return {
    FACTIONS: FACTIONS,
    FACTION_LABELS: FACTION_LABELS,
    FACTION_DATA_TERRITORY: FACTION_DATA_TERRITORY,
    SUPPORTED_BOARDS: SUPPORTED_BOARDS,
    SCORE_WEIGHTS: SCORE_WEIGHTS,
    THRESHOLDS: THRESHOLDS,
    STATES: STATES,
    normalizeBoardType: normalizeBoardType,
    supportsFactionBattleUi: supportsFactionBattleUi,
    getFactionBattleContext: getFactionBattleContext,
    emptyFactionMetrics: emptyFactionMetrics,
    normalizeFactionMetrics: normalizeFactionMetrics,
    calculateFactionBattleScores: calculateFactionBattleScores,
    normalizeFactionBattleShares: normalizeFactionBattleShares,
    determineFactionBattleState: determineFactionBattleState,
    hashPostId: hashPostId,
    buildDeterministicMockFactions: buildDeterministicMockFactions,
    evaluateFactionBattleContract: evaluateFactionBattleContract,
    resolveFactionBattleForPost: resolveFactionBattleForPost,
  };
});
