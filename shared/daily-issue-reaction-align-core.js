/**
 * 데일리 이슈 댓글 반응 → LEGACY_LOCAL 즉시 성향 처리 계획
 * 일반 게시판 onToggleCommentReaction 의 applyReactionScoresWithMult 호출 순서와 동일.
 * Node(CommonJS) · 브라우저(UMD) 공용.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueReactionAlignCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueReactionAlignCoreFactory() {
  'use strict';

  /**
   * 좋아요·싫어요는 동시 보유하지 않음(일반 게시판과 동일).
   * @param {boolean} inL 현재 좋아요 여부
   * @param {boolean} inD 현재 싫어요 여부
   * @param {boolean} asLike true=좋아요 토글, false=싫어요 토글
   * @returns {{ ops: Array<{isLike:boolean, mult:number, receivedLikeDelta:number}>, nextLiked:boolean, nextDisliked:boolean }}
   */
  function planCommentReactionAlignmentOps(inL, inD, asLike) {
    var ops = [];
    var liked = !!inL;
    var disliked = !!inD;
    if (asLike) {
      if (liked) {
        liked = false;
        ops.push({ isLike: true, mult: -1, receivedLikeDelta: -1 });
      } else {
        if (disliked) {
          disliked = false;
          ops.push({ isLike: false, mult: -1, receivedLikeDelta: 0 });
        }
        liked = true;
        ops.push({ isLike: true, mult: 1, receivedLikeDelta: 1 });
      }
    } else {
      if (disliked) {
        disliked = false;
        ops.push({ isLike: false, mult: -1, receivedLikeDelta: 0 });
      } else {
        if (liked) {
          liked = false;
          ops.push({ isLike: true, mult: -1, receivedLikeDelta: -1 });
        }
        disliked = true;
        ops.push({ isLike: false, mult: 1, receivedLikeDelta: 0 });
      }
    }
    return { ops: ops, nextLiked: liked, nextDisliked: disliked };
  }

  function isAlienTerritoryId(tid) {
    var t = String(tid || '').trim().toUpperCase();
    if (!t) return false;
    return t === 'KANTAPBIYA' || t === 'ALIEN' || t.indexOf('KANTAPBIYA') === 0;
  }

  /**
   * @returns {{ apply: boolean, reason: string }}
   */
  function evaluateAlignmentGate(input) {
    var src = input || {};
    var actorId = String(src.actorId || '').trim();
    var authorId = String(src.authorId || '').trim();
    if (!actorId || !authorId) return { apply: false, reason: 'MISSING_USER' };
    if (actorId === 'guest' || authorId === 'guest') return { apply: false, reason: 'GUEST_USER' };
    if (actorId === authorId) return { apply: false, reason: 'SELF_REACTION' };
    if (!src.hasScoringModule) return { apply: false, reason: 'SCORING_MODULE_MISSING' };
    if (src.isAlienActor || isAlienTerritoryId(src.actorTerritory)) {
      return { apply: false, reason: 'ALIEN_ACTOR' };
    }
    if (src.isAlienAuthor || isAlienTerritoryId(src.authorTerritory)) {
      return { apply: false, reason: 'ALIEN_AUTHOR' };
    }
    if (!String(src.authorTerritory || '').trim()) {
      return { apply: false, reason: 'AUTHOR_TERRITORY_UNKNOWN' };
    }
    if (!String(src.actorTerritory || '').trim()) {
      return { apply: false, reason: 'ACTOR_TERRITORY_UNKNOWN' };
    }
    return { apply: true, reason: 'OK' };
  }

  return {
    planCommentReactionAlignmentOps: planCommentReactionAlignmentOps,
    evaluateAlignmentGate: evaluateAlignmentGate,
    isAlienTerritoryId: isAlienTerritoryId,
  };
});
