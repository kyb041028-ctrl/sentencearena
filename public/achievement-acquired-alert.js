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
  var PHASE_MS = 2000;
  var RESULT_MS = 3000;

  var queue = [];
  var showing = false;
  var hostEl = null;
  var activeItem = null;
  var generation = 0;

  function bumpGeneration() {
    generation += 1;
    return generation;
  }

  function arm(gen, ms, fn) {
    return setTimeout(function () {
      if (gen !== generation) return;
      fn();
    }, ms);
  }

  function markShown(item) {
    if (!item || item.noted || item.replay || typeof item.onShown !== 'function') return;
    item.noted = true;
    var fn = item.onShown;
    item.onShown = null;
    try { fn(item.definition, item.record); } catch (_) {}
  }

  function suspendForReplay() {
    var item = activeItem;
    activeItem = null;
    bumpGeneration();
    showing = false;
    if (hostEl) {
      var video = hostEl.querySelector('video.sc-achievement-scene-video');
      if (video) {
        video.onplaying = null;
        video.onended = null;
        video.onerror = null;
        try { video.pause(); } catch (_) {}
        try { video.removeAttribute('src'); video.load(); } catch (_) {}
      }
      hostEl.textContent = '';
      delete hostEl.dataset.phase;
    }
    try { document.documentElement.style.overflow = ''; } catch (_) {}
    if (item && !item.replay && !item.noted) queue.unshift(item);
  }

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
    return String(def.name || def.id || '');
  }

  function getAchievementShortDescription(def) {
    if (!def) return '';
    if (global.isUsAchievementLocale && global.isUsAchievementLocale()) return String(def.description || '');
    if (def.id === 'beta-citizen') return '베타 기간 중 첫 실제 참여';
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
      ? global.normalizeAchievementRarity(rec.rarity || def.rarity)
      : String(rec.rarity || def.rarity || 'BRONZE').toUpperCase();
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
    var approved = global.getApprovedAchievementAsset && global.getApprovedAchievementAsset(trimId(rec.achievementId || def.id));
    var iconId = getMockAchievementIconId(trimId(rec.achievementId || def.id));
    iconImg.src = approved ? approved.full : iconId
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
    if (approved) card.classList.add('sc-achievement-acquired--approved');
    else iconWrap.appendChild(frameImg);

    var label = document.createElement('p');
    label.className = 'sc-achievement-acquired__label';
    label.textContent = global.isUsAchievementLocale && global.isUsAchievementLocale() ? 'Achievement unlocked!' : '업적 달성';

    var title = document.createElement('p');
    title.className = 'sc-achievement-acquired__title';
    title.textContent = getAchievementDisplayName(def) + (rec.stage ? ' · ' + rec.stage : '');

    var desc = document.createElement('p');
    desc.className = 'sc-achievement-acquired__desc';
    desc.textContent = approved ? String(def.description || '') : getAchievementShortDescription(def);

    var rarityEl = document.createElement('p');
    rarityEl.className = 'sc-achievement-acquired__rarity';
    rarityEl.textContent = rarityLabel(rarity);

    card.appendChild(iconWrap);
    card.appendChild(label);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(rarityEl);
    if (approved) appendDifficulty(card, approved.stars);
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

  function appendDifficulty(card, count) {
    var stars = document.createElement('div');
    stars.className = 'sc-achievement-difficulty';
    stars.setAttribute('role', 'img');
    var en = global.isUsAchievementLocale && global.isUsAchievementLocale();
    stars.setAttribute('aria-label', en ? 'Difficulty ' + count + ' out of 5' : '난이도 별 ' + count + '개');
    for (var i = 0; i < count; i++) {
      var star = document.createElement('span');
      star.textContent = '★';
      star.setAttribute('aria-hidden', 'true');
      star.style.setProperty('--star-delay', (i * 220) + 'ms');
      stars.appendChild(star);
    }
    card.appendChild(stars);
  }

  function visibleHistoryIcon(id) {
    var rows = document.querySelectorAll('[data-achievement-history-id]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-achievement-history-id') !== id) continue;
      var icon = rows[i].querySelector('.sc-achievement-history-row__icon-img');
      if (!icon) continue;
      var rect = icon.getBoundingClientRect();
      if (rect.width && rect.height && rect.top >= 0 && rect.bottom <= global.innerHeight &&
          rect.left >= 0 && rect.right <= global.innerWidth) return icon;
    }
    return null;
  }

  function buildResult(item, asset) {
    var en = global.isUsAchievementLocale && global.isUsAchievementLocale();
    var list = document.createElement('section');
    list.className = 'sc-achievement-result';
    var heading = document.createElement('p');
    heading.textContent = en ? 'Achievement history' : '업적 획득 목록';
    list.appendChild(heading);
    var row = document.createElement('div');
    row.className = 'sc-achievement-result__row';
    var icon = document.createElement('img');
    icon.src = asset.profile;
    icon.alt = '';
    row.appendChild(icon);
    var title = document.createElement('strong');
    title.textContent = getAchievementDisplayName(item.definition);
    row.appendChild(title);
    list.appendChild(row);
    return { list: list, icon: icon };
  }

  function pageCountry() {
    try {
      var core = global.ActivityRegionCore;
      if (!core || typeof core.pathRegion !== 'function' || !global.location) return null;
      return core.pathRegion(global.location.pathname);
    } catch (_) {
      return null;
    }
  }

  function firstPostSceneSrc(record, explicitContentRegion) {
    if (!record || record.scenePlay !== true) return null;
    if (trimId(record.achievementId) !== 'first-post') return null;
    var page = pageCountry();
    if (page !== 'KR' && page !== 'US') return null;
    if (record.activityRegion !== page || record.contentRegion !== page) return null;
    if (explicitContentRegion !== page) return null;
    if (page === 'KR' && record.grantStore !== 'user_achievements' && record.grantStore !== 'user_activity_region_achievement') return null;
    if (page === 'US' && record.grantStore !== 'user_activity_region_achievement') return null;
    if (typeof global.getFirstPostSceneVideo !== 'function') return null;
    var src = global.getFirstPostSceneVideo(page);
    if (typeof src !== 'string' || !src) return null;
    if (page === 'KR' && src.indexOf('/first-post-kr-hq.mp4') === -1) return null;
    if (page === 'US' && src.indexOf('/first-post-us-hq.mp4') === -1) return null;
    if (src.indexOf('first-post-kr-hq.mp4') !== -1 && src.indexOf('first-post-us-hq.mp4') !== -1) return null;
    return src;
  }

  function storySceneSrc(record, explicitContentRegion) {
    if (!record || record.scenePlay !== true) return null;
    var id = trimId(record.achievementId);
    if (id !== 'first-comment' && id !== 'first-empathy-received' && id !== 'territory-citizen' && id !== 'invite-show-up' && id !== 'invite-pulled-in') return null;
    var page = pageCountry();
    if (page !== 'KR' && page !== 'US') return null;
    if (record.activityRegion !== page || record.contentRegion !== page) return null;
    if (explicitContentRegion !== page) return null;
    if (page === 'KR' && record.grantStore !== 'user_achievements' && record.grantStore !== 'user_activity_region_achievement') return null;
    if (page === 'US' && record.grantStore !== 'user_activity_region_achievement') return null;
    if (typeof global.getAchievementStoryVideo !== 'function') return null;
    var got = global.getAchievementStoryVideo(id, page);
    if (!got || typeof got.src !== 'string' || !got.src) return null;
    if (page === 'KR' && got.src.indexOf('-kr.mp4') === -1) return null;
    if (page === 'US' && got.src.indexOf('-us.mp4') === -1) return null;
    if (got.src.indexOf('-kr.mp4') !== -1 && got.src.indexOf('-us.mp4') !== -1) return null;
    return got;
  }

  function replayVideoSrc(id) {
    var page = pageCountry();
    var key = trimId(id);
    if (page !== 'KR' && page !== 'US') return '';
    if (!key) return '';
    if (key === 'first-post') {
      if (typeof global.getFirstPostSceneVideo !== 'function') return '';
      var first = global.getFirstPostSceneVideo(page);
      if (typeof first !== 'string' || !first) return '';
      if (page === 'KR' && first.indexOf('/first-post-kr-hq.mp4') === -1) return '';
      if (page === 'US' && first.indexOf('/first-post-us-hq.mp4') === -1) return '';
      if (first.indexOf('first-post-kr-hq.mp4') !== -1 && first.indexOf('first-post-us-hq.mp4') !== -1) return '';
      return first;
    }
    if (typeof global.getAchievementStoryVideo !== 'function') return '';
    var got = global.getAchievementStoryVideo(key, page);
    if (!got || typeof got.src !== 'string' || !got.src) return '';
    if (page === 'KR' && got.src.indexOf('-kr.mp4') === -1) return '';
    if (page === 'US' && got.src.indexOf('-us.mp4') === -1) return '';
    if (got.src.indexOf('-kr.mp4') !== -1 && got.src.indexOf('-us.mp4') !== -1) return '';
    return got.src;
  }

  function earnedOnThisPage(id) {
    if (typeof global.getCurrentUserAchievementHistory !== 'function') return false;
    var list;
    try { list = global.getCurrentUserAchievementHistory() || []; }
    catch (_) { return false; }
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && trimId(list[i].achievementId) === id) return true;
    }
    return false;
  }

  function makeSkipButton(onSkip) {
    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'sc-achievement-scene-skip';
    var en = global.isUsAchievementLocale && global.isUsAchievementLocale();
    skip.textContent = en ? 'Skip' : '건너뛰기';
    skip.setAttribute('aria-label', en ? 'Skip' : '건너뛰기');
    skip.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      onSkip();
    });
    return skip;
  }

  function runCountryScene(host, item, src, sceneOpts) {
    var gen = bumpGeneration();
    var finished = false;
    var safety = null;
    function note() {
      markShown(item);
    }
    function fallbackCard() {
      host.textContent = '';
      delete host.dataset.phase;
      var cardDone = false;
      function closeCard() {
        if (cardDone || gen !== generation) return;
        cardDone = true;
        var leftover = host.querySelector('.sc-achievement-scene-skip');
        if (leftover) leftover.remove();
        if (card.parentNode) card.parentNode.removeChild(card);
        delete host.dataset.phase;
        host.textContent = '';
        showing = false;
        processQueue();
      }
      var card = buildCard(item.definition, item.record);
      host.appendChild(card);
      host.appendChild(makeSkipButton(function () {
        note();
        closeCard();
      }));
      note();
      var approved = global.getApprovedAchievementAsset &&
        global.getApprovedAchievementAsset(item.record.achievementId || item.definition.id);
      if (approved) {
        var extraSkip = host.querySelector('.sc-achievement-scene-skip');
        if (extraSkip) extraSkip.remove();
        runApprovedTimeline(host, card, item, approved);
        return;
      }
      animateIn(card, function () {
        if (gen !== generation) return;
        arm(gen, ALERT_HOLD_MS, function () {
          animateOut(card, closeCard);
        });
      });
    }
    var page = document.documentElement;
    var previousOverflow = page.style.overflow;
    page.style.overflow = 'hidden';
    function restorePageScroll() {
      page.style.overflow = previousOverflow;
    }
    function finish(useFallback) {
      if (gen !== generation || finished) return;
      finished = true;
      if (safety) clearTimeout(safety);
      restorePageScroll();
      var node = host.querySelector('video.sc-achievement-scene-video');
      if (node) {
        node.onplaying = null;
        node.onended = null;
        node.onerror = null;
        try { node.pause(); } catch (_) {}
        try { node.removeAttribute('src'); node.load(); } catch (_) {}
        node.remove();
      }
      var skipBtn = host.querySelector('.sc-achievement-scene-skip');
      if (skipBtn) skipBtn.remove();
      if (useFallback) {
        fallbackCard();
        return;
      }
      delete host.dataset.phase;
      if (activeItem === item) activeItem = null;
      showing = false;
      processQueue();
    }
    host.dataset.phase = 'scene';
    var video = document.createElement('video');
    video.className = 'sc-achievement-scene-video';
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.loop = false;
    video.controls = false;
    video.src = src;
    var played = false;
    var holdMs = sceneOpts && sceneOpts.holdMs > 0 ? sceneOpts.holdMs : 10000;
    video.addEventListener('playing', function () {
      played = true;
      note();
      if (safety) clearTimeout(safety);
      safety = arm(gen, holdMs, function () { finish(false); });
    });
    video.addEventListener('ended', function () {
      finish(sceneOpts && sceneOpts.includesPresentation === false);
    });
    video.addEventListener('error', function () {
      note();
      finish(!(sceneOpts && sceneOpts.replay === true));
    });
    host.appendChild(video);
    host.appendChild(makeSkipButton(function () {
      note();
      finish(false);
    }));
    safety = arm(gen, 4000, function () { finish(!played); });
    function start() {
      var attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(function () {
          video.muted = true;
          var retry = video.play();
          if (retry && typeof retry.catch === 'function') {
            retry.catch(function () { finish(true); });
          }
        });
      }
    }
    start();
  }

  function runApprovedTimeline(host, card, item, asset) {
    var result;
    var flight;
    var animation;
    var gen = bumpGeneration();
    host.dataset.phase = 'card';
    card.classList.add('is-visible');
    markShown(item);
    arm(gen, PHASE_MS, function () {
      host.dataset.phase = 'stars';
    });
    arm(gen, PHASE_MS * 2, function () {
      result = buildResult(item, asset);
      host.appendChild(result.list);
      var target = visibleHistoryIcon(trimId(item.record.achievementId || item.definition.id)) || result.icon;
      var source = card.querySelector('.sc-achievement-acquired__icon');
      if (!prefersReducedMotion() && source && typeof source.animate === 'function') {
        var from = source.getBoundingClientRect();
        var to = target.getBoundingClientRect();
        flight = document.createElement('img');
        flight.src = asset.full;
        flight.alt = '';
        flight.className = 'sc-achievement-flight';
        Object.assign(flight.style, {
          left: from.left + 'px', top: from.top + 'px',
          width: from.width + 'px', height: from.height + 'px'
        });
        host.appendChild(flight);
        animation = flight.animate([
          { transform: 'translate(0, 0) scale(1)' },
          { transform: 'translate(' + (to.left - from.left) + 'px,' + (to.top - from.top) +
            'px) scale(' + (to.width / from.width) + ',' + (to.height / from.height) + ')' }
        ], { duration: PHASE_MS, easing: 'cubic-bezier(.3,.05,.2,1)', fill: 'forwards' });
        card.classList.add('is-flying');
      }
    });
    arm(gen, PHASE_MS * 3, function () {
      host.dataset.phase = 'result';
      if (animation) animation.cancel();
      if (flight) flight.remove();
      if (card && card.parentNode) card.remove();
      if (result && result.list) result.list.classList.add('is-complete');
    });
    arm(gen, PHASE_MS * 3 + RESULT_MS, function () {
      if (result && result.list && result.list.parentNode) result.list.remove();
      delete host.dataset.phase;
      host.textContent = '';
      if (activeItem === item) activeItem = null;
      showing = false;
      processQueue();
    });
  }

  function processQueue() {
    if (showing || !queue.length) return;
    showing = true;
    var item = queue.shift();
    activeItem = item;
    var host = ensureHost();
    host.textContent = '';
    var scene = firstPostSceneSrc(item.record, item.contentRegion);
    if (scene) {
      runCountryScene(host, item, scene);
      return;
    }
    var story = storySceneSrc(item.record, item.contentRegion);
    if (story) {
      var storyHold = story.holdMs > 0 ? story.holdMs : 14000;
      runCountryScene(host, item, story.src, {
        holdMs: storyHold,
        includesPresentation: story.includesPresentation === true,
      });
      return;
    }
    if (item.record && item.record.scenePlay === true && trimId(item.record.achievementId) === 'first-post') {
      showing = false;
      processQueue();
      return;
    }
    var card = buildCard(item.definition, item.record);
    host.appendChild(card);

    var approved = global.getApprovedAchievementAsset &&
      global.getApprovedAchievementAsset(item.record.achievementId || item.definition.id);
    if (approved) {
      runApprovedTimeline(host, card, item, approved);
      return;
    }
    var gen = bumpGeneration();
    animateIn(card, function () {
      if (gen !== generation) return;
      markShown(item);
      arm(gen, ALERT_HOLD_MS, function () {
        animateOut(card, function () {
          if (gen !== generation) return;
          if (card.parentNode) card.parentNode.removeChild(card);
          if (activeItem === item) activeItem = null;
          showing = false;
          processQueue();
        });
      });
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
      contentRegion: opts.contentRegion === 'KR' || opts.contentRegion === 'US'
        ? opts.contentRegion
        : (record.contentRegion === 'KR' || record.contentRegion === 'US' ? record.contentRegion : null),
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

  function replayAchievementScene(achievementId) {
    var id = trimId(achievementId);
    var src = replayVideoSrc(id);
    if (!src) return { ok: false, reason: 'NO_VIDEO' };
    if (!earnedOnThisPage(id)) return { ok: false, reason: 'NOT_EARNED' };
    var def = getAchievementDefinitionSafe(id);
    if (!def) return { ok: false, reason: 'UNKNOWN_ACHIEVEMENT' };
    var page = pageCountry();
    var story = typeof global.getAchievementStoryVideo === 'function'
      ? global.getAchievementStoryVideo(id, page)
      : null;
    suspendForReplay();
    var item = {
      definition: def,
      record: { achievementId: id, activityRegion: page, contentRegion: page },
      onShown: null,
      replay: true,
      noted: true,
    };
    activeItem = item;
    showing = true;
    var host = ensureHost();
    host.textContent = '';
    runCountryScene(host, item, src, {
      holdMs: 30000,
      includesPresentation: !story || story.includesPresentation !== false,
      replay: true,
    });
    return { ok: true, src: src };
  }

  global.enqueueAchievementAcquiredAlert = enqueueAchievementAcquiredAlert;
  global.achievementReplaySource = replayVideoSrc;
  global.replayAchievementScene = replayAchievementScene;
  global.__scPreviewAchievementAcquired = previewAchievementAcquired;
})(typeof window !== 'undefined' ? window : globalThis);
