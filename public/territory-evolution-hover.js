/**
 * =============================================================================
 * 센텐스아레나 — 영토 발전 Hover (작전 정보 HUD)
 * =============================================================================
 * - TERRITORY_EVOLUTION_IMAGES / STAGE_LABELS 재사용
 * - 인원·집계 정책: territory-evolution-population.js (미변경)
 * - Hover: 핵심 정보 + 현재 단계 이미지 1장 · 순차 reveal
 * - 전·현재·다음 비교 빌더는 클릭 상세용으로 보존 (Hover 미표시)
 * - 영토별 고정 슬롯 · pointer-events:none · 히트존/클릭 미변경
 * =============================================================================
 */
(function (global) {
  'use strict';

  var TERRITORY_EVOLUTION_STAGE_THRESHOLDS =
    global.TerritoryEvolutionCore && global.TerritoryEvolutionCore.STAGE_THRESHOLDS
      ? global.TerritoryEvolutionCore.STAGE_THRESHOLDS.map(function (row) {
          return {
            stage: row.stage,
            min: row.min,
            max: row.max == null ? Infinity : row.max,
            rangeLabel: row.rangeLabel,
          };
        })
      : [
          { stage: 1, min: 0, max: 100, rangeLabel: '0~100명' },
          { stage: 2, min: 101, max: 300, rangeLabel: '101~300명' },
          { stage: 3, min: 301, max: 1000, rangeLabel: '301~1,000명' },
          { stage: 4, min: 1001, max: 2000, rangeLabel: '1,001~2,000명' },
          { stage: 5, min: 2001, max: 8000, rangeLabel: '2,001~8,000명' },
          { stage: 6, min: 8001, max: Infinity, rangeLabel: '8,001명 이상' },
        ];

  var KIND_TO_EVO = {
    PROGRESSIVE: 'pioneer',
    CONSERVATIVE: 'guardian',
    COMMON: 'central',
    KANTAPBIYA: 'alien',
  };

  var EVO_TO_BELIEF = {
    pioneer: 'reform',
    guardian: 'order',
    central: 'centrist',
    alien: 'alien',
  };

  var ROLE_LABELS = {
    prev: '전단계',
    current: '현재 단계',
    next: '다음단계',
  };

  var PANEL_ID = 'sc-territory-evolution-hover';
  var SAFE_MARGIN = 16;
  var HOVER_DELAY_MS = 150;
  var TEXT_REVEAL_MS = 1650;
  var PROGRESS_ANIM_MS = 650;
  var IMAGE_FADE_MS = 550;
  var PROGRESS_START_RATIO = 0.48;
  var IMAGE_START_RATIO = 0.63;
  var TOTAL_REVEAL_TARGET_MS = 2000;
  var SOUND_COOLDOWN_MS = 3000;
  var DEFAULT_PANEL_W = 495;
  var DEFAULT_PANEL_H = 198;

  var activeKey = null;
  var activeHitPath = null;
  var panelEl = null;
  var screenObserver = null;
  var viewportBound = false;
  var openTimer = null;
  var revealTimers = [];
  var revealRaf = 0;
  var revealToken = 0;
  var lastSoundAtByKey = {};
  var hoverSessionSounds = 0;
  var revealMeta = {
    mode: 'PARALLEL_HORIZONTAL',
    hoverDelayMs: HOVER_DELAY_MS,
    textRevealDurationMs: TEXT_REVEAL_MS,
    progressFillDurationMs: PROGRESS_ANIM_MS,
    imageFadeDurationMs: IMAGE_FADE_MS,
    totalRevealTargetMs: TOTAL_REVEAL_TARGET_MS,
    sharedProgress: 0,
    activeRowCount: 4,
    rowsStartedTogether: true,
    progressStartRatio: PROGRESS_START_RATIO,
    imageStartRatio: IMAGE_START_RATIO,
    easing: 'linear',
    animationFrameActive: false,
    cancelled: false,
    revealToken: 0,
  };

  var hoverHudMeta = {
    mode: 'OPERATION_HUD',
    territory: null,
    visible: false,
    pending: false,
    animationStep: 'idle',
    previousAnimationCancelled: false,
    hoverDelayMs: HOVER_DELAY_MS,
    totalRevealMs: TOTAL_REVEAL_TARGET_MS,
    currentImageOnly: true,
    imageMasked: true,
    panelBorderVisible: false,
    internalCardBorders: false,
    progressAnimated: true,
    soundAvailable: false,
    soundEnabled: false,
    soundCooldownActive: false,
    reducedMotion: false,
  };

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function clampStage(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v)) return 1;
    return clamp(v, 1, 6);
  }

  function normalizeTerritoryPopulation(value) {
    if (typeof global.normalizeTerritoryPopulation === 'function') {
      return global.normalizeTerritoryPopulation(value);
    }
    var number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.max(0, Math.floor(number));
  }

  function getDirectCountsSource(overrideSource) {
    if (overrideSource) return overrideSource;
    if (typeof global.getTerritoryEvolutionDirectCounts === 'function') {
      return global.getTerritoryEvolutionDirectCounts();
    }
    return (
      global.TERRITORY_POPULATION_MOCK_SOURCE || {
        pioneer: 0,
        guardian: 0,
        central: 0,
        alien: 0,
      }
    );
  }

  function getTerritoryEvolutionPopulation(territoryKey, populationSource) {
    if (typeof global.getTerritoryEvolutionPopulation === 'function') {
      return global.getTerritoryEvolutionPopulation(
        territoryKey,
        getDirectCountsSource(populationSource)
      );
    }
    var source = getDirectCountsSource(populationSource);
    var pioneer = normalizeTerritoryPopulation(source.pioneer);
    var guardian = normalizeTerritoryPopulation(source.guardian);
    var central = normalizeTerritoryPopulation(source.central);
    var alien = normalizeTerritoryPopulation(source.alien);
    if (territoryKey === 'pioneer') return pioneer;
    if (territoryKey === 'guardian') return guardian;
    if (territoryKey === 'alien') return alien;
    if (territoryKey === 'central') {
      if (
        typeof global.isTerritoryEvolutionUsingMockSource === 'function' &&
        global.isTerritoryEvolutionUsingMockSource()
      ) {
        return central;
      }
      return central + pioneer + guardian;
    }
    return 0;
  }

  function getTerritoryEvolutionStageByPopulation(population) {
    var pop = normalizeTerritoryPopulation(population);
    var i;
    for (i = 0; i < TERRITORY_EVOLUTION_STAGE_THRESHOLDS.length; i++) {
      var row = TERRITORY_EVOLUTION_STAGE_THRESHOLDS[i];
      if (pop >= row.min && pop <= row.max) return row.stage;
    }
    return 6;
  }

  function getTerritoryEvolutionStageRangeLabel(stage) {
    var safe = clampStage(stage);
    var i;
    for (i = 0; i < TERRITORY_EVOLUTION_STAGE_THRESHOLDS.length; i++) {
      if (TERRITORY_EVOLUTION_STAGE_THRESHOLDS[i].stage === safe) {
        return TERRITORY_EVOLUTION_STAGE_THRESHOLDS[i].rangeLabel;
      }
    }
    return '';
  }

  function getTerritoryEvolutionThresholdRow(stage) {
    var safe = clampStage(stage);
    var i;
    for (i = 0; i < TERRITORY_EVOLUTION_STAGE_THRESHOLDS.length; i++) {
      if (TERRITORY_EVOLUTION_STAGE_THRESHOLDS[i].stage === safe) {
        return TERRITORY_EVOLUTION_STAGE_THRESHOLDS[i];
      }
    }
    return null;
  }

  function getTerritoryEvolutionNextStageProgress(territoryKey, population, currentStage) {
    var pop = normalizeTerritoryPopulation(population);
    var stage = clampStage(currentStage);
    var currentRow = getTerritoryEvolutionThresholdRow(stage);

    if (!currentRow || stage >= 6) {
      return {
        hasNextStage: false,
        nextStage: null,
        nextStageLabel: '',
        nextStageMinPopulation: null,
        remainingPopulation: 0,
        progressRatio: 1,
        progressPercent: 100,
      };
    }

    var nextRow = getTerritoryEvolutionThresholdRow(stage + 1);
    if (!nextRow) {
      return {
        hasNextStage: false,
        nextStage: null,
        nextStageLabel: '',
        nextStageMinPopulation: null,
        remainingPopulation: 0,
        progressRatio: 1,
        progressPercent: 100,
      };
    }

    var nextMin = nextRow.min;
    var currentMin = currentRow.min;
    var span = nextMin - currentMin;
    var remaining = Math.max(0, nextMin - pop);
    var ratio = span > 0 ? (pop - currentMin) / span : 1;
    ratio = clamp(ratio, 0, 1);

    return {
      hasNextStage: true,
      nextStage: nextRow.stage,
      nextStageLabel: stageLabel(territoryKey, nextRow.stage),
      nextStageMinPopulation: nextMin,
      remainingPopulation: remaining,
      progressRatio: ratio,
      progressPercent: ratio * 100,
    };
  }

  function getTerritoryEvolutionState(territoryKey, populationSource) {
    var population = getTerritoryEvolutionPopulation(territoryKey, populationSource);
    if (global.TerritoryEvolutionCore) {
      var contract = global.TerritoryEvolutionCore.getTerritoryEvolutionState({
        territory: territoryKey,
        population: population,
        populationSource:
          typeof global.isTerritoryEvolutionUsingMockSource === 'function' &&
          global.isTerritoryEvolutionUsingMockSource()
            ? 'LEGACY_MOCK'
            : 'MEMORY',
        dataStatus:
          typeof global.isTerritoryEvolutionUsingMockSource === 'function' &&
          global.isTerritoryEvolutionUsingMockSource()
            ? 'LEGACY_MOCK'
            : 'READY',
      });
      if (global.TerritoryEvolutionDataAdapter) {
        return global.TerritoryEvolutionDataAdapter.mapEvolutionStateToHoverPanel(contract);
      }
    }
    var stage = getTerritoryEvolutionStageByPopulation(population);
    var next = getTerritoryEvolutionNextStageProgress(territoryKey, population, stage);
    return {
      territoryKey: territoryKey,
      population: population,
      stage: stage,
      stageLabel: stageLabel(territoryKey, stage),
      rangeLabel: getTerritoryEvolutionStageRangeLabel(stage),
      hasNextStage: next.hasNextStage,
      nextStage: next.nextStage,
      nextStageLabel: next.nextStageLabel,
      nextStageMinPopulation: next.nextStageMinPopulation,
      remainingPopulation: next.remainingPopulation,
      progressRatio: next.progressRatio,
      progressPercent: next.progressPercent,
      usingMock:
        typeof global.isTerritoryEvolutionUsingMockSource === 'function'
          ? global.isTerritoryEvolutionUsingMockSource()
          : true,
    };
  }

  function buildLegacyMockStateSnapshot() {
    var keys = ['pioneer', 'guardian', 'central', 'alien'];
    var out = {};
    var i;
    for (i = 0; i < keys.length; i++) {
      var state = getTerritoryEvolutionState(keys[i]);
      out[keys[i]] = { stage: state.stage, population: state.population };
    }
    return out;
  }

  function isKnownTerritoryKey(evoKey) {
    var source = getDirectCountsSource();
    return Object.prototype.hasOwnProperty.call(source, evoKey);
  }

  function formatPopulation(n) {
    var v = Number(n);
    if (!isFinite(v)) return '0';
    try {
      return Math.round(v).toLocaleString('ko-KR');
    } catch (e) {
      return String(Math.round(v));
    }
  }

  function resolveTerritoryName(evoKey) {
    var beliefKey = EVO_TO_BELIEF[evoKey];
    var beliefs = global.TERRITORY_BELIEFS;
    if (beliefs && beliefKey && beliefs[beliefKey] && beliefs[beliefKey].displayName) {
      return beliefs[beliefKey].displayName;
    }
    var fallback = {
      pioneer: '개척영토',
      guardian: '수호영토',
      central: '중앙광장',
      alien: '외계행성',
    };
    return fallback[evoKey] || evoKey;
  }

  function stageLabel(territoryKey, stage) {
    if (typeof global.getTerritoryEvolutionStageLabel === 'function') {
      return global.getTerritoryEvolutionStageLabel(territoryKey, stage);
    }
    var labels = global.TERRITORY_EVOLUTION_STAGE_LABELS;
    var safe = clampStage(stage);
    if (labels && labels[safe]) return labels[safe];
    return String(safe);
  }

  function stageImage(evoKey, stage) {
    var images = global.TERRITORY_EVOLUTION_IMAGES;
    if (!images || !images[evoKey]) return null;
    return images[evoKey][stage] || null;
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function isSoundEnabled() {
    try {
      if (global.SC_UI_SOUND_ENABLED === false) return false;
      if (global.SC_UI_SOUND_ENABLED === true) return true;
      var raw = localStorage.getItem('sc_ui_sound_enabled');
      if (raw === '0' || raw === 'false') return false;
      if (raw === '1' || raw === 'true') return true;
    } catch (_) {}
    return false;
  }

  function playHoverTick(evoKey) {
    hoverHudMeta.soundEnabled = isSoundEnabled();
    hoverHudMeta.soundAvailable = typeof global.playScUiTickSound === 'function';
    if (!hoverHudMeta.soundEnabled || !hoverHudMeta.soundAvailable) return;
    if (hoverSessionSounds >= 4) return;
    var now = Date.now();
    var last = lastSoundAtByKey[evoKey] || 0;
    if (now - last < SOUND_COOLDOWN_MS && hoverSessionSounds > 0) {
      hoverHudMeta.soundCooldownActive = true;
      return;
    }
    hoverHudMeta.soundCooldownActive = false;
    try {
      global.playScUiTickSound({ volume: 0.18, source: 'territory-evolution-hover' });
      lastSoundAtByKey[evoKey] = now;
      hoverSessionSounds += 1;
    } catch (_) {
      hoverHudMeta.soundAvailable = false;
    }
  }

  function clearRevealTimers() {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    if (revealRaf) {
      try {
        cancelAnimationFrame(revealRaf);
      } catch (_) {}
      revealRaf = 0;
    }
    var i;
    for (i = 0; i < revealTimers.length; i++) clearTimeout(revealTimers[i]);
    revealTimers = [];
    revealMeta.animationFrameActive = false;
  }

  function cancelReveal(markCancelled) {
    clearRevealTimers();
    revealToken += 1;
    revealMeta.revealToken = revealToken;
    revealMeta.sharedProgress = 0;
    revealMeta.cancelled = !!markCancelled;
    hoverHudMeta.pending = false;
    hoverHudMeta.animationStep = 'idle';
    if (markCancelled) hoverHudMeta.previousAnimationCancelled = true;
  }

  function scheduleReveal(fn, delay) {
    var t = setTimeout(fn, delay);
    revealTimers.push(t);
    return t;
  }

  function getMapRect() {
    var frame =
      document.querySelector('#screen-main .territory-centrist-hero__frame--island-map') ||
      document.querySelector('#screen-main .territory-centrist-hero__frame') ||
      document.getElementById('territory-hit-zones-wrap') ||
      document.getElementById('screen-main');
    if (!frame) {
      return {
        left: 0,
        top: 0,
        right: window.innerWidth || 0,
        bottom: window.innerHeight || 0,
        width: window.innerWidth || 0,
        height: window.innerHeight || 0,
      };
    }
    return frame.getBoundingClientRect();
  }

  function rectsOverlap(a, b, pad) {
    var p = pad || 0;
    return !(
      a.right <= b.left - p ||
      a.left >= b.right + p ||
      a.bottom <= b.top - p ||
      a.top >= b.bottom + p
    );
  }

  function getVisibleHudRects() {
    var rects = [];
    var tab = document.getElementById('avatar-dock-tab');
    if (tab) {
      var tr = tab.getBoundingClientRect();
      if (tr.width > 4 && tr.height > 4) rects.push(tr);
    }
    var dock = document.getElementById('avatar-dock');
    if (dock && !dock.hidden && !dock.classList.contains('is-collapsed')) {
      var panel = dock.querySelector('.avatar-dock__panel');
      var pr = panel ? panel.getBoundingClientRect() : dock.getBoundingClientRect();
      if (pr.width > 4 && pr.height > 4) rects.push(pr);
    }
    return rects;
  }

  function getChatRect() {
    var chat = document.getElementById('chat-rail');
    if (!chat || chat.hidden) return null;
    var cr = chat.getBoundingClientRect();
    if (cr.width < 4 || cr.height < 4) return null;
    return cr;
  }

  function getSideStackRects() {
    var rects = [];
    var leftStack = document.getElementById('sc-left-side-stack');
    if (leftStack && !leftStack.hidden && !leftStack.classList.contains('is-view-hidden')) {
      var lr = leftStack.getBoundingClientRect();
      if (lr.width > 4 && lr.height > 4) rects.push(lr);
    }
    var activity = document.getElementById('sc-activity-feed-panel');
    if (activity && !activity.hidden) {
      var ar = activity.getBoundingClientRect();
      if (ar.width > 4 && ar.height > 4) rects.push(ar);
    }
    return rects;
  }

  function resolveUiCollisions(left, top, panelWidth, panelHeight, vw, vh, preferLeftSlot) {
    var panelBox = {
      left: left,
      top: top,
      right: left + panelWidth,
      bottom: top + panelHeight,
    };

    getVisibleHudRects().forEach(function (hud) {
      if (!rectsOverlap(panelBox, hud, 8)) return;
      if (preferLeftSlot) {
        left = Math.max(left, hud.right + 10);
      } else if (panelBox.bottom > hud.top) {
        top = hud.top - panelHeight - 10;
      }
      panelBox.left = left;
      panelBox.top = top;
      panelBox.right = left + panelWidth;
      panelBox.bottom = top + panelHeight;
    });

    var chat = getChatRect();
    if (chat && rectsOverlap(panelBox, chat, 8)) {
      top = Math.min(top, chat.top - panelHeight - 10);
      panelBox.top = top;
      panelBox.bottom = top + panelHeight;
      if (rectsOverlap(panelBox, chat, 8)) {
        left = Math.min(left, chat.left - panelWidth - 10);
      }
    }

    getSideStackRects().forEach(function (side) {
      if (!rectsOverlap(panelBox, side, 8)) return;
      if (preferLeftSlot || side.left < (vw || 0) * 0.4) {
        left = Math.max(left, side.right + 10);
      } else {
        top = Math.min(top, side.top - panelHeight - 10);
        panelBox.top = top;
        panelBox.bottom = top + panelHeight;
        if (rectsOverlap(panelBox, side, 8)) {
          left = Math.min(left, side.left - panelWidth - 10);
        }
      }
      panelBox.left = left;
      panelBox.right = left + panelWidth;
      panelBox.top = top;
      panelBox.bottom = top + panelHeight;
    });

    left = clamp(left, SAFE_MARGIN, Math.max(SAFE_MARGIN, vw - panelWidth - SAFE_MARGIN));
    top = clamp(top, SAFE_MARGIN, Math.max(SAFE_MARGIN, vh - panelHeight - SAFE_MARGIN));
    return { left: left, top: top };
  }

  function getTerritoryEvolutionPanelPosition(territoryKey, mapRect, anchorRect, panelRect) {
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var panelWidth = (panelRect && panelRect.width) || DEFAULT_PANEL_W;
    var panelHeight = (panelRect && panelRect.height) || DEFAULT_PANEL_H;
    var left = SAFE_MARGIN;
    var top = SAFE_MARGIN;
    var placement = 'fallback';
    var preferLeftSlot = false;

    var map = mapRect || getMapRect();

    if (territoryKey === 'pioneer') {
      placement = 'pioneer-right';
      left = map.right - panelWidth * 0.55;
      top = map.top + (map.height - panelHeight) / 2;
    } else if (territoryKey === 'guardian') {
      placement = 'guardian-left';
      preferLeftSlot = true;
      left = map.left - panelWidth * 0.35;
      top = map.top + 40;
    } else if (territoryKey === 'alien') {
      placement = 'alien-left';
      preferLeftSlot = true;
      left = map.left - panelWidth * 0.35;
      top = map.top + 60;
    } else if (territoryKey === 'central') {
      placement = 'central-right-lower';
      left = map.right - panelWidth * 0.55;
      top = map.bottom - panelHeight - 18;
    } else {
      left = map.left + (map.width - panelWidth) / 2;
      top = map.top + (map.height - panelHeight) / 2;
    }

    var resolved = resolveUiCollisions(
      left,
      top,
      panelWidth,
      panelHeight,
      vw,
      vh,
      preferLeftSlot
    );

    return {
      left: Math.round(resolved.left),
      top: Math.round(resolved.top),
      placement: placement,
    };
  }

  function panelMarkup() {
    return (
      '<div class="territory-operation-hud__shell">' +
      '<div class="territory-operation-hud__content">' +
      '<div class="territory-operation-hud__name" data-tevo-name></div>' +
      '<div class="territory-operation-hud__op" data-tevo-op>OPERATION STATUS</div>' +
      '<div class="territory-operation-hud__rows">' +
      '<div class="territory-operation-hud__row" data-tevo-row="pop" data-reveal-row="1">' +
      '<span class="territory-operation-hud__label" data-tevo-label></span>' +
      '<span class="territory-operation-hud__value" data-tevo-pop><span data-tevo-typed></span></span>' +
      '</div>' +
      '<div class="territory-operation-hud__row" data-tevo-row="stage" data-reveal-row="1">' +
      '<span class="territory-operation-hud__label" data-tevo-label></span>' +
      '<span class="territory-operation-hud__value" data-tevo-stage><span data-tevo-typed></span></span>' +
      '</div>' +
      '<div class="territory-operation-hud__row" data-tevo-row="next" data-reveal-row="1">' +
      '<span class="territory-operation-hud__label" data-tevo-label></span>' +
      '<span class="territory-operation-hud__value" data-tevo-next><span data-tevo-typed></span></span>' +
      '</div>' +
      '<div class="territory-operation-hud__row" data-tevo-row="pct" data-reveal-row="1">' +
      '<span class="territory-operation-hud__label" data-tevo-label></span>' +
      '<span class="territory-operation-hud__value" data-tevo-pct><span data-tevo-typed></span></span>' +
      '</div>' +
      '</div>' +
      '<div class="territory-operation-hud__progress" data-tevo-progress>' +
      '<div class="territory-operation-hud__progress-track" data-tevo-progress-track role="progressbar" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="territory-operation-hud__progress-fill" data-tevo-progress-fill></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="territory-operation-hud__image" data-tevo-image>' +
      '<div class="territory-operation-hud__image-fade" aria-hidden="true"></div>' +
      '<img class="territory-operation-hud__img" data-tevo-img alt="" draggable="false" />' +
      '</div>' +
      '</div>'
    );
  }

  function ensurePanel() {
    if (panelEl && panelEl.isConnected) {
      if (
        !panelEl.querySelector('[data-tevo-image]') ||
        !panelEl.querySelector('[data-tevo-progress]') ||
        panelEl.querySelector('[data-tevo-hint]')
      ) {
        panelEl.className = 'territory-operation-hud';
        panelEl.innerHTML = panelMarkup();
      }
      return panelEl;
    }
    var existing = document.getElementById(PANEL_ID);
    if (existing) {
      panelEl = existing;
      panelEl.className = 'territory-operation-hud';
      if (
        !panelEl.querySelector('[data-tevo-image]') ||
        !panelEl.querySelector('[data-tevo-progress]') ||
        panelEl.querySelector('[data-tevo-hint]')
      ) {
        panelEl.innerHTML = panelMarkup();
      }
      return panelEl;
    }
    var el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'territory-operation-hud';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = panelMarkup();
    document.body.appendChild(el);
    panelEl = el;
    return panelEl;
  }

  /** 클릭 상세용 — Hover에서는 사용하지 않음. 전·현재·다음 카드 보존 */
  function buildStageCard(role, evoKey, stage, name) {
    var src = stageImage(evoKey, stage);
    var era = stageLabel(evoKey, stage);
    var roleText = ROLE_LABELS[role] || role;
    var card = document.createElement('div');
    card.className = 'territory-evolution-detail-compare__card territory-evolution-detail-compare__card--' + role;
    card.setAttribute('data-tevo-role', role);
    card.setAttribute('data-tevo-detail-stage', String(stage));

    var wrap = document.createElement('div');
    wrap.className = 'territory-evolution-detail-compare__img-wrap';

    if (!src) {
      card.classList.add('is-empty');
      wrap.innerHTML = '<div class="territory-evolution-detail-compare__missing">이미지 없음</div>';
    } else {
      var img = document.createElement('img');
      img.className = 'territory-evolution-detail-compare__img';
      img.src = src;
      img.alt = name + ' ' + roleText + ' ' + era;
      img.draggable = false;
      img.decoding = 'async';
      wrap.appendChild(img);
    }

    card.appendChild(wrap);
    return card;
  }

  function buildStageLabel(side, evoKey, stage) {
    var el = document.createElement('div');
    el.className =
      'territory-evolution-detail-compare__stage-label territory-evolution-detail-compare__stage-label--' +
      side;
    el.setAttribute('data-tevo-stage-label', side);

    var role = document.createElement('strong');
    role.className = 'territory-evolution-detail-compare__stage-label-role';
    if (side === 'prev') role.textContent = '← 전단계';
    else if (side === 'next') role.textContent = '다음단계 →';
    else role.textContent = ROLE_LABELS.current;

    var name = document.createElement('span');
    name.className = 'territory-evolution-detail-compare__stage-label-name';
    name.textContent = stageLabel(evoKey, stage);

    el.appendChild(role);
    el.appendChild(name);
    return el;
  }

  /** 클릭 상세용 3단계 비교 DOM 빌더 (Hover 미사용) */
  function buildDetailStageCompare(evoKey, stageOpt) {
    var state = getTerritoryEvolutionState(evoKey);
    var stage = clampStage(stageOpt != null ? stageOpt : state.stage);
    var name = resolveTerritoryName(evoKey);
    var root = document.createElement('div');
    root.className = 'territory-evolution-detail-compare';
    root.setAttribute('data-tevo-detail-compare', '1');
    root.setAttribute('data-territory', evoKey);
    root.setAttribute('data-stage', String(stage));
    root.setAttribute('data-range-label', state.rangeLabel || '');

    if (stage > 1) {
      root.appendChild(buildStageLabel('prev', evoKey, stage - 1));
      root.appendChild(buildStageCard('prev', evoKey, stage - 1, name));
    }
    root.appendChild(buildStageLabel('current', evoKey, stage));
    root.appendChild(buildStageCard('current', evoKey, stage, name));
    if (stage < 6) {
      root.appendChild(buildStageCard('next', evoKey, stage + 1, name));
      root.appendChild(buildStageLabel('next', evoKey, stage + 1));
    }
    return root;
  }

  function resetHudVisualState(panel) {
    panel.classList.remove('is-revealing', 'is-complete', 'is-reveal-complete');
    var rows = panel.querySelectorAll('[data-tevo-row]');
    var i;
    for (i = 0; i < rows.length; i++) {
      rows[i].classList.remove('is-shown');
      var labelEl = rows[i].querySelector('[data-tevo-label]');
      var typedEl = rows[i].querySelector('[data-tevo-typed]');
      if (labelEl) labelEl.textContent = '';
      if (typedEl) typedEl.textContent = '';
    }
    var op = panel.querySelector('[data-tevo-op]');
    if (op) op.classList.remove('is-shown');
    var nameEl = panel.querySelector('[data-tevo-name]');
    if (nameEl) nameEl.textContent = '';
    var progress = panel.querySelector('[data-tevo-progress]');
    if (progress) progress.classList.remove('is-shown');
    var image = panel.querySelector('[data-tevo-image]');
    if (image) image.classList.remove('is-shown');
    var fill = panel.querySelector('[data-tevo-progress-fill]');
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }
  }

  function applyRowReveal(row, visibleLen) {
    if (!row) return;
    var label = String(row.getAttribute('data-full-label') || '');
    var value = String(row.getAttribute('data-full-value') || '');
    var labelEl = row.querySelector('[data-tevo-label]');
    var typedEl = row.querySelector('[data-tevo-typed]');
    var n = Math.max(0, Math.min(label.length + value.length, visibleLen | 0));
    if (labelEl) {
      labelEl.textContent = n <= label.length ? label.slice(0, n) : label;
    }
    if (typedEl) {
      typedEl.textContent = n <= label.length ? '' : value.slice(0, n - label.length);
    }
  }

  function completeRowReveal(row) {
    if (!row) return;
    var label = String(row.getAttribute('data-full-label') || '');
    var value = String(row.getAttribute('data-full-value') || '');
    var labelEl = row.querySelector('[data-tevo-label]');
    var typedEl = row.querySelector('[data-tevo-typed]');
    if (labelEl) labelEl.textContent = label;
    if (typedEl) typedEl.textContent = value;
  }

  function prepareProgressTrack(panel, state) {
    var track = panel.querySelector('[data-tevo-progress-track]');
    var pct = state.hasNextStage ? Math.round(state.progressPercent) : 100;
    if (track) {
      track.setAttribute('aria-valuenow', String(pct));
      track.setAttribute(
        'aria-label',
        state.hasNextStage
          ? '다음 단계까지 진행률 ' + pct + '%'
          : '최고 단계 ' + state.stageLabel
      );
    }
    return pct;
  }

  function startProgressFill(panel, state, token) {
    var fill = panel.querySelector('[data-tevo-progress-fill]');
    var progressRoot = panel.querySelector('[data-tevo-progress]');
    var pct = prepareProgressTrack(panel, state);
    if (progressRoot) progressRoot.classList.add('is-shown');
    if (!fill) return;
    if (prefersReducedMotion()) {
      fill.style.transition = 'none';
      fill.style.width = pct + '%';
      return;
    }
    fill.style.transition = 'none';
    fill.style.width = '0%';
    scheduleReveal(function () {
      if (token !== revealToken) return;
      fill.style.transition = 'width ' + PROGRESS_ANIM_MS + 'ms linear';
      fill.style.width = pct + '%';
    }, 16);
  }

  function buildRevealRows(panel, state) {
    var pctText = state.hasNextStage ? Math.round(state.progressPercent) + '%' : 'MAX';
    var defs = [
      {
        key: 'pop',
        label: '발전 인원',
        value: formatPopulation(state.population) + '명',
      },
      {
        key: 'stage',
        label: '현재 단계',
        value: state.stageLabel,
      },
      {
        key: 'next',
        label: '다음까지',
        value: state.hasNextStage
          ? formatPopulation(state.remainingPopulation) + '명'
          : '최종 단계',
      },
      {
        key: 'pct',
        label: '진행률',
        value: pctText,
      },
    ];
    var rows = [];
    var i;
    for (i = 0; i < defs.length; i++) {
      var def = defs[i];
      var row = panel.querySelector('[data-tevo-row="' + def.key + '"]');
      if (!row) continue;
      row.setAttribute('data-full-label', def.label);
      row.setAttribute('data-full-value', def.value);
      rows.push(row);
    }
    return rows;
  }

  function startReveal(panel, evoKey, state) {
    var token = revealToken;
    var reduced = prefersReducedMotion();
    hoverHudMeta.reducedMotion = reduced;
    hoverHudMeta.territory = evoKey;
    hoverHudMeta.visible = true;
    hoverHudMeta.pending = false;
    hoverHudMeta.previousAnimationCancelled = false;
    hoverHudMeta.hoverDelayMs = HOVER_DELAY_MS;
    hoverHudMeta.totalRevealMs = TOTAL_REVEAL_TARGET_MS;
    hoverSessionSounds = 0;

    revealMeta.cancelled = false;
    revealMeta.revealToken = token;
    revealMeta.sharedProgress = 0;
    revealMeta.animationFrameActive = false;
    revealMeta.activeRowCount = 4;
    revealMeta.rowsStartedTogether = true;

    var nameEl = panel.querySelector('[data-tevo-name]');
    var opEl = panel.querySelector('[data-tevo-op]');
    var imageWrap = panel.querySelector('[data-tevo-image]');
    var rows = buildRevealRows(panel, state);

    if (nameEl) nameEl.textContent = resolveTerritoryName(evoKey);
    if (opEl) opEl.classList.add('is-shown');
    hoverHudMeta.animationStep = 'name';

    function finishInstant() {
      var i;
      for (i = 0; i < rows.length; i++) {
        rows[i].classList.add('is-shown');
        completeRowReveal(rows[i]);
      }
      startProgressFill(panel, state, token);
      if (imageWrap) imageWrap.classList.add('is-shown');
      panel.classList.remove('is-revealing');
      panel.classList.add('is-complete', 'is-reveal-complete');
      revealMeta.sharedProgress = 1;
      revealMeta.animationFrameActive = false;
      hoverHudMeta.animationStep = 'complete';
    }

    if (reduced) {
      finishInstant();
      return;
    }

    panel.classList.add('is-revealing');
    hoverHudMeta.animationStep = 'parallel';
    playHoverTick(evoKey);

    var i;
    for (i = 0; i < rows.length; i++) {
      rows[i].classList.add('is-shown');
      applyRowReveal(rows[i], 0);
    }

    var progressStarted = false;
    var imageStarted = false;
    var revealStartTime = 0;

    function visibleLengthFor(fullLen, progress) {
      if (fullLen <= 0) return 0;
      if (progress >= 1) return fullLen;
      if (progress <= 0) return 1;
      return Math.min(fullLen, Math.max(1, Math.ceil(fullLen * progress)));
    }

    function applySharedProgress(progress) {
      revealMeta.sharedProgress = progress;
      var r;
      for (r = 0; r < rows.length; r++) {
        var fullLen =
          String(rows[r].getAttribute('data-full-label') || '').length +
          String(rows[r].getAttribute('data-full-value') || '').length;
        applyRowReveal(rows[r], visibleLengthFor(fullLen, progress));
      }
      if (!progressStarted && progress >= PROGRESS_START_RATIO) {
        progressStarted = true;
        hoverHudMeta.animationStep = 'progress';
        startProgressFill(panel, state, token);
      }
      if (!imageStarted && progress >= IMAGE_START_RATIO) {
        imageStarted = true;
        hoverHudMeta.animationStep = 'image';
        if (imageWrap) imageWrap.classList.add('is-shown');
      }
    }

    function completeReveal() {
      if (token !== revealToken) return;
      revealRaf = 0;
      revealMeta.animationFrameActive = false;
      applySharedProgress(1);
      var r;
      for (r = 0; r < rows.length; r++) completeRowReveal(rows[r]);
      if (!progressStarted) startProgressFill(panel, state, token);
      if (!imageStarted && imageWrap) imageWrap.classList.add('is-shown');
      panel.classList.remove('is-revealing');
      panel.classList.add('is-complete', 'is-reveal-complete');
      hoverHudMeta.animationStep = 'complete';
    }

    function tick(now) {
      if (token !== revealToken) {
        revealRaf = 0;
        revealMeta.animationFrameActive = false;
        return;
      }
      if (!revealStartTime) revealStartTime = now;
      // linear shared progress — no strong ease-out
      var progress = clamp((now - revealStartTime) / TEXT_REVEAL_MS, 0, 1);
      applySharedProgress(progress);
      if (progress >= 1) {
        completeReveal();
        return;
      }
      revealRaf = requestAnimationFrame(tick);
      revealMeta.animationFrameActive = true;
    }

    applySharedProgress(0);
    revealMeta.animationFrameActive = true;
    revealRaf = requestAnimationFrame(tick);
  }

  function renderContent(evoKey) {
    var panel = ensurePanel();
    if (!isKnownTerritoryKey(evoKey)) {
      console.warn('[TerritoryEvolutionHover] unknown territory key', evoKey);
      hide();
      return false;
    }
    var state = getTerritoryEvolutionState(evoKey);
    var name = resolveTerritoryName(evoKey);
    var src = stageImage(evoKey, state.stage);
    var img = panel.querySelector('[data-tevo-img]');
    var imageWrap = panel.querySelector('[data-tevo-image]');

    resetHudVisualState(panel);

    if (img) {
      if (src) {
        img.hidden = false;
        img.src = src;
        img.alt = name + ' 현재 단계 ' + state.stageLabel;
        img.onerror = function () {
          console.warn('[TerritoryEvolutionHover] failed to load', src);
          if (imageWrap) imageWrap.classList.add('is-broken');
        };
      } else {
        img.removeAttribute('src');
        img.alt = '';
        img.hidden = true;
        console.warn('[TerritoryEvolutionHover] missing image', evoKey, state.stage);
      }
    }

    panel.setAttribute('data-territory', evoKey);
    panel.setAttribute('data-stage', String(state.stage));
    panel.setAttribute('data-has-next', state.hasNextStage ? '1' : '0');
    return true;
  }

  function applyPanelPosition(evoKey, hitPath) {
    var panel = ensurePanel();
    panel.style.visibility = 'hidden';
    panel.classList.add('is-visible');

    var mapRect = getMapRect();
    var anchorRect =
      hitPath && typeof hitPath.getBoundingClientRect === 'function'
        ? hitPath.getBoundingClientRect()
        : mapRect;
    var panelRect = panel.getBoundingClientRect();
    if (!(panelRect.width > 4)) {
      panelRect = { width: DEFAULT_PANEL_W, height: DEFAULT_PANEL_H };
    }
    var pos = getTerritoryEvolutionPanelPosition(evoKey, mapRect, anchorRect, panelRect);

    panel.setAttribute('data-placement', pos.placement);
    panel.classList.remove(
      'is-place-pioneer-right',
      'is-place-guardian-left',
      'is-place-alien-below',
      'is-place-alien-left',
      'is-place-central-right-lower'
    );
    panel.classList.add('is-place-' + pos.placement);
    panel.style.left = pos.left + 'px';
    panel.style.top = pos.top + 'px';
    panel.style.visibility = '';
  }

  function repositionOpenPanel() {
    if (!activeKey || !isMapScreenVisible()) return;
    applyPanelPosition(activeKey, activeHitPath);
  }

  function showImmediate(evoKey, hitPath) {
    if (!global.TERRITORY_EVOLUTION_IMAGES) {
      console.warn('[TerritoryEvolutionHover] TERRITORY_EVOLUTION_IMAGES missing');
      return;
    }
    cancelReveal(false);
    if (!renderContent(evoKey)) return;
    activeKey = evoKey;
    activeHitPath = hitPath || activeHitPath;
    var panel = ensurePanel();
    panel.setAttribute('aria-hidden', 'false');
    applyPanelPosition(evoKey, activeHitPath);
    var state = getTerritoryEvolutionState(evoKey);
    startReveal(panel, evoKey, state);
  }

  function scheduleShow(evoKey, hitPath) {
    cancelReveal(activeKey != null && activeKey !== evoKey);
    hoverHudMeta.pending = true;
    hoverHudMeta.territory = evoKey;
    hoverHudMeta.animationStep = 'pending';
    openTimer = setTimeout(function () {
      openTimer = null;
      if (!isMapScreenVisible()) return;
      showImmediate(evoKey, hitPath);
    }, HOVER_DELAY_MS);
  }

  function show(evoKey, hitPath, forceRefresh) {
    if (forceRefresh && activeKey === evoKey) {
      showImmediate(evoKey, hitPath);
      return;
    }
    scheduleShow(evoKey, hitPath);
  }

  function refreshOpenPanel() {
    if (!activeKey || !isMapScreenVisible()) return false;
    showImmediate(activeKey, activeHitPath);
    return true;
  }

  function getActiveTerritoryKey() {
    return activeKey;
  }

  function hide() {
    cancelReveal(true);
    activeKey = null;
    activeHitPath = null;
    hoverHudMeta.visible = false;
    hoverHudMeta.pending = false;
    hoverHudMeta.territory = null;
    hoverHudMeta.animationStep = 'idle';
    var panel = panelEl || document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove('is-visible', 'is-revealing', 'is-complete');
    panel.setAttribute('aria-hidden', 'true');
    resetHudVisualState(panel);
  }

  function isMapScreenVisible() {
    var screen = document.getElementById('screen-main');
    return !!(screen && !screen.hidden);
  }

  function watchScreen() {
    var screen = document.getElementById('screen-main');
    if (!screen || screenObserver) return;
    screenObserver = new MutationObserver(function () {
      if (!isMapScreenVisible()) hide();
    });
    screenObserver.observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  }

  function bindViewport() {
    if (viewportBound) return;
    viewportBound = true;
    window.addEventListener('resize', repositionOpenPanel);
    window.addEventListener('scroll', repositionOpenPanel, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', repositionOpenPanel);
      window.visualViewport.addEventListener('scroll', repositionOpenPanel);
    }
  }

  function bindHitPath(hitPath, kindOrEvoKey) {
    if (!hitPath || hitPath.dataset.scTevoBound === '1') return;
    var evoKey = KIND_TO_EVO[kindOrEvoKey] || kindOrEvoKey;
    if (!isKnownTerritoryKey(evoKey)) return;
    hitPath.dataset.scTevoBound = '1';
    hitPath.dataset.evolutionKey = evoKey;

    hitPath.addEventListener('pointerenter', function () {
      if (!isMapScreenVisible()) return;
      scheduleShow(evoKey, hitPath);
    });
    hitPath.addEventListener('pointermove', function () {
      if (!isMapScreenVisible()) {
        hide();
        return;
      }
      if (activeKey !== evoKey && !hoverHudMeta.pending) {
        scheduleShow(evoKey, hitPath);
      } else if (hoverHudMeta.pending && hoverHudMeta.territory !== evoKey) {
        scheduleShow(evoKey, hitPath);
      }
    });
    hitPath.addEventListener('pointerleave', function () {
      hide();
    });
    hitPath.addEventListener('click', function () {
      hide();
    });
    hitPath.addEventListener('focus', function () {
      if (!isMapScreenVisible()) return;
      scheduleShow(evoKey, hitPath);
    });
    hitPath.addEventListener('blur', function () {
      hide();
    });
  }

  function bindFromKind(hitPath, kind) {
    watchScreen();
    bindViewport();
    bindHitPath(hitPath, kind);
  }

  function inspectHoverHud() {
    hoverHudMeta.reducedMotion = prefersReducedMotion();
    hoverHudMeta.soundEnabled = isSoundEnabled();
    hoverHudMeta.soundAvailable = typeof global.playScUiTickSound === 'function';
    hoverHudMeta.currentImageOnly = true;
    hoverHudMeta.imageMasked = true;
    hoverHudMeta.panelBorderVisible = false;
    hoverHudMeta.internalCardBorders = false;
    hoverHudMeta.progressAnimated = !hoverHudMeta.reducedMotion;

    var layout = {
      hudWidth: null,
      hudHeight: null,
      textColumnWidth: null,
      imageColumnWidth: null,
      textRatio: null,
      imageRatio: null,
      contentPaddingLeft: null,
      contentPaddingRight: null,
      rowGap: null,
      labelWidth: null,
      imageWrapperHeight: null,
      imageHeightRatio: null,
      availableImageHeight: null,
      imageNaturalWidth: null,
      imageNaturalHeight: null,
      imageAspectRatio: null,
      requiredWidthForFullHeight: null,
      actualRenderedImageWidth: null,
      actualRenderedImageHeight: null,
      renderedHeightRatio: null,
      imageUsesFullHudHeight: false,
      overflowCorrected: false,
      finalPlacementSide: null,
      imageObjectFit: null,
      fadeLeftPercent: 7,
      fadeEdgePercent: 3,
    };
    try {
      var panel = panelEl || document.getElementById(PANEL_ID);
      if (panel && panel.getBoundingClientRect) {
        var pr = panel.getBoundingClientRect();
        layout.hudWidth = Math.round(pr.width * 100) / 100;
        layout.hudHeight = Math.round(pr.height * 100) / 100;
        layout.finalPlacementSide = panel.getAttribute('data-placement') || null;
        var vw = window.innerWidth || document.documentElement.clientWidth || 0;
        layout.overflowCorrected =
          pr.left < SAFE_MARGIN - 0.5 ||
          pr.right > vw - SAFE_MARGIN + 0.5 ||
          pr.top < SAFE_MARGIN - 0.5;
        var content = panel.querySelector('.territory-operation-hud__content');
        var image = panel.querySelector('.territory-operation-hud__image');
        var row = panel.querySelector('.territory-operation-hud__row');
        var label = panel.querySelector('.territory-operation-hud__label');
        var img = panel.querySelector('.territory-operation-hud__img');
        if (content) {
          var cr = content.getBoundingClientRect();
          layout.textColumnWidth = Math.round(cr.width * 100) / 100;
          if (window.getComputedStyle) {
            var ccs = window.getComputedStyle(content);
            layout.contentPaddingLeft = parseFloat(ccs.paddingLeft) || 0;
            layout.contentPaddingRight = parseFloat(ccs.paddingRight) || 0;
          }
        }
        if (image) {
          var ir = image.getBoundingClientRect();
          layout.imageColumnWidth = Math.round(ir.width * 100) / 100;
          layout.imageWrapperHeight = Math.round(ir.height * 100) / 100;
          layout.availableImageHeight = layout.imageWrapperHeight;
          if (layout.hudHeight > 0) {
            layout.imageHeightRatio = Math.round((ir.height / layout.hudHeight) * 1000) / 1000;
          }
        }
        if (layout.hudWidth > 0) {
          if (layout.textColumnWidth != null) {
            layout.textRatio = Math.round((layout.textColumnWidth / layout.hudWidth) * 1000) / 1000;
          }
          if (layout.imageColumnWidth != null) {
            layout.imageRatio = Math.round((layout.imageColumnWidth / layout.hudWidth) * 1000) / 1000;
          }
        }
        if (row && window.getComputedStyle) {
          layout.rowGap = parseFloat(window.getComputedStyle(row).columnGap || window.getComputedStyle(row).gap) || 0;
        }
        if (label) {
          layout.labelWidth = Math.round(label.getBoundingClientRect().width * 100) / 100;
        }
        if (img) {
          if (window.getComputedStyle) {
            layout.imageObjectFit = window.getComputedStyle(img).objectFit || null;
          }
          var nw = Number(img.naturalWidth) || 0;
          var nh = Number(img.naturalHeight) || 0;
          if (nw > 0 && nh > 0) {
            layout.imageNaturalWidth = nw;
            layout.imageNaturalHeight = nh;
            layout.imageAspectRatio = Math.round((nw / nh) * 1000) / 1000;
            if (layout.availableImageHeight > 0) {
              layout.requiredWidthForFullHeight =
                Math.round(layout.availableImageHeight * (nw / nh) * 100) / 100;
            }
          }
          var ibr = img.getBoundingClientRect();
          layout.actualRenderedImageWidth = Math.round(ibr.width * 100) / 100;
          layout.actualRenderedImageHeight = Math.round(ibr.height * 100) / 100;
          if (layout.hudHeight > 0 && layout.actualRenderedImageHeight > 0) {
            layout.renderedHeightRatio =
              Math.round((layout.actualRenderedImageHeight / layout.hudHeight) * 1000) / 1000;
            layout.imageUsesFullHudHeight = layout.renderedHeightRatio >= 0.92;
          }
        }
      }
    } catch (_) {}

    return {
      hoverHud: Object.assign({}, hoverHudMeta, {
        layout: layout,
        reveal: Object.assign({}, revealMeta, {
          revealToken: revealToken,
          animationFrameActive: !!revealRaf || revealMeta.animationFrameActive,
        }),
      }),
    };
  }

  global.TERRITORY_EVOLUTION_STAGE_THRESHOLDS = TERRITORY_EVOLUTION_STAGE_THRESHOLDS;
  global.getTerritoryEvolutionStageByPopulation = getTerritoryEvolutionStageByPopulation;
  global.getTerritoryEvolutionStageRangeLabel = getTerritoryEvolutionStageRangeLabel;
  global.getTerritoryEvolutionNextStageProgress = getTerritoryEvolutionNextStageProgress;
  global.getTerritoryEvolutionState = getTerritoryEvolutionState;
  /** @deprecated 계산 결과 스냅샷. 원천은 TERRITORY_POPULATION_MOCK_SOURCE / live directCounts */
  global.TERRITORY_EVOLUTION_MOCK_STATE = buildLegacyMockStateSnapshot();
  global.TerritoryEvolutionHover = {
    show: show,
    hide: hide,
    refreshOpenPanel: refreshOpenPanel,
    getActiveTerritoryKey: getActiveTerritoryKey,
    bindHitPath: bindFromKind,
    mockSource: global.TERRITORY_POPULATION_MOCK_SOURCE || null,
    mockState: buildLegacyMockStateSnapshot(),
    getTerritoryEvolutionState: getTerritoryEvolutionState,
    getTerritoryEvolutionPanelPosition: getTerritoryEvolutionPanelPosition,
    buildDetailStageCompare: buildDetailStageCompare,
    buildStageCard: buildStageCard,
    buildStageLabel: buildStageLabel,
    inspect: inspectHoverHud,
  };
  global.__scInspectTerritoryEvolutionHover = inspectHoverHud;
})(typeof window !== 'undefined' ? window : globalThis);
