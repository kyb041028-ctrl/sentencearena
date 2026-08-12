/**
 * 센텐스아레나 — 사용자 데이터 API Client
 *
 * 모드:
 *  - LEGACY_LOCAL: localStorage 기반 (기본값)
 *  - API_DRY_RUN: 요청 payload 변환·검증만. 실제 fetch 쓰기 호출 없음.
 *  - API_OPERATIONAL: 실제 서버 API 호출 (이번 작업에서 활성화 금지)
 */
(function (global) {
  'use strict';

  var cfg = global.UserDataConfigCore;
  var schema = global.UserDataSchemaCore;

  var BASE_URL = '';

  function getDataMode() {
    if (cfg) {
      return cfg.resolveUserDataMode({
        USER_DATA_MODE: (typeof process !== 'undefined' && process.env && process.env.USER_DATA_MODE) || '',
        USER_DATA_OPERATIONAL: (typeof process !== 'undefined' && process.env && process.env.USER_DATA_OPERATIONAL) || '',
      });
    }
    return 'LEGACY_LOCAL';
  }

  function isOperational() { return getDataMode() === 'API_OPERATIONAL'; }
  function isDryRun() { return getDataMode() === 'API_DRY_RUN'; }

  function getAuthToken() {
    if (global.ScAuth && typeof global.ScAuth.getAccessTokenSync === 'function') {
      return global.ScAuth.getAccessTokenSync();
    }
    return null;
  }

  function getCurrentUserId() {
    if (global.__scAuthUserId) return String(global.__scAuthUserId).trim();
    return (global.__scPlayer && global.__scPlayer.userId) || null;
  }

  function makeHeaders() {
    var h = { 'Content-Type': 'application/json' };
    var token = getAuthToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    var userId = getCurrentUserId();
    if (userId) h['x-sc-user-id'] = userId;
    return h;
  }

  function notActivatedResult() {
    return Promise.resolve({ ok: false, error: 'USER_DATA_API_NOT_ACTIVATED', mode: getDataMode() });
  }

  function dryRunResult(endpoint, method, payload, validationResult) {
    return Promise.resolve({
      ok: true,
      mode: 'API_DRY_RUN',
      endpoint: endpoint,
      method: method,
      payload: payload,
      validation: validationResult || { valid: true },
      note: 'API_DRY_RUN: 실제 서버 쓰기 미호출',
    });
  }

  async function apiRequest(method, path, body) {
    if (!isOperational()) return notActivatedResult();
    var url = BASE_URL + path;
    var opts = { method: method, headers: makeHeaders() };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    try {
      var resp = await fetch(url, opts);
      var data = await resp.json();
      return data;
    } catch (e) {
      return { ok: false, error: 'USER_DATA_NETWORK_ERROR', detail: String(e) };
    }
  }

  // ─── Profile ───────────────────────────────────────────────────────────────
  function getMyProfile() {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/me', null);
  }

  function getPublicProfile(userId) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/' + encodeURIComponent(userId) + '/profile', null);
  }

  function updateMyProfile(patch) {
    if (isDryRun()) {
      var val = schema ? schema.validateProfilePatch(patch) : { valid: true };
      return dryRunResult('/api/users/me/profile', 'PATCH', patch, val);
    }
    if (!isOperational()) return notActivatedResult();
    return apiRequest('PATCH', '/api/users/me/profile', patch);
  }

  // ─── Progression ───────────────────────────────────────────────────────────
  function getMyProgression() {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/me/progression', null);
  }

  function getPublicProgression(userId) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/' + encodeURIComponent(userId) + '/progression/public', null);
  }

  // ─── Follows ───────────────────────────────────────────────────────────────
  function toggleFollow(targetUserId) {
    if (isDryRun()) {
      var myId = getCurrentUserId() || '';
      var val = schema ? schema.validateFollowInput(myId, targetUserId) : { valid: true };
      return dryRunResult('/api/users/' + targetUserId + '/follow/toggle', 'POST', { targetUserId: targetUserId }, val);
    }
    if (!isOperational()) return notActivatedResult();
    return apiRequest('POST', '/api/users/' + encodeURIComponent(targetUserId) + '/follow/toggle', {});
  }

  function getFollowers(userId, opts) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/' + encodeURIComponent(userId) + '/followers', null);
  }

  function getFollowing(userId, opts) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/' + encodeURIComponent(userId) + '/following', null);
  }

  function getFollowState(targetUserId) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/' + encodeURIComponent(targetUserId) + '/follow-state', null);
  }

  // ─── Achievements ───────────────────────────────────────────────────────────
  function getAchievements(userId) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/' + encodeURIComponent(userId) + '/achievements', null);
  }

  function setFeaturedAchievements(keys) {
    if (isDryRun()) {
      var myId = getCurrentUserId() || '';
      var val = schema ? schema.validateFeaturedAchievements(myId, keys) : { valid: true };
      return dryRunResult('/api/users/me/featured-achievements', 'PUT', { keys: keys }, val);
    }
    if (!isOperational()) return notActivatedResult();
    return apiRequest('PUT', '/api/users/me/featured-achievements', { keys: keys });
  }

  // ─── Notifications ───────────────────────────────────────────────────────────
  function listNotifications(opts) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/me/notifications', null);
  }

  function markNotificationRead(notificationId) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('PATCH', '/api/users/me/notifications/' + encodeURIComponent(notificationId) + '/read', {});
  }

  function markAllNotificationsRead() {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('POST', '/api/users/me/notifications/read-all', {});
  }

  // ─── Activity ───────────────────────────────────────────────────────────────
  function listActivity(opts) {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/me/activity', null);
  }

  // ─── Bookmarks ───────────────────────────────────────────────────────────────
  function listBookmarks() {
    if (!isOperational()) return notActivatedResult();
    return apiRequest('GET', '/api/users/me/bookmarks', null);
  }

  function addBookmark(postId) {
    if (isDryRun()) {
      var myId = getCurrentUserId() || '';
      var val = schema ? schema.validateBookmark(myId, postId) : { valid: true };
      return dryRunResult('/api/users/me/bookmarks', 'POST', { postId: postId }, val);
    }
    if (!isOperational()) return notActivatedResult();
    return apiRequest('POST', '/api/users/me/bookmarks', { postId: postId });
  }

  function removeBookmark(postId) {
    if (isDryRun()) {
      return dryRunResult('/api/users/me/bookmarks/' + postId, 'DELETE', { postId: postId });
    }
    if (!isOperational()) return notActivatedResult();
    return apiRequest('DELETE', '/api/users/me/bookmarks/' + encodeURIComponent(postId), null);
  }

  // ─── 공개 API ───────────────────────────────────────────────────────────────
  global.UserDataApiClient = {
    getDataMode: getDataMode,
    isOperational: isOperational,
    isDryRun: isDryRun,
    getCurrentUserId: getCurrentUserId,

    // Profile
    getMyProfile: getMyProfile,
    getPublicProfile: getPublicProfile,
    updateMyProfile: updateMyProfile,

    // Progression
    getMyProgression: getMyProgression,
    getPublicProgression: getPublicProgression,

    // Follows
    toggleFollow: toggleFollow,
    getFollowers: getFollowers,
    getFollowing: getFollowing,
    getFollowState: getFollowState,

    // Achievements
    getAchievements: getAchievements,
    setFeaturedAchievements: setFeaturedAchievements,

    // Notifications
    listNotifications: listNotifications,
    markNotificationRead: markNotificationRead,
    markAllNotificationsRead: markAllNotificationsRead,

    // Activity
    listActivity: listActivity,

    // Bookmarks
    listBookmarks: listBookmarks,
    addBookmark: addBookmark,
    removeBookmark: removeBookmark,
  };
})(typeof window !== 'undefined' ? window : this);
