/**
 * 외계 시스템 개발용 검사 · 프로필/영토발전 경계 헬퍼
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/alien-moderation-core'),
      require('../shared/alien-access-core'),
      require('../shared/alien-rank-core'),
      require('../shared/alien-legacy-map')
    );
  } else {
    root.AlienSystemInspect = factory(
      root.AlienModerationCore,
      root.AlienAccessCore,
      root.AlienRankCore,
      root.AlienLegacyMap
    );
  }
})(typeof self !== 'undefined' ? self : this, function factory(modCore, accessCore, rankCore, legacyMap) {
  'use strict';

  function populationBucketFromModerationStatus(status) {
    if (modCore.isAlienRestrictedStatus(status)) return 'ALIEN';
    if (status === modCore.STATUS.RETURNED || status === modCore.STATUS.EARTH) return 'EARTH_SOURCE';
    return 'EXCLUDED';
  }

  function publicProfileAlienBoundary(state) {
    return {
      territoryDisplay: modCore.isAlienRestrictedStatus(state && state.status) ? 'ALIEN' : null,
      strikeCountExposed: false,
      entryReasonExposed: false,
      signalScoreExposed: false,
      operatorNoteExposed: false,
    };
  }

  function inspectAlienSystem(options) {
    var opts = options || {};
    var mode = opts.mode || 'LEGACY_LOCAL';
    var status = (opts.currentStatus) || modCore.STATUS.EARTH;
    var ctx = accessCore.getAlienUserContextFromStatus({
      userId: opts.userId || null,
      status: status,
    });
    var warnings = [];
    if (mode === 'API_OPERATIONAL') {
      warnings.push('API_OPERATIONAL_SHOULD_REMAIN_OFF');
    }
    return {
      mode: mode,
      layout: {
        splitViewEnabled: true,
        leftSections: ['ALIEN_POPULAR_OBSERVATION', 'ALIEN_CENTRAL_OBSERVATION', 'ALIEN_TERRITORY_OBSERVATION'],
        rightSections: ['ALIEN_FREE_PLAZA', 'ALIEN_PIONEER_ZONE', 'ALIEN_GUARDIAN_ZONE', 'ALIEN_HALL_OF_FAME'],
        defaultLeft: 'ALIEN_POPULAR_OBSERVATION',
        defaultRight: 'ALIEN_FREE_PLAZA',
      },
      currentUser: {
        userIdValid: !!(opts.userId),
        status: status,
        strikeCountAvailable: opts.strikeCount != null,
        accessContext: ctx,
      },
      partitions: {
        freePlaza: { categoryKey: 'ALIEN_FREE_PLAZA' },
        pioneerZone: { categoryKey: 'ALIEN_PIONEER_ZONE' },
        guardianZone: { categoryKey: 'ALIEN_GUARDIAN_ZONE' },
        hallOfFame: { readModel: true },
      },
      origin: {
        supportedValues: ['PIONEER', 'GUARDIAN', 'CENTRAL', 'UNKNOWN'],
        currentMockOrigin: ctx.alienOriginTerritory || 'UNKNOWN',
        source: 'LEGACY_MOCK',
      },
      permissions: {
        freePlaza: ctx.partitions ? ctx.partitions.freePlaza : null,
        pioneerZone: ctx.partitions ? ctx.partitions.pioneerZone : null,
        guardianZone: ctx.partitions ? ctx.partitions.guardianZone : null,
      },
      observation: {
        centralAvailable: false,
        territoryAvailable: false,
        usesSourceReference: true,
        copiesSourcePost: false,
        earthCommentSeparation: true,
        alienCommentSeparation: true,
        earthAlienScopesSeparated: true,
        reactionSeparation: true,
      },
      moderation: {
        storageReady: true,
        autoDecisionEnabled: false,
        schedulerEnabled: false,
      },
      rank: {
        definitionsReady: rankCore.listRankDefinitions().length === 4,
        calculationEnabled: false,
        weeklyLegendEnabled: false,
      },
      legacy: {
        kantapbiyaReferences: 'UI_LEGACY_ONLY',
        operationalLeakDetected: false,
        sampleNormalize: legacyMap.normalizeLegacyTerritoryId('KANTAPBIYA'),
      },
      privacy: {
        reporterExposed: false,
        signalScoreExposed: false,
        operatorNoteExposed: false,
      },
      warnings: warnings,
      operational: {
        dbWriteEnabled: false,
        migrationApplied: false,
        apiOperational: false,
      },
    };
  }

  var api = {
    populationBucketFromModerationStatus: populationBucketFromModerationStatus,
    publicProfileAlienBoundary: publicProfileAlienBoundary,
    inspectAlienSystem: inspectAlienSystem,
  };

  if (typeof window !== 'undefined') {
    window.__scInspectAlienSystem = function () {
      var mode = 'LEGACY_LOCAL';
      if (window.AlienObservationApiClient && typeof window.AlienObservationApiClient.getMode === 'function') {
        mode = window.AlienObservationApiClient.getMode();
      }
      return inspectAlienSystem({ mode: mode });
    };
  }

  return api;
});
