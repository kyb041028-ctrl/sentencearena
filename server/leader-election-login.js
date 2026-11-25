/**
 * 선거에서 쓰는 로그인 사용자.
 * 기본은 기존 requireAuthenticatedUser 다. 테스트 검증기는 주입했을 때만 쓰며 운영 기본값이 아니다.
 * 원격 Supabase 는 호출하지 않는다. 본문의 actor, voterId, 대표 깃발은 신원이 아니다.
 */
'use strict';

const auth = require('./auth/require-authenticated-user');
const authConfig = require('./supabase-server-auth-config');
const citizenRank = require('../shared/citizen-rank-evaluation-core');
const territory = require('../shared/canonical-user-territory-core');
const population = require('./territory-population-adapter');

let injectedVerifier = null;
let injectedReader = null;

function setVerifierForTests(verifier) {
  injectedVerifier = typeof verifier === 'function' ? verifier : null;
  return { installed: injectedVerifier != null, productionDefault: false };
}

function clearVerifierForTests() {
  injectedVerifier = null;
}

function setMembershipReaderForTests(reader) {
  injectedReader = typeof reader === 'function' ? reader : null;
  return { installed: injectedReader != null, productionDefault: false };
}

function clearMembershipReaderForTests() {
  injectedReader = null;
}

function remoteSupabase(url) {
  return /supabase\.co|production|amazonaws|pooler/i.test(String(url || ''));
}

async function resolveElectionActor(req) {
  if (injectedVerifier) {
    const got = await injectedVerifier(req || { headers: {} });
    return normalizeActor(got, { verifier: 'injected-test', liveSupabase: false });
  }
  const config = authConfig.resolveSupabaseServerAuthConfig();
  if (config.configured && remoteSupabase(config.url)) {
    return {
      ok: false,
      reason: 'LIVE_SUPABASE_NOT_CALLED',
      stored: false,
      liveSupabase: false,
      verifier: 'requireAuthenticatedUser',
      productionAuth: false,
    };
  }
  const got = await auth.requireAuthenticatedUser(
    req || { headers: {} },
    null,
    config.configured ? { url: config.url, key: config.key } : null
  );
  return normalizeActor(got, { verifier: 'requireAuthenticatedUser', liveSupabase: false });
}

function normalizeActor(got, meta) {
  const src = got || {};
  const userId = src.user && src.user.id ? String(src.user.id) : (src.userId ? String(src.userId) : '');
  if (!src.ok || !userId) {
    return {
      ok: false,
      reason: src.reason || src.error || 'AUTH_NOT_CONNECTED',
      stored: false,
      liveSupabase: false,
      verifier: meta.verifier,
      productionAuth: false,
      usedBodyId: false,
    };
  }
  return {
    ok: true,
    userId: userId,
    stored: false,
    liveSupabase: meta.liveSupabase === true,
    verifier: meta.verifier,
    productionAuth: false,
    usedBodyId: false,
  };
}

function requestedId(body) {
  const src = body || {};
  if (src.personId) return String(src.personId);
  if (src.voterId) return String(src.voterId);
  if (src.actor && src.actor.id) return String(src.actor.id);
  if (typeof src.actor === 'string') return src.actor;
  return '';
}

function bindActor(actor, body) {
  if (!actor || actor.ok !== true || !actor.userId) {
    return { ok: false, reason: (actor && actor.reason) || 'AUTH_NOT_CONNECTED', stored: false, liveSupabase: false, productionAuth: false };
  }
  const requested = requestedId(body);
  if (requested && requested !== actor.userId) {
    return { ok: false, reason: 'PROXY_VOTE_FORBIDDEN', stored: false, liveSupabase: false, productionAuth: false, usedBodyId: false };
  }
  return { ok: true, userId: actor.userId, liveSupabase: actor.liveSupabase === true, verifier: actor.verifier, productionAuth: false };
}

function activityCountry(row) {
  const value = row.activity_region || row.activityRegion || '';
  const country = String(value || '').trim();
  if (country === 'KR' || country === 'US') return country;
  return '';
}

async function loadMembership() {
  const rankPolicy = citizenRank.evaluateCitizenRank({});
  const territoryCount = await population.getTerritoryPopulation('PIONEER', { clientPopulation: 1000 });
  if (!injectedReader) {
    return {
      ok: false,
      reason: 'MEMBER_SOURCE_NOT_CONNECTED',
      stored: false,
      representativesReady: false,
      liveSupabase: false,
      usedProfileTerritoryCount: false,
      territoryCountSource: territoryCount.source,
      rankPolicy: rankPolicy.reason,
    };
  }
  const loaded = await injectedReader();
  if (loaded && loaded.liveSupabase === true) {
    return { ok: false, reason: 'LIVE_SUPABASE_NOT_CALLED', stored: false, representativesReady: false, liveSupabase: false };
  }
  const rows = Array.isArray(loaded) ? loaded : (loaded && loaded.rows) || [];
  const members = [];
  let recorded = false;
  rows.forEach(function (row) {
    if (!row || row.id == null) return;
    const country = activityCountry(row);
    const normalized = territory.normalizeCanonicalMembershipTerritory(row.territory);
    if (!country || !normalized.ok || !normalized.territory) return;
    const rankSource = row.rankSource === 'rank-store' ? 'rank-store' : '';
    if (rankSource === 'rank-store') recorded = true;
    const recordedRank = rankSource === 'rank-store' ? row.rank : null;
    members.push({
      id: String(row.id),
      country: country,
      territory: normalized.territory,
      rank: recordedRank || 'citizen',
      rankSource: rankSource || 'not-finalized',
      valid: row.valid === true,
      lastPostAtMs: row.lastPostAtMs != null ? Number(row.lastPostAtMs) : null,
      lastCommentAtMs: row.lastCommentAtMs != null ? Number(row.lastCommentAtMs) : null,
      xp: row.xp,
      fame: row.fame,
      achievements: row.achievements,
    });
  });
  if (!recorded) {
    return {
      ok: false,
      reason: 'CITIZEN_RANK_POLICY_NOT_FINALIZED',
      stored: false,
      representativesReady: false,
      directory: { source: 'server-profile-read', members: members },
      liveSupabase: false,
      usedProfileTerritoryCount: false,
      rankPolicy: rankPolicy.reason,
    };
  }
  return {
    ok: true,
    representativesReady: true,
    directory: { source: 'server-profile-read', members: members },
    liveSupabase: false,
    usedProfileTerritoryCount: false,
    sameTransactionAsUserProgression: false,
    rankPolicy: rankPolicy.reason,
  };
}

module.exports = {
  setVerifierForTests: setVerifierForTests,
  clearVerifierForTests: clearVerifierForTests,
  setMembershipReaderForTests: setMembershipReaderForTests,
  clearMembershipReaderForTests: clearMembershipReaderForTests,
  resolveElectionActor: resolveElectionActor,
  bindActor: bindActor,
  loadMembership: loadMembership,
};
