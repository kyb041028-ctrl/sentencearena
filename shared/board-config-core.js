/**
 * 센텐스아레나 — 게시판 공용 설정
 * 브라우저(UMD) · Node(CommonJS) 공용
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoardConfigCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function boardConfigCoreFactory() {
  'use strict';

  var OPERATIONAL_TERRITORIES = Object.freeze(['CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN']);

  var LEGACY_TERRITORY_MAP = Object.freeze({
    COMMON: 'CENTRAL',
    PROGRESSIVE: 'PIONEER',
    CONSERVATIVE: 'GUARDIAN',
    KANTAPBIYA: 'ALIEN',
    KANTAPBIYA_LEFT: 'ALIEN',
    KANTAPBIYA_RIGHT: 'ALIEN',
    KANTAPBIYA_CENTER: 'ALIEN',
  });

  var ALIGNMENT_REACTION_TYPES = Object.freeze(['LIKE', 'RECOMMEND', 'DISLIKE', 'DOWNVOTE']);
  var SOCIAL_REACTION_TYPES = Object.freeze(['EMPATHY']);
  var DEFERRED_LEGACY_REACTION_TYPES = Object.freeze(['PLANET']);

  var DATA_MODES = Object.freeze({
    LEGACY_LOCAL: 'LEGACY_LOCAL',
    API_DRY_RUN: 'API_DRY_RUN',
    API_OPERATIONAL: 'API_OPERATIONAL',
  });

  var LIMITS = Object.freeze({
    postTitleMaxLength: 120,
    postContentMaxLength: 10000,
    commentMaxLength: 1500,
    reportDetailMaxLength: 300,
  });

  var BOARD_CONFIG = Object.freeze({
    limits: LIMITS,
    territories: Object.freeze({
      operational: OPERATIONAL_TERRITORIES,
      legacyMap: LEGACY_TERRITORY_MAP,
    }),
    reactions: Object.freeze({
      alignmentTypes: ALIGNMENT_REACTION_TYPES,
      socialTypes: SOCIAL_REACTION_TYPES,
      deferredLegacyTypes: DEFERRED_LEGACY_REACTION_TYPES,
    }),
    dataModes: DATA_MODES,
    defaultDataMode: DATA_MODES.LEGACY_LOCAL,
  });

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function getBoardConfig() {
    return clone(BOARD_CONFIG);
  }

  function isOperationalBoardTerritory(value) {
    return OPERATIONAL_TERRITORIES.indexOf(String(value || '').toUpperCase()) !== -1;
  }

  function isLegacyBoardTerritory(value) {
    var raw = String(value || '').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(LEGACY_TERRITORY_MAP, raw);
  }

  function getLegacyTerritoryMapping() {
    return clone(LEGACY_TERRITORY_MAP);
  }

  /**
   * @param {*} value
   * @param {{ allowLegacy?: boolean, fallback?: string|null, strict?: boolean }} options
   * - allowLegacy: 레거시 매핑 허용 (기본 true at adapter boundary)
   * - strict: 알 수 없는 값이면 throw (운영 저장 경로)
   * - fallback: import 전용 fallback (기본 null)
   */
  function normalizeBoardTerritory(value, options) {
    var opts = options || {};
    var allowLegacy = opts.allowLegacy !== false;
    var strict = opts.strict === true;
    if (value == null || String(value).trim() === '') {
      if (strict) {
        var errEmpty = new Error('BOARD_TERRITORY_INVALID');
        errEmpty.code = 'BOARD_TERRITORY_INVALID';
        throw errEmpty;
      }
      return opts.fallback != null ? opts.fallback : null;
    }
    var raw = String(value).trim().toUpperCase();
    if (isOperationalBoardTerritory(raw)) return raw;
    if (allowLegacy && LEGACY_TERRITORY_MAP[raw]) return LEGACY_TERRITORY_MAP[raw];
    if (strict) {
      var err = new Error('BOARD_TERRITORY_INVALID');
      err.code = 'BOARD_TERRITORY_INVALID';
      throw err;
    }
    return opts.fallback != null ? opts.fallback : null;
  }

  function assertOperationalBoardTerritory(value) {
    return normalizeBoardTerritory(value, { allowLegacy: false, strict: true });
  }

  function isAlignmentReactionType(type) {
    return ALIGNMENT_REACTION_TYPES.indexOf(String(type || '').toUpperCase()) !== -1;
  }

  function isSocialReactionType(type) {
    var t = String(type || '').toUpperCase();
    return SOCIAL_REACTION_TYPES.indexOf(t) !== -1 || t === 'EMPATHY';
  }

  function isDeferredLegacyReactionType(type) {
    var t = String(type || '').toUpperCase();
    return DEFERRED_LEGACY_REACTION_TYPES.indexOf(t) !== -1 || t === 'PLANET' || t === 'PLANETVOTERS';
  }

  function resolveBoardDataMode(envLike) {
    var src = envLike || {};
    if (src.dataMode) {
      var direct = String(src.dataMode).trim().toUpperCase();
      if (direct === DATA_MODES.API_DRY_RUN || direct === DATA_MODES.API_OPERATIONAL || direct === DATA_MODES.LEGACY_LOCAL) {
        return direct;
      }
    }
    if (src.BOARD_DATA_MODE) {
      var m = String(src.BOARD_DATA_MODE).trim().toUpperCase();
      if (m === DATA_MODES.API_DRY_RUN || m === DATA_MODES.API_OPERATIONAL || m === DATA_MODES.LEGACY_LOCAL) {
        return m;
      }
    }
    if (String(src.BOARD_OPERATIONAL || '').trim() === 'true') {
      return DATA_MODES.API_OPERATIONAL;
    }
    return DATA_MODES.LEGACY_LOCAL;
  }

  return {
    BOARD_CONFIG: BOARD_CONFIG,
    getBoardConfig: getBoardConfig,
    LIMITS: LIMITS,
    DATA_MODES: DATA_MODES,
    normalizeBoardTerritory: normalizeBoardTerritory,
    assertOperationalBoardTerritory: assertOperationalBoardTerritory,
    isOperationalBoardTerritory: isOperationalBoardTerritory,
    isLegacyBoardTerritory: isLegacyBoardTerritory,
    getLegacyTerritoryMapping: getLegacyTerritoryMapping,
    isAlignmentReactionType: isAlignmentReactionType,
    isSocialReactionType: isSocialReactionType,
    isDeferredLegacyReactionType: isDeferredLegacyReactionType,
    resolveBoardDataMode: resolveBoardDataMode,
  };
});
