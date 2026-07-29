'use strict';
/**
 * 사용자 데이터 Supabase repository — API_OPERATIONAL 전용
 * userClient: authenticated JWT (사용자 직접 RPC)
 * adminClient: service-role (서버 계산 전용)
 */

let _userClient = null;
let _adminClient = null;

function setUserClient(client) {
  _userClient = client;
}

function setAdminClient(client) {
  _adminClient = client;
}

function getUser() {
  if (!_userClient) throw Object.assign(new Error('USER_DATA_USER_CLIENT_NOT_CONFIGURED'), { code: 'USER_DATA_USER_CLIENT_NOT_CONFIGURED' });
  return _userClient;
}

function getAdmin() {
  if (!_adminClient) throw Object.assign(new Error('USER_DATA_API_NOT_ACTIVATED'), { code: 'USER_DATA_API_NOT_ACTIVATED' });
  return _adminClient;
}

function handleError(err) {
  if (!err) return;
  const code = err.code || err.message || 'USER_DATA_DB_ERROR';
  throw Object.assign(new Error(code), { code, dbError: true });
}

// ─── Profile (admin read/write) ───────────────────────────────────────────────
async function getProfile(userId) {
  const sb = getAdmin();
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) handleError(error);
  return data || null;
}

async function updateProfile(userId, patch) {
  const sb = getAdmin();
  const { data, error } = await sb.from('profiles')
    .update(Object.assign({}, patch, { id: userId }))
    .eq('id', userId)
    .select()
    .maybeSingle();
  if (error) handleError(error);
  return data;
}

// ─── Progression (admin only) ────────────────────────────────────────────────
async function getProgression(userId) {
  const sb = getAdmin();
  const { data, error } = await sb.from('user_progression').select('*').eq('user_id', userId).maybeSingle();
  if (error) handleError(error);
  return data || null;
}

async function getPublicProgression(userId) {
  const sb = getAdmin();
  const { data, error } = await sb
    .from('user_progression')
    .select('user_id, level, reputation_score, citizen_rank, follower_count, following_count')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) handleError(error);
  return data || null;
}

async function applyProgressionEvent(event) {
  const sb = getAdmin();
  const { data, error } = await sb.rpc('apply_user_progression_event', {
    p_user_id: event.userId,
    p_event_type: event.eventType,
    p_amount: event.amount,
    p_source_type: event.sourceType || null,
    p_source_id: event.sourceId || null,
    p_dedupe_key: event.dedupeKey,
    p_occurred_at: event.occurredAt || new Date().toISOString(),
  });
  if (error) handleError(error);
  return data;
}

// ─── Follows (user JWT RPC) ──────────────────────────────────────────────────
async function toggleFollowAsUser(followerUserId, followingUserId) {
  const sb = getUser();
  const { data, error } = await sb.rpc('toggle_user_follow', {
    p_following_user_id: followingUserId,
  });
  if (error) handleError(error);
  return data;
}

async function followUser(followerUserId, followingUserId) {
  return toggleFollowAsUser(followerUserId, followingUserId);
}

async function unfollowUser(followerUserId, followingUserId) {
  return toggleFollowAsUser(followerUserId, followingUserId);
}

async function getFollowers(userId, paging) {
  const sb = getAdmin();
  const { data, error } = await sb
    .from('user_follows')
    .select('follower_user_id, created_at')
    .eq('following_user_id', userId)
    .order('created_at', { ascending: false })
    .limit((paging && paging.limit) || 50);
  if (error) handleError(error);
  return data || [];
}

async function getFollowing(userId, paging) {
  const sb = getAdmin();
  const { data, error } = await sb
    .from('user_follows')
    .select('following_user_id, created_at')
    .eq('follower_user_id', userId)
    .order('created_at', { ascending: false })
    .limit((paging && paging.limit) || 50);
  if (error) handleError(error);
  return data || [];
}

async function getFollowState(viewerUserId, targetUserId) {
  const sb = getAdmin();
  const [r1, r2] = await Promise.all([
    sb.from('user_follows').select('follower_user_id').eq('follower_user_id', viewerUserId).eq('following_user_id', targetUserId).maybeSingle(),
    sb.from('user_follows').select('follower_user_id').eq('follower_user_id', targetUserId).eq('following_user_id', viewerUserId).maybeSingle(),
  ]);
  const isFollowing = !!(r1.data);
  const isFollowedBy = !!(r2.data);
  return { isFollowing, isFollowedBy, isMutual: isFollowing && isFollowedBy };
}

// ─── Achievements ─────────────────────────────────────────────────────────────
async function getAchievements(userId) {
  const sb = getAdmin();
  const { data, error } = await sb.from('user_achievements').select('*').eq('user_id', userId).order('acquisition_sequence');
  if (error) handleError(error);
  return data || [];
}

async function grantAchievement(input) {
  const sb = getAdmin();
  const { data, error } = await sb.rpc('grant_user_achievement', {
    p_user_id: input.userId,
    p_achievement_key: input.achievementKey,
    p_acquired_at: input.acquiredAt,
    p_acquisition_sequence: input.acquisitionSequence,
    p_season_key: input.seasonKey || null,
    p_metadata: input.metadata || {},
  });
  if (error) handleError(error);
  return data;
}

async function setFeaturedAchievements(userId, keys) {
  const sb = getUser();
  const safeKeys = (keys || []).slice(0, 3).concat([null, null, null]).slice(0, 3);
  const { data, error } = await sb.rpc('set_featured_achievements', {
    p_slot1_key: safeKeys[0] || null,
    p_slot2_key: safeKeys[1] || null,
    p_slot3_key: safeKeys[2] || null,
  });
  if (error) handleError(error);
  return data;
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function listNotifications(userId, paging) {
  const sb = getAdmin();
  const { data, error } = await sb
    .from('user_notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit((paging && paging.limit) || 50);
  if (error) handleError(error);
  return data || [];
}

async function markNotificationRead(userId, notificationId) {
  const sb = getUser();
  const { data, error } = await sb.rpc('mark_user_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) handleError(error);
  return data;
}

async function markAllNotificationsRead(userId) {
  const sb = getUser();
  const { data, error } = await sb.rpc('mark_user_notification_read', {
    p_notification_id: null,
  });
  if (error) handleError(error);
  return data;
}

async function appendNotification(notification) {
  const sb = getAdmin();
  const { data, error } = await sb.from('user_notifications').insert(notification).select().maybeSingle();
  if (error) handleError(error);
  return data;
}

// ─── Activity (admin only) ────────────────────────────────────────────────────
async function listActivityEvents(userId, paging) {
  const sb = getAdmin();
  const { data, error } = await sb
    .from('user_activity_events')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit((paging && paging.limit) || 50);
  if (error) handleError(error);
  return data || [];
}

async function appendActivityEvent(event) {
  const sb = getAdmin();
  const { data, error } = await sb.from('user_activity_events').insert(event).select().maybeSingle();
  if (error) handleError(error);
  return data;
}

// ─── Bookmarks (user JWT RPC) ─────────────────────────────────────────────────
async function listBookmarks(userId) {
  const sb = getAdmin();
  const { data, error } = await sb
    .from('user_bookmarks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) handleError(error);
  return data || [];
}

async function addBookmark(userId, postId) {
  const sb = getUser();
  const { data, error } = await sb.rpc('create_user_bookmark', {
    p_post_id: postId,
  });
  if (error) handleError(error);
  return data;
}

async function removeBookmark(userId, postId) {
  const sb = getUser();
  const { data, error } = await sb.rpc('remove_user_bookmark', {
    p_post_id: postId,
  });
  if (error) handleError(error);
  return data;
}

module.exports = {
  setUserClient,
  setAdminClient,
  getProfile, updateProfile,
  getProgression, getPublicProgression, applyProgressionEvent,
  toggleFollowAsUser, followUser, unfollowUser, getFollowers, getFollowing, getFollowState,
  getAchievements, grantAchievement, setFeaturedAchievements,
  listNotifications, markNotificationRead, markAllNotificationsRead, appendNotification,
  listActivityEvents, appendActivityEvent,
  listBookmarks, addBookmark, removeBookmark,
};
