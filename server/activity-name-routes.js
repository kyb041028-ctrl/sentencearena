'use strict';

const express = require('express');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const ActivityNameCore = require('../shared/activity-name-core');
const { createFirstVisitGuideService } = require('./first-visit-guide-service');

function createActivityNameRouter() {
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

  async function findConflictingProfile(supabase, value, excludeUserId) {
    const needle = String(value || '');
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .ilike('display_name', needle)
      .limit(20);
    if (error) {
      return { error: error };
    }
    const rows = Array.isArray(data) ? data : [];
    const hit = rows.find(function (row) {
      if (!row || !row.display_name) return false;
      if (String(row.display_name).toLowerCase() !== needle.toLowerCase()) return false;
      if (excludeUserId && String(row.id) === String(excludeUserId)) return false;
      return true;
    });
    return { hit: hit || null };
  }

  /**
   * GET /api/profile/display-name/availability?value=
   */
  router.get('/profile/display-name/availability', async function (req, res) {
    try {
      const auth = await requireUser(req, res);
      if (!auth) return;

      const raw = req.query && req.query.value != null ? req.query.value : '';
      const validated = ActivityNameCore.validateActivityName(raw);
      if (!validated.ok) {
        return res.json({
          ok: true,
          available: false,
          reason: validated.error,
          message: validated.message,
        });
      }

      const conflict = await findConflictingProfile(auth.supabase, validated.value, auth.user.id);
      if (conflict.error) {
        return res
          .status(400)
          .json({ ok: false, error: conflict.error.code || 'AVAILABILITY_QUERY_FAILED' });
      }
      if (conflict.hit) {
        return res.json({
          ok: true,
          available: false,
          reason: 'duplicate',
          message: ActivityNameCore.MESSAGES[ActivityNameCore.ERRORS.DUPLICATE],
        });
      }
      return res.json({
        ok: true,
        available: true,
        message: '사용 가능한 활동명입니다.',
      });
    } catch (e) {
      console.error('[activity-name availability]', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  /**
   * PUT /api/profile/me/display-name
   * body: { displayName } — cookie session user only (client user id ignored)
   */
  router.put('/profile/me/display-name', async function (req, res) {
    try {
      const auth = await requireUser(req, res);
      if (!auth) return;

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      // Ignore any client-supplied user id / target id — identity comes from cookie only.
      const raw = body.displayName != null ? body.displayName : body.display_name;
      const validated = ActivityNameCore.validateActivityName(raw);
      if (!validated.ok) {
        return res.status(400).json({
          ok: false,
          error: validated.error,
          message: validated.message,
        });
      }

      const uid = auth.user.id;
      const conflict = await findConflictingProfile(auth.supabase, validated.value, uid);
      if (conflict.error) {
        return res
          .status(400)
          .json({ ok: false, error: conflict.error.code || 'AVAILABILITY_QUERY_FAILED' });
      }
      if (conflict.hit) {
        return res.status(409).json({
          ok: false,
          error: ActivityNameCore.ERRORS.DUPLICATE,
          message: ActivityNameCore.MESSAGES[ActivityNameCore.ERRORS.DUPLICATE],
        });
      }

      const { data: existing, error: readErr } = await auth.supabase
        .from('profiles')
        .select('id, display_name')
        .eq('id', uid)
        .maybeSingle();
      if (readErr) {
        return res
          .status(400)
          .json({ ok: false, error: readErr.code || 'PROFILE_QUERY_FAILED', message: readErr.message });
      }

      let profile;
      if (!existing) {
        const inserted = await auth.supabase
          .from('profiles')
          .insert({
            id: uid,
            display_name: validated.value,
            home_country: 'KR',
            citizenship_status: 'CITIZEN',
          })
          .select('*')
          .single();
        if (inserted.error) {
          if (inserted.error.code === '23505') {
            return res.status(409).json({
              ok: false,
              error: ActivityNameCore.ERRORS.DUPLICATE,
              message: ActivityNameCore.MESSAGES[ActivityNameCore.ERRORS.DUPLICATE],
            });
          }
          return res.status(400).json({
            ok: false,
            error: inserted.error.code || 'PROFILE_INSERT_FAILED',
            message: inserted.error.message,
          });
        }
        profile = inserted.data;
      } else {
        const updated = await auth.supabase
          .from('profiles')
          .update({ display_name: validated.value, updated_at: new Date().toISOString() })
          .eq('id', uid)
          .select('*')
          .single();
        if (updated.error) {
          if (updated.error.code === '23505') {
            return res.status(409).json({
              ok: false,
              error: ActivityNameCore.ERRORS.DUPLICATE,
              message: ActivityNameCore.MESSAGES[ActivityNameCore.ERRORS.DUPLICATE],
            });
          }
          return res.status(400).json({
            ok: false,
            error: updated.error.code || 'PROFILE_UPDATE_FAILED',
            message: updated.error.message,
          });
        }
        profile = updated.data;
      }

      const wasIncomplete = !existing || !ActivityNameCore.isCompleteActivityName(existing.display_name);
      if (wasIncomplete) {
        try {
          const firstVisit = createFirstVisitGuideService();
          await firstVisit.markEligible(uid);
        } catch (_) {}
      }

      return res.json({
        ok: true,
        profile: profile,
        displayName: validated.value,
        userId: uid,
      });
    } catch (e) {
      console.error('[activity-name set]', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  return router;
}

module.exports = {
  createActivityNameRouter: createActivityNameRouter,
};
