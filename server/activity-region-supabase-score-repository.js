'use strict';

/**
 * 미국 점수만 Supabase 서버 클라이언트에 저장한다.
 * user_progression, user_achievements, user_alignment_state, 성향 점수는 쓰지 않는다.
 * service_role 클라이언트는 서버에서만 넘긴다.
 */

const xpCore = require('../shared/progression-xp-core');
const rankCore = require('../shared/user-rank-core');
const evalCore = require('../shared/achievement-evaluation-core');

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function createActivityRegionSupabaseScoreRepository(options) {
  const opts = options || {};
  const client = opts.client;
  if (!client || typeof client.from !== 'function') throw fail('REGION_SCORE_QUERY_REQUIRED');

  async function rows(query, code) {
    const result = await query;
    if (result && result.error) throw fail(code || 'REGION_SCORE_APPLY_FAILED');
    return result && result.data ? result.data : [];
  }

  async function readProfile(userId, region) {
    if (region !== 'US') throw fail('REGION_MISMATCH');
    const selected = await client
      .from('user_activity_region_profile')
      .select('*')
      .eq('user_id', userId)
      .eq('activity_region', 'US')
      .maybeSingle();
    if (selected && selected.error) throw fail('REGION_SCORE_APPLY_FAILED');
    const row = selected && selected.data ? selected.data : null;
    const ach = await rows(
      client
        .from('user_activity_region_achievement')
        .select('achievement_key')
        .eq('user_id', userId)
        .eq('activity_region', 'US')
        .order('achievement_key', { ascending: true }),
      'REGION_SCORE_APPLY_FAILED'
    );
    const posts = await rows(
      client
        .from('board_posts')
        .select('id')
        .eq('author_user_id', userId)
        .eq('status', 'ACTIVE')
        .eq('activity_region', 'US')
    );
    const comments = await rows(
      client
        .from('board_comments')
        .select('id, post_id')
        .eq('author_user_id', userId)
        .eq('status', 'ACTIVE')
        .eq('activity_region', 'US')
    );
    let otherComments = 0;
    if (comments.length) {
      const postIds = comments.map(function (item) { return item.post_id; }).filter(Boolean);
      const parents = await rows(client.from('board_posts').select('id, author_user_id').in('id', postIds));
      const authors = {};
      parents.forEach(function (item) { authors[item.id] = item.author_user_id; });
      comments.forEach(function (item) {
        if (authors[item.post_id] && authors[item.post_id] !== userId) otherComments += 1;
      });
    }
    return {
      userId: userId,
      region: 'US',
      level: row ? Number(row.level) : 0,
      xp: row ? Number(row.xp) : 0,
      fame: row ? Number(row.reputation_score) : 0,
      aura: row ? Number(row.aura) : 0,
      tendency: row ? row.tendency : null,
      evolution: row ? Number(row.evolution_contribution) : 0,
      achievements: ach.map(function (item) { return item.achievement_key; }),
      activity: {
        posts: posts.length,
        comments: comments.length,
        commentsOnOthers: otherComments,
      },
      stored: !!row,
    };
  }

  async function grantForEvent(userId, eventType, level) {
    const profile = await readProfile(userId, 'US');
    const owned = profile.achievements.map(function (key) { return { achievementKey: key }; });
    const stats = {
      validPostCount: profile.activity.posts,
      validCommentOnOthersPostCount: profile.activity.commentsOnOthers,
      validEmpathyReceivedCount: 0,
    };
    const empathy = await rows(
      client
        .from('user_activity_events')
        .select('id')
        .eq('user_id', userId)
        .eq('activity_type', 'EMPATHY_RECEIVED')
        .eq('activity_region', 'US')
    );
    stats.validEmpathyReceivedCount = empathy.length;
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
      const already = await client
        .from('user_activity_region_achievement')
        .select('achievement_key')
        .eq('user_id', userId)
        .eq('activity_region', 'US')
        .eq('achievement_key', def.achievementKey)
        .maybeSingle();
      if (already && already.error) throw fail('REGION_SCORE_APPLY_FAILED');
      if (already && already.data) continue;
      const inserted = await client.from('user_activity_region_achievement').insert({
        user_id: userId,
        activity_region: 'US',
        achievement_key: def.achievementKey,
      });
      if (inserted && inserted.error) throw fail('REGION_SCORE_APPLY_FAILED');
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
    const existing = await client
      .from('user_activity_events')
      .select('id')
      .eq('dedupe_key', dedupe)
      .maybeSingle();
    if (existing && existing.error) throw fail('REGION_SCORE_APPLY_FAILED');
    if (existing && existing.data) return readProfile(userId, 'US');

    const xpDelta = eventType === 'POST_CREATED'
      ? xpCore.xpRewardForEvent('POST_CREATED')
      : eventType === 'BOARD_COMMENT_CREATED'
        ? xpCore.xpRewardForEvent('BOARD_COMMENT_CREATED')
        : 0;
    const fameDelta = eventType === 'EMPATHY_RECEIVED'
      ? rankCore.fameRewardForEvent('EMPATHY_RECEIVED')
      : 0;

    const current = await client
      .from('user_activity_region_profile')
      .select('*')
      .eq('user_id', userId)
      .eq('activity_region', 'US')
      .maybeSingle();
    if (current && current.error) throw fail('REGION_SCORE_APPLY_FAILED');
    if (!current || !current.data) {
      const created = await client.from('user_activity_region_profile').insert({
        user_id: userId,
        activity_region: 'US',
      });
      if (created && created.error) throw fail('REGION_SCORE_APPLY_FAILED');
    }
    const base = current && current.data ? current.data : { xp: 0, reputation_score: 0 };
    const xp = Number(base.xp || 0) + xpDelta;
    const fame = Number(base.reputation_score || 0) + fameDelta;
    const level = xpCore.calculateLevelFromXp(xp);
    const updated = await client
      .from('user_activity_region_profile')
      .update({
        xp: xp,
        reputation_score: fame,
        level: level,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('activity_region', 'US');
    if (updated && updated.error) throw fail('REGION_SCORE_APPLY_FAILED');
    const eventInsert = await client.from('user_activity_events').insert({
      user_id: userId,
      activity_type: eventType,
      payload: { sourceId: sourceId, xpDelta: xpDelta, fameDelta: fameDelta },
      dedupe_key: dedupe,
      activity_region: 'US',
    });
    if (eventInsert && eventInsert.error) throw fail('REGION_SCORE_APPLY_FAILED');
    const noticeInsert = await client.from('user_notifications').insert({
      user_id: userId,
      notification_type: eventType,
      title: 'US activity',
      message: eventType,
      activity_region: 'US',
    });
    if (noticeInsert && noticeInsert.error) throw fail('REGION_SCORE_APPLY_FAILED');
    const achievements = await grantForEvent(
      userId,
      eventType === 'BOARD_COMMENT_CREATED' ? 'COMMENT_CREATED' : eventType,
      level
    );
    const profile = await readProfile(userId, 'US');
    profile.achievementsGranted = achievements;
    profile.fameDelta = fameDelta;
    profile.xpDelta = xpDelta;
    return profile;
  }

  return {
    applyEvent: applyEvent,
    readProfile: readProfile,
  };
}

module.exports = {
  createActivityRegionSupabaseScoreRepository: createActivityRegionSupabaseScoreRepository,
};
