/**
 * 센텐스아레나 — 사용자 데이터 공용 설정
 * 브라우저(UMD) · Node(CommonJS) 공용
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UserDataConfigCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function userDataConfigCoreFactory() {
  'use strict';

  // -----------------------------------------------------------------------------
  // 운영 사용자 ID 규칙
  // -----------------------------------------------------------------------------
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  var GUEST_IDS = Object.freeze(['guest', 'guest_demo', 'GUEST', 'GUEST_DEMO']);

  var DISALLOWED_OP_ID_PATTERNS = Object.freeze([
    /^guest/i,
    /^GUEST/,
    /@/,
    /^currentUser$/i,
  ]);

  // -----------------------------------------------------------------------------
  // 데이터 전환 모드
  // -----------------------------------------------------------------------------
  var DATA_MODES = Object.freeze({
    LEGACY_LOCAL: 'LEGACY_LOCAL',
    API_DRY_RUN: 'API_DRY_RUN',
    API_OPERATIONAL: 'API_OPERATIONAL',
  });

  // -----------------------------------------------------------------------------
  // localStorage keys
  // -----------------------------------------------------------------------------
  var LOCAL_STORAGE_KEYS = Object.freeze({
    progression: 'sc_player_progression_v1',
    follow: 'sc_follow_v1',
    followNotify: 'sc_follow_notify_v1',
    followNotifyPrefs: 'sc_follow_notify_prefs_v1',
    displayNames: 'sc_display_names_v1',
    notifications: 'sc_notifications_v1',
    activityFeed: 'sc_activity_feed_v1',
    bookmarks: 'sc_bookmarks_v1',
    reports: 'sc_reports_v1',
    moderation: 'sc_moderation_v1',
    boardBundle: 'sc_board_bundle_v1',
  });

  var SESSION_STORAGE_KEYS = Object.freeze({
    auth: 'sc_sb_auth_session',
    guestOk: 'sc_sb_guest_ok',
  });

  // -----------------------------------------------------------------------------
  // 프로필 수정 허용 필드
  // -----------------------------------------------------------------------------
  var PROFILE_EDITABLE_FIELDS = Object.freeze([
    'display_name',
    'avatar_url',
    'bio',
    'home_country',
  ]);

  var PROFILE_SERVER_ONLY_FIELDS = Object.freeze([
    'citizenship_status',
    'title_badge_key',
    'exile_strike_count',
    'metadata',
    'updated_at',
    'created_at',
  ]);

  // -----------------------------------------------------------------------------
  // 진행 상태 이벤트 타입
  // -----------------------------------------------------------------------------
  var PROGRESSION_EVENT_TYPES = Object.freeze([
    'POST_CREATED',
    'COMMENT_CREATED',
    'EMPATHY_RECEIVED',
    'LIKE_RECEIVED',
    'FOLLOWER_GAINED',
    'FOLLOWER_LOST',
    'LEVEL_ADJUSTMENT',
    'OPERATOR_ADJUSTMENT',
  ]);

  /** 명성 감점이 금지된 이벤트 타입 */
  var REPUTATION_DEDUCT_FORBIDDEN_TYPES = Object.freeze([
    'EMPATHY_RECEIVED',
    'LIKE_RECEIVED',
    'FOLLOWER_GAINED',
  ]);

  // -----------------------------------------------------------------------------
  // 운영 레벨 범위 (단일 원천)
  // -----------------------------------------------------------------------------
  var USER_LEVEL_MIN = 1;
  var USER_LEVEL_MAX = 10;

  var LEVEL_RANGE = Object.freeze({
    min: USER_LEVEL_MIN,
    max: USER_LEVEL_MAX,
  });

  // -----------------------------------------------------------------------------
  // 시스템 레벨 규칙
  // -----------------------------------------------------------------------------
  var PROGRESSION_RULES = Object.freeze({
    levelMin: USER_LEVEL_MIN,
    levelMax: USER_LEVEL_MAX,
    /** 공식 Lv1~10 · shared/progression-xp-core.js SSOT */
    autoLevelCap: 10,
    maxTotalXp: 1500,
    lurkUnlockLevel: 3,
    rankUnlockLevel: 4,
    maxRankTier: 4,
    xpPerLevel: Object.freeze([40, 50, 60, 70, 80, 120, 160, 220, 300, 400]),
    levelCumulativeXp: Object.freeze([0, 40, 90, 150, 220, 300, 420, 580, 800, 1100, 1500]),
    xpRewards: Object.freeze({
      post_write: 25,
      board_comment: 12,
      issue_comment: 10,
    }),
    deleteXpPolicy: 'PENDING',
  });

  // -----------------------------------------------------------------------------
  // 업적 규칙
  // -----------------------------------------------------------------------------
  var ACHIEVEMENT_RULES = Object.freeze({
    featuredMax: 3,
    persistenceTypes: Object.freeze(['PERMANENT', 'SEASONAL']),
    implementationStatuses: Object.freeze(['CONFIRMED', 'CANDIDATE', 'PLANNED']),
  });

  // -----------------------------------------------------------------------------
  // 알림 규칙
  // -----------------------------------------------------------------------------
  var NOTIFICATION_RULES = Object.freeze({
    maxPerUser: 50,
    dedupeWindowMs: 45000,
  });

  // -----------------------------------------------------------------------------
  // 활동 피드 규칙
  // -----------------------------------------------------------------------------
  var ACTIVITY_EVENT_TYPES = Object.freeze([
    'POST_CREATED',
    'COMMENT_CREATED',
    'LIKE_RECEIVED',
    'EMPATHY_RECEIVED',
    'FOLLOWED',
    'LEVEL_UP',
    'TERRITORY_CHANGED',
    'ALIEN_WARNING',
    'ALIEN_TRANSFER',
    'ACHIEVEMENT_ACQUIRED',
    'follow_created',
    'post_created',
    'comment_created',
    'empathy_added',
  ]);

  // -----------------------------------------------------------------------------
  // 입력 길이 제한
  // -----------------------------------------------------------------------------
  var LIMITS = Object.freeze({
    displayNameMax: 30,
    bioMax: 120,
    achievementKeyMax: 80,
    notificationMessageMax: 200,
    activityMessageMax: 200,
    progressionEventDedupeKeyMax: 200,
  });

  // -----------------------------------------------------------------------------
  // 기능별 저장 상태
  // -----------------------------------------------------------------------------
  var FEATURE_STORAGE_STATUS = Object.freeze({
    profile: 'SUPABASE_EXISTS',
    identityHistory: 'SUPABASE_EXISTS',
    progression: 'LOCALSTORAGE',
    follow: 'LOCALSTORAGE',
    followNotify: 'LOCALSTORAGE',
    notifications: 'LOCALSTORAGE',
    activityFeed: 'LOCALSTORAGE',
    bookmarks: 'LOCALSTORAGE',
    reports: 'LOCALSTORAGE',
    achievements: 'RUNTIME_MOCK',
    profilePhoto: 'LOCALSTORAGE_DATAURL',
    displayNames: 'LOCALSTORAGE',
  });

  // -----------------------------------------------------------------------------
  // 함수
  // -----------------------------------------------------------------------------
  function isOperationalUserId(value) {
    if (!value || typeof value !== 'string') return false;
    var s = value.trim();
    if (!UUID_RE.test(s)) return false;
    for (var i = 0; i < DISALLOWED_OP_ID_PATTERNS.length; i++) {
      if (DISALLOWED_OP_ID_PATTERNS[i].test(s)) return false;
    }
    return true;
  }

  function isGuestId(value) {
    if (!value) return true;
    var s = String(value).trim();
    if (GUEST_IDS.indexOf(s) !== -1) return true;
    if (/^guest/i.test(s)) return true;
    if (!s) return true;
    return false;
  }

  function isEmailLikeId(value) {
    if (!value) return false;
    return /@/.test(String(value));
  }

  function assertOperationalUserId(value) {
    if (!isOperationalUserId(value)) {
      var err = new Error('USER_DATA_USER_ID_INVALID');
      err.code = 'USER_DATA_USER_ID_INVALID';
      throw err;
    }
    return String(value).trim();
  }

  function resolveUserDataMode(envLike) {
    var src = envLike || {};
    if (src.dataMode) {
      var d = String(src.dataMode).trim().toUpperCase();
      if (d === DATA_MODES.API_DRY_RUN || d === DATA_MODES.API_OPERATIONAL || d === DATA_MODES.LEGACY_LOCAL) {
        return d;
      }
    }
    if (src.USER_DATA_MODE) {
      var m = String(src.USER_DATA_MODE).trim().toUpperCase();
      if (m === DATA_MODES.API_DRY_RUN || m === DATA_MODES.API_OPERATIONAL || m === DATA_MODES.LEGACY_LOCAL) {
        return m;
      }
    }
    if (String(src.USER_DATA_OPERATIONAL || '').trim() === 'true') {
      return DATA_MODES.API_OPERATIONAL;
    }
    return DATA_MODES.LEGACY_LOCAL;
  }

  function isProfileEditableField(fieldName) {
    return PROFILE_EDITABLE_FIELDS.indexOf(String(fieldName || '')) !== -1;
  }

  function isReputationDeductForbidden(eventType) {
    return REPUTATION_DEDUCT_FORBIDDEN_TYPES.indexOf(String(eventType || '')) !== -1;
  }

  function clampLevel(level) {
    var n = Math.floor(Number(level));
    if (!isFinite(n) || isNaN(n)) return USER_LEVEL_MIN;
    return Math.min(USER_LEVEL_MAX, Math.max(USER_LEVEL_MIN, n));
  }

  function isValidLevel(level) {
    var n = Math.floor(Number(level));
    return isFinite(n) && !isNaN(n) && n >= USER_LEVEL_MIN && n <= USER_LEVEL_MAX;
  }

  /** 누적 XP → level (1~10). 게이지 cap 1500은 level 계산에 쓰지 않음(Lv10 시작=1100). */
  function computeAutoLevelFromXp(totalXp) {
    var xp = Math.max(0, Math.floor(Number(totalXp) || 0));
    var thresholds = PROGRESSION_RULES.levelCumulativeXp;
    var startPoints = thresholds.length > 10 ? thresholds.slice(0, 10) : thresholds;
    var lv = USER_LEVEL_MIN;
    var i;
    for (i = startPoints.length - 1; i >= 0; i--) {
      if (xp >= startPoints[i]) {
        lv = i + 1;
        break;
      }
    }
    return clampLevel(Math.min(lv, PROGRESSION_RULES.autoLevelCap));
  }

  /** 사용자 JWT로 실행 가능한 RPC */
  var USER_JWT_RPC_NAMES = Object.freeze([
    'toggle_user_follow',
    'set_featured_achievements',
    'mark_user_notification_read',
    'create_user_bookmark',
    'remove_user_bookmark',
  ]);

  /** service-role 전용 RPC */
  var SERVICE_ROLE_RPC_NAMES = Object.freeze([
    'apply_user_progression_event',
    'grant_user_achievement',
  ]);

  return {
    USER_LEVEL_MIN: USER_LEVEL_MIN,
    USER_LEVEL_MAX: USER_LEVEL_MAX,
    LEVEL_RANGE: LEVEL_RANGE,
    USER_JWT_RPC_NAMES: USER_JWT_RPC_NAMES,
    SERVICE_ROLE_RPC_NAMES: SERVICE_ROLE_RPC_NAMES,
    UUID_RE: UUID_RE,
    GUEST_IDS: GUEST_IDS,
    DATA_MODES: DATA_MODES,
    LOCAL_STORAGE_KEYS: LOCAL_STORAGE_KEYS,
    SESSION_STORAGE_KEYS: SESSION_STORAGE_KEYS,
    PROFILE_EDITABLE_FIELDS: PROFILE_EDITABLE_FIELDS,
    PROFILE_SERVER_ONLY_FIELDS: PROFILE_SERVER_ONLY_FIELDS,
    PROGRESSION_EVENT_TYPES: PROGRESSION_EVENT_TYPES,
    REPUTATION_DEDUCT_FORBIDDEN_TYPES: REPUTATION_DEDUCT_FORBIDDEN_TYPES,
    PROGRESSION_RULES: PROGRESSION_RULES,
    ACHIEVEMENT_RULES: ACHIEVEMENT_RULES,
    NOTIFICATION_RULES: NOTIFICATION_RULES,
    ACTIVITY_EVENT_TYPES: ACTIVITY_EVENT_TYPES,
    LIMITS: LIMITS,
    FEATURE_STORAGE_STATUS: FEATURE_STORAGE_STATUS,
    isOperationalUserId: isOperationalUserId,
    isGuestId: isGuestId,
    isEmailLikeId: isEmailLikeId,
    assertOperationalUserId: assertOperationalUserId,
    resolveUserDataMode: resolveUserDataMode,
    isProfileEditableField: isProfileEditableField,
    isReputationDeductForbidden: isReputationDeductForbidden,
    clampLevel: clampLevel,
    isValidLevel: isValidLevel,
    computeAutoLevelFromXp: computeAutoLevelFromXp,
  };
});
