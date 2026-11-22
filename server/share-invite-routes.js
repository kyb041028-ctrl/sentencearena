'use strict';

const express = require('express');
const store = require('./share-invite-store');
const { localAuthEnabled, createLocalSessionVerifier } = require('./local-test-session');

function createShareInviteRouter(options) {
  const query = options && options.query;
  const router = express.Router();
  const verify = typeof query === 'function' && localAuthEnabled()
    ? createLocalSessionVerifier(query)
    : null;

  async function member(req) {
    if (!verify) return null;
    const user = await verify(req);
    return user && user.userId ? user.userId : null;
  }

  function fail(res, err) {
    const code = (err && err.code) || 'SHARE_FAILED';
    const status = code === 'POST_UNAVAILABLE' || code === 'CODE_NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ ok: false, error: code });
  }

  router.post('/share-links', async function (req, res) {
    try {
      const userId = await member(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      const postId = String(req.body && req.body.postId || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(postId)) return res.status(400).json({ ok: false, error: 'POST_REQUIRED' });
      const link = await store.createShareLink(query, userId, postId);
      const host = req.get('host');
      return res.status(201).json({
        ok: true,
        url: req.protocol + '://' + host + link.path,
        path: link.path,
        region: link.region,
      });
    } catch (err) {
      return fail(res, err);
    }
  });

  router.post('/invite-links', async function (req, res) {
    try {
      const userId = await member(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      const region = req.body && req.body.region === 'US' ? 'US' : req.body && req.body.region === 'KR' ? 'KR' : null;
      if (!region) return res.status(400).json({ ok: false, error: 'COUNTRY_REQUIRED' });
      const link = await store.createInviteLink(query, userId, region);
      const host = req.get('host');
      return res.status(201).json({
        ok: true,
        url: req.protocol + '://' + host + link.path,
        path: link.path,
        region: link.region,
        nickname: link.nickname,
      });
    } catch (err) {
      return fail(res, err);
    }
  });

  router.get('/public/posts/:postId', async function (req, res) {
    try {
      const region = req.query.region === 'US' ? 'US' : req.query.region === 'KR' ? 'KR' : null;
      if (!region) return res.status(400).json({ ok: false, error: 'COUNTRY_REQUIRED' });
      const result = await store.readShare(
        query,
        region,
        req.params.postId,
        store.safeCode(req.query.s),
        req.get('user-agent')
      );
      return res.status(result.ok ? 200 : result.error === 'POST_UNAVAILABLE' || result.error === 'CODE_NOT_FOUND' ? 404 : 409).json(result);
    } catch (err) {
      return fail(res, err);
    }
  });

  router.get('/public/invites/:code', async function (req, res) {
    try {
      const region = req.query.region === 'US' ? 'US' : req.query.region === 'KR' ? 'KR' : null;
      if (!region) return res.status(400).json({ ok: false, error: 'COUNTRY_REQUIRED' });
      const result = await store.readInvite(query, region, req.params.code, req.get('user-agent'));
      return res.status(result.ok ? 200 : 404).json(result);
    } catch (err) {
      return fail(res, err);
    }
  });

  router.get('/invites/:code/follow-target', async function (req, res) {
    try {
      const userId = await member(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      const region = req.query.region === 'US' ? 'US' : req.query.region === 'KR' ? 'KR' : null;
      if (!region) return res.status(400).json({ ok: false, error: 'COUNTRY_REQUIRED' });
      const target = await store.inviteFollowTarget(query, req.params.code, region);
      if (!target) return res.status(404).json({ ok: false, error: 'CODE_NOT_FOUND' });
      return res.json({ ok: true, target: target });
    } catch (err) {
      return fail(res, err);
    }
  });

  router.get('/public/participation', async function (req, res) {
    try {
      const userId = await member(req);
      const region = req.query.region === 'US' ? 'US' : 'KR';
      if (!userId || region !== 'US') return res.json({ ok: true, write: true });
      const block = await store.usParticipationBlock(query, userId);
      return res.json({ ok: true, write: !block, reason: block });
    } catch (err) {
      return fail(res, err);
    }
  });

  return router;
}

module.exports = { createShareInviteRouter: createShareInviteRouter };
