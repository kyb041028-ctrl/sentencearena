'use strict';

const INVITER_KEY = 'invite-show-up';
const JOINER_KEY = 'invite-pulled-in';
const PIPER_KEY = 'piper';
const PIPER_STEPS = [10, 100, 1000, 10000];
const PIPER_RARITY = ['BRONZE', 'SILVER', 'GOLD', 'CRYSTAL'];

let sharedQuery = null;

function setQuery(query) {
  if (typeof query === 'function') sharedQuery = query;
}

function stageForCount(count) {
  let stage = 0;
  for (let i = 0; i < PIPER_STEPS.length; i += 1) {
    if (count >= PIPER_STEPS[i]) stage = i + 1;
  }
  return stage;
}

function rarityForStage(stage) {
  return PIPER_RARITY[Math.max(0, Number(stage) - 1)] || 'BRONZE';
}

async function nextSequence(query, userId, region) {
  const res = await query(
    'SELECT COALESCE(MAX(acquisition_sequence), 0)::int AS n ' +
      'FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = $2',
    [userId, region]
  );
  return Number(res.rows[0].n) + 1;
}

async function insertOnce(query, userId, region, key) {
  const seq = await nextSequence(query, userId, region);
  const inserted = await query(
    'INSERT INTO public.user_activity_region_achievement ' +
      '(user_id, activity_region, achievement_key, acquisition_sequence) ' +
      'VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING *',
    [userId, region, key, seq]
  );
  return inserted.rows[0] || null;
}

async function grantReferralPair(query, region, inviterId, memberId) {
  const country = region === 'US' ? 'US' : region === 'KR' ? 'KR' : null;
  const inviter = String(inviterId || '');
  const member = String(memberId || '');
  if (!country || !inviter || !member || inviter === member) return [];
  const inviterRow = await insertOnce(query, inviter, country, INVITER_KEY);
  const memberRow = await insertOnce(query, member, country, JOINER_KEY);
  return [inviterRow, memberRow].filter(Boolean);
}

async function repairReferral(query, userId, region) {
  const country = region === 'US' ? 'US' : region === 'KR' ? 'KR' : null;
  if (!country || !userId) return [];
  const found = await query(
    `SELECT l.inviter_user_id
       FROM public.share_invite_events e
       JOIN public.invite_links l ON l.code = e.code AND l.activity_region = e.activity_region
      WHERE e.kind = 'share_signup' AND e.path_kind = 'invite'
        AND e.user_id = $1 AND e.activity_region = $2
        AND e.user_id <> l.inviter_user_id
      ORDER BY e.created_at ASC
      LIMIT 1`,
    [userId, country]
  );
  const row = found.rows[0];
  if (!row) return [];
  return grantReferralPair(query, country, row.inviter_user_id, userId);
}

async function followerCount(query, userId, region) {
  const res = await query(
    `SELECT count(DISTINCT follower_user_id)::int AS n
       FROM public.user_follows
      WHERE following_user_id = $1
        AND activity_region = $2
        AND cancelled_at IS NULL
        AND follower_user_id <> following_user_id`,
    [userId, region]
  );
  return Number(res.rows[0].n) || 0;
}

async function evaluatePiper(query, userId, region) {
  const country = region === 'US' ? 'US' : region === 'KR' ? 'KR' : null;
  if (!country || !userId) return null;
  const count = await followerCount(query, userId, country);
  const stage = stageForCount(count);
  const existing = await query(
    'SELECT stage, stage_reached, acquisition_sequence, acquisition_notified_at ' +
      'FROM public.user_activity_region_achievement ' +
      'WHERE user_id = $1 AND activity_region = $2 AND achievement_key = $3',
    [userId, country, PIPER_KEY]
  );
  const now = new Date().toISOString();
  if (!existing.rows.length) {
    if (!stage) return { stage: 0, followers: count, granted: false };
    const reached = {};
    for (let i = 1; i <= stage; i += 1) reached[String(i)] = now;
    const seq = await nextSequence(query, userId, country);
    const inserted = await query(
      'INSERT INTO public.user_activity_region_achievement ' +
        '(user_id, activity_region, achievement_key, acquisition_sequence, stage, stage_reached) ' +
        'VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING RETURNING stage',
      [userId, country, PIPER_KEY, seq, stage, JSON.stringify(reached)]
    );
    return { stage: stage, followers: count, granted: inserted.rows.length > 0, notifyStage: stage };
  }
  const row = existing.rows[0];
  const prev = Number(row.stage) || 0;
  const reached = row.stage_reached && typeof row.stage_reached === 'object' ? Object.assign({}, row.stage_reached) : {};
  let stamped = false;
  const top = Math.max(prev, stage);
  for (let i = 1; i <= top; i += 1) {
    if (i <= stage && !reached[String(i)]) {
      reached[String(i)] = now;
      stamped = true;
    }
  }
  if (stage > prev) {
    await query(
      'UPDATE public.user_activity_region_achievement ' +
        'SET stage = $4, stage_reached = $5::jsonb, acquisition_notified_at = NULL ' +
        'WHERE user_id = $1 AND activity_region = $2 AND achievement_key = $3',
      [userId, country, PIPER_KEY, stage, JSON.stringify(reached)]
    );
    return { stage: stage, followers: count, granted: true, notifyStage: stage };
  }
  if (stamped) {
    await query(
      'UPDATE public.user_activity_region_achievement SET stage_reached = $4::jsonb ' +
        'WHERE user_id = $1 AND activity_region = $2 AND achievement_key = $3',
      [userId, country, PIPER_KEY, JSON.stringify(reached)]
    );
  }
  return { stage: prev, followers: count, granted: false };
}

function decorate(row) {
  if (!row || row.achievement_key !== PIPER_KEY) return row;
  row.stage = Number(row.stage) || 0;
  row.rarity = rarityForStage(row.stage);
  return row;
}

module.exports = {
  setQuery: setQuery,
  getQuery: function () { return sharedQuery; },
  INVITER_KEY: INVITER_KEY,
  JOINER_KEY: JOINER_KEY,
  PIPER_KEY: PIPER_KEY,
  stageForCount: stageForCount,
  rarityForStage: rarityForStage,
  grantReferralPair: grantReferralPair,
  repairReferral: repairReferral,
  evaluatePiper: evaluatePiper,
  decorate: decorate,
};
