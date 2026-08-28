/**
 * 센텐스아레나 — 진영 전황(Faction Battle) 공용 규칙·계약
 * 브라우저(UMD) · Node(CommonJS)
 *
 * 목록/상세 UI 계약 + 게시글별 실집계.
 * Mock 가중치(SCORE_WEIGHTS)는 체험용 Mock 전용. 실집계는 LIVE 규칙을 쓴다.
 * alignment / 명성 / XP 와 독립.
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

  function earthFactionKey(territory) {
    var op = normalizeBoardType(territory);
    if (op === 'PIONEER') return 'pioneer';
    if (op === 'CENTRAL') return 'central';
    if (op === 'GUARDIAN') return 'guardian';
    return null;
  }

  function isPositiveType(type) {
    var t = String(type || '').toUpperCase();
    return t === 'LIKE' || t === 'RECOMMEND';
  }

  function isNegativeType(type) {
    var t = String(type || '').toUpperCase();
    return t === 'DISLIKE' || t === 'DOWNVOTE';
  }

  function isActiveComment(row) {
    if (!row) return false;
    var status = String(row.status || 'ACTIVE').toUpperCase();
    if (status !== 'ACTIVE') return false;
    if (row.deletedAt || row.deleted_at) return false;
    return true;
  }

  function isActiveReaction(row) {
    if (!row) return false;
    if (row.cancelledAt || row.cancelled_at) return false;
    var scope = String(row.audienceScope || row.audience_scope || 'EARTH').toUpperCase();
    if (scope === 'ALIEN') return false;
    var type = String(row.reactionType || row.reaction_type || '').toUpperCase();
    if (type === 'EMPATHY') return false;
    return isPositiveType(type) || isNegativeType(type);
  }

  /**
   * 원글 반응 → 작성자 진영 점수.
   * 같은 진영 LIKE +0.8 / DISLIKE -1.2
   * 다른 진영 LIKE +1.2 / DISLIKE -0.8
   * tenths로 계산해 0.8+1.2 오차를 피한다.
   */
  function postReactionTenthsForAuthor(authorFk, actorFk, isLike) {
    if (!authorFk || !actorFk) return 0;
    var same = authorFk === actorFk;
    if (isLike) return same ? 8 : 12;
    return same ? -12 : -8;
  }

  /**
   * LIVE 집계. Mock SCORE_WEIGHTS 미사용.
   * 댓글/대댓글: 사람당 진영 참여 1회. 도배 점수 없음.
   * 댓글 반응: 작성자 진영 LIKE +1 / DISLIKE -1 (활성만).
   * 원글 반응: 작성자 진영에 관계 점수. 확실한 Earth 진영이 없으면 점수만 생략.
   */
  function aggregateLiveFactionBattle(input) {
    var src = input || {};
    var comments = Array.isArray(src.comments) ? src.comments : [];
    var reactions = Array.isArray(src.reactions) ? src.reactions : [];
    var authorFk = earthFactionKey(src.authorTerritory || src.author_territory);
    var people = {};
    var factionPeople = { pioneer: {}, central: {}, guardian: {} };
    var commentById = {};
    var metrics = {
      pioneer: emptyFactionMetrics(),
      central: emptyFactionMetrics(),
      guardian: emptyFactionMetrics(),
    };
    var commentLike = { pioneer: 0, central: 0, guardian: 0 };
    var commentDislike = { pioneer: 0, central: 0, guardian: 0 };
    var postReactionTenths = { pioneer: 0, central: 0, guardian: 0 };
    var i;

    function markPerson(userId, factionKey, bucket) {
      var uid = String(userId || '').trim();
      if (!uid || !factionKey) return;
      people[uid] = true;
      factionPeople[factionKey][uid] = true;
      if (bucket === 'comment') metrics[factionKey].uniqueCommenters += 1;
      else if (bucket === 'reply') metrics[factionKey].replyParticipants += 1;
      else if (bucket === 'react') metrics[factionKey].uniqueReactors += 1;
    }

    var commentAuthorOnce = { pioneer: {}, central: {}, guardian: {} };
    var replyAuthorOnce = { pioneer: {}, central: {}, guardian: {} };
    var reactorOnce = { pioneer: {}, central: {}, guardian: {} };

    for (i = 0; i < comments.length; i++) {
      var c = comments[i];
      if (!isActiveComment(c)) continue;
      var cid = String(c.id || '');
      if (!cid) continue;
      commentById[cid] = c;
      var fk = earthFactionKey(c.territory);
      var authorId = c.authorUserId || c.author_user_id;
      if (!fk) continue;
      var isReply = !!(c.parentCommentId || c.parent_comment_id);
      var onceMap = isReply ? replyAuthorOnce : commentAuthorOnce;
      var uid = String(authorId || '').trim();
      if (uid && !onceMap[fk][uid]) {
        onceMap[fk][uid] = true;
        markPerson(uid, fk, isReply ? 'reply' : 'comment');
      } else if (uid) {
        people[uid] = true;
        factionPeople[fk][uid] = true;
      }
    }

    for (i = 0; i < reactions.length; i++) {
      var r = reactions[i];
      if (!isActiveReaction(r)) continue;
      var targetType = String(r.targetType || r.target_type || '').toUpperCase();
      var actorId = r.actorUserId || r.actor_user_id;
      var actorFk = earthFactionKey(r.actorTerritoryAtReaction || r.actor_territory_at_reaction);
      if (actorFk) {
        var auid = String(actorId || '').trim();
        if (auid && !reactorOnce[actorFk][auid]) {
          reactorOnce[actorFk][auid] = true;
          markPerson(auid, actorFk, 'react');
        } else if (auid && actorFk) {
          people[auid] = true;
          factionPeople[actorFk][auid] = true;
        }
      }
      if (targetType === 'COMMENT') {
        var commentId = String(r.commentId || r.comment_id || '');
        var host = commentById[commentId];
        if (!host || !isActiveComment(host)) continue;
        var hostFk = earthFactionKey(host.territory);
        if (!hostFk) continue;
        if (isPositiveType(r.reactionType || r.reaction_type)) commentLike[hostFk] += 1;
        else if (isNegativeType(r.reactionType || r.reaction_type)) commentDislike[hostFk] += 1;
      } else if (targetType === 'POST') {
        if (authorFk && actorFk) {
          var likePost = isPositiveType(r.reactionType || r.reaction_type);
          postReactionTenths[authorFk] += postReactionTenthsForAuthor(authorFk, actorFk, likePost);
        }
      }
    }

    var scores = {};
    var postReactionByFaction = { pioneer: 0, central: 0, guardian: 0 };
    var totalScore = 0;
    var uniqueParticipants = Object.keys(people).length;
    for (i = 0; i < FACTIONS.length; i++) {
      var key = FACTIONS[i];
      var uniqueInFaction = Object.keys(factionPeople[key]).length;
      var postDelta = postReactionTenths[key] / 10;
      postReactionByFaction[key] = postDelta;
      var raw = uniqueInFaction + commentLike[key] - commentDislike[key] + postDelta;
      raw = Math.round(raw * 10) / 10;
      scores[key] = raw > 0 ? raw : 0;
      totalScore += scores[key];
      metrics[key].positiveReactions = commentLike[key];
      metrics[key].negativeReactions = commentDislike[key];
      metrics[key].uniquePeople = uniqueInFaction;
    }

    return {
      scores: scores,
      metrics: metrics,
      totalScore: totalScore,
      uniqueParticipants: uniqueParticipants,
      uniqueByFaction: {
        pioneer: Object.keys(factionPeople.pioneer).length,
        central: Object.keys(factionPeople.central).length,
        guardian: Object.keys(factionPeople.guardian).length,
      },
      commentLike: commentLike,
      commentDislike: commentDislike,
      postReactionByFaction: postReactionByFaction,
      postReactionScoreRule: 'AUTHOR_RELATION',
    };
  }

  function attachDetailMode(evaluated) {
    var detailMode = 'NONE';
    if (evaluated.state === STATES.DOMINANT || evaluated.state === STATES.LEADING) {
      detailMode = 'SINGLE_WINNER';
    } else if (evaluated.state === STATES.BALANCED) {
      detailMode = 'BALANCED_THREE';
    }
    evaluated.detailMode = detailMode;
    return evaluated;
  }

  function evaluateLiveFactionBattle(input) {
    var src = input || {};
    var live = aggregateLiveFactionBattle(src);
    var state = determineFactionBattleState({
      scores: live.scores,
      uniqueParticipants: live.uniqueParticipants,
      totalScore: live.totalScore,
    });
    var shares = normalizeFactionBattleShares(live.scores).shares;
    return attachDetailMode({
      postId: String(src.postId || ''),
      boardType: normalizeBoardType(src.boardType),
      dataStatus: 'LIVE',
      supported: true,
      factions: live.metrics,
      scores: live.scores,
      shares: shares,
      state: state.state,
      winner: state.winner,
      topShare: state.topShare,
      gapToSecond: state.gapToSecond,
      totalScore: live.totalScore,
      uniqueParticipants: live.uniqueParticipants,
      uniqueByFaction: live.uniqueByFaction,
      ranking: state.ranking,
      context: getFactionBattleContext(src.boardType),
      commentLike: live.commentLike,
      commentDislike: live.commentDislike,
      postReactionByFaction: live.postReactionByFaction,
      postReactionScoreRule: live.postReactionScoreRule,
    });
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
    if (optionalContract && optionalContract.dataStatus === 'LIVE') {
      if (optionalContract.scores && optionalContract.state) {
        var liveSnap = {
          postId: String(postId || optionalContract.postId || ''),
          boardType: normalizeBoardType(boardType || optionalContract.boardType),
          dataStatus: 'LIVE',
          supported: true,
          factions: optionalContract.factions || {},
          scores: optionalContract.scores,
          shares: optionalContract.shares || normalizeFactionBattleShares(optionalContract.scores).shares,
          state: optionalContract.state,
          winner: optionalContract.winner,
          topShare: optionalContract.topShare || 0,
          gapToSecond: optionalContract.gapToSecond || 0,
          totalScore: optionalContract.totalScore || 0,
          uniqueParticipants: optionalContract.uniqueParticipants || 0,
          uniqueByFaction: optionalContract.uniqueByFaction,
          ranking: optionalContract.ranking,
          context: getFactionBattleContext(boardType),
          postReactionScoreRule: optionalContract.postReactionScoreRule || 'AUTHOR_RELATION',
          postReactionByFaction: optionalContract.postReactionByFaction,
        };
        return attachDetailMode(liveSnap);
      }
      return evaluateLiveFactionBattle({
        postId: postId,
        boardType: boardType,
        comments: optionalContract.comments,
        reactions: optionalContract.reactions,
      });
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
    evaluated.supported = true;
    evaluated.context = getFactionBattleContext(boardType);
    return attachDetailMode(evaluated);
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
    earthFactionKey: earthFactionKey,
    postReactionTenthsForAuthor: postReactionTenthsForAuthor,
    aggregateLiveFactionBattle: aggregateLiveFactionBattle,
    evaluateLiveFactionBattle: evaluateLiveFactionBattle,
    resolveFactionBattleForPost: resolveFactionBattleForPost,
  };
});
