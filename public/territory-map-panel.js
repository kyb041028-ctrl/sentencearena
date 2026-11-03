/**
 * 영토 지도 레이아웃: 지도 아래 영토 카드 4장 + 오른쪽 선택 영토 상세 패널.
 * 데이터·단계·인구 계산은 기존 getTerritoryEvolutionState / TERRITORY_EVOLUTION_IMAGES를 그대로 읽기만 한다.
 */
(function (global) {
  'use strict';

  var ORDER = ['pioneer', 'central', 'guardian', 'alien'];
  var NAMES = { pioneer: '진보영토', central: '중앙광장', guardian: '보수영토', alien: '외계영토' };
  var KIND = { pioneer: 'PROGRESSIVE', central: 'COMMON', guardian: 'CONSERVATIVE', alien: 'KANTAPBIYA' };
  var KIND_TO_KEY = { PROGRESSIVE: 'pioneer', COMMON: 'central', CONSERVATIVE: 'guardian', KANTAPBIYA: 'alien' };
  var DEFAULT_KEY = 'central';

  var selected = DEFAULT_KEY;
  var mounted = false;
  var zonesObserver = null;

  function $(id) {
    return global.document.getElementById(id);
  }

  function fmt(n) {
    if (n == null || !isFinite(Number(n))) return '—';
    try {
      return Math.round(Number(n)).toLocaleString('ko-KR');
    } catch (_) {
      return String(Math.round(Number(n)));
    }
  }

  function readState(key) {
    if (typeof global.getTerritoryEvolutionState !== 'function') return null;
    try {
      return global.getTerritoryEvolutionState(key);
    } catch (e) {
      return null;
    }
  }

  function stageText(st) {
    if (!st || st.stage == null) return '집계 중';
    return st.stageLabel ? st.stageLabel : '단계 ' + st.stage;
  }

  function isLivePopulation(st) {
    if (!st || st.population == null || st.usingMock) return false;
    if (st.dataStatus !== 'READY') return false;
    if (
      typeof global.isTerritoryEvolutionUsingMockSource === 'function' &&
      global.isTerritoryEvolutionUsingMockSource()
    ) {
      return false;
    }
    return true;
  }

  function populationPhrase(st) {
    if (!st || st.population == null) return '집계 중';
    var text = fmt(st.population) + '명';
    if (!isLivePopulation(st)) text += ' · 폴백';
    return text;
  }

  function stageImage(key, st) {
    var images = global.TERRITORY_EVOLUTION_IMAGES;
    if (!images || !images[key] || !st || st.stage == null) return null;
    return images[key][st.stage] || null;
  }

  function renderCards() {
    ORDER.forEach(function (key) {
      var card = global.document.querySelector('[data-sc-tcard="' + key + '"]');
      if (!card) return;
      var st = readState(key);
      var stage = card.querySelector('[data-sc-tcard-stage]');
      var pop = card.querySelector('[data-sc-tcard-pop]');
      if (stage) stage.textContent = stageText(st);
      if (pop) pop.textContent = populationPhrase(st);
      var on = key === selected;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderDetail() {
    var root = $('sc-territory-detail');
    if (!root) return;
    var st = readState(selected);
    var name = NAMES[selected];
    root.setAttribute('data-territory', selected);

    var nameEl = root.querySelector('[data-sc-tdetail-name]');
    var stageEl = root.querySelector('[data-sc-tdetail-stage]');
    var popEl = root.querySelector('[data-sc-tdetail-pop]');
    var popLabel = root.querySelector('[data-sc-tdetail-pop-label]');
    var sourceEl = root.querySelector('[data-sc-tdetail-source]');
    var live = isLivePopulation(st);
    var nextEl = root.querySelector('[data-sc-tdetail-next]');
    var pctEl = root.querySelector('[data-sc-tdetail-pct]');
    var bar = root.querySelector('[data-sc-tdetail-bar]');
    var fill = root.querySelector('[data-sc-tdetail-fill]');
    var img = root.querySelector('[data-sc-tdetail-img]');
    var imgWrap = root.querySelector('[data-sc-tdetail-image]');

    if (nameEl) nameEl.textContent = name;
    if (stageEl) stageEl.textContent = stageText(st);
    if (popLabel) popLabel.textContent = live ? '실제 인구' : '인구';
    if (popEl) popEl.textContent = st && st.population != null ? fmt(st.population) + '명' : '집계 중';
    if (sourceEl) {
      if (live) {
        sourceEl.hidden = true;
        sourceEl.textContent = '';
      } else if (st && st.population != null) {
        sourceEl.hidden = false;
        sourceEl.textContent = '운영 인구 연결 없음. 로컬 폴백 수치입니다.';
      } else {
        sourceEl.hidden = false;
        sourceEl.textContent = '운영 인구 연결 없음.';
      }
    }

    var ready = !!(st && st.stage != null);
    var pct = ready && st.progressPercent != null ? Math.max(0, Math.min(100, Number(st.progressPercent))) : null;
    if (nextEl) {
      if (!ready) nextEl.textContent = '집계 중';
      else if (!st.hasNextStage) nextEl.textContent = '최고 단계';
      else nextEl.textContent = fmt(st.remainingPopulation) + '명 더 필요';
    }
    if (pctEl) pctEl.textContent = pct == null ? '—' : Math.round(pct) + '%';
    if (fill) fill.style.width = (pct == null ? 0 : pct) + '%';
    if (bar) {
      bar.setAttribute('aria-valuenow', pct == null ? '0' : String(Math.round(pct)));
      bar.setAttribute('aria-label', name + ' 발전 진행');
    }

    var src = stageImage(selected, st);
    if (img) {
      if (imgWrap) imgWrap.classList.remove('is-broken');
      if (src) {
        img.hidden = false;
        img.onerror = function () {
          if (imgWrap) imgWrap.classList.add('is-broken');
        };
        if (img.getAttribute('src') !== src) img.src = src;
        img.alt = name + ' 현재 단계 ' + stageText(st);
      } else {
        img.removeAttribute('src');
        img.alt = '';
        img.hidden = true;
      }
    }
  }

  function markZones() {
    var hits = global.document.querySelectorAll('#territory-hit-zones .territory-hit-zone__hit');
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      var key = h.dataset.evolutionKey;
      var g = h.parentNode;
      if (!g || !g.classList) continue;
      var on = key === selected;
      g.classList.toggle('is-selected', on);
      if (on) h.setAttribute('aria-current', 'true');
      else h.removeAttribute('aria-current');
    }
  }

  function render() {
    renderCards();
    renderDetail();
    markZones();
  }

  function select(key) {
    if (ORDER.indexOf(key) < 0) return false;
    selected = key;
    render();
    return true;
  }

  function selectKind(kind) {
    return select(KIND_TO_KEY[kind]);
  }

  function enterBoard() {
    if (global.__scApp && typeof global.__scApp.goBoard === 'function') global.__scApp.goBoard(KIND[selected]);
  }

  function mount() {
    if (mounted) return;
    var cards = $('sc-territory-cards');
    var detail = $('sc-territory-detail');
    if (!cards || !detail) return;
    mounted = true;

    ORDER.forEach(function (key) {
      var card = cards.querySelector('[data-sc-tcard="' + key + '"]');
      if (card) {
        card.addEventListener('click', function () {
          select(key);
        });
      }
    });
    var enter = detail.querySelector('[data-sc-tdetail-enter]');
    if (enter) enter.addEventListener('click', enterBoard);

    var root = $('territory-hit-zones-root');
    if (root && typeof global.MutationObserver === 'function') {
      zonesObserver = new global.MutationObserver(markZones);
      zonesObserver.observe(root, { childList: true });
    }

    var hover = global.TerritoryEvolutionHover;
    if (hover && typeof hover.refreshOpenPanel === 'function' && !hover.__scMapPanelWrapped) {
      var orig = hover.refreshOpenPanel;
      hover.refreshOpenPanel = function () {
        var r = orig.apply(this, arguments);
        render();
        return r;
      };
      hover.__scMapPanelWrapped = true;
    }

    render();
  }

  global.SCTerritoryMapPanel = {
    select: select,
    selectKind: selectKind,
    refresh: render,
    getSelected: function () {
      return selected;
    },
    isMounted: function () {
      return mounted;
    },
  };

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
