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

  var RARITY_KEYS = Object.freeze([
    'COMMON',
    'BRONZE',
    'GOLD',
    'CRYSTAL',
    'LEGENDARY',
  ]);

  var ACHIEVEMENT_RARITY_LABELS = Object.freeze({
    COMMON: '일반',
    BRONZE: '청동',
    GOLD: '황금',
    CRYSTAL: '수정',
    LEGENDARY: '전설',
  });

  /** 실제 확인된 경로 · 확장자 .png · 1024×1024 · 투명 배경 */
  var ACHIEVEMENT_RARITY_FRAME_BASE = '/assets/achievements/rarity-frames/';
  var ACHIEVEMENT_RARITY_FRAME_CACHE = '?v=alpha4';

  var ACHIEVEMENT_RARITY_FRAMES = Object.freeze({
    COMMON: ACHIEVEMENT_RARITY_FRAME_BASE + '일반.png' + ACHIEVEMENT_RARITY_FRAME_CACHE,
    BRONZE: ACHIEVEMENT_RARITY_FRAME_BASE + '청동.png' + ACHIEVEMENT_RARITY_FRAME_CACHE,
    GOLD: ACHIEVEMENT_RARITY_FRAME_BASE + '황금.png' + ACHIEVEMENT_RARITY_FRAME_CACHE,
    CRYSTAL: ACHIEVEMENT_RARITY_FRAME_BASE + '수정.png' + ACHIEVEMENT_RARITY_FRAME_CACHE,
    LEGENDARY: ACHIEVEMENT_RARITY_FRAME_BASE + '전설.png' + ACHIEVEMENT_RARITY_FRAME_CACHE,
  });

  function normalizeAchievementRarity(rarity) {
    if (rarity == null || rarity === '') return 'COMMON';
    var key = String(rarity).trim().toUpperCase();
    if (RARITY_KEYS.indexOf(key) !== -1) return key;
    return 'COMMON';
  }

  function getAchievementRarityLabel(rarity) {
    var key = normalizeAchievementRarity(rarity);
    return ACHIEVEMENT_RARITY_LABELS[key] || ACHIEVEMENT_RARITY_LABELS.COMMON;
  }

  function getAchievementRarityFrame(rarity) {
    var key = normalizeAchievementRarity(rarity);
    var src = ACHIEVEMENT_RARITY_FRAMES[key];
    if (src) return src;
    src = ACHIEVEMENT_RARITY_FRAMES.COMMON;
    return src || '';
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
