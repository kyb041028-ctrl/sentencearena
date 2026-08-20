'use strict';
/**
 * 사용자 프로필 assembler
 * profiles + progression + featured + follow + territory + alignmentMap → public contract
 */

const cfg = require('../shared/user-data-config-core');
const schema = require('../shared/user-data-schema-core');
const publicProfile = require('../shared/public-profile-core');
const territoryAdapter = require('./user-profile-territory-adapter');
const alignmentMapAdapter = require('./user-profile-alignment-map-adapter');

let _repo = null;
let _achievementDefinitions = {};

function setRepository(repo) {
  _repo = repo;
}

function setAchievementDefinitions(defs) {
  _achievementDefinitions = defs || {};
}

function makeError(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 400;
  return err;
}

function requireRepo() {
  if (!_repo) throw makeError('USER_DATA_API_NOT_ACTIVATED', 503);
}

function safeCall(fn, fallback) {
  return Promise.resolve()
    .then(fn)
    .catch(function () {
      return fallback;
    });
}

async function loadFeaturedForUser(userId) {
  requireRepo();
  let featuredRows = [];
  if (typeof _repo.getFeaturedAchievements === 'function') {
    featuredRows = (await _repo.getFeaturedAchievements(userId)) || [];
  } else if (_repo._getFeaturedAchievements) {
    featuredRows = (await _repo._getFeaturedAchievements(userId)) || [];
  }

  const owned = (await safeCall(function () {
    return _repo.getAchievements(userId);
  }, [])) || [];
  const ownedMap = {};
  owned.forEach(function (a) {
    ownedMap[a.achievement_key || a.achievementKey] = a;
  });

  const enriched = (featuredRows || []).map(function (row) {
    const key = row.achievement_key || row.achievementKey;
    const ownedRow = ownedMap[key];
    return {
      slot: row.slot,
      achievement_key: key,
      owned: !!ownedRow,
      acquired_at: ownedRow && (ownedRow.acquired_at || ownedRow.acquiredAt),
      acquisition_sequence: ownedRow && (ownedRow.acquisition_sequence || ownedRow.acquisitionSequence),
      season_key: ownedRow && (ownedRow.season_key || ownedRow.seasonKey),
    };
  });

  const mapped = publicProfile.mapFeaturedAchievements(enriched, _achievementDefinitions);
  return mapped;
}

/**
 * 공개 프로필
 * @param {{ viewerUserId?: string, targetUserId: string, mode?: string }} input
 */
async function getPublicUserProfile(input) {
  const src = input || {};
  const frozen = Object.freeze(Object.assign({}, src));
  requireRepo();

  const idCheck = schema.validateUserId(frozen.targetUserId, { strict: true });
  if (!idCheck.valid) throw makeError(idCheck.error || 'USER_DATA_USER_ID_INVALID', 400);
  const targetUserId = idCheck.userId;
  const viewerUserId = frozen.viewerUserId
    ? (schema.validateUserId(frozen.viewerUserId, { strict: true }).valid
      ? String(frozen.viewerUserId).trim()
      : null)
    : null;

  const profile = await safeCall(function () {
    return _repo.getProfile(targetUserId);
  }, null);

  if (!profile) {
    return publicProfile.buildNotFoundProfileViewModel(targetUserId);
  }

  if (profile.account_state === 'DELETED' || profile.deleted_at || profile.is_deleted) {
    return publicProfile.buildDeletedProfileViewModel(targetUserId);
  }

  if (profile.profile_visibility === 'PRIVATE' || profile.is_private) {
    const progressionLite = await safeCall(function () {
      return _repo.getPublicProgression(targetUserId);
    }, null);
    return publicProfile.buildPrivateProfileViewModel(targetUserId, {
      displayName: profile.display_name || profile.displayName,
      avatarUrl: profile.avatar_url || profile.avatarUrl,
      level: progressionLite && progressionLite.level,
      followerCount: progressionLite && progressionLite.follower_count,
      followingCount: progressionLite && progressionLite.following_count,
    });
  }

  const progression = await safeCall(function () {
    return _repo.getPublicProgression(targetUserId);
  }, null);

  const followState = viewerUserId
    ? await safeCall(function () {
      return _repo.getFollowState(viewerUserId, targetUserId);
    }, { isFollowing: false, isFollowedBy: false })
    : { isFollowing: false, isFollowedBy: false };

  const featuredResult = await safeCall(function () {
    return loadFeaturedForUser(targetUserId);
  }, { items: [], warnings: [] });

  const territoryInfo = await territoryAdapter.getProfileTerritory(targetUserId, {
    profileRow: profile,
    mode: frozen.mode || 'API_OPERATIONAL',
    clientTerritory: frozen.clientTerritory,
  });

  const alignmentMap = await alignmentMapAdapter.getPublicAlignmentMap(targetUserId, {
    mode: frozen.mode || 'API_OPERATIONAL',
  });

  let politicalProfileVisibility = 'private';
  try {
    const { createLegalGateService } = require('./legal-gate-service');
    const st = await createLegalGateService().getStatus(targetUserId);
    politicalProfileVisibility = st.politicalProfileVisibility || 'private';
  } catch (_) {}

  return publicProfile.mapPublicUserProfile({
    profile: profile,
    progression: progression || {},
    followState: followState,
    territoryInfo: territoryInfo,
    alignmentMap: alignmentMap,
    politicalProfileVisibility: politicalProfileVisibility,
    featuredAchievements: featuredResult.items,
    viewerUserId: viewerUserId,
    targetUserId: targetUserId,
    dataStatus: publicProfile.DATA_STATUS.READY,
    accountState: publicProfile.ACCOUNT_STATE.ACTIVE,
  });
}

/**
 * 본인 프로필 (XP 포함)
 */
async function getSelfUserProfile(input) {
  const src = input || {};
  const frozen = Object.freeze(Object.assign({}, src));
  requireRepo();

  const idCheck = schema.validateUserId(frozen.userId, { strict: true });
  if (!idCheck.valid) throw makeError(idCheck.error || 'USER_DATA_USER_ID_INVALID', 400);
  const userId = idCheck.userId;

  const profile = await safeCall(function () {
    return _repo.getProfile(userId);
  }, null);

  if (!profile) {
    return publicProfile.buildNotFoundProfileViewModel(userId);
  }

  const progression = await safeCall(function () {
    return _repo.getProgression(userId);
  }, null);

  const featuredResult = await safeCall(function () {
    return loadFeaturedForUser(userId);
  }, { items: [], warnings: [] });

  const territoryInfo = await territoryAdapter.getProfileTerritory(userId, {
    profileRow: profile,
    mode: frozen.mode || 'API_OPERATIONAL',
  });

  const alignmentMap = await alignmentMapAdapter.getPublicAlignmentMap(userId, {
    mode: frozen.mode || 'API_OPERATIONAL',
  });

  return publicProfile.mapSelfUserProfile({
    profile: profile,
    progression: progression || {},
    followState: { isFollowing: false, isFollowedBy: false },
    territoryInfo: territoryInfo,
    alignmentMap: alignmentMap,
    featuredAchievements: featuredResult.items,
    targetUserId: userId,
    dataStatus: publicProfile.DATA_STATUS.READY,
    accountState: publicProfile.ACCOUNT_STATE.ACTIVE,
  });
}

module.exports = {
  setRepository,
  setAchievementDefinitions,
  getPublicUserProfile,
  getSelfUserProfile,
  loadFeaturedForUser,
};
