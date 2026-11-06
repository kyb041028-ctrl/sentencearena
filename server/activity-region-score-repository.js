'use strict';

/**
 * 미국 활동 점수만 user_activity_region_profile에 저장한다.
 * user_progression, user_achievements, user_alignment_state, 성향 점수는 쓰지 않는다.
 */

const xpCore = require('../shared/progression-xp-core');
const rankCore = require('../shared/user-rank-core');
const evalCore = require('../shared/achievement-evaluation-core');
const frame = require('./us-profile-frame');

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function createActivityRegionScoreRepository(options) {
  const opts = options || {};
  if (typeof opts.query !== 'function') {
    throw fail('REGION_SCORE_QUERY_REQUIRED');
  }
  const query = opts.query;

  async function readProfile(userId, region) {
    const res = await query(
      'SELECT user_id, activity_region, level, xp, reputation_score, aura, tendency, evolution_contribution, territory ' +
        'FROM public.user_activity_region_profile WHERE user_id = $1 AND activity_region = $2',
      [userId, region]
    );
    const row = res.rows[0] || null;
    const ach = await query(
      'SELECT achievement_key FROM public.user_activity_region_achievement ' +
        'WHERE user_id = $1 AND activity_region = $2 ORDER BY achievement_key',
      [userId, region]
    );
    return {
      userId: userId,
      region: region,
      level: row ? Number(row.level) : 0,
      xp: row ? Number(row.xp) : 0,
      fame: row ? Number(row.reputation_score) : 0,
      aura: row ? Number(row.aura) : 0,
      tendency: row ? row.tendency : null,
      evolution: row ? Number(row.evolution_contribution) : 0,
      achievements: ach.rows.map(function (item) { return item.achievement_key; }),
      territory: row ? row.territory : null,
      stored: !!row,
    };
  }

  async function readProfileFrame(userId) {
    const profile = await readProfile(userId, 'US');
    let displayName = null;
    try {
      const named = await query(
        'SELECT display_name FROM public.profiles WHERE id = $1',
        [userId]
      );
      displayName = named.rows[0] ? named.rows[0].display_name : null;
    } catch (_) {
      displayName = null;
    }
    let activity = null;
    try {
      const posts = await query(
        "SELECT id FROM public.board_posts " +
          "WHERE author_user_id = $1 AND status = 'ACTIVE' " +
          "AND public.activity_region_norm(activity_region) = 'US'",
        [userId]
      );
      const comments = await query(
        "SELECT c.id, c.post_id FROM public.board_comments c " +
          "WHERE c.author_user_id = $1 AND c.status = 'ACTIVE' " +
          "AND public.activity_region_norm(c.activity_region) = 'US'",
        [userId]
      );
      const empathy = await query(
        "SELECT id, dedupe_key FROM public.user_activity_events " +
          "WHERE user_id = $1 AND activity_type = 'EMPATHY_RECEIVED' " +
          "AND public.activity_region_norm(activity_region) = 'US'",
        [userId]
      );
      activity = frame.countActivity(posts.rows, comments.rows, empathy.rows, userId);
    } catch (_) {
      activity = null;
    }
    const display = frame.displayFields({
      stored: profile.stored,
      xp: profile.xp,
      territory: profile.territory,
      displayName: displayName,
      achievements: profile.achievements,
      featured: null,
    });
    profile.displayName = display.displayName;
    profile.expPercent = display.expPercent;
    if (display.levelFromXp != null) profile.level = display.levelFromXp;
    profile.territory = display.territory;
    profile.territoryLabel = display.territoryLabel;
    profile.featuredAchievements = display.featuredAchievements;
    profile.activity = activity;
    return profile;
  }

  async function grantForEvent(userId, eventType, level) {
    const posts = await query(
      "SELECT count(*)::int AS n FROM public.board_posts " +
        "WHERE author_user_id = $1 AND status = 'ACTIVE' " +
        "AND public.activity_region_norm(activity_region) = 'US'",
      [userId]
    );
    const comments = await query(
      'SELECT count(*)::int AS n FROM public.board_comments c ' +
        'JOIN public.board_posts p ON p.id = c.post_id ' +
        'WHERE c.author_user_id = $1 AND c.status = \'ACTIVE\' ' +
        'AND p.author_user_id <> c.author_user_id ' +
        "AND public.activity_region_norm(c.activity_region) = 'US'",
      [userId]
    );
    const empathy = await query(
      "SELECT count(*)::int AS n FROM public.user_activity_events " +
        "WHERE user_id = $1 AND activity_type = 'EMPATHY_RECEIVED' " +
        "AND public.activity_region_norm(activity_region) = 'US'",
      [userId]
    );
    const ownedRows = await query(
      'SELECT achievement_key FROM public.user_activity_region_achievement ' +
        "WHERE user_id = $1 AND activity_region = 'US'",
      [userId]
    );
    const owned = ownedRows.rows.map(function (item) {
      return { achievementKey: item.achievement_key };
    });
    const stats = {
      validPostCount: posts.rows[0].n,
      validCommentOnOthersPostCount: comments.rows[0].n,
      validEmpathyReceivedCount: empathy.rows[0].n,
    };
    const granted = [];
    const defs = evalCore.getAchievementDefinitionsForEvent(eventType);
    let i;
    for (i = 0; i < defs.length; i++) {
      const def = defs[i];
      const result = evalCore.evaluateAchievementCondition(def, {
        ownedAchievements: owned,
        achievementStats: stats,
        userProgression: { level: level },
      });
      if (!result.eligible) continue;
      await query(
        'INSERT INTO public.user_activity_region_achievement ' +
          '(user_id, activity_region, achievement_key) VALUES ($1, \'US\', $2) ' +
          'ON CONFLICT DO NOTHING',
        [userId, def.achievementKey]
      );
      owned.push({ achievementKey: def.achievementKey });
      granted.push({ achievementKey: def.achievementKey, record: { achievementKey: def.achievementKey } });
    }
    return granted;
  }

  async function applyEvent(input) {
    const src = input || {};
    if (src.region !== 'US') throw fail('REGION_MISMATCH');
    const userId = String(src.userId || '').trim();
    const eventType = String(src.eventType || '').trim();
    const sourceId = String(src.sourceId || '').trim();
    if (!userId || !eventType || !sourceId) throw fail('REGION_SCORE_INPUT_INVALID');
    const dedupe = 'US:' + eventType + ':' + sourceId;
    const existing = await query(
      'SELECT id FROM public.user_activity_events WHERE dedupe_key = $1',
      [dedupe]
    );
    if (existing.rows.length) return readProfile(userId, 'US');

    const xpDelta = eventType === 'POST_CREATED'
      ? xpCore.xpRewardForEvent('POST_CREATED')
      : eventType === 'BOARD_COMMENT_CREATED'
        ? xpCore.xpRewardForEvent('BOARD_COMMENT_CREATED')
        : 0;
    const fameDelta = eventType === 'EMPATHY_RECEIVED'
      ? rankCore.fameRewardForEvent('EMPATHY_RECEIVED')
      : 0;

    await query(
      'INSERT INTO public.user_activity_region_profile (user_id, activity_region) ' +
        'VALUES ($1, \'US\') ON CONFLICT (user_id, activity_region) DO NOTHING',
      [userId]
    );
    const current = await query(
      'SELECT xp, reputation_score FROM public.user_activity_region_profile ' +
        "WHERE user_id = $1 AND activity_region = 'US'",
      [userId]
    );
    const xp = Number(current.rows[0].xp) + xpDelta;
    const fame = Number(current.rows[0].reputation_score) + fameDelta;
    const level = xpCore.calculateLevelFromXp(xp);
    await query(
      'UPDATE public.user_activity_region_profile ' +
        'SET xp = $2, reputation_score = $3, level = $4, updated_at = now() ' +
        "WHERE user_id = $1 AND activity_region = 'US'",
      [userId, xp, fame, level]
    );
    await query(
      'INSERT INTO public.user_activity_events ' +
        '(user_id, activity_type, payload, dedupe_key, activity_region) ' +
        'VALUES ($1, $2, $3::jsonb, $4, \'US\')',
      [userId, eventType, JSON.stringify({ sourceId: sourceId, xpDelta: xpDelta, fameDelta: fameDelta }), dedupe]
    );
    await query(
      'INSERT INTO public.user_notifications ' +
        '(user_id, notification_type, title, message, activity_region) ' +
        'VALUES ($1, $2, $3, $4, \'US\')',
      [userId, eventType, 'US activity', eventType]
    );
    const achievements = await grantForEvent(userId, eventType === 'BOARD_COMMENT_CREATED' ? 'COMMENT_CREATED' : eventType, level);
    const profile = await readProfile(userId, 'US');
    profile.achievementsGranted = achievements;
    profile.fameDelta = fameDelta;
    profile.xpDelta = xpDelta;
    return profile;
  }

  return {
    applyEvent: applyEvent,
    readProfile: readProfile,
    readProfileFrame: readProfileFrame,
  };
}

module.exports = {
  createActivityRegionScoreRepository: createActivityRegionScoreRepository,
};
