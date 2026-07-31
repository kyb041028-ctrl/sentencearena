/**
 * 외계 시스템 개발용 검사 · 프로필/영토발전 경계 헬퍼
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/alien-moderation-core'),
      require('../shared/alien-access-core'),
      require('../shared/alien-rank-core'),
      require('../shared/alien-legacy-map'),
      require('./alien-observation-data-adapter')
    );
  } else {
    root.AlienSystemInspect = factory(
      root.AlienModerationCore,
      root.AlienAccessCore,
      root.AlienRankCore,
      root.AlienLegacyMap,
      root.AlienObservationDataAdapter
    );
  }
})(typeof self !== 'undefined' ? self : this, function factory(modCore, accessCore, rankCore, legacyMap, obsAdapter) {
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
      alienOriginTerritory: opts.alienOriginTerritory,
    });
    var warnings = [];
    if (mode === 'API_OPERATIONAL') {
      warnings.push('API_OPERATIONAL_SHOULD_REMAIN_OFF');
    }
    var paging = obsAdapter && typeof obsAdapter.buildAlienPaginationState === 'function'
      ? obsAdapter.buildAlienPaginationState({
        leftSection: opts.leftSection || 'ALIEN_POPULAR_OBSERVATION',
        rightSection: opts.rightSection || 'ALIEN_FREE_PLAZA',
        leftPage: opts.leftPage || 1,
        rightPage: opts.rightPage || 1,
        leftTotalItems: opts.leftTotalItems != null ? opts.leftTotalItems : 0,
        rightTotalItems: opts.rightTotalItems != null ? opts.rightTotalItems : 0,
      })
      : null;
    var writeButton = obsAdapter && typeof obsAdapter.resolveWriteButtonState === 'function'
      ? obsAdapter.resolveWriteButtonState({
        rightSection: opts.rightSection || 'ALIEN_FREE_PLAZA',
        originTerritory: (ctx && ctx.alienOriginTerritory) || opts.alienOriginTerritory || 'UNKNOWN',
        status: status,
        boardUnlocked: opts.boardUnlocked !== false,
      })
      : { visible: false, enabled: false, reason: 'UNAVAILABLE' };
    return {
      mode: mode,
      layout: {
        splitViewEnabled: true,
        splitRatio: '52:48',
        internalScrollbars: false,
        rightTabsSingleRow: true,
        leftSections: ['ALIEN_POPULAR_OBSERVATION', 'ALIEN_CENTRAL_OBSERVATION', 'ALIEN_TERRITORY_OBSERVATION'],
        rightSections: ['ALIEN_FREE_PLAZA', 'ALIEN_PIONEER_ZONE', 'ALIEN_GUARDIAN_ZONE', 'ALIEN_HALL_OF_FAME'],
        defaultLeft: 'ALIEN_POPULAR_OBSERVATION',
        defaultRight: 'ALIEN_FREE_PLAZA',
      },
      pagination: paging,
      writeButton: writeButton,
      overlapCheck: {
        headerOverlapDetected: !!opts.headerOverlapDetected,
        floatingUserCardDetected: !!opts.floatingUserCardDetected,
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
      var base = inspectAlienSystem({ mode: mode });
      if (typeof window.__scGetAlienUiPagingState === 'function') {
        try {
          var ui = window.__scGetAlienUiPagingState();
          if (ui && ui.layout) {
            base.layout.splitRatio = ui.layout.splitRatio || base.layout.splitRatio;
            base.layout.internalScrollbars = ui.layout.internalScrollbars;
            base.layout.rightTabsSingleRow = ui.layout.rightTabsSingleRow;
          }
          if (ui && ui.pagination) base.pagination = ui.pagination;
          if (ui && ui.writeButton) base.writeButton = ui.writeButton;
          if (ui && ui.overlapCheck) base.overlapCheck = ui.overlapCheck;
        } catch (_) {}
      }
      return base;
    };
  }

  return api;
});
