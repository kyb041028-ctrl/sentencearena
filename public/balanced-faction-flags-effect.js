/**
 * 박빙(BALANCED) 3깃발 연출 (UMD)
 * 단독 우세용 center 정렬을 재사용하지 않고, 진영별 slot으로 X축을 분리한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./faction-flag-effect.js'));
  } else {
    root.BalancedFactionFlagsEffect = factory({
      FactionFlagEffect: root.FactionFlagEffect,
    }).BalancedFactionFlagsEffect;
  }
})(typeof self !== 'undefined' ? self : this, function balancedFactory(EffectMod) {
  'use strict';

  var FactionFlagEffect = EffectMod.FactionFlagEffect;

  function BalancedFactionFlagsEffect(options) {
    var opts = options || {};
    this.instant = !!opts.instant;
  }

  BalancedFactionFlagsEffect.prototype.render = function () {
    var root = document.createElement('div');
    root.className =
      'sc-balanced-faction-flags balanced-effect' + (this.instant ? ' is-instant' : '');
    root.setAttribute('aria-label', '박빙 상태: 개척, 중앙, 수호 깃발');

    var defs = [
      ['pioneer', 'sc-balanced-faction-slot--pioneer', 0, 0],
      ['central', 'sc-balanced-faction-slot--central', 70, 120],
      ['guardian', 'sc-balanced-faction-slot--guardian', 140, 220],
    ];
    var i;
    for (i = 0; i < defs.length; i++) {
      var def = defs[i];
      var slot = document.createElement('div');
      slot.className = 'sc-balanced-faction-slot ' + def[1];
      slot.dataset.faction = def[0];

      var flag = new FactionFlagEffect({
        faction: def[0],
        compact: true,
        arrivalDelay: def[2],
        waveDelay: def[3],
        instant: this.instant,
        sizeMode: 'balanced',
      }).render();
      flag.classList.add('sc-balanced-faction-flag');
      slot.appendChild(flag);
      root.appendChild(slot);
    }
    return root;
  };

  return { BalancedFactionFlagsEffect: BalancedFactionFlagsEffect };
});
