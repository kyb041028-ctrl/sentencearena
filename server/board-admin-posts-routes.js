'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');

function publicError(res, err) {
  const code = (err && err.code) || 'BOARD_SERVER_ERROR';
  const status =
    code === 'BOARD_AUTH_REQUIRED' || code === 'ADMIN_TOKEN_MISSING' || code === 'ADMIN_TOKEN_INVALID'
      ? 401
      : code === 'BOARD_FORBIDDEN' || code === 'ADMIN_ROLE_MISSING' || code === 'ADMIN_ROLE_FORBIDDEN'
        ? 403
        : code === 'BOARD_POST_NOT_FOUND'
          ? 404
          : code === 'BOARD_API_NOT_ACTIVATED'
            ? 503
            : String(code).indexOf('BOARD_') === 0
              ? 400
              : 500;
  return res.status(status).json({
    ok: false,
    error: { code: code, message: (err && err.message) || code },
  });
}

function actorFromAdmin(req) {
  const admin = req.dailyIssueAdmin || {};
  return { userId: admin.userId };
}

function adminPostView(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    isOfficial: row.isOfficial === true,
    territory: row.territory,
    categoryKey: row.categoryKey == null ? null : row.categoryKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt || null,
    author: {
      displayName: row.authorDisplayName || null,
      userId: row.authorUserId || null,
      territory: row.territory || null,
    },
  };
}

function mountAdminPostsRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const bypass = opts.adminBypass === true;
  const guard = bypass
    ? function (_req, _res, next) {
        next();
      }
    : createAdminAccessGuard(opts.adminAuth || {});

  router.use(guard);

  function getService() {
    if (typeof opts.getBoardService === 'function') return opts.getBoardService();
    return opts.boardService || null;
  }

  router.get('/', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const posts = await service.listAdminPosts(actorFromAdmin(req), {
        q: req.query.q,
        limit: req.query.limit,
      });
      return res.json({ ok: true, posts: (posts || []).map(adminPostView) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.get('/:postId', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const post = await service.getAdminPost(actorFromAdmin(req), req.params.postId);
      return res.json({ ok: true, post: adminPostView(post) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.post('/:postId/soft-delete', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const post = await service.operatorSoftDeletePost(actorFromAdmin(req), req.params.postId);
      return res.json({
        ok: true,
        post: adminPostView(post),
        audit: 'ADMIN_DIRECT_ACTION_AUDIT_SCHEMA_REQUIRED',
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.post('/:postId/restore', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const post = await service.operatorRestorePost(actorFromAdmin(req), req.params.postId);
      return res.json({
        ok: true,
        post: adminPostView(post),
        audit: 'ADMIN_DIRECT_ACTION_AUDIT_SCHEMA_REQUIRED',
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  return router;
}

module.exports = {
  mountAdminPostsRoutes: mountAdminPostsRoutes,
  adminPostView: adminPostView,
};
