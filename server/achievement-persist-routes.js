'use strict';

/**
 * 실회원 업적 영구 저장 API
 * - GET  /api/users/me/achievements
 * - PUT  /api/users/me/featured-achievements
 * - POST /api/users/me/achievements/notified
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
const { localAuthEnabled, createLocalSessionVerifier } = require('./local-test-session');

async function regionAchievementBundle(query, userId, region) {
  try {
    const inviteAchievements = require('./invite-achievement-service');
    await inviteAchievements.repairReferral(query, userId, region);
    await inviteAchievements.evaluatePiper(query, userId, region);
  } catch (_) {}
  let rows;
  try {
    const out = await query(
      'SELECT achievement_key, acquired_at, acquisition_sequence, acquisition_notified_at, featured_slot, stage ' +
        'FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = $2 ' +
        'ORDER BY acquisition_sequence NULLS LAST, achievement_key',
      [userId, region]
    );
    rows = out.rows;
  } catch (err) {
    if (!err || err.code !== '42703') throw err;
    const out = await query(
      'SELECT achievement_key, acquired_at FROM public.user_activity_region_achievement ' +
        'WHERE user_id = $1 AND activity_region = $2 ORDER BY achievement_key',
      [userId, region]
    );
    rows = out.rows.map(function (row, index) {
      row.acquisition_sequence = index + 1;
      row.featured_slot = null;
      row.acquisition_notified_at = null;
      return row;
    });
  }
  const inviteAchievements = require('./invite-achievement-service');
  const currentAchievements = rows.map(function (row) {
    const mapped = persist.mapAchievementRow(row);
    if (mapped && row.achievement_key === inviteAchievements.PIPER_KEY && row.stage) {
      mapped.stage = Number(row.stage);
      mapped.rarity = inviteAchievements.rarityForStage(mapped.stage);
      mapped.activityRegion = region;
      mapped.contentRegion = region;
      mapped.grantStore = 'user_activity_region_achievement';
      mapped.scenePlay = mapped.acquisitionNotifiedAt == null && mapped.stage >= 1;
    }
    if (mapped && (row.achievement_key === inviteAchievements.INVITER_KEY || row.achievement_key === inviteAchievements.JOINER_KEY)) {
      mapped.activityRegion = region;
      mapped.contentRegion = region;
      mapped.grantStore = 'user_activity_region_achievement';
      mapped.scenePlay = mapped.acquisitionNotifiedAt == null;
    }
    return mapped;
  }).filter(function (row) {
    return row && row.achievementId;
  });
  const featuredAchievementIds = rows
    .filter(function (row) { return row.featured_slot != null; })
    .sort(function (a, b) { return Number(a.featured_slot) - Number(b.featured_slot); })
    .map(function (row) { return row.achievement_key; });
  return {
    userId: String(userId),
    currentAchievements: currentAchievements,
    featuredAchievementIds: featuredAchievementIds.length
      ? featuredAchievementIds.slice(0, 3)
      : currentAchievements.map(function (row) { return row.achievementId; }).slice(0, 3),
    seasonHistory: [],
  };
}

function createAchievementPersistRouter() {
  const router = express.Router();
  const authCfg = resolveSupabaseServerAuthConfig();
  const regionQuery = localAuthEnabled()
    ? require('./activity-region-http-storage').regionQueryFromEnv()
    : null;
  const localVerify = regionQuery ? createLocalSessionVerifier(regionQuery) : null;

  async function requireUser(req, res) {
    if (localVerify) {
      const localUser = await localVerify(req);
      if (localUser && localUser.userId) {
        return { ok: true, user: { id: localUser.userId }, local: true };
      }
    }
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
      const region = require('./achievement-request-region').requestRegion(req) === 'US' ? 'US' : 'KR';
      const data = auth.local && regionQuery
        ? await regionAchievementBundle(regionQuery, auth.user.id, region)
        : (region === 'US'
          ? await require('./us-achievement-service').createUsAchievementService().bundle(auth.user.id)
          : await persist.getMyAchievementBundle(auth.user.id));
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
      const result = require('./achievement-request-region').requestRegion(req) === 'US'
        ? await require('./us-achievement-service').createUsAchievementService().featured(auth.user.id, keys)
        : await persist.setFeaturedAchievementsForUser(auth.supabase, auth.user.id, keys);
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

  /**
   * POST /users/me/achievements/notified
   * body: { achievementId, acquisitionSequence }
   * Marks centered-alert display complete. Does not grant or mutate acquired_at/sequence.
   */
  router.post('/users/me/achievements/notified', async function (req, res) {
    try {
      const auth = await requireUser(req, res);
      if (!auth) return;
      const input = {
        achievementId: req.body && req.body.achievementId,
        acquisitionSequence: req.body && req.body.acquisitionSequence,
      };
      if (auth.local && regionQuery) {
        const region = require('./achievement-request-region').requestRegion(req) === 'US' ? 'US' : 'KR';
        const achievementId = String(input.achievementId || '').trim();
        const sequence = Number(input.acquisitionSequence);
        if (!achievementId || !sequence || Math.floor(sequence) !== sequence) {
          return res.status(400).json({ ok: false, error: 'INVALID_RECORD' });
        }
        const updated = await regionQuery(
          'UPDATE public.user_activity_region_achievement ' +
            'SET acquisition_notified_at = COALESCE(acquisition_notified_at, now()) ' +
            'WHERE user_id = $1 AND activity_region = $2 AND achievement_key = $3 ' +
            'AND acquisition_sequence = $4 ' +
            'RETURNING achievement_key, acquisition_sequence, acquired_at, acquisition_notified_at',
          [auth.user.id, region, achievementId, sequence]
        );
        const row = updated.rows[0];
        if (!row) return res.status(404).json({ ok: false, error: 'ACHIEVEMENT_NOT_FOUND' });
        return res.json({
          ok: true,
          status: 'NOTIFIED',
          achievementId: row.achievement_key,
          acquisitionSequence: Number(row.acquisition_sequence),
          acquisitionNotifiedAt: row.acquisition_notified_at,
          acquiredAt: row.acquired_at,
        });
      }
      const result = require('./achievement-request-region').requestRegion(req) === 'US'
        ? await require('./us-achievement-service').createUsAchievementService().notified(auth.user.id, input)
        : await persist.markAchievementNotifiedForUser(auth.supabase, auth.user.id, input);
      return res.json({
        ok: true,
        status: result.status,
        achievementId: result.achievementId,
        acquisitionSequence: result.acquisitionSequence,
        acquisitionNotifiedAt: result.acquisitionNotifiedAt,
        acquiredAt: result.acquiredAt,
      });
    } catch (e) {
      console.error('[achievement-persist notified]', e && e.message ? e.message : e);
      return sendErr(res, e);
    }
  });

  return router;
}

module.exports = { createAchievementPersistRouter };
