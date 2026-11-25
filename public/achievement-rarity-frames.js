/**
 * =============================================================================
 * 센텐스아레나 — 업적 희귀도 테두리 (ProfileFrame 대표 업적)
 * =============================================================================
 * 파일명(한글)과 내부 rarity key(영문)를 분리한다.
 * 이미지 원본·파일명은 변경하지 않는다.
 * =============================================================================
 */
(function (global) {
  'use strict';

  var RARITY_KEYS = Object.freeze(['BRONZE', 'SILVER', 'GOLD', 'CRYSTAL']);
  var ACHIEVEMENT_RARITY_LABELS = Object.freeze({
    BRONZE: '청동',
    SILVER: '은',
    GOLD: '금',
    CRYSTAL: '크리스탈',
  });
  var US_RARITY_LABELS = Object.freeze({
    BRONZE: 'Bronze',
    SILVER: 'Silver',
    GOLD: 'Gold',
    CRYSTAL: 'Crystal',
  });
  var ACHIEVEMENT_RARITY_FRAMES = {};
  RARITY_KEYS.forEach(function (key) {
    ACHIEVEMENT_RARITY_FRAMES[key] =
      '/assets/achievements/rarity-frames/' + key.toLowerCase() + '_frame_only_930x710.png';
  });
  Object.freeze(ACHIEVEMENT_RARITY_FRAMES);

  function normalizeAchievementRarity(rarity) {
    var key = String(rarity == null ? '' : rarity).trim().toUpperCase();
    if (key === 'LEGENDARY') return 'CRYSTAL';
    return RARITY_KEYS.indexOf(key) !== -1 ? key : 'BRONZE';
  }

  function getAchievementRarityLabel(rarity) {
    var key = normalizeAchievementRarity(rarity);
    var us = global.isUsAchievementLocale && global.isUsAchievementLocale();
    return (us ? US_RARITY_LABELS : ACHIEVEMENT_RARITY_LABELS)[key];
  }

  function getAchievementRarityFrame(rarity) {
    return ACHIEVEMENT_RARITY_FRAMES[normalizeAchievementRarity(rarity)];
  }

  /**
   * 대표 업적 슬롯에 희귀도 테두리 적용.
   * 업적 없을 때 frame 숨김. 로딩 실패 시 frame만 숨김.
   */
  function applyAchievementRarityFrameToSlot(slotEl, entry, hasAchievement) {
    if (!slotEl) return;
    var wrap =
      slotEl.querySelector('.sc-profile-achievement') ||
      slotEl.querySelector('.profile-achievement');
    var frameEl =
      slotEl.querySelector('.sc-profile-achievement__rarity-frame') ||
      slotEl.querySelector('.profile-achievement-rarity-frame');
    if (!wrap || !frameEl) return;

    if (!hasAchievement) {
      wrap.removeAttribute('data-rarity');
      wrap.removeAttribute('aria-label');
      frameEl.removeAttribute('src');
      frameEl.hidden = true;
      frameEl.style.display = 'none';
      return;
    }

    var rarity = normalizeAchievementRarity(entry && entry.rarity);
    var frameSrc = getAchievementRarityFrame(rarity);
    var title =
      (entry && (entry.title || entry.name)) || '';
    var label = getAchievementRarityLabel(rarity);

    wrap.setAttribute('data-rarity', rarity);
    if (title) {
      wrap.setAttribute('aria-label', title + ', ' + label + ' 업적');
    } else {
      wrap.removeAttribute('aria-label');
    }

    if (!frameSrc) {
      frameEl.hidden = true;
      frameEl.style.display = 'none';
      return;
    }

    frameEl.hidden = false;
    frameEl.style.display = '';
    if (frameEl.getAttribute('src') !== frameSrc) {
      frameEl.onerror = function onRarityFrameError() {
        frameEl.onerror = null;
        frameEl.removeAttribute('src');
        frameEl.hidden = true;
        frameEl.style.display = 'none';
      };
      frameEl.src = frameSrc;
    }
  }

  global.ACHIEVEMENT_RARITY_KEYS = RARITY_KEYS;
  global.ACHIEVEMENT_RARITY_LABELS = ACHIEVEMENT_RARITY_LABELS;
  global.ACHIEVEMENT_RARITY_FRAMES = ACHIEVEMENT_RARITY_FRAMES;
  global.normalizeAchievementRarity = normalizeAchievementRarity;
  global.getAchievementRarityLabel = getAchievementRarityLabel;
  global.getAchievementRarityFrame = getAchievementRarityFrame;
  global.applyAchievementRarityFrameToSlot = applyAchievementRarityFrameToSlot;
})(typeof window !== 'undefined' ? window : globalThis);
