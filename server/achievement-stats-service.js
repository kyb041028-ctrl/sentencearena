'use strict';

/**
 * 서버 canonical 업적 통계 — DB에서만 조회. 클라이언트 count/level 신뢰 금지.
 * 테이블·migration 미적용 시 해당 필드는 null (CONDITION_DATA_NOT_CONNECTED).
 */

const persist = require('./achievement-persist-service');

let _statsClient = null;
let _statsInjected = null;

function setStatsClientForTests(client) {
  _statsInjected = client || null;
}

function resetStatsClientForTests() {
  _statsInjected = null;
}

function getStatsClient() {
  if (_statsInjected) return _statsInjected;
  if (_statsClient) return _statsClient;
  try {
    _statsClient = persist.getAdminClient();
    return _statsClient;
  } catch (_) {
    return null;
  }
}

async function safeCount(queryPromise) {
  try {
    const result = await queryPromise;
    if (result.error) return null;
    if (typeof result.count === 'number') return result.count;
    return Array.isArray(result.data) ? result.data.length : null;
  } catch (_) {
    return null;
  }
}

async function loadAchievementStats(userId) {
  const uid = String(userId || '').trim();
  const stats = {
    validPostCount: null,
    validCommentOnOthersPostCount: null,
    validEmpathyReceivedCount: null,
    distinctActiveDaysInWindow: null,
    distinctPostsWithValidComments: null,
    distinctUsersEmpathyReceived: null,
    progression: null,
  };
  if (!uid) return stats;

  const sb = getStatsClient();
  if (!sb) return stats;

  const windowDays = 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  stats.validPostCount = await safeCount(
    sb
      .from('board_posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_user_id', uid)
      .eq('status', 'ACTIVE')
  );

  const commentsRes = await sb
    .from('board_comments')
    .select('post_id')
    .eq('author_user_id', uid)
    .eq('status', 'ACTIVE');
  if (!commentsRes.error && Array.isArray(commentsRes.data) && commentsRes.data.length) {
    var postIds = [];
    commentsRes.data.forEach(function (row) {
      if (row && row.post_id) postIds.push(String(row.post_id));
    });
    postIds = postIds.filter(function (id, i, arr) {
      return arr.indexOf(id) === i;
    });
    if (postIds.length) {
      var postsRes = await sb
        .from('board_posts')
        .select('id, author_user_id')
        .in('id', postIds);
      if (!postsRes.error && Array.isArray(postsRes.data)) {
        var postAuthorMap = {};
        postsRes.data.forEach(function (p) {
          if (p && p.id) postAuthorMap[String(p.id)] = String(p.author_user_id || '');
        });
        var othersCount = 0;
        var distinctPosts = {};
        commentsRes.data.forEach(function (row) {
          var pid = row && row.post_id ? String(row.post_id) : '';
          var author = postAuthorMap[pid] || '';
          if (author && author !== uid) {
            othersCount += 1;
            distinctPosts[pid] = true;
          }
        });
        stats.validCommentOnOthersPostCount = othersCount;
        stats.distinctPostsWithValidComments = Object.keys(distinctPosts).length;
      } else {
        stats.validCommentOnOthersPostCount = 0;
        stats.distinctPostsWithValidComments = 0;
      }
    } else {
      stats.validCommentOnOthersPostCount = 0;
      stats.distinctPostsWithValidComments = 0;
    }
  } else if (!commentsRes.error) {
    stats.validCommentOnOthersPostCount = 0;
    stats.distinctPostsWithValidComments = 0;
  }

  const activityRes = await sb
    .from('user_activity_events')
    .select('occurred_at')
    .eq('user_id', uid)
    .gte('occurred_at', since);
  if (!activityRes.error && Array.isArray(activityRes.data)) {
    var daySet = {};
    activityRes.data.forEach(function (row) {
      if (!row || !row.occurred_at) return;
      var d = new Date(row.occurred_at);
      if (!isFinite(d.getTime())) return;
      daySet[d.toISOString().slice(0, 10)] = true;
    });
    stats.distinctActiveDaysInWindow = Object.keys(daySet).length;
  }

  const progService = require('./user-progression-service');
  try {
    /* ProfileFrame LEVEL 과 동일 canonical · ensure-on-read */
    const ensured = await progService.ensureAndGetProgressionLevel(uid);
    let reputationScore = 0;
    let citizenRank = null;
    const progRes = await sb
      .from('user_progression')
      .select('reputation_score, citizen_rank')
      .eq('user_id', uid)
      .maybeSingle();
    if (!progRes.error && progRes.data) {
      reputationScore = Number(progRes.data.reputation_score) || 0;
      citizenRank = progRes.data.citizen_rank || null;
    }
    stats.progression = {
      level: ensured.level,
      reputation_score: reputationScore,
      citizen_rank: citizenRank,
    };
  } catch (_) {
    /* table/migration 미적용 시 progression null 유지 → LEVEL_REACHED INSUFFICIENT_DATA */
  }

  const empRes = await sb
    .from('user_progression_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('event_type', 'EMPATHY_RECEIVED');
  if (!empRes.error && typeof empRes.count === 'number') {
    stats.validEmpathyReceivedCount = empRes.count;
  } else if (!empRes.error) {
    stats.validEmpathyReceivedCount = 0;
  }

  return stats;
}

module.exports = {
  loadAchievementStats,
  setStatsClientForTests,
  resetStatsClientForTests,
};
