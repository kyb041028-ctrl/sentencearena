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
        : code === 'BOARD_COMMENT_NOT_FOUND' || code === 'BOARD_POST_NOT_FOUND'
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

function adminCommentView(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.postId,
    parentCommentId: row.parentCommentId || null,
    kind: row.parentCommentId ? 'REPLY' : 'COMMENT',
    content: row.content,
    status: row.status,
    territory: row.territory || null,
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

function mountAdminCommentsRoutes(options) {
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

  function parseListFilter(query) {
    const q = query || {};
    const raw = String(q.q || '').trim();
    const out = {
      q: raw || undefined,
      limit: q.limit,
      commentId: q.commentId || undefined,
      postId: q.postId || undefined,
      authorUserId: q.authorUserId || undefined,
    };
    if (!out.commentId && !out.postId && !out.authorUserId && raw && /^[0-9a-f-]{36}$/i.test(raw)) {
      // Prefer exact ID fields when the query is a UUID; service/repo still handles or-filter fallback.
      out.q = raw;
    }
    return out;
  }

  router.get('/', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const comments = await service.listAdminComments(actorFromAdmin(req), parseListFilter(req.query));
      return res.json({ ok: true, comments: (comments || []).map(adminCommentView) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.get('/:commentId', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const comment = await service.getAdminComment(actorFromAdmin(req), req.params.commentId);
      return res.json({ ok: true, comment: adminCommentView(comment) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.post('/:commentId/soft-delete', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const out = await service.operatorSoftDeleteComment(
        actorFromAdmin(req),
        req.params.commentId,
        auditPayload(req),
      );
      const comment = out && out.comment ? out.comment : out;
      return res.json({
        ok: true,
        comment: adminCommentView(comment),
        audit: publicAudit(out && out.audit),
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.post('/:commentId/restore', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const out = await service.operatorRestoreComment(
        actorFromAdmin(req),
        req.params.commentId,
        auditPayload(req),
      );
      const comment = out && out.comment ? out.comment : out;
      return res.json({
        ok: true,
        comment: adminCommentView(comment),
        audit: publicAudit(out && out.audit),
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  router.post('/:commentId/sanction', async function (req, res) {
    try {
      const service = getService();
      if (!service) return publicError(res, { code: 'BOARD_API_NOT_ACTIVATED' });
      const applySanction = opts.applySanction;
      if (typeof applySanction !== 'function') {
        return publicError(res, { code: 'ADMIN_SANCTION_UNAVAILABLE' });
      }
      const comment = await service.getAdminComment(actorFromAdmin(req), req.params.commentId);
      if (!comment || !comment.authorUserId) {
        return publicError(res, { code: 'BOARD_COMMENT_AUTHOR_MISSING' });
      }
      const body = req.body || {};
      const packed = auditCore.normalizeWrite({
        actorUserId: actorFromAdmin(req).userId,
        actionType: auditCore.ACTION_TYPE.SANCTION_APPLIED,
        targetType: auditCore.TARGET_TYPE.COMMENT,
        targetId: comment.id,
        targetUserId: comment.authorUserId,
        reasonCode: body.reasonCode || body.reason_code,
        operatorNote: body.operatorNote || body.operator_note,
        reportId: body.reportId || body.report_id || null,
      });
      if (!packed.ok) return publicError(res, { code: packed.error });
      const result = await applySanction({
        userId: comment.authorUserId,
        action: body.action || body.operatorSanction,
        operatorUserId: actorFromAdmin(req).userId,
        reasonCode: packed.event.reasonCode,
        behaviorKey: body.behaviorKey || body.sourceId || comment.id,
      });
      let sanctionId = null;
      if (result && result.event && auditCore.isUuid(result.event.id)) sanctionId = result.event.id;
      if (!sanctionId && result && result.record && auditCore.isUuid(result.record.id)) sanctionId = result.record.id;
      if (!sanctionId && typeof opts.lookupSanctionId === 'function') {
        try {
          const found = await opts.lookupSanctionId(comment.authorUserId, comment.id);
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
      const status = e && e.status ? e.status : 400;
      return res.status(status).json({
        ok: false,
        error: { code: code, message: (e && e.message) || code },
      });
    }
  });

  return router;
}

module.exports = {
  mountAdminCommentsRoutes: mountAdminCommentsRoutes,
  adminCommentView: adminCommentView,
};
