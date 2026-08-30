'use strict';

const express = require('express');
const service = require('./rights-infringement-service');
const core = require('../shared/rights-infringement-core');
const attachmentCore = require('../shared/rights-attachment-core');
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

async function optionalUser(req, res, authCfg) {
  let userId = null;
  if (req.headers.authorization) {
    const auth = await requireAuthenticatedUser(req, res, {
      url: authCfg.supabaseUrl,
      key: authCfg.supabaseAnonKey,
    });
    if (auth.ok && auth.user && auth.user.id) userId = auth.user.id;
  }
  return userId;
}

function guestEmailReady(opts) {
  const adapter = opts && opts.emailVerify;
  if (adapter && typeof adapter.isMailerConfigured === 'function') {
    return adapter.isMailerConfigured() === true;
  }
  return service.isGuestEmailReady();
}

function mountRightsInfringementPublicRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const limiter = opts.rateLimiter || createMemoryRateLimiter({ now: opts.now });
  const guestLimit = Number(opts.guestLimitPerWindow) || 5;
  const emailStartLimit = Number(opts.emailStartLimitPerWindow) || 5;
  const windowMs = Number(opts.windowMs) || 10 * 60 * 1000;

  router.get('/meta', function (_req, res) {
    const ready = guestEmailReady(opts);
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
      confirmTruthText: core.CONFIRM_TRUTH_TEXT,
      confirmNotMaliciousText: core.CONFIRM_NOT_MALICIOUS_TEXT,
      politicalProtection: core.POLITICAL_PROTECTION,
      takedownNotice: core.TAKEDOWN_NOTICE,
      guideIntro: core.GUIDE_INTRO,
      maskPiiNotice: core.MASK_PII_NOTICE,
      guestVerifyUnavailableNotice: core.GUEST_VERIFY_UNAVAILABLE_NOTICE,
      guestEmailVerify: ready,
      guestVerificationStatus: ready ? 'EMAIL_READY' : 'UNAVAILABLE',
      fileUpload: {
        implemented: true,
        maxFiles: attachmentCore.MAX_FILES,
        maxBytes: attachmentCore.MAX_BYTES,
        kinds: Object.keys(attachmentCore.ALLOWED),
      },
    });
  });

  router.post('/email/start', async function (req, res) {
    try {
      const adapter = opts.emailVerify;
      if (!adapter || typeof adapter.startChallenge !== 'function' || !guestEmailReady(opts)) {
        return res.status(503).json({ ok: false, error: 'EMAIL_SENDER_UNAVAILABLE' });
      }
      const limited = limiter.check('rights_email_start', clientKey(req), emailStartLimit, windowMs);
      if (!limited.ok) {
        return res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
      }
      const result = await adapter.startChallenge(req.body || {});
      return res.json(result);
    } catch (e) {
      return sendError(res, e);
    }
  });

  router.post('/email/confirm', async function (req, res) {
    try {
      const adapter = opts.emailVerify;
      if (!adapter || typeof adapter.confirmChallenge !== 'function' || !guestEmailReady(opts)) {
        return res.status(503).json({ ok: false, error: 'EMAIL_SENDER_UNAVAILABLE' });
      }
      const result = await adapter.confirmChallenge(req.body || {});
      return res.json(result);
    } catch (e) {
      return sendError(res, e);
    }
  });

  router.post('/attachments/staging', express.raw({ type: '*/*', limit: attachmentCore.MAX_BYTES }), async function (req, res) {
    try {
      const authCfg = opts.adminAuth || {};
      const userId = await optionalUser(req, res, authCfg);
      if (!userId) {
        return res.status(503).json({ ok: false, error: 'GUEST_VERIFICATION_UNAVAILABLE' });
      }
      const filename = String(req.headers['x-filename'] || req.headers['x-file-name'] || 'evidence');
      const result = await service.createStaging({
        filename: filename,
        bytes: req.body,
        contentType: req.headers['content-type'],
      }, userId);
      return res.status(201).json(result);
    } catch (e) {
      return sendError(res, e);
    }
  });

  router.post('/requests', async function (req, res) {
    try {
      const authCfg = opts.adminAuth || {};
      const userId = await optionalUser(req, res, authCfg);
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

  router.get('/me/requests/:id/attachments/:attId', async function (req, res) {
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
      const row = await service.getAttachmentForClaimant(auth.user.id, req.params.id, req.params.attId);
      res.setHeader('Content-Type', row.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + String(row.filename || 'evidence').replace(/"/g, '') + '"');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(row.bytes);
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
        rejectionCodes: core.REJECTION_CODE,
        rejectionCodeLabels: core.REJECTION_CODE_LABEL,
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

  router.get('/requests/:id/attachments/:attId', async function (req, res) {
    try {
      const row = await service.getAttachmentForAdmin(req.params.id, req.params.attId);
      res.setHeader('Content-Type', row.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + String(row.filename || 'evidence').replace(/"/g, '') + '"');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(row.bytes);
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
