/**
 * 센텐스아레나 — 인기글 점수·기간 공용 규칙
 * 브라우저(UMD) · Node(CommonJS)
 *
 * 운영 인기글 공식 (기간 내 실제 활동):
 *   (원글 EMPATHY × 2) + 원글 LIKE + 원글 DISLIKE + 댓글/대댓글 고유 참여자
 *
 * 기간은 게시글 작성일이 아니라 활동 발생 시각.
 * 본문 길이·조회수·댓글 개수 합산·시간감쇠 없음.
 * 정치성향 / 진영 전황 / 명성 계산과 독립.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PopularPostsCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function popularPostsCoreFactory() {
  'use strict';

  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var WEEK_MS = 7 * DAY_MS;
  var MONTH_MS = 30 * DAY_MS;

  var PERIODS = Object.freeze(['day', 'week', 'month']);

  var WEIGHTS = Object.freeze({
    empathy: 2,
    like: 1,
    dislike: 1,
    uniqueCommenter: 1,
  });

  var EARTH_TERRITORY = Object.freeze({
    CENTRAL: 'CENTRAL',
    PIONEER: 'PIONEER',
    GUARDIAN: 'GUARDIAN',
    COMMON: 'CENTRAL',
    CENTRIST: 'CENTRAL',
    PROGRESSIVE: 'PIONEER',
    CONSERVATIVE: 'GUARDIAN',
  });

  function toMillis(value) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    var t = new Date(value).getTime();
    return isFinite(t) ? t : NaN;
  }

  function normalizePeriod(value) {
    var v = String(value || '').trim().toLowerCase();
    if (v === 'week' || v === 'weekly') return 'week';
    if (v === 'month' || v === 'monthly') return 'month';
    return 'day';
  }

  function normalizeEarthTerritory(value) {
    var raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    if (EARTH_TERRITORY[raw]) return EARTH_TERRITORY[raw];
    return '';
  }

  function kstStartOfTodayMs(nowMs) {
    var now = isFinite(nowMs) ? nowMs : Date.now();
    var shifted = new Date(now + KST_OFFSET_MS);
    var y = shifted.getUTCFullYear();
    var m = shifted.getUTCMonth();
    var d = shifted.getUTCDate();
    return Date.UTC(y, m, d) - KST_OFFSET_MS;
  }

  function resolvePeriodWindow(period, nowMs) {
    var now = isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    var p = normalizePeriod(period);
    var fromMs;
    if (p === 'week') fromMs = now - WEEK_MS;
    else if (p === 'month') fromMs = now - MONTH_MS;
    else fromMs = kstStartOfTodayMs(now);
    return {
      period: p,
      fromMs: fromMs,
      toMs: now,
    };
  }

  function inWindow(isoOrMs, fromMs, untilMs) {
    var t = toMillis(isoOrMs);
    if (!isFinite(t)) return false;
    if (isFinite(fromMs) && t < fromMs) return false;
    if (isFinite(untilMs) && t > untilMs) return false;
    return true;
  }

  function nonneg(n) {
    var v = Math.floor(Number(n) || 0);
    return v > 0 ? v : 0;
  }

  function scoreFromCounts(input) {
    var src = input || {};
    var empathyCount = nonneg(src.empathyCount);
    var likeCount = nonneg(src.likeCount);
    var dislikeCount = nonneg(src.dislikeCount);
    var uniqueCommenterCount = nonneg(src.uniqueCommenterCount);
    var score =
      empathyCount * WEIGHTS.empathy +
      likeCount * WEIGHTS.like +
      dislikeCount * WEIGHTS.dislike +
      uniqueCommenterCount * WEIGHTS.uniqueCommenter;
    return {
      score: score,
      empathyCount: empathyCount,
      likeCount: likeCount,
      dislikeCount: dislikeCount,
      uniqueCommenterCount: uniqueCommenterCount,
    };
  }

  function pick(row, camel, snake) {
    if (!row) return null;
    if (row[camel] != null) return row[camel];
    if (row[snake] != null) return row[snake];
    return null;
  }

  function isActiveComment(row) {
    var status = String(pick(row, 'status', 'status') || 'ACTIVE').toUpperCase();
    if (status !== 'ACTIVE') return false;
    if (pick(row, 'deletedAt', 'deleted_at')) return false;
    return true;
  }

  function isCancelledReaction(row) {
    return !!(pick(row, 'cancelledAt', 'cancelled_at'));
  }

  function reactionIsPost(row) {
    var t = String(pick(row, 'targetType', 'target_type') || 'POST').toUpperCase();
    return t === 'POST';
  }

  function isLikeType(type) {
    var t = String(type || '').toUpperCase();
    return t === 'LIKE' || t === 'RECOMMEND';
  }

  function isDislikeType(type) {
    var t = String(type || '').toUpperCase();
    return t === 'DISLIKE' || t === 'DOWNVOTE';
  }

  function emptyBucket() {
    return {
      empathyCount: 0,
      likeCount: 0,
      dislikeCount: 0,
      commenters: Object.create(null),
    };
  }

  function aggregateActivity(input, window) {
    var src = input || {};
    var fromMs = window && isFinite(window.fromMs) ? window.fromMs : 0;
    var toMs = window && isFinite(window.toMs) ? window.toMs : Date.now();
    var buckets = Object.create(null);

    function bucket(id) {
      var key = String(id || '').trim();
      if (!key) return null;
      if (!buckets[key]) buckets[key] = emptyBucket();
      return buckets[key];
    }

    var empathyEvents = src.empathyEvents || src.empathy || [];
    var ei;
    for (ei = 0; ei < empathyEvents.length; ei++) {
      var ev = empathyEvents[ei];
      if (!ev) continue;
      var sourceType = String(pick(ev, 'sourceType', 'source_type') || 'board_post').toLowerCase();
      if (sourceType && sourceType !== 'board_post') continue;
      if (!inWindow(pick(ev, 'occurredAt', 'occurred_at'), fromMs, toMs)) continue;
      var b = bucket(pick(ev, 'sourceId', 'source_id'));
      if (b) b.empathyCount += 1;
    }

    var reactions = src.reactions || [];
    var ri;
    for (ri = 0; ri < reactions.length; ri++) {
      var rx = reactions[ri];
      if (!rx || isCancelledReaction(rx) || !reactionIsPost(rx)) continue;
      if (!inWindow(pick(rx, 'createdAt', 'created_at'), fromMs, toMs)) continue;
      var rb = bucket(pick(rx, 'postId', 'post_id'));
      if (!rb) continue;
      var rtype = pick(rx, 'reactionType', 'reaction_type');
      if (isLikeType(rtype)) rb.likeCount += 1;
      else if (isDislikeType(rtype)) rb.dislikeCount += 1;
    }

    var comments = src.comments || [];
    var ci;
    for (ci = 0; ci < comments.length; ci++) {
      var c = comments[ci];
      if (!c || !isActiveComment(c)) continue;
      if (!inWindow(pick(c, 'createdAt', 'created_at'), fromMs, toMs)) continue;
      var cb = bucket(pick(c, 'postId', 'post_id'));
      var uid = String(pick(c, 'authorUserId', 'author_user_id') || '').trim();
      if (!cb || !uid) continue;
      cb.commenters[uid] = true;
    }

    var out = Object.create(null);
    var ids = Object.keys(buckets);
    var pi;
    for (pi = 0; pi < ids.length; pi++) {
      var id = ids[pi];
      var row = buckets[id];
      var uniqueCommenterCount = Object.keys(row.commenters).length;
      out[id] = scoreFromCounts({
        empathyCount: row.empathyCount,
        likeCount: row.likeCount,
        dislikeCount: row.dislikeCount,
        uniqueCommenterCount: uniqueCommenterCount,
      });
    }
    return out;
  }

  function compareRank(a, b) {
    var sa = a && isFinite(a.score) ? a.score : 0;
    var sb = b && isFinite(b.score) ? b.score : 0;
    if (sb !== sa) return sb - sa;
    var ta = toMillis(a && (a.createdAt || a.created_at));
    var tb = toMillis(b && (b.createdAt || b.created_at));
    if (isFinite(tb) && isFinite(ta) && tb !== ta) return tb - ta;
    return 0;
  }

  return {
    PERIODS: PERIODS,
    WEIGHTS: WEIGHTS,
    KST_OFFSET_MS: KST_OFFSET_MS,
    normalizePeriod: normalizePeriod,
    normalizeEarthTerritory: normalizeEarthTerritory,
    kstStartOfTodayMs: kstStartOfTodayMs,
    resolvePeriodWindow: resolvePeriodWindow,
    inWindow: inWindow,
    scoreFromCounts: scoreFromCounts,
    aggregateActivity: aggregateActivity,
    compareRank: compareRank,
  };
});
