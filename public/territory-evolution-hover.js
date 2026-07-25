/**
 * =============================================================================
 * 센텐스크래프트 — 영토 발전 Hover 패널 (UI 검증용)
 * =============================================================================
 * - TERRITORY_EVOLUTION_IMAGES / STAGE_LABELS 재사용
 * - 인원·집계 정책: territory-evolution-population.js
 * - 단계 = 현재 발전 인원으로 매번 재판정 (상승·하락, highestStage 미사용)
 * - 메인 viewer: 현재 중심 + 좌우 peek
 * - 영토별 고정 슬롯 · pointer 추적 없음 · 히트존/클릭 미변경
 * =============================================================================
 */
(function (global) {
  'use strict';

  var TERRITORY_EVOLUTION_STAGE_THRESHOLDS = [
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
  var activeKey = null;
  var activeHitPath = null;
  var panelEl = null;
  var screenObserver = null;
  var viewportBound = false;

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
      return central + Math.floor(pioneer * 0.3) + Math.floor(guardian * 0.3);
    }
    return 0;
  }

  /**
   * 현재 발전 인원 → 단계.
   * previousStage / highestStage 보정 없음. 인원 감소 시 단계 하락.
   */
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

  /**
   * 현재 단계 구간 기준 다음 단계 필요 인원·진행률.
   * 임계값은 TERRITORY_EVOLUTION_STAGE_THRESHOLDS만 사용.
   */
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

  /**
   * 최종 발전 상태.
   * stage는 항상 현재 발전 인원에서만 계산 (하락 허용).
   */
  function getTerritoryEvolutionState(territoryKey, populationSource) {
    var population = getTerritoryEvolutionPopulation(territoryKey, populationSource);
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

  /** 구 Mock 형태 호환 스냅샷 { stage, population } */
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

  /** 접힌 avatar-dock 전체 박스 대신, 보이는 탭/펼침 패널만 피한다. */
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

  /**
   * 고정 UI와 겹치면 Y를 우선 보정하고, 필요할 때만 X를 최소로 민다.
   */
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

    left = clamp(left, SAFE_MARGIN, Math.max(SAFE_MARGIN, vw - panelWidth - SAFE_MARGIN));
    top = clamp(top, SAFE_MARGIN, Math.max(SAFE_MARGIN, vh - panelHeight - SAFE_MARGIN));
    return { left: left, top: top };
  }

  /**
   * 영토별 고정 슬롯 좌표 (포인터 추적 없음).
   * @returns {{ left: number, top: number, placement: string }}
   */
  function getTerritoryEvolutionPanelPosition(territoryKey, mapRect, anchorRect, panelRect) {
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var panelWidth = panelRect.width || 500;
    var panelHeight = panelRect.height || 360;
    var left = SAFE_MARGIN;
    var top = SAFE_MARGIN;
    var placement = 'fallback';
    var preferLeftSlot = false;

    var map = mapRect || getMapRect();

    if (territoryKey === 'pioneer') {
      placement = 'pioneer-right';
      left = map.right - panelWidth * 0.5;
      top = map.top + (map.height - panelHeight) / 2;
    } else if (territoryKey === 'guardian') {
      placement = 'guardian-left';
      preferLeftSlot = true;
      left = map.left - panelWidth * 0.5;
      top = map.top + 40;
    } else if (territoryKey === 'alien') {
      placement = 'alien-left';
      preferLeftSlot = true;
      left = map.left - panelWidth * 0.5;
      top = map.top + 60;
    } else if (territoryKey === 'central') {
      placement = 'central-right-lower';
      left = map.right - panelWidth * 0.5;
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
      '<div class="sc-tevo-hover__head">' +
      '<div class="sc-tevo-hover__name" data-tevo-name></div>' +
      '<div class="sc-tevo-hover__pop" data-tevo-pop></div>' +
      '<div class="sc-tevo-hover__stage" data-tevo-stage></div>' +
      '<div class="sc-tevo-hover__range" data-tevo-range></div>' +
      '<div class="sc-tevo-hover__progress" data-tevo-progress>' +
      '<div class="sc-tevo-hover__progress-copy">' +
      '<span class="sc-tevo-hover__progress-target" data-tevo-progress-target></span>' +
      '<strong class="sc-tevo-hover__progress-remaining" data-tevo-progress-remaining></strong>' +
      '</div>' +
      '<div class="sc-tevo-hover__progress-track" data-tevo-progress-track role="progressbar" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="sc-tevo-hover__progress-fill" data-tevo-progress-fill></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="sc-tevo-hover__viewer" data-tevo-viewer></div>'
    );
  }

  function ensurePanel() {
    if (panelEl && panelEl.isConnected) {
      if (
        !panelEl.querySelector('[data-tevo-viewer]') ||
        !panelEl.querySelector('[data-tevo-progress]')
      ) {
        panelEl.innerHTML = panelMarkup();
      }
      return panelEl;
    }
    var existing = document.getElementById(PANEL_ID);
    if (existing) {
      panelEl = existing;
      if (
        !panelEl.querySelector('[data-tevo-viewer]') ||
        !panelEl.querySelector('[data-tevo-progress]')
      ) {
        panelEl.innerHTML = panelMarkup();
      }
      return panelEl;
    }
    var el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'sc-tevo-hover';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = panelMarkup();
    document.body.appendChild(el);
    panelEl = el;
    return panelEl;
  }

  function buildStageCard(role, evoKey, stage, name) {
    var src = stageImage(evoKey, stage);
    var era = stageLabel(evoKey, stage);
    var roleText = ROLE_LABELS[role] || role;
    var card = document.createElement('div');
    card.className = 'sc-tevo-hover__card sc-tevo-hover__card--' + role;
    card.setAttribute('data-tevo-role', role);

    var wrap = document.createElement('div');
    wrap.className = 'sc-tevo-hover__img-wrap';

    if (!src) {
      card.classList.add('is-empty');
      wrap.innerHTML = '<div class="sc-tevo-hover__missing">이미지 없음</div>';
      console.warn('[TerritoryEvolutionHover] missing image', evoKey, stage);
    } else {
      var img = document.createElement('img');
      img.className = 'sc-tevo-hover__img';
      img.src = src;
      img.alt = name + ' ' + roleText + ' ' + era;
      img.draggable = false;
      img.decoding = 'async';
      img.loading = 'eager';
      img.onerror = function () {
        console.warn('[TerritoryEvolutionHover] failed to load', src);
        card.classList.add('is-broken');
      };
      wrap.appendChild(img);
    }

    card.appendChild(wrap);
    return card;
  }

  /** viewer 상단 공통 2줄 안내 (전단계 / 현재 단계 / 다음단계) */
  function buildStageLabel(side, evoKey, stage) {
    var el = document.createElement('div');
    el.className = 'sc-tevo-hover__stage-label sc-tevo-hover__stage-label--' + side;
    el.setAttribute('data-tevo-stage-label', side);

    var role = document.createElement('strong');
    role.className = 'sc-tevo-hover__stage-label-role';
    if (side === 'prev') role.textContent = '← 전단계';
    else if (side === 'next') role.textContent = '다음단계 →';
    else role.textContent = ROLE_LABELS.current;

    var name = document.createElement('span');
    name.className = 'sc-tevo-hover__stage-label-name';
    name.textContent = stageLabel(evoKey, stage);

    el.appendChild(role);
    el.appendChild(name);
    return el;
  }

  function renderContent(evoKey) {
    var panel = ensurePanel();
    if (!isKnownTerritoryKey(evoKey)) {
      console.warn('[TerritoryEvolutionHover] unknown territory key', evoKey);
      hide();
      return false;
    }
    var state = getTerritoryEvolutionState(evoKey);
    var stage = state.stage;
    var name = resolveTerritoryName(evoKey);
    var nameEl = panel.querySelector('[data-tevo-name]');
    var popEl = panel.querySelector('[data-tevo-pop]');
    var stageEl = panel.querySelector('[data-tevo-stage]');
    var rangeEl = panel.querySelector('[data-tevo-range]');
    var progressRoot = panel.querySelector('[data-tevo-progress]');
    var progressTarget = panel.querySelector('[data-tevo-progress-target]');
    var progressRemaining = panel.querySelector('[data-tevo-progress-remaining]');
    var progressTrack = panel.querySelector('[data-tevo-progress-track]');
    var progressFill = panel.querySelector('[data-tevo-progress-fill]');
    var viewerEl = panel.querySelector('[data-tevo-viewer]');

    if (nameEl) nameEl.textContent = name;
    if (popEl) popEl.textContent = '발전 인원수 ' + formatPopulation(state.population) + '명';
    if (stageEl) stageEl.textContent = '현재 단계 ' + state.stageLabel;
    if (rangeEl) rangeEl.textContent = '단계 기준 ' + state.rangeLabel;

    if (progressRoot) {
      progressRoot.classList.toggle('sc-tevo-hover__progress--complete', !state.hasNextStage);
      if (!state.hasNextStage) {
        if (progressTarget) progressTarget.textContent = '';
        if (progressRemaining) {
          progressRemaining.textContent = '최고 단계 ' + state.stageLabel + ' 달성';
        }
        if (progressTrack) {
          progressTrack.hidden = true;
          progressTrack.removeAttribute('aria-valuenow');
          progressTrack.removeAttribute('aria-label');
        }
        if (progressFill) progressFill.style.width = '100%';
      } else {
        var pctRounded = Math.round(state.progressPercent);
        if (progressTarget) {
          progressTarget.textContent = '다음 단계 ' + state.nextStageLabel + '까지';
        }
        if (progressRemaining) {
          progressRemaining.textContent =
            '발전 인원 ' + formatPopulation(state.remainingPopulation) + '명 필요';
        }
        if (progressTrack) {
          progressTrack.hidden = false;
          progressTrack.setAttribute('aria-valuenow', String(pctRounded));
          progressTrack.setAttribute(
            'aria-label',
            '다음 단계 ' + state.nextStageLabel + '까지 진행률 ' + pctRounded + '%'
          );
        }
        if (progressFill) {
          progressFill.style.width = clamp(state.progressPercent, 0, 100) + '%';
        }
      }
    }

    if (viewerEl) {
      while (viewerEl.firstChild) viewerEl.removeChild(viewerEl.firstChild);
      viewerEl.className = 'sc-tevo-hover__viewer';
      if (stage <= 1) viewerEl.classList.add('is-first');
      else if (stage >= 6) viewerEl.classList.add('is-last');
      else viewerEl.classList.add('is-mid');

      if (stage > 1) {
        viewerEl.appendChild(buildStageLabel('prev', evoKey, stage - 1));
        viewerEl.appendChild(buildStageCard('prev', evoKey, stage - 1, name));
      }
      viewerEl.appendChild(buildStageLabel('current', evoKey, stage));
      viewerEl.appendChild(buildStageCard('current', evoKey, stage, name));
      if (stage < 6) {
        viewerEl.appendChild(buildStageCard('next', evoKey, stage + 1, name));
        viewerEl.appendChild(buildStageLabel('next', evoKey, stage + 1));
      }
    }
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

  function show(evoKey, hitPath) {
    if (!global.TERRITORY_EVOLUTION_IMAGES) {
      console.warn('[TerritoryEvolutionHover] TERRITORY_EVOLUTION_IMAGES missing');
      return;
    }
    if (activeKey !== evoKey) {
      if (!renderContent(evoKey)) return;
      activeKey = evoKey;
    }
    activeHitPath = hitPath || activeHitPath;
    var panel = ensurePanel();
    panel.setAttribute('aria-hidden', 'false');
    applyPanelPosition(evoKey, activeHitPath);
  }

  function hide() {
    activeKey = null;
    activeHitPath = null;
    var panel = panelEl || document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove('is-visible');
    panel.setAttribute('aria-hidden', 'true');
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
      show(evoKey, hitPath);
    });
    hitPath.addEventListener('pointermove', function () {
      if (!isMapScreenVisible()) {
        hide();
        return;
      }
      if (activeKey !== evoKey) {
        show(evoKey, hitPath);
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
      show(evoKey, hitPath);
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
    bindHitPath: bindFromKind,
    mockSource: global.TERRITORY_POPULATION_MOCK_SOURCE || null,
    mockState: buildLegacyMockStateSnapshot(),
    getTerritoryEvolutionState: getTerritoryEvolutionState,
    getTerritoryEvolutionPanelPosition: getTerritoryEvolutionPanelPosition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
