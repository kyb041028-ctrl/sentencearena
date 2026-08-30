'use strict';

const express = require('express');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { createFirstVisitGuideService } = require('./first-visit-guide-service');

function createFirstVisitGuideRouter(options) {
  const opt = options || {};
  const router = express.Router();
  const authCfg = opt.authConfig || resolveSupabaseServerAuthConfig();
  const service = opt.service || createFirstVisitGuideService(opt);

  async function actor(req, res) {
    if (typeof opt.resolveActor === 'function') {
      const a = await opt.resolveActor(req, res);
      if (!a || !a.userId) return null;
      return a;
    }
    if (!authCfg.configured) return null;
    const auth = await requireAuthenticatedUser(req, res, {
      url: authCfg.url,
      key: authCfg.key,
    });
    if (!auth.ok) return { error: auth };
    return { userId: auth.user.id };
  }

  function fail(res, err) {
    const code = (err && err.code) || 'FIRST_VISIT_FAILED';
    const status = (err && err.status) || 500;
    return res.status(status).json({ ok: false, error: code });
  }

  router.get('/me/first-visit', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const firstVisit = await service.loadState(a.userId);
      return res.json({ ok: true, firstVisit: firstVisit });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/first-visit/complete', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const saved = await service.markGuideCompleted(a.userId);
      const firstVisit = await service.loadState(a.userId);
      return res.json({ ok: true, persisted: !!saved.persisted, firstVisit: firstVisit });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/first-visit/central-hint', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const saved = await service.markCentralHintSeen(a.userId);
      const firstVisit = await service.loadState(a.userId);
      return res.json({ ok: true, persisted: !!saved.persisted, firstVisit: firstVisit });
    } catch (e) {
      return fail(res, e);
    }
  });

  return router;
}

module.exports = {
  createFirstVisitGuideRouter: createFirstVisitGuideRouter,
};
