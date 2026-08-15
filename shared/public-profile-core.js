/**
 * 센텐스아레나 — 단일 공개 프로필 데이터 계약
 * 브라우저(UMD) · Node(CommonJS) 공용
 *
 * UI(ProfileFrame / ScMiniProfile / ScProfileModal)와
 * user-data API 사이의 단일 원천 계약.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./user-data-config-core'), require('./user-data-schema-core'));
  } else {
    root.PublicProfileCore = factory(root.UserDataConfigCore, root.UserDataSchemaCore);
  }
})(typeof self !== 'undefined' ? self : this, function publicProfileCoreFactory(cfg, schema) {
  'use strict';

  if (!cfg) throw new Error('UserDataConfigCore is required before public-profile-core.js');
  if (!schema) throw new Error('UserDataSchemaCore is required before public-profile-core.js');

  var DATA_STATUS = Object.freeze({
    READY: 'READY',
    LOADING: 'LOADING',
    NOT_FOUND: 'NOT_FOUND',
    PRIVATE: 'PRIVATE',
    DELETED: 'DELETED',
    UNAVAILABLE: 'UNAVAILABLE',
    LEGACY_MOCK: 'LEGACY_MOCK',
  });

  var ACCOUNT_STATE = Object.freeze({
    ACTIVE: 'ACTIVE',
    DELETED: 'DELETED',
    SUSPENDED: 'SUSPENDED',
    UNKNOWN: 'UNKNOWN',
  });

  var PROFILE_VISIBILITY = Object.freeze({
    PUBLIC: 'PUBLIC',
    PRIVATE: 'PRIVATE',
    UNKNOWN: 'UNKNOWN',
  });

  var PROFILE_CACHE_TTL_MS = 30000;

  /** 공개 프로필에서 절대 포함하면 안 되는 필드 */
  var FORBIDDEN_PUBLIC_FIELDS = Object.freeze([
    'email', 'metadata', 'exile_strike_count', 'auth', 'oauth', 'authMetadata',
    'rawUserMetadata', 'pendingTerritory', 'lastProcessedBatchId', 'alignmentScore',
    'alignmentSignal', 'moderationState', 'reportHistory', 'notifications',
    'bookmarks', 'provider', 'serviceRole', 'operatorNotes', 'xp',
    'xpProgress', 'xpRequired', 'nextLevelXp',
  ]);

  var PUBLIC_PROFILE_REQUIRED = Object.freeze([
    'userId', 'displayName', 'dataStatus', 'accountState', 'isMine',
    'isAnonymous', 'isDeleted', 'canFollow', 'canOpenFullProfile',
  ]);

  var REPUTATION_GRADE_LABELS = Object.freeze({
    0: '참여자',
    1: '시민',
    2: '논객',
    3: '대표',
    4: '지도자',
  });

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function isDataStatus(v) {
    return Object.prototype.hasOwnProperty.call(DATA_STATUS, String(v));
  }

  function isAccountState(v) {
    return Object.prototype.hasOwnProperty.call(ACCOUNT_STATE, String(v));
  }

  function emptyAlignmentMap() {
    return { available: false, value: null, displayValue: null };
  }

  function emptyXpProgress() {
    return {
      level: cfg.USER_LEVEL_MIN,
      currentXp: null,
      levelStartXp: null,
      nextLevelXp: null,
      progressRatio: null,
      isMaxLevel: false,
      available: false,
    };
  }

  /**
   * XP 진행률. 공식 Lv1~10 (shared/progression-xp-core · PROGRESSION_RULES).
   * thresholds[0..9]=Lv 시작 · thresholds[10]=1500 게이지 cap
   */
  function buildProfileXpProgress(input) {
    var src = input || {};
    var level = Math.floor(Number(src.level));
    var xp = src.xp == null ? null : Math.floor(Number(src.xp));
    var thresholds = Array.isArray(src.thresholds)
      ? src.thresholds
      : (cfg.PROGRESSION_RULES.levelCumulativeXp || []);

    if (!cfg.isValidLevel(level)) {
      return Object.assign(emptyXpProgress(), { level: cfg.USER_LEVEL_MIN });
    }

    var isMax = level >= cfg.USER_LEVEL_MAX;
    var autoCap = cfg.PROGRESSION_RULES.autoLevelCap || 10;
    var levelStarts = thresholds.length > 10 ? thresholds.slice(0, 10) : thresholds;

    if (level > autoCap || level > levelStarts.length) {
      return {
        level: level,
        currentXp: xp,
        levelStartXp: null,
        nextLevelXp: null,
        progressRatio: null,
        isMaxLevel: isMax,
        available: false,
      };
    }

    if (xp == null || !isFinite(xp) || isNaN(xp)) {
      return {
        level: level,
        currentXp: null,
        levelStartXp: thresholds[level - 1] != null ? thresholds[level - 1] : null,
        nextLevelXp: thresholds[level] != null ? thresholds[level] : null,
        progressRatio: null,
        isMaxLevel: isMax || level >= autoCap,
        available: false,
      };
    }

    var start = thresholds[level - 1] != null ? thresholds[level - 1] : 0;
    var next = thresholds[level];
    if (next == null) {
      return {
        level: level,
        currentXp: Math.max(0, xp),
        levelStartXp: start,
        nextLevelXp: null,
        progressRatio: null,
        isMaxLevel: true,
        available: false,
      };
    }

    var span = next - start;
    var ratio = span > 0 ? (xp - start) / span : 0;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    return {
      level: level,
      currentXp: Math.max(0, xp),
      levelStartXp: start,
      nextLevelXp: next,
      progressRatio: ratio,
      isMaxLevel: isMax || level >= autoCap,
      available: true,
    };
  }

  function resolveReputationGrade(rankTier) {
    var t = Math.floor(Number(rankTier));
    if (!isFinite(t) || isNaN(t) || t < 0) return null;
    if (t > 4) t = 4;
    return REPUTATION_GRADE_LABELS[t] != null ? REPUTATION_GRADE_LABELS[t] : null;
  }

  function sortFeaturedAchievementsBySlot(rows) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    list.sort(function (a, b) {
      return (Number(a.slot) || 99) - (Number(b.slot) || 99);
    });
    return list.slice(0, cfg.ACHIEVEMENT_RULES.featuredMax);
  }

  /**
   * 대표 업적 display 매핑.
   * definitionLookup: { [achievementKey]: { title, iconUrl, description } }
   */
  function resolveFeaturedAchievementDisplay(row, definitionLookup) {
    var key = row && (row.achievementKey || row.achievement_key);
    if (!key) {
      return { status: 'WARNING', warning: 'MISSING_KEY', achievementKey: null };
    }
    var defs = definitionLookup || {};
    var def = defs[key] || null;
    var owned = row.owned !== false;
    if (!owned) {
      return {
        status: 'EXCLUDED',
        warning: 'NOT_OWNED',
        achievementKey: key,
      };
    }
    var title = (def && def.title) || row.title || key;
    var iconUrl = (def && def.iconUrl) || row.iconUrl || null;
    return {
      status: def ? 'OK' : 'WARNING',
      warning: def ? null : 'DEFINITION_MISSING',
      achievementKey: key,
      title: title,
      iconUrl: iconUrl || null,
      placeholder: !iconUrl,
      acquiredAt: row.acquiredAt || row.acquired_at || null,
      acquisitionSequence: row.acquisitionSequence != null
        ? row.acquisitionSequence
        : (row.acquisition_sequence != null ? row.acquisition_sequence : null),
      seasonKey: row.seasonKey != null ? row.seasonKey : (row.season_key || null),
      slot: row.slot != null ? Number(row.slot) : null,
    };
  }

  function mapFeaturedAchievements(rows, definitionLookup) {
    var sorted = sortFeaturedAchievementsBySlot(rows);
    var out = [];
    var warnings = [];
    for (var i = 0; i < sorted.length; i++) {
      var mapped = resolveFeaturedAchievementDisplay(sorted[i], definitionLookup);
      if (mapped.status === 'EXCLUDED') {
        warnings.push({ key: mapped.achievementKey, warning: mapped.warning });
        continue;
      }
      if (mapped.status === 'WARNING') {
        warnings.push({ key: mapped.achievementKey, warning: mapped.warning });
      }
      out.push({
        achievementKey: mapped.achievementKey,
        title: mapped.title,
        iconUrl: mapped.iconUrl,
        placeholder: !!mapped.placeholder,
        acquiredAt: mapped.acquiredAt,
        acquisitionSequence: mapped.acquisitionSequence,
        seasonKey: mapped.seasonKey,
        slot: mapped.slot,
      });
    }
    return { items: out, warnings: warnings };
  }

  function canOpenProfileFromAuthorContext(ctx) {
    var c = ctx || {};
    if (c.isAnonymous) return { allowed: false, reason: 'ANONYMOUS' };
    if (c.isBlinded) return { allowed: false, reason: 'BLINDED' };
    if (c.isDeleted) return { allowed: false, reason: 'DELETED' };
    if (!c.userId || cfg.isGuestId(c.userId)) return { allowed: false, reason: 'NO_USER_ID' };
    if (cfg.isEmailLikeId(c.userId)) return { allowed: false, reason: 'EMAIL_ID' };
    return { allowed: true, reason: null };
  }

  function baseProfileShell(overrides) {
    var o = overrides || {};
    return {
      userId: o.userId != null ? o.userId : null,
      displayName: o.displayName != null ? o.displayName : null,
      avatarUrl: o.avatarUrl != null ? o.avatarUrl : null,
      bio: o.bio != null ? o.bio : null,
      territory: o.territory != null ? o.territory : null,
      level: o.level != null ? o.level : null,
      xp: null,
      xpProgress: null,
      xpRequired: null,
      reputationScore: o.reputationScore != null ? o.reputationScore : null,
      reputationGrade: o.reputationGrade != null ? o.reputationGrade : null,
      citizenRank: o.citizenRank != null ? o.citizenRank : null,
      followerCount: o.followerCount != null ? o.followerCount : null,
      followingCount: o.followingCount != null ? o.followingCount : null,
      isFollowing: o.isFollowing === true,
      isFollowedBy: o.isFollowedBy === true,
      featuredAchievements: Array.isArray(o.featuredAchievements) ? o.featuredAchievements : [],
      alignmentMap: o.alignmentMap || emptyAlignmentMap(),
      profileVisibility: o.profileVisibility || PROFILE_VISIBILITY.PUBLIC,
      accountState: o.accountState || ACCOUNT_STATE.UNKNOWN,
      isMine: o.isMine === true,
      isAnonymous: o.isAnonymous === true,
      isDeleted: o.isDeleted === true,
      isBlocked: o.isBlocked === true,
      canFollow: o.canFollow !== false && !o.isDeleted && !o.isAnonymous && !o.isBlocked,
      canOpenFullProfile: o.canOpenFullProfile !== false && !o.isAnonymous && !o.isDeleted,
      dataStatus: o.dataStatus || DATA_STATUS.UNAVAILABLE,
    };
  }

  function buildLoadingProfileViewModel(userId) {
    return baseProfileShell({
      userId: userId || null,
      displayName: null,
      dataStatus: DATA_STATUS.LOADING,
      accountState: ACCOUNT_STATE.UNKNOWN,
      canFollow: false,
      canOpenFullProfile: false,
    });
  }

  function buildNotFoundProfileViewModel(userId) {
    return baseProfileShell({
      userId: userId || null,
      displayName: '존재하지 않는 사용자',
      dataStatus: DATA_STATUS.NOT_FOUND,
      accountState: ACCOUNT_STATE.UNKNOWN,
      canFollow: false,
      canOpenFullProfile: false,
    });
  }

  function buildPrivateProfileViewModel(userId, partial) {
    var p = partial || {};
    return baseProfileShell({
      userId: userId || null,
      displayName: p.displayName || '비공개 사용자',
      avatarUrl: p.avatarUrl || null,
      territory: p.territory || null,
      level: p.level != null ? p.level : null,
      followerCount: p.followerCount != null ? p.followerCount : null,
      followingCount: p.followingCount != null ? p.followingCount : null,
      bio: null,
      featuredAchievements: [],
      alignmentMap: emptyAlignmentMap(),
      profileVisibility: PROFILE_VISIBILITY.PRIVATE,
      dataStatus: DATA_STATUS.PRIVATE,
      accountState: ACCOUNT_STATE.ACTIVE,
      canFollow: p.canFollow !== false,
      canOpenFullProfile: false,
    });
  }

  function buildDeletedProfileViewModel(userId) {
    return baseProfileShell({
      userId: userId || null,
      displayName: '탈퇴한 사용자',
      avatarUrl: null,
      dataStatus: DATA_STATUS.DELETED,
      accountState: ACCOUNT_STATE.DELETED,
      isDeleted: true,
      canFollow: false,
      canOpenFullProfile: false,
    });
  }

  function buildUnavailableProfileViewModel(userId, reason) {
    return baseProfileShell({
      userId: userId || null,
      displayName: null,
      dataStatus: DATA_STATUS.UNAVAILABLE,
      accountState: ACCOUNT_STATE.UNKNOWN,
      canFollow: false,
      canOpenFullProfile: false,
      _unavailableReason: reason || null,
    });
  }

  function buildAnonymousProfileViewModel() {
    return baseProfileShell({
      userId: null,
      displayName: '익명',
      avatarUrl: null,
      dataStatus: DATA_STATUS.READY,
      accountState: ACCOUNT_STATE.UNKNOWN,
      isAnonymous: true,
      canFollow: false,
      canOpenFullProfile: false,
    });
  }

  function buildLegacyMockProfileViewModel(partial) {
    var p = partial || {};
    var shell = baseProfileShell(Object.assign({}, p, {
      dataStatus: DATA_STATUS.LEGACY_MOCK,
      accountState: p.accountState || ACCOUNT_STATE.ACTIVE,
    }));
    return shell;
  }

  function detectPublicLeaks(profile) {
    var leaked = [];
    if (!profile || typeof profile !== 'object') return { publicLeakDetected: false, leakedFields: leaked };
    Object.keys(profile).forEach(function (k) {
      if (FORBIDDEN_PUBLIC_FIELDS.indexOf(k) !== -1 && profile[k] != null) {
        leaked.push(k);
      }
    });
    return { publicLeakDetected: leaked.length > 0, leakedFields: leaked };
  }

  function sanitizePublicProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    var src = clone(profile);
    FORBIDDEN_PUBLIC_FIELDS.forEach(function (k) { delete src[k]; });
    // self-only XP 필드 강제 제거
    src.xp = null;
    src.xpProgress = null;
    src.xpRequired = null;
    if (src.alignmentMap && src.alignmentMap.rawScore != null) {
      delete src.alignmentMap.rawScore;
    }
    return src;
  }

  function sanitizeSelfProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    var src = clone(profile);
    // self에서도 절대 노출 금지
    ['email', 'metadata', 'auth', 'oauth', 'authMetadata', 'rawUserMetadata',
      'moderationState', 'reportHistory', 'operatorNotes', 'serviceRole',
      'pendingTerritory', 'lastProcessedBatchId', 'alignmentSignal'].forEach(function (k) {
      delete src[k];
    });
    if (src.alignmentMap && src.alignmentMap.rawScore != null) {
      delete src.alignmentMap.rawScore;
    }
    return src;
  }

  /**
   * 공개 프로필 조립 (입력 비변경)
   */
  function mapPublicUserProfile(parts) {
    var p = parts || {};
    var profile = p.profile || {};
    var progression = p.progression || {};
    var followState = p.followState || {};
    var territoryInfo = p.territoryInfo || {};
    var alignmentMap = p.alignmentMap || emptyAlignmentMap();
    var featured = p.featuredAchievements || [];
    var viewerUserId = p.viewerUserId || null;
    var targetUserId = p.targetUserId || profile.id || profile.userId || progression.user_id || null;

    var level = progression.level != null ? cfg.clampLevel(progression.level) : null;
    var rankTier = progression.rankTier != null ? progression.rankTier : null;
    var reputationGrade = p.reputationGrade != null
      ? p.reputationGrade
      : resolveReputationGrade(rankTier);

    var accountState = p.accountState || ACCOUNT_STATE.ACTIVE;
    var dataStatus = p.dataStatus || DATA_STATUS.READY;
    if (accountState === ACCOUNT_STATE.DELETED) {
      return buildDeletedProfileViewModel(targetUserId);
    }

    var isMine = !!(viewerUserId && targetUserId && String(viewerUserId) === String(targetUserId));
    var out = baseProfileShell({
      userId: targetUserId,
      displayName: profile.display_name || profile.displayName || null,
      avatarUrl: profile.avatar_url || profile.avatarUrl || null,
      bio: profile.bio != null ? profile.bio : null,
      territory: territoryInfo.territory != null ? territoryInfo.territory : (profile.territory || null),
      level: level,
      reputationScore: progression.reputation_score != null
        ? progression.reputation_score
        : (progression.reputationScore != null ? progression.reputationScore : null),
      reputationGrade: reputationGrade,
      citizenRank: progression.citizen_rank != null
        ? progression.citizen_rank
        : (progression.citizenRank != null ? progression.citizenRank : null),
      followerCount: progression.follower_count != null
        ? progression.follower_count
        : (progression.followerCount != null ? progression.followerCount : 0),
      followingCount: progression.following_count != null
        ? progression.following_count
        : (progression.followingCount != null ? progression.followingCount : 0),
      isFollowing: !!followState.isFollowing,
      isFollowedBy: !!followState.isFollowedBy,
      featuredAchievements: featured,
      alignmentMap: {
        available: !!alignmentMap.available,
        value: alignmentMap.value != null ? alignmentMap.value : null,
        displayValue: alignmentMap.displayValue != null ? alignmentMap.displayValue : null,
      },
      profileVisibility: p.profileVisibility || PROFILE_VISIBILITY.PUBLIC,
      accountState: accountState,
      isMine: isMine,
      isAnonymous: false,
      isDeleted: false,
      isBlocked: !!p.isBlocked,
      canFollow: !isMine && !p.isBlocked,
      canOpenFullProfile: true,
      dataStatus: dataStatus,
    });

    if (territoryInfo.available === false && out.territory == null) {
      out._territoryAvailable = false;
    }

    return sanitizePublicProfile(out);
  }

  /**
   * 본인 프로필 — XP 진행률 포함 (공개 sanitize와 분리)
   */
  function mapSelfUserProfile(parts) {
    var pub = mapPublicUserProfile(Object.assign({}, parts, { viewerUserId: parts && parts.targetUserId }));
    if (!pub) return null;
    var self = clone(pub);
    self.isMine = true;
    self.canFollow = false;
    var progression = (parts && parts.progression) || {};
    var xp = progression.xp != null ? progression.xp : null;
    var level = self.level != null ? self.level : cfg.USER_LEVEL_MIN;
    var xpProg = buildProfileXpProgress({
      level: level,
      xp: xp,
      thresholds: cfg.PROGRESSION_RULES.levelCumulativeXp,
    });
    self.xp = xp;
    self.xpProgress = xpProg.progressRatio;
    self.xpRequired = xpProg.nextLevelXp != null && xpProg.levelStartXp != null
      ? (xpProg.nextLevelXp - xpProg.levelStartXp)
      : null;
    self._xpProgressDetail = xpProg;
    return sanitizeSelfProfile(self);
  }

  function validatePublicProfileContract(profile) {
    var errors = [];
    if (!profile || typeof profile !== 'object') {
      return { valid: false, errors: ['PROFILE_MISSING'] };
    }
    PUBLIC_PROFILE_REQUIRED.forEach(function (k) {
      if (profile[k] === undefined) errors.push('MISSING_' + k);
    });
    if (profile.dataStatus && !isDataStatus(profile.dataStatus)) {
      errors.push('DATA_STATUS_INVALID');
    }
    if (profile.accountState && !isAccountState(profile.accountState)) {
      errors.push('ACCOUNT_STATE_INVALID');
    }
    if (profile.userId != null) {
      var idCheck = schema.validateUserId(profile.userId, { strict: true });
      if (!idCheck.valid && profile.dataStatus === DATA_STATUS.READY && !profile.isAnonymous) {
        errors.push(idCheck.error || 'USER_DATA_USER_ID_INVALID');
      }
    }
    if (profile.level != null && !cfg.isValidLevel(profile.level)) {
      errors.push('USER_DATA_LEVEL_OUT_OF_RANGE');
    }
    var leak = detectPublicLeaks(profile);
    if (leak.publicLeakDetected) errors.push('PUBLIC_LEAK');
    return { valid: errors.length === 0, errors: errors, leaks: leak.leakedFields };
  }

  return {
    DATA_STATUS: DATA_STATUS,
    ACCOUNT_STATE: ACCOUNT_STATE,
    PROFILE_VISIBILITY: PROFILE_VISIBILITY,
    PROFILE_CACHE_TTL_MS: PROFILE_CACHE_TTL_MS,
    FORBIDDEN_PUBLIC_FIELDS: FORBIDDEN_PUBLIC_FIELDS,
    PUBLIC_PROFILE_REQUIRED: PUBLIC_PROFILE_REQUIRED,
    REPUTATION_GRADE_LABELS: REPUTATION_GRADE_LABELS,
    clone: clone,
    isDataStatus: isDataStatus,
    isAccountState: isAccountState,
    emptyAlignmentMap: emptyAlignmentMap,
    emptyXpProgress: emptyXpProgress,
    buildProfileXpProgress: buildProfileXpProgress,
    resolveReputationGrade: resolveReputationGrade,
    sortFeaturedAchievementsBySlot: sortFeaturedAchievementsBySlot,
    resolveFeaturedAchievementDisplay: resolveFeaturedAchievementDisplay,
    mapFeaturedAchievements: mapFeaturedAchievements,
    canOpenProfileFromAuthorContext: canOpenProfileFromAuthorContext,
    baseProfileShell: baseProfileShell,
    buildLoadingProfileViewModel: buildLoadingProfileViewModel,
    buildNotFoundProfileViewModel: buildNotFoundProfileViewModel,
    buildPrivateProfileViewModel: buildPrivateProfileViewModel,
    buildDeletedProfileViewModel: buildDeletedProfileViewModel,
    buildUnavailableProfileViewModel: buildUnavailableProfileViewModel,
    buildAnonymousProfileViewModel: buildAnonymousProfileViewModel,
    buildLegacyMockProfileViewModel: buildLegacyMockProfileViewModel,
    detectPublicLeaks: detectPublicLeaks,
    sanitizePublicProfile: sanitizePublicProfile,
    sanitizeSelfProfile: sanitizeSelfProfile,
    mapPublicUserProfile: mapPublicUserProfile,
    mapSelfUserProfile: mapSelfUserProfile,
    validatePublicProfileContract: validatePublicProfileContract,
  };
});
