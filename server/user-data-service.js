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
async function getMyProfile(requestingUserId) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try {
    const profile = await readRepo().getProfile(uid);
    const progression = await readRepo().getPublicProgression(uid);
    return mapper.toPublicProfile(profile, progression, null);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function getPublicProfile(targetUserId) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  try {
    const profile = await readRepo().getProfile(uid);
    const progression = await readRepo().getPublicProgression(uid);
    const featured = await readRepo().getAchievements ? null : null;
    return schema.filterPublicProfile(mapper.toPublicProfile(profile, progression, featured));
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
async function getMyProgression(requestingUserId) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try {
    return mapper.toProgressionResponse(await readRepo().getProgression(uid));
  } catch (e) { throw sanitizeRepoError(e); }
}

async function getPublicProgression(targetUserId) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  try {
    return mapper.toPublicProgressionResponse(await readRepo().getPublicProgression(uid));
  } catch (e) { throw sanitizeRepoError(e); }
}

// 클라이언트 직접 progression patch 금지
async function patchProgression() {
  throw makeError('USER_DATA_PROGRESSION_WRITE_FORBIDDEN', 403);
}

// ─── Follows ─────────────────────────────────────────────────────────────────
async function toggleFollow(requestingUserId, targetUserId) {
  requireActivated();
  requireUserRepo();
  const follower = resolveOperationalUserId(requestingUserId);
  const following = resolveOperationalUserId(targetUserId);
  const r = schema.validateFollowInput(follower, following);
  if (!r.valid) throw makeError(r.errors[0], 400);
  try {
    const state = await readRepo().getFollowState(follower, following);
    if (state.isFollowing) {
      return await mutationUserRepo().unfollowUser(follower, following);
    }
    return await mutationUserRepo().followUser(follower, following);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function getFollowers(targetUserId, paging) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  try { return await readRepo().getFollowers(uid, paging); } catch (e) { throw sanitizeRepoError(e); }
}

async function getFollowing(targetUserId, paging) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(targetUserId);
  try { return await readRepo().getFollowing(uid, paging); } catch (e) { throw sanitizeRepoError(e); }
}

async function getFollowState(viewerUserId, targetUserId) {
  requireActivated();
  requireRepo();
  const viewer = resolveOperationalUserId(viewerUserId);
  const target = resolveOperationalUserId(targetUserId);
  try { return await readRepo().getFollowState(viewer, target); } catch (e) { throw sanitizeRepoError(e); }
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
async function listNotifications(requestingUserId, paging) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try {
    const list = await readRepo().listNotifications(uid, paging);
    return list.map(mapper.toNotificationResponse);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function markNotificationRead(requestingUserId, notificationId) {
  requireActivated();
  requireUserRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try {
    return await mutationUserRepo().markNotificationRead(uid, notificationId);
  } catch (e) { throw sanitizeRepoError(e); }
}

async function markAllNotificationsRead(requestingUserId) {
  requireActivated();
  requireUserRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try { return await mutationUserRepo().markAllNotificationsRead(uid); } catch (e) { throw sanitizeRepoError(e); }
}

// ─── Activity ─────────────────────────────────────────────────────────────────
async function listActivity(requestingUserId, paging) {
  requireActivated();
  requireRepo();
  const uid = resolveOperationalUserId(requestingUserId);
  try {
    const list = await readRepo().listActivityEvents(uid, paging);
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

module.exports = {
  setRepository, setUserRepository, setAdminRepository, setDataMode, getDataMode, isActivated,
  getMyProfile, getPublicProfile, updateMyProfile,
  getMyProgression, getPublicProgression, patchProgression,
  toggleFollow, getFollowers, getFollowing, getFollowState,
  getAchievements, setFeaturedAchievements,
  listNotifications, markNotificationRead, markAllNotificationsRead,
  listActivity, listBookmarks, addBookmark, removeBookmark,
};
