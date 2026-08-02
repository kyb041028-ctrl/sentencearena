/**
 * 진영 전황 깃발 레이어 자산 (UMD)
 * PNG 경로만 제공. 이미지 재가공 없음.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FactionFlagAssets = factory();
  }
})(typeof self !== 'undefined' ? self : this, function factionFlagAssetsFactory() {
  'use strict';

  var LAYER_ROOT = '/assets/faction-flags/layers';

  var factionFlagAssets = Object.freeze({
    pioneer: {
      label: '개척영토',
      color: '파랑',
      colorToken: 'reform',
      root: LAYER_ROOT + '/pioneer',
    },
    central: {
      label: '중앙광장',
      color: '초록',
      colorToken: 'centrist',
      root: LAYER_ROOT + '/central',
    },
    guardian: {
      label: '수호영토',
      color: '빨강',
      colorToken: 'order',
      root: LAYER_ROOT + '/guardian',
    },
  });

  var flagGeometry = Object.freeze({
    canvas: 1254,
    poleCenterX: 289,
    groundLineY: 1188,
    landingAnchor: Object.freeze([289, 1188]),
    clothAttachment: Object.freeze([310, 220]),
    impactCenter: Object.freeze([289, 1148]),
    slices: 10,
  });

  function layerUrl(faction, name) {
    var pack = factionFlagAssets[faction];
    if (!pack) return '';
    return pack.root + '/' + name + '.png';
  }

  return {
    factionFlagAssets: factionFlagAssets,
    flagGeometry: flagGeometry,
    layerUrl: layerUrl,
    LAYER_ROOT: LAYER_ROOT,
  };
});
