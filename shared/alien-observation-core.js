/**
 * 센텐스아레나 — 외계 관측 데이터 계약
 * provisional previewCount = 5
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlienObservationCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function alienObservationCoreFactory() {
  'use strict';

  var OBSERVATION_TYPE = Object.freeze({
    POPULAR_OBSERVATION: 'POPULAR_OBSERVATION',
    CENTRAL_OBSERVATION: 'CENTRAL_OBSERVATION',
    TERRITORY_OBSERVATION: 'TERRITORY_OBSERVATION',
  });

  var FILTER = Object.freeze({
    EARTH_ONLY: 'EARTH_ONLY',
    ALIEN_ONLY: 'ALIEN_ONLY',
    ALL: 'ALL',
  });

  /** provisional — 기존 UI 확정 전 */
  var PREVIEW_COUNT = 5;

  var DATA_STATUS = Object.freeze({
    READY: 'READY',
    LOADING: 'LOADING',
    UNAVAILABLE: 'UNAVAILABLE',
    FORBIDDEN: 'FORBIDDEN',
    LEGACY_MOCK: 'LEGACY_MOCK',
  });

  var FREE_PLAZA_CATEGORY = 'ALIEN_FREE_PLAZA';
  var PIONEER_ZONE_CATEGORY = 'ALIEN_PIONEER_ZONE';
  var GUARDIAN_ZONE_CATEGORY = 'ALIEN_GUARDIAN_ZONE';

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function emptyCommentBlock() {
    return { items: [], totalCount: 0, previewCount: PREVIEW_COUNT, hasMore: false };
  }

  function emptyReactions() {
    return { like: 0, recommend: 0, dislike: 0, downvote: 0, exposedToEarthUi: false };
  }

  function buildObservationContract(parts) {
    var p = parts || {};
    var earth = p.earthComments || emptyCommentBlock();
    var alien = p.alienComments || emptyCommentBlock();
    return {
      observationType: p.observationType || OBSERVATION_TYPE.CENTRAL_OBSERVATION,
      sourceTerritory: p.sourceTerritory || null,
      sourcePost: p.sourcePost ? clone(p.sourcePost) : null,
      earthComments: {
        items: Array.isArray(earth.items) ? earth.items.slice(0, PREVIEW_COUNT) : [],
        totalCount: earth.totalCount || 0,
        previewCount: PREVIEW_COUNT,
        hasMore: (earth.totalCount || 0) > PREVIEW_COUNT,
      },
      alienComments: {
        items: Array.isArray(alien.items) ? alien.items.slice(0, PREVIEW_COUNT) : [],
        totalCount: alien.totalCount || 0,
        previewCount: PREVIEW_COUNT,
        hasMore: (alien.totalCount || 0) > PREVIEW_COUNT,
      },
      earthReactions: p.earthReactions || emptyReactions(),
      alienReactions: Object.assign(emptyReactions(), p.alienReactions || {}, { exposedToEarthUi: false }),
      viewerContext: p.viewerContext || null,
      filters: {
        available: [FILTER.EARTH_ONLY, FILTER.ALIEN_ONLY, FILTER.ALL],
        active: p.activeFilter || FILTER.ALL,
      },
      dataStatus: p.dataStatus || DATA_STATUS.READY,
      updatedAt: p.updatedAt || null,
    };
  }

  function buildObservationThreadContract(parts) {
    var p = parts || {};
    return {
      observationThreadId: p.observationThreadId || null,
      sourcePostId: p.sourcePostId || null,
      observationType: p.observationType || OBSERVATION_TYPE.POPULAR_OBSERVATION,
      sourceTerritory: p.sourceTerritory || null,
      sourceCategoryKey: p.sourceCategoryKey || null,
      createdAt: p.createdAt || null,
      lastAlienActivityAt: p.lastAlienActivityAt || null,
      alienCommentCount: p.alienCommentCount || 0,
      alienReactionCount: p.alienReactionCount || 0,
      status: p.status || 'ACTIVE',
    };
  }

  function buildObservationThreadUniqueKey(sourcePostId, observationType) {
    return String(sourcePostId || '') + '::' + String(observationType || '');
  }

  function filterCommentsByScope(contract, filter) {
    var c = clone(contract) || buildObservationContract({});
    var f = filter || FILTER.ALL;
    c.filters.active = f;
    if (f === FILTER.EARTH_ONLY) {
      c.alienComments = emptyCommentBlock();
    } else if (f === FILTER.ALIEN_ONLY) {
      c.earthComments = emptyCommentBlock();
    }
    return c;
  }

  function sanitizeObservationForClient(contract) {
    var c = clone(contract);
    if (!c) return null;
    if (c.sourcePost) {
      delete c.sourcePost.authorEmail;
      delete c.sourcePost.authMetadata;
      delete c.sourcePost.moderationState;
      delete c.sourcePost.rawAuthorUserId;
    }
    return c;
  }

  return {
    OBSERVATION_TYPE: OBSERVATION_TYPE,
    FILTER: FILTER,
    PREVIEW_COUNT: PREVIEW_COUNT,
    DATA_STATUS: DATA_STATUS,
    FREE_PLAZA_CATEGORY: FREE_PLAZA_CATEGORY,
    PIONEER_ZONE_CATEGORY: PIONEER_ZONE_CATEGORY,
    GUARDIAN_ZONE_CATEGORY: GUARDIAN_ZONE_CATEGORY,
    clone: clone,
    emptyCommentBlock: emptyCommentBlock,
    emptyReactions: emptyReactions,
    buildObservationContract: buildObservationContract,
    filterCommentsByScope: filterCommentsByScope,
    sanitizeObservationForClient: sanitizeObservationForClient,
    buildObservationThreadContract: buildObservationThreadContract,
    buildObservationThreadUniqueKey: buildObservationThreadUniqueKey,
  };
});
