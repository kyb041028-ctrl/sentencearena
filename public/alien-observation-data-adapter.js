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

  var LEFT_PAGE_SIZE = 6;
  var RIGHT_PAGE_SIZE = 7;

  function normalizePage(page, totalPages) {
    var tot = Math.max(1, Math.floor(Number(totalPages) || 1));
    var p = Math.floor(Number(page) || 1);
    if (!isFinite(p) || p < 1) return 1;
    return Math.min(p, tot);
  }

  function getPageCount(totalItems, pageSize) {
    var size = Math.max(1, Math.floor(Number(pageSize) || 1));
    var total = Math.max(0, Math.floor(Number(totalItems) || 0));
    if (total === 0) return 0;
    return Math.max(1, Math.ceil(total / size) || 1);
  }

  function paginateAlienList(items, page, pageSize) {
    var list = Array.isArray(items) ? items.slice() : [];
    var size = Math.max(1, Math.floor(Number(pageSize) || LEFT_PAGE_SIZE));
    var totalItems = list.length;
    var totalPages = getPageCount(totalItems, size);
    var p = totalPages === 0 ? 1 : normalizePage(page, totalPages);
    var start = (p - 1) * size;
    return {
      page: p,
      pageSize: size,
      totalItems: totalItems,
      totalPages: totalPages,
      items: totalItems === 0 ? [] : list.slice(start, start + size),
    };
  }

  function buildAlienPaginationState(options) {
    var opts = options || {};
    var leftSection = opts.leftSection || 'ALIEN_POPULAR_OBSERVATION';
    var rightSection = opts.rightSection || 'ALIEN_FREE_PLAZA';
    var leftTotal = Math.max(0, Math.floor(Number(opts.leftTotalItems != null ? opts.leftTotalItems : opts.leftTotal) || 0));
    var rightTotal = Math.max(0, Math.floor(Number(opts.rightTotalItems != null ? opts.rightTotalItems : opts.rightTotal) || 0));
    var leftPageSize = Math.max(1, Math.floor(Number(opts.leftPageSize) || LEFT_PAGE_SIZE));
    var rightPageSize = Math.max(1, Math.floor(Number(opts.rightPageSize) || RIGHT_PAGE_SIZE));
    var leftPages = getPageCount(leftTotal, leftPageSize);
    var rightPages = rightSection === 'ALIEN_HALL_OF_FAME' ? 0 : getPageCount(rightTotal, rightPageSize);
    return {
      left: {
        section: leftSection,
        page: leftPages === 0 ? 1 : normalizePage(opts.leftPage || 1, leftPages || 1),
        pageSize: leftPageSize,
        totalItems: leftTotal,
        totalPages: leftPages,
      },
      right: {
        section: rightSection,
        page: rightPages === 0 ? 1 : normalizePage(opts.rightPage || 1, rightPages || 1),
        pageSize: rightPageSize,
        totalItems: rightSection === 'ALIEN_HALL_OF_FAME' ? 0 : rightTotal,
        totalPages: rightPages,
      },
    };
  }

  function resolveWriteButtonState(options) {
    var opts = options || {};
    var section = opts.rightSection || 'ALIEN_FREE_PLAZA';
    var origin = String(opts.originTerritory || 'UNKNOWN').toUpperCase();
    var status = String(opts.status || '').toUpperCase();
    var boardUnlocked = opts.boardUnlocked !== false;
    if (section === 'ALIEN_HALL_OF_FAME') {
      return { visible: false, enabled: false, reason: 'HALL_OF_FAME' };
    }
    if (status === 'RETURNED' || status === 'SUSPENDED') {
      return { visible: false, enabled: false, reason: status };
    }
    var canWrite = section === 'ALIEN_FREE_PLAZA'
      || (section === 'ALIEN_PIONEER_ZONE' && origin === 'PIONEER')
      || (section === 'ALIEN_GUARDIAN_ZONE' && origin === 'GUARDIAN');
    if (!canWrite) {
      return { visible: false, enabled: false, reason: 'ORIGIN_READONLY' };
    }
    if (!boardUnlocked) {
      return { visible: true, enabled: false, reason: 'BOARD_LOCKED' };
    }
    return { visible: true, enabled: true, reason: 'OK' };
  }

  function toObservationViewModel(contract) {
    var c = obsCore.sanitizeObservationForClient(contract) || obsCore.buildObservationContract({});
    var paging = buildAlienPaginationState({
      leftSection: 'ALIEN_POPULAR_OBSERVATION',
      rightSection: 'ALIEN_FREE_PLAZA',
      leftPage: 1,
      rightPage: 1,
      leftTotalItems: 0,
      rightTotalItems: 0,
    });
    return {
      layout: {
        leftActiveSection: 'ALIEN_POPULAR_OBSERVATION',
        rightActiveSection: 'ALIEN_FREE_PLAZA',
        splitRatio: '52:48',
        internalScrollbars: false,
        rightTabsSingleRow: true,
      },
      pagination: paging,
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
    normalizePage: normalizePage,
    getPageCount: getPageCount,
    paginateAlienList: paginateAlienList,
    buildAlienPaginationState: buildAlienPaginationState,
    resolveWriteButtonState: resolveWriteButtonState,
    LEFT_PAGE_SIZE: LEFT_PAGE_SIZE,
    RIGHT_PAGE_SIZE: RIGHT_PAGE_SIZE,
    PREVIEW_COUNT: obsCore.PREVIEW_COUNT,
    FILTER: obsCore.FILTER,
  };
});
