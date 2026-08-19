/**
 * Canonical progression XP SSOT — Lv1~10
 * 서버 · ProfileFrame · Guest 계산이 동일 규칙을 사용한다.
 *
 * xp = 누적 total XP
 * DELETE_XP_POLICY = PENDING (삭제 시 회수 로직 금지)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ProgressionXpCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function progressionXpCoreFactory() {
  'use strict';

  var MAX_LEVEL = 10;
  var MAX_TOTAL_XP = 1500;
  var DELETE_XP_POLICY = 'PENDING';

  /** 구간 XP: Lv1→2 … Lv9→10 · Lv10 게이지용 400 */
  var XP_PER_LEVEL = Object.freeze([40, 50, 60, 70, 80, 120, 160, 220, 300, 400]);

  /** 누적 경계: index 0 = Lv1 시작 … index 9 = Lv10 시작(1100) · index 10 = 게이지 cap(1500) */
  var LEVEL_CUMULATIVE_XP = Object.freeze([0, 40, 90, 150, 220, 300, 420, 580, 800, 1100, 1500]);

  var XP_REWARDS = Object.freeze({
    POST_CREATED: 25,
    post_write: 25,
    BOARD_COMMENT_CREATED: 12,
    board_comment: 12,
    COMMENT_CREATED: 12,
    ISSUE_COMMENT_CREATED: 10,
    issue_comment: 10,
  });

  var ACTIVITY_STATUS = Object.freeze({
    POST_CREATED: 'ACTIVE',
    BOARD_COMMENT_CREATED: 'ACTIVE',
    ISSUE_COMMENT_CREATED: 'ACTIVE',
  });

  function normalizeXp(totalXp) {
    var xp = Math.floor(Number(totalXp));
    if (!isFinite(xp) || isNaN(xp) || xp < 0) return 0;
    return xp;
  }

  function clampLevel(level) {
    var n = Math.floor(Number(level));
    if (!isFinite(n) || isNaN(n) || n < 1) return 1;
    if (n > MAX_LEVEL) return MAX_LEVEL;
    return n;
  }

  /** total XP → level (1~10) */
  function calculateLevelFromXp(totalXp) {
    var xp = normalizeXp(totalXp);
    var lv = 1;
    var i;
    /* LEVEL_CUMULATIVE_XP[0..9] = Lv1..Lv10 시작점 · [10]=1500 게이지 cap */
    for (i = 9; i >= 0; i--) {
      if (xp >= LEVEL_CUMULATIVE_XP[i]) {
        lv = i + 1;
        break;
      }
    }
    return clampLevel(lv);
  }

  /**
   * 현재 레벨 구간 진행률.
   * Lv10: floor 1100 · ceiling 1500 · 1500+ → 100%
   */
  function xpProgressInLevel(level, totalXp) {
    var lv = clampLevel(level);
    var xp = normalizeXp(totalXp);
    var floor = LEVEL_CUMULATIVE_XP[lv - 1] || 0;
    if (lv >= MAX_LEVEL) {
      var maxFloor = LEVEL_CUMULATIVE_XP[9];
      var maxCeil = LEVEL_CUMULATIVE_XP[10];
      var neededMax = Math.max(1, maxCeil - maxFloor);
      var currentMax = Math.max(0, Math.min(neededMax, xp - maxFloor));
      var pctMax = xp >= MAX_TOTAL_XP ? 100 : Math.round((100 * currentMax) / neededMax);
      return Object.freeze({
        floor: maxFloor,
        ceiling: maxCeil,
        current: currentMax,
        needed: neededMax,
        pct: Math.max(0, Math.min(100, pctMax)),
        isMaxLevel: true,
      });
    }
    var ceiling = LEVEL_CUMULATIVE_XP[lv] || floor;
    var needed = Math.max(1, ceiling - floor);
    var current = Math.max(0, Math.min(needed, xp - floor));
    var pct = Math.round((100 * current) / needed);
    return Object.freeze({
      floor: floor,
      ceiling: ceiling,
      current: current,
      needed: needed,
      pct: Math.max(0, Math.min(100, pct)),
      isMaxLevel: false,
    });
  }

  function buildProgressionDisplay(level, totalXp) {
    var lv = level != null ? clampLevel(level) : calculateLevelFromXp(totalXp);
    var xp = normalizeXp(totalXp);
    var progress = xpProgressInLevel(lv, xp);
    return Object.freeze({
      level: lv,
      xp: xp,
      expPercent: progress.pct,
      progress: progress,
    });
  }

  function xpRewardForEvent(eventType) {
    var key = String(eventType || '').trim();
    if (!key) return 0;
    var n = XP_REWARDS[key];
    return n != null ? n : 0;
  }

  function dedupeKeyForPostCreated(postId) {
    return 'POST_CREATED:' + String(postId || '').trim();
  }

  function dedupeKeyForBoardCommentCreated(commentId) {
    return 'BOARD_COMMENT_CREATED:' + String(commentId || '').trim();
  }

  function dedupeKeyForIssueCommentCreated(commentId) {
    return 'ISSUE_COMMENT_CREATED:' + String(commentId || '').trim();
  }

  return Object.freeze({
    MAX_LEVEL: MAX_LEVEL,
    MAX_TOTAL_XP: MAX_TOTAL_XP,
    DELETE_XP_POLICY: DELETE_XP_POLICY,
    XP_PER_LEVEL: XP_PER_LEVEL,
    LEVEL_CUMULATIVE_XP: LEVEL_CUMULATIVE_XP,
    XP_REWARDS: XP_REWARDS,
    ACTIVITY_STATUS: ACTIVITY_STATUS,
    normalizeXp: normalizeXp,
    clampLevel: clampLevel,
    calculateLevelFromXp: calculateLevelFromXp,
    levelFromTotalXp: calculateLevelFromXp,
    xpProgressInLevel: xpProgressInLevel,
    buildProgressionDisplay: buildProgressionDisplay,
    xpRewardForEvent: xpRewardForEvent,
    dedupeKeyForPostCreated: dedupeKeyForPostCreated,
    dedupeKeyForBoardCommentCreated: dedupeKeyForBoardCommentCreated,
    dedupeKeyForIssueCommentCreated: dedupeKeyForIssueCommentCreated,
  });
});
