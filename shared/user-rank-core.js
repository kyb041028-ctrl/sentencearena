/**
 * 명성등급(reputation grade)과 시민등급(citizen rank) 분리
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./user-data-config-core'));
  } else {
    root.UserRankCore = factory(root.UserDataConfigCore);
  }
})(typeof self !== 'undefined' ? self : this, function userRankCoreFactory(cfg) {
  'use strict';

  var REPUTATION_GRADE_LABELS = Object.freeze({
    0: '참여자',
    1: '시민',
    2: '논객',
    3: '대표',
    4: '지도자',
  });

  function normalizeReputationScore(value) {
    if (value === null || value === undefined || value === '') {
      return { valid: true, score: 0 };
    }
    var n = Math.floor(Number(value));
    if (!isFinite(n) || isNaN(n)) return { valid: false, error: 'REPUTATION_SCORE_INVALID', score: null };
    if (n < 0) return { valid: false, error: 'REPUTATION_SCORE_NEGATIVE', score: null };
    return { valid: true, score: n };
  }

  /**
   * 명성 점수만으로 tier 자동 산정은 미확정.
   * rankTier가 제공되면 label 매핑 (player-progression Mock 기반).
   */
  function getReputationGrade(input) {
    var src = input || {};
    if (src.rankTier != null && REPUTATION_GRADE_LABELS[src.rankTier] != null) {
      return {
        grade: src.rankTier,
        gradeLabel: REPUTATION_GRADE_LABELS[src.rankTier],
        available: true,
        source: 'RANK_TIER_MOCK',
      };
    }
    return {
      grade: null,
      gradeLabel: null,
      available: false,
      source: 'REPUTATION_GRADE_POLICY_NOT_FINALIZED',
    };
  }

  function buildReputationState(input) {
    var src = input || {};
    var parsed = normalizeReputationScore(src.score != null ? src.score : src.reputationScore);
    var grade = getReputationGrade(src);
    return {
      reputation: {
        score: parsed.valid ? parsed.score : null,
        grade: grade.grade,
        gradeLabel: grade.gradeLabel,
        available: parsed.valid && grade.available,
        source: grade.source,
        error: parsed.error || null,
      },
      citizen: buildCitizenRankState(src),
    };
  }

  function buildCitizenRankState(input) {
    var src = input || {};
    return {
      rank: src.citizenRank != null ? src.citizenRank : null,
      rankLabel: src.citizenRankLabel != null ? src.citizenRankLabel : null,
      available: false,
      source: 'CITIZEN_RANK_POLICY_NOT_FINALIZED',
    };
  }

  function validateCitizenRank(value) {
    if (value == null || value === '') return { valid: true, rank: null };
    return { valid: false, error: 'CITIZEN_RANK_NOT_FINALIZED', rank: null };
  }

  function compareRankChange(before, after) {
    var b = before == null ? null : String(before);
    var a = after == null ? null : String(after);
    return { changed: b !== a, before: b, after: a };
  }

  function hasReputationDeductPolicy() {
    return false;
  }

  return {
    REPUTATION_GRADE_LABELS: REPUTATION_GRADE_LABELS,
    normalizeReputationScore: normalizeReputationScore,
    getReputationGrade: getReputationGrade,
    buildReputationState: buildReputationState,
    buildCitizenRankState: buildCitizenRankState,
    validateCitizenRank: validateCitizenRank,
    compareRankChange: compareRankChange,
    hasReputationDeductPolicy: hasReputationDeductPolicy,
  };
});
