'use strict';

/**
 * 실회원 업적 영구 저장 API
 * - GET  /api/users/me/achievements
 * - PUT  /api/users/me/featured-achievements
 *
 * POST .../achievements/grant 는 공개하지 않음 (browser self-grant 금지).
 * 지급은 향후 서버 evaluator → grant service 내부 경로만 사용.
 *
 * 기존 USER_DATA_OPERATIONAL 게이트와 독립. 동일 테이블/RPC 재사용.
 * identity = JWT auth.users.id only.
 */

const express = require('express');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const persist = require('./achievement-persist-service');

function createAchievementPersistRouter() {
  const router = express.Router();
  const authCfg = resolveSupabaseServerAuthConfig();

  async function requireUser(req, res) {
    if (!authCfg.configured) {
      res.status(503).json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
      return null;
    }
    const auth = await requireAuthenticatedUser(req, res, {
      url: authCfg.url,
      key: authCfg.key,
    });
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return null;
    }
    return auth;
  }

  function sendErr(res, err) {
    const code = (err && err.code) || 'ACHIEVEMENT_PERSIST_ERROR';
    const status = (err && err.status) || 500;
    const body = { ok: false, error: code };
    if (err && err.key) body.key = err.key;
    return res.status(status).json(body);
  }

  /** GET /users/me/achievements — self only */
  router.get('/users/me/achievements', async function (req, res) {
    try {
      const auth = await requireUser(req, res);
      if (!auth) return;
      const data = await persist.getMyAchievementBundle(auth.user.id);
      return res.json({ ok: true, data: data });
    } catch (e) {
      console.error('[achievement-persist get]', e && e.message ? e.message : e);
      return sendErr(res, e);
    }
  });

  /**
   * Browser self-grant 금지.
   * 공개 POST grant 제거 — user-data 쪽 NOT_FOUND 와 동일하게 404.
   * 서버 내부: achievement-persist-service.grantAchievementForUser / RPC 유지.
   */
  router.post('/users/me/achievements/grant', function (req, res) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  });

  /**
   * PUT /users/me/featured-achievements
   * body: { keys: string[] } — max 3, must be owned
   */
  router.put('/users/me/featured-achievements', async function (req, res) {
    try {
      const auth = await requireUser(req, res);
      if (!auth) return;
      const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys : [];
      const result = await persist.setFeaturedAchievementsForUser(auth.supabase, auth.user.id, keys);
      return res.json({
        ok: true,
        status: result.status,
        featuredAchievementIds: result.featuredAchievementIds,
        data: result.bundle,
      });
    } catch (e) {
      console.error('[achievement-persist featured]', e && e.message ? e.message : e);
      return sendErr(res, e);
    }
  });

  return router;
}

module.exports = { createAchievementPersistRouter };
