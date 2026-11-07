'use strict';

/**
 * 로컬 PostgreSQL 게시판 저장.
 * 한국 글은 activity_region을 비워 KR로 읽고, 미국 글만 US를 명시한다.
 * 댓글·반응의 국가는 클라이언트가 아니라 원글 트리거가 맞춘다.
 */

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function mapPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    territory: row.territory,
    categoryKey: row.category_key,
    boardStage: row.board_stage,
    title: row.title,
    content: row.content,
    isAnonymous: row.is_anonymous,
    status: row.status,
    deletedAt: row.deleted_at,
    isOfficial: row.is_official === true,
    commentCount: row.comment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activityRegion: row.activity_region == null || row.activity_region === '' ? null : row.activity_region,
  };
}

function mapComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id,
    authorUserId: row.author_user_id,
    territory: row.territory,
    content: row.content,
    isAnonymous: row.is_anonymous,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activityRegion: row.activity_region == null || row.activity_region === '' ? null : row.activity_region,
  };
}

function createActivityRegionPgRepository(options) {
  const query = options && options.query;
  if (typeof query !== 'function') throw fail('REGION_PG_QUERY_REQUIRED');

  async function createPost(src) {
    const region = src && src.activityRegion === 'US' ? 'US' : null;
    const res = await query(
      'INSERT INTO public.board_posts ' +
        '(author_user_id, territory, category_key, board_stage, title, content, is_anonymous, activity_region) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [
        src.authorUserId,
        src.territory,
        src.categoryKey || null,
        src.boardStage || 1,
        src.title,
        src.content,
        !!src.isAnonymous,
        region,
      ]
    );
    return mapPost(res.rows[0]);
  }

  async function getPost(postId) {
    const res = await query('SELECT * FROM public.board_posts WHERE id = $1', [postId]);
    return mapPost(res.rows[0]);
  }

  async function listPosts(filter) {
    const f = filter || {};
    const values = [];
    let sql = 'SELECT * FROM public.board_posts WHERE 1=1';
    if (f.territory) {
      values.push(f.territory);
      sql += ' AND territory = $' + values.length;
    }
    if (f.status) {
      values.push(f.status);
      sql += ' AND status = $' + values.length;
    }
    sql += ' ORDER BY created_at DESC';
    const res = await query(sql, values);
    return res.rows.map(mapPost);
  }

  async function updatePost(postId, patch, actorUserId) {
    const before = await getPost(postId);
    if (!before) return null;
    if (before.authorUserId !== actorUserId) throw fail('BOARD_FORBIDDEN');
    const res = await query(
      'UPDATE public.board_posts SET title = COALESCE($2, title), content = COALESCE($3, content), updated_at = now() ' +
        'WHERE id = $1 RETURNING *',
      [postId, patch && patch.title != null ? patch.title : null, patch && patch.content != null ? patch.content : null]
    );
    return mapPost(res.rows[0]);
  }

  async function createComment(src) {
    const res = await query(
      'INSERT INTO public.board_comments ' +
        '(post_id, parent_comment_id, author_user_id, territory, content, is_anonymous) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [
        src.postId,
        src.parentCommentId || null,
        src.authorUserId,
        src.territory,
        src.content,
        !!src.isAnonymous,
      ]
    );
    return mapComment(res.rows[0]);
  }

  async function getComment(commentId) {
    const res = await query('SELECT * FROM public.board_comments WHERE id = $1', [commentId]);
    return mapComment(res.rows[0]);
  }

  async function listComments(postId) {
    const res = await query(
      "SELECT * FROM public.board_comments WHERE post_id = $1 AND status = 'ACTIVE' ORDER BY created_at",
      [postId]
    );
    return res.rows.map(mapComment);
  }

  async function toggleReaction(src) {
    const group = src.reactionType === 'DISLIKE' || src.reactionType === 'DOWNVOTE' ? 'NEGATIVE' : 'POSITIVE';
    let targetAuthor = null;
    if (src.targetType === 'POST') {
      const post = await getPost(src.targetId);
      if (!post) throw fail('BOARD_POST_NOT_FOUND');
      targetAuthor = post.authorUserId;
    } else {
      const comment = await getComment(src.targetId);
      if (!comment) throw fail('BOARD_COMMENT_NOT_FOUND');
      targetAuthor = comment.authorUserId;
    }
    const res = await query(
      'INSERT INTO public.board_reactions (' +
        'actor_user_id, target_type, post_id, comment_id, target_author_user_id, reaction_type, reaction_group, ' +
        'audience_scope, actor_territory_at_reaction, target_author_territory_at_reaction) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [
        src.actorUserId,
        src.targetType,
        src.targetType === 'POST' ? src.targetId : null,
        src.targetType === 'COMMENT' ? src.targetId : null,
        targetAuthor,
        src.reactionType,
        group,
        src.audienceScope || 'EARTH',
        src.actorTerritory,
        src.targetAuthorTerritory || src.actorTerritory,
      ]
    );
    return {
      success: true,
      action: 'CREATED',
      reactionType: src.reactionType,
      activityRegion: res.rows[0].activity_region,
    };
  }

  async function listActivePostReactionsSince(fromIso, toIso) {
    const res = await query(
      "SELECT post_id, reaction_type, target_type, created_at, cancelled_at FROM public.board_reactions " +
        "WHERE target_type = 'POST' AND cancelled_at IS NULL AND created_at >= $1 AND created_at <= $2",
      [fromIso, toIso]
    );
    return res.rows.map(function (row) {
      return {
        postId: row.post_id,
        reactionType: row.reaction_type,
        targetType: row.target_type,
        createdAt: row.created_at,
        cancelledAt: row.cancelled_at,
      };
    });
  }

  async function listActiveCommentsSince(fromIso, toIso) {
    const res = await query(
      "SELECT post_id, author_user_id, status, created_at FROM public.board_comments " +
        "WHERE status = 'ACTIVE' AND created_at >= $1 AND created_at <= $2",
      [fromIso, toIso]
    );
    return res.rows.map(function (row) {
      return {
        postId: row.post_id,
        authorUserId: row.author_user_id,
        status: row.status,
        createdAt: row.created_at,
      };
    });
  }

  async function listPostEmpathyEventsSince() {
    return [];
  }

  return {
    supportsActivityRegion: true,
    createPost: createPost,
    getPost: getPost,
    listPosts: listPosts,
    updatePost: updatePost,
    createComment: createComment,
    getComment: getComment,
    listComments: listComments,
    toggleReaction: toggleReaction,
    listActivePostReactionsSince: listActivePostReactionsSince,
    listActiveCommentsSince: listActiveCommentsSince,
    listPostEmpathyEventsSince: listPostEmpathyEventsSince,
    _debug: { pg: true },
  };
}

module.exports = {
  createActivityRegionPgRepository: createActivityRegionPgRepository,
};
