'use strict';

/**
 * Live board_posts read for alien observation (CENTRAL all stages; PIONEER/GUARDIAN board_stage=1 only).
 * Write paths stay disabled — observation is read-only.
 */

function createAlienObservationSupabaseRepository(options) {
  const opts = options || {};
  const client = opts.client;
  if (!client) {
    const err = new Error('ALIEN_OBSERVATION_CLIENT_REQUIRED');
    err.code = 'ALIEN_OBSERVATION_CLIENT_REQUIRED';
    throw err;
  }

  function mapPost(row) {
    if (!row) return null;
    return {
      id: row.id,
      territory: row.territory,
      boardStage: row.board_stage != null ? Number(row.board_stage) : 1,
      categoryKey: row.category_key || null,
      title: row.title,
      content: row.content,
      status: row.status,
      isAnonymous: !!row.is_anonymous,
      authorUserId: row.author_user_id || null,
      createdAt: row.created_at || null,
      earthReactions: {
        like: Number(row.earth_like_count) || 0,
        recommend: Number(row.earth_recommend_count) || 0,
        dislike: Number(row.earth_dislike_count) || 0,
        downvote: Number(row.earth_downvote_count) || 0,
        exposedToEarthUi: true,
      },
      alienReactions: {
        like: Number(row.alien_like_count) || 0,
        recommend: Number(row.alien_recommend_count) || 0,
        dislike: Number(row.alien_dislike_count) || 0,
        downvote: Number(row.alien_downvote_count) || 0,
        exposedToEarthUi: false,
      },
    };
  }

  function mapComment(row) {
    if (!row) return null;
    return {
      id: row.id,
      postId: row.post_id,
      content: row.content,
      status: row.status,
      isAnonymous: !!row.is_anonymous,
      authorUserId: row.author_user_id || null,
      audienceScope: row.audience_scope || 'EARTH',
      createdAt: row.created_at || null,
    };
  }

  async function getSourcePost(postId) {
    const { data, error } = await client
      .from('board_posts')
      .select('*')
      .eq('id', postId)
      .maybeSingle();
    if (error) {
      const err = new Error(error.message || 'OBS_POST_LOAD_FAILED');
      err.code = 'OBS_POST_LOAD_FAILED';
      throw err;
    }
    return mapPost(data);
  }

  async function listEarthComments(postId) {
    const { data, error } = await client
      .from('board_comments')
      .select('*')
      .eq('post_id', postId)
      .eq('audience_scope', 'EARTH')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) return [];
    return (data || []).map(mapComment);
  }

  async function listAlienComments(postId) {
    const { data, error } = await client
      .from('board_comments')
      .select('*')
      .eq('post_id', postId)
      .eq('audience_scope', 'ALIEN')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) return [];
    return (data || []).map(mapComment);
  }

  async function listObservedPosts(filter) {
    const src = filter || {};
    const territory = String(src.territory || '').toUpperCase();
    let q = client
      .from('board_posts')
      .select('id, territory, board_stage, category_key, title, content, status, is_anonymous, author_user_id, created_at, earth_like_count, earth_recommend_count, earth_dislike_count, earth_downvote_count')
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Number(src.limit) || 30, 1), 50));
    if (territory) q = q.eq('territory', territory);
    if (src.boardStage != null) q = q.eq('board_stage', Number(src.boardStage));
    const { data, error } = await q;
    if (error) {
      return { items: [], note: error.message || 'OBS_LIST_FAILED', dataStatus: 'UNAVAILABLE' };
    }
    return {
      items: (data || []).map(function (row) {
        return {
          id: row.id,
          territory: row.territory,
          boardStage: row.board_stage != null ? Number(row.board_stage) : 1,
          title: row.title,
          status: row.status,
          isAnonymous: !!row.is_anonymous,
          authorUserId: row.is_anonymous ? null : row.author_user_id,
          createdAt: row.created_at,
        };
      }),
      note: null,
      dataStatus: 'READY',
    };
  }

  async function listTerritoryObservationCandidates(territory) {
    const t = String(territory || '').toUpperCase();
    if (t === 'PIONEER' || t === 'GUARDIAN') {
      return listObservedPosts({ territory: t, boardStage: 1 });
    }
    if (t === 'CENTRAL') {
      return listObservedPosts({ territory: 'CENTRAL' });
    }
    return { items: [], note: 'TERRITORY_NOT_OBSERVABLE', dataStatus: 'FORBIDDEN' };
  }

  async function createAlienComment() {
    return { ok: false, error: 'OBSERVATION_READ_ONLY' };
  }

  async function listFreePlazaPosts() {
    return [];
  }

  async function createFreePlazaPost() {
    return { ok: false, error: 'ALIEN_FREE_PLAZA_WRITE_DISABLED' };
  }

  async function healthCheck() {
    return { ok: true, backend: 'supabase', persistEnabled: false, readOnly: true };
  }

  return {
    getSourcePost,
    listEarthComments,
    listAlienComments,
    createAlienComment,
    listTerritoryObservationCandidates,
    listObservedPosts,
    listFreePlazaPosts,
    createFreePlazaPost,
    healthCheck,
  };
}

module.exports = {
  createAlienObservationSupabaseRepository,
};
