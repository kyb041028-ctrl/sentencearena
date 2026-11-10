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
      name: '공사 중인데 들어오셨네요',
      meta: '특별 · 개발용 미리보기',
      note: '개발용 표시입니다. 운영 지급이 아닙니다.',
      stars: '별 2개',
      badgeAlt: '공사 상징',
    };

  var stageEl = null;
  var buttonEl = null;

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

  function showPreviewRow(list) {
    var existing = list.querySelector('.sc-achievement-history-row[data-sena-preview="1"]');
    if (existing) {
      decorate(existing);
      return existing;
    }
    var empty = list.querySelector('.sc-featured-achievement-panel__empty');
    if (empty) empty.hidden = true;
    var row = document.createElement('div');
    row.className = 'sc-achievement-history-row';
    row.setAttribute('data-sena-preview', '1');
    var iconWrap = document.createElement('span');
    iconWrap.className = 'sc-achievement-history-row__icon';
    var icon = document.createElement('img');
    icon.className = 'sc-achievement-history-row__icon-img';
    icon.alt = '';
    icon.src = '/assets/achievements/achievement_first_post.png';
    iconWrap.appendChild(icon);
    var content = document.createElement('span');
    content.className = 'sc-achievement-history-row__content';
    var idNode = document.createElement('span');
    idNode.setAttribute('data-achievement-id', 'beta-citizen');
    idNode.hidden = true;
    var name = document.createElement('span');
    name.className = 'sc-achievement-history-row__name';
    name.textContent = pack.name;
    var meta = document.createElement('span');
    meta.className = 'sc-achievement-history-row__meta';
    meta.textContent = pack.meta;
    content.appendChild(idNode);
    content.appendChild(name);
    content.appendChild(meta);
    row.appendChild(iconWrap);
    row.appendChild(content);
    list.appendChild(row);
    decorate(row);
    return row;
  }

  function clearPreview() {
    if (stageEl && stageEl.parentNode) stageEl.remove();
    stageEl = null;
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
    if (stageEl && stageEl.parentNode) stageEl.remove();
    stageEl = null;
    var list = document.getElementById('sc-achievement-history-list');
    var marked = { found: false };
    if (list) {
      var real = realBetaRow(list);
      if (real) {
        decorate(real);
        marked = { found: true, preview: false };
      } else {
        showPreviewRow(list);
        marked = { found: true, preview: true };
      }
    }
    var after = realRows(listRows());
    window.__saSenaDevResult = {
      before: before,
      after: after,
      marked: marked,
      orderKept: sameOrder(before, after),
      productionGrant: false,
      achievementId: 'beta-citizen',
    };
    if (buttonEl) buttonEl.setAttribute('aria-pressed', 'true');
  }

  function ensureStyle() {
    if (document.getElementById('sa-sena-editor-style')) return;
    var style = document.createElement('style');
    style.id = 'sa-sena-editor-style';
    style.textContent = '#sa-sena-editor-preview{display:block;width:100%;margin:0 0 .45rem}#sc-featured-achievement-panel.is-sena-dev .sc-featured-achievement-panel__dialog{width:min(44rem,96vw);max-height:92vh;min-height:78vh}#sa-sena-stage{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:min(34rem,86%);height:46%;z-index:3;overflow:hidden;border:1px solid rgba(217,184,120,.8);border-radius:12px;background:#070b16;box-shadow:0 18px 48px rgba(0,0,0,.5)}#sa-sena-stage iframe{width:100%;height:100%;border:0;background:#070b16}.sa-sena-dev-badge{width:28px;height:28px;margin-right:.4rem;vertical-align:middle}.sa-sena-dev-stars{display:block;margin-top:.2rem}';
    document.head.appendChild(style);
  }

  function playPreview() {
    if (typeof window.openFeaturedAchievementPanel !== 'function') return false;
    clearPreview();
    window.openFeaturedAchievementPanel();
    var panel = document.getElementById('sc-featured-achievement-panel');
    var dialog = panel && panel.querySelector('.sc-featured-achievement-panel__dialog');
    var list = document.getElementById('sc-achievement-history-list');
    if (!panel || !dialog || !list) return false;
    window.__saSenaListBefore = realRows(listRows());
    panel.classList.add('is-sena-dev');
    ensureStyle();
    var stage = document.createElement('div');
    stage.id = 'sa-sena-stage';
    stage.dataset.devOnly = 'true';
    stage.dataset.productionGrant = 'false';
    var frame = document.createElement('iframe');
    frame.title = country === 'US' ? 'Sena achievement animation' : '세나 업적 애니메이션';
    frame.src = '/sena-beta-citizen/' + (country === 'US' ? 'play-en.html' : 'play-kr.html');
    stage.appendChild(frame);
    dialog.appendChild(stage);
    stageEl = stage;
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
    if (data.source !== 'sena-beta-citizen' || data.achievementId !== 'beta-citizen' || data.state !== 'complete') return;
    if (data.productionGrant !== false || data.devOnly !== true) return;
    finish();
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
