'use strict';
/**
 * 사용자 데이터 메모리 repository — API_DRY_RUN / 테스트 전용
 */

const cfg = require('../shared/user-data-config-core');

const uuidRe = cfg.UUID_RE;

function isUuid(v) { return typeof v === 'string' && uuidRe.test(v.trim()); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function now() { return new Date().toISOString(); }
function genId() { return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10); }

// ─── 인메모리 저장소 ─────────────────────────────────────────────────────────
const store = {
  profiles: new Map(),        // userId → profile
  progressions: new Map(),    // userId → progression
  progEvents: new Map(),      // dedupeKey → event
  follows: new Map(),         // `${follower}:${following}` → row
  achievements: new Map(),    // userId → achievement[]
  featuredAchievements: new Map(), // userId → {slot:key}[]
  notifications: new Map(),   // userId → notification[]
  activityEvents: new Map(),  // userId → event[]
  bookmarks: new Map(),       // userId → {postId}[]
};

// ─── Profile ─────────────────────────────────────────────────────────────────
async function getProfile(userId) {
  return clone(store.profiles.get(userId) || null);
}

async function updateProfile(userId, patch) {
  const existing = store.profiles.get(userId) || { id: userId, created_at: now() };
  const merged = Object.assign({}, existing, patch, { id: userId, updated_at: now() });
  store.profiles.set(userId, merged);
  return clone(merged);
}

// ─── Progression ─────────────────────────────────────────────────────────────
function defaultProgression(userId) {
  return { user_id: userId, xp: 0, level: 1, reputation_score: 0,
    citizen_rank: null, received_empathy_count: 0, follower_count: 0,
    following_count: 0, received_post_likes: 0, received_comment_likes: 0,
    updated_at: now(), created_at: now() };
}

async function getProgression(userId) {
  return clone(store.progressions.get(userId) || defaultProgression(userId));
}

async function getPublicProgression(userId) {
  const p = await getProgression(userId);
  return { user_id: p.user_id, level: p.level, reputation_score: p.reputation_score,
    citizen_rank: p.citizen_rank, follower_count: p.follower_count,
    following_count: p.following_count };
}

async function applyProgressionEvent(event) {
  const { userId, eventType, amount, sourceType, sourceId, dedupeKey, occurredAt } = event;
  if (store.progEvents.has(dedupeKey)) {
    return { status: 'DUPLICATE', dedupeKey };
  }
  let p = store.progressions.get(userId) || defaultProgression(userId);
  const amt = Number(amount) || 0;
  const reputationForbidDeduct = ['EMPATHY_RECEIVED', 'LIKE_RECEIVED', 'FOLLOWER_GAINED'];
  const newXp = Math.max(0, p.xp + amt);
  let newRep;
  if (reputationForbidDeduct.indexOf(eventType) !== -1) {
    newRep = Math.max(0, p.reputation_score + Math.max(0, amt));
  } else {
    newRep = Math.max(0, p.reputation_score + amt);
  }
  const newLevel = cfg.computeAutoLevelFromXp(newXp);
  p = Object.assign({}, p, { xp: newXp, reputation_score: newRep, level: newLevel, updated_at: now() });
  store.progressions.set(userId, p);
  store.progEvents.set(dedupeKey, { id: genId(), userId, eventType, amount: amt,
    sourceType, sourceId, dedupeKey, occurred_at: occurredAt || now() });
  return { status: 'APPLIED', newXp, newReputation: newRep, newLevel };
}

// ─── Follows ─────────────────────────────────────────────────────────────────
function followKey(a, b) { return a + ':' + b; }

async function followUser(followerUserId, followingUserId) {
  if (followerUserId === followingUserId) throw Object.assign(new Error('USER_DATA_FOLLOW_SELF_FORBIDDEN'), { code: 'USER_DATA_FOLLOW_SELF_FORBIDDEN' });
  const k = followKey(followerUserId, followingUserId);
  if (store.follows.has(k)) return { status: 'ALREADY_FOLLOWING' };
  store.follows.set(k, { follower_user_id: followerUserId, following_user_id: followingUserId, created_at: now() });
  const fp = store.progressions.get(followingUserId) || defaultProgression(followingUserId);
  store.progressions.set(followingUserId, Object.assign({}, fp, { follower_count: fp.follower_count + 1 }));
  const mp = store.progressions.get(followerUserId) || defaultProgression(followerUserId);
  store.progressions.set(followerUserId, Object.assign({}, mp, { following_count: mp.following_count + 1 }));
  return { status: 'FOLLOWED' };
}

async function unfollowUser(followerUserId, followingUserId) {
  const k = followKey(followerUserId, followingUserId);
  if (!store.follows.has(k)) return { status: 'NOT_FOLLOWING' };
  store.follows.delete(k);
  const fp = store.progressions.get(followingUserId) || defaultProgression(followingUserId);
  store.progressions.set(followingUserId, Object.assign({}, fp, { follower_count: Math.max(0, fp.follower_count - 1) }));
  const mp = store.progressions.get(followerUserId) || defaultProgression(followerUserId);
  store.progressions.set(followerUserId, Object.assign({}, mp, { following_count: Math.max(0, mp.following_count - 1) }));
  return { status: 'UNFOLLOWED' };
}

async function getFollowers(userId, paging) {
  const items = [];
  for (const [, row] of store.follows) {
    if (row.following_user_id === userId) items.push(clone(row));
  }
  return items;
}

async function getFollowing(userId, paging) {
  const items = [];
  for (const [, row] of store.follows) {
    if (row.follower_user_id === userId) items.push(clone(row));
  }
  return items;
}

async function getFollowState(viewerUserId, targetUserId) {
  const isFollowing = store.follows.has(followKey(viewerUserId, targetUserId));
  const isFollowedBy = store.follows.has(followKey(targetUserId, viewerUserId));
  return { isFollowing, isFollowedBy, isMutual: isFollowing && isFollowedBy };
}

// ─── Achievements ─────────────────────────────────────────────────────────────
async function getAchievements(userId) {
  return clone(store.achievements.get(userId) || []);
}

async function grantAchievement(input) {
  const { userId, achievementKey, acquiredAt, acquisitionSequence, seasonKey, metadata } = input;
  let list = store.achievements.get(userId) || [];
  const exists = list.some(function(a) {
    return a.achievement_key === achievementKey &&
      ((seasonKey == null && a.season_key == null) || a.season_key === seasonKey);
  });
  if (exists) return { status: 'ALREADY_GRANTED' };
  const newRow = { user_id: userId, achievement_key: achievementKey,
    acquired_at: acquiredAt, acquisition_sequence: acquisitionSequence,
    season_key: seasonKey || null, metadata: metadata || {}, created_at: now() };
  list = list.concat([newRow]);
  store.achievements.set(userId, list);
  return { status: 'GRANTED' };
}

async function setFeaturedAchievements(userId, keys) {
  const list = store.achievements.get(userId) || [];
  const ownedKeys = list.map(function(a) { return a.achievement_key; });
  const invalid = (keys || []).filter(function(k) { return k && ownedKeys.indexOf(k) === -1; });
  if (invalid.length > 0) {
    throw Object.assign(new Error('USER_DATA_ACHIEVEMENT_NOT_OWNED'), { code: 'USER_DATA_ACHIEVEMENT_NOT_OWNED', keys: invalid });
  }
  const featured = (keys || []).slice(0, 3).filter(Boolean).map(function(k, i) {
    return { user_id: userId, slot: i + 1, achievement_key: k, updated_at: now() };
  });
  store.featuredAchievements.set(userId, featured);
  return { status: 'SET', slots: featured };
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function listNotifications(userId, paging) {
  return clone(store.notifications.get(userId) || []);
}

async function markNotificationRead(userId, notificationId) {
  const list = store.notifications.get(userId) || [];
  const idx = list.findIndex(function(n) { return n.id === notificationId; });
  if (idx === -1) throw Object.assign(new Error('USER_DATA_NOTIFICATION_NOT_FOUND'), { code: 'USER_DATA_NOTIFICATION_NOT_FOUND' });
  list[idx] = Object.assign({}, list[idx], { is_read: true, read_at: now() });
  store.notifications.set(userId, list);
  return { status: 'READ' };
}

async function markAllNotificationsRead(userId) {
  const list = (store.notifications.get(userId) || []).map(function(n) {
    return Object.assign({}, n, { is_read: true, read_at: n.read_at || now() });
  });
  store.notifications.set(userId, list);
  return { status: 'ALL_READ' };
}

async function appendNotification(notification) {
  const uid = notification.user_id;
  let list = store.notifications.get(uid) || [];
  list = [Object.assign({ id: genId(), is_read: false, created_at: now() }, notification)].concat(list);
  if (list.length > 50) list = list.slice(0, 50);
  store.notifications.set(uid, list);
  return { status: 'OK' };
}

// ─── Activity ─────────────────────────────────────────────────────────────────
async function listActivityEvents(userId, paging) {
  return clone(store.activityEvents.get(userId) || []);
}

async function appendActivityEvent(event) {
  const uid = event.user_id;
  let list = store.activityEvents.get(uid) || [];
  list = [Object.assign({ id: genId(), occurred_at: now(), created_at: now() }, event)].concat(list);
  store.activityEvents.set(uid, list);
  return { status: 'OK' };
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────
async function listBookmarks(userId) {
  return clone(store.bookmarks.get(userId) || []);
}

async function addBookmark(userId, postId) {
  let list = store.bookmarks.get(userId) || [];
  if (list.some(function(b) { return b.post_id === postId; })) return { status: 'ALREADY_EXISTS' };
  list = [{ user_id: userId, post_id: postId, created_at: now() }].concat(list);
  store.bookmarks.set(userId, list);
  return { status: 'ADDED' };
}

async function removeBookmark(userId, postId) {
  let list = store.bookmarks.get(userId) || [];
  const next = list.filter(function(b) { return b.post_id !== postId; });
  store.bookmarks.set(userId, next);
  return { status: 'REMOVED' };
}

// ─── 테스트용 리셋 ────────────────────────────────────────────────────────────
function _resetStore() {
  store.profiles.clear();
  store.progressions.clear();
  store.progEvents.clear();
  store.follows.clear();
  store.achievements.clear();
  store.featuredAchievements.clear();
  store.notifications.clear();
  store.activityEvents.clear();
  store.bookmarks.clear();
}

module.exports = {
  getProfile, updateProfile,
  getProgression, getPublicProgression, applyProgressionEvent,
  followUser, unfollowUser, getFollowers, getFollowing, getFollowState,
  getAchievements, grantAchievement, setFeaturedAchievements,
  listNotifications, markNotificationRead, markAllNotificationsRead, appendNotification,
  listActivityEvents, appendActivityEvent,
  listBookmarks, addBookmark, removeBookmark,
  _resetStore,
};
