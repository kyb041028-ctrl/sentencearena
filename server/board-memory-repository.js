'use strict';

const crypto = require('crypto');
const boardConfig = require('../shared/board-config-core');
const schema = require('../shared/board-schema-core');

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function createBoardMemoryRepository(options) {
  const opts = options || {};
  const posts = new Map();
  const comments = new Map();
  const reactions = new Map();
  const reports = new Map();

  function clone(v) {
    return schema.clone(v);
  }

  function bumpCount(target, scope, group, delta) {
    const posKey = scope === 'EARTH' ? 'earthPositiveCount' : 'alienPositiveCount';
    const negKey = scope === 'EARTH' ? 'earthNegativeCount' : 'alienNegativeCount';
    const key = group === 'POSITIVE' ? posKey : negKey;
    target[key] = Math.max(0, (target[key] || 0) + delta);
  }

  function assertOperationalTerritory(value) {
    return boardConfig.assertOperationalBoardTerritory(value);
  }

  async function createPost(input) {
    const src = input || {};
    const id = src.id || uuid();
    const row = {
      id,
      authorUserId: src.authorUserId,
      territory: assertOperationalTerritory(src.territory),
      categoryKey: src.categoryKey == null ? null : src.categoryKey,
      boardStage: src.boardStage == null ? 1 : src.boardStage,
      title: String(src.title).trim(),
      content: String(src.content).trim(),
      isAnonymous: !!src.isAnonymous,
      status: schema.STATUS.ACTIVE,
      deletedAt: null,
      deletedBy: null,
      blindReason: null,
      commentCount: 0,
      earthPositiveCount: 0,
      earthNegativeCount: 0,
      alienPositiveCount: 0,
      alienNegativeCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    posts.set(id, row);
    return clone(row);
  }

  async function getPost(postId) {
    const row = posts.get(postId);
    return row ? clone(row) : null;
  }

  async function listPosts(filter) {
    const f = filter || {};
    let rows = Array.from(posts.values());
    if (f.territory) rows = rows.filter((p) => p.territory === f.territory);
    if (f.status) rows = rows.filter((p) => p.status === f.status);
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return rows.map(clone);
  }

  async function updatePost(postId, patch, actorUserId) {
    const row = posts.get(postId);
    if (!row) return null;
    if (row.authorUserId !== actorUserId) {
      const err = new Error('BOARD_FORBIDDEN');
      err.code = 'BOARD_FORBIDDEN';
      throw err;
    }
    if (row.status !== schema.STATUS.ACTIVE) {
      const err = new Error('BOARD_TARGET_NOT_ACTIVE');
      err.code = 'BOARD_TARGET_NOT_ACTIVE';
      throw err;
    }
    if (patch.title != null) row.title = String(patch.title).trim();
    if (patch.content != null) row.content = String(patch.content).trim();
    if (patch.isAnonymous != null) row.isAnonymous = !!patch.isAnonymous;
    row.updatedAt = nowIso();
    return clone(row);
  }

  async function softDeletePost(postId, actorUserId) {
    const row = posts.get(postId);
    if (!row) return null;
    if (row.authorUserId !== actorUserId) {
      const err = new Error('BOARD_FORBIDDEN');
      err.code = 'BOARD_FORBIDDEN';
      throw err;
    }
    row.status = schema.STATUS.DELETED;
    row.deletedAt = nowIso();
    row.deletedBy = actorUserId;
    row.updatedAt = nowIso();
    return clone(row);
  }

  async function createComment(input) {
    const src = input || {};
    const post = posts.get(src.postId);
    if (!post) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (post.status !== schema.STATUS.ACTIVE) {
      const err = new Error('BOARD_TARGET_NOT_ACTIVE');
      err.code = 'BOARD_TARGET_NOT_ACTIVE';
      throw err;
    }
    if (src.parentCommentId) {
      const parent = comments.get(src.parentCommentId);
      if (!parent) {
        const err = new Error('BOARD_PARENT_COMMENT_NOT_FOUND');
        err.code = 'BOARD_PARENT_COMMENT_NOT_FOUND';
        throw err;
      }
      if (parent.postId !== src.postId) {
        const err = new Error('BOARD_PARENT_POST_MISMATCH');
        err.code = 'BOARD_PARENT_POST_MISMATCH';
        throw err;
      }
      if (parent.parentCommentId) {
        const err = new Error('BOARD_COMMENT_DEPTH_EXCEEDED');
        err.code = 'BOARD_COMMENT_DEPTH_EXCEEDED';
        throw err;
      }
    }
    const id = src.id || uuid();
    const audienceScope = src.audienceScope === schema.AUDIENCE_SCOPE.ALIEN
      ? schema.AUDIENCE_SCOPE.ALIEN
      : schema.AUDIENCE_SCOPE.EARTH;
    const row = {
      id,
      postId: src.postId,
      parentCommentId: src.parentCommentId || null,
      authorUserId: src.authorUserId,
      territory: assertOperationalTerritory(src.territory),
      audienceScope,
      content: String(src.content).trim(),
      isAnonymous: !!src.isAnonymous,
      status: schema.STATUS.ACTIVE,
      deletedAt: null,
      deletedBy: null,
      blindReason: null,
      earthPositiveCount: 0,
      earthNegativeCount: 0,
      alienPositiveCount: 0,
      alienNegativeCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    comments.set(id, row);
    // 외계 댓글은 지구 commentCount에 포함하지 않음
    if (audienceScope === schema.AUDIENCE_SCOPE.EARTH) {
      post.commentCount += 1;
    }
    post.updatedAt = nowIso();
    return clone(row);
  }

  async function getComment(commentId) {
    const row = comments.get(commentId);
    return row ? clone(row) : null;
  }

  async function listComments(postId, options) {
    const opts = options || {};
    const scope = opts.audienceScope;
    return Array.from(comments.values())
      .filter((c) => {
        if (c.postId !== postId) return false;
        if (!scope || scope === 'ALL') return true;
        const rowScope = c.audienceScope || schema.AUDIENCE_SCOPE.EARTH;
        return rowScope === scope;
      })
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(clone);
  }

  async function updateComment(commentId, patch, actorUserId) {
    const row = comments.get(commentId);
    if (!row) return null;
    if (row.authorUserId !== actorUserId) {
      const err = new Error('BOARD_FORBIDDEN');
      err.code = 'BOARD_FORBIDDEN';
      throw err;
    }
    if (row.status !== schema.STATUS.ACTIVE) {
      const err = new Error('BOARD_TARGET_NOT_ACTIVE');
      err.code = 'BOARD_TARGET_NOT_ACTIVE';
      throw err;
    }
    if (patch.content != null) row.content = String(patch.content).trim();
    if (patch.isAnonymous != null) row.isAnonymous = !!patch.isAnonymous;
    row.updatedAt = nowIso();
    return clone(row);
  }

  async function softDeleteComment(commentId, actorUserId) {
    const row = comments.get(commentId);
    if (!row) return null;
    if (row.authorUserId !== actorUserId) {
      const err = new Error('BOARD_FORBIDDEN');
      err.code = 'BOARD_FORBIDDEN';
      throw err;
    }
    row.status = schema.STATUS.DELETED;
    row.deletedAt = nowIso();
    row.deletedBy = actorUserId;
    row.updatedAt = nowIso();
    return clone(row);
  }

  async function toggleReaction(input) {
    const src = input || {};
    const group = schema.reactionGroupOf(src.reactionType);
    if (!group) {
      const err = new Error('BOARD_REACTION_TYPE_INVALID');
      err.code = 'BOARD_REACTION_TYPE_INVALID';
      throw err;
    }

    let target;
    let targetAuthorUserId;
    if (src.targetType === schema.TARGET_TYPE.POST) {
      target = posts.get(src.targetId);
      if (!target) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = target.authorUserId;
    } else {
      target = comments.get(src.targetId);
      if (!target) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = target.authorUserId;
    }
    if (target.status !== schema.STATUS.ACTIVE) {
      const err = new Error('BOARD_TARGET_NOT_ACTIVE');
      err.code = 'BOARD_TARGET_NOT_ACTIVE';
      throw err;
    }

    const existing = Array.from(reactions.values()).find(
      (r) =>
        r.actorUserId === src.actorUserId &&
        r.targetType === src.targetType &&
        ((src.targetType === 'POST' && r.postId === src.targetId) ||
          (src.targetType === 'COMMENT' && r.commentId === src.targetId)) &&
        r.reactionGroup === group &&
        r.cancelledAt == null
    );

    let action;
    let active = false;

    if (existing) {
      if (existing.reactionType === src.reactionType) {
        existing.cancelledAt = nowIso();
        existing.updatedAt = nowIso();
        bumpCount(target, existing.audienceScope, group, -1);
        action = 'CANCELLED';
        active = false;
      } else {
        existing.cancelledAt = nowIso();
        existing.updatedAt = nowIso();
        const id = uuid();
        reactions.set(id, {
          id,
          actorUserId: src.actorUserId,
          targetType: src.targetType,
          postId: src.targetType === 'POST' ? src.targetId : null,
          commentId: src.targetType === 'COMMENT' ? src.targetId : null,
          targetAuthorUserId,
          reactionType: src.reactionType,
          reactionGroup: group,
          audienceScope: src.audienceScope,
          actorTerritoryAtReaction: src.actorTerritory,
          targetAuthorTerritoryAtReaction: src.targetAuthorTerritory,
          actorAlignmentScoreAtReaction:
            src.actorAlignmentScore == null ? 0 : Number(src.actorAlignmentScore) || 0,
          targetAuthorAlignmentScoreAtReaction:
            src.targetAuthorAlignmentScore == null ? 0 : Number(src.targetAuthorAlignmentScore) || 0,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          cancelledAt: null,
        });
        action = 'REPLACED';
        active = true;
      }
    } else {
      const id = uuid();
      reactions.set(id, {
        id,
        actorUserId: src.actorUserId,
        targetType: src.targetType,
        postId: src.targetType === 'POST' ? src.targetId : null,
        commentId: src.targetType === 'COMMENT' ? src.targetId : null,
        targetAuthorUserId,
        reactionType: src.reactionType,
        reactionGroup: group,
        audienceScope: src.audienceScope,
        actorTerritoryAtReaction: src.actorTerritory,
        targetAuthorTerritoryAtReaction: src.targetAuthorTerritory,
        actorAlignmentScoreAtReaction:
          src.actorAlignmentScore == null ? 0 : Number(src.actorAlignmentScore) || 0,
        targetAuthorAlignmentScoreAtReaction:
          src.targetAuthorAlignmentScore == null ? 0 : Number(src.targetAuthorAlignmentScore) || 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        cancelledAt: null,
      });
      bumpCount(target, src.audienceScope, group, 1);
      action = 'CREATED';
      active = true;
    }

    target.updatedAt = nowIso();
    return {
      success: true,
      action,
      targetType: src.targetType,
      targetId: src.targetId,
      reactionType: src.reactionType,
      reactionGroup: group,
      audienceScope: src.audienceScope,
      active,
      counts: {
        earthPositive: target.earthPositiveCount || 0,
        earthNegative: target.earthNegativeCount || 0,
        alienPositive: target.alienPositiveCount || 0,
        alienNegative: target.alienNegativeCount || 0,
      },
    };
  }

  async function listActiveReactionsForActor(actorUserId, targetType, targetId) {
    return Array.from(reactions.values())
      .filter(
        (r) =>
          r.actorUserId === actorUserId &&
          r.cancelledAt == null &&
          r.targetType === targetType &&
          ((targetType === 'POST' && r.postId === targetId) || (targetType === 'COMMENT' && r.commentId === targetId))
      )
      .map(clone);
  }

  async function listReactionsForAlignment(filter) {
    const f = filter || {};
    return Array.from(reactions.values())
      .filter((r) => {
        if (f.audienceScope && r.audienceScope !== f.audienceScope) return false;
        if (f.targetAuthorUserId && r.targetAuthorUserId !== f.targetAuthorUserId) return false;
        return true;
      })
      .map(clone);
  }

  async function createReport(input) {
    const src = input || {};
    if (src.reporterUserId === src.targetAuthorUserId) {
      const err = new Error('BOARD_REPORT_SELF_FORBIDDEN');
      err.code = 'BOARD_REPORT_SELF_FORBIDDEN';
      throw err;
    }
    const dup = Array.from(reports.values()).find((r) => {
      if (r.reporterUserId !== src.reporterUserId) return false;
      if (r.status !== 'SUBMITTED' && r.status !== 'REVIEWING') return false;
      if (src.targetType === 'POST') return r.postId === src.targetId;
      return r.commentId === src.targetId;
    });
    if (dup) {
      const err = new Error('BOARD_REPORT_DUPLICATE');
      err.code = 'BOARD_REPORT_DUPLICATE';
      throw err;
    }
    const id = uuid();
    const row = {
      id,
      reporterUserId: src.reporterUserId,
      targetType: src.targetType,
      postId: src.targetType === 'POST' ? src.targetId : null,
      commentId: src.targetType === 'COMMENT' ? src.targetId : null,
      targetAuthorUserId: src.targetAuthorUserId,
      reasonCode: src.reasonCode,
      reasonDetail: src.reasonDetail == null ? null : String(src.reasonDetail),
      status: 'SUBMITTED',
      createdAt: nowIso(),
      reviewedAt: null,
      reviewedBy: null,
      resolutionNote: null,
    };
    reports.set(id, row);
    return clone(row);
  }

  async function getReport(id) {
    const row = reports.get(id);
    return row ? clone(row) : null;
  }

  async function listReports(filter) {
    const f = filter || {};
    return Array.from(reports.values())
      .filter((r) => {
        if (f.targetAuthorUserId && r.targetAuthorUserId !== f.targetAuthorUserId) return false;
        if (f.reasonCode && r.reasonCode !== f.reasonCode) return false;
        if (f.status && r.status !== f.status) return false;
        return true;
      })
      .map(clone);
  }

  async function listReportsByTargetAuthor(userId) {
    return listReports({ targetAuthorUserId: userId });
  }

  async function updateReportReview(id, patch) {
    const row = reports.get(id);
    if (!row) return null;
    const src = patch || {};
    if (src.status) row.status = src.status;
    if (Object.prototype.hasOwnProperty.call(src, 'resolutionNote')) row.resolutionNote = src.resolutionNote;
    row.reviewedAt = src.reviewedAt || nowIso();
    row.reviewedBy = src.reviewedBy || null;
    reports.set(id, row);
    return clone(row);
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
    updateReportReview,
    _debug: { posts, comments, reactions, reports },
  };
}

module.exports = {
  createBoardMemoryRepository,
};
