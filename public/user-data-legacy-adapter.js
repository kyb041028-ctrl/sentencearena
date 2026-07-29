/**
 * 센텐스크래프트 — 사용자 데이터 localStorage → 운영 전환 adapter
 *
 * 역할:
 *  - 기존 localStorage 구조를 읽어 운영 draft 로 변환하는 "미리보기" 제공
 *  - 실제 DB 이전 없음 · localStorage 원본 변경 없음 · 자동 계정 병합 없음
 *  - guest/email key를 UUID로 임의 변환하지 않음
 *  - 손실·불확실 데이터는 warnings 배열에 기록
 */
(function (global) {
  'use strict';

  var cfg = global.UserDataConfigCore;

  // cfg 없이도 기본 동작 가능하도록 fallback
  var UUID_RE = cfg && cfg.UUID_RE ? cfg.UUID_RE : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var KEYS = (cfg && cfg.LOCAL_STORAGE_KEYS) || {
    progression: 'sc_player_progression_v1',
    follow: 'sc_follow_v1',
    followNotify: 'sc_follow_notify_v1',
    followNotifyPrefs: 'sc_follow_notify_prefs_v1',
    displayNames: 'sc_display_names_v1',
    notifications: 'sc_notifications_v1',
    activityFeed: 'sc_activity_feed_v1',
    bookmarks: 'sc_bookmarks_v1',
    reports: 'sc_reports_v1',
  };
  var SESSION_KEYS = (cfg && cfg.SESSION_STORAGE_KEYS) || {
    auth: 'sc_sb_auth_session',
    guestOk: 'sc_sb_guest_ok',
  };
  var PROFILE_PHOTO_PREFIX = 'sc_profile_photo_v1:';
  var LEGACY_IDPHOTO_PREFIX = 'sc_profile_idphoto_v1:';
  var LEGACY_AVATAR_PREFIX = 'sc_profile_avatar_v1:';

  function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v.trim()); }

  function isGuestId(v) {
    if (!v) return true;
    var s = String(v).trim().toLowerCase();
    return s === 'guest' || s === 'guest_demo' || s.indexOf('guest') === 0 || !s;
  }

  function isEmailId(v) { return typeof v === 'string' && v.indexOf('@') !== -1; }

  function lsGet(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function ssGet(key) {
    try {
      var raw = sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function deepClone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; } }

  // ─── 인증 상태 조사 ──────────────────────────────────────────────────────────
  function inspectAuth() {
    var auth = ssGet(SESSION_KEYS.auth);
    var guestOk = false;
    try { guestOk = sessionStorage.getItem(SESSION_KEYS.guestOk) === '1'; } catch (_) {}
    var user = auth && (auth.user || (auth.session && auth.session.user));
    var userId = user && user.id ? String(user.id).trim() : null;
    var isUuidUser = isUuid(userId || '');
    var hasEmail = user && !!user.email;
    return {
      hasSession: !!(auth && auth.session && auth.session.access_token),
      userId: userId,
      isUuid: isUuidUser,
      userIdType: !userId ? 'NONE'
        : isUuidUser ? 'UUID'
        : isEmailId(userId || '') ? 'EMAIL'
        : 'UNKNOWN',
      guestDataPresent: guestOk,
      hasEmail: hasEmail,
    };
  }

  // ─── 진행 상태 조사·변환 ──────────────────────────────────────────────────────
  function inspectLegacyProgression() {
    var map = lsGet(KEYS.progression);
    var found = !!(map && typeof map === 'object');
    if (!found) return { found: false, convertible: false, warnings: ['sc_player_progression_v1 없음'] };
    var keys = Object.keys(map);
    var uuidKeys = keys.filter(function(k) { return isUuid(k); });
    var guestKeys = keys.filter(function(k) { return isGuestId(k); });
    var emailKeys = keys.filter(function(k) { return isEmailId(k); });
    var otherKeys = keys.filter(function(k) { return !isUuid(k) && !isGuestId(k) && !isEmailId(k); });
    var warnings = [];
    if (emailKeys.length > 0) warnings.push('email key 데이터 존재 — UUID 자동 변환 불가: ' + emailKeys.join(', '));
    if (otherKeys.length > 0) warnings.push('알 수 없는 key 데이터 존재: ' + otherKeys.join(', '));
    if (guestKeys.length > 0) warnings.push('게스트 데이터 존재 (운영 이전 불가): ' + guestKeys.join(', '));
    return {
      found: true,
      totalKeys: keys.length,
      uuidKeyCount: uuidKeys.length,
      guestKeyCount: guestKeys.length,
      emailKeyCount: emailKeys.length,
      otherKeyCount: otherKeys.length,
      convertible: uuidKeys.length > 0,
      warnings: warnings,
    };
  }

  function mapLegacyProgressionToDraft(userId) {
    var map = lsGet(KEYS.progression);
    if (!map) return { ok: false, warnings: ['sc_player_progression_v1 없음'] };
    var row = map[userId];
    if (!row) return { ok: false, warnings: [userId + ' 데이터 없음'] };
    var warnings = [];
    var xp = Math.max(0, Math.floor(Number(row.totalXp) || 0));
    if (!isFinite(xp)) { xp = 0; warnings.push('totalXp 비정상 → 0 처리'); }
    return {
      ok: true,
      draft: {
        user_id: userId,
        xp: xp,
        level: cfg && cfg.clampLevel
          ? cfg.clampLevel(Math.floor(Number(row.level) || 1))
          : Math.min(10, Math.max(1, Math.floor(Number(row.level) || 1))),        reputation_score: Math.max(0, Math.floor(Number(row.receivedPostLikes || 0) + Number(row.receivedCommentLikes || 0) * 2 + Number(row.receivedFollowers || 0) * 5)),
        citizen_rank: null,
        received_post_likes: Math.max(0, Math.floor(Number(row.receivedPostLikes) || 0)),
        received_comment_likes: Math.max(0, Math.floor(Number(row.receivedCommentLikes) || 0)),
        follower_count: Math.max(0, Math.floor(Number(row.receivedFollowers) || 0)),
      },
      warnings: warnings,
    };
  }

  // ─── 팔로우 조사·변환 ────────────────────────────────────────────────────────
  function inspectLegacyFollow() {
    var graph = lsGet(KEYS.follow);
    var found = !!(graph && typeof graph === 'object');
    if (!found) return { found: false, relationCount: 0, invalidRelationCount: 0, warnings: ['sc_follow_v1 없음'] };
    var following = graph.following || {};
    var warnings = [];
    var totalRelations = 0;
    var invalidRelations = 0;
    Object.keys(following).forEach(function(userId) {
      var targets = following[userId] || [];
      targets.forEach(function(tid) {
        totalRelations++;
        if (!isUuid(userId) || !isUuid(String(tid))) invalidRelations++;
      });
    });
    if (invalidRelations > 0) warnings.push('비 UUID 관계 ' + invalidRelations + '개 존재 — 운영 이전 불가');
    return { found: true, relationCount: totalRelations, invalidRelationCount: invalidRelations, warnings: warnings };
  }

  function mapLegacyFollowDataToDraft(userId) {
    var graph = lsGet(KEYS.follow);
    if (!graph) return { ok: false, warnings: ['sc_follow_v1 없음'] };
    var followingList = (graph.following && graph.following[userId]) || [];
    var validFollowing = followingList.filter(function(t) { return isUuid(String(t || '')); });
    var invalid = followingList.filter(function(t) { return !isUuid(String(t || '')); });
    var warnings = invalid.length > 0 ? ['비 UUID 팔로잉 ' + invalid.length + '개 제외'] : [];
    return {
      ok: true,
      draft: validFollowing.map(function(tid) {
        return { follower_user_id: userId, following_user_id: String(tid) };
      }),
      skipped: invalid,
      warnings: warnings,
    };
  }

  // ─── 업적 조사·변환 ──────────────────────────────────────────────────────────
  function inspectLegacyAchievements() {
    // 업적은 현재 런타임 Mock (UserAchievements) — localStorage 미사용
    var hasModule = !!(global.UserAchievements && typeof global.UserAchievements.getCurrentUserAchievements === 'function');
    if (!hasModule) return { found: false, acquiredCount: 0, missingAcquiredAtCount: 0, missingSequenceCount: 0, warnings: ['UserAchievements 모듈 없음'] };
    var list = global.UserAchievements.getCurrentUserAchievements();
    var missing_at = list.filter(function(a) { return !a.acquiredAt; }).length;
    var missing_seq = list.filter(function(a) { return a.acquisitionSequence == null; }).length;
    var warnings = [];
    if (missing_at > 0) warnings.push('acquiredAt 누락 업적 ' + missing_at + '개');
    if (missing_seq > 0) warnings.push('acquisitionSequence 누락 업적 ' + missing_seq + '개');
    return { found: true, acquiredCount: list.length, missingAcquiredAtCount: missing_at, missingSequenceCount: missing_seq, warnings: warnings };
  }

  function mapLegacyAchievementsToDraft(userId) {
    var hasModule = !!(global.UserAchievements && typeof global.UserAchievements.getCurrentUserAchievements === 'function');
    if (!hasModule) return { ok: false, warnings: ['UserAchievements 모듈 없음'] };
    var list = global.UserAchievements.getCurrentUserAchievements();
    var warnings = [];
    var drafts = list.map(function(a, idx) {
      var w = [];
      if (!a.acquiredAt) w.push('achievementId=' + a.achievementId + ': acquiredAt 누락');
      if (a.acquisitionSequence == null) w.push('achievementId=' + a.achievementId + ': acquisitionSequence 누락');
      warnings = warnings.concat(w);
      return {
        user_id: userId,
        achievement_key: String(a.achievementId || ''),
        acquired_at: a.acquiredAt || null,
        acquisition_sequence: a.acquisitionSequence != null ? Number(a.acquisitionSequence) : idx + 1,
        season_key: a.seasonId || null,
        metadata: {},
      };
    });
    return { ok: true, draft: drafts, warnings: warnings };
  }

  // ─── 알림 조사·변환 ──────────────────────────────────────────────────────────
  function inspectLegacyNotifications() {
    var map = lsGet(KEYS.notifications);
    var found = !!(map && typeof map === 'object');
    if (!found) return { found: false, count: 0, invalidCount: 0, warnings: ['sc_notifications_v1 없음'] };
    var allKeys = Object.keys(map);
    var total = 0;
    var invalid = 0;
    allKeys.forEach(function(k) {
      var list = map[k] || [];
      total += list.length;
      list.forEach(function(n) {
        if (!n || !n.type) invalid++;
      });
    });
    return { found: true, count: total, invalidCount: invalid, warnings: invalid > 0 ? ['type 없는 알림 ' + invalid + '개'] : [] };
  }

  function mapLegacyNotificationsToDraft(userId) {
    var map = lsGet(KEYS.notifications);
    if (!map) return { ok: false, warnings: ['sc_notifications_v1 없음'] };
    var list = map[userId] || [];
    var warnings = [];
    var drafts = list.map(function(n) {
      if (!n.type) warnings.push('type 없는 알림 존재');
      return {
        user_id: userId,
        notification_type: n.type || 'UNKNOWN',
        title: n.title || null,
        message: n.message || null,
        payload: n.linkTarget ? { linkTarget: n.linkTarget } : {},
        is_read: !!(n.isRead || n.read),
        created_at: n.createdAt || null,
      };
    });
    return { ok: true, draft: drafts, warnings: warnings };
  }

  // ─── 활동 피드 조사·변환 ─────────────────────────────────────────────────────
  function inspectLegacyActivityFeed() {
    var map = lsGet(KEYS.activityFeed);
    var found = !!(map && typeof map === 'object');
    if (!found) return { found: false, count: 0, invalidCount: 0, warnings: ['sc_activity_feed_v1 없음'] };
    var allKeys = Object.keys(map);
    var total = 0;
    var invalid = 0;
    allKeys.forEach(function(k) {
      var list = map[k] || [];
      total += list.length;
      list.forEach(function(e) {
        if (!e || !e.type) invalid++;
      });
    });
    return { found: true, count: total, invalidCount: invalid, warnings: [] };
  }

  // ─── 북마크 조사·변환 ────────────────────────────────────────────────────────
  function inspectLegacyBookmarks() {
    var map = lsGet(KEYS.bookmarks);
    var found = !!(map && typeof map === 'object');
    if (!found) return { found: false, count: 0, invalidCount: 0, warnings: ['sc_bookmarks_v1 없음'] };
    var allKeys = Object.keys(map);
    var total = 0;
    var invalid = 0;
    allKeys.forEach(function(k) {
      var list = map[k] || [];
      total += list.length;
      list.forEach(function(b) {
        if (!b || !b.postId) invalid++;
      });
    });
    return { found: true, count: total, invalidCount: invalid, warnings: invalid > 0 ? ['postId 없는 북마크 ' + invalid + '개'] : [] };
  }

  function mapLegacyBookmarksToDraft(userId) {
    var map = lsGet(KEYS.bookmarks);
    if (!map) return { ok: false, warnings: ['sc_bookmarks_v1 없음'] };
    var list = map[userId] || [];
    var warnings = [];
    var valid = list.filter(function(b) {
      if (!b || !b.postId) { warnings.push('postId 없는 북마크 제외'); return false; }
      return true;
    });
    return {
      ok: true,
      draft: valid.map(function(b) {
        return { user_id: userId, post_id: String(b.postId) };
      }),
      warnings: warnings,
    };
  }

  // ─── 프로필 사진 키 조사 ──────────────────────────────────────────────────────
  function inspectProfilePhotoKeys() {
    var foundKeys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.indexOf(PROFILE_PHOTO_PREFIX) === 0 || k.indexOf(LEGACY_IDPHOTO_PREFIX) === 0 || k.indexOf(LEGACY_AVATAR_PREFIX) === 0)) {
          // 키만 기록 — 실제 데이터(base64)는 로그 미출력
          foundKeys.push(k.replace(PROFILE_PHOTO_PREFIX, '[photo]:').replace(LEGACY_IDPHOTO_PREFIX, '[idphoto]:').replace(LEGACY_AVATAR_PREFIX, '[avatar]:'));
        }
      }
    } catch (_) {}
    return { foundKeys: foundKeys };
  }

  // ─── 종합 조사 ───────────────────────────────────────────────────────────────
  function inspectLegacyUserData() {
    var auth = inspectAuth();
    var progression = inspectLegacyProgression();
    var follows = inspectLegacyFollow();
    var achievements = inspectLegacyAchievements();
    var notifications = inspectLegacyNotifications();
    var activity = inspectLegacyActivityFeed();
    var bookmarks = inspectLegacyBookmarks();
    var profilePhotos = inspectProfilePhotoKeys();
    var warnings = []
      .concat(auth.isUuid ? [] : ['인증 사용자 ID가 UUID가 아님'])
      .concat(progression.warnings || [])
      .concat(follows.warnings || [])
      .concat(achievements.warnings || [])
      .concat(notifications.warnings || [])
      .concat(bookmarks.warnings || []);
    var migrationReady = auth.isUuid
      && progression.convertible
      && follows.invalidRelationCount === 0
      && achievements.missingAcquiredAtCount === 0
      && achievements.missingSequenceCount === 0;
    return {
      auth: auth,
      progression: { found: progression.found, convertible: progression.convertible, warnings: progression.warnings },
      follows: { found: follows.found, relationCount: follows.relationCount, invalidRelationCount: follows.invalidRelationCount },
      achievements: {
        found: achievements.found,
        acquiredCount: achievements.acquiredCount,
        missingAcquiredAtCount: achievements.missingAcquiredAtCount,
        missingSequenceCount: achievements.missingSequenceCount,
      },
      notifications: { found: notifications.found, count: notifications.count, invalidCount: notifications.invalidCount },
      activity: { found: activity.found, count: activity.count, invalidCount: activity.invalidCount },
      bookmarks: { found: bookmarks.found, count: bookmarks.count, invalidCount: bookmarks.invalidCount },
      profilePhotos: profilePhotos,
      migrationReady: migrationReady,
      warnings: warnings,
    };
  }

  function buildLegacyUserMigrationPreview(userId) {
    if (!userId) return { ok: false, warnings: ['userId 없음'] };
    var progression = mapLegacyProgressionToDraft(userId);
    var follow = mapLegacyFollowDataToDraft(userId);
    var achievements = mapLegacyAchievementsToDraft(userId);
    var notifications = mapLegacyNotificationsToDraft(userId);
    var bookmarks = mapLegacyBookmarksToDraft(userId);
    var warnings = []
      .concat(progression.warnings || [])
      .concat(follow.warnings || [])
      .concat(achievements.warnings || [])
      .concat(notifications.warnings || [])
      .concat(bookmarks.warnings || []);
    return {
      ok: true,
      userId: userId,
      isUuid: isUuid(userId),
      isGuest: isGuestId(userId),
      progression: progression.draft || null,
      follow: follow.draft || [],
      achievements: achievements.draft || [],
      notifications: notifications.draft || [],
      bookmarks: bookmarks.draft || [],
      warnings: warnings,
      note: '이 결과는 preview 전용입니다. 실제 DB 이전은 별도 작업으로 진행합니다.',
    };
  }

  // ─── 공개 API ─────────────────────────────────────────────────────────────────
  global.UserDataLegacyAdapter = {
    inspectLegacyUserData: inspectLegacyUserData,
    mapLegacyProgressionToDraft: mapLegacyProgressionToDraft,
    mapLegacyFollowDataToDraft: mapLegacyFollowDataToDraft,
    mapLegacyAchievementsToDraft: mapLegacyAchievementsToDraft,
    mapLegacyNotificationsToDraft: mapLegacyNotificationsToDraft,
    mapLegacyBookmarksToDraft: mapLegacyBookmarksToDraft,
    buildLegacyUserMigrationPreview: buildLegacyUserMigrationPreview,
  };

  // 개발용 호환성 검사 함수
  global.__scInspectLegacyUserData = function () {
    var result = inspectLegacyUserData();
    // 개인정보 미출력: email, 프로필 원문, 북마크 제목 제외됨
    console.log('[UserDataLegacyAdapter] 호환성 검사 결과:', JSON.stringify(result, null, 2));
    return result;
  };
})(typeof window !== 'undefined' ? window : this);
