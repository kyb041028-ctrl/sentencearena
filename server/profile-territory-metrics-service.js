'use strict';

/**
 * 프로필 영토 기록.
 * Move Count는 확정된 alignment_territory_history 행만. US 소속 변경 원장은 없다.
 * Civic Influence는 게시글 공감, 댓글 공감, 팔로워가 모두 있을 때만 계산한다.
 * 팔로워 원장은 연결되어 있지 않으므로 0으로 채우지 않는다.
 * Citizen Rank는 CITIZEN_RANK_POLICY_NOT_FINALIZED 그대로다.
 */

const { civicInfluence } = require('../shared/civic-influence-core');
const { evaluateCitizenRank } = require('../shared/citizen-rank-evaluation-core');

function unavailable(reason) {
  return { available: false, value: null, reason: reason || 'UNAVAILABLE' };
}

function rankPayload() {
  const evaluated = evaluateCitizenRank({});
  return {
    available: false,
    text: '',
    reason: (evaluated && evaluated.reason) || 'CITIZEN_RANK_POLICY_NOT_FINALIZED',
  };
}

async function countRows(query) {
  const res = await query;
  if (!res || res.error) {
    return unavailable((res && res.error && (res.error.code || res.error.message)) || 'QUERY_FAILED');
  }
  const n = res.count != null ? res.count : Array.isArray(res.data) ? res.data.length : null;
  if (typeof n !== 'number' || !isFinite(n)) return unavailable('COUNT_MISSING');
  return { available: true, value: Math.max(0, Math.floor(n)) };
}

async function loadKrMoveCount(sb, userId) {
  if (!sb || typeof sb.from !== 'function') return unavailable('MOVE_LEDGER_UNAVAILABLE');
  try {
    return await countRows(
      sb
        .from('alignment_territory_history')
        .select('history_id', { count: 'exact', head: true })
        .eq('user_id', userId)
    );
  } catch (err) {
    return unavailable(err && err.code ? err.code : 'MOVE_LEDGER_UNAVAILABLE');
  }
}

async function loadEmpathyCount(sb, userId, sourceType) {
  if (!sb || typeof sb.from !== 'function') return unavailable('EMPATHY_UNAVAILABLE');
  try {
    return await countRows(
      sb
        .from('user_progression_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('event_type', 'EMPATHY_RECEIVED')
        .eq('source_type', sourceType)
    );
  } catch (err) {
    return unavailable(err && err.code ? err.code : 'EMPATHY_UNAVAILABLE');
  }
}

async function loadCivicInfluence(sb, userId, region) {
  const followers = unavailable('FOLLOW_NOT_CONNECTED');
  if (region === 'US') {
    return civicInfluence({
      postLikes: unavailable('US_POST_LIKE_SOURCE_NOT_SPLIT'),
      commentLikes: unavailable('US_COMMENT_LIKE_HISTORY_UNSUPPORTED'),
      followers: followers,
    });
  }
  const postLikes = await loadEmpathyCount(sb, userId, 'board_post');
  const commentLikes = await loadEmpathyCount(sb, userId, 'board_comment');
  return civicInfluence({
    postLikes: postLikes,
    commentLikes: commentLikes,
    followers: followers,
  });
}

async function loadTerritoryMetrics(userId, region, sb) {
  const activityRegion = region === 'US' ? 'US' : 'KR';
  const move =
    activityRegion === 'US'
      ? unavailable('NO_US_MEMBERSHIP_CHANGE_LEDGER')
      : await loadKrMoveCount(sb, userId);
  const civic = await loadCivicInfluence(sb, userId, activityRegion);
  return {
    region: activityRegion,
    move: move,
    civic: civic,
    rank: rankPayload(),
  };
}

module.exports = {
  loadTerritoryMetrics: loadTerritoryMetrics,
};
