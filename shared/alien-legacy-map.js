/**
 * 레거시 구명칭 → ALIEN 변환 (신규 운영 파일은 ALIEN만 사용)
 * 맵 키에만 레거시 ID를 허용한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlienLegacyMap = factory();
  }
})(typeof self !== 'undefined' ? self : this, function alienLegacyMapFactory() {
  'use strict';

  var LEGACY_TO_ALIEN = Object.freeze({
    KANTAPBIYA: 'ALIEN',
    KANTAPBIYA_LEFT: 'ALIEN',
    KANTAPBIYA_RIGHT: 'ALIEN',
    KANTAPBIYA_CENTER: 'ALIEN',
    kantapbiya: 'ALIEN',
    alien: 'ALIEN',
    ALIEN: 'ALIEN',
  });

  function normalizeLegacyTerritoryId(value) {
    if (value == null || value === '') return null;
    var key = String(value).trim();
    if (Object.prototype.hasOwnProperty.call(LEGACY_TO_ALIEN, key)) {
      return LEGACY_TO_ALIEN[key];
    }
    var upper = key.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(LEGACY_TO_ALIEN, upper)) {
      return LEGACY_TO_ALIEN[upper];
    }
    return null;
  }

  function isLegacyKantapbiyaId(value) {
    var s = String(value || '').toUpperCase();
    return s.indexOf('KANTAPBIYA') === 0;
  }

  return {
    LEGACY_TO_ALIEN: LEGACY_TO_ALIEN,
    normalizeLegacyTerritoryId: normalizeLegacyTerritoryId,
    isLegacyKantapbiyaId: isLegacyKantapbiyaId,
  };
});
