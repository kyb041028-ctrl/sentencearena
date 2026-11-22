'use strict';
/**
 * 사용자 데이터 Service
 * - 인증·게스트 차단·입력 검증·공개/비공개 분리
 * - repository 오류를 안전한 에러코드로 변환
 * - 서버 계산 필드 클라이언트 변경 차단
 */

const cfg = require('../shared/user-data-config-core');
const schema = require('../shared/user-data-schema-core');
const mapper = require('./user-data-mapper');

let _userRepo = null;
let _adminRepo = null;
let _dataMode = cfg.DATA_MODES.LEGACY_LOCAL;

function setUserRepository(repo) { _userRepo = repo; }
function setAdminRepository(repo) { _adminRepo = repo; }
function setRepository(repo) { _userRepo = repo; _adminRepo = repo; }
function setDataMode(mode) { _dataMode = mode; }
function getDataMode() { return _dataMode; }

function requireUserRepo() {
  if (!_userRepo) throw makeError('USER_DATA_API_NOT_ACTIVATED', 503);
}

function requireAdminRepo() {
  if (!_adminRepo) throw makeError('USER_DATA_API_NOT_ACTIVATED', 503);
}

function isActivated() { return _dataMode === cfg.DATA_MODES.API_OPERATIONAL; }

function requireActivated() {
  if (!isActivated()) {
    throw makeError('USER_DATA_API_NOT_ACTIVATED', 503);
  }
}

function requireRepo() {
  readRepo();
}

function readRepo() {
  const repo = _adminRepo || _userRepo;
  if (!repo) throw makeError('USER_DATA_API_NOT_ACTIVATED', 503);
  return repo;
}

function mutationUserRepo() {
  if (!_userRepo) throw makeError('USER_DATA_API_NOT_ACTIVATED', 503);
  return _userRepo;
}

function makeError(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 400;
  return err;
}

function sanitizeRepoError(err) {
  const code = (err && err.code) || 'USER_DATA_INTERNAL_ERROR';
  const safe = makeError(code, err && err.status);
  return safe;
}

// ─── User ID 검증 ─────────────────────────────────────────────────────────────
function resolveOperationalUserId(rawUserId) {
  const r = schema.validateUserId(rawUserId, { strict: true });
  if (!r.valid) throw makeError(r.error, 400);
  return r.userId;
}

// ─── Profile ─────────────────────────────────────────────────────────────────
async function getMyProfile(requestingUserId, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try {
    const profile = await readRepo().getProfile(uid);
    const progression = await readRepo().getPublicProgression(uid, region);
    const view = mapper.toPublicProfile(profile, progression, null);
    if (view) {
      view.activityRegion = region;
      view.followerCountSource = 'country';
    }
    return view;
  } catch (e) { throw sanitizeRepoError(e); }
}

async function getPublicProfile(targetUserId, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try {
    const profile = await readRepo().getProfile(uid);
    const progression = await readRepo().getPublicProgression(uid, region);
    const featured = await readRepo().getAchievements ? null : null;
    const view = schema.filterPublicProfile(mapper.toPublicProfile(profile, progression, featured));
    if (view) {
      view.activityRegion = region;
      view.followerCountSource = 'country';
    }
    return view;
  } catch (e) { throw sanitizeRepoError(e); }
}

async function updateMyProfile(requestingUserId, patch) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const result = schema.validateProfilePatch(patch);
  if (!result.valid) throw makeError(result.errors[0], 400);
  // 서버 계산 필드 제거
  const safePatch = {};
  Object.keys(patch || {}).forEach(function(k) {
    if (cfg.isProfileEditableField(k)) safePatch[k] = patch[k];
  });
  try {
    return await readRepo().updateProfile(uid, safePatch);
  } catch (e) { throw sanitizeRepoError(e); }
}

// ─── Progression ─────────────────────────────────────────────────────────────
async function getMyProgression(requestingUserId, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try {
    return mapper.toProgressionResponse(await readRepo().getProgression(uid, region));
  } catch (e) { throw sanitizeRepoError(e); }
}

async function getPublicProgression(targetUserId, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try {
    return mapper.toPublicProgressionResponse(await readRepo().getPublicProgression(uid, region));
  } catch (e) { throw sanitizeRepoError(e); }
}

// 클라이언트 직접 progression patch 금지
async function patchProgression() {
  throw makeError('USER_DATA_PROGRESSION_WRITE_FORBIDDEN', 403);
}

// ─── Follows ─────────────────────────────────────────────────────────────────
function countryOf(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  if (text === 'KR' || text === 'US') return text;
  return null;
}

function serverTerritory(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  if (text === 'PIONEER' || text === 'CENTRAL' || text === 'GUARDIAN') return text;
  return null;
}

async function followContext(userId, activityRegion) {
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  let raw = null;
  let countryReady = false;
  if (typeof readRepo().readCountryAffiliation === 'function') {
    const got = await readRepo().readCountryAffiliation(userId, region);
    if (got && got.available) {
      countryReady = true;
      raw = got.territory;
    }
  }
  if (!countryReady && typeof readRepo().readMemberTerritory === 'function') {
    raw = await readRepo().readMemberTerritory(userId);
  }
  const territory = serverTerritory(raw);
  if (!territory) throw makeError('FOLLOW_SCOPE_UNKNOWN', 400);
  return { activityRegion: region, territory: territory };
}

async function toggleFollow(requestingUserId, targetUserId, activityRegion) {
  requireActivated();
  requireUserRepo();
  const follower = resolveOperationalUserId(requestingUserId);
  const following = resolveOperationalUserId(targetUserId);
  const r = schema.validateFollowInput(follower, following);
  if (!r.valid) throw makeError(r.errors[0], 400);
  try {
    const context = await followContext(follower, activityRegion);
    const state = await readRepo().getFollowState(follower, following, context.activityRegion);
    if (state.isFollowing) {
      return await mutationUserRepo().unfollowUser(follower, following, context);
    }
    const result = await mutationUserRepo().followUser(follower, following, context);
    if (result && result.status === 'FOLLOWED' && typeof mutationUserRepo().recordCountryFeed === 'function') {
      await mutationUserRepo().recordCountryFeed({
        userId: following,
        region: context.activityRegion,
        eventType: 'FOLLOW',
        sourceId: follower + ':' + following,
        text: 'follow',
      });
    }
    return result;
  } catch (e) { throw sanitizeRepoError(e); }
}

async function getFollowers(targetUserId, paging, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try { return await readRepo().getFollowers(uid, paging, region); } catch (e) { throw sanitizeRepoError(e); }
}

async function getFollowing(targetUserId, paging, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try { return await readRepo().getFollowing(uid, paging, region); } catch (e) { throw sanitizeRepoError(e); }
}

async function getFollowState(viewerUserId, targetUserId, activityRegion) {
  requireActivated();
  requireRepo();
  const viewer = resolveOperationalUserId(viewerUserId);
  const target = resolveOperationalUserId(targetUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try { return await readRepo().getFollowState(viewer, target, region); } catch (e) { throw sanitizeRepoError(e); }
}

// ─── Achievements ─────────────────────────────────────────────────────────────
async function getAchievements(targetUserId) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  try {
    const list = await readRepo().getAchievements(uid);
    return list.map(mapper.toAchievementResponse);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function setFeaturedAchievements(requestingUserId, keys) {
  requireActivated();
  requireUserRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const r = schema.validateFeaturedAchievements(uid, keys);
  if (!r.valid) throw makeError(r.errors[0], 400);
  try {
    return await mutationUserRepo().setFeaturedAchievements(uid, keys);
  } catch (e) { throw sanitizeRepoError(e); }
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function listNotifications(requestingUserId, paging, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try {
    const list = await readRepo().listNotifications(uid, paging, region);
    return list.map(mapper.toNotificationResponse);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function markNotificationRead(requestingUserId, notificationId, activityRegion) {
  requireActivated();
  requireUserRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try {
    return await mutationUserRepo().markNotificationRead(uid, notificationId, region);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function markAllNotificationsRead(requestingUserId, activityRegion) {
  requireActivated();
  requireUserRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try { return await mutationUserRepo().markAllNotificationsRead(uid, region); } catch (e) { throw sanitizeRepoError(e); }
}

// ─── Activity ─────────────────────────────────────────────────────────────────
async function listActivity(requestingUserId, paging, activityRegion) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  try {
    const list = await readRepo().listActivityEvents(uid, paging, region);
    return list.map(mapper.toActivityEventResponse);
  } catch (e) { throw sanitizeRepoError(e); }
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────
async function listBookmarks(requestingUserId) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try {
    const list = await readRepo().listBookmarks(uid);
    return list.map(mapper.toBookmarkResponse);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function addBookmark(requestingUserId, postId) {
  requireActivated();
  requireUserRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  const r = schema.validateBookmark(uid, postId);
  if (!r.valid) throw makeError(r.errors[0], 400);
  try { return await mutationUserRepo().addBookmark(uid, postId); } catch (e) { throw sanitizeRepoError(e); }
}

async function removeBookmark(requestingUserId, postId) {
  requireActivated();
  requireUserRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try { return await mutationUserRepo().removeBookmark(uid, postId); } catch (e) { throw sanitizeRepoError(e); }
}

// ─── Full public / self profile (assembler) ───────────────────────────────────
const profileAssembler = require('./user-profile-assembler');

function syncAssemblerRepo() {
  profileAssembler.setRepository(_adminRepo || _userRepo);
}

async function getPublicUserProfileFull(viewerUserId, targetUserId, activityRegion) {
  requireActivated();
  requireRepo();
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  syncAssemblerRepo();
  try {
    return await profileAssembler.getPublicUserProfile({
      viewerUserId: viewerUserId || null,
      targetUserId: targetUserId,
      mode: _dataMode,
      activityRegion: region,
    });
  } catch (e) { throw sanitizeRepoError(e); }
}

async function getSelfUserProfileFull(requestingUserId, activityRegion) {
  requireActivated();
  requireRepo();
  const region = countryOf(activityRegion);
  if (!region) throw makeError('COUNTRY_REQUIRED', 400);
  syncAssemblerRepo();
  try {
    return await profileAssembler.getSelfUserProfile({
      userId: requestingUserId,
      mode: _dataMode,
      activityRegion: region,
    });
  } catch (e) { throw sanitizeRepoError(e); }
}

module.exports = {
  setRepository, setUserRepository, setAdminRepository, setDataMode, getDataMode, isActivated,
  getMyProfile, getPublicProfile, updateMyProfile,
  getMyProgression, getPublicProgression, patchProgression,
  toggleFollow, getFollowers, getFollowing, getFollowState,
  getAchievements, setFeaturedAchievements,
  listNotifications, markNotificationRead, markAllNotificationsRead,
  listActivity, listBookmarks, addBookmark, removeBookmark,
  getPublicUserProfileFull, getSelfUserProfileFull,
};
