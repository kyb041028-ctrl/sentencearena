'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');

function publicError(res, err) {
  const code = (err && err.code) || 'BOARD_SERVER_ERROR';
  const status =
    code === 'BOARD_AUTH_REQUIRED' || code === 'ADMIN_TOKEN_MISSING' || code === 'ADMIN_TOKEN_INVALID'
      ? 401
      : code === 'BOARD_FORBIDDEN' || code === 'BOARD_OFFICIAL_OPERATOR_ONLY' || code === 'ADMIN_ROLE_MISSING' || code === 'ADMIN_ROLE_FORBIDDEN'
        ? 403
        : code === 'BOARD_POST_NOT_FOUND'
          ? 404
          : code === 'BOARD_API_NOT_ACTIVATED'
            ? 503
            : String(code).indexOf('BOARD_') === 0
              ? 400
              : 500;
  const payload = { ok: false, error: { code: code, message: (err && err.message) || code } };
  if (code === 'BOARD_OFFICIAL_TITLE_RESERVED' && err && err.message) {
    payload.error.message = err.message;
  }
  return res.status(status).json(payload);
}

function actorFromAdmin(req) {
  const admin = req.dailyIssueAdmin || {};
  return { userId: admin.userId };
}

function publicOfficialPost(post) {
  if (!post) return null;
  const author = post.author || {};
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    territory: post.territory,
    categoryKey: post.categoryKey,
    status: post.status,
    isOfficial: post.isOfficial === true,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    author: {
      displayName: author.displayName || null,
      userId: author.userId || null,
      territory: author.territory || null,
    },
  };
}

function mountOfficialBoardAdminRoutes(options) {
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

  router.get('/official-posts', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const posts = await service.listOfficialPosts(actorFromAdmin(req));
      return res.json({ ok: true, posts: (posts || []).map(publicOfficialPost) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.post('/official-posts', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const body = req.body || {};
      const result = await service.createOfficialPost(actorFromAdmin(req), {
        title: body.title,
        content: body.content,
        categoryKey: body.categoryKey,
      });
      return res.status(201).json({
        ok: true,
        post: publicOfficialPost(result && result.post),
        progression: null,
        newlyGrantedAchievements: [],
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.patch('/official-posts/:postId', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const body = req.body || {};
      const post = await service.updateOfficialPost(actorFromAdmin(req), req.params.postId, {
        title: body.title,
        content: body.content,
      });
      return res.json({ ok: true, post: publicOfficialPost(post) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.delete('/official-posts/:postId', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const post = await service.deleteOfficialPost(actorFromAdmin(req), req.params.postId);
      return res.json({ ok: true, post: publicOfficialPost(post) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  return router;
}

module.exports = {
  mountOfficialBoardAdminRoutes: mountOfficialBoardAdminRoutes,
};
