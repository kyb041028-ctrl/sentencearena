'use strict';

/**
 * GET /api/users/me/progression — canonical LEVEL + EXP for ProfileFrame
 * Ensure-on-read · client write of level/xp 금지
 *
 * GET /api/users/:userId/level — 타인 공개 Level 최소 읽기 (level only)
 */

const express = require('express');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const progression = require('./user-progression-service');

function sendErr(res, err) {
  const status = err && err.status ? err.status : 500;
  return res.status(status).json({
    ok: false,
    error: (err && err.code) || 'PROGRESSION_ERROR',
    detail: err && err.detail ? err.detail : undefined,
  });
}

function createUserProgressionRouter() {
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

  router.get('/users/me/progression', async function (req, res) {
    try {
      const auth = await requireUser(req, res);
      if (!auth) return;

      const result = await progression.ensureAndGetProgression(auth.user.id);
      return res.json({
        ok: true,
        level: result.level,
        xp: result.xp,
        expPercent: result.expPercent,
        fame: result.fame,
        created: result.created,
        source: 'user_progression',
      });
    } catch (e) {
      console.error('[user-progression]', e && e.message ? e.message : e);
      return sendErr(res, e);
    }
  });

  router.get('/users/:userId/level', async function (req, res) {
    try {
      const auth = await requireUser(req, res);
      if (!auth) return;

      const userId = String((req.params && req.params.userId) || '').trim();
      if (!progression.UUID_RE.test(userId)) {
        return res.status(400).json({ ok: false, error: 'INVALID_USER_ID' });
      }

      const levels = await progression.loadPublicLevelsByUserIds([userId]);
      const level = Object.prototype.hasOwnProperty.call(levels, userId) ? levels[userId] : null;
      return res.json({
        ok: true,
        userId: userId,
        level: level,
      });
    } catch (e) {
      if (e && (e.code === 'ACHIEVEMENT_PERSIST_NOT_CONFIGURED' || e.status === 503)) {
        return res.status(503).json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
      }
      console.error('[user-progression public-level]', e && e.message ? e.message : e);
      return sendErr(res, e);
    }
  });

  return router;
}

module.exports = { createUserProgressionRouter };
