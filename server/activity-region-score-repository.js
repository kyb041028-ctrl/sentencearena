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
    let ach;
    try {
      ach = await query(
        'SELECT achievement_key, featured_slot FROM public.user_activity_region_achievement ' +
          'WHERE user_id = $1 AND activity_region = $2 ORDER BY achievement_key',
        [userId, region]
      );
    } catch (err) {
      if (!err || err.code !== '42703') throw err;
      ach = await query(
        'SELECT achievement_key FROM public.user_activity_region_achievement ' +
          'WHERE user_id = $1 AND activity_region = $2 ORDER BY achievement_key',
        [userId, region]
      );
      ach.rows.forEach(function (item) { item.featured_slot = null; });
    }
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
      featured: ach.rows.filter(r => r.featured_slot != null).sort((a,b) => a.featured_slot-b.featured_slot).map(r => r.achievement_key),
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
      featured: profile.featured,
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

  async function grantForEvent(userId, eventType, level, region) {
    const country = region === 'KR' ? 'KR' : 'US';
    const posts = await query(
      "SELECT count(*)::int AS n FROM public.board_posts " +
        "WHERE author_user_id = $1 AND status = 'ACTIVE' " +
        "AND public.activity_region_norm(activity_region) = $2",
      [userId, country]
    );
    const comments = await query(
      'SELECT count(*)::int AS n FROM public.board_comments c ' +
        'JOIN public.board_posts p ON p.id = c.post_id ' +
        'WHERE c.author_user_id = $1 AND c.status = \'ACTIVE\' ' +
        'AND p.author_user_id <> c.author_user_id ' +
        "AND public.activity_region_norm(c.activity_region) = $2",
      [userId, country]
    );
    const empathy = await query(
      "SELECT count(*)::int AS n FROM public.user_activity_events " +
        "WHERE user_id = $1 AND activity_type = 'EMPATHY_RECEIVED' " +
        "AND public.activity_region_norm(activity_region) = $2",
      [userId, country]
    );
    const ownedRows = await query(
      'SELECT achievement_key FROM public.user_activity_region_achievement ' +
        'WHERE user_id = $1 AND activity_region = $2',
      [userId, country]
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
      const inserted = await query(
        'INSERT INTO public.user_activity_region_achievement ' +
          '(user_id, activity_region, achievement_key) VALUES ($1, $2, $3) ' +
          'ON CONFLICT DO NOTHING RETURNING *',
        [userId, country, def.achievementKey]
      );
      if (!inserted.rows.length) continue;
      let stored = inserted.rows[0];
      if (def.achievementKey === 'territory-citizen') {
        try {
          const numbered = await query(
            'UPDATE public.user_activity_region_achievement AS target ' +
              'SET acquisition_sequence = (' +
                'SELECT COALESCE(MAX(acquisition_sequence), 0) + 1 ' +
                'FROM public.user_activity_region_achievement ' +
                'WHERE user_id = $1 AND activity_region = $2' +
              ') ' +
              'WHERE target.user_id = $1 AND target.activity_region = $2 ' +
                'AND target.achievement_key = $3 AND target.acquisition_sequence IS NULL ' +
              'RETURNING target.*',
            [userId, country, def.achievementKey]
          );
          if (numbered.rows[0]) stored = numbered.rows[0];
        } catch (err) {
          if (!err || err.code !== '42703') throw err;
        }
      }
      owned.push({ achievementKey: def.achievementKey });
      granted.push({ achievementKey: def.achievementKey, record: require('./achievement-persist-service').mapAchievementRow(stored) });
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

    let beta = null;
    if (eventType === 'POST_CREATED' || eventType === 'BOARD_COMMENT_CREATED') {
      beta = await require('./special-achievement-service').grantBetaParticipationSafe(
        userId, 'US', eventType === 'POST_CREATED' ? 'POST' :
          (sourceId.indexOf('daily-issue-comment:') === 0 ? 'ISSUE_COMMENT' : 'BOARD_COMMENT'),
        sourceId, { query: query });
    }

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
    profile.achievementsGranted = require('./special-achievement-service').grantedRecords(beta).concat(achievements);
    profile.fameDelta = fameDelta;
    profile.xpDelta = xpDelta;
    return profile;
  }

  async function recordCountrySideEffect(input) {
    const src = input || {};
    const region = src.region === 'KR' || src.region === 'US' ? src.region : null;
    const userId = String(src.userId || '').trim();
    const eventType = String(src.eventType || '').trim();
    const sourceId = String(src.sourceId || '').trim();
    if (!region) throw fail('COUNTRY_REQUIRED');
    if (!userId || !eventType || !sourceId) throw fail('COUNTRY_REQUIRED');
    const dedupe = region + ':' + eventType + ':' + sourceId;
    const existing = await query(
      'SELECT id FROM public.user_activity_events WHERE dedupe_key = $1',
      [dedupe]
    );
    if (existing.rows.length) return { status: 'DUPLICATE', dedupeKey: dedupe };
    const text = String(src.text || eventType).slice(0, 180);
    await query(
      'INSERT INTO public.user_activity_events ' +
        '(user_id, activity_type, payload, dedupe_key, activity_region) ' +
        'VALUES ($1, $2, $3::jsonb, $4, $5)',
      [userId, eventType, JSON.stringify({ sourceId: sourceId }), dedupe, region]
    );
    const notice = await query(
      'SELECT id FROM public.user_notifications WHERE dedupe_key = $1',
      [dedupe]
    );
    if (!notice.rows.length) {
      await query(
        'INSERT INTO public.user_notifications ' +
          '(user_id, notification_type, title, message, dedupe_key, activity_region) ' +
          'VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, eventType, text, text, dedupe, region]
      );
    }
    return { status: 'RECORDED', dedupeKey: dedupe };
  }

  async function evaluateGrants(userId, eventType, level, region) {
    return grantForEvent(
      userId,
      eventType === 'BOARD_COMMENT_CREATED' ? 'COMMENT_CREATED' : eventType,
      level,
      region
    );
  }

  return {
    applyEvent: applyEvent,
    recordCountrySideEffect: recordCountrySideEffect,
    evaluateGrants: evaluateGrants,
    readProfile: readProfile,
    readProfileFrame: readProfileFrame,
  };
}

module.exports = {
  createActivityRegionScoreRepository: createActivityRegionScoreRepository,
};
