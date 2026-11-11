'use strict';

const express = require('express');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { createLegalGateService } = require('./legal-gate-service');
const core = require('../shared/legal-gate-core');
const regionCore = require('../shared/activity-region-core');
const regionService = require('./activity-region-service');

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

  async function appliedRegion(req) {
    const rawCookie = String((req.headers && req.headers.cookie) || '');
    const stripped = {
      headers: Object.assign({}, req.headers || {}, {
        cookie: rawCookie
          .split(';')
          .filter(function (part) {
            const name = part.split('=')[0].trim();
            return name !== 'sa_ar' && name !== 'sa_ar_x';
          })
          .join(';'),
      }),
      ip: req.ip,
      socket: req.socket,
    };
    const server = await regionService.resolveFromRequestAsync(stripped, null);
    const full = await regionService.resolveFromRequestAsync(req, null);
    const explicit = full && full.source === 'explicit' ? full.region : null;
    return core.appliedAgeRegion(server && server.region, explicit);
  }

  function rejectRegionMismatch(body, applied) {
    const asked = body && (body.activityRegion || body.activity_region);
    if (asked == null || asked === '') return null;
    if (regionCore.normalizeRegion(asked) !== applied) return 'REGION_MISMATCH';
    return null;
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
      const applied = await appliedRegion(req);
      const mismatch = rejectRegionMismatch(req.body, applied);
      if (mismatch) return res.status(403).json({ ok: false, error: mismatch });
      const status = await service.confirmAge(a.userId, req.body || {}, { appliedRegion: applied });
      if (core.containsDob(status)) return fail(res, { code: 'LEGAL_GATE_DOB_LEAK', status: 500 });
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

  router.get('/me/legal/us-status', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const status = await service.getUsStatus(a.userId);
      if (core.containsDob(status)) return fail(res, { code: 'LEGAL_GATE_DOB_LEAK', status: 500 });
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/legal/us-signup-consent', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const applied = await appliedRegion(req);
      if (applied !== 'US') return res.status(403).json({ ok: false, error: 'REGION_MISMATCH' });
      const mismatch = rejectRegionMismatch(req.body, applied);
      if (mismatch) return res.status(403).json({ ok: false, error: mismatch });
      const status = await service.saveUsSignupConsent(a.userId, req.body || {});
      if (core.containsDob(status)) return fail(res, { code: 'LEGAL_GATE_DOB_LEAK', status: 500 });
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/legal/withdraw-us-sensitive-consent', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const status = await service.withdrawUsSensitiveConsent(a.userId);
      return res.json({ ok: true, legal: status });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/legal/withdraw-us-marketing', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const status = await service.withdrawUsMarketing(a.userId);
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
