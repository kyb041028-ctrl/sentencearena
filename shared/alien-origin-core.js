/**
 * 센텐스아레나 — 외계 출신 성향(snapshot) 계약
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlienOriginCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function alienOriginCoreFactory() {
  'use strict';

  var ORIGIN = Object.freeze({
    PIONEER: 'PIONEER',
    GUARDIAN: 'GUARDIAN',
    CENTRAL: 'CENTRAL',
    UNKNOWN: 'UNKNOWN',
  });

  var SOURCE = Object.freeze({
    MODERATION_TRANSFER_SNAPSHOT: 'MODERATION_TRANSFER_SNAPSHOT',
    EXISTING_HISTORY: 'EXISTING_HISTORY',
    LEGACY_MOCK: 'LEGACY_MOCK',
    UNAVAILABLE: 'UNAVAILABLE',
  });

  var PARTITION = Object.freeze({
    FREE_PLAZA: 'freePlaza',
    PIONEER_ZONE: 'pioneerZone',
    GUARDIAN_ZONE: 'guardianZone',
    HALL_OF_FAME: 'hallOfFame',
  });

  var CATEGORY_KEY = Object.freeze({
    ALIEN_FREE_PLAZA: 'ALIEN_FREE_PLAZA',
    ALIEN_PIONEER_ZONE: 'ALIEN_PIONEER_ZONE',
    ALIEN_GUARDIAN_ZONE: 'ALIEN_GUARDIAN_ZONE',
  });

  function normalizeAlienOriginTerritory(value) {
    var raw = String(value || '').trim().toUpperCase();
    if (raw === ORIGIN.PIONEER) return ORIGIN.PIONEER;
    if (raw === ORIGIN.GUARDIAN) return ORIGIN.GUARDIAN;
    if (raw === ORIGIN.CENTRAL) return ORIGIN.CENTRAL;
    if (raw === 'ALIEN' || raw === 'KANTAPBIYA') return ORIGIN.UNKNOWN;
    return ORIGIN.UNKNOWN;
  }

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function buildAlienOriginState(input) {
    var src = input || {};
    return {
      userId: src.userId || null,
      moderationStatus: src.moderationStatus || null,
      currentTerritory: src.currentTerritory || null,
      alienOriginTerritory: normalizeAlienOriginTerritory(src.alienOriginTerritory),
      capturedAt: src.capturedAt || null,
      source: src.source || SOURCE.UNAVAILABLE,
      available: !!src.available,
    };
  }

  function captureAlienOriginTerritory(input) {
    var src = clone(input || {});
    var existing = normalizeAlienOriginTerritory(src.alienOriginTerritory);
    if (existing !== ORIGIN.UNKNOWN) {
      return buildAlienOriginState({
        userId: src.userId,
        moderationStatus: src.moderationStatus,
        currentTerritory: src.currentTerritory,
        alienOriginTerritory: existing,
        capturedAt: src.capturedAt || new Date().toISOString(),
        source: src.source || SOURCE.EXISTING_HISTORY,
        available: true,
      });
    }
    return buildAlienOriginState({
      userId: src.userId,
      moderationStatus: src.moderationStatus,
      currentTerritory: src.currentTerritory,
      alienOriginTerritory: normalizeAlienOriginTerritory(src.currentTerritory),
      capturedAt: src.capturedAt || new Date().toISOString(),
      source: src.source || SOURCE.MODERATION_TRANSFER_SNAPSHOT,
      available: true,
    });
  }

  function buildPartitionPermission(canRead, canWrite) {
    return {
      canRead: !!canRead,
      canWrite: !!canWrite,
      canComment: !!canWrite,
      canReact: !!canWrite,
    };
  }

  function getAlienCommunityPartitionPermissions(params) {
    var p = params || {};
    var isAlien = !!p.isAlien;
    var status = String(p.moderationStatus || '').toUpperCase();
    var origin = normalizeAlienOriginTerritory(p.alienOriginTerritory);
    var writeLocked = status === 'RETURNED' || status === 'SUSPENDED';
    var alienActive = isAlien && !writeLocked;
    if (!isAlien) {
      return {
        originTerritory: origin,
        freePlaza: buildPartitionPermission(false, false),
        pioneerZone: buildPartitionPermission(false, false),
        guardianZone: buildPartitionPermission(false, false),
        hallOfFame: { canRead: false },
      };
    }

    var pioneerWrite = alienActive && origin === ORIGIN.PIONEER;
    var guardianWrite = alienActive && origin === ORIGIN.GUARDIAN;
    var freeWrite = alienActive;
    return {
      originTerritory: origin,
      freePlaza: buildPartitionPermission(true, freeWrite),
      pioneerZone: buildPartitionPermission(true, pioneerWrite),
      guardianZone: buildPartitionPermission(true, guardianWrite),
      hallOfFame: { canRead: true },
    };
  }

  function canAccessAlienCommunityPartition(params) {
    var p = params || {};
    var perms = getAlienCommunityPartitionPermissions(p);
    var partition = p.partition || PARTITION.FREE_PLAZA;
    var action = p.action || 'read';
    var target = perms[partition];
    if (!target) return { ok: false, error: 'ALIEN_COMMUNITY_ACCESS_FORBIDDEN' };
    if (action === 'read') {
      if (!target.canRead) return { ok: false, error: 'ALIEN_PARTITION_READ_FORBIDDEN' };
      return { ok: true, error: null };
    }
    var key = action === 'comment' ? 'canComment' : action === 'react' ? 'canReact' : 'canWrite';
    if (!target[key]) return { ok: false, error: 'ALIEN_PARTITION_WRITE_FORBIDDEN' };
    return { ok: true, error: null };
  }

  function partitionFromCategoryKey(categoryKey) {
    if (categoryKey === CATEGORY_KEY.ALIEN_PIONEER_ZONE) return PARTITION.PIONEER_ZONE;
    if (categoryKey === CATEGORY_KEY.ALIEN_GUARDIAN_ZONE) return PARTITION.GUARDIAN_ZONE;
    return PARTITION.FREE_PLAZA;
  }

  return {
    ORIGIN: ORIGIN,
    SOURCE: SOURCE,
    PARTITION: PARTITION,
    CATEGORY_KEY: CATEGORY_KEY,
    normalizeAlienOriginTerritory: normalizeAlienOriginTerritory,
    buildAlienOriginState: buildAlienOriginState,
    captureAlienOriginTerritory: captureAlienOriginTerritory,
    getAlienCommunityPartitionPermissions: getAlienCommunityPartitionPermissions,
    canAccessAlienCommunityPartition: canAccessAlienCommunityPartition,
    partitionFromCategoryKey: partitionFromCategoryKey,
  };
});
