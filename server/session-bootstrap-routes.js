'use strict';

const express = require('express');
const { resolveSupabaseServerAuthConfig } = require('./supabase-server-auth-config');
const { requireAuthenticatedUser } = require('./auth/require-authenticated-user');
const ActivityNameCore = require('../shared/activity-name-core');
const SessionBootstrapCore = require('../shared/session-bootstrap-core');

/**
 * GET /api/session/bootstrap
 * Provider-agnostic member entry decision (Google/Kakao/Naver identical).
 * Always HTTP 200 for logical states; ERROR uses ok:false.
 */
function createSessionBootstrapRouter() {
  const router = express.Router();
  const authCfg = resolveSupabaseServerAuthConfig();

  router.get('/session/bootstrap', async function (req, res) {
    try {
      if (!authCfg.configured) {
        return res.status(200).json({
          ok: false,
          state: SessionBootstrapCore.STATES.ERROR,
          error: 'SUPABASE_NOT_CONFIGURED',
          user: null,
          profile: null,
        });
      }

      const auth = await requireAuthenticatedUser(req, res, {
        url: authCfg.url,
        key: authCfg.key,
      });

      if (!auth.ok) {
        // 401/unauthorized → logical UNAUTHENTICATED (not ERROR)
        if (auth.status === 401 || auth.error === 'UNAUTHORIZED') {
          return res.status(200).json({
            ok: true,
            state: SessionBootstrapCore.STATES.UNAUTHENTICATED,
            user: null,
            profile: null,
          });
        }
        return res.status(200).json({
          ok: false,
          state: SessionBootstrapCore.STATES.ERROR,
          error: auth.error || 'AUTH_FAILED',
          user: null,
          profile: null,
        });
      }

      const publicUser = SessionBootstrapCore.publicUserFromAuth(auth.user);
      const { data: profile, error: pErr } = await auth.supabase
        .from('profiles')
        .select('*')
        .eq('id', auth.user.id)
        .maybeSingle();

      if (pErr) {
        return res.status(200).json({
          ok: false,
          state: SessionBootstrapCore.STATES.ERROR,
          error: pErr.code || 'PROFILE_QUERY_FAILED',
          message: pErr.message || null,
          user: publicUser,
          profile: null,
        });
      }

      const resolved = SessionBootstrapCore.resolveSessionState(
        {
          authenticated: true,
          user: publicUser,
          profile: profile || { id: auth.user.id, display_name: '' },
        },
        ActivityNameCore,
      );

      return res.status(200).json({
        ok: true,
        state: resolved.state,
        user: resolved.user,
        profile: resolved.profile,
      });
    } catch (e) {
      console.error('[session-bootstrap]', e && e.message ? e.message : e);
      return res.status(200).json({
        ok: false,
        state: SessionBootstrapCore.STATES.ERROR,
        error: 'SERVER_ERROR',
        user: null,
        profile: null,
      });
    }
  });

  return router;
}

module.exports = {
  createSessionBootstrapRouter: createSessionBootstrapRouter,
};
