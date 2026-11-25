'use strict';
/**
 * Canonical Earth membership territory read.
 * Source: profiles.territory only. No localStorage. No browser self-write.
 * Initial membership is CENTRAL. No score change. No territory transition.
 */

const core = require('../shared/canonical-user-territory-core');

function getAdminClient(opts) {
  if (opts && opts.client) return opts.client;
  const persist = require('./achievement-persist-service');
  return persist.getAdminClient();
}

async function getCanonicalUserTerritory(userId, opts) {
  const uid = String(userId || '').trim();
  if (!uid) {
    const err = new Error('CANONICAL_TERRITORY_USER_REQUIRED');
    err.code = 'CANONICAL_TERRITORY_USER_REQUIRED';
    throw err;
  }

  const sb = getAdminClient(opts);
  const res = await sb.from('profiles').select('territory').eq('id', uid).maybeSingle();
  if (res.error) {
    const err = new Error('CANONICAL_TERRITORY_READ_FAILED');
    err.code = 'CANONICAL_TERRITORY_READ_FAILED';
    err.detail = res.error.message;
    throw err;
  }

  const parsed = core.normalizeCanonicalMembershipTerritory(res.data ? res.data.territory : null);
  if (!parsed.ok) {
    return {
      territory: null,
      source: core.CURRENT_TERRITORY_CANONICAL_SOURCE,
      available: false,
      error: parsed.error,
    };
  }
  return {
    territory: parsed.territory,
    source: core.CURRENT_TERRITORY_CANONICAL_SOURCE,
    available: parsed.territory != null,
    error: null,
  };
}

/**
 * Current political alignment score SSOT: public.user_alignment_state.score.
 * Missing row → INITIAL_ALIGNMENT_SCORE (0). Read errors are not treated as 0.
 */
async function getCanonicalUserAlignmentScore(userId, opts) {
  const uid = String(userId || '').trim();
  if (!uid) {
    const err = new Error('CANONICAL_ALIGNMENT_SCORE_USER_REQUIRED');
    err.code = 'CANONICAL_ALIGNMENT_SCORE_USER_REQUIRED';
    throw err;
  }

  const sb = getAdminClient(opts);
  const res = await sb.from('user_alignment_state').select('score').eq('user_id', uid).maybeSingle();
  if (res.error) {
    const err = new Error('ALIGNMENT_SCORE_READ_FAILED');
    err.code = 'ALIGNMENT_SCORE_READ_FAILED';
    err.detail = res.error.message;
    throw err;
  }
  if (!res.data) {
    return core.INITIAL_ALIGNMENT_SCORE;
  }
  const n = Number(res.data.score);
  if (!isFinite(n)) {
    const err = new Error('ALIGNMENT_SCORE_INVALID');
    err.code = 'ALIGNMENT_SCORE_INVALID';
    throw err;
  }
  return n;
}

/**
 * 한국 반응 사본용. 행이 없으면 0이 아니라 null.
 * 미국 반응은 이 함수를 호출하지 않는다.
 */
async function getKoreanAlignmentScoreCopy(userId, opts) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  if (opts && typeof opts.query === 'function') {
    const got = await getCountryAlignmentScore(uid, 'KR', opts);
    return got.available ? got.score : null;
  }
  const sb = getAdminClient(opts);
  const res = await sb.from('user_alignment_state').select('score').eq('user_id', uid).maybeSingle();
  if (res.error) {
    const err = new Error('ALIGNMENT_SCORE_READ_FAILED');
    err.code = 'ALIGNMENT_SCORE_READ_FAILED';
    err.detail = res.error.message;
    throw err;
  }
  if (!res.data || res.data.score == null || res.data.score === '') return null;
  const n = Number(res.data.score);
  if (!isFinite(n)) {
    const err = new Error('ALIGNMENT_SCORE_INVALID');
    err.code = 'ALIGNMENT_SCORE_INVALID';
    throw err;
  }
  return n;
}

async function getCountryAlignmentScore(userId, region, opts) {
  const country = region === 'KR' || region === 'US' ? region : null;
  if (!country) {
    return { score: null, available: false, source: 'user_alignment_state', reason: 'COUNTRY_REQUIRED' };
  }
  if (country === 'US') {
    return { score: null, available: false, source: 'user_alignment_state', reason: 'US_ALIGNMENT_INACTIVE' };
  }
  const uid = String(userId || '').trim();
  if (!uid) {
    return { score: null, available: false, source: 'user_alignment_state', reason: 'USER_REQUIRED' };
  }
  const query = opts && opts.query;
  if (typeof query !== 'function') {
    return { score: null, available: false, source: 'user_alignment_state', reason: 'ALIGNMENT_SCORE_UNAVAILABLE' };
  }
  const res = await query('SELECT score FROM public.user_alignment_state WHERE user_id = $1', [uid]);
  const row = res.rows[0] || null;
  if (!row || row.score == null || row.score === '') {
    return { score: null, available: false, source: 'user_alignment_state', reason: 'ALIGNMENT_UNSET' };
  }
  const n = Number(row.score);
  if (!isFinite(n)) {
    return { score: null, available: false, source: 'user_alignment_state', reason: 'ALIGNMENT_SCORE_INVALID' };
  }
  return { score: n, available: true, source: 'user_alignment_state', reason: null };
}

async function getCountryUserTerritory(userId, region, opts) {
  const store = require('./country-territory-store');
  const country = store.countryOf(region);
  if (!country) {
    return {
      territory: null,
      available: false,
      source: 'user_activity_region_profile',
      reason: 'COUNTRY_REQUIRED',
    };
  }
  const query = opts && opts.query;
  if (typeof query !== 'function' || !(await store.countryTableReady(query))) {
    return {
      territory: null,
      available: false,
      source: 'user_activity_region_profile',
      reason: 'COUNTRY_PROFILE_UNAVAILABLE',
    };
  }
  const got = await store.readAffiliation(query, userId, country);
  const set = !!(got.stored && got.territory);
  return {
    territory: got.territory,
    available: set,
    stored: got.stored,
    source: 'user_activity_region_profile',
    reason: set ? null : 'TERRITORY_UNSET',
  };
}

module.exports = {
  getCanonicalUserTerritory,
  getCountryUserTerritory,
  getCanonicalUserAlignmentScore,
  getKoreanAlignmentScoreCopy,
  getCountryAlignmentScore,
  CURRENT_TERRITORY_CANONICAL_SOURCE: core.CURRENT_TERRITORY_CANONICAL_SOURCE,
  TERRITORY_MEMBERSHIP_PERSISTENCE: core.TERRITORY_MEMBERSHIP_PERSISTENCE,
  INITIAL_TERRITORY: core.INITIAL_TERRITORY,
  INITIAL_ALIGNMENT_SCORE: core.INITIAL_ALIGNMENT_SCORE,
  TERRITORY_SELECTION_UI: core.TERRITORY_SELECTION_UI,
  TERRITORY_SELF_WRITE: core.TERRITORY_SELF_WRITE,
  TERRITORY_MOVE: core.TERRITORY_MOVE,
  TERRITORY_HISTORY: core.TERRITORY_HISTORY,
  BOARD_MEMBERSHIP_CONTEXT: core.BOARD_MEMBERSHIP_CONTEXT,
};
