'use strict';

const schema = require('../shared/board-schema-core');
const { createBoardDataMapper } = require('./board-data-mapper');
const { createUnavailableUserContextAdapter } = require('./board-user-context-adapter');

function createBoardService(options) {
  const opts = options || {};
  const repository = opts.repository;
  const userContext = opts.userContext || createUnavailableUserContextAdapter();
  const mapper = opts.mapper || createBoardDataMapper();
  const operational = opts.operational === true;

  if (!repository) {
    const err = new Error('BOARD_REPOSITORY_REQUIRED');
    err.code = 'BOARD_REPOSITORY_REQUIRED';
    throw err;
  }

  function requireUser(actor) {
    if (!actor || !actor.userId) {
      const err = new Error('BOARD_AUTH_REQUIRED');
      err.code = 'BOARD_AUTH_REQUIRED';
      throw err;
    }
    return actor.userId;
  }

  function ensureOperational() {
    if (!operational) {
      const err = new Error('BOARD_API_NOT_ACTIVATED');
      err.code = 'BOARD_API_NOT_ACTIVATED';
      err.message = 'Board operational API is not activated until migration and territory adapter are ready.';
      throw err;
    }
  }

  async function createPost(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validatePostInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      err.details = validation.errors;
      throw err;
    }
    const territory = await userContext.getUserTerritory(userId);
    const row = await repository.createPost({
      authorUserId: userId,
      territory,
      categoryKey: snapshot.categoryKey == null ? null : snapshot.categoryKey,
      boardStage: snapshot.boardStage == null ? 1 : Number(snapshot.boardStage) || 1,
      title: snapshot.title,
      content: snapshot.content,
      isAnonymous: !!snapshot.isAnonymous,
    });
    return {
      post: mapper.mapPostForViewer(row, userId),
      inputUnchanged: JSON.stringify(input || {}) === JSON.stringify(snapshot),
    };
  }

  async function getPost(actor, postId) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    const row = await repository.getPost(postId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    return mapper.mapPostForViewer(row, viewerId);
  }

  async function listPosts(actor, filter) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    const rows = await repository.listPosts(filter || {});
    return rows.map((r) => mapper.mapPostForViewer(r, viewerId));
  }

  async function updatePost(actor, postId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validatePostInput({
      title: snapshot.title != null ? snapshot.title : 'x',
      content: snapshot.content != null ? snapshot.content : 'x',
    });
    if (snapshot.title != null || snapshot.content != null) {
      if (snapshot.title != null && !String(snapshot.title).trim()) {
        const err = new Error('BOARD_TITLE_REQUIRED');
        err.code = 'BOARD_TITLE_REQUIRED';
        throw err;
      }
      if (snapshot.content != null && !String(snapshot.content).trim()) {
        const err = new Error('BOARD_CONTENT_REQUIRED');
        err.code = 'BOARD_CONTENT_REQUIRED';
        throw err;
      }
    }
    if (!validation.valid && (snapshot.title != null || snapshot.content != null)) {
      // length checks only when provided
      const titleCheck = snapshot.title != null ? schema.validatePostInput({ title: snapshot.title, content: 'ok' }) : { valid: true };
      const contentCheck = snapshot.content != null ? schema.validatePostInput({ title: 'ok', content: snapshot.content }) : { valid: true };
      if (!titleCheck.valid || !contentCheck.valid) {
        const err = new Error((titleCheck.errors && titleCheck.errors[0]) || (contentCheck.errors && contentCheck.errors[0]));
        err.code = err.message;
        throw err;
      }
    }
    const row = await repository.updatePost(postId, snapshot, userId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    return mapper.mapPostForViewer(row, userId);
  }

  async function deletePost(actor, postId) {
    ensureOperational();
    const userId = requireUser(actor);
    const row = await repository.softDeletePost(postId, userId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    return mapper.mapPostForViewer(row, userId);
  }

  async function createComment(actor, postId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validateCommentInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }
    const territory = await userContext.getUserTerritory(userId);
    const row = await repository.createComment({
      postId,
      parentCommentId: snapshot.parentCommentId || null,
      authorUserId: userId,
      territory,
      content: snapshot.content,
      isAnonymous: !!snapshot.isAnonymous,
    });
    return mapper.mapCommentForViewer(row, userId);
  }

  async function listComments(actor, postId) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    const rows = await repository.listComments(postId);
    return rows.map((r) => mapper.mapCommentForViewer(r, viewerId));
  }

  async function updateComment(actor, commentId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validateCommentInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }
    const row = await repository.updateComment(commentId, snapshot, userId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    return mapper.mapCommentForViewer(row, userId);
  }

  async function deleteComment(actor, commentId) {
    ensureOperational();
    const userId = requireUser(actor);
    const row = await repository.softDeleteComment(commentId, userId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    return mapper.mapCommentForViewer(row, userId);
  }

  async function toggleReaction(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validateReactionInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }

    // Ignore client-supplied territory/audienceScope.
    const actorTerritory = await userContext.getUserTerritory(userId);
    const audienceScope = schema.audienceScopeFromTerritory(actorTerritory);

    let targetAuthorUserId;
    let targetAuthorTerritory;
    if (snapshot.targetType === schema.TARGET_TYPE.POST) {
      const post = await repository.getPost(snapshot.targetId);
      if (!post) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = post.authorUserId;
    } else {
      const comment = await repository.getComment(snapshot.targetId);
      if (!comment) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = comment.authorUserId;
    }
    targetAuthorTerritory = await userContext.getUserTerritory(targetAuthorUserId);

    return repository.toggleReaction({
      actorUserId: userId,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      reactionType: snapshot.reactionType,
      actorTerritory,
      audienceScope,
      targetAuthorTerritory,
    });
  }

  async function createReport(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validateReportInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }

    let targetAuthorUserId;
    let target;
    if (snapshot.targetType === schema.TARGET_TYPE.POST) {
      target = await repository.getPost(snapshot.targetId);
      if (!target) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      if (target.status !== schema.STATUS.ACTIVE) {
        const err = new Error('BOARD_TARGET_NOT_ACTIVE');
        err.code = 'BOARD_TARGET_NOT_ACTIVE';
        throw err;
      }
      targetAuthorUserId = target.authorUserId;
    } else {
      target = await repository.getComment(snapshot.targetId);
      if (!target) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      if (target.status !== schema.STATUS.ACTIVE) {
        const err = new Error('BOARD_TARGET_NOT_ACTIVE');
        err.code = 'BOARD_TARGET_NOT_ACTIVE';
        throw err;
      }
      targetAuthorUserId = target.authorUserId;
    }

    const row = await repository.createReport({
      reporterUserId: userId,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      targetAuthorUserId,
      reasonCode: snapshot.reasonCode,
      reasonDetail: snapshot.reasonDetail || null,
    });

    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  return {
    createPost,
    getPost,
    listPosts,
    updatePost,
    deletePost,
    createComment,
    listComments,
    updateComment,
    deleteComment,
    toggleReaction,
    createReport,
  };
}

module.exports = {
  createBoardService,
};
