/**
 * 센텐스아레나 — 사용자 데이터 공용 스키마 검증
 * user-data-config-core 를 의존합니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./user-data-config-core'));
  } else {
    root.UserDataSchemaCore = factory(root.UserDataConfigCore);
  }
})(typeof self !== 'undefined' ? self : this, function userDataSchemaCoreFactory(cfg) {
  'use strict';

  if (!cfg) throw new Error('UserDataConfigCore is required before user-data-schema-core.js');

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function isUuid(v) {
    return typeof v === 'string' && cfg.UUID_RE.test(v.trim());
  }

  // -----------------------------------------------------------------------------
  // 사용자 ID 검증
  // -----------------------------------------------------------------------------
  function validateUserId(value, opts) {
    var options = opts || {};
    var strict = options.strict !== false;
    if (!value || typeof value !== 'string') {
      return { valid: false, error: 'USER_DATA_USER_ID_INVALID' };
    }
    var s = value.trim();
    if (cfg.isGuestId(s)) {
      return { valid: false, error: 'USER_DATA_GUEST_NOT_ALLOWED' };
    }
    if (cfg.isEmailLikeId(s)) {
      return { valid: false, error: 'USER_DATA_USER_ID_INVALID' };
    }
    if (strict && !isUuid(s)) {
      return { valid: false, error: 'USER_DATA_USER_ID_INVALID' };
    }
    return { valid: true, userId: s };
  }

  // -----------------------------------------------------------------------------
  // 레벨 검증
  // -----------------------------------------------------------------------------
  function validateLevel(level) {
    if (!cfg.isValidLevel(level)) {
      return { valid: false, error: 'USER_DATA_LEVEL_OUT_OF_RANGE' };
    }
    return { valid: true, level: cfg.clampLevel(level) };
  }

  function normalizeLevel(level) {
    return cfg.clampLevel(level);
  }

  // -----------------------------------------------------------------------------
  // 프로필 검증
  // -----------------------------------------------------------------------------
  function validateProfilePatch(input) {
    var errors = [];
    var src = input || {};
    var warnings = [];
    var forbiddenProgressionFields = ['xp', 'level', 'reputation_score', 'reputationScore',
      'follower_count', 'followerCount', 'following_count', 'followingCount'];
    Object.keys(src).forEach(function (k) {
      if (cfg.PROFILE_SERVER_ONLY_FIELDS.indexOf(k) !== -1) {
        errors.push('USER_DATA_PROFILE_FIELD_NOT_ALLOWED');
      } else if (forbiddenProgressionFields.indexOf(k) !== -1) {
        errors.push('USER_DATA_PROGRESSION_WRITE_FORBIDDEN');
      } else if (!cfg.isProfileEditableField(k)) {
        warnings.push('UNKNOWN_PROFILE_FIELD_' + k.toUpperCase());
      }
    });
    if (src.display_name != null) {
      var dn = String(src.display_name);
      if (dn.length > cfg.LIMITS.displayNameMax) errors.push('USER_DATA_DISPLAY_NAME_TOO_LONG');
      if (!dn.trim()) errors.push('USER_DATA_DISPLAY_NAME_EMPTY');
    }
    if (src.bio != null && String(src.bio).length > cfg.LIMITS.bioMax) {
      errors.push('USER_DATA_BIO_TOO_LONG');
    }
    if (src.home_country != null) {
      var hc = String(src.home_country).trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(hc)) errors.push('USER_DATA_HOME_COUNTRY_INVALID');
    }
    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  // -----------------------------------------------------------------------------
  // 진행 상태 이벤트 검증
  // -----------------------------------------------------------------------------
  function validateProgressionEvent(input) {
    var errors = [];
    var src = input || {};
    var userIdResult = validateUserId(src.userId);
    if (!userIdResult.valid) errors.push(userIdResult.error);
    if (!src.eventType || cfg.PROGRESSION_EVENT_TYPES.indexOf(src.eventType) === -1) {
      errors.push('USER_DATA_PROGRESSION_EVENT_TYPE_INVALID');
    }
    var amount = Number(src.amount);
    if (!isFinite(amount) || isNaN(amount)) {
      errors.push('USER_DATA_PROGRESSION_AMOUNT_INVALID');
    }
    if (src.eventType && cfg.isReputationDeductForbidden(src.eventType) && amount < 0) {
      errors.push('USER_DATA_REPUTATION_DEDUCT_FORBIDDEN');
    }
    if (!src.dedupeKey || String(src.dedupeKey).length > cfg.LIMITS.progressionEventDedupeKeyMax) {
      errors.push('USER_DATA_PROGRESSION_DEDUPE_KEY_INVALID');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // -----------------------------------------------------------------------------
  // 팔로우 검증
  // -----------------------------------------------------------------------------
  function validateFollowInput(followerUserId, followingUserId) {
    var errors = [];
    var r1 = validateUserId(followerUserId);
    if (!r1.valid) errors.push(r1.error);
    var r2 = validateUserId(followingUserId);
    if (!r2.valid) errors.push(r2.error);
    if (r1.valid && r2.valid && r1.userId === r2.userId) {
      errors.push('USER_DATA_FOLLOW_SELF_FORBIDDEN');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // -----------------------------------------------------------------------------
  // 업적 검증
  // -----------------------------------------------------------------------------
  function validateAchievementGrant(input) {
    var errors = [];
    var src = input || {};
    var r = validateUserId(src.userId);
    if (!r.valid) errors.push(r.error);
    if (!src.achievementKey || String(src.achievementKey).length > cfg.LIMITS.achievementKeyMax) {
      errors.push('USER_DATA_ACHIEVEMENT_KEY_INVALID');
    }
    if (!src.acquiredAt) {
      errors.push('USER_DATA_ACHIEVEMENT_ACQUIRED_AT_MISSING');
    } else {
      var d = new Date(src.acquiredAt);
      if (isNaN(d.getTime())) errors.push('USER_DATA_ACHIEVEMENT_ACQUIRED_AT_INVALID');
    }
    if (src.acquisitionSequence == null || !isFinite(Number(src.acquisitionSequence))) {
      errors.push('USER_DATA_ACHIEVEMENT_SEQUENCE_MISSING');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function validateFeaturedAchievements(userId, keys) {
    var errors = [];
    var r = validateUserId(userId);
    if (!r.valid) errors.push(r.error);
    if (!Array.isArray(keys)) {
      errors.push('USER_DATA_FEATURED_ACHIEVEMENTS_INVALID');
    } else if (keys.length > cfg.ACHIEVEMENT_RULES.featuredMax) {
      errors.push('USER_DATA_FEATURED_ACHIEVEMENTS_TOO_MANY');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // -----------------------------------------------------------------------------
  // 알림 검증
  // -----------------------------------------------------------------------------
  function validateNotification(input) {
    var errors = [];
    var src = input || {};
    if (!src.notificationType && !src.type) {
      errors.push('USER_DATA_NOTIFICATION_TYPE_MISSING');
    }
    if (src.message && String(src.message).length > cfg.LIMITS.notificationMessageMax) {
      errors.push('USER_DATA_NOTIFICATION_MESSAGE_TOO_LONG');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // -----------------------------------------------------------------------------
  // 활동 이벤트 검증
  // -----------------------------------------------------------------------------
  function validateActivityEvent(input) {
    var errors = [];
    var src = input || {};
    if (!src.activityType && !src.type) {
      errors.push('USER_DATA_ACTIVITY_EVENT_TYPE_MISSING');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // -----------------------------------------------------------------------------
  // 북마크 검증
  // -----------------------------------------------------------------------------
  function validateBookmark(userId, postId) {
    var errors = [];
    var r = validateUserId(userId);
    if (!r.valid) errors.push(r.error);
    if (!postId || !isUuid(String(postId).trim())) {
      errors.push('USER_DATA_BOOKMARK_INVALID');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // -----------------------------------------------------------------------------
  // 공개 프로필 필터
  // -----------------------------------------------------------------------------
  var PUBLIC_PROFILE_FIELDS = Object.freeze([
    'userId', 'displayName', 'display_name', 'avatarUrl', 'avatar_url',
    'bio', 'territory', 'level', 'reputationGrade', 'rankTier',
    'citizenRank', 'followerCount', 'followingCount', 'featuredAchievements',
    'home_country', 'citizenship_status', 'title_badge_key',
  ]);

  var PRIVATE_PROFILE_FIELDS = Object.freeze([
    'email', 'metadata', 'exile_strike_count',
    'auth', 'oauth', 'authMetadata', 'rawUserMetadata',
    'pendingTerritory', 'lastProcessedBatchId', 'alignmentScore',
    'alignmentSignal', 'moderationState', 'reportHistory',
  ]);

  function filterPublicProfile(profileRow) {
    if (!profileRow || typeof profileRow !== 'object') return {};
    var out = {};
    Object.keys(profileRow).forEach(function (k) {
      if (PRIVATE_PROFILE_FIELDS.indexOf(k) === -1) {
        out[k] = profileRow[k];
      }
    });
    return out;
  }

  return {
    clone: clone,
    isUuid: isUuid,
    validateUserId: validateUserId,
    validateLevel: validateLevel,
    normalizeLevel: normalizeLevel,
    validateProfilePatch: validateProfilePatch,
    validateProgressionEvent: validateProgressionEvent,
    validateFollowInput: validateFollowInput,
    validateAchievementGrant: validateAchievementGrant,
    validateFeaturedAchievements: validateFeaturedAchievements,
    validateNotification: validateNotification,
    validateActivityEvent: validateActivityEvent,
    validateBookmark: validateBookmark,
    filterPublicProfile: filterPublicProfile,
    PUBLIC_PROFILE_FIELDS: PUBLIC_PROFILE_FIELDS,
    PRIVATE_PROFILE_FIELDS: PRIVATE_PROFILE_FIELDS,
  };
});
