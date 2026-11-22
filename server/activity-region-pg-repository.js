'use strict';

/**
 * 로컬 PostgreSQL 게시판 저장.
 * 새 글은 KR 또는 US를 명시한다. 나라가 없으면 넣지 않는다.
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
    const region = src && (src.activityRegion === 'KR' || src.activityRegion === 'US')
      ? src.activityRegion
      : null;
    if (!region) throw fail('COUNTRY_REQUIRED');
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

  let activityRegionColumn = null;
  async function hasActivityRegionColumn() {
    if (activityRegionColumn != null) return activityRegionColumn;
    const res = await query(
      "SELECT 1 FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = 'board_posts' AND column_name = 'activity_region'"
    );
    activityRegionColumn = res.rows.length > 0;
    return activityRegionColumn;
  }

  function likeNeedle(value) {
    return '%' + String(value).replace(/[\\%_]/g, '\\$&') + '%';
  }

  async function postWhere(filter) {
    const f = filter || {};
    const countryOn = f.countryStructure === true;
    const values = [];
    let sql = ' WHERE 1=1';
    if (f.territory) {
      values.push(f.territory);
      sql += ' AND territory = $' + values.length;
    }
    if (f.status) {
      values.push(f.status);
      sql += ' AND status = $' + values.length;
    }
    if (f.authorUserId) {
      values.push(f.authorUserId);
      sql += ' AND author_user_id = $' + values.length;
    }
    if (f.q != null && String(f.q).trim() !== '') {
      values.push(likeNeedle(String(f.q).trim()));
      const n = values.length;
      sql += " AND (title ILIKE $" + n + " ESCAPE '\\' OR content ILIKE $" + n +
        " ESCAPE '\\' OR author_user_id::text ILIKE $" + n + " ESCAPE '\\')";
    }
    if (countryOn) {
      if (!(await hasActivityRegionColumn())) throw fail('COUNTRY_COLUMN_MISSING');
      const region = f.activityRegion === 'KR' || f.activityRegion === 'US' ? f.activityRegion : null;
      if (!region) throw fail('COUNTRY_REQUIRED');
      values.push(region);
      sql += ' AND activity_region = $' + values.length;
    }
    return { sql: sql, values: values };
  }

  async function listPosts(filter) {
    const f = filter || {};
    const where = await postWhere(f);
    const countValues = where.values.slice();
    const count = await query(
      'SELECT count(*)::int AS n FROM public.board_posts' + where.sql,
      countValues
    );
    const values = where.values.slice();
    let sql = 'SELECT * FROM public.board_posts' + where.sql + ' ORDER BY created_at DESC, id DESC';
    const limit = f.limit == null || f.limit === '' ? null : Math.floor(Number(f.limit));
    const offset = f.offset == null || f.offset === '' ? null : Math.floor(Number(f.offset));
    if (limit != null && isFinite(limit) && limit >= 0) {
      values.push(limit);
      sql += ' LIMIT $' + values.length;
      values.push(offset != null && isFinite(offset) && offset >= 0 ? offset : 0);
      sql += ' OFFSET $' + values.length;
    }
    const res = await query(sql, values);
    const rows = res.rows.map(mapPost);
    rows.totalCount = count.rows[0] ? count.rows[0].n : 0;
    return rows;
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

  async function softDeletePost(postId, actorUserId) {
    const before = await getPost(postId);
    if (!before) return null;
    if (before.authorUserId !== actorUserId) throw fail('BOARD_FORBIDDEN');
    const res = await query(
      "UPDATE public.board_posts SET status = 'DELETED', updated_at = now() WHERE id = $1 RETURNING *",
      [postId]
    );
    return mapPost(res.rows[0]);
  }

  async function createComment(src) {
    const region = src && (src.activityRegion === 'KR' || src.activityRegion === 'US')
      ? src.activityRegion
      : null;
    if (!region) throw fail('COUNTRY_REQUIRED');
    const res = await query(
      'INSERT INTO public.board_comments ' +
        '(post_id, parent_comment_id, author_user_id, territory, content, is_anonymous, activity_region) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [
        src.postId,
        src.parentCommentId || null,
        src.authorUserId,
        src.territory,
        src.content,
        !!src.isAnonymous,
        region,
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
    const columns = await query(
      "SELECT column_name FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = 'board_reactions' " +
        "AND column_name IN ('actor_alignment_score_at_reaction', 'activity_region', 'cancelled_at')"
    );
    const names = {};
    columns.rows.forEach(function (row) { names[row.column_name] = true; });
    if (names.cancelled_at) {
      const targetColumn = src.targetType === 'COMMENT' ? 'comment_id' : 'post_id';
      const existing = await query(
        'SELECT id, reaction_type FROM public.board_reactions ' +
          'WHERE actor_user_id = $1 AND target_type = $2 AND ' + targetColumn + ' = $3 ' +
          'AND reaction_group = $4 AND cancelled_at IS NULL',
        [src.actorUserId, src.targetType, src.targetId, group]
      );
      const open = existing.rows[0] || null;
      if (open && open.reaction_type === src.reactionType) {
        await query(
          'UPDATE public.board_reactions SET cancelled_at = now() WHERE id = $1',
          [open.id]
        );
        return { success: true, action: 'CANCELLED', reactionType: src.reactionType, activityRegion: src.activityRegion || null };
      }
    }
    let sql =
      'INSERT INTO public.board_reactions (' +
        'actor_user_id, target_type, post_id, comment_id, target_author_user_id, reaction_type, reaction_group, ' +
        'audience_scope, actor_territory_at_reaction, target_author_territory_at_reaction';
    const params = [
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
    ];
    if (names.actor_alignment_score_at_reaction) {
      sql += ', actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction';
      params.push(src.actorAlignmentScore == null ? null : src.actorAlignmentScore);
      params.push(src.targetAuthorAlignmentScore == null ? null : src.targetAuthorAlignmentScore);
    }
    if (names.activity_region) {
      sql += ', activity_region';
      params.push(src.activityRegion === 'KR' || src.activityRegion === 'US' ? src.activityRegion : null);
    }
    sql += ') VALUES (' + params.map(function (_, i) { return '$' + (i + 1); }).join(', ') + ') RETURNING *';
    const res = await query(sql, params);
    return {
      success: true,
      action: 'CREATED',
      reactionType: src.reactionType,
      activityRegion: res.rows[0].activity_region,
    };
  }

  async function columnExists(table, column) {
    const res = await query(
      'SELECT 1 FROM information_schema.columns ' +
        'WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
      ['public', table, column]
    );
    return res.rows.length > 0;
  }

  async function tableExists(table) {
    const res = await query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      ['public', table]
    );
    return res.rows.length > 0;
  }

  async function countryBind(filter, table) {
    const countryOn = !!(filter && filter.countryStructure === true);
    if (!countryOn) return { sql: '', values: [] };
    if (!(await columnExists(table, 'activity_region'))) throw fail('COUNTRY_COLUMN_MISSING');
    const region = filter.activityRegion === 'KR' || filter.activityRegion === 'US' ? filter.activityRegion : null;
    if (!region) throw fail('COUNTRY_REQUIRED');
    return { sql: ' AND activity_region = $REGION', region: region };
  }

  function applyRegion(fragment, values) {
    if (!fragment || !fragment.sql) return '';
    values.push(fragment.region);
    return fragment.sql.replace('$REGION', '$' + values.length);
  }

  async function listPopularCandidates(filter) {
    const f = filter || {};
    const countryOn = f.countryStructure === true;
    if (countryOn && !(await hasActivityRegionColumn())) throw fail('COUNTRY_COLUMN_MISSING');
    const region = f.activityRegion === 'KR' || f.activityRegion === 'US' ? f.activityRegion : null;
    if (countryOn && !region) throw fail('COUNTRY_REQUIRED');
    const values = [];
    let sql = 'SELECT * FROM public.board_posts WHERE 1=1';
    if (f.status) {
      values.push(f.status);
      sql += ' AND status = $' + values.length;
    }
    if (f.territory) {
      values.push(f.territory);
      sql += ' AND territory = $' + values.length;
    }
    if (f.boardStage != null && f.boardStage !== '') {
      values.push(Math.floor(Number(f.boardStage)));
      sql += ' AND board_stage = $' + values.length;
    }
    if (countryOn) {
      values.push(region);
      sql += ' AND activity_region = $' + values.length;
    }
    sql += ' ORDER BY created_at DESC, id DESC';
    const res = await query(sql, values);
    const rows = res.rows.map(mapPost);
    rows.totalCount = rows.length;
    return rows;
  }

  async function listActivePostReactionsSince(fromIso, toIso, filter) {
    const regionSql = await countryBind(filter, 'board_reactions');
    const hasRegion = await columnExists('board_reactions', 'activity_region');
    const values = [fromIso, toIso];
    const res = await query(
      'SELECT post_id, reaction_type, target_type, created_at, cancelled_at' +
        (hasRegion ? ', activity_region' : '') +
        " FROM public.board_reactions " +
        "WHERE target_type = 'POST' AND cancelled_at IS NULL AND created_at >= $1 AND created_at <= $2" +
        applyRegion(regionSql, values),
      values
    );
    return res.rows.map(function (row) {
      return {
        postId: row.post_id,
        reactionType: row.reaction_type,
        targetType: row.target_type,
        createdAt: row.created_at,
        cancelledAt: row.cancelled_at,
        activityRegion: row.activity_region == null || row.activity_region === '' ? null : row.activity_region,
      };
    });
  }

  async function listActiveCommentsSince(fromIso, toIso, filter) {
    const regionSql = await countryBind(filter, 'board_comments');
    const hasRegion = await columnExists('board_comments', 'activity_region');
    const values = [fromIso, toIso];
    const res = await query(
      'SELECT post_id, author_user_id, status, created_at' +
        (hasRegion ? ', activity_region' : '') +
        " FROM public.board_comments " +
        "WHERE status = 'ACTIVE' AND created_at >= $1 AND created_at <= $2" +
        applyRegion(regionSql, values),
      values
    );
    return res.rows.map(function (row) {
      return {
        postId: row.post_id,
        authorUserId: row.author_user_id,
        status: row.status,
        createdAt: row.created_at,
        activityRegion: row.activity_region == null || row.activity_region === '' ? null : row.activity_region,
      };
    });
  }

  async function listPostEmpathyEventsSince(fromIso, toIso, filter) {
    if (!(await tableExists('user_progression_events'))) return [];
    const countryOn = !!(filter && filter.countryStructure === true);
    const hasRegion = await columnExists('user_progression_events', 'activity_region');
    if (countryOn && !hasRegion) throw fail('COUNTRY_COLUMN_MISSING');
    const values = [fromIso, toIso];
    let sql =
      "SELECT source_id, source_type, occurred_at, activity_region FROM public.user_progression_events " +
      "WHERE event_type = 'EMPATHY_RECEIVED' AND source_type = 'board_post' " +
      'AND occurred_at >= $1 AND occurred_at <= $2';
    if (!hasRegion) {
      sql =
        "SELECT source_id, source_type, occurred_at FROM public.user_progression_events " +
        "WHERE event_type = 'EMPATHY_RECEIVED' AND source_type = 'board_post' " +
        'AND occurred_at >= $1 AND occurred_at <= $2';
    }
    if (countryOn) {
      if (filter.activityRegion !== 'KR' && filter.activityRegion !== 'US') throw fail('COUNTRY_REQUIRED');
      values.push(filter.activityRegion);
      sql += ' AND activity_region = $' + values.length;
    }
    const res = await query(sql, values);
    return res.rows.map(function (row) {
      return {
        sourceId: row.source_id,
        sourceType: row.source_type || 'board_post',
        occurredAt: row.occurred_at,
        activityRegion: row.activity_region == null || row.activity_region === '' ? null : row.activity_region,
      };
    });
  }

  return {
    supportsActivityRegion: true,
    filtersCountryInSql: true,
    createPost: createPost,
    getPost: getPost,
    listPosts: listPosts,
    updatePost: updatePost,
    softDeletePost: softDeletePost,
    createComment: createComment,
    getComment: getComment,
    listComments: listComments,
    toggleReaction: toggleReaction,
    listPopularCandidates: listPopularCandidates,
    listActivePostReactionsSince: listActivePostReactionsSince,
    listActiveCommentsSince: listActiveCommentsSince,
    listPostEmpathyEventsSince: listPostEmpathyEventsSince,
    _debug: { pg: true },
  };
}

module.exports = {
  createActivityRegionPgRepository: createActivityRegionPgRepository,
};
