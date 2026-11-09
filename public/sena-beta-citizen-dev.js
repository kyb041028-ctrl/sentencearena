/**
 * beta-citizen 개발 전용 연출.
 * 주소에 devSenaBeta가 있고 로컬 화면일 때만 연다.
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
      list: 'My achievements',
      note: 'Development record. This is not a production grant.',
      earned: 'beta-citizen recorded in the development list.',
      stars: '2 stars',
    }
    : {
      title: '공사 중인데 오셨군요!',
      list: '나의 업적',
      note: '개발용 기록입니다. 운영 지급이 아닙니다.',
      earned: 'beta-citizen을 개발용 목록에 기록했습니다.',
      stars: '별 2개',
    };

  var style = document.createElement('style');
  style.textContent = '#sa-sena-beta{position:fixed;inset:0;z-index:22000;background:#070b16;color:#e8eef8;display:flex;flex-direction:column}#sa-sena-beta iframe{flex:1;width:100%;border:0;background:#070b16}#sa-sena-beta .sa-sena-list{margin:auto;width:min(36rem,92vw);padding:1.2rem;border:1px solid rgba(217,184,120,.7);border-radius:12px;background:#121b34}#sa-sena-beta .sa-sena-row{display:flex;gap:.8rem;align-items:center;margin-top:.8rem}#sa-sena-beta img{width:64px;height:64px}#sa-sena-beta h2{margin:.2rem 0}#sa-sena-beta p{margin:.35rem 0;line-height:1.5}';
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.id = 'sa-sena-beta';
  wrap.dataset.achievementId = 'beta-citizen';
  wrap.dataset.devOnly = 'true';
  wrap.dataset.productionGrant = 'false';
  var frame = document.createElement('iframe');
  frame.title = country === 'US' ? 'Sena achievement animation' : '세나 업적 애니메이션';
  frame.src = '/sena-beta-citizen/' + (country === 'US' ? 'stage-en.html' : 'stage-kr.html');
  wrap.appendChild(frame);
  document.body.appendChild(wrap);

  function listed() {
    var raw = sessionStorage.getItem('sa-dev-beta-citizen:' + country);
    var saved = raw ? JSON.parse(raw) : null;
    if (!saved || saved.achievementId !== 'beta-citizen' || saved.productionGrant !== false) return;
    frame.remove();
    var panel = document.createElement('section');
    panel.className = 'sa-sena-list';
    panel.dataset.listed = 'beta-citizen';
    panel.innerHTML = '<p></p><h2></h2><div class="sa-sena-row"><img alt=""><div><h3></h3><p class="sa-sena-stars"></p><p class="sa-sena-note"></p></div></div>';
    panel.querySelector('p').textContent = pack.earned;
    panel.querySelector('h2').textContent = pack.list;
    panel.querySelector('img').src = '/sena-beta-citizen/assets/production-v04/badge_construction_64.png';
    panel.querySelector('img').alt = country === 'US' ? 'Construction badge' : '공사 상징';
    panel.querySelector('h3').textContent = pack.title;
    panel.querySelector('.sa-sena-stars').textContent = '★★☆☆☆ ' + pack.stars;
    panel.querySelector('.sa-sena-note').textContent = pack.note;
    wrap.appendChild(panel);
  }

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
    listed();
  });
})();
