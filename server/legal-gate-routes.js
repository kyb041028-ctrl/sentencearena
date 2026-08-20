'use strict';

const express = require('express');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { createLegalGateService } = require('./legal-gate-service');
const core = require('../shared/legal-gate-core');

function createLegalGateRouter(options) {
  const opt = options || {};
  const router = express.Router();
  const authCfg = opt.authConfig || resolveSupabaseServerAuthConfig();
  const service = opt.service || createLegalGateService(opt);

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
    const code = (err && err.code) || (err && err.error) || 'LEGAL_GATE_FAILED';
    const status = (err && err.status) || 500;
    return res.status(status).json({ ok: false, error: code });
  }

  router.get('/me/legal/status', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const status = await service.getStatus(a.userId);
      if (core.containsDob(status)) return fail(res, { code: 'LEGAL_GATE_DOB_LEAK', status: 500 });
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/legal/age-confirm', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const status = await service.confirmAge(a.userId, req.body || {});
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/legal/sensitive-consent', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const status = await service.consentSensitive(a.userId, req.body || {});
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.patch('/me/legal/political-visibility', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const vis = (req.body && req.body.politicalProfileVisibility) || (req.body && req.body.visibility);
      const status = await service.setVisibility(a.userId, vis);
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/legal/withdraw-sensitive-consent', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const status = await service.withdrawSensitiveConsent(a.userId);
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  return router;
}

module.exports = {
  createLegalGateRouter: createLegalGateRouter,
};
