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
  if (typeof sb.query === 'function') {
    const res = await sb.query('SELECT * FROM public.profiles WHERE id = $1', [userId]);
    return res.rows[0] || null;
  }
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
async function countryFollowCounts(userId, region) {
  const country = countryOf(region);
  if (!country) {
    throw Object.assign(new Error('COUNTRY_REQUIRED'), { code: 'COUNTRY_REQUIRED', status: 400 });
  }
  const sb = getAdmin();
  if (typeof sb.query === 'function') {
    const followers = await sb.query(
      'SELECT count(*)::int AS n FROM public.user_follows WHERE following_user_id = $1 AND activity_region = $2 AND cancelled_at IS NULL',
      [userId, country]
    );
    const following = await sb.query(
      'SELECT count(*)::int AS n FROM public.user_follows WHERE follower_user_id = $1 AND activity_region = $2 AND cancelled_at IS NULL',
      [userId, country]
    );
    return {
      region: country,
      follower_count: followers.rows[0].n,
      following_count: following.rows[0].n,
    };
  }
  const followers = await sb.from('user_follows').select('follower_user_id', { count: 'exact', head: true })
    .eq('following_user_id', userId).eq('activity_region', country).is('cancelled_at', null);
  const following = await sb.from('user_follows').select('following_user_id', { count: 'exact', head: true })
    .eq('follower_user_id', userId).eq('activity_region', country).is('cancelled_at', null);
  if (followers.error) handleError(followers.error);
  if (following.error) handleError(following.error);
  return {
    region: country,
    follower_count: followers.count || 0,
    following_count: following.count || 0,
  };
}

async function overlayCountryFollowCounts(row, userId, region) {
  if (region == null) return row || null;
  const counts = await countryFollowCounts(userId, region);
  const next = Object.assign({ user_id: userId }, row || {});
  next.follower_count = counts.follower_count;
  next.following_count = counts.following_count;
  next.activity_region = counts.region;
  return next;
}

async function countryProgressionRow(sb, userId, region) {
  if (region !== 'KR' && region !== 'US') return { useShared: true, row: null };
  if (typeof sb.query === 'function') {
    const exists = await sb.query(`SELECT to_regclass('public.user_activity_region_profile') AS name`);
    if (!exists.rows[0] || !exists.rows[0].name) return { useShared: true, row: null };
    const res = await sb.query(
      `SELECT user_id, level, xp, reputation_score, activity_region
       FROM public.user_activity_region_profile
       WHERE user_id = $1 AND activity_region = $2`,
      [userId, region]
    );
    return {
      useShared: false,
      row: res.rows[0] || {
        user_id: userId,
        level: null,
        xp: null,
        reputation_score: null,
        activity_region: region,
      },
    };
  }
  const read = await sb.from('user_activity_region_profile')
    .select('user_id, level, xp, reputation_score, activity_region')
    .eq('user_id', userId)
    .eq('activity_region', region)
    .maybeSingle();
  if (read.error) {
    const missing = read.error.code === '42P01' || read.error.code === 'PGRST205'
      || /does not exist/i.test(String(read.error.message || ''));
    if (missing) return { useShared: true, row: null };
    handleError(read.error);
  }
  return {
    useShared: false,
    row: read.data || {
      user_id: userId,
      level: null,
      xp: null,
      reputation_score: null,
      activity_region: region,
    },
  };
}

async function getProgression(userId, region) {
  const sb = getAdmin();
  const country = await countryProgressionRow(sb, userId, region);
  if (!country.useShared) return overlayCountryFollowCounts(country.row, userId, region);
  let data = null;
  if (typeof sb.query === 'function') {
    const res = await sb.query('SELECT * FROM public.user_progression WHERE user_id = $1', [userId]);
    data = res.rows[0] || null;
  } else {
    const read = await sb.from('user_progression').select('*').eq('user_id', userId).maybeSingle();
    if (read.error) handleError(read.error);
    data = read.data || null;
  }
  return overlayCountryFollowCounts(data, userId, region);
}

async function getPublicProgression(userId, region) {
  const sb = getAdmin();
  const country = await countryProgressionRow(sb, userId, region);
  if (!country.useShared) return overlayCountryFollowCounts(country.row, userId, region);
  let data = null;
  if (typeof sb.query === 'function') {
    const res = await sb.query(
      'SELECT user_id, level, reputation_score, citizen_rank, follower_count, following_count FROM public.user_progression WHERE user_id = $1',
      [userId]
    );
    data = res.rows[0] || null;
  } else {
    const read = await sb
      .from('user_progression')
      .select('user_id, level, reputation_score, citizen_rank, follower_count, following_count')
      .eq('user_id', userId)
      .maybeSingle();
    if (read.error) handleError(read.error);
    data = read.data || null;
  }
  return overlayCountryFollowCounts(data, userId, region);
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

function countryOf(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  if (text === 'KR' || text === 'US') return text;
  return null;
}

function countryFollowFilter(query, region) {
  return query.eq('activity_region', region).is('cancelled_at', null);
}

async function readCountryAffiliation(userId, region) {
  const store = require('./country-territory-store');
  const sb = getAdmin();
  if (typeof sb.query !== 'function') {
    return { available: false, territory: null, reason: 'COUNTRY_PROFILE_UNAVAILABLE' };
  }
  if (!(await store.countryTableReady(sb.query.bind(sb)))) {
    return { available: false, territory: null, reason: 'COUNTRY_PROFILE_UNAVAILABLE' };
  }
  const got = await store.readAffiliation(sb.query.bind(sb), userId, region);
  return { available: true, territory: got.territory, stored: got.stored, reason: got.territory ? null : 'TERRITORY_UNSET' };
}

async function readCountryTerritory(userId, region) {
  const store = require('./country-territory-store');
  const sb = getAdmin();
  if (typeof sb.query === 'function') {
    const got = await store.readAffiliation(sb.query.bind(sb), userId, region);
    return got.territory;
  }
  const country = store.countryOf(region);
  if (!country) {
    const err = new Error('COUNTRY_REQUIRED');
    err.code = 'COUNTRY_REQUIRED';
    throw err;
  }
  const { data, error } = await sb.from('user_activity_region_profile')
    .select('territory')
    .eq('user_id', userId)
    .eq('activity_region', country)
    .maybeSingle();
  if (error) handleError(error);
  return store.canonicalTerritory(data ? data.territory : null);
}

async function readMemberTerritory(userId) {
  const sb = getAdmin();
  if (typeof sb.query === 'function') {
    const res = await sb.query('SELECT territory FROM public.profiles WHERE id = $1', [userId]);
    return res.rows[0] ? res.rows[0].territory : null;
  }
  const { data, error } = await sb.from('profiles').select('territory').eq('id', userId).maybeSingle();
  if (error) handleError(error);
  return data ? data.territory : null;
}

async function applyCountryFollow(followerUserId, followingUserId, context, cancel) {
  const region = countryOf(context && context.activityRegion);
  const territory = String((context && context.territory) || '').trim();
  if (!region || !territory) {
    throw Object.assign(new Error('COUNTRY_REQUIRED'), { code: region ? 'FOLLOW_SCOPE_UNKNOWN' : 'COUNTRY_REQUIRED' });
  }
  const sb = getAdmin();
  try {
    if (typeof sb.query === 'function') {
      const res = await sb.query(
        'SELECT public.isolate_follow_once($1,$2,$3,$4,$5) AS result',
        [followerUserId, followingUserId, region, territory, !!cancel]
      );
      return res.rows[0] ? res.rows[0].result : null;
    }
    const { data, error } = await sb.rpc('isolate_follow_once', {
      p_follower: followerUserId,
      p_target: followingUserId,
      p_activity_region: region,
      p_territory: territory,
      p_cancel: !!cancel,
    });
    if (error) {
      const missing = /isolate_follow_once|PGRST202|42883|does not exist/i.test(String(error.message || error.code || ''));
      if (missing) {
        throw Object.assign(new Error('FOLLOW_COUNTRY_STORE_UNAVAILABLE'), { code: 'FOLLOW_COUNTRY_STORE_UNAVAILABLE' });
      }
      handleError(error);
    }
    return data;
  } catch (err) {
    if (err && err.code === 'FOLLOW_COUNTRY_STORE_UNAVAILABLE') throw err;
    const text = String(err && (err.message || err.code) || '');
    if (/isolate_follow_once|42883|does not exist/i.test(text)) {
      throw Object.assign(new Error('FOLLOW_COUNTRY_STORE_UNAVAILABLE'), { code: 'FOLLOW_COUNTRY_STORE_UNAVAILABLE' });
    }
    throw err;
  }
}

async function followUser(followerUserId, followingUserId, context) {
  return applyCountryFollow(followerUserId, followingUserId, context, false);
}

async function unfollowUser(followerUserId, followingUserId, context) {
  return applyCountryFollow(followerUserId, followingUserId, context, true);
}

async function getFollowers(userId, paging, region) {
  const country = countryOf(region);
  const sb = getAdmin();
  const limit = (paging && paging.limit) || 50;
  if (typeof sb.query === 'function') {
    if (!country) return [];
    const res = await sb.query(
      'SELECT follower_user_id, created_at FROM public.user_follows WHERE following_user_id = $1 AND activity_region = $2 AND cancelled_at IS NULL ORDER BY created_at DESC LIMIT $3',
      [userId, country, limit]
    );
    return res.rows;
  }
  let query = sb.from('user_follows').select('follower_user_id, created_at').eq('following_user_id', userId);
  if (country) query = countryFollowFilter(query, country);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) handleError(error);
  return data || [];
}

async function getFollowing(userId, paging, region) {
  const country = countryOf(region);
  const sb = getAdmin();
  const limit = (paging && paging.limit) || 50;
  if (typeof sb.query === 'function') {
    if (!country) return [];
    const res = await sb.query(
      'SELECT following_user_id, created_at FROM public.user_follows WHERE follower_user_id = $1 AND activity_region = $2 AND cancelled_at IS NULL ORDER BY created_at DESC LIMIT $3',
      [userId, country, limit]
    );
    return res.rows;
  }
  let query = sb.from('user_follows').select('following_user_id, created_at').eq('follower_user_id', userId);
  if (country) query = countryFollowFilter(query, country);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) handleError(error);
  return data || [];
}

async function getFollowState(viewerUserId, targetUserId, region) {
  const country = countryOf(region);
  const sb = getAdmin();
  if (typeof sb.query === 'function') {
    if (!country) return { isFollowing: false, isFollowedBy: false, isMutual: false, unisolated: false };
    const res = await sb.query(
      `SELECT follower_user_id, following_user_id FROM public.user_follows
        WHERE cancelled_at IS NULL AND activity_region = $3
          AND ((follower_user_id = $1 AND following_user_id = $2) OR (follower_user_id = $2 AND following_user_id = $1))`,
      [viewerUserId, targetUserId, country]
    );
    const isFollowing = res.rows.some(function (row) {
      return row.follower_user_id === viewerUserId && row.following_user_id === targetUserId;
    });
    const isFollowedBy = res.rows.some(function (row) {
      return row.follower_user_id === targetUserId && row.following_user_id === viewerUserId;
    });
    return { isFollowing: isFollowing, isFollowedBy: isFollowedBy, isMutual: isFollowing && isFollowedBy };
  }
  let outgoing = sb.from('user_follows').select('follower_user_id').eq('follower_user_id', viewerUserId).eq('following_user_id', targetUserId);
  let incoming = sb.from('user_follows').select('follower_user_id').eq('follower_user_id', targetUserId).eq('following_user_id', viewerUserId);
  if (country) {
    outgoing = countryFollowFilter(outgoing, country);
    incoming = countryFollowFilter(incoming, country);
  }
  const [r1, r2] = await Promise.all([outgoing.maybeSingle(), incoming.maybeSingle()]);
  const isFollowing = !!(r1.data);
  const isFollowedBy = !!(r2.data);
  return { isFollowing, isFollowedBy, isMutual: isFollowing && isFollowedBy, unisolated: !country };
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

function requireCountry(region) {
  const country = countryOf(region);
  if (!country) throw Object.assign(new Error('COUNTRY_REQUIRED'), { code: 'COUNTRY_REQUIRED', status: 400 });
  return country;
}

async function recordCountryFeed(input) {
  const src = input || {};
  const region = requireCountry(src.region || src.activityRegion);
  const userId = String(src.userId || '').trim();
  const eventType = String(src.eventType || '').trim();
  const sourceId = String(src.sourceId || '').trim();
  if (!userId || !eventType || !sourceId) {
    throw Object.assign(new Error('COUNTRY_REQUIRED'), { code: 'COUNTRY_REQUIRED', status: 400 });
  }
  const dedupe = region + ':' + eventType + ':' + sourceId;
  const text = String(src.text || eventType).slice(0, 180);
  const sb = getAdmin();
  if (typeof sb.query === 'function') {
    const existing = await sb.query('SELECT id FROM public.user_activity_events WHERE dedupe_key = $1', [dedupe]);
    if (existing.rows.length) return { status: 'DUPLICATE', dedupeKey: dedupe };
    await sb.query(
      'INSERT INTO public.user_activity_events (user_id, activity_type, payload, dedupe_key, activity_region) VALUES ($1, $2, $3::jsonb, $4, $5)',
      [userId, eventType, JSON.stringify({ sourceId: sourceId }), dedupe, region]
    );
    const notice = await sb.query('SELECT id FROM public.user_notifications WHERE dedupe_key = $1', [dedupe]);
    if (!notice.rows.length) {
      await sb.query(
        'INSERT INTO public.user_notifications (user_id, notification_type, title, message, dedupe_key, activity_region) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, eventType, text, text, dedupe, region]
      );
    }
    return { status: 'RECORDED', dedupeKey: dedupe };
  }
  const found = await sb.from('user_activity_events').select('id').eq('dedupe_key', dedupe).limit(1);
  if (found.error) handleError(found.error);
  if (found.data && found.data.length) return { status: 'DUPLICATE', dedupeKey: dedupe };
  const inserted = await sb.from('user_activity_events').insert({
    user_id: userId,
    activity_type: eventType,
    payload: { sourceId: sourceId },
    dedupe_key: dedupe,
    activity_region: region,
  });
  if (inserted.error) handleError(inserted.error);
  const notice = await sb.from('user_notifications').select('id').eq('dedupe_key', dedupe).limit(1);
  if (notice.error) handleError(notice.error);
  if (!notice.data || !notice.data.length) {
    const created = await sb.from('user_notifications').insert({
      user_id: userId,
      notification_type: eventType,
      title: text,
      message: text,
      dedupe_key: dedupe,
      activity_region: region,
    });
    if (created.error) handleError(created.error);
  }
  return { status: 'RECORDED', dedupeKey: dedupe };
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function listNotifications(userId, paging, region) {
  const country = requireCountry(region);
  const sb = getAdmin();
  const limit = (paging && paging.limit) || 50;
  if (typeof sb.query === 'function') {
    const res = await sb.query(
      'SELECT * FROM public.user_notifications WHERE user_id = $1 AND activity_region = $2 ORDER BY created_at DESC LIMIT $3',
      [userId, country, limit]
    );
    return res.rows;
  }
  const { data, error } = await sb
    .from('user_notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('activity_region', country)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) handleError(error);
  return data || [];
}

async function markNotificationRead(userId, notificationId, region) {
  const country = requireCountry(region);
  const sb = getAdmin();
  if (typeof sb.query === 'function') {
    const found = await sb.query(
      'SELECT id, activity_region FROM public.user_notifications WHERE id = $1 AND user_id = $2',
      [notificationId, userId]
    );
    if (!found.rows.length) {
      throw Object.assign(new Error('USER_DATA_NOTIFICATION_NOT_FOUND'), { code: 'USER_DATA_NOTIFICATION_NOT_FOUND', status: 404 });
    }
    if (countryOf(found.rows[0].activity_region) !== country) {
      throw Object.assign(new Error('COUNTRY_MISMATCH'), { code: 'COUNTRY_MISMATCH', status: 400 });
    }
    await sb.query(
      'UPDATE public.user_notifications SET is_read = true, read_at = now() WHERE id = $1 AND user_id = $2 AND activity_region = $3',
      [notificationId, userId, country]
    );
    return { status: 'READ' };
  }
  const found = await sb.from('user_notifications').select('id, activity_region').eq('id', notificationId).eq('user_id', userId).maybeSingle();
  if (found.error) handleError(found.error);
  if (!found.data) {
    throw Object.assign(new Error('USER_DATA_NOTIFICATION_NOT_FOUND'), { code: 'USER_DATA_NOTIFICATION_NOT_FOUND', status: 404 });
  }
  if (countryOf(found.data.activity_region) !== country) {
    throw Object.assign(new Error('COUNTRY_MISMATCH'), { code: 'COUNTRY_MISMATCH', status: 400 });
  }
  const saved = await sb.from('user_notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', notificationId).eq('user_id', userId).eq('activity_region', country);
  if (saved.error) handleError(saved.error);
  return { status: 'READ' };
}

async function markAllNotificationsRead(userId, region) {
  const country = requireCountry(region);
  const sb = getAdmin();
  if (typeof sb.query === 'function') {
    await sb.query(
      'UPDATE public.user_notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND activity_region = $2 AND is_read = false',
      [userId, country]
    );
    return { status: 'ALL_READ' };
  }
  const saved = await sb.from('user_notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('user_id', userId).eq('activity_region', country).eq('is_read', false);
  if (saved.error) handleError(saved.error);
  return { status: 'ALL_READ' };
}

async function appendNotification(notification) {
  const src = notification || {};
  const country = requireCountry(src.activity_region || src.activityRegion);
  const sb = getAdmin();
  const row = Object.assign({}, src, { activity_region: country });
  delete row.activityRegion;
  if (typeof sb.query === 'function') {
    const res = await sb.query(
      'INSERT INTO public.user_notifications (user_id, notification_type, title, message, dedupe_key, activity_region) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [row.user_id, row.notification_type, row.title || '', row.message || '', row.dedupe_key || null, country]
    );
    return res.rows[0] || null;
  }
  const { data, error } = await sb.from('user_notifications').insert(row).select().maybeSingle();
  if (error) handleError(error);
  return data;
}

// ─── Activity (admin only) ────────────────────────────────────────────────────
async function listActivityEvents(userId, paging, region) {
  const country = requireCountry(region);
  const sb = getAdmin();
  const limit = (paging && paging.limit) || 50;
  if (typeof sb.query === 'function') {
    const res = await sb.query(
      'SELECT * FROM public.user_activity_events WHERE user_id = $1 AND activity_region = $2 ORDER BY occurred_at DESC NULLS LAST LIMIT $3',
      [userId, country, limit]
    );
    return res.rows;
  }
  const { data, error } = await sb
    .from('user_activity_events')
    .select('*')
    .eq('user_id', userId)
    .eq('activity_region', country)
    .order('occurred_at', { ascending: false })
    .limit(limit);
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
  readMemberTerritory,
  readCountryTerritory,
  readCountryAffiliation,
  getAchievements, grantAchievement, setFeaturedAchievements,
  listNotifications, markNotificationRead, markAllNotificationsRead, appendNotification, recordCountryFeed,
  listActivityEvents, appendActivityEvent,
  listBookmarks, addBookmark, removeBookmark,
};
