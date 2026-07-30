'use strict';
/**
 * 영토 발전 Express routes
 * 기본: TERRITORY_EVOLUTION_OPERATIONAL 미활성 → 503 또는 LEGACY 안내
 */

const express = require('express');
const core = require('../shared/territory-evolution-core');
const service = require('./territory-evolution-service');

const router = express.Router();

function sendError(res, err) {
  const code = (err && err.code) || 'TERRITORY_EVOLUTION_ERROR';
  const status = (err && err.status) || 400;
  return res.status(status).json({ ok: false, error: code });
}

function wrap(fn) {
  return async function (req, res) {
    if (!service.isActivated()) {
      return res.status(503).json({
        ok: false,
        error: 'TERRITORY_EVOLUTION_NOT_ACTIVATED',
        mode: service.getDataMode(),
      });
    }
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.json({ ok: true, data: data });
    } catch (err) {
      sendError(res, err);
    }
  };
}

router.get('/territories/evolution', wrap(async () => {
  return service.getAllTerritoryEvolutions();
}));

router.get('/territories/:territory/evolution', wrap(async (req) => {
  const check = core.assertOperationalTerritoryStrict(req.params.territory);
  if (!check.valid) {
    const err = new Error(check.error);
    err.code = check.error;
    err.status = 400;
    throw err;
  }
  return service.getTerritoryEvolution(check.territory);
}));

router.get('/territories/population/status', wrap(async () => {
  return service.healthCheck();
}));

module.exports = router;
