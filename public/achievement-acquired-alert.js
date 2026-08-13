/**
 * =============================================================================
 * 센텐스아레나 — 업적 획득 중앙 알람 (notification bell 과 별도)
 * =============================================================================
 * - viewport 정중앙 fixed 카드 · FIFO queue
 * - DB/state 변경 없음 · UI only
 * - localhost preview: __scPreviewAchievementAcquired(key)
 * =============================================================================
 */
(function (global) {
  'use strict';

  var ALERT_HOLD_MS = 3000;
  var ALERT_ENTER_MS = 220;
  var ALERT_EXIT_MS = 200;
  var ALERT_Z_INDEX = 12100;

  var queue = [];
  var showing = false;
  var hostEl = null;

  function trimId(value) {
    return String(value == null ? '' : value).trim();
  }

  function isLocalhostPreviewAllowed() {
    try {
      var h = global.location && global.location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    } catch (_) {
      return false;
    }
  }

  function prefersReducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function getAchievementDefinitionSafe(id) {
    if (typeof global.getAchievementDefinition === 'function') {
      return global.getAchievementDefinition(id);
    }
    return null;
  }

  function getAchievementDisplayName(def) {
    if (!def) return '';
    if (def.id === 'territory-citizen') return '당당한 영토시민!';
    return String(def.name || def.id || '');
  }

  function getAchievementShortDescription(def) {
    if (!def) return '';
    var type = String(def.conditionType || '');
    var val = def.conditionValue;
    if (type === 'LEVEL_REACHED') return '레벨 ' + String(val) + ' 달성';
    if (type === 'VALID_POST_COUNT') return '유효 게시글 ' + String(val) + '개';
    if (type === 'VALID_COMMENT_ON_OTHERS_POST_COUNT') return '다른 글에 댓글 ' + String(val) + '개';
    if (type === 'VALID_EMPATHY_RECEIVED_COUNT') return '공감 ' + String(val) + '회';
    if (type === 'DISTINCT_ACTIVE_DAYS_IN_WINDOW' && val && typeof val === 'object') {
      return '최근 ' + String(val.windowDays || 30) + '일 중 ' + String(val.days) + '일 활동';
    }
    if (type === 'DISTINCT_POSTS_WITH_VALID_COMMENTS') {
      return '서로 다른 글 ' + String(val) + '곳에 댓글';
    }
    if (type === 'DISTINCT_USERS_EMPATHY_RECEIVED') {
      return '서로 다른 ' + String(val) + '명에게 공감';
    }
    if (type === 'BETA_MEMBER_AND_LEVEL_REACHED') return '베타 참여 · 레벨 5 달성';
    if (def.description) {
      var d = String(def.description);
      return d.length > 72 ? d.slice(0, 69) + '…' : d;
    }
    return '';
  }

  function getMockAchievementIconId(achievementId) {
    if (typeof global.MOCK_ACHIEVEMENT_ICON_IDS === 'object' && global.MOCK_ACHIEVEMENT_ICON_IDS) {
      return global.MOCK_ACHIEVEMENT_ICON_IDS[achievementId] || '';
    }
    var map = {
      'territory-citizen': 'achievement_lv5',
      'empathy-from-many': 'achievement_popular',
      'beta-citizen': 'achievement_first_post',
      'first-post': 'achievement_first_post',
    };
    return map[achievementId] || '';
  }

  function rarityFrameSrc(rarity) {
    if (typeof global.getAchievementRarityFrame === 'function') {
      return global.getAchievementRarityFrame(rarity) || '';
    }
    return '';
  }

  function rarityLabel(rarity) {
    if (typeof global.getAchievementRarityLabel === 'function') {
      return global.getAchievementRarityLabel(rarity);
    }
    return '';
  }

  function ensureHost() {
    if (hostEl && hostEl.parentNode) return hostEl;
    hostEl = document.createElement('div');
    hostEl.id = 'sc-achievement-acquired-host';
    hostEl.className = 'sc-achievement-acquired-host';
    hostEl.setAttribute('aria-live', 'polite');
    hostEl.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(hostEl);
    return hostEl;
  }

  function buildCard(definition, record) {
    var def = definition || {};
    var rec = record || {};
    var rarity = typeof global.normalizeAchievementRarity === 'function'
      ? global.normalizeAchievementRarity(def.rarity)
      : String(def.rarity || 'COMMON').toUpperCase();
    var card = document.createElement('div');
    card.className = 'sc-achievement-acquired';
    card.setAttribute('role', 'status');
    card.setAttribute('data-rarity', rarity);

    var iconWrap = document.createElement('div');
    iconWrap.className = 'sc-achievement-acquired__icon-wrap';
    var iconImg = document.createElement('img');
    iconImg.className = 'sc-achievement-acquired__icon';
    iconImg.alt = '';
    iconImg.decoding = 'async';
    var iconId = getMockAchievementIconId(trimId(rec.achievementId || def.id));
    iconImg.src = iconId
      ? '/assets/achievements/' + iconId + '.png'
      : '/assets/achievements/achievement_empty.png';
    var frameImg = document.createElement('img');
    frameImg.className = 'sc-achievement-acquired__frame';
    frameImg.alt = '';
    frameImg.setAttribute('aria-hidden', 'true');
    var frameSrc = rarityFrameSrc(rarity);
    if (frameSrc) frameImg.src = frameSrc;
    else frameImg.hidden = true;
    iconWrap.appendChild(iconImg);
    iconWrap.appendChild(frameImg);

    var label = document.createElement('p');
    label.className = 'sc-achievement-acquired__label';
    label.textContent = '업적 달성';

    var title = document.createElement('p');
    title.className = 'sc-achievement-acquired__title';
    title.textContent = getAchievementDisplayName(def);

    var desc = document.createElement('p');
    desc.className = 'sc-achievement-acquired__desc';
    desc.textContent = getAchievementShortDescription(def);

    var rarityEl = document.createElement('p');
    rarityEl.className = 'sc-achievement-acquired__rarity';
    rarityEl.textContent = rarityLabel(rarity);

    card.appendChild(iconWrap);
    card.appendChild(label);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(rarityEl);
    return card;
  }

  function animateIn(card, done) {
    if (prefersReducedMotion()) {
      card.classList.add('is-visible');
      if (done) done();
      return;
    }
    card.classList.add('is-entering');
    requestAnimationFrame(function () {
      card.classList.add('is-visible');
      setTimeout(function () {
        card.classList.remove('is-entering');
        if (done) done();
      }, ALERT_ENTER_MS);
    });
  }

  function animateOut(card, done) {
    if (prefersReducedMotion()) {
      if (done) done();
      return;
    }
    card.classList.add('is-exiting');
    card.classList.remove('is-visible');
    setTimeout(function () {
      if (done) done();
    }, ALERT_EXIT_MS);
  }

  function processQueue() {
    if (showing || !queue.length) return;
    showing = true;
    var item = queue.shift();
    var host = ensureHost();
    host.textContent = '';
    var card = buildCard(item.definition, item.record);
    host.appendChild(card);

    animateIn(card, function () {
      if (item.onShown) {
        try {
          item.onShown(item.definition, item.record);
        } catch (_) {}
      }
      setTimeout(function () {
        animateOut(card, function () {
          if (card.parentNode) card.parentNode.removeChild(card);
          showing = false;
          processQueue();
        });
      }, ALERT_HOLD_MS);
    });
  }

  function enqueueAchievementAcquiredAlert(definition, record, options) {
    if (!definition || !record) return false;
    var key = trimId(record.achievementId || definition.id);
    if (!key) return false;
    var opts = options || {};
    queue.push({
      definition: definition,
      record: record,
      onShown: typeof opts.onShown === 'function' ? opts.onShown : null,
    });
    processQueue();
    return true;
  }

  function previewAchievementAcquired(achievementId) {
    if (!isLocalhostPreviewAllowed()) {
      return { ok: false, reason: 'PRODUCTION_FORBIDDEN' };
    }
    var id = trimId(achievementId);
    var def = getAchievementDefinitionSafe(id);
    if (!def) return { ok: false, reason: 'UNKNOWN_ACHIEVEMENT' };
    enqueueAchievementAcquiredAlert(def, {
      achievementId: id,
      acquiredAt: new Date().toISOString(),
      acquisitionSequence: 0,
      seasonId: null,
    });
    return { ok: true, achievementId: id };
  }

  global.enqueueAchievementAcquiredAlert = enqueueAchievementAcquiredAlert;
  global.__scPreviewAchievementAcquired = previewAchievementAcquired;
})(typeof window !== 'undefined' ? window : globalThis);
