'use strict';

const express = require('express');
const service = require('./alien-moderation-service');
const reportCore = require('../shared/alien-report-moderation-core');
const { createAdminAccessGuard } = require('./daily-issue-admin-auth');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');

const router = express.Router();

function extractBearer(req) {
  const h = String((req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : '';
}

function fixtureUserId(req) {
  const token = extractBearer(req);
  if (token && token.indexOf('user:') === 0) return token.slice(5);
  const header = req.headers['x-user-id'];
  if (header && (!token || token.indexOf('user:') === 0)) return String(header);
  return null;
}

async function resolveModerationUserId(req, res) {
  const token = extractBearer(req);
  if (token && token.indexOf('user:') === 0) return token.slice(5);
  if (token) {
    const cfg = resolveSupabaseServerAuthConfig();
    const auth = await requireAuthenticatedUser(req, res, { url: cfg.url, key: cfg.key });
    if (!auth.ok || !auth.user || !auth.user.id) {
      if (!res.headersSent) {
        res.status(auth.status || 401).json({ ok: false, error: auth.error || 'AUTH_REQUIRED' });
      }
      return null;
    }
    return auth.user.id;
  }
  const header = req.headers['x-user-id'];
  if (header) return String(header);
  res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
  return null;
}

function requireActivated(res) {
  if (service.isActivated()) return false;
  res.status(503).json({
    ok: false,
    error: 'ALIEN_SYSTEM_NOT_ACTIVATED',
    mode: service.getDataMode(),
  });
  return true;
}

router.get('/alien/moderation/health', async (_req, res) => {
  const health = await service.healthCheck();
  return res.json({
    ok: true,
    data: health,
    v1Enabled: service.isActivated(),
    note: 'READ_ONLY_INSPECT',
  });
});

router.get('/alien/moderation/status', async (req, res) => {
  if (requireActivated(res)) return;
  const userId = await resolveModerationUserId(req, res);
  if (!userId) return;
  const state = await service.getFullModerationState(userId);
  return res.json({ ok: true, state: state });
});

router.get('/alien/moderation/inbox', async (req, res) => {
  if (requireActivated(res)) return;
  const userId = await resolveModerationUserId(req, res);
  if (!userId) return;
  const items = await service.listInbox(userId);
  return res.json({ ok: true, notifications: items });
});

router.post('/alien/moderation/return', async (req, res) => {
  if (requireActivated(res)) return;
  const userId = await resolveModerationUserId(req, res);
  if (!userId) return;
  const result = await service.returnToEarth(userId, { operatorForced: false });
  if (!result.ok) {
    const status = result.error === 'NOT_YET_ELIGIBLE' || result.error === 'SEASON_END_ADMIN_ONLY' ? 403 : 400;
    return res.status(status).json({ ok: false, error: result.error, returnStatus: result.returnStatus || null });
  }
  return res.json({ ok: true, result: result });
});

function mountAdminRoutes(options) {
  const opts = options || {};
  const adminRouter = express.Router();
  const bypass = opts.adminBypass === true;
  const getBoardService = opts.getBoardService;
  const guard = bypass
    ? function (_req, _res, next) { next(); }
    : createAdminAccessGuard(opts.adminAuth || {});

  adminRouter.use(guard);

  adminRouter.get('/reports', async (req, res) => {
    if (requireActivated(res)) return;
    try {
      const board = getBoardService && getBoardService(req);
      if (!board || typeof board.listReports !== 'function') {
        return res.status(503).json({ ok: false, error: 'BOARD_REPORT_LIST_UNAVAILABLE' });
      }
      const rows = await board.listReports({ userId: 'admin' }, {});
      const classification = String(req.query.classification || '').toUpperCase();
      const mapped = (rows || []).map(function (row) {
        return Object.assign({}, row, {
          classification: reportCore.classifyReportReason(row.reasonCode),
        });
      }).filter(function (row) {
        if (!classification) return true;
        return row.classification === classification;
      });
      return res.json({ ok: true, reports: mapped });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.code ? e.code : 'ADMIN_REPORT_LIST_FAILED' });
    }
  });

  adminRouter.post('/reports/:id/action', async (req, res) => {
    if (requireActivated(res)) return;
    try {
      const board = getBoardService && getBoardService(req);
      if (!board || typeof board.getReport !== 'function') {
        return res.status(503).json({ ok: false, error: 'BOARD_REPORT_GET_UNAVAILABLE' });
      }
      const report = await board.getReport({ userId: 'admin' }, req.params.id);
      if (!report) return res.status(404).json({ ok: false, error: 'BOARD_REPORT_NOT_FOUND' });
      const action = String((req.body && req.body.action) || '').toUpperCase();
      if (action === reportCore.ADMIN_ACTION.NONE || action === reportCore.ADMIN_ACTION.NORMAL) {
        if (typeof board.reviewReport === 'function') {
          await board.reviewReport(
            { userId: fixtureUserId(req) || 'admin' },
            report.id,
            {
              status: action === reportCore.ADMIN_ACTION.NONE ? 'REJECTED' : 'ACCEPTED',
              resolutionNote: action,
            },
          );
        }
        return res.json({ ok: true, action: action, autoTransfer: false });
      }
      const result = await service.applyAdminReportAction(report, action, fixtureUserId(req) || 'admin');
      if (!result.ok) return res.status(400).json(result);
      if (typeof board.reviewReport === 'function') {
        await board.reviewReport(
          { userId: fixtureUserId(req) || 'admin' },
          report.id,
          { status: 'ACCEPTED', resolutionNote: reportCore.TRANSFER_REASON.ADMIN_IMMEDIATE_ALIEN },
        );
      }
      return res.json({ ok: true, result: result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.code ? e.code : 'ADMIN_REPORT_ACTION_FAILED' });
    }
  });

  adminRouter.post('/users/:userId/return', async (req, res) => {
    if (requireActivated(res)) return;
    const result = await service.returnToEarth(req.params.userId, { operatorForced: true });
    if (!result.ok) return res.status(400).json(result);
    return res.json({ ok: true, result: result });
  });

  return adminRouter;
}

module.exports = router;
module.exports.mountAdminRoutes = mountAdminRoutes;
