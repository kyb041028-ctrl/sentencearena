'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');
const { summarizeAdminOps } = require('./admin-ops-stats-service');

function mountAdminOpsStatsRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const guard = opts.adminBypass === true
    ? function (_req, _res, next) { next(); }
    : createAdminAccessGuard(opts.adminAuth || {});
  router.use(guard);

  router.get('/', async function (req, res) {
    try {
      const q = req.query || {};
      const preset = q.from || q.to ? 'custom' : String(q.preset || 'today');
      const body = await summarizeAdminOps({
        now: opts.now,
        preset: preset,
        from: q.from,
        to: q.to,
        query: opts.query || null,
        visitCollectionEnabled: opts.visitCollectionEnabled === true,
      });
      return res.json(body);
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      const code = e && e.code;
      if (code === 'RANGE_INVALID' || code === 'RANGE_TOO_LONG') {
        return res.status(400).json({
          ok: false,
          error: { code: code, message: code === 'RANGE_TOO_LONG' ? 'Range exceeds 90 days' : 'Range is invalid' },
        });
      }
      return res.status(500).json({ ok: false, error: { code: 'OPS_STATS_FAILED', message: 'Ops stats failed' } });
    }
  });

  return router;
}

module.exports = {
  mountAdminOpsStatsRoutes: mountAdminOpsStatsRoutes,
};
