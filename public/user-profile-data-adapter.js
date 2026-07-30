/**
 * 센텐스크래프트 — 프로필 UI 데이터 adapter
 * API public profile contract ↔ ScMiniProfile / ScProfileModal / ProfileFrame
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/user-data-config-core'),
      require('../shared/public-profile-core')
    );
  } else {
    root.UserProfileDataAdapter = factory(root.UserDataConfigCore, root.PublicProfileCore);
  }
})(typeof self !== 'undefined' ? self : this, function userProfileDataAdapterFactory(cfg, publicProfile) {
  'use strict';

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function territoryToSkin(territory) {
    if (!territory) return null;
    var s = String(territory).trim().toUpperCase();
    if (s === 'CENTRAL' || s === 'CENTER') return 'center';
    if (s === 'PIONEER' || s === 'PROGRESSIVE') return 'pioneer';
    if (s === 'GUARDIAN' || s === 'CONSERVATIVE') return 'guardian';
    if (s === 'ALIEN' || s === 'KANTAPBIYA') return 'alien';
    return null;
  }

  function featuredToUiAchievements(list) {
    var items = Array.isArray(list) ? list : [];
    return items.slice(0, 3).map(function (a, i) {
      return {
        id: a.achievementKey || ('slot-' + (i + 1)),
        title: a.title || a.achievementKey || '',
        date: a.acquiredAt ? String(a.acquiredAt).slice(0, 10) : '',
        dateTitle: a.acquiredAt || '',
        rarity: 'common',
        iconId: a.achievementKey || null,
        iconUrl: a.iconUrl || null,
        placeholder: !!a.placeholder,
      };
    });
  }

  function alignmentMapToUi(alignmentMap) {
    if (!alignmentMap || !alignmentMap.available) {
      return { center: null, pioneer: null, guardian: null, alien: null, available: false };
    }
    var v = alignmentMap.value;
    if (v && typeof v === 'object') {
      return {
        center: v.center != null ? v.center : null,
        pioneer: v.pioneer != null ? v.pioneer : null,
        guardian: v.guardian != null ? v.guardian : null,
        alien: v.alien != null ? v.alien : null,
        available: true,
      };
    }
    return {
      center: null, pioneer: null, guardian: null, alien: null,
      available: true, displayValue: alignmentMap.displayValue,
    };
  }

  function mapPublicProfileToMiniProfile(contract) {
    var src = contract || {};
    var frozen = clone(src);
    if (src.dataStatus === 'LOADING') {
      return { userId: src.userId, nickname: '', loading: true, dataStatus: 'LOADING' };
    }
    if (src.isAnonymous) {
      return { userId: null, nickname: '익명', isAnonymous: true, dataStatus: src.dataStatus };
    }
    if (src.dataStatus === 'NOT_FOUND' || src.dataStatus === 'DELETED') {
      return {
        userId: src.userId,
        nickname: src.displayName || (src.dataStatus === 'DELETED' ? '탈퇴한 사용자' : '존재하지 않는 사용자'),
        dataStatus: src.dataStatus,
        level: null,
        photoUrl: null,
      };
    }
    return {
      userId: frozen.userId,
      nickname: frozen.displayName || '',
      photoUrl: frozen.avatarUrl || null,
      level: frozen.level,
      rankLabel: frozen.reputationGrade || frozen.citizenRank || null,
      territoryId: frozen.territory || null,
      territoryLabel: frozen.territory || null,
      territoryCss: territoryToSkin(frozen.territory),
      posts: null,
      comments: null,
      influence: null,
      achievements: featuredToUiAchievements(frozen.featuredAchievements),
      followerCount: frozen.followerCount,
      followingCount: frozen.followingCount,
      isFollowing: frozen.isFollowing,
      dataStatus: frozen.dataStatus,
      alignmentAvailable: !!(frozen.alignmentMap && frozen.alignmentMap.available),
    };
  }

  function mapPublicProfileToProfileModal(contract, options) {
    var opts = options || {};
    var src = contract || {};
    var frozen = clone(src);
    var isSelf = opts.includeXp === true || frozen.isMine === true;

    if (frozen.isAnonymous) {
      return {
        userId: null,
        nickname: '익명',
        level: null,
        followers: null,
        fame: null,
        expPercent: null,
        territorySkin: 'center',
        achievements: [],
        alignment: alignmentMapToUi(null),
        dataStatus: frozen.dataStatus,
        isAnonymous: true,
      };
    }

    var expPercent = null;
    if (isSelf && frozen._xpProgressDetail && frozen._xpProgressDetail.available) {
      expPercent = Math.round((frozen._xpProgressDetail.progressRatio || 0) * 100);
    } else if (isSelf && frozen.xpProgress != null && isFinite(frozen.xpProgress)) {
      expPercent = Math.round(Number(frozen.xpProgress) * 100);
    }

    var skin = territoryToSkin(frozen.territory) || 'center';

    return {
      userId: frozen.displayName || frozen.userId || '',
      authUserId: frozen.userId,
      nickname: frozen.displayName || '',
      profileImageUrl: frozen.avatarUrl || null,
      bio: frozen.bio || null,
      level: frozen.level,
      followers: frozen.followerCount,
      fame: frozen.reputationScore,
      expPercent: expPercent,
      territorySkin: skin,
      territory: {
        current: frozen.territory || null,
        moved: null,
        influence: null,
        rank: frozen.reputationGrade || null,
      },
      citizenRank: frozen.citizenRank,
      reputationGrade: frozen.reputationGrade,
      achievements: featuredToUiAchievements(frozen.featuredAchievements),
      alignment: alignmentMapToUi(frozen.alignmentMap),
      activity: {},
      dataStatus: frozen.dataStatus,
      accountState: frozen.accountState,
      isMine: !!frozen.isMine,
      canFollow: !!frozen.canFollow,
      isFollowing: !!frozen.isFollowing,
      followingCount: frozen.followingCount,
    };
  }

  function mapLegacyUserToPublicProfile(legacy, extras) {
    var src = legacy || {};
    var ex = extras || {};
    var snapshot = clone(src);
    void snapshot;

    var userId = ex.userId || src.authUserId || null;
    var territory = ex.territory || null;
    if (!territory && src.territorySkin) {
      var skinMap = { center: 'CENTRAL', pioneer: 'PIONEER', guardian: 'GUARDIAN', alien: 'ALIEN' };
      territory = skinMap[src.territorySkin] || null;
    }

    var featured = [];
    if (Array.isArray(src.achievements)) {
      featured = src.achievements.slice(0, 3).map(function (a, i) {
        return {
          achievementKey: a.id || a.iconId || ('legacy-' + i),
          title: a.title || '',
          iconUrl: a.iconUrl || null,
          acquiredAt: a.dateTitle || a.date || null,
          acquisitionSequence: i + 1,
          seasonKey: null,
          slot: i + 1,
        };
      });
    }

    return publicProfile.buildLegacyMockProfileViewModel({
      userId: userId,
      displayName: src.nickname || src.userId || null,
      avatarUrl: src.profileImageUrl || null,
      bio: src.bio || null,
      territory: territory,
      level: src.level != null ? src.level : null,
      reputationScore: src.fame != null ? src.fame : null,
      reputationGrade: (src.territory && src.territory.rank) || null,
      citizenRank: null,
      followerCount: src.followers != null ? src.followers : null,
      followingCount: ex.followingCount != null ? ex.followingCount : null,
      isFollowing: !!ex.isFollowing,
      isFollowedBy: !!ex.isFollowedBy,
      featuredAchievements: featured,
      alignmentMap: src.alignment
        ? { available: true, value: src.alignment, displayValue: null }
        : publicProfile.emptyAlignmentMap(),
      isMine: !!ex.isMine,
      canFollow: !ex.isMine,
      canOpenFullProfile: true,
      accountState: publicProfile.ACCOUNT_STATE.ACTIVE,
    });
  }

  return {
    mapPublicProfileToMiniProfile: mapPublicProfileToMiniProfile,
    mapPublicProfileToProfileModal: mapPublicProfileToProfileModal,
    mapLegacyUserToPublicProfile: mapLegacyUserToPublicProfile,
    buildAnonymousProfileViewModel: function () { return publicProfile.buildAnonymousProfileViewModel(); },
    buildDeletedProfileViewModel: function (userId) { return publicProfile.buildDeletedProfileViewModel(userId); },
    buildUnavailableProfileViewModel: function (userId, reason) { return publicProfile.buildUnavailableProfileViewModel(userId, reason); },
    buildNotFoundProfileViewModel: function (userId) { return publicProfile.buildNotFoundProfileViewModel(userId); },
    buildLoadingProfileViewModel: function (userId) { return publicProfile.buildLoadingProfileViewModel(userId); },
    canOpenProfileFromAuthorContext: function (ctx) { return publicProfile.canOpenProfileFromAuthorContext(ctx); },
    territoryToSkin: territoryToSkin,
  };
});
