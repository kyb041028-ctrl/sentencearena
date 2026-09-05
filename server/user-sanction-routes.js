'use strict';

const express = require('express');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const sanctionService = require('./user-sanction-service');
const core = require('../shared/user-sanction-core');

function memberPublicAppeal(row) {
  if (!row) return row;
  return {
    sanctionType: row.sanctionType,
    body: row.body,
    status: row.status,
    operatorReply: row.operatorReply || null,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt || null,
  };
}

function createUserSanctionRouter(options) {
  const opt = options || {};
  const router = express.Router();
  const authCfg = opt.authConfig || resolveSupabaseServerAuthConfig();

  async function actor(req, res) {
    if (typeof opt.resolveActor === 'function') {
      const a = await opt.resolveActor(req, res);
      if (!a || !a.userId) return null;
      return a;
    }
    if (!authCfg.configured) {
      const header = req.headers['x-user-id'];
      if (header) return { userId: String(header) };
      return null;
    }
    const auth = await requireAuthenticatedUser(req, res, {
      url: authCfg.url,
      key: authCfg.key,
    });
    if (!auth.ok) return { error: auth };
    return { userId: auth.user.id };
  }

  function fail(res, err) {
    const code = (err && err.code) || 'SANCTION_FAILED';
    const status = (err && err.status) || 500;
    return res.status(status).json({ ok: false, error: code });
  }

  router.get('/me/sanction', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const notice = await sanctionService.getPublicNotice(a.userId);
      const publicNotice = core.stripPolitical(notice || {});
      delete publicNotice.operatorMemo;
      return res.json({ ok: true, sanction: publicNotice });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.post('/me/sanctions/appeals', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const result = await sanctionService.submitAppeal({
        userId: a.userId,
        body: req.body && req.body.body,
      });
      return res.status(201).json({ ok: true, appeal: memberPublicAppeal(result && result.appeal) });
    } catch (e) {
      return fail(res, e);
    }
  });

  router.get('/me/sanctions/appeals', async function (req, res) {
    try {
      const a = await actor(req, res);
      if (a && a.error) return res.status(a.error.status).json({ ok: false, error: a.error.error });
      if (!a || !a.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
      const list = await sanctionService.listAppeals(a.userId);
      return res.json({ ok: true, appeals: (list || []).map(memberPublicAppeal) });
    } catch (e) {
      return fail(res, e);
    }
  });

  return router;
}

module.exports = {
  createUserSanctionRouter,
};
