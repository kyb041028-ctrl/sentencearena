/**
 * 단독 진영 깃발 레이어 연출 (UMD)
 * 원본: faction-flag-animation-assets/src/faction-flag-effect.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./faction-flag-assets.js'));
  } else {
    root.FactionFlagEffect = factory(root.FactionFlagAssets).FactionFlagEffect;
    root.FactionFlagEffectModule = factory(root.FactionFlagAssets);
  }
})(typeof self !== 'undefined' ? self : this, function factionFlagEffectFactory(Assets) {
  'use strict';

  var factionFlagAssets = Assets.factionFlagAssets;
  var flagGeometry = Assets.flagGeometry;
  var layerUrl = Assets.layerUrl;

  function FactionFlagEffect(options) {
    var opts = options || {};
    var faction = opts.faction;
    if (!factionFlagAssets[faction]) {
      throw new Error('Unknown faction: ' + faction);
    }
    this.faction = faction;
    this.arrivalDelay = opts.arrivalDelay || 0;
    this.waveDelay = opts.waveDelay || 0;
    this.compact = !!opts.compact;
    this.instant = !!opts.instant;
    this.sizeMode = opts.sizeMode || 'leading';
  }

  FactionFlagEffect.prototype.render = function () {
    var root = document.createElement('div');
    root.className =
      'flag-effect' +
      (this.compact ? ' is-compact' : '') +
      (this.instant ? ' is-instant' : '') +
      (this.sizeMode === 'dominant' ? ' is-dominant' : '') +
      (this.sizeMode === 'leading' ? ' is-leading' : '');
    root.dataset.faction = this.faction;
    root.setAttribute('aria-label', factionFlagAssets[this.faction].label + ' 전황 깃발');
    root.style.setProperty('--arrival-delay', this.arrivalDelay + 'ms');
    root.style.setProperty('--wave-delay', this.waveDelay + 'ms');

    var arrival = document.createElement('div');
    arrival.className = 'flag-arrival';

    function addImg(className, name) {
      var img = document.createElement('img');
      img.className = 'flag-layer ' + className;
      img.src = layerUrl(this.faction, name);
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      arrival.appendChild(img);
    }

    addImg.call(this, 'impact-remain', 'impact-remain');

    var ring = document.createElement('span');
    ring.className = 'impact-ring';
    arrival.appendChild(ring);
    var dust = document.createElement('span');
    dust.className = 'impact-dust';
    arrival.appendChild(dust);

    var d;
    for (d = 1; d <= 6; d++) {
      var debris = document.createElement('span');
      debris.className = 'debris debris-' + d;
      arrival.appendChild(debris);
    }

    addImg.call(this, 'base', 'base');
    addImg.call(this, 'pole', 'pole');

    var slices = document.createElement('div');
    slices.className = 'cloth-slices';
    var i;
    var sliceCount = flagGeometry.slices;
    for (i = 0; i < sliceCount; i++) {
      var amp = i / (sliceCount - 1);
      var span = document.createElement('span');
      var img = document.createElement('img');
      span.className = 'cloth-slice';
      span.style.left = i * 10 + '%';
      span.style.setProperty('--wave-y', (amp * 5).toFixed(2) + 'px');
      span.style.setProperty('--wave-y-soft', (amp * 2.5).toFixed(2) + 'px');
      span.style.setProperty('--wave-compress', (1 - amp * 0.012).toFixed(4));
      span.style.setProperty('--wave-expand', (1 + amp * 0.009).toFixed(4));
      span.style.setProperty('--wave-skew', (amp * 0.5).toFixed(3) + 'deg');
      span.style.setProperty('--wave-skew-neg', (amp * -0.45).toFixed(3) + 'deg');
      span.style.setProperty('--wave-skew-mid', (amp * 0.3).toFixed(3) + 'deg');
      span.style.setProperty('--wave-bright', (1 + amp * 0.045).toFixed(4));
      span.style.setProperty('--wave-dark', (1 - amp * 0.03).toFixed(4));
      span.style.setProperty('--slice-delay', i * -34 + 'ms');
      img.src = layerUrl(this.faction, 'cloth');
      img.alt = '';
      img.draggable = false;
      img.style.left = i * -100 + '%';
      span.appendChild(img);
      slices.appendChild(span);
    }
    arrival.appendChild(slices);
    addImg.call(this, 'tassel', 'tassel');

    root.appendChild(arrival);
    return root;
  };

  return { FactionFlagEffect: FactionFlagEffect };
});
