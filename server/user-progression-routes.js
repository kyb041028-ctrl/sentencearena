'use strict';

/**
 * GET /api/users/me/progression — canonical LEVEL + EXP for ProfileFrame
 * Ensure-on-read · client write of level/xp 금지
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const progression = require('./user-progression-service');

function getBearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

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

  router.get('/users/me/progression', async function (req, res) {
    try {
      const token = getBearer(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      }
      const url = process.env.SUPABASE_URL;
      const anon = process.env.SUPABASE_ANON_KEY;
      if (!url || !anon) {
        return res.status(503).json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
      }
      const supabase = createClient(url, anon, {
        global: { headers: { Authorization: 'Bearer ' + token } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData || !userData.user) {
        return res.status(401).json({ ok: false, error: 'AUTH_INVALID' });
      }

      const result = await progression.ensureAndGetProgression(userData.user.id);
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

  return router;
}

module.exports = { createUserProgressionRouter };
