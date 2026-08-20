'use strict';

const schema = require('../shared/board-schema-core');
const { createBoardDataMapper } = require('./board-data-mapper');

function createBoardSupabaseRepository(options) {
  const opts = options || {};
  const client = opts.client;
  const mapper = opts.mapper || createBoardDataMapper();

  if (!client) {
    const err = new Error('BOARD_SUPABASE_CLIENT_REQUIRED');
    err.code = 'BOARD_SUPABASE_CLIENT_REQUIRED';
    throw err;
  }

  function wrap(error, code) {
    const err = new Error(code || 'BOARD_RPC_FAILED');
    err.code = code || 'BOARD_RPC_FAILED';
    if (error && error.message) err.details = error.message;
    return err;
  }

  async function createPost(input) {
    const { data, error } = await client
      .from('board_posts')
      .insert({
        author_user_id: input.authorUserId,
        territory: input.territory,
        category_key: input.categoryKey,
        board_stage: input.boardStage || 1,
        title: input.title,
        content: input.content,
        is_anonymous: !!input.isAnonymous,
      })
      .select('*')
      .single();
    if (error) throw wrap(error, 'BOARD_POST_CREATE_FAILED');
    return mapper.fromDbPost(data);
  }

  async function getPost(postId) {
    const { data, error } = await client.from('board_posts').select('*').eq('id', postId).maybeSingle();
    if (error) throw wrap(error, 'BOARD_POST_LOAD_FAILED');
    return mapper.fromDbPost(data);
  }

  async function listPosts(filter) {
    let q = client.from('board_posts').select('*').order('created_at', { ascending: false });
    if (filter && filter.territory) q = q.eq('territory', filter.territory);
    if (filter && filter.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw wrap(error, 'BOARD_POST_LIST_FAILED');
    return (data || []).map(mapper.fromDbPost);
  }

  async function updatePost(postId, patch, actorUserId) {
    const updates = { updated_at: new Date().toISOString() };
    if (patch.title != null) updates.title = patch.title;
    if (patch.content != null) updates.content = patch.content;
    if (patch.isAnonymous != null) updates.is_anonymous = !!patch.isAnonymous;
    const { data, error } = await client
      .from('board_posts')
      .update(updates)
      .eq('id', postId)
      .eq('author_user_id', actorUserId)
      .eq('status', 'ACTIVE')
      .select('*')
      .maybeSingle();
    if (error) throw wrap(error, 'BOARD_POST_UPDATE_FAILED');
    return mapper.fromDbPost(data);
  }

  async function softDeletePost(postId, actorUserId) {
    const { data, error } = await client
      .from('board_posts')
      .update({
        status: 'DELETED',
        deleted_at: new Date().toISOString(),
        deleted_by: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', postId)
      .eq('author_user_id', actorUserId)
      .select('*')
      .maybeSingle();
    if (error) throw wrap(error, 'BOARD_POST_DELETE_FAILED');
    return mapper.fromDbPost(data);
  }

  async function createComment(input) {
    const { data, error } = await client
      .from('board_comments')
      .insert({
        post_id: input.postId,
        parent_comment_id: input.parentCommentId || null,
        author_user_id: input.authorUserId,
        territory: input.territory,
        content: input.content,
        is_anonymous: !!input.isAnonymous,
      })
      .select('*')
      .single();
    if (error) throw wrap(error, 'BOARD_COMMENT_CREATE_FAILED');
    const post = await getPost(input.postId);
    if (post) {
      await client
        .from('board_posts')
        .update({ comment_count: (post.commentCount || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', input.postId);
    }
    return mapper.fromDbComment(data);
  }

  async function getComment(commentId) {
    const { data, error } = await client.from('board_comments').select('*').eq('id', commentId).maybeSingle();
    if (error) throw wrap(error, 'BOARD_COMMENT_LOAD_FAILED');
    return mapper.fromDbComment(data);
  }

  async function listComments(postId) {
    const { data, error } = await client
      .from('board_comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw wrap(error, 'BOARD_COMMENT_LIST_FAILED');
    return (data || []).map(mapper.fromDbComment);
  }

  async function updateComment(commentId, patch, actorUserId) {
    const updates = { updated_at: new Date().toISOString() };
    if (patch.content != null) updates.content = patch.content;
    if (patch.isAnonymous != null) updates.is_anonymous = !!patch.isAnonymous;
    const { data, error } = await client
      .from('board_comments')
      .update(updates)
      .eq('id', commentId)
      .eq('author_user_id', actorUserId)
      .eq('status', 'ACTIVE')
      .select('*')
      .maybeSingle();
    if (error) throw wrap(error, 'BOARD_COMMENT_UPDATE_FAILED');
    return mapper.fromDbComment(data);
  }

  async function softDeleteComment(commentId, actorUserId) {
    const { data, error } = await client
      .from('board_comments')
      .update({
        status: 'DELETED',
        deleted_at: new Date().toISOString(),
        deleted_by: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', commentId)
      .eq('author_user_id', actorUserId)
      .select('*')
      .maybeSingle();
    if (error) throw wrap(error, 'BOARD_COMMENT_DELETE_FAILED');
    return mapper.fromDbComment(data);
  }

  async function toggleReaction(input) {
    const { data, error } = await client.rpc('toggle_board_reaction', {
      p_target_type: input.targetType,
      p_target_id: input.targetId,
      p_reaction_type: input.reactionType,
      p_actor_territory: input.actorTerritory,
      p_audience_scope: input.audienceScope,
      p_target_author_territory: input.targetAuthorTerritory,
    });
    if (error) throw wrap(error, 'BOARD_REACTION_TOGGLE_FAILED');
    return data;
  }

  async function listActiveReactionsForActor(actorUserId, targetType, targetId) {
    let q = client
      .from('board_reactions')
      .select('*')
      .eq('actor_user_id', actorUserId)
      .eq('target_type', targetType)
      .is('cancelled_at', null);
    if (targetType === 'POST') q = q.eq('post_id', targetId);
    else q = q.eq('comment_id', targetId);
    const { data, error } = await q;
    if (error) throw wrap(error, 'BOARD_REACTION_LIST_FAILED');
    return data || [];
  }

  async function listReactionsForAlignment(filter) {
    let q = client.from('board_reactions').select('*');
    if (filter && filter.audienceScope) q = q.eq('audience_scope', filter.audienceScope);
    if (filter && filter.targetAuthorUserId) q = q.eq('target_author_user_id', filter.targetAuthorUserId);
    const { data, error } = await q;
    if (error) throw wrap(error, 'BOARD_REACTION_LIST_FAILED');
    return (data || []).map((row) => schema.toAlignmentReactionInput(row));
  }

  async function createReport(input) {
    if (input && input.reporterUserId && input.reporterUserId === input.targetAuthorUserId) {
      throw wrap({ message: 'BOARD_REPORT_SELF_FORBIDDEN' }, 'BOARD_REPORT_SELF_FORBIDDEN');
    }
    const { data, error } = await client
      .from('board_reports')
      .insert({
        reporter_user_id: input.reporterUserId,
        target_type: input.targetType,
        post_id: input.targetType === 'POST' ? input.targetId : null,
        comment_id: input.targetType === 'COMMENT' ? input.targetId : null,
        target_author_user_id: input.targetAuthorUserId,
        reason_code: input.reasonCode,
        reason_detail: input.reasonDetail,
      })
      .select('*')
      .single();
    if (error) {
      if (
        (error && error.code === '23505') ||
        String(error.message || '').includes('uq_board_reports')
      ) {
        throw wrap(error, 'BOARD_REPORT_DUPLICATE');
      }
      throw wrap(error, 'BOARD_REPORT_CREATE_FAILED');
    }
    return mapReportRow(data);
  }

  function mapReportRow(data) {
    if (!data) return null;
    return {
      id: data.id,
      status: data.status,
      createdAt: data.created_at,
      reporterUserId: data.reporter_user_id,
      targetAuthorUserId: data.target_author_user_id,
      targetType: data.target_type,
      postId: data.post_id,
      commentId: data.comment_id,
      reasonCode: data.reason_code,
      reasonDetail: data.reason_detail,
      reviewedAt: data.reviewed_at,
      reviewedBy: data.reviewed_by,
      resolutionNote: data.resolution_note,
    };
  }

  async function getReport(id) {
    const { data, error } = await client.from('board_reports').select('*').eq('id', id).maybeSingle();
    if (error) throw wrap(error, 'BOARD_REPORT_GET_FAILED');
    return mapReportRow(data);
  }

  async function listReports(filter) {
    const f = filter || {};
    let q = client.from('board_reports').select('*');
    if (f.reporterUserId) q = q.eq('reporter_user_id', f.reporterUserId);
    if (f.targetAuthorUserId) q = q.eq('target_author_user_id', f.targetAuthorUserId);
    if (f.reasonCode) q = q.eq('reason_code', f.reasonCode);
    if (f.status) q = q.eq('status', f.status);
    const { data, error } = await q;
    if (error) throw wrap(error, 'BOARD_REPORT_LIST_FAILED');
    return (data || []).map(mapReportRow);
  }

  async function findReporterTargetReport(reporterUserId, targetType, targetId) {
    const type = String(targetType || '').toUpperCase();
    let q = client.from('board_reports').select('*').eq('reporter_user_id', reporterUserId);
    if (type === 'POST') q = q.eq('post_id', targetId);
    else if (type === 'COMMENT') q = q.eq('comment_id', targetId);
    else return null;
    const { data, error } = await q.limit(1);
    if (error) throw wrap(error, 'BOARD_REPORT_LOOKUP_FAILED');
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    return mapReportRow(row);
  }

  async function listReportsByTargetAuthor(userId) {
    return listReports({ targetAuthorUserId: userId });
  }

  async function updateReportReview(id, patch) {
    const src = patch || {};
    const updates = {
      reviewed_at: src.reviewedAt || new Date().toISOString(),
      reviewed_by: src.reviewedBy || null,
    };
    if (src.status) updates.status = src.status;
    if (Object.prototype.hasOwnProperty.call(src, 'resolutionNote')) {
      updates.resolution_note = src.resolutionNote;
    }
    if (src.reviewedBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(src.reviewedBy))) {
      updates.reviewed_by = src.reviewedBy;
    }
    const { data, error } = await client
      .from('board_reports')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw wrap(error, 'BOARD_REPORT_REVIEW_FAILED');
    return mapReportRow(data);
  }

  return {
    createPost,
    getPost,
    listPosts,
    updatePost,
    softDeletePost,
    createComment,
    getComment,
    listComments,
    updateComment,
    softDeleteComment,
    toggleReaction,
    listActiveReactionsForActor,
    listReactionsForAlignment,
    createReport,
    getReport,
    listReports,
    listReportsByTargetAuthor,
    findReporterTargetReport,
    updateReportReview,
  };
}

module.exports = {
  createBoardSupabaseRepository,
};
