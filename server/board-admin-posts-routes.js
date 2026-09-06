'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');
const auditCore = require('../shared/admin-moderation-audit-core');
const auditService = require('./admin-moderation-audit-service');

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
            : String(code).indexOf('BOARD_') === 0 || String(code).indexOf('ADMIN_AUDIT_') === 0
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

  function auditPayload(req) {
    const body = req.body || {};
    return {
      reasonCode: body.reasonCode || body.reason_code,
      operatorNote: body.operatorNote || body.operator_note,
      reportId: body.reportId || body.report_id || null,
    };
  }

  function publicAudit(row) {
    return row ? auditCore.publicEvent(row) : null;
  }

  router.post('/:postId/soft-delete', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const out = await service.operatorSoftDeletePost(actorFromAdmin(req), req.params.postId, auditPayload(req));
      const post = out && out.post ? out.post : out;
      return res.json({
        ok: true,
        post: adminPostView(post),
        audit: publicAudit(out && out.audit),
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
      const out = await service.operatorRestorePost(actorFromAdmin(req), req.params.postId, auditPayload(req));
      const post = out && out.post ? out.post : out;
      return res.json({
        ok: true,
        post: adminPostView(post),
        audit: publicAudit(out && out.audit),
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.post('/:postId/sanction', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const applySanction = opts.applySanction;
      if (typeof applySanction !== 'function') {
        return publicError(res, { code: 'ADMIN_SANCTION_UNAVAILABLE' });
      }
      const post = await service.getAdminPost(actorFromAdmin(req), req.params.postId);
      if (!post || !post.authorUserId) {
        return publicError(res, { code: 'BOARD_POST_AUTHOR_MISSING' });
      }
      const body = req.body || {};
      const packed = auditCore.normalizeWrite({
        actorUserId: actorFromAdmin(req).userId,
        actionType: auditCore.ACTION_TYPE.SANCTION_APPLIED,
        targetType: auditCore.TARGET_TYPE.POST,
        targetId: post.id,
        targetUserId: post.authorUserId,
        reasonCode: body.reasonCode || body.reason_code,
        operatorNote: body.operatorNote || body.operator_note,
        reportId: body.reportId || body.report_id || null,
      });
      if (!packed.ok) return publicError(res, { code: packed.error });
      const result = await applySanction({
        userId: post.authorUserId,
        action: body.action || body.operatorSanction,
        operatorUserId: actorFromAdmin(req).userId,
        reasonCode: packed.event.reasonCode,
        behaviorKey: body.behaviorKey || body.sourceId || post.id,
      });
      let sanctionId = null;
      if (result && result.event && auditCore.isUuid(result.event.id)) sanctionId = result.event.id;
      if (!sanctionId && result && result.record && auditCore.isUuid(result.record.id)) sanctionId = result.record.id;
      if (!sanctionId && typeof opts.lookupSanctionId === 'function') {
        try {
          const found = await opts.lookupSanctionId(post.authorUserId, post.id);
          if (auditCore.isUuid(found)) sanctionId = found;
        } catch (_) {}
      }
      packed.event.sanctionId = sanctionId;
      let audit = null;
      let auditLimitation = null;
      try {
        audit = await auditService.record(packed.event);
      } catch (auditErr) {
        auditLimitation = 'SANCTION_AUDIT_ATOMICITY_LIMITATION';
        audit = {
          limitation: auditLimitation,
          error: (auditErr && auditErr.code) || 'ADMIN_AUDIT_INSERT_FAILED',
        };
      }
      return res.json({
        ok: true,
        result: result,
        audit: audit && audit.id ? publicAudit(audit) : audit,
        limitation: auditLimitation,
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      const code = (e && e.code) || 'ADMIN_SANCTION_FAILED';
      const status = e && e.status ? e.status : (String(code).indexOf('ADMIN_AUDIT_') === 0 ? 400 : 400);
      return res.status(status).json({
        ok: false,
        error: { code: code, message: (e && e.message) || code },
      });
    }
  });

  return router;
}

module.exports = {
  mountAdminPostsRoutes: mountAdminPostsRoutes,
  adminPostView: adminPostView,
};
