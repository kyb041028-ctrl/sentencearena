'use strict';

const express = require('express');
const service = require('./alien-observation-service');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');

const router = express.Router();

function notActivated(res) {
  return res.status(503).json({
    ok: false,
    error: 'ALIEN_SYSTEM_NOT_ACTIVATED',
    mode: service.getDataMode(),
  });
}

function extractBearer(req) {
  const h = req.headers.authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

async function resolveViewerUserId(req, res) {
  const token = extractBearer(req);
  const cfg = resolveSupabaseServerAuthConfig();
  if (token && cfg.configured) {
    const auth = await requireAuthenticatedUser(req, res, {
      url: cfg.url,
      key: cfg.key,
    });
    if (auth && auth.ok && auth.user && auth.user.id) return auth.user.id;
    return null;
  }
  const header = req.headers['x-user-id'];
  if (header) return String(header);
  return null;
}

function wrap(fn) {
  return async function (req, res) {
    if (!service.isActivated()) return notActivated(res);
    try {
      const userId = await resolveViewerUserId(req, res);
      if (!userId) {
        return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      }
      const data = await fn(req, res, userId);
      if (!res.headersSent) res.json({ ok: true, data });
    } catch (err) {
      const status = (err && err.status) || 400;
      const code = (err && err.code) || 'ALIEN_OBSERVATION_ERROR';
      const safe =
        code === 'OBSERVATION_FORBIDDEN'
        || code === 'ALIEN_OBSERVATION_STAGE_FORBIDDEN'
        || code === 'ALIEN_OBSERVATION_TERRITORY_FORBIDDEN'
        || code === 'OBSERVATION_READ_ONLY'
          ? code
          : code;
      res.status(status).json({ ok: false, error: safe });
    }
  };
}

router.get('/alien/observation/central', wrap(async (_req, _res, userId) => {
  return service.listCentralObservation(userId);
}));

router.get('/alien/observation/territories/:territory', wrap(async (req, _res, userId) => {
  return service.listTerritoryObservation(userId, req.params.territory);
}));

router.get('/alien/observation/posts/:postId', wrap(async (req, _res, userId) => {
  return service.getObservationPost(userId, req.params.postId, req.query.filter);
}));

router.get('/alien/observation/posts/:postId/comments', wrap(async (req, _res, userId) => {
  const obs = await service.getObservationPost(userId, req.params.postId, req.query.filter || 'ALL');
  return {
    earthComments: obs && obs.earthComments,
    alienComments: obs && obs.alienComments,
    readOnly: true,
  };
}));

router.post('/alien/observation/posts/:postId/comments', wrap(async () => {
  return service.createObservationComment();
}));

router.post('/alien/observation/reactions/toggle', wrap(async () => {
  return service.toggleObservationReaction();
}));

router.get('/alien/free-plaza/posts', wrap(async (_req, _res, userId) => {
  return service.listFreePlaza(userId);
}));

router.post('/alien/free-plaza/posts', wrap(async (_req, _res, userId) => {
  // Internal alien free plaza is out of scope for this wiring pass; keep write path gated.
  return service.createFreePlazaPost(userId, {});
}));

router.get('/alien/observation/health', async (_req, res) => {
  const health = await service.healthCheck();
  return res.json({ ok: true, data: health });
});

module.exports = router;
