/**
 * beta-citizen 개발 전용 연출.
 * 주소에 devSenaBeta가 있고 로컬 화면일 때만, 기존 업적 목록 패널 안에서 연다.
 * 기존 목록은 비우거나 다시 만들지 않는다. 이미 있는 beta-citizen 줄만 표시한다.
 * 실로그인만으로는 열리지 않고, 운영 업적 지급을 호출하지 않는다.
 */
(function () {
  'use strict';

  var host = String(location.hostname || '');
  if (host !== '127.0.0.1' && host !== 'localhost') return;
  var params = new URLSearchParams(location.search);
  if (!params.get('devSenaBeta')) return;

  var country = location.pathname === '/us' || String(location.pathname || '').indexOf('/us/') === 0 ? 'US' : 'KR';
  var pack = country === 'US'
    ? {
      note: 'Development display. This is not a production grant.',
      stars: '2 stars',
      badgeAlt: 'Construction badge',
    }
    : {
      note: '개발용 표시입니다. 운영 지급이 아닙니다.',
      stars: '별 2개',
      badgeAlt: '공사 상징',
    };
  var DEV_KEY = 'sa-dev-sena-preview:' + country;

  function listRows() {
    var list = document.getElementById('sc-achievement-history-list');
    if (!list) return [];
    return Array.prototype.map.call(list.querySelectorAll('.sc-achievement-history-row'), function (row) {
      var check = row.querySelector('[data-achievement-id]');
      var icon = row.querySelector('.sc-achievement-history-row__icon-img');
      var name = row.querySelector('.sc-achievement-history-row__name');
      return {
        id: check ? check.getAttribute('data-achievement-id') : '',
        name: name ? name.textContent : '',
        icon: icon ? icon.getAttribute('src') : '',
      };
    });
  }

  function markExistingBeta() {
    var list = document.getElementById('sc-achievement-history-list');
    if (!list) return { found: false, reason: 'NO_LIST' };
    var check = list.querySelector('[data-achievement-id="beta-citizen"]');
    if (!check) return { found: false };
    var row = check.closest('.sc-achievement-history-row');
    if (!row) return { found: false };
    if (row.querySelector('.sa-sena-dev-badge')) return { found: true, already: true };
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
    return { found: true };
  }

  function sameOrder(before, after) {
    if (before.length !== after.length) return false;
    var i;
    for (i = 0; i < before.length; i += 1) {
      if (before[i].id !== after[i].id || before[i].name !== after[i].name) return false;
      if (before[i].icon !== after[i].icon) return false;
    }
    return true;
  }

  function finish(stage) {
    var before = window.__saSenaListBefore || [];
    if (stage && stage.parentNode) stage.remove();
    var marked = markExistingBeta();
    var after = listRows();
    try { sessionStorage.removeItem(DEV_KEY); } catch (err) {}
    window.__saSenaDevResult = {
      before: before,
      after: after,
      marked: marked,
      orderKept: sameOrder(before, after),
      productionGrant: false,
      achievementId: 'beta-citizen',
    };
  }

  function start() {
    if (typeof window.openFeaturedAchievementPanel !== 'function') return false;
    if (params.get('devSenaFixture') === 'acquired' && typeof window.__scResetUserAchievementMock === 'function') {
      window.__scResetUserAchievementMock();
    }
    window.openFeaturedAchievementPanel();
    var panel = document.getElementById('sc-featured-achievement-panel');
    var dialog = panel && panel.querySelector('.sc-featured-achievement-panel__dialog');
    var list = document.getElementById('sc-achievement-history-list');
    if (!panel || !dialog || !list) return false;
    window.__saSenaListBefore = listRows();
    panel.classList.add('is-sena-dev');
    var style = document.createElement('style');
    style.textContent = '#sc-featured-achievement-panel.is-sena-dev .sc-featured-achievement-panel__dialog{width:min(44rem,96vw);max-height:92vh;min-height:78vh}#sa-sena-stage{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:min(34rem,86%);height:46%;z-index:3;overflow:hidden;border:1px solid rgba(217,184,120,.8);border-radius:12px;background:#070b16;box-shadow:0 18px 48px rgba(0,0,0,.5)}#sa-sena-stage iframe{width:100%;height:100%;border:0;background:#070b16}.sa-sena-dev-badge{width:28px;height:28px;margin-right:.4rem;vertical-align:middle}.sa-sena-dev-stars{display:block;margin-top:.2rem}';
    document.head.appendChild(style);
    var stage = document.createElement('div');
    stage.id = 'sa-sena-stage';
    stage.dataset.devOnly = 'true';
    stage.dataset.productionGrant = 'false';
    var frame = document.createElement('iframe');
    frame.title = country === 'US' ? 'Sena achievement animation' : '세나 업적 애니메이션';
    frame.src = '/sena-beta-citizen/' + (country === 'US' ? 'play-en.html' : 'play-kr.html');
    stage.appendChild(frame);
    dialog.appendChild(stage);
    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return;
      var data = event.data || {};
      if (data.source !== 'sena-beta-citizen' || data.achievementId !== 'beta-citizen' || data.state !== 'complete') return;
      if (data.productionGrant !== false || data.devOnly !== true) return;
      finish(stage);
    });
    return true;
  }

  window.__saSenaDevCleanup = function () {
    try {
      sessionStorage.removeItem(DEV_KEY);
      sessionStorage.removeItem('sa-dev-beta-citizen:' + country);
    } catch (err) {}
    return { productionGrant: false, cleared: true };
  };

  if (!start()) window.addEventListener('load', start);
})();
