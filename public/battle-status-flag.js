/**
 * 전황 상태 → 레이어 깃발 DOM 어댑터 (UMD)
 * 점수·상태 판정은 FactionBattleCore가 담당. 이 모듈은 표시만.
 *
 * 운영 표시:
 * - DOMINANT / LEADING + faction → 단독 깃발
 * - BALANCED / INSUFFICIENT → 표시 없음
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./faction-flag-effect.js'));
  } else {
    var mod = factory({ FactionFlagEffect: root.FactionFlagEffect });
    root.renderBattleStatusFlag = mod.renderBattleStatusFlag;
    root.BattleStatusFlag = mod;
  }
})(typeof self !== 'undefined' ? self : this, function battleStatusFlagFactory(EffectMod) {
  'use strict';

  var FactionFlagEffect = EffectMod.FactionFlagEffect;

  /**
   * @param {{
   *   status: 'DOMINANT'|'LEADING'|'BALANCED'|'INSUFFICIENT',
   *   faction?: 'pioneer'|'central'|'guardian'|null,
   *   playEntrance?: boolean,
   *   instant?: boolean
   * }} input
   */
  function renderBattleStatusFlag(input) {
    var opts = input || {};
    var status = opts.status;

    if (status === 'INSUFFICIENT' || status === 'BALANCED' || !status) {
      return null;
    }

    if ((status === 'DOMINANT' || status === 'LEADING') && opts.faction) {
      var instant = !!opts.instant || opts.playEntrance === false;
      var container = document.createElement('div');
      container.className =
        'battle-status-flag-slot sc-faction-flag-field' +
        (instant ? ' is-instant' : '') +
        (status === 'DOMINANT' ? ' is-dominant-state' : '') +
        (status === 'LEADING' ? ' is-leading-state' : '');
      container.dataset.state = status;
      container.dataset.mode = 'SINGLE_WINNER';
      container.style.pointerEvents = 'none';
      container.appendChild(
        new FactionFlagEffect({
          faction: opts.faction,
          instant: instant,
          sizeMode: status === 'DOMINANT' ? 'dominant' : 'leading',
        }).render()
      );
      return container;
    }

    return null;
  }

  return { renderBattleStatusFlag: renderBattleStatusFlag };
});
