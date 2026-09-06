'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');
const auditService = require('./admin-moderation-audit-service');

function publicError(res, err) {
  const code = (err && err.code) || 'ADMIN_AUDIT_SERVER_ERROR';
  const status =
    code === 'ADMIN_TOKEN_MISSING' || code === 'ADMIN_TOKEN_INVALID' || code === 'BOARD_AUTH_REQUIRED'
      ? 401
      : code === 'ADMIN_ROLE_MISSING' || code === 'ADMIN_ROLE_FORBIDDEN'
        ? 403
        : String(code).indexOf('ADMIN_AUDIT_') === 0
          ? 400
          : 500;
  return res.status(status).json({
    ok: false,
    error: { code: code, message: (err && err.message) || code },
  });
}

function mountAdminAuditRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const bypass = opts.adminBypass === true;
  const guard = bypass
    ? function (_req, _res, next) {
        next();
      }
    : createAdminAccessGuard(opts.adminAuth || {});

  router.use(guard);

  router.get('/', async function (req, res) {
    try {
      const listed = await auditService.list(req.query || {});
      return res.json({
        ok: true,
        events: listed.events,
        nextCursor: listed.nextCursor,
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return publicError(res, e);
    }
  });

  return router;
}

module.exports = {
  mountAdminAuditRoutes: mountAdminAuditRoutes,
};
