'use strict';

const express = require('express');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { createAccountWithdrawalService } = require('./account-withdrawal-service');

function createAccountWithdrawalRouter(options) {
  const opt = options || {};
  const router = express.Router();
  const authCfg = opt.authConfig || resolveSupabaseServerAuthConfig();
  const service = opt.service || createAccountWithdrawalService(opt);

  router.post('/me/withdraw', async function (req, res) {
    try {
      if (!authCfg.configured && !opt.resolveActor) {
        return res.status(503).json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
      }
      let userId = null;
      if (typeof opt.resolveActor === 'function') {
        const actor = await opt.resolveActor(req, res);
        if (!actor || !actor.userId) {
          return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
        }
        userId = actor.userId;
      } else {
        const auth = await requireAuthenticatedUser(req, res, {
          url: authCfg.url,
          key: authCfg.key,
        });
        if (!auth.ok) {
          return res.status(auth.status).json({ ok: false, error: auth.error });
        }
        userId = auth.user.id;
      }

      const result = await service.withdraw({
        userId: userId,
        body: req.body || {},
      });
      return res.json({ ok: true, data: result });
    } catch (err) {
      const code = (err && err.code) || 'WITHDRAW_FAILED';
      const status = (err && err.status) || 500;
      return res.status(status).json({ ok: false, error: code });
    }
  });

  return router;
}

module.exports = {
  createAccountWithdrawalRouter,
};
