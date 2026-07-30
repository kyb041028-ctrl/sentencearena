'use strict';

const express = require('express');
const service = require('./alien-observation-service');

const router = express.Router();

function notActivated(res) {
  return res.status(503).json({
    ok: false,
    error: 'ALIEN_SYSTEM_NOT_ACTIVATED',
    mode: service.getDataMode(),
  });
}

function wrap(fn) {
  return async function (req, res) {
    if (!service.isActivated()) return notActivated(res);
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.json({ ok: true, data });
    } catch (err) {
      const status = (err && err.status) || 400;
      res.status(status).json({ ok: false, error: (err && err.code) || 'ALIEN_OBSERVATION_ERROR' });
    }
  };
}

router.get('/alien/observation/central', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.get('/alien/observation/territories/:territory', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.get('/alien/observation/posts/:postId', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.get('/alien/observation/posts/:postId/comments', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.post('/alien/observation/posts/:postId/comments', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.post('/alien/observation/reactions/toggle', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.get('/alien/free-plaza/posts', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.post('/alien/free-plaza/posts', wrap(async () => {
  return { note: 'NOT_REACHABLE_WHILE_INACTIVE' };
}));

router.get('/alien/observation/health', async (_req, res) => {
  const health = await service.healthCheck();
  return res.json({ ok: true, data: health });
});

module.exports = router;
