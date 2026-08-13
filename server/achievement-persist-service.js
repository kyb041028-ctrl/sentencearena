'use strict';

/**
 * 실회원 업적 DB 영구 저장 — 기존 user_achievements / user_featured_achievements + RPC 재사용.
 * ownership = auth.users.id (JWT). email/provider/display_name 미사용.
 */

const { createClient } = require('@supabase/supabase-js');

let _adminClient = null;
let _adminInjected = null;

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

function getAdminClient() {
  if (_adminInjected) return _adminInjected;
  if (_adminClient) return _adminClient;
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    const err = new Error('ACHIEVEMENT_PERSIST_NOT_CONFIGURED');
    err.code = 'ACHIEVEMENT_PERSIST_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }
  _adminClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return _adminClient;
}

function setAdminClientForTests(client) {
  _adminInjected = client || null;
  _adminClient = null;
}

function resetAdminClientForTests() {
  _adminInjected = null;
  _adminClient = null;
}

function makeError(code, status, extra) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 400;
  if (extra) Object.assign(err, extra);
  return err;
}

function mapAchievementRow(row) {
  if (!row) return null;
  return {
    achievementId: String(row.achievement_key || ''),
    acquiredAt: row.acquired_at ? new Date(row.acquired_at).toISOString() : '',
    acquisitionSequence: Number(row.acquisition_sequence) || 0,
    seasonId: row.season_key == null || row.season_key === '' ? null : String(row.season_key),
    acquisitionNotifiedAt: row.acquisition_notified_at
      ? new Date(row.acquisition_notified_at).toISOString()
      : null,
  };
}

async function listAchievementsForUser(userId) {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from('user_achievements')
    .select('achievement_key, acquired_at, acquisition_sequence, season_key, acquisition_notified_at')
    .eq('user_id', userId)
    .order('acquisition_sequence', { ascending: true });
  if (error) {
    throw makeError(error.code || 'ACHIEVEMENT_LOAD_FAILED', 500, { detail: error.message });
  }
  return (data || []).map(mapAchievementRow).filter(function (r) {
    return r && r.achievementId;
  });
}

async function listFeaturedKeysForUser(userId) {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from('user_featured_achievements')
    .select('slot, achievement_key')
    .eq('user_id', userId)
    .order('slot', { ascending: true });
  if (error) {
    throw makeError(error.code || 'FEATURED_LOAD_FAILED', 500, { detail: error.message });
  }
  const keys = [];
  (data || []).forEach(function (row) {
    const key = String((row && row.achievement_key) || '').trim();
    if (key) keys.push(key);
  });
  return keys.slice(0, 3);
}

async function getMyAchievementBundle(userId) {
  const [currentAchievements, featuredAchievementIds] = await Promise.all([
    listAchievementsForUser(userId),
    listFeaturedKeysForUser(userId),
  ]);
  return {
    userId: String(userId),
    currentAchievements: currentAchievements,
    featuredAchievementIds: featuredAchievementIds,
    seasonHistory: [],
  };
}

async function nextAcquisitionSequence(userId) {
  // Deprecated for canonical grants — sequence is assigned inside grant_user_achievement RPC.
  const sb = getAdminClient();
  const { data, error } = await sb
    .from('user_achievements')
    .select('acquisition_sequence')
    .eq('user_id', userId)
    .order('acquisition_sequence', { ascending: false })
    .limit(1);
  if (error) {
    throw makeError(error.code || 'ACHIEVEMENT_SEQUENCE_FAILED', 500, { detail: error.message });
  }
  const max = data && data[0] ? Number(data[0].acquisition_sequence) || 0 : 0;
  return max + 1;
}

function mapRpcGrantRecord(data, seasonKeyFallback) {
  if (!data) return null;
  const key = data.achievement_key != null ? String(data.achievement_key) : '';
  if (!key) return null;
  const acquiredRaw = data.acquired_at;
  const acquiredAt = acquiredRaw ? new Date(acquiredRaw).toISOString() : '';
  const season =
    data.season_key == null || data.season_key === ''
      ? seasonKeyFallback == null || seasonKeyFallback === ''
        ? null
        : String(seasonKeyFallback)
      : String(data.season_key);
  return {
    achievementId: key,
    acquiredAt: acquiredAt,
    acquisitionSequence: Number(data.acquisition_sequence) || 0,
    seasonId: season,
    acquisitionNotifiedAt: data.acquisition_notified_at
      ? new Date(data.acquisition_notified_at).toISOString()
      : null,
  };
}

/**
 * Grant to JWT user only. Idempotent via grant_user_achievement RPC.
 * acquired_at / acquisition_sequence are assigned inside DB (client values ignored).
 */
async function grantAchievementForUser(userId, input) {
  const achievementKey = String((input && input.achievementId) || (input && input.achievementKey) || '').trim();
  if (!achievementKey || achievementKey.length > 80) {
    throw makeError('ACHIEVEMENT_KEY_INVALID', 400);
  }

  const seasonKey =
    input && input.seasonId != null && String(input.seasonId).trim() !== ''
      ? String(input.seasonId).trim()
      : null;

  const sb = getAdminClient();
  // Signature placeholders only — RPC ignores client acquired_at / sequence.
  const { data, error } = await sb.rpc('grant_user_achievement', {
    p_user_id: userId,
    p_achievement_key: achievementKey,
    p_acquired_at: 'epoch',
    p_acquisition_sequence: 0,
    p_season_key: seasonKey,
    p_metadata: (input && input.metadata) || {},
  });
  if (error) {
    throw makeError(error.code || 'ACHIEVEMENT_GRANT_FAILED', 500, { detail: error.message });
  }

  const status = data && data.status ? String(data.status) : '';
  const record = mapRpcGrantRecord(data, seasonKey);
  const bundle = await getMyAchievementBundle(userId);

  if (status === 'ALREADY_GRANTED') {
    return {
      granted: false,
      reason: 'ALREADY_ACQUIRED',
      status: 'ALREADY_GRANTED',
      record: record,
      bundle: bundle,
    };
  }

  if (status !== 'GRANTED' || !record) {
    throw makeError('ACHIEVEMENT_GRANT_FAILED', 500, { detail: 'unexpected rpc status: ' + status });
  }

  return {
    granted: true,
    reason: 'GRANTED',
    status: 'GRANTED',
    record: record,
    bundle: bundle,
  };
}

/**
 * Set featured slots via authenticated JWT RPC (auth.uid()).
 * @param {object} userSupabase - supabase client with user JWT
 * @param {string[]} keys
 */
async function setFeaturedAchievementsForUser(userSupabase, userId, keys) {
  const raw = Array.isArray(keys) ? keys : [];
  const normalized = [];
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const id = String(raw[i] == null ? '' : raw[i]).trim();
    if (!id) continue;
    if (seen[id]) {
      throw makeError('FEATURED_DUPLICATE_KEY', 400, { key: id });
    }
    seen[id] = true;
    normalized.push(id);
  }
  if (normalized.length > 3) {
    throw makeError('FEATURED_MAX_EXCEEDED', 400);
  }

  const owned = await listAchievementsForUser(userId);
  const ownedSet = {};
  owned.forEach(function (r) {
    ownedSet[r.achievementId] = true;
  });
  for (let i = 0; i < normalized.length; i++) {
    if (!ownedSet[normalized[i]]) {
      throw makeError('ACHIEVEMENT_NOT_OWNED', 400, { key: normalized[i] });
    }
  }

  const safe = normalized.concat([null, null, null]).slice(0, 3);
  const { data, error } = await userSupabase.rpc('set_featured_achievements', {
    p_slot1_key: safe[0] || null,
    p_slot2_key: safe[1] || null,
    p_slot3_key: safe[2] || null,
  });
  if (error) {
    throw makeError(error.code || 'FEATURED_SET_FAILED', 500, { detail: error.message });
  }
  if (data && data.status === 'ERROR') {
    throw makeError(data.code || 'FEATURED_SET_FAILED', 400, { key: data.key });
  }

  return {
    status: (data && data.status) || 'SET',
    featuredAchievementIds: await listFeaturedKeysForUser(userId),
    bundle: await getMyAchievementBundle(userId),
  };
}

/**
 * Mark a canonical acquisition as shown in the centered alert.
 * JWT auth.uid() only — key+sequence must match an owned row.
 * Does not accept or mutate acquired_at / acquisition_sequence.
 */
async function markAchievementNotifiedForUser(userSupabase, userId, input) {
  const achievementKey = String(
    (input && (input.achievementId || input.achievementKey)) || '',
  ).trim();
  if (!achievementKey || achievementKey.length > 80) {
    throw makeError('ACHIEVEMENT_KEY_INVALID', 400);
  }
  const seq = Number(input && input.acquisitionSequence);
  if (!Number.isFinite(seq) || seq <= 0 || Math.floor(seq) !== seq) {
    throw makeError('ACQUISITION_SEQUENCE_INVALID', 400);
  }

  const { data, error } = await userSupabase.rpc('mark_user_achievement_notified', {
    p_achievement_key: achievementKey,
    p_acquisition_sequence: seq,
  });
  if (error) {
    throw makeError(error.code || 'NOTIFY_FAILED', 500, { detail: error.message });
  }
  if (data && data.status === 'ERROR') {
    const code = data.code || 'NOTIFY_FAILED';
    const status =
      code === 'AUTH_REQUIRED' ? 401 : code === 'ACHIEVEMENT_NOT_OWNED' ? 403 : 400;
    throw makeError(code, status, { key: data.key });
  }
  const notifiedAt = data && data.acquisition_notified_at
    ? new Date(data.acquisition_notified_at).toISOString()
    : null;
  return {
    status: (data && data.status) || 'NOTIFIED',
    achievementId: achievementKey,
    acquisitionSequence: seq,
    acquisitionNotifiedAt: notifiedAt,
    acquiredAt: data && data.acquired_at ? new Date(data.acquired_at).toISOString() : '',
  };
}

module.exports = {
  getMyAchievementBundle,
  grantAchievementForUser,
  setFeaturedAchievementsForUser,
  markAchievementNotifiedForUser,
  listAchievementsForUser,
  listFeaturedKeysForUser,
  setAdminClientForTests,
  resetAdminClientForTests,
  mapAchievementRow,
  getAdminClient,
};
