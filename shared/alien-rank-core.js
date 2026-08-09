/**
 * 센텐스아레나 — 외계 랭크·주간 인기인 정의 (점수식 미구현)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlienRankCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function alienRankCoreFactory() {
  'use strict';

  var RANK = Object.freeze({
    APPRENTICE: 'APPRENTICE',
    SENIOR: 'SENIOR',
    CHIEF: 'CHIEF',
    TOP: 'TOP',
  });

  var RANK_LABELS = Object.freeze({
    APPRENTICE: '견습',
    SENIOR: '선임',
    CHIEF: '수석',
    TOP: '최고',
  });

  var RANK_ORDER = Object.freeze([
    RANK.APPRENTICE,
    RANK.SENIOR,
    RANK.CHIEF,
    RANK.TOP,
  ]);

  /** 가중치 방향만 문서화 — 수치 임계값·상한 미확정 */
  var SCORE_WEIGHT_HINTS = Object.freeze({
    empathyShare: 0.6,
    activityShare: 0.2,
    likeShare: 0.2,
    dailyActivityCap: null,
    note: 'FORMULA_NOT_IMPLEMENTED',
  });

  function getRankLabel(rank) {
    return RANK_LABELS[rank] || null;
  }

  function listRankDefinitions() {
    return RANK_ORDER.map(function (r) {
      return { rank: r, rankLabel: RANK_LABELS[r] };
    });
  }

  function buildAlienRankContract(parts) {
    var p = parts || {};
    return {
      userId: p.userId || null,
      rank: p.rank || null,
      rankLabel: p.rank ? getRankLabel(p.rank) : null,
      score: null,
      weeklyScore: null,
      activityComponents: null,
      legendaryHistory: Array.isArray(p.legendaryHistory) ? p.legendaryHistory.slice() : [],
      updatedAt: p.updatedAt || null,
      calculationEnabled: false,
      note: 'RANK_CALCULATION_NOT_IMPLEMENTED',
    };
  }

  function buildAlienWeeklyLegendCandidate(input) {
    var src = input || {};
    return {
      weekKey: src.weekKey || null,
      userId: src.userId || null,
      score: null,
      components: {},
      calculationVersion: 'UNIMPLEMENTED',
      note: 'WEEKLY_LEGEND_FORMULA_NOT_IMPLEMENTED',
    };
  }

  function planAlienWeeklyLegendSelection(input) {
    return {
      ok: false,
      error: 'WEEKLY_SELECTION_NOT_IMPLEMENTED',
      weekKey: input && input.weekKey,
      candidates: [],
      persistForbidden: true,
    };
  }

  function buildLegendHistoryEntry(input) {
    var src = input || {};
    return {
      weekKey: src.weekKey,
      userId: src.userId,
      rankPosition: src.rankPosition != null ? src.rankPosition : 1,
      score: src.score != null ? src.score : null,
      selectedAt: src.selectedAt || null,
      permanent: true,
      achievementKeyHint: 'became_legend',
      achievementGranted: false,
    };
  }

  return {
    RANK: RANK,
    RANK_LABELS: RANK_LABELS,
    RANK_ORDER: RANK_ORDER,
    SCORE_WEIGHT_HINTS: SCORE_WEIGHT_HINTS,
    getRankLabel: getRankLabel,
    listRankDefinitions: listRankDefinitions,
    buildAlienRankContract: buildAlienRankContract,
    buildAlienWeeklyLegendCandidate: buildAlienWeeklyLegendCandidate,
    planAlienWeeklyLegendSelection: planAlienWeeklyLegendSelection,
    buildLegendHistoryEntry: buildLegendHistoryEntry,
  };
});
