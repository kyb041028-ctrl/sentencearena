/**
 * 개발 전용 지도 배치 편집.
 * localhost / 127.0.0.1 에서만 버튼이 생긴다.
 * 저장은 이 브라우저 localStorage 뿐이다.
 * 편집 중에는 화면 밖이어도 숫자를 줄이지 않고, 벗어난 px만 보여 준다.
 * 일반 모드에서도 저장한 픽셀을 줄이지 않는다.
 * 지도 세로는 가로의 16:9. 지도 안을 드래그하지 않는다.
 * 가로는 테두리 포함이다. 내용 너비로 바꿔 저장하지 않는다.
 * 음수 간격은 칸 간격 속성이 받지 않는다. 저장한 간격과 좌우 위치는 유지하고 가장자리 거리만 보정한다.
 */
(function (root) {
  'use strict';

  var KEY = 'sc.mapLayoutEditor.v1';
  var PROPS = [
    '--sc-lay-map-margin',
    '--sc-lay-map-w',
    '--sc-lay-map-x',
    '--sc-lay-side',
    '--sc-lay-cards-w',
    '--sc-lay-cards-h',
    '--sc-lay-cards-min',
    '--sc-lay-cards-gap',
    '--sc-lay-cards-pad-y',
    '--sc-lay-cards-pad-x',
    '--sc-lay-cards-align',
    '--sc-lay-cards-x',
    '--sc-lay-cards-y',
    '--sc-lay-detail-w',
    '--sc-lay-detail-h',
    '--sc-lay-detail-img',
    '--sc-lay-detail-pad',
    '--sc-lay-detail-gap',
    '--sc-lay-detail-gap-fix',
    '--sc-lay-detail-align',
    '--sc-lay-detail-x',
    '--sc-lay-detail-y'
  ];

  function blank() {
    return {
      v: 1,
      mapW: '1139',
      mapWU: 'px',
      mapX: '-181',
      margin: '',
      cardsMatch: true,
      cardsW: '1139',
      cardsWU: 'px',
      cardsH: '100',
      cardsX: '',
      cardsY: '',
      cardsGap: '',
      cardsPad: '',
      detailW: '655',
      detailWU: 'px',
      detailH: '635',
      detailHU: 'px',
      detailImg: '370',
      detailImgU: 'px',
      detailPad: '',
      detailGap: '-71',
      detailAlign: 'start',
      detailX: '-162',
      detailY: '1',
      actX: '1226',
      actY: '726',
      actW: '613',
      actH: '96',
      actHold: '258'
    };
  }

  function sameState(a, b) {
    if (!a || !b) return false;
    var keys = Object.keys(blank());
    for (var i = 0; i < keys.length; i++) {
      if (String(a[keys[i]]) !== String(b[keys[i]])) return false;
    }
    return true;
  }

  function isLocalHost() {
    var host = root.location && root.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  function isPc() {
    return root.matchMedia('(min-width: 900px)').matches;
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function signed(v) {
    var n = parseFloat(v);
    return isFinite(n) ? Math.round(n) : 0;
  }

  function fromUnit(n, unit, base) {
    var v = num(n, 0);
    if (v < 0) v = 0;
    if (unit === '%') return Math.round((base * v) / 100);
    return Math.round(v);
  }

  function heroEl() {
    return document.querySelector('#screen-main .territory-centrist-hero');
  }

  function frameEl() {
    return document.querySelector('#screen-main .territory-centrist-hero__frame--island-map');
  }

  function cardsEl() {
    return document.getElementById('sc-territory-cards');
  }

  function detailEl() {
    return document.getElementById('sc-territory-detail');
  }

  function stackEl() {
    return document.getElementById('sc-left-side-stack');
  }

  function activityEl() {
    return document.getElementById('sc-activity-feed-panel');
  }

  function clearProps(hero) {
    if (!hero) return;
    for (var i = 0; i < PROPS.length; i++) hero.style.removeProperty(PROPS[i]);
    hero.style.columnGap = '';
    hero.removeAttribute('data-sc-lay-img');
    hero.removeAttribute('data-sc-lay-fixed');
    var detail = detailEl();
    if (detail) detail.style.marginLeft = '';
  }

  function activityOwned(s) {
    if (!s) return false;
    return s.actX !== '' || s.actY !== '' || s.actW !== '' || s.actH !== '';
  }

  function visibleBox(el) {
    if (!el) return null;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    var r = el.getBoundingClientRect();
    if (!(r.width > 2 && r.height > 2)) return null;
    return r;
  }

  function safeBox() {
    var screen = document.getElementById('screen-main') || document.documentElement;
    var sr = screen.getBoundingClientRect();
    var bottom = Math.min(sr.bottom, root.innerHeight || sr.bottom);
    var right = Math.min(sr.right, root.innerWidth || sr.right);
    var profile = document.getElementById('avatar-dock-tab');
    if (profile) {
      var pr = profile.getBoundingClientRect();
      if (pr.height > 2 && pr.top > 0) bottom = Math.min(bottom, pr.top - 4);
    }
    return {
      left: Math.max(sr.left, 0) + 2,
      top: Math.max(sr.top, 0) + 2,
      right: right - 2,
      bottom: bottom
    };
  }

  function measureOverflow(includeActivity) {
    var box = safeBox();
    var list = [
      ['지도', frameEl()],
      ['카드', cardsEl()],
      ['상세', detailEl()]
    ];
    if (includeActivity) list.push(['최근 활동', activityEl()]);
    var over = { l: 0, r: 0, t: 0, b: 0, parts: [] };
    for (var i = 0; i < list.length; i++) {
      var r = visibleBox(list[i][1]);
      if (!r) continue;
      var l = Math.max(0, box.left - r.left);
      var ri = Math.max(0, r.right - box.right);
      var t = Math.max(0, box.top - r.top);
      var b = Math.max(0, r.bottom - box.bottom);
      if (l > 2) over.parts.push(list[i][0] + ' 왼쪽 ' + Math.round(l) + 'px');
      if (ri > 2) over.parts.push(list[i][0] + ' 오른쪽 ' + Math.round(ri) + 'px');
      if (t > 2) over.parts.push(list[i][0] + ' 위 ' + Math.round(t) + 'px');
      if (b > 2) over.parts.push(list[i][0] + ' 아래 ' + Math.round(b) + 'px');
      over.l = Math.max(over.l, l);
      over.r = Math.max(over.r, ri);
      over.t = Math.max(over.t, t);
      over.b = Math.max(over.b, b);
    }
    return over;
  }

  function syncHits() {
    if (typeof root.__scSyncTerritoryHitZonesFit === 'function') root.__scSyncTerritoryHitZonesFit();
  }

  var state = blank();
  var savedRaw = '';
  var notes = [];
  var editing = false;
  var ui = {};

  function hasOverride(s) {
    return !!(
      s.mapW ||
      s.mapX ||
      s.margin ||
      s.cardsW ||
      s.cardsH ||
      s.cardsX ||
      s.cardsY ||
      s.cardsGap ||
      s.cardsPad ||
      s.detailW ||
      s.detailH ||
      s.detailImg ||
      s.detailPad ||
      s.detailGap ||
      s.detailX ||
      s.detailY ||
      (s.detailAlign && s.detailAlign !== 'start') ||
      s.cardsMatch === false ||
      activityOwned(s)
    );
  }

  function applyActivity(s) {
    var stack = stackEl();
    var panel = activityEl();
    if (!stack || !panel) return;
    root.__scMapLayoutOwnsActivity = true;
    stack.classList.remove('is-insufficient', 'is-view-hidden');
    stack.removeAttribute('hidden');
    var left = s.actX === '' ? 12 : signed(s.actX);
    var top = s.actY === '' ? 80 : signed(s.actY);
    var width = s.actW === '' ? 230 : Math.max(1, signed(s.actW));
    stack.style.left = left + 'px';
    stack.style.top = top + 'px';
    stack.style.bottom = 'auto';
    stack.style.width = width + 'px';
    stack.style.maxWidth = width + 'px';
    stack.classList.toggle('sc-activity-placed', s.actX !== '' || s.actY !== '');
    if (panel.classList.contains('is-collapsed')) {
      panel.style.height = 'auto';
      panel.style.maxHeight = 'none';
    } else if (s.actH !== '') {
      var h = Math.max(1, signed(s.actH));
      panel.style.height = h + 'px';
      panel.style.maxHeight = h + 'px';
    } else {
      panel.style.height = '';
      panel.style.maxHeight = '';
    }
  }

  function applyHeldSide() {
    var hero = heroEl();
    if (!hero || state.actHold === '') return;
    hero.style.setProperty('--sc-lay-side', Math.max(0, signed(state.actHold)) + 'px');
  }

  function applySideReserve() {
    var hero = heroEl();
    var stack = stackEl();
    if (!hero) return;
    if (!stack || !root.__scMapLayoutOwnsActivity) {
      hero.style.removeProperty('--sc-lay-side');
      return;
    }
    var sr = stack.getBoundingClientRect();
    var hr = hero.getBoundingClientRect();
    if (!(sr.width > 4 && sr.height > 4)) {
      hero.style.removeProperty('--sc-lay-side');
      return;
    }
    var cx = sr.left + sr.width / 2;
    if (cx > (root.innerWidth || 1) * 0.45) {
      hero.style.removeProperty('--sc-lay-side');
      return;
    }
    var reserve = Math.max(0, Math.round(sr.right - hr.left + 12));
    if (reserve > 0) hero.style.setProperty('--sc-lay-side', reserve + 'px');
    else hero.style.removeProperty('--sc-lay-side');
  }

  function dockDefaultActivity() {
    if (activityOwned(state) || !isPc()) return;
    if (document.body.classList.contains('sc-profile-layout-editor-active')) return;
    if (typeof root.__scGetActivityPanelPos === 'function' && root.__scGetActivityPanelPos()) return;
    var stack = stackEl();
    var hero = heroEl();
    var main = document.getElementById('screen-main');
    if (!stack || !hero || !main || main.hidden) return;
    if (stack.classList.contains('is-view-hidden') || stack.hasAttribute('hidden')) return;
    var frame = frameEl();
    var top = frame ? Math.round(frame.getBoundingClientRect().top) : 76;
    stack.classList.remove('is-insufficient');
    stack.style.left = '12px';
    stack.style.top = top + 'px';
    stack.style.bottom = 'auto';
    stack.style.width = '230px';
    stack.style.maxWidth = '230px';
    var sr = stack.getBoundingClientRect();
    var hr = hero.getBoundingClientRect();
    var reserve = Math.max(0, Math.round(sr.right - hr.left + 12));
    if (reserve > 0) hero.style.setProperty('--sc-lay-side', reserve + 'px');
    else hero.style.removeProperty('--sc-lay-side');
  }

  function releaseActivity() {
    root.__scMapLayoutOwnsActivity = false;
    var stack = stackEl();
    var panel = activityEl();
    if (stack) {
      stack.style.left = '';
      stack.style.top = '';
      stack.style.width = '';
      stack.style.maxWidth = '';
      stack.style.bottom = '';
      stack.classList.remove('sc-activity-placed');
    }
    if (panel) {
      panel.style.height = '';
      panel.style.maxHeight = '';
    }
    var hero = heroEl();
    if (hero) hero.style.removeProperty('--sc-lay-side');
    if (typeof root.__scSyncLeftActivityRail === 'function') root.__scSyncLeftActivityRail();
  }

  function nudgeActivity() {
    if (!activityOwned(state)) return;
    var stack = stackEl();
    var panel = activityEl();
    if (!stack || !panel) return;
    var box = safeBox();
    var r = stack.getBoundingClientRect();
    if (!(r.width > 2)) return;
    var width = r.width;
    var maxW = Math.max(120, box.right - box.left - 8);
    if (width > maxW) {
      width = maxW;
      stack.style.width = Math.round(width) + 'px';
      stack.style.maxWidth = stack.style.width;
      r = stack.getBoundingClientRect();
    }
    var h = r.height;
    if (!panel.classList.contains('is-collapsed') && h > box.bottom - box.top - 8) {
      var fitH = Math.max(48, Math.round(box.bottom - box.top - 8));
      panel.style.height = fitH + 'px';
      panel.style.maxHeight = fitH + 'px';
    }
  }

  function applyRegions(hero, autoMap) {
    if (state.margin !== '') hero.style.setProperty('--sc-lay-map-margin', Math.max(0, signed(state.margin)) + 'px');
    if (state.mapX !== '') hero.style.setProperty('--sc-lay-map-x', signed(state.mapX) + 'px');
    if (state.detailGap !== '') {
      hero.style.setProperty('--sc-lay-detail-gap', signed(state.detailGap) + 'px');
    }
    if (state.detailW !== '') {
      hero.style.setProperty('--sc-lay-detail-w', fromUnit(state.detailW, state.detailWU, autoMap || 800) + 'px');
    }
    if (state.detailPad !== '') hero.style.setProperty('--sc-lay-detail-pad', Math.max(0, signed(state.detailPad)) + 'px');
    if (state.detailAlign) hero.style.setProperty('--sc-lay-detail-align', state.detailAlign);
    if (state.detailX !== '') hero.style.setProperty('--sc-lay-detail-x', signed(state.detailX) + 'px');
    if (state.detailY !== '') hero.style.setProperty('--sc-lay-detail-y', signed(state.detailY) + 'px');
    if (state.cardsGap !== '') hero.style.setProperty('--sc-lay-cards-gap', Math.max(0, signed(state.cardsGap)) + 'px');
    if (state.cardsPad !== '') {
      var pad = Math.max(0, signed(state.cardsPad)) + 'px';
      hero.style.setProperty('--sc-lay-cards-pad-y', pad);
      hero.style.setProperty('--sc-lay-cards-pad-x', pad);
    }
    var mapX = state.mapX === '' ? 0 : signed(state.mapX);
    if (state.cardsMatch !== false) hero.style.setProperty('--sc-lay-cards-x', mapX + 'px');
    else if (state.cardsX !== '') hero.style.setProperty('--sc-lay-cards-x', signed(state.cardsX) + 'px');
    if (state.cardsY !== '') hero.style.setProperty('--sc-lay-cards-y', signed(state.cardsY) + 'px');
    if (state.cardsW !== '') {
      hero.style.setProperty('--sc-lay-cards-w', fromUnit(state.cardsW, state.cardsWU, autoMap || 800) + 'px');
    }
    if (state.cardsH !== '') {
      var ch = Math.max(1, signed(state.cardsH));
      hero.style.setProperty('--sc-lay-cards-h', ch + 'px');
      hero.style.setProperty('--sc-lay-cards-min', ch + 'px');
    }
    if (state.detailH !== '') hero.style.setProperty('--sc-lay-detail-h', Math.max(1, signed(state.detailH)) + 'px');
    if (state.detailImg !== '') {
      hero.style.setProperty('--sc-lay-detail-img', fromUnit(state.detailImg, state.detailImgU, 220) + 'px');
      hero.setAttribute('data-sc-lay-img', 'fixed');
    }
    if (state.mapW !== '') {
      hero.style.setProperty('--sc-lay-map-w', fromUnit(state.mapW, state.mapWU, autoMap || 800) + 'px');
    } else if (state.detailW !== '') {
      hero.style.setProperty('--sc-lay-map-w', Math.max(1, Math.round(autoMap || 0)) + 'px');
    }
    if (state.mapW !== '' || state.detailW !== '') hero.setAttribute('data-sc-lay-fixed', '1');
    snapDetailGap(hero);
  }

  function snapDetailGap(hero) {
    if (!hero || state.detailGap === '') return;
    var frame = frameEl();
    var detail = detailEl();
    if (!frame || !detail) return;
    var target = signed(state.detailGap);
    var gap = Math.round(detail.getBoundingClientRect().left - frame.getBoundingClientRect().right);
    var delta = target - gap;
    if (!delta) return;
    var detailX = state.detailX === '' ? 0 : signed(state.detailX);
    var usedMargin = parseFloat(getComputedStyle(detail).marginLeft);
    if (!isFinite(usedMargin)) usedMargin = detailX;
    hero.style.setProperty('--sc-lay-detail-gap-fix', Math.round(usedMargin - detailX + delta) + 'px');
  }

  function commit(next) {
    state = Object.assign(blank(), next || state);
    notes = [];
    var hero = heroEl();
    if (!hero) return state;
    if (!isPc()) {
      clearProps(hero);
      if (root.__scMapLayoutOwnsActivity) releaseActivity();
      syncHits();
      paintStatus();
      return state;
    }
    clearProps(hero);
    if (activityOwned(state)) {
      applyActivity(state);
      if (!editing) nudgeActivity();
      if (state.actX !== '' || state.actY !== '') applyHeldSide();
      else applySideReserve();
    } else if (root.__scMapLayoutOwnsActivity) {
      releaseActivity();
    } else {
      dockDefaultActivity();
    }
    var frame = frameEl();
    var autoMap = frame ? frame.offsetWidth : 800;
    // 편집을 꺼도 저장한 픽셀을 줄이지 않는다. 편집 화면과 같은 크기를 쓴다.
    applyRegions(hero, autoMap);
    if (editing) {
      var over = measureOverflow(true);
      if (over.parts.length) notes.push('화면 밖 ' + over.parts.join(', ') + '.');
    }
    syncHits();
    paintStatus();
    return state;
  }

  function snapshotCss() {
    var hero = heroEl();
    var frame = frameEl();
    var cards = cardsEl();
    var detail = detailEl();
    if (!hero || !frame || !cards || !detail) return '';
    var cs = getComputedStyle(hero);
    function prop(name) {
      return (cs.getPropertyValue(name) || '').trim();
    }
    var visual = Math.round(detail.getBoundingClientRect().left - frame.getBoundingClientRect().right);
    var lines = [
      '/* 저장한 배치. 내용 너비(clientWidth)를 변수에 넣지 않는다.',
      '   지도 테두리 포함 ' + frame.offsetWidth + 'px, 내용 ' + frame.clientWidth + 'px.',
      '   설명 테두리 포함 ' + detail.offsetWidth + 'px, 내용 ' + detail.clientWidth + 'px.',
      '   가장자리 거리 화면 ' + visual + 'px. 빈 JSON 칸은 여기 적지 않고 화면 기본을 그대로 쓴다. */',
      'body.sc-app-mode #screen-main .territory-centrist-hero {',
      '  --sc-lay-map-w: ' + (state.mapW !== '' ? signed(state.mapW) + 'px' : (prop('--sc-lay-map-w') || '0px')) + ';',
      '  --sc-lay-map-x: ' + (state.mapX !== '' ? signed(state.mapX) + 'px' : (prop('--sc-lay-map-x') || '0px')) + ';',
      '  --sc-lay-map-margin: ' + (state.margin !== '' ? signed(state.margin) + 'px' : (prop('--sc-lay-map-margin') || '0px')) + ';',
      '  --sc-lay-side: ' + (prop('--sc-lay-side') || '0px') + ';',
      '  --sc-lay-cards-w: ' + (state.cardsW !== '' ? signed(state.cardsW) + 'px' : (prop('--sc-lay-cards-w') || '0px')) + ';',
      '  --sc-lay-cards-h: ' + (state.cardsH !== '' ? signed(state.cardsH) + 'px' : (prop('--sc-lay-cards-h') || '0px')) + ';',
      '  --sc-lay-cards-x: ' + (prop('--sc-lay-cards-x') || '0px') + ';',
      '  --sc-lay-cards-y: ' + (state.cardsY !== '' ? signed(state.cardsY) + 'px' : (prop('--sc-lay-cards-y') || '0px')) + ';',
      '  --sc-lay-cards-gap: ' + (state.cardsGap !== '' ? signed(state.cardsGap) + 'px' : (prop('--sc-lay-cards-gap') || '0.5rem')) + ';',
      '  --sc-lay-detail-w: ' + (state.detailW !== '' ? signed(state.detailW) + 'px' : (prop('--sc-lay-detail-w') || '0px')) + ';',
      '  --sc-lay-detail-h: ' + (state.detailH !== '' ? signed(state.detailH) + 'px' : (prop('--sc-lay-detail-h') || 'auto')) + ';',
      '  --sc-lay-detail-img: ' + (state.detailImg !== '' ? signed(state.detailImg) + 'px' : (prop('--sc-lay-detail-img') || '0px')) + ';',
      '  --sc-lay-detail-gap: ' + (state.detailGap !== '' ? signed(state.detailGap) + 'px' : (prop('--sc-lay-detail-gap') || '0px')) + ';',
      '  --sc-lay-detail-x: ' + (state.detailX !== '' ? signed(state.detailX) + 'px' : (prop('--sc-lay-detail-x') || '0px')) + ';',
      '  --sc-lay-detail-y: ' + (state.detailY !== '' ? signed(state.detailY) + 'px' : (prop('--sc-lay-detail-y') || '0px')) + ';',
      '  --sc-lay-detail-gap-fix: calc(var(--sc-lay-detail-gap) - max(0px, var(--sc-lay-detail-gap)) - var(--sc-lay-detail-x) + var(--sc-lay-map-x));',
      '}',
      '/* column-gap: max(0px, var(--sc-lay-detail-gap));',
      '   설명 margin-left: calc(var(--sc-lay-detail-x) + var(--sc-lay-detail-gap-fix, 0px)); */',
      '/* 조절 JSON: ' + JSON.stringify(state) + ' */'
    ];
    return lines.join('\n');
  }

  function readStorageRaw() {
    try {
      return localStorage.getItem(KEY) || '';
    } catch (err) {
      return '';
    }
  }

  function borderPair(el) {
    if (!el) return 0;
    var cs = getComputedStyle(el);
    return Math.round((parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0));
  }

  function diffReport() {
    var lines = [];
    var hero = heroEl();
    var frame = frameEl();
    var cards = cardsEl();
    var detail = detailEl();
    var stack = stackEl();
    var cs = hero ? getComputedStyle(hero) : null;
    function prop(name) {
      return cs ? (cs.getPropertyValue(name) || '').trim() : '';
    }
    function boxLine(name, el) {
      if (!el) {
        lines.push(name + ': 없음');
        return;
      }
      var r = el.getBoundingClientRect();
      lines.push(name + ': x ' + Math.round(r.left) + ', y ' + Math.round(r.top) + ', width ' + Math.round(r.width) + ', height ' + Math.round(r.height));
    }
    lines.push('코드 기본값 JSON: ' + JSON.stringify(blank()));
    lines.push('브라우저 저장 JSON: ' + (readStorageRaw() || '(없음)'));
    lines.push('지금 화면 상태 JSON: ' + JSON.stringify(state));
    lines.push('CSS 변수 map-w ' + prop('--sc-lay-map-w') + ', map-x ' + prop('--sc-lay-map-x') + ', detail-w ' + prop('--sc-lay-detail-w') + ', detail-gap ' + prop('--sc-lay-detail-gap') + ', detail-x ' + prop('--sc-lay-detail-x') + ', detail-y ' + prop('--sc-lay-detail-y') + ', gap-fix ' + prop('--sc-lay-detail-gap-fix'));
    if (cs) lines.push('column-gap 계산값: ' + cs.columnGap);
    boxLine('전체 지도', frame);
    boxLine('하단 4카드', cards);
    boxLine('오른쪽 상세', detail);
    boxLine('최근 활동', stack);
    if (frame && state.mapW !== '') {
      var savedW = signed(state.mapW);
      var cssW = Math.round(parseFloat(prop('--sc-lay-map-w')) || 0);
      lines.push('지도 가로 저장 ' + savedW + ', CSS 변수 ' + cssW + 'px, 화면 테두리 포함 ' + frame.offsetWidth + ', 내용 ' + frame.clientWidth + ', 좌우 테두리 ' + borderPair(frame) + 'px.');
      if (savedW === cssW && savedW === frame.offsetWidth) {
        lines.push('지도 가로: 저장값, CSS 변수, 테두리 포함 너비가 같다. 내용이 더 작은 이유는 box-sizing border-box와 좌우 테두리이다.');
      } else {
        lines.push('지도 가로가 아직 다르다.');
      }
    }
    if (detail && state.detailW !== '') {
      var savedD = signed(state.detailW);
      var cssD = Math.round(parseFloat(prop('--sc-lay-detail-w')) || 0);
      lines.push('설명 가로 저장 ' + savedD + ', CSS 변수 ' + cssD + 'px, 화면 테두리 포함 ' + detail.offsetWidth + ', 내용 ' + detail.clientWidth + ', 좌우 테두리 ' + borderPair(detail) + 'px.');
      if (savedD === cssD && savedD === detail.offsetWidth) {
        lines.push('설명 가로: 저장값, CSS 변수, 테두리 포함 너비가 같다. 내용이 더 작은 이유는 좌우 테두리이다.');
      } else {
        lines.push('설명 가로가 아직 다르다.');
      }
    }
    if (frame && detail && state.detailGap !== '') {
      var target = signed(state.detailGap);
      var visual = Math.round(detail.getBoundingClientRect().left - frame.getBoundingClientRect().right);
      var cssGap = Math.round(parseFloat(prop('--sc-lay-detail-gap')));
      var cssX = Math.round(parseFloat(prop('--sc-lay-detail-x')));
      var savedX = state.detailX === '' ? 0 : signed(state.detailX);
      lines.push('간격 저장 ' + target + ', CSS 변수 ' + prop('--sc-lay-detail-gap') + ', 화면 가장자리 ' + visual + 'px.');
      lines.push('설명 좌우 저장 ' + (state.detailX === '' ? '(비어 있음)' : state.detailX) + ', CSS 변수 ' + prop('--sc-lay-detail-x') + '.');
      if (visual === target && cssGap === target && cssX === savedX) {
        if (target < 0) {
          lines.push('간격은 저장값, CSS 변수, 화면 가장자리가 같다. column-gap은 음수를 버리므로 0이고, 보정 ' + prop('--sc-lay-detail-gap-fix') + ' 이 가장자리를 맞춘다. detailX는 바꾸지 않았다.');
        } else {
          lines.push('간격은 저장값, CSS 변수, 화면 가장자리가 같다.');
        }
      } else {
        lines.push('간격 또는 설명 좌우가 아직 다르다. column-gap 계산값 ' + (cs ? cs.columnGap : '') + ', 보정 ' + prop('--sc-lay-detail-gap-fix') + '.');
      }
    }
    var raw = readStorageRaw();
    if (!raw) lines.push('브라우저 저장값이 없다. 처음 열면 코드 기본값을 쓴다.');
    else if (raw !== JSON.stringify(blank())) lines.push('기존 저장이 코드 기본값을 막는다. 열 때 저장 JSON을 읽어 그 값으로 그린다. 기본 배치 적용은 저장 JSON을 지우지 않는다.');
    else lines.push('브라우저 저장 JSON이 코드 기본값과 같다.');
    if (raw && raw !== JSON.stringify(state)) lines.push('브라우저 저장 JSON과 지금 화면 상태가 다르다.');
    else if (raw) lines.push('브라우저 저장 JSON과 지금 화면 상태가 같다.');
    return lines.join('\n');
  }

  function showView(kind) {
    var lines = [];
    if (kind === 'applied') {
      lines.push('현재 적용값');
      lines.push(JSON.stringify(state));
      lines.push(snapshotCss());
    } else if (kind === 'saved') {
      lines.push('브라우저 저장값');
      lines.push(readStorageRaw() || '(없음)');
    } else {
      lines.push('코드 기본값');
      lines.push(JSON.stringify(blank()));
    }
    lines.push('');
    lines.push(diffReport());
    var text = lines.join('\n');
    if (ui.report) {
      ui.report.hidden = false;
      ui.report.textContent = text;
    }
    if (ui.copyBox) {
      ui.copyBox.hidden = false;
      ui.copyBox.value = text;
    }
  }

  function paintStatus() {
    if (!ui.status) return;
    var frame = frameEl();
    var detail = detailEl();
    var w = frame ? frame.offsetWidth : 0;
    var h = frame ? frame.offsetHeight : 0;
    var extra = notes.length ? ' ' + notes.join(' ') : '';
    var dirty = JSON.stringify(state) !== savedRaw;
    var gapNote = '';
    if (frame && detail && state.detailGap !== '') {
      var visual = Math.round(detail.getBoundingClientRect().left - frame.getBoundingClientRect().right);
      var target = signed(state.detailGap);
      if (visual !== target) gapNote = ' 화면 간격 ' + visual + 'px, 저장 ' + target + 'px.';
    }
    var widthNote = '';
    if (frame && state.mapW !== '' && frame.offsetWidth !== signed(state.mapW)) {
      widthNote = ' 화면 지도 가로 ' + frame.offsetWidth + 'px, 저장 ' + state.mapW + 'px.';
    }
    ui.status.textContent =
      '지도 테두리 포함 ' + w + '×' + h + '.' +
      (frame ? ' 내용 가로 ' + frame.clientWidth + 'px.' : '') +
      (dirty ? ' 아직 저장 전입니다.' : ' 저장된 값과 같습니다.') +
      gapNote + widthNote + extra;
    if (ui.copyBox && document.activeElement !== ui.copyBox && ui.report && ui.report.hidden) ui.copyBox.value = snapshotCss();
    writeForm();
  }

  function field(label, key, unitKey) {
    var wrap = document.createElement('label');
    wrap.className = 'sc-lay-field';
    var span = document.createElement('span');
    span.textContent = label;
    var input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.className = 'sc-input';
    input.dataset.layKey = key;
    input.placeholder = '기본';
    wrap.appendChild(span);
    wrap.appendChild(input);
    if (unitKey) {
      var unit = document.createElement('select');
      unit.dataset.layUnit = unitKey;
      ['px', '%'].forEach(function (u) {
        var op = document.createElement('option');
        op.value = u;
        op.textContent = u;
        unit.appendChild(op);
      });
      wrap.appendChild(unit);
      unit.addEventListener('change', onForm);
    }
    input.addEventListener('input', onForm);
    return wrap;
  }

  function writeForm() {
    if (!ui.form) return;
    ui.form.querySelectorAll('[data-lay-key]').forEach(function (input) {
      if (document.activeElement === input) return;
      input.value = state[input.dataset.layKey] == null ? '' : state[input.dataset.layKey];
    });
    ui.form.querySelectorAll('[data-lay-unit]').forEach(function (sel) {
      sel.value = state[sel.dataset.layUnit] || 'px';
    });
    if (ui.match) ui.match.checked = state.cardsMatch !== false;
    if (ui.align) ui.align.value = state.detailAlign || 'start';
  }

  function onForm() {
    if (!ui.form) return;
    ui.form.querySelectorAll('[data-lay-key]').forEach(function (input) {
      state[input.dataset.layKey] = input.value;
    });
    ui.form.querySelectorAll('[data-lay-unit]').forEach(function (sel) {
      state[sel.dataset.layUnit] = sel.value;
    });
    state.cardsMatch = !!(ui.match && ui.match.checked);
    state.detailAlign = ui.align ? ui.align.value : 'start';
    commit(state);
  }

  function beginGesture() {
    document.body.setAttribute('data-sc-map-layout-dragging', '1');
    function swallow(ev) {
      var t = ev.target;
      var onMap = t && t.closest && t.closest('.territory-centrist-hero__frame');
      if (onMap) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      document.removeEventListener('click', swallow, true);
      document.body.removeAttribute('data-sc-map-layout-dragging');
    }
    document.addEventListener('click', swallow, true);
    root.setTimeout(function () {
      document.body.removeAttribute('data-sc-map-layout-dragging');
    }, 800);
  }

  function marginPx(el, side) {
    if (!el) return 0;
    return Math.round(parseFloat(getComputedStyle(el)[side]) || 0);
  }

  function heroVar(name, fallback) {
    var hero = heroEl();
    if (!hero) return signed(fallback);
    var raw = hero.style.getPropertyValue(name);
    if (!raw) raw = getComputedStyle(hero).getPropertyValue(name);
    var n = parseFloat(raw);
    return isFinite(n) ? Math.round(n) : signed(fallback);
  }

  function onHandleDown(ev) {
    if (!editing) return;
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    beginGesture();
    var key = ev.currentTarget.getAttribute('data-key');
    var startX = ev.clientX;
    var startY = ev.clientY;
    var frame = frameEl();
    var cards = cardsEl();
    var card = cards && cards.querySelector('.sc-tcard');
    var detail = detailEl();
    var image = detail && detail.querySelector('.sc-tdetail__img');
    var stack = stackEl();
    var panel = activityEl();
    var start = {
      map: frame ? frame.offsetWidth : 0,
      mapX: marginPx(frame, 'marginLeft'),
      cards: cards ? cards.offsetWidth : 0,
      cardsH: card ? card.offsetHeight : 0,
      cardsX: marginPx(cards, 'marginLeft'),
      cardsY: marginPx(cards, 'marginTop'),
      detail: detail ? detail.offsetWidth : 0,
      detailH: detail ? detail.offsetHeight : 0,
      detailX: heroVar('--sc-lay-detail-x', state.detailX),
      detailY: marginPx(detail, 'marginTop'),
      img: image ? Math.round(image.getBoundingClientRect().height) : 0,
      gap: state.detailGap !== '' ? signed(state.detailGap) : 0,
      actX: stack ? Math.round(stack.getBoundingClientRect().left) : 12,
      actY: stack ? Math.round(stack.getBoundingClientRect().top) : 80,
      actW: stack ? Math.round(stack.getBoundingClientRect().width) : 230,
      actH: panel ? Math.round(panel.getBoundingClientRect().height) : 200
    };
    function move(e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (key === 'mapW') {
        state.mapW = String(Math.round(start.map + dx));
        state.mapWU = 'px';
      } else if (key === 'mapX') {
        state.mapX = String(Math.round(start.mapX + dx));
      } else if (key === 'cardsW') {
        state.cardsW = String(Math.round(start.cards + dx));
        state.cardsWU = 'px';
      } else if (key === 'cardsH') {
        state.cardsH = String(Math.round(start.cardsH + dy));
      } else if (key === 'cardsMove') {
        state.cardsMatch = false;
        state.cardsX = String(Math.round(start.cardsX + dx));
        state.cardsY = String(Math.round(start.cardsY + dy));
      } else if (key === 'detailW') {
        state.detailW = String(Math.round(start.detail + dx));
        state.detailWU = 'px';
      } else if (key === 'detailH') {
        state.detailH = String(Math.round(start.detailH + dy));
        state.detailHU = 'px';
      } else if (key === 'detailMove') {
        state.detailX = String(Math.round(start.detailX + dx));
        state.detailY = String(Math.round(start.detailY + dy));
      } else if (key === 'detailImg') {
        state.detailImg = String(Math.max(1, Math.round(start.img + dy)));
        state.detailImgU = 'px';
      } else if (key === 'gap') {
        state.detailGap = String(Math.round(start.gap - dx));
      } else if (key === 'actW' || key === 'actH' || key === 'actBox') {
        claimActivity(start);
        if (key === 'actW' || key === 'actBox') state.actW = String(Math.max(1, Math.round(start.actW + dx)));
        if (key === 'actH' || key === 'actBox') {
          var collapsed = panel && panel.classList.contains('is-collapsed');
          if (collapsed) {
            var toggle = document.getElementById('sc-activity-feed-toggle');
            if (toggle) toggle.click();
          }
          state.actH = String(Math.max(1, Math.round(start.actH + dy)));
        }
      }
      commit(state);
    }
    function up() {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
    }
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
  }

  function claimActivity(start) {
    if (state.actHold === '') state.actHold = currentSidePx();
    if (state.actX === '') state.actX = String(start.actX);
    if (state.actY === '') state.actY = String(start.actY);
    if (state.actW === '') state.actW = String(Math.max(1, start.actW || 230));
  }

  function currentSidePx() {
    var hero = heroEl();
    if (!hero) return '0';
    var raw = hero.style.getPropertyValue('--sc-lay-side') || getComputedStyle(hero).getPropertyValue('--sc-lay-side');
    return String(Math.max(0, Math.round(parseFloat(raw) || 0)));
  }

  function onActivityMoveDown(ev) {
    if (!editing) return;
    if (ev.button != null && ev.button !== 0) return;
    var target = ev.target;
    if (target && target.closest && target.closest('#sc-activity-feed-toggle, #sc-activity-feed-list, .sc-lay-handle')) return;
    ev.preventDefault();
    ev.stopPropagation();
    beginGesture();
    var head = ev.currentTarget;
    if (head.setPointerCapture && ev.pointerId != null) {
      try { head.setPointerCapture(ev.pointerId); } catch (err) {}
    }
    document.body.classList.add('is-sc-activity-moving');
    if (state.actHold === '') state.actHold = currentSidePx();
    var stack = stackEl();
    var rect = stack ? stack.getBoundingClientRect() : { left: 12, top: 80, width: 230 };
    var start = {
      actX: Math.round(rect.left),
      actY: Math.round(rect.top),
      actW: Math.round(rect.width) || 230
    };
    var sx = ev.clientX;
    var sy = ev.clientY;
    var moved = false;
    function move(e) {
      moved = true;
      claimActivity(start);
      state.actX = String(Math.round(start.actX + (e.clientX - sx)));
      state.actY = String(Math.round(start.actY + (e.clientY - sy)));
      commit(state);
    }
    function up() {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      document.body.classList.remove('is-sc-activity-moving');
      if (moved) save();
    }
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
  }

  function addHandle(el, key, edge, title) {
    var n = document.createElement('div');
    n.className = 'sc-lay-handle sc-lay-handle--' + edge;
    n.setAttribute('data-key', key);
    n.setAttribute('role', 'slider');
    n.setAttribute('aria-label', title);
    n.title = title;
    n.addEventListener('pointerdown', onHandleDown);
    n.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.appendChild(n);
  }

  function addTag(el, text) {
    var s = document.createElement('div');
    s.className = 'sc-lay-tag';
    s.textContent = text;
    el.appendChild(s);
  }

  function mountHandles() {
    clearHandles();
    var frame = frameEl();
    var cards = cardsEl();
    var detail = detailEl();
    var panel = activityEl();
    if (frame) {
      addTag(frame, '지도');
      addHandle(frame, 'mapX', 'w', '지도 좌우 위치');
      addHandle(frame, 'mapW', 'e', '지도 가로');
    }
    if (cards) {
      addTag(cards, '카드');
      addHandle(cards, 'cardsMove', 'move', '카드 위치');
      addHandle(cards, 'cardsW', 'e', '카드 영역 가로');
      addHandle(cards, 'cardsH', 's', '카드 높이');
    }
    if (detail) {
      addTag(detail, '상세');
      addHandle(detail, 'detailMove', 'move', '상세 위치');
      addHandle(detail, 'gap', 'w', '지도와 간격');
      addHandle(detail, 'detailW', 'e', '상세 가로');
      addHandle(detail, 'detailH', 's', '상세 세로');
      var image = detail.querySelector('.sc-tdetail__image') || detail.querySelector('.sc-tdetail__img');
      if (image) addHandle(image, 'detailImg', 's', '발전 이미지 높이');
    }
    if (panel && visibleBox(panel)) {
      addTag(panel, '최근 활동');
      addHandle(panel, 'actW', 'e', '최근 활동 너비');
      addHandle(panel, 'actH', 's', '최근 활동 높이');
      addHandle(panel, 'actBox', 'se', '최근 활동 너비와 높이');
      mountActivityMoveBar(panel);
    }
  }

  function mountActivityMoveBar(panel) {
    var head = panel.querySelector('.sc-activity-feed__head');
    if (!head || document.getElementById('sc-activity-move-handle')) return;
    var bar = document.createElement('div');
    bar.id = 'sc-activity-move-handle';
    bar.className = 'sc-activity-move-bar';
    bar.textContent = '이동';
    bar.title = '이 막대나 제목을 끌어 옮깁니다. 목록은 스크롤만 됩니다.';
    bar.setAttribute('role', 'button');
    bar.setAttribute('aria-label', '최근 활동 창 이동');
    head.insertBefore(bar, head.firstChild);
  }

  function clearHandles() {
    document.querySelectorAll('.sc-lay-handle, .sc-lay-tag, #sc-activity-move-handle').forEach(function (n) {
      n.remove();
    });
  }

  function openEditor() {
    if (!isPc()) return;
    editing = true;
    document.body.classList.add('is-sc-layout-editing');
    if (ui.btn) ui.btn.setAttribute('aria-pressed', 'true');
    if (ui.panel) ui.panel.hidden = false;
    commit(state);
    mountHandles();
    writeForm();
    paintStatus();
  }

  function closeEditor() {
    editing = false;
    document.body.classList.remove('is-sc-layout-editing');
    document.body.removeAttribute('data-sc-map-layout-dragging');
    if (ui.btn) ui.btn.setAttribute('aria-pressed', 'false');
    if (ui.panel) ui.panel.hidden = true;
    clearHandles();
    commit(state);
  }

  function save() {
    savedRaw = JSON.stringify(state);
    try {
      localStorage.setItem(KEY, savedRaw);
    } catch (err) {
      notes.push('이 브라우저 저장에 실패했습니다.');
    }
    paintStatus();
  }

  function restore() {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {}
    savedRaw = JSON.stringify(blank());
    state = blank();
    notes = ['기본값으로 되돌렸습니다.'];
    commit(state);
    notes = ['기본값으로 되돌렸습니다.'];
    paintStatus();
  }

  function revertSaved() {
    var raw = '';
    try {
      raw = localStorage.getItem(KEY) || '';
    } catch (err) {
      raw = '';
    }
    if (!raw) {
      notes = ['이 브라우저에 마지막 저장값이 없습니다.'];
      paintStatus();
      return;
    }
    try {
      state = Object.assign(blank(), JSON.parse(raw));
    } catch (err2) {
      notes = ['저장값을 읽지 못했습니다.'];
      paintStatus();
      return;
    }
    savedRaw = JSON.stringify(state);
    notes = ['마지막 저장값으로 되돌렸습니다.'];
    commit(state);
    notes = ['마지막 저장값으로 되돌렸습니다.'];
    paintStatus();
  }

  function placeActivityLeft() {
    var frame = frameEl();
    var top = 80;
    if (frame) top = Math.round(frame.getBoundingClientRect().top);
    if (state.actHold === '') state.actHold = currentSidePx();
    state.actX = '12';
    state.actY = String(top);
    if (state.actW === '') state.actW = '230';
    commit(state);
    save();
    if (editing) mountHandles();
  }

  function resetActivityPlace() {
    var base = blank();
    state.actX = base.actX;
    state.actY = base.actY;
    state.actW = base.actW;
    state.actH = base.actH;
    state.actHold = base.actHold;
    commit(state);
    save();
    if (editing) mountHandles();
  }

  function toggleActivity() {
    var toggle = document.getElementById('sc-activity-feed-toggle');
    if (toggle) toggle.click();
  }

  function applyDefaultKeep() {
    state = blank();
    notes = ['코드 기본 배치를 화면에 적용했습니다. 브라우저 저장 JSON은 지우지 않았습니다.'];
    commit(state);
    notes = ['코드 기본 배치를 화면에 적용했습니다. 브라우저 저장 JSON은 지우지 않았습니다.'];
    paintStatus();
  }

  function exportCanon() {
    var text = [
      '현재 화면을 코드 기본값으로 확정할 값',
      JSON.stringify(state),
      snapshotCss(),
      '',
      diffReport()
    ].join('\n');
    if (ui.report) {
      ui.report.hidden = false;
      ui.report.textContent = text;
    }
    if (ui.copyBox) {
      ui.copyBox.hidden = false;
      ui.copyBox.value = text;
      ui.copyBox.focus();
      ui.copyBox.select();
    }
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(text).catch(function () {});
    }
    notes.push('확정용 값을 내보냈습니다. 저장 JSON은 바꾸지 않았습니다.');
    paintStatus();
  }

  function copySettings() {
    var text = snapshotCss();
    if (ui.copyBox) {
      ui.copyBox.hidden = false;
      ui.copyBox.value = text;
      ui.copyBox.focus();
      ui.copyBox.select();
    }
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(text).catch(function () {});
    }
    notes.push('설정값을 내보냈습니다. 아래 칸에서도 복사할 수 있습니다.');
    paintStatus();
  }

  function injectStyle() {
    var style = document.createElement('style');
    style.id = 'sc-map-layout-editor-style';
    style.textContent = [
      '#sc-map-layout-edit-btn { margin-left: 0.35rem; border-style: dashed; }',
      '@media (max-width: 899px) { #sc-map-layout-edit-btn, #sc-map-layout-editor { display: none !important; } }',
      '#sc-map-layout-editor {',
      '  position: fixed; z-index: 80; top: 4.4rem; right: 0.6rem; left: auto; width: min(22rem, calc(100vw - 1.2rem));',
      '  max-height: min(70vh, 34rem); overflow: auto; padding: 0.6rem 0.7rem 0.7rem;',
      '  background: rgba(8, 15, 32, 0.96); color: #e2e8f0; border: 1px solid rgba(56, 189, 248, 0.45);',
      '  border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); font-size: 0.78rem;',
      '}',
      '#sc-map-layout-editor[hidden] { display: none !important; }',
      '#sc-map-layout-editor h2 { margin: 0; font-size: 0.92rem; cursor: move; }',
      '#sc-map-layout-editor p { margin: 0.25rem 0 0.45rem; color: #94a3b8; }',
      '.sc-lay-block { margin: 0.45rem 0; }',
      '.sc-lay-block strong { display: block; margin-bottom: 0.2rem; }',
      '.sc-lay-field { display: flex; align-items: center; gap: 0.35rem; margin: 0.2rem 0; }',
      '.sc-lay-field span { flex: 1 1 auto; }',
      '.sc-lay-field input { width: 5.2rem; }',
      '.sc-lay-field select { width: 3.4rem; }',
      '.sc-lay-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.45rem; }',
      '#sc-lay-copy, #sc-lay-report { width: 100%; min-height: 5.5rem; margin-top: 0.4rem; font-family: ui-monospace, monospace; font-size: 0.68rem; white-space: pre-wrap; }',
      '#sc-lay-report { color: #e2e8f0; }',
      'body.is-sc-layout-editing #screen-main { overflow: auto !important; }',
      'body.is-sc-layout-editing #screen-main .territory-centrist-hero { overflow: visible !important; }',
      'body.is-sc-layout-editing #screen-main .territory-centrist-hero__frame,',
      'body.is-sc-layout-editing #sc-territory-cards,',
      'body.is-sc-layout-editing #sc-territory-detail,',
      'body.is-sc-layout-editing #sc-activity-feed-panel,',
      'body.is-sc-layout-editing .sc-tdetail__image { position: relative; }',
      'body.is-sc-layout-editing #screen-main .territory-centrist-hero__frame,',
      'body.is-sc-layout-editing #sc-territory-cards,',
      'body.is-sc-layout-editing #sc-territory-detail,',
      'body.is-sc-layout-editing #sc-activity-feed-panel { outline: 2px dashed rgba(125, 211, 252, 0.95); outline-offset: 3px; }',
      'body.is-sc-layout-editing #sc-left-side-stack { z-index: 70; pointer-events: auto; }',
      '#sc-left-side-stack.sc-activity-placed { z-index: 70; }',
      'body.is-sc-layout-editing .sc-activity-feed__head {',
      '  flex-wrap: wrap; cursor: grab; touch-action: none; user-select: none;',
      '  background: rgba(8, 47, 73, 0.92); border: 1px dashed #7dd3fc; border-radius: 8px;',
      '  padding: 0.2rem 0.28rem 0.28rem;',
      '}',
      'body.is-sc-layout-editing #sc-activity-feed-title { cursor: grab; }',
      '#sc-activity-move-handle { display: none; }',
      'body.is-sc-layout-editing #sc-activity-move-handle {',
      '  display: flex; align-items: center; justify-content: center; flex: 1 0 100%; order: -1;',
      '  min-height: 1.55rem; margin-bottom: 0.2rem; border-radius: 6px; cursor: grab; touch-action: none;',
      '  color: #f0f9ff; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.12em;',
      '  background: repeating-linear-gradient(-45deg, rgba(125,211,252,0.42) 0 6px, rgba(14,116,144,0.72) 6px 12px);',
      '}',
      'body.is-sc-activity-moving, body.is-sc-activity-moving * { cursor: grabbing !important; }',
      '#sc-activity-feed-panel.is-collapsed { height: auto !important; max-height: none !important; }',
      '.sc-lay-tag { position: absolute; z-index: 41; top: 4px; left: 6px; pointer-events: none;',
      '  background: rgba(2, 6, 23, 0.82); color: #e0f2fe; border-radius: 999px; padding: 0.05rem 0.4rem; font-size: 0.68rem; }',
      '.sc-lay-handle { position: absolute; z-index: 42; width: 14px; height: 14px; box-sizing: border-box;',
      '  background: #e0f2fe; border: 2px solid #0369a1; border-radius: 50%; touch-action: none; }',
      '.sc-lay-handle--e { right: -8px; top: 50%; margin-top: -7px; cursor: ew-resize; }',
      '.sc-lay-handle--w { left: -8px; top: 50%; margin-top: -7px; cursor: ew-resize; }',
      '.sc-lay-handle--s { left: 50%; bottom: -8px; margin-left: -7px; cursor: ns-resize; }',
      '.sc-lay-handle--se { right: -8px; bottom: -8px; cursor: nwse-resize; }',
      '.sc-lay-handle--move { left: -8px; top: -8px; cursor: move; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildPanel() {
    var panel = document.createElement('section');
    panel.id = 'sc-map-layout-editor';
    panel.className = 'sc-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', '지도 UI 편집');
    var title = document.createElement('h2');
    title.textContent = '지도 UI 편집';
    var hint = document.createElement('p');
    hint.textContent = '개발용입니다. 이 브라우저에만 저장됩니다. 지도 안은 드래그하지 않습니다. 최근 활동은 파란 이동 막대나 제목을 끌어 옮기고, 목록은 클릭과 스크롤만 됩니다. 화면 밖이면 줄어들지 않고 벗어난 픽셀을 보여 줍니다.';
    panel.appendChild(title);
    panel.appendChild(hint);
    function block(name) {
      var b = document.createElement('div');
      b.className = 'sc-lay-block';
      var s = document.createElement('strong');
      s.textContent = name;
      b.appendChild(s);
      panel.appendChild(b);
      return b;
    }
    ui.form = panel;
    var a = block('A. 지도');
    a.appendChild(field('가로', 'mapW', 'mapWU'));
    a.appendChild(field('좌우 위치', 'mapX'));
    a.appendChild(field('바깥 여백', 'margin'));
    var b = block('B. 카드 4개');
    var match = document.createElement('label');
    match.className = 'sc-lay-field';
    ui.match = document.createElement('input');
    ui.match.type = 'checkbox';
    ui.match.checked = true;
    match.appendChild(ui.match);
    var matchText = document.createElement('span');
    matchText.textContent = '지도 왼쪽 정렬';
    match.appendChild(matchText);
    b.appendChild(match);
    ui.match.addEventListener('change', onForm);
    b.appendChild(field('가로 위치', 'cardsX'));
    b.appendChild(field('세로 위치', 'cardsY'));
    b.appendChild(field('영역 가로', 'cardsW', 'cardsWU'));
    b.appendChild(field('카드 높이', 'cardsH'));
    b.appendChild(field('카드 간격', 'cardsGap'));
    b.appendChild(field('내부 여백', 'cardsPad'));
    var c = block('C. 오른쪽 설명');
    c.appendChild(field('가로 위치', 'detailX'));
    c.appendChild(field('세로 위치', 'detailY'));
    c.appendChild(field('가로', 'detailW', 'detailWU'));
    c.appendChild(field('세로', 'detailH', 'detailHU'));
    c.appendChild(field('발전 이미지 높이', 'detailImg', 'detailImgU'));
    c.appendChild(field('내부 여백', 'detailPad'));
    c.appendChild(field('지도와 간격', 'detailGap'));
    var alignWrap = document.createElement('label');
    alignWrap.className = 'sc-lay-field';
    var alignSpan = document.createElement('span');
    alignSpan.textContent = '세로 정렬';
    ui.align = document.createElement('select');
    ui.align.className = 'sc-input';
    [['start', '위'], ['center', '가운데'], ['end', '아래']].forEach(function (pair) {
      var op = document.createElement('option');
      op.value = pair[0];
      op.textContent = pair[1];
      ui.align.appendChild(op);
    });
    alignWrap.appendChild(alignSpan);
    alignWrap.appendChild(ui.align);
    ui.align.addEventListener('change', onForm);
    c.appendChild(alignWrap);
    var d = block('D. 최근 활동');
    d.appendChild(field('왼쪽', 'actX'));
    d.appendChild(field('위', 'actY'));
    d.appendChild(field('너비', 'actW'));
    d.appendChild(field('높이', 'actH'));
    ui.status = document.createElement('p');
    ui.status.id = 'sc-lay-status';
    panel.appendChild(ui.status);
    var actions = document.createElement('div');
    actions.className = 'sc-lay-actions';
    function act(text, fn) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sc-btn';
      button.textContent = text;
      button.addEventListener('click', fn);
      actions.appendChild(button);
    }
    act('현재 배치 저장', save);
    act('기본값 복원', restore);
    act('마지막 저장값 복원', revertSaved);
    act('현재 적용값 보기', function () { showView('applied'); });
    act('브라우저 저장값 보기', function () { showView('saved'); });
    act('코드 기본값 보기', function () { showView('blank'); });
    act('현재 저장값 적용', revertSaved);
    act('기본 배치 적용', applyDefaultKeep);
    act('현재 화면을 기본값으로 확정할 값 내보내기', exportCanon);
    act('설정 내보내기', copySettings);
    act('최근 활동 왼쪽 배치', placeActivityLeft);
    act('최근 활동 접기/펼치기', toggleActivity);
    act('최근 활동 기본 위치', resetActivityPlace);
    act('편집 종료', closeEditor);
    panel.appendChild(actions);
    ui.copyBox = document.createElement('textarea');
    ui.copyBox.id = 'sc-lay-copy';
    ui.copyBox.className = 'sc-input';
    ui.copyBox.readOnly = true;
    ui.copyBox.hidden = true;
    panel.appendChild(ui.copyBox);
    ui.report = document.createElement('pre');
    ui.report.id = 'sc-lay-report';
    ui.report.hidden = true;
    panel.appendChild(ui.report);
    ui.panel = panel;
    title.addEventListener('pointerdown', function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      var box = panel.getBoundingClientRect();
      var sx = ev.clientX;
      var sy = ev.clientY;
      function move(e) {
        panel.style.left = box.left + (e.clientX - sx) + 'px';
        panel.style.top = box.top + (e.clientY - sy) + 'px';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
      }
      function up() {
        root.removeEventListener('pointermove', move);
        root.removeEventListener('pointerup', up);
      }
      root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', up);
    });
    document.body.appendChild(panel);
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        savedRaw = JSON.stringify(blank());
        return;
      }
      state = Object.assign(blank(), JSON.parse(raw));
      savedRaw = JSON.stringify(state);
      if (hasOverride(state)) commit(state);
    } catch (err) {
      savedRaw = JSON.stringify(blank());
    }
  }

  function syncBtn() {
    var main = document.getElementById('screen-main');
    var show = isPc() && main && !main.hidden;
    if (ui.btn) ui.btn.hidden = !show;
    if (!show && editing) closeEditor();
    else if (isPc() && hasOverride(state)) commit(state);
    else if (!isPc()) {
      clearProps(heroEl());
      if (root.__scMapLayoutOwnsActivity) releaseActivity();
      syncHits();
    }
  }

  function bindActivityTitle() {
    var panel = activityEl();
    var head = panel && panel.querySelector('.sc-activity-feed__head');
    if (!head || head.dataset.scLayBound === '1') return;
    head.dataset.scLayBound = '1';
    head.addEventListener('pointerdown', onActivityMoveDown);
    var toggle = document.getElementById('sc-activity-feed-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (!activityOwned(state)) return;
        root.setTimeout(function () {
          commit(state);
          if (editing) mountHandles();
        }, 0);
      });
    }
  }

  function boot() {
    if (!isLocalHost() || root.__scMapLayoutEditorBoot) return;
    root.__scMapLayoutEditorBoot = 1;
    injectStyle();
    var nav = document.querySelector('.app-primary-nav');
    if (!nav) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'sc-map-layout-edit-btn';
    btn.className = 'sc-btn';
    btn.textContent = 'UI 편집';
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', function () {
      if (editing) closeEditor();
      else openEditor();
    });
    nav.appendChild(btn);
    ui.btn = btn;
    buildPanel();
    bindActivityTitle();
    loadSaved();
    syncBtn();
    root.__scMapLayoutApplyActivity = function () {
      if (!activityOwned(state)) return;
      applyActivity(state);
      if (!editing) nudgeActivity();
      if (state.actX !== '' || state.actY !== '') applyHeldSide();
      else applySideReserve();
    };
    root.__scMapLayoutDockActivity = dockDefaultActivity;
    var main = document.getElementById('screen-main');
    if (main && root.MutationObserver) {
      new MutationObserver(syncBtn).observe(main, { attributes: true, attributeFilter: ['hidden'] });
    }
    root.addEventListener('resize', syncBtn);
    root.SCMapLayoutEditor = {
      getState: function () {
        return JSON.parse(JSON.stringify(state));
      },
      commit: function (next) {
        commit(Object.assign(blank(), state, next || {}));
        writeForm();
        if (editing) mountHandles();
        return JSON.parse(JSON.stringify(state));
      },
      blank: blank,
      open: openEditor,
      close: closeEditor,
      save: save,
      restore: restore,
      revertSaved: revertSaved,
      snapshotCss: snapshotCss,
      overflow: function () {
        return measureOverflow(true);
      },
      isEditing: function () {
        return editing;
      }
    };
  }

  if (typeof document === 'undefined' || !isLocalHost()) return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
