/**
 * 외계 관측 view-model adapter (지구 댓글 UI 전면 교체 금지)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/alien-observation-core'),
      require('../shared/alien-legacy-map')
    );
  } else {
    root.AlienObservationDataAdapter = factory(root.AlienObservationCore, root.AlienLegacyMap);
  }
})(typeof self !== 'undefined' ? self : this, function factory(obsCore, legacyMap) {
  'use strict';

  function toObservationViewModel(contract) {
    var c = obsCore.sanitizeObservationForClient(contract) || obsCore.buildObservationContract({});
    return {
      layout: {
        leftActiveSection: 'ALIEN_POPULAR_OBSERVATION',
        rightActiveSection: 'ALIEN_FREE_PLAZA',
      },
      observationType: c.observationType,
      sourceTerritory: c.sourceTerritory,
      sourcePost: c.sourcePost,
      earthComments: c.earthComments,
      alienComments: c.alienComments,
      earthReactions: c.earthReactions,
      alienReactions: Object.assign({}, c.alienReactions, { exposedToEarthUi: false }),
      filters: c.filters,
      viewerContext: c.viewerContext,
      dataStatus: c.dataStatus,
      access: {
        originTerritory: c.viewerContext && c.viewerContext.alienOriginTerritory ? c.viewerContext.alienOriginTerritory : 'UNKNOWN',
        partitionPermissions: c.viewerContext && c.viewerContext.partitions ? c.viewerContext.partitions : null,
      },
      states: {
        loading: c.dataStatus === obsCore.DATA_STATUS.LOADING,
        empty: false,
        unavailable: c.dataStatus === obsCore.DATA_STATUS.UNAVAILABLE,
        forbidden: c.dataStatus === obsCore.DATA_STATUS.FORBIDDEN,
        legacyMock: c.dataStatus === obsCore.DATA_STATUS.LEGACY_MOCK,
      },
      battleUiReadOnly: true,
      canMutateEarthBattle: false,
    };
  }

  function applyCommentFilter(contract, filter) {
    return toObservationViewModel(obsCore.filterCommentsByScope(contract, filter));
  }

  function normalizeTerritoryKey(value) {
    if (legacyMap && typeof legacyMap.normalizeLegacyTerritoryId === 'function') {
      var n = legacyMap.normalizeLegacyTerritoryId(value);
      if (n) return n;
    }
    return value;
  }

  return {
    toObservationViewModel: toObservationViewModel,
    applyCommentFilter: applyCommentFilter,
    normalizeTerritoryKey: normalizeTerritoryKey,
    PREVIEW_COUNT: obsCore.PREVIEW_COUNT,
    FILTER: obsCore.FILTER,
  };
});
