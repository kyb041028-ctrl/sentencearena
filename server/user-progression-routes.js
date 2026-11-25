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

  function pageRegion(req) {
    const query = String(req.query && req.query.activity_region || '').trim().toUpperCase();
    if (query === 'KR' || query === 'US') return query;
    const header = String(req.headers && req.headers.cookie || '');
    const jar = {};
    header.split(';').forEach(function (part) {
      const i = part.indexOf('=');
      if (i < 1) return;
      jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    if (jar.sa_ar_x !== '1') return null;
    return jar.sa_ar === 'US' ? 'US' : jar.sa_ar === 'KR' ? 'KR' : null;
  }

  async function requireUser(req, res) {
    const local = await progression.verifyLocalSession(req);
    if (local && local.userId) return { user: { id: local.userId }, local: true };
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

      const region = pageRegion(req);
      const levels = await progression.loadPublicLevelsByUserIds([userId], null, region);
      const level = Object.prototype.hasOwnProperty.call(levels, userId) ? levels[userId] : null;
      const fameMap = levels.__fame || {};
      const displayName = typeof progression.loadPublicDisplayName === 'function'
        ? await progression.loadPublicDisplayName(userId)
        : null;
      return res.json({
        ok: true,
        userId: userId,
        activityRegion: region,
        level: level,
        fame: Object.prototype.hasOwnProperty.call(fameMap, userId) ? fameMap[userId] : null,
        displayName: displayName,
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
