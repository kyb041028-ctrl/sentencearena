'use strict';

/**
 * 회원 + 국가 한 행이 경험치, 레벨, 명성의 기준이다.
 * 나라가 없거나 KR/US가 아니면 거절한다.
 * 옛 user_progression.reputation_score 는 나누거나 0으로 만들지 않는다.
 */

const xpCore = require('../shared/progression-xp-core');
const rankCore = require('../shared/user-rank-core');

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function regionOf(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  if (text === 'KR' || text === 'US') return text;
  return null;
}

function createCountryProgressionStore(options) {
  const query = options && options.query;
  if (typeof query !== 'function') throw fail('COUNTRY_PROGRESSION_QUERY_REQUIRED');

  async function read(userId, region) {
    const country = regionOf(region);
    if (!country) throw fail('COUNTRY_REQUIRED');
    const res = await query(
      `SELECT activity_region, xp, level, reputation_score
       FROM public.user_activity_region_profile
       WHERE user_id = $1 AND activity_region = $2`,
      [userId, country]
    );
    const row = res.rows[0] || null;
    return {
      userId: String(userId),
      region: country,
      stored: !!row,
      xp: row ? Number(row.xp) : null,
      level: row ? Number(row.level) : null,
      fame: row ? Number(row.reputation_score) : null,
    };
  }

  async function applyDelta(input) {
    const src = input || {};
    const country = regionOf(src.region);
    if (!country) throw fail('COUNTRY_REQUIRED');
    const userId = String(src.userId || '').trim();
    const dedupeKey = String(src.dedupeKey || '').trim();
    if (!userId || !dedupeKey) throw fail('PROGRESSION_INPUT_INVALID');
    const xpDelta = Math.floor(Number(src.xpDelta) || 0);
    const fameDelta = Math.floor(Number(src.fameDelta) || 0);
    if (xpDelta < 0 || fameDelta < 0) throw fail('DELTA_INVALID');
    await query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region)
       VALUES ($1, $2)
       ON CONFLICT (user_id, activity_region) DO NOTHING`,
      [userId, country]
    );
    const prior = await query(
      `SELECT level FROM public.user_activity_region_profile
       WHERE user_id = $1 AND activity_region = $2`,
      [userId, country]
    );
    const previousLevel = prior.rows[0] ? Number(prior.rows[0].level) : 1;
    const updated = await query(
      `WITH ins AS (
         INSERT INTO public.country_progression_grants
           (dedupe_key, user_id, activity_region, xp_delta, fame_delta)
         VALUES ($5, $1, $2, $3, $4)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING xp_delta, fame_delta
       )
       UPDATE public.user_activity_region_profile AS p
       SET xp = p.xp + COALESCE((SELECT xp_delta FROM ins), 0),
           reputation_score = p.reputation_score + COALESCE((SELECT fame_delta FROM ins), 0),
           level = public.country_level_from_xp(p.xp + COALESCE((SELECT xp_delta FROM ins), 0)),
           updated_at = now()
       WHERE p.user_id = $1 AND p.activity_region = $2
         AND EXISTS (SELECT 1 FROM ins)
       RETURNING p.activity_region, p.xp, p.level, p.reputation_score`,
      [userId, country, xpDelta, fameDelta, dedupeKey]
    );
    const applied = updated.rows[0] || null;
    const current = applied ? null : await read(userId, country);
    return {
      userId: userId,
      region: country,
      xp: applied ? Number(applied.xp) : current.xp,
      level: applied ? Number(applied.level) : current.level,
      fame: applied ? Number(applied.reputation_score) : current.fame,
      status: applied ? 'APPLIED' : 'DUPLICATE',
      xpDelta: applied ? xpDelta : 0,
      fameDelta: applied ? fameDelta : 0,
      previousLevel: previousLevel,
      levelChanged: applied ? Number(applied.level) !== previousLevel : false,
    };
  }

  async function revokeEvent(input) {
    const src = input || {};
    const country = regionOf(src.region);
    if (!country) throw fail('COUNTRY_REQUIRED');
    const userId = String(src.userId || '').trim();
    const eventType = String(src.eventType || '').trim();
    const sourceId = String(src.sourceId || '').trim();
    if (!userId || !eventType || !sourceId) throw fail('PROGRESSION_INPUT_INVALID');
    const dedupeKey = countryDedupe(country, eventType, sourceId);
    const updated = await query(
      `WITH removed AS (
         DELETE FROM public.country_progression_grants
         WHERE dedupe_key = $3 AND user_id = $1 AND activity_region = $2
         RETURNING xp_delta, fame_delta
       ),
       upd AS (
         UPDATE public.user_activity_region_profile AS p
         SET xp = GREATEST(0, p.xp - (SELECT xp_delta FROM removed)),
             reputation_score = GREATEST(0, p.reputation_score - (SELECT fame_delta FROM removed)),
             level = public.country_level_from_xp(GREATEST(0, p.xp - (SELECT xp_delta FROM removed))),
             updated_at = now()
         WHERE p.user_id = $1 AND p.activity_region = $2
           AND EXISTS (SELECT 1 FROM removed)
         RETURNING p.xp, p.level, p.reputation_score
       )
       SELECT upd.xp, upd.level, upd.reputation_score, removed.xp_delta, removed.fame_delta
       FROM upd CROSS JOIN removed`,
      [userId, country, dedupeKey]
    );
    const row = updated.rows[0] || null;
    const current = row ? null : await read(userId, country);
    return {
      userId: userId,
      region: country,
      xp: row ? Number(row.xp) : current.xp,
      level: row ? Number(row.level) : current.level,
      fame: row ? Number(row.reputation_score) : current.fame,
      status: row ? 'APPLIED' : 'NOT_FOUND',
      xpDelta: row ? -Number(row.xp_delta) : 0,
      fameDelta: row ? -Number(row.fame_delta) : 0,
    };
  }

  async function applyEvent(input) {
    const src = input || {};
    const eventType = String(src.eventType || '').trim();
    const sourceId = String(src.sourceId || '').trim();
    if (!eventType || !sourceId) throw fail('PROGRESSION_INPUT_INVALID');
    const xpDelta = xpCore.xpRewardForEvent(eventType) || 0;
    const fameDelta = eventType === 'EMPATHY_RECEIVED'
      ? rankCore.fameRewardForEvent('EMPATHY_RECEIVED')
      : 0;
    return applyDelta({
      userId: src.userId,
      region: src.region,
      xpDelta: xpDelta,
      fameDelta: fameDelta,
      dedupeKey: countryDedupe(src.region, eventType, sourceId),
    });
  }

  return {
    read: read,
    applyDelta: applyDelta,
    applyEvent: applyEvent,
    revokeEvent: revokeEvent,
  };
}

function countryDedupe(region, eventType, sourceId) {
  const country = regionOf(region) || 'UNKNOWN';
  return country + ':' + eventType + ':' + sourceId;
}

module.exports = {
  createCountryProgressionStore: createCountryProgressionStore,
  regionOf: regionOf,
};
