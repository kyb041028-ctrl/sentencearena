/**
 * 센텐스크래프트 — 외계 사용자 접근 권한 공용 core
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./alien-moderation-core'), require('./alien-origin-core'));
  } else {
    root.AlienAccessCore = factory(root.AlienModerationCore, root.AlienOriginCore);
  }
})(typeof self !== 'undefined' ? self : this, function alienAccessCoreFactory(modCore, originCore) {
  'use strict';

  function getAlienUserContextFromStatus(input) {
    var src = input || {};
    var status = src.status || modCore.STATUS.EARTH;
    var isAlien = modCore.isAlienRestrictedStatus(status);
    var suspended = status === modCore.STATUS.SUSPENDED;
    var origin = originCore.normalizeAlienOriginTerritory(src.alienOriginTerritory);
    var perms = originCore.getAlienCommunityPartitionPermissions({
      isAlien: isAlien,
      moderationStatus: status,
      alienOriginTerritory: origin,
    });

    if (suspended) {
      return {
        userId: src.userId || null,
        isAlien: false,
        moderationStatus: status,
        canAccessEarthDirectly: false,
        canObserveEarthPosts: false,
        canWriteEarthComment: false,
        canWriteAlienComment: false,
        canReactEarthScope: false,
        canReactAlienScope: false,
        canWriteAlienFreePlaza: false,
        alienOriginTerritory: origin,
        canUseAlienFreePlaza: false,
        partitions: perms,
        available: true,
      };
    }

    if (isAlien) {
      return {
        userId: src.userId || null,
        isAlien: true,
        moderationStatus: status,
        canAccessEarthDirectly: false,
        canObserveEarthPosts: true,
        canWriteEarthComment: false,
        canWriteAlienComment: true,
        canReactEarthScope: false,
        canReactAlienScope: true,
        canWriteAlienFreePlaza: !!(perms.freePlaza && perms.freePlaza.canWrite),
        alienOriginTerritory: origin,
        canUseAlienFreePlaza: true,
        partitions: perms,
        available: true,
      };
    }

    return {
      userId: src.userId || null,
      isAlien: false,
      moderationStatus: status,
      canAccessEarthDirectly: true,
      canObserveEarthPosts: false,
      canWriteEarthComment: true,
      canWriteAlienComment: false,
      canReactEarthScope: true,
      canReactAlienScope: false,
      canWriteAlienFreePlaza: false,
      alienOriginTerritory: origin,
      canUseAlienFreePlaza: false,
      partitions: perms,
      available: true,
    };
  }

  /**
   * body의 audience_scope를 신뢰하지 않고 서버 context로 결정
   */
  function resolveAudienceScopeForWrite(ctx, requestedScope) {
    void requestedScope;
    if (!ctx || !ctx.available) return { ok: false, error: 'ALIEN_CONTEXT_UNAVAILABLE', scope: null };
    if (ctx.canWriteAlienComment && !ctx.canWriteEarthComment) {
      return { ok: true, scope: 'ALIEN' };
    }
    if (ctx.canWriteEarthComment && !ctx.canWriteAlienComment) {
      return { ok: true, scope: 'EARTH' };
    }
    return { ok: false, error: 'ALIEN_WRITE_FORBIDDEN', scope: null };
  }

  function resolveReactionScopeForWrite(ctx, requestedScope) {
    void requestedScope;
    if (!ctx || !ctx.available) return { ok: false, error: 'ALIEN_CONTEXT_UNAVAILABLE', scope: null };
    if (ctx.canReactAlienScope && !ctx.canReactEarthScope) {
      return { ok: true, scope: 'ALIEN' };
    }
    if (ctx.canReactEarthScope && !ctx.canReactAlienScope) {
      return { ok: true, scope: 'EARTH' };
    }
    return { ok: false, error: 'ALIEN_REACTION_FORBIDDEN', scope: null };
  }

  function assertEarthBoardDirectAccess(ctx) {
    if (!ctx || !ctx.available) return { allowed: false, reason: 'CONTEXT_UNAVAILABLE' };
    if (!ctx.canAccessEarthDirectly) return { allowed: false, reason: 'ALIEN_DIRECT_ACCESS_FORBIDDEN' };
    return { allowed: true, reason: null };
  }

  function assertAlienObservationAccess(ctx) {
    if (!ctx || !ctx.available) return { allowed: false, reason: 'CONTEXT_UNAVAILABLE' };
    if (!ctx.canObserveEarthPosts) return { allowed: false, reason: 'OBSERVATION_FORBIDDEN' };
    return { allowed: true, reason: null };
  }

  return {
    getAlienUserContextFromStatus: getAlienUserContextFromStatus,
    resolveAudienceScopeForWrite: resolveAudienceScopeForWrite,
    resolveReactionScopeForWrite: resolveReactionScopeForWrite,
    assertEarthBoardDirectAccess: assertEarthBoardDirectAccess,
    assertAlienObservationAccess: assertAlienObservationAccess,
    canAccessAlienCommunityPartition: originCore.canAccessAlienCommunityPartition,
    getAlienCommunityPartitionPermissions: originCore.getAlienCommunityPartitionPermissions,
    partitionFromCategoryKey: originCore.partitionFromCategoryKey,
  };
});
