'use strict';

const express = require('express');
const service = require('./rights-infringement-service');
const core = require('../shared/rights-infringement-core');
const { createAdminAccessGuard } = require('./daily-issue-admin-auth');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { createMemoryRateLimiter, clientKey } = require('./daily-issue-api-rate-limit');

function sendError(res, e) {
  const code = e && e.code ? e.code : 'RIGHTS_REQUEST_FAILED';
  const status = e && e.status ? e.status : 400;
  const body = { ok: false, error: code };
  if (e && e.existing) body.existing = e.existing;
  return res.status(status).json(body);
}

function mountRightsInfringementPublicRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const limiter = opts.rateLimiter || createMemoryRateLimiter({ now: opts.now });
  const guestLimit = Number(opts.guestLimitPerWindow) || 5;
  const windowMs = Number(opts.windowMs) || 10 * 60 * 1000;

  router.get('/meta', function (_req, res) {
    return res.json({
      ok: true,
      claimTypes: core.CLAIM_TYPE,
      claimTypeLabels: core.CLAIM_TYPE_LABEL,
      claimantKinds: core.CLAIMANT_KIND,
      claimantKindLabels: core.CLAIMANT_KIND_LABEL,
      requestedActions: core.REQUESTED_ACTION,
      objectionGrounds: core.OBJECTION_GROUND,
      min: core.MIN,
      abuseNoticeTitle: core.ABUSE_NOTICE_TITLE,
      abuseNoticeBody: core.ABUSE_NOTICE_BODY,
      confirmText: core.CONFIRM_TEXT,
      politicalProtection: core.POLITICAL_PROTECTION,
      takedownNotice: core.TAKEDOWN_NOTICE,
      fileUpload: 'NOT_IMPLEMENTED',
    });
  });

  router.post('/requests', async function (req, res) {
    try {
      const authCfg = opts.adminAuth || {};
      let userId = null;
      if (req.headers.authorization) {
        const auth = await requireAuthenticatedUser(req, res, {
          url: authCfg.supabaseUrl,
          key: authCfg.supabaseAnonKey,
        });
        if (auth.ok && auth.user && auth.user.id) userId = auth.user.id;
      }
      if (!userId) {
        const limited = limiter.check('rights_guest', clientKey(req), guestLimit, windowMs);
        if (!limited.ok) {
          return res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
        }
      }
      const result = await service.submitRequest(req.body || {}, { userId: userId });
      return res.status(201).json({ ok: true, request: result.request });
    } catch (e) {
      return sendError(res, e);
    }
  });

  router.get('/me/notices', async function (req, res) {
    try {
      const authCfg = opts.adminAuth || {};
      const auth = await requireAuthenticatedUser(req, res, {
        url: authCfg.supabaseUrl,
        key: authCfg.supabaseAnonKey,
      });
      if (!auth.ok || !auth.user || !auth.user.id) {
        if (!res.headersSent) {
          return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'AUTH_REQUIRED' });
        }
        return;
      }
      const notices = await service.listAuthorNotices(auth.user.id);
      return res.json({ ok: true, notices: notices });
    } catch (e) {
      return sendError(res, e);
    }
  });

  router.post('/me/requests/:id/objection', async function (req, res) {
    try {
      const authCfg = opts.adminAuth || {};
      const auth = await requireAuthenticatedUser(req, res, {
        url: authCfg.supabaseUrl,
        key: authCfg.supabaseAnonKey,
      });
      if (!auth.ok || !auth.user || !auth.user.id) {
        if (!res.headersSent) {
          return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'AUTH_REQUIRED' });
        }
        return;
      }
      const result = await service.submitObjection(auth.user.id, req.params.id, req.body || {});
      return res.status(201).json(result);
    } catch (e) {
      return sendError(res, e);
    }
  });

  return router;
}

function mountRightsInfringementAdminRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const bypass = opts.adminBypass === true;
  const guard = bypass
    ? function (_req, _res, next) { next(); }
    : createAdminAccessGuard(opts.adminAuth || {});

  router.use(guard);

  router.get('/requests', async function (_req, res) {
    try {
      const rows = await service.listAdmin();
      return res.json({
        ok: true,
        requests: rows,
        politicalProtection: core.POLITICAL_PROTECTION,
      });
    } catch (e) {
      return sendError(res, e);
    }
  });

  router.get('/requests/:id', async function (req, res) {
    try {
      const detail = await service.getAdmin(req.params.id);
      return res.json({ ok: true, request: detail });
    } catch (e) {
      return sendError(res, e);
    }
  });

  router.post('/requests/:id/action', async function (req, res) {
    try {
      const operatorUserId = req.dailyIssueAdmin && req.dailyIssueAdmin.userId
        ? req.dailyIssueAdmin.userId
        : null;
      const result = await service.applyAdminAction(req.params.id, req.body || {}, operatorUserId);
      return res.json(result);
    } catch (e) {
      return sendError(res, e);
    }
  });

  return router;
}

module.exports = {
  mountRightsInfringementPublicRoutes: mountRightsInfringementPublicRoutes,
  mountRightsInfringementAdminRoutes: mountRightsInfringementAdminRoutes,
};
