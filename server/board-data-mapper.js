'use strict';

const schema = require('../shared/board-schema-core');
const withdrawalCore = require('../shared/account-withdrawal-core');

function clone(v) {
  return schema.clone(v);
}

function createBoardDataMapper() {
  function mapPostForViewer(row, viewerUserId) {
    if (!row) return null;
    const src = clone(row);
    const isMine = !!(viewerUserId && src.authorUserId === viewerUserId);
    const isAnonymous = !!src.isAnonymous;
    const status = src.status || schema.STATUS.ACTIVE;
    const active = status === schema.STATUS.ACTIVE;

    const author = !src.authorUserId
      ? withdrawalCore.withdrawnAuthor(src.territory)
      : isAnonymous && !isMine
      ? {
          displayName: '익명',
          userId: null,
          territory: null,
        }
      : {
          displayName: isAnonymous ? '익명' : src.authorDisplayName || null,
          userId: isAnonymous ? null : src.authorUserId || null,
          territory: src.territory || null,
        };

    return {
      id: src.id,
      source: 'server_canonical',
      canonical: true,
      territory: src.territory,
      categoryKey: src.categoryKey == null ? null : src.categoryKey,
      boardStage: src.boardStage == null ? 1 : src.boardStage,
      title: active ? src.title : status === schema.STATUS.DELETED ? '삭제된 게시글입니다.' : src.title,
      content: active ? src.content : null,
      isAnonymous: isAnonymous,
      status: status,
      deletedAt: src.deletedAt || null,
      blindReason: src.blindReason || null,
      commentCount: src.commentCount || 0,
      counts: {
        earthPositive: src.earthPositiveCount || 0,
        earthNegative: src.earthNegativeCount || 0,
        alienPositive: src.alienPositiveCount || 0,
        alienNegative: src.alienNegativeCount || 0,
      },
      createdAt: src.createdAt,
      updatedAt: src.updatedAt,
      isMine: isMine,
      author: author,
    };
  }

  function mapCommentForViewer(row, viewerUserId) {
    if (!row) return null;
    const src = clone(row);
    const isMine = !!(viewerUserId && src.authorUserId === viewerUserId);
    const isAnonymous = !!src.isAnonymous;
    const status = src.status || schema.STATUS.ACTIVE;
    const active = status === schema.STATUS.ACTIVE;

    return {
      id: src.id,
      postId: src.postId,
      parentCommentId: src.parentCommentId || null,
      audienceScope: src.audienceScope || schema.AUDIENCE_SCOPE.EARTH,
      content: active ? src.content : status === schema.STATUS.DELETED ? '삭제된 댓글입니다.' : null,
      isAnonymous: isAnonymous,
      status: status,
      deletedAt: src.deletedAt || null,
      blindReason: src.blindReason || null,
      counts: {
        earthPositive: src.earthPositiveCount || 0,
        earthNegative: src.earthNegativeCount || 0,
        alienPositive: src.alienPositiveCount || 0,
        alienNegative: src.alienNegativeCount || 0,
      },
      createdAt: src.createdAt,
      updatedAt: src.updatedAt,
      isMine: isMine,
      author: !src.authorUserId
        ? withdrawalCore.withdrawnAuthor(src.territory)
        : isAnonymous && !isMine
        ? { displayName: '익명', userId: null, territory: null }
        : {
            displayName: isAnonymous ? '익명' : src.authorDisplayName || null,
            userId: isAnonymous ? null : src.authorUserId || null,
            territory: src.territory || null,
          },
    };
  }

  function fromDbPost(row) {
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
      deletedBy: row.deleted_by,
      blindReason: row.blind_reason,
      commentCount: row.comment_count,
      earthPositiveCount: row.earth_positive_count,
      earthNegativeCount: row.earth_negative_count,
      alienPositiveCount: row.alien_positive_count,
      alienNegativeCount: row.alien_negative_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function fromDbComment(row) {
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
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      blindReason: row.blind_reason,
      earthPositiveCount: row.earth_positive_count,
      earthNegativeCount: row.earth_negative_count,
      alienPositiveCount: row.alien_positive_count,
      alienNegativeCount: row.alien_negative_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    mapPostForViewer,
    mapCommentForViewer,
    fromDbPost,
    fromDbComment,
  };
}

module.exports = {
  createBoardDataMapper,
};
