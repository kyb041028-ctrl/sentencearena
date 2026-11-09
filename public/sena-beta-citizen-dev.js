/**
 * beta-citizen 개발 전용 연출.
 * 주소에 devSenaBeta가 있고 로컬 화면일 때만, 기존 업적 목록 패널 안에서 연다.
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
      title: 'You Caught Us Building!',
      note: 'Development record. This is not a production grant.',
      stars: '2 stars',
    }
    : {
      title: '공사 중인데 오셨군요!',
      note: '개발용 기록입니다. 운영 지급이 아닙니다.',
      stars: '별 2개',
    };

  function definitionName(def) {
    if (!def) return '';
    if (def.id === 'beta-citizen') return pack.title;
    if (country === 'US' && typeof window.getAchievementLocalizedCopy === 'function') {
      var copy = window.getAchievementLocalizedCopy(def.id, 'US');
      if (copy && copy.name) return copy.name;
    }
    return String(def.name || def.id || '');
  }

  function paintList(recorded) {
    var list = document.getElementById('sc-achievement-history-list');
    var defs = window.ACHIEVEMENT_DEFINITIONS || [];
    if (!list || defs.length !== 12) return false;
    list.innerHTML = '';
    defs.forEach(function (def) {
      var row = document.createElement('div');
      row.className = 'sc-achievement-history-row';
      row.dataset.achievementId = def.id;
      var name = document.createElement('span');
      name.className = 'sc-achievement-history-row__name';
      name.textContent = definitionName(def);
      row.appendChild(name);
      if (recorded && def.id === 'beta-citizen') {
        row.dataset.listed = 'beta-citizen';
        var icon = document.createElement('img');
        icon.src = '/sena-beta-citizen/assets/production-v04/badge_construction_64.png';
        icon.alt = country === 'US' ? 'Construction badge' : '공사 상징';
        icon.width = 40;
        icon.height = 40;
        row.insertBefore(icon, name);
        var meta = document.createElement('span');
        meta.className = 'sc-achievement-history-row__meta';
        meta.textContent = '★★☆☆☆ ' + pack.stars + ' · ' + pack.note;
        var text = document.createElement('span');
        text.className = 'sc-achievement-history-row__content';
        text.appendChild(name);
        text.appendChild(meta);
        row.appendChild(text);
      }
      list.appendChild(row);
    });
    return true;
  }

  function start() {
    if (typeof window.openFeaturedAchievementPanel !== 'function') return false;
    window.openFeaturedAchievementPanel();
    var panel = document.getElementById('sc-featured-achievement-panel');
    var dialog = panel && panel.querySelector('.sc-featured-achievement-panel__dialog');
    if (!panel || !dialog || !paintList(false)) return false;
    panel.classList.add('is-sena-dev');
    var style = document.createElement('style');
    style.textContent = '#sc-featured-achievement-panel.is-sena-dev .sc-featured-achievement-panel__dialog{width:min(44rem,96vw);max-height:92vh;min-height:78vh}#sa-sena-stage{position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);width:min(34rem,86%);height:48%;z-index:3;overflow:hidden;border:1px solid rgba(217,184,120,.8);border-radius:12px;background:#070b16;box-shadow:0 18px 48px rgba(0,0,0,.5)}#sa-sena-stage iframe{width:100%;height:100%;border:0;background:#070b16}#sc-featured-achievement-panel.is-sena-dev .sc-achievement-history-row img{width:40px;height:40px;margin-right:.55rem}';
    document.head.appendChild(style);
    var stage = document.createElement('div');
    stage.id = 'sa-sena-stage';
    stage.dataset.achievementId = 'beta-citizen';
    stage.dataset.devOnly = 'true';
    stage.dataset.productionGrant = 'false';
    var frame = document.createElement('iframe');
    frame.title = country === 'US' ? 'Sena achievement animation' : '세나 업적 애니메이션';
    frame.src = '/sena-beta-citizen/' + (country === 'US' ? 'play-en.html' : 'play-kr.html') + (params.get('senaHold') ? '?hold=1' : '');
    stage.appendChild(frame);
    dialog.appendChild(stage);
    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return;
      var data = event.data || {};
      if (data.source !== 'sena-beta-citizen' || data.achievementId !== 'beta-citizen' || data.state !== 'complete') return;
      if (data.productionGrant !== false || data.devOnly !== true) return;
      sessionStorage.setItem('sa-dev-beta-citizen:' + country, JSON.stringify({
        achievementId: 'beta-citizen',
        country: country,
        devOnly: true,
        productionGrant: false,
      }));
      stage.remove();
      paintList(true);
    });
    return true;
  }

  if (!start()) window.addEventListener('load', start);
})();
