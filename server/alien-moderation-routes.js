'use strict';

const express = require('express');
const service = require('./alien-moderation-service');

const router = express.Router();

router.get('/alien/moderation/status', async (req, res) => {
  if (!service.isActivated()) {
    return res.status(503).json({
      ok: false,
      error: 'ALIEN_SYSTEM_NOT_ACTIVATED',
      mode: service.getDataMode(),
    });
  }
  return res.status(503).json({ ok: false, error: 'ALIEN_SYSTEM_NOT_ACTIVATED' });
});

router.get('/alien/moderation/health', async (_req, res) => {
  const health = await service.healthCheck();
  return res.json({ ok: true, data: health, note: 'READ_ONLY_INSPECT' });
});

module.exports = router;
