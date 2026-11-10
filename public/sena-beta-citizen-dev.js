/**
 * beta-citizen 개발 확인.
 * 127.0.0.1 / localhost 의 좌표 에디터 안에서만 버튼을 보여 준다.
 * 버튼을 눌러야 기존 업적 패널 안에서 6초 연출이 재생된다.
 * 목록은 비우지 않는다. 실제 지급 함수는 호출하지 않는다.
 */
(function () {
  'use strict';

  var host = String(location.hostname || '');
  if (host !== '127.0.0.1' && host !== 'localhost') return;

  var country = location.pathname === '/us' || String(location.pathname || '').indexOf('/us/') === 0 ? 'US' : 'KR';
  var pack = country === 'US'
    ? {
      button: 'Preview Sena achievement',
      name: 'You Caught Us Building!',
      meta: 'Special · Development preview',
      note: 'Development display. This is not a production grant.',
      stars: '2 stars',
      badgeAlt: 'Construction badge',
    }
    : {
      button: '세나 업적 미리보기',
      name: '공사 중인데 오셨군요!',
      meta: '특별 · 개발용 미리보기',
      note: '개발용 표시입니다. 운영 지급이 아닙니다.',
      stars: '별 2개',
      badgeAlt: '공사 상징',
    };

  var stageEl = null;
  var buttonEl = null;
  var listOpened = false;
  var docking = false;

  function listRows() {
    var list = document.getElementById('sc-achievement-history-list');
    if (!list) return [];
    return Array.prototype.map.call(list.querySelectorAll('.sc-achievement-history-row'), function (row) {
      var idNode = row.querySelector('[data-achievement-id]');
      var icon = row.querySelector('.sc-achievement-history-row__icon-img');
      var name = row.querySelector('.sc-achievement-history-row__name');
      return {
        id: idNode ? idNode.getAttribute('data-achievement-id') : '',
        name: name ? name.textContent : '',
        icon: icon ? icon.getAttribute('src') : '',
        preview: row.getAttribute('data-sena-preview') === '1',
      };
    });
  }

  function realRows(rows) {
    return (rows || []).filter(function (row) { return !row.preview; });
  }

  function sameOrder(before, after) {
    if (before.length !== after.length) return false;
    var i;
    for (i = 0; i < before.length; i += 1) {
      if (before[i].id !== after[i].id || before[i].name !== after[i].name || before[i].icon !== after[i].icon) return false;
    }
    return true;
  }

  function decorate(row) {
    if (!row || row.querySelector('.sa-sena-dev-badge')) return;
    var content = row.querySelector('.sc-achievement-history-row__content') || row;
    var badge = document.createElement('img');
    badge.className = 'sa-sena-dev-badge';
    badge.src = '/sena-beta-citizen/assets/production-v04/badge_construction_64.png';
    badge.alt = pack.badgeAlt;
    badge.width = 28;
    badge.height = 28;
    var stars = document.createElement('span');
    stars.className = 'sa-sena-dev-stars';
    stars.textContent = '★★☆☆☆ ' + pack.stars + ' · ' + pack.note;
    content.appendChild(badge);
    content.appendChild(stars);
  }

  function realBetaRow(list) {
    var nodes = list.querySelectorAll('[data-achievement-id="beta-citizen"]');
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      var row = nodes[i].closest('.sc-achievement-history-row');
      if (row && row.getAttribute('data-sena-preview') !== '1') return row;
    }
    return null;
  }

  function achievementIds() {
    if (typeof window.getCurrentUserAchievements !== 'function') return [];
    return window.getCurrentUserAchievements().map(function (row) { return row.achievementId; });
  }

  function clearPreview() {
    listOpened = false;
    docking = false;
    document.body.classList.remove('is-sena-layer-open');
    if (stageEl && stageEl.parentNode) stageEl.remove();
    stageEl = null;
    var layer = document.getElementById('sa-sena-layer');
    if (layer && layer.parentNode) layer.remove();
    var list = document.getElementById('sc-achievement-history-list');
    if (list) {
      Array.prototype.forEach.call(list.querySelectorAll('[data-sena-preview="1"]'), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      Array.prototype.forEach.call(list.querySelectorAll('.sa-sena-dev-badge, .sa-sena-dev-stars'), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      var empty = list.querySelector('.sc-featured-achievement-panel__empty');
      if (empty && !list.querySelector('.sc-achievement-history-row')) empty.hidden = false;
    }
    if (buttonEl) buttonEl.setAttribute('aria-pressed', 'false');
    try {
      sessionStorage.removeItem('sa-dev-sena-preview:' + country);
      sessionStorage.removeItem('sa-dev-beta-citizen:' + country);
    } catch (err) {}
  }

  function finish() {
    var before = window.__saSenaListBefore || [];
    var beforeIds = window.__saSenaAchievementBefore || [];
    docking = false;
    document.body.classList.remove('is-sena-layer-open');
    var layer = document.getElementById('sa-sena-layer');
    if (layer && layer.parentNode) layer.remove();
    stageEl = null;
    var list = document.getElementById('sc-achievement-history-list');
    var marked = { found: false };
    if (list) {
      var real = realBetaRow(list);
      if (real) {
        decorate(real);
        var nameEl = real.querySelector('.sc-achievement-history-row__name');
        if (nameEl) nameEl.textContent = pack.name;
        marked = { found: true, preview: false };
      }
    }
    var after = realRows(listRows());
    var afterIds = achievementIds();
    var idsKept = beforeIds.length === afterIds.length;
    var i;
    for (i = 0; idsKept && i < beforeIds.length; i += 1) {
      if (beforeIds[i] !== afterIds[i]) idsKept = false;
    }
    window.__saSenaDevResult = {
      before: before,
      after: after,
      beforeIds: beforeIds,
      afterIds: afterIds,
      marked: marked,
      orderKept: sameOrder(before, after) && idsKept,
      listOpened: listOpened,
      productionGrant: false,
      achievementId: 'beta-citizen',
    };
    if (buttonEl) buttonEl.setAttribute('aria-pressed', 'true');
  }

  function hasBetaRecord() {
    return typeof window.hasCurrentUserAchievement === 'function' && window.hasCurrentUserAchievement('beta-citizen') === true;
  }

  function revealCardOnly() {
    var frame = stageEl && stageEl.querySelector('iframe');
    var doc = frame && frame.contentDocument;
    if (doc && !doc.getElementById('sa-sena-dock-style')) {
      var style = doc.createElement('style');
      style.id = 'sa-sena-dock-style';
      style.textContent = 'html,body,main,#viewport,#stage{background:transparent!important}#archive,#plaza,#scrim,#flight,#phase,.arrival,#stars-earned,#profile-earned,.caption{display:none!important}';
      doc.head.appendChild(style);
    }
    if (!stageEl) return;
    stageEl.style.background = 'transparent';
    stageEl.style.boxShadow = 'none';
    if (frame) frame.style.background = 'transparent';
  }

  function placeCardOnRow() {
    if (!docking || !stageEl) return;
    var frame = stageEl.querySelector('iframe');
    var doc = frame && frame.contentDocument;
    var list = document.getElementById('sc-achievement-history-list');
    var row = list && realBetaRow(list);
    if (!doc || !row || !frame) {
      requestAnimationFrame(placeCardOnRow);
      return;
    }
    var spark = doc.getElementById('profile-spark');
    var piece = spark;
    if (!piece) {
      requestAnimationFrame(placeCardOnRow);
      return;
    }
    var pieceBox = piece.getBoundingClientRect();
    var frameBox = frame.getBoundingClientRect();
    var rowBox = row.getBoundingClientRect();
    var cx = frameBox.left + pieceBox.left + pieceBox.width / 2;
    var cy = frameBox.top + pieceBox.top + pieceBox.height / 2;
    var tx = rowBox.left + Math.min(36, rowBox.width * 0.2);
    var ty = rowBox.top + rowBox.height / 2;
    var layerBox = stageEl.getBoundingClientRect();
    stageEl.style.left = (layerBox.left + layerBox.width / 2 + (tx - cx)) + 'px';
    stageEl.style.top = (layerBox.top + layerBox.height / 2 + (ty - cy)) + 'px';
    requestAnimationFrame(placeCardOnRow);
  }

  function openListOnce() {
    if (listOpened || !stageEl) return;
    listOpened = true;
    if (!hasBetaRecord() || typeof window.openFeaturedAchievementPanel !== 'function') return;
    window.openFeaturedAchievementPanel();
    window.__saSenaListBefore = realRows(listRows());
    var list = document.getElementById('sc-achievement-history-list');
    var row = list && realBetaRow(list);
    if (row) {
      var nameEl = row.querySelector('.sc-achievement-history-row__name');
      if (nameEl) nameEl.textContent = pack.name;
    }
    revealCardOnly();
    docking = true;
    requestAnimationFrame(placeCardOnRow);
  }

  function ensureStyle() {
    if (document.getElementById('sa-sena-editor-style')) return;
    var style = document.createElement('style');
    style.id = 'sa-sena-editor-style';
    style.textContent = '#sa-sena-editor-preview{display:block;width:100%;margin:0 0 .45rem}#sa-sena-layer{position:fixed;z-index:2147483000!important;left:50%;top:50%;transform:translate(-50%,-50%);width:min(68rem,96vw,calc(92vh * 1200 / 660));height:min(calc(68rem * 660 / 1200),92vh,calc(96vw * 660 / 1200));overflow:hidden;border-radius:12px;background:#070b16;box-shadow:0 24px 80px rgba(0,0,0,.55)}body.is-sena-layer-open #profile-layout-editor,body.is-sena-layer-open #profile-layout-editor-toggle,body.is-sena-layer-open #profile-skin-dev-switcher{z-index:1!important;visibility:hidden!important}#sa-sena-layer iframe{display:block;width:100%;height:100%;border:0;background:#070b16}.sa-sena-dev-badge{width:28px;height:28px;margin-right:.4rem;vertical-align:middle}.sa-sena-dev-stars{display:block;margin-top:.2rem}';
    document.head.appendChild(style);
  }

  function playPreview() {
    var panel = document.getElementById('sc-featured-achievement-panel');
    if (panel && !panel.hidden && typeof window.closeFeaturedAchievementPanel === 'function') {
      window.closeFeaturedAchievementPanel();
    } else {
      clearPreview();
    }
    listOpened = false;
    window.__saSenaAchievementBefore = achievementIds();
    window.__saSenaListBefore = [];
    ensureStyle();
    var layer = document.createElement('div');
    layer.id = 'sa-sena-layer';
    layer.dataset.devOnly = 'true';
    layer.dataset.productionGrant = 'false';
    var frame = document.createElement('iframe');
    frame.title = country === 'US' ? 'Sena achievement animation' : '세나 업적 애니메이션';
    frame.src = '/sena-beta-citizen/' + (country === 'US' ? 'play-en.html' : 'play-kr.html');
    layer.appendChild(frame);
    document.body.classList.add('is-sena-layer-open');
    document.body.appendChild(layer);
    stageEl = layer;
    if (buttonEl) buttonEl.setAttribute('aria-pressed', 'true');
    return true;
  }

  function mountButton() {
    var editor = document.getElementById('profile-layout-editor');
    if (!editor || document.getElementById('sa-sena-editor-preview')) return false;
    ensureStyle();
    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'sa-sena-editor-preview';
    button.className = 'profile-layout-editor__btn profile-layout-editor__btn--primary';
    button.textContent = pack.button;
    button.setAttribute('aria-pressed', 'false');
    var title = editor.querySelector('.profile-layout-editor__title');
    if (title && title.parentNode) title.parentNode.insertBefore(button, title.nextSibling);
    else editor.insertBefore(button, editor.firstChild);
    button.addEventListener('click', function () {
      if (button.getAttribute('aria-pressed') === 'true') {
        if (typeof window.closeFeaturedAchievementPanel === 'function') window.closeFeaturedAchievementPanel();
        else clearPreview();
        return;
      }
      playPreview();
    });
    buttonEl = button;
    return true;
  }

  window.addEventListener('message', function (event) {
    if (!stageEl || event.origin !== location.origin) return;
    var data = event.data || {};
    if (data.source !== 'sena-beta-citizen' || data.achievementId !== 'beta-citizen') return;
    if (data.devOnly !== true || data.productionGrant !== false) return;
    if (data.state === 'list') openListOnce();
    else if (data.state === 'complete') finish();
  });

  if (typeof window.closeFeaturedAchievementPanel === 'function' && !window.__saSenaCloseWrapped) {
    var rawClose = window.closeFeaturedAchievementPanel;
    window.closeFeaturedAchievementPanel = function () {
      clearPreview();
      return rawClose.apply(this, arguments);
    };
    window.__saSenaCloseWrapped = true;
  }

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-sc-featured-close]') : null;
    if (!target) return;
    setTimeout(clearPreview, 0);
  });

  var editorToggle = document.getElementById('profile-layout-editor-toggle');
  if (editorToggle) {
    editorToggle.addEventListener('click', function () {
      setTimeout(function () {
        if (!document.body.classList.contains('sc-profile-layout-editor-active')) {
          if (typeof window.closeFeaturedAchievementPanel === 'function') window.closeFeaturedAchievementPanel();
          else clearPreview();
        }
      }, 0);
    });
  }

  window.__saSenaDevCleanup = function () {
    clearPreview();
    return { productionGrant: false, cleared: true };
  };

  if (!mountButton()) window.addEventListener('load', mountButton);
})();
