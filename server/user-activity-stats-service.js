'use strict';

/**
 * ProfileFrame 활동 수치 — 서버 canonical COUNT.
 * 클라이언트 count 수신/신뢰 금지. 신규 집계 테이블 없음.
 *
 * posts      = board_posts ACTIVE · author_user_id
 * comments   = board_comments ACTIVE · author_user_id
 * receivedLikes = user_progression_events EMPATHY_RECEIVED (게시글 받은 공감)
 *                 fame(reputation_score) 과 별도 COUNT. 숫자 복사 금지.
 * discussions = 본인 ACTIVE 글 id ∪ 본인 ACTIVE 댓글의 post_id (서로 다른 postId)
 *
 * aura / followers 는 이 서비스가 반환하지 않음 (미구현 · 미연결).
 */

const persist = require('./achievement-persist-service');

let _injected = null;

function setStatsClientForTests(client) {
  _injected = client || null;
}

function resetStatsClientForTests() {
  _injected = null;
}

function getClient() {
  if (_injected) return _injected;
  return persist.getAdminClient();
}

function emptyStats() {
  return {
    posts: 0,
    comments: 0,
    receivedLikes: 0,
    discussions: 0,
    source: 'server_canonical',
  };
}

function nonNegInt(value) {
  const n = Number(value);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function rowsOrThrow(res, code) {
  if (res && res.error) {
    const err = new Error(code || 'ACTIVITY_STATS_QUERY_FAILED');
    err.code = code || 'ACTIVITY_STATS_QUERY_FAILED';
    err.detail = res.error.message || res.error;
    err.status = 500;
    throw err;
  }
  return Array.isArray(res && res.data) ? res.data : [];
}

async function loadActivityStats(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return emptyStats();

  const sb = getClient();

  const postsRes = await sb
    .from('board_posts')
    .select('id')
    .eq('author_user_id', uid)
    .eq('status', 'ACTIVE');
  const postRows = rowsOrThrow(postsRes, 'ACTIVITY_POSTS_QUERY_FAILED');

  const commentsRes = await sb
    .from('board_comments')
    .select('id, post_id')
    .eq('author_user_id', uid)
    .eq('status', 'ACTIVE');
  const commentRows = rowsOrThrow(commentsRes, 'ACTIVITY_COMMENTS_QUERY_FAILED');

  const empRes = await sb
    .from('user_progression_events')
    .select('id')
    .eq('user_id', uid)
    .eq('event_type', 'EMPATHY_RECEIVED');
  const empRows = rowsOrThrow(empRes, 'ACTIVITY_EMPATHY_QUERY_FAILED');

  const discussionIds = {};
  postRows.forEach(function (row) {
    const id = row && row.id != null ? String(row.id).trim() : '';
    if (id) discussionIds[id] = true;
  });
  commentRows.forEach(function (row) {
    const id = row && row.post_id != null ? String(row.post_id).trim() : '';
    if (id) discussionIds[id] = true;
  });

  return {
    posts: nonNegInt(postRows.length),
    comments: nonNegInt(commentRows.length),
    receivedLikes: nonNegInt(empRows.length),
    discussions: nonNegInt(Object.keys(discussionIds).length),
    source: 'server_canonical',
  };
}

module.exports = {
  loadActivityStats,
  setStatsClientForTests,
  resetStatsClientForTests,
};
