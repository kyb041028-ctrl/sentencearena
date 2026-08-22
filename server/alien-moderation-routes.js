'use strict';

const express = require('express');
const service = require('./alien-moderation-service');
const reportCore = require('../shared/alien-report-moderation-core');
const reviewCore = require('../shared/board-report-review-core');
const sanctionCore = require('../shared/user-sanction-core');
const sanctionService = require('./user-sanction-service');
const misinfoCore = require('../shared/misinfo-report-core');
const misinfoAbuse = require('./misinfo-report-abuse-service');
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

function adminActorUserId(req) {
  if (req && req.dailyIssueAdmin && req.dailyIssueAdmin.userId) return req.dailyIssueAdmin.userId;
  return fixtureUserId(req);
}

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
    try {
      const board = getBoardService && getBoardService(req);
      if (!board || typeof board.listReports !== 'function') {
        return res.status(503).json({ ok: false, error: 'BOARD_REPORT_LIST_UNAVAILABLE' });
      }
      const rows = await board.listReports({ userId: 'admin' }, {});
      const mappedRows = (rows || []).map(function (row) {
        const parsed = misinfoCore.parseEncoded(row && row.reasonDetail);
        return Object.assign({}, row, {
          misinfo: parsed,
          reporterContact: undefined,
        });
      });
      const behaviors = typeof board.listReportBehaviors === 'function'
        ? await board.listReportBehaviors({ userId: 'admin' }, {})
        : reviewCore.groupReportsByBehavior(mappedRows);
      const classification = String(req.query.classification || '').toUpperCase();
      const mappedBehaviors = (behaviors || []).filter(function (g) {
        if (!classification) return true;
        return String(g.sanctionClass || '').toUpperCase() === classification
          || String(g.primaryReasonCode || '').toUpperCase() === classification
          || reportCore.classifyReportReason(g.primaryReasonCode) === classification;
      });
      for (let b = 0; b < mappedBehaviors.length; b++) {
        const g = mappedBehaviors[b];
        g.reports = (g.reports || []).map(function (row) {
          return Object.assign({}, row, { misinfo: misinfoCore.parseEncoded(row && row.reasonDetail) });
        });
        g.misinfoGuide = g.primaryReasonCode === 'misinfo' ? {
          criteria: misinfoCore.OPERATOR_CRITERIA,
          evidencePriority: misinfoCore.EVIDENCE_PRIORITY,
          evidenceCaution: misinfoCore.EVIDENCE_CAUTION,
          notAutoMisinfo: misinfoCore.NOT_AUTO_MISINFO,
          autoScore: false,
        } : null;
        g.targetContent = null;
        try {
          if (g.targetType === 'POST' && g.postId && typeof board.getPost === 'function') {
            const post = await board.getPost({ userId: 'admin' }, g.postId);
            g.targetContent = post ? { title: post.title || '', body: post.content || post.body || '', status: post.status || null } : null;
          }
        } catch (_) {}
      }
      const authorIds = [];
      mappedBehaviors.forEach(function (g) {
        if (g.targetAuthorUserId && authorIds.indexOf(g.targetAuthorUserId) === -1) {
          authorIds.push(g.targetAuthorUserId);
        }
      });
      const authorStates = {};
      for (let i = 0; i < authorIds.length; i++) {
        authorStates[authorIds[i]] = await sanctionService.getState(authorIds[i]);
      }
      const appeals = await sanctionService.listAppealsAdmin();
      const activeSanctions = await sanctionService.listActiveSanctions();
      return res.json({
        ok: true,
        alienV1Enabled: service.isActivated(),
        behaviors: mappedBehaviors.map(function (g) {
          const st = authorStates[g.targetAuthorUserId] || null;
          return Object.assign({}, g, {
            allowedSanctions: sanctionCore.allowedOperatorActions({
              sanctionClass: g.sanctionClass,
              massHarm: false,
            }),
            currentSanction: st ? sanctionCore.toPublicNotice(st) : null,
          });
        }),
        reports: mappedRows,
        appeals: appeals,
        activeSanctions: activeSanctions,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.code ? e.code : 'ADMIN_REPORT_LIST_FAILED' });
    }
  });

  adminRouter.post('/behaviors/review', async (req, res) => {
    try {
      const board = getBoardService && getBoardService(req);
      if (!board || typeof board.reviewBehavior !== 'function') {
        return res.status(503).json({ ok: false, error: 'BOARD_REPORT_REVIEW_UNAVAILABLE' });
      }
      const body = req.body || {};
      const result = await board.reviewBehavior(
        { userId: adminActorUserId(req) || 'admin' },
        body.behaviorKey,
        {
          status: body.status,
          resolutionNote: body.resolutionNote,
          operatorSanction: body.operatorSanction || body.operatorAction || 'AUTO',
          severeCode: body.severeCode || null,
          massHarm: !!body.massHarm,
          misinfoDecision: body.misinfoDecision || null,
          electionRelated: !!body.electionRelated,
          agencyNote: body.agencyNote || null,
        },
      );
      return res.json({ ok: true, result: result });
    } catch (e) {
      const code = e && e.code ? e.code : 'ADMIN_BEHAVIOR_REVIEW_FAILED';
      const status = code === 'BOARD_BEHAVIOR_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ ok: false, error: code });
    }
  });

  adminRouter.post('/reports/:id/action', async (req, res) => {
    try {
      const board = getBoardService && getBoardService(req);
      if (!board || typeof board.getReport !== 'function') {
        return res.status(503).json({ ok: false, error: 'BOARD_REPORT_GET_UNAVAILABLE' });
      }
      const report = await board.getReport({ userId: 'admin' }, req.params.id);
      if (!report) return res.status(404).json({ ok: false, error: 'BOARD_REPORT_NOT_FOUND' });
      const action = String((req.body && req.body.action) || '').toUpperCase();
      if (action === reportCore.ADMIN_ACTION.NONE || action === reportCore.ADMIN_ACTION.NORMAL) {
        const status = action === reportCore.ADMIN_ACTION.NONE ? 'REJECTED' : 'ACCEPTED';
        if (typeof board.reviewBehavior === 'function') {
          const packed = await board.reviewBehavior(
            { userId: adminActorUserId(req) || 'admin' },
            reviewCore.behaviorKeyFromReport(report),
            { status: status, resolutionNote: action },
          );
          return res.json({ ok: true, action: action, autoTransfer: false, result: packed });
        }
        if (typeof board.reviewReport === 'function') {
          await board.reviewReport(
            { userId: adminActorUserId(req) || 'admin' },
            report.id,
            { status: status, resolutionNote: action },
          );
        }
        return res.json({ ok: true, action: action, autoTransfer: false });
      }
      if (requireActivated(res)) return;
      const result = await service.applyAdminReportAction(report, action, adminActorUserId(req) || 'admin');
      if (!result.ok) return res.status(400).json(result);
      if (typeof board.reviewBehavior === 'function') {
        await board.reviewBehavior(
          { userId: adminActorUserId(req) || 'admin' },
          reviewCore.behaviorKeyFromReport(report),
          { status: 'ACCEPTED', resolutionNote: reportCore.TRANSFER_REASON.ADMIN_IMMEDIATE_ALIEN },
        );
      } else if (typeof board.reviewReport === 'function') {
        await board.reviewReport(
          { userId: adminActorUserId(req) || 'admin' },
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

  adminRouter.post('/appeals/:id', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await sanctionService.resolveAppeal({
        appealId: req.params.id,
        decision: body.decision,
        operatorReply: body.operatorReply,
        operatorUserId: adminActorUserId(req),
      });
      return res.json({ ok: true, appeal: result.appeal });
    } catch (e) {
      const code = e && e.code ? e.code : 'ADMIN_APPEAL_FAILED';
      return res.status(e && e.status ? e.status : 400).json({ ok: false, error: code });
    }
  });

  adminRouter.post('/users/:userId/sanction', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await sanctionService.applyOperatorDirect({
        userId: req.params.userId,
        action: body.action || body.operatorSanction,
        operatorUserId: adminActorUserId(req),
        reasonCode: body.reasonCode || null,
      });
      return res.json({ ok: true, result: result });
    } catch (e) {
      const code = e && e.code ? e.code : 'ADMIN_SANCTION_FAILED';
      return res.status(e && e.status ? e.status : 400).json({ ok: false, error: code });
    }
  });

  adminRouter.post('/misinfo-abuse', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await misinfoAbuse.applyAction(body.reporterUserId, body.action, body.note);
      return res.json(result);
    } catch (e) {
      const code = e && e.code ? e.code : 'MISINFO_ABUSE_FAILED';
      return res.status(e && e.status ? e.status : 400).json({ ok: false, error: code });
    }
  });

  adminRouter.post('/misinfo-appeals/:userId', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await misinfoAbuse.decideAppeal(req.params.userId, body.decision, body.operatorReply);
      return res.json(result);
    } catch (e) {
      const code = e && e.code ? e.code : 'MISINFO_APPEAL_FAILED';
      return res.status(e && e.status ? e.status : 400).json({ ok: false, error: code });
    }
  });

  return adminRouter;
}

module.exports = router;
module.exports.mountAdminRoutes = mountAdminRoutes;
