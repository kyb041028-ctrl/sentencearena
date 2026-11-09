/**
 * 개발용 지도자 선거 화면.
 * 주소에 devLeaderElection이 있을 때만 연다. 실로그인만으로는 열리지 않는다.
 */
(function () {
  'use strict';

  var API = 'http://127.0.0.1:3013';
  var COPY = {
    KR: {
      badge: '개발용 시뮬레이션',
      notLive: '운영 선거가 아닙니다. devAuth, 개발 헤더, 연령 확인 기록은 운영 인증이 아닙니다.',
      title: '지도자 선거',
      testAuth: '이 화면은 테스트 인증입니다. devAuth와 개발 헤더는 운영 인증이 아닙니다.',
      country: '한국',
      pioneer: '진보영토',
      guardian: '보수영토',
      approved: '승인',
      start: '시작',
      end: '종료 시각',
      remaining: '남은 시간',
      turnout: '전체 투표율',
      turnoutNote: '개발용 표시입니다. 전체 투표율 분모는 확정하지 않았습니다.',
      confirm: '확인',
      saved: '선택 접수 완료',
      duplicate: '이미 투표했습니다',
      closed: '종료',
      ineligible: '투표 자격이 없습니다',
      unconfirmed: '동점입니다. 당선 결과는 미확정입니다. 지도자 직위는 부여하지 않습니다.',
      winner: '최다 득표입니다. 지도자 직위는 부여하지 않습니다.',
      hidden: '종료 전에는 후보별 득표수와 득표율을 보여 주지 않습니다.',
      close: '닫기',
    },
    US: {
      badge: 'Development simulation',
      notLive: 'This is not a live election. devAuth, the development header, and an age-policy record are not production authentication.',
      title: 'Leader election',
      testAuth: 'This screen uses test-fixture authentication. devAuth and the development header are not production authentication.',
      country: 'United States',
      pioneer: 'Progressive Territory',
      guardian: 'Conservative Territory',
      approved: 'Approved',
      start: 'Start',
      end: 'End',
      remaining: 'Time left',
      turnout: 'Overall turnout',
      turnoutNote: 'Development display. The overall turnout denominator is not confirmed.',
      confirm: 'Confirm',
      saved: 'Choice recorded',
      duplicate: 'This account already voted',
      closed: 'Closed',
      ineligible: 'This account cannot vote',
      unconfirmed: 'The result is a tie and stays unconfirmed. No leader office is granted.',
      winner: 'This is the highest vote count. No leader office is granted.',
      hidden: 'Candidate totals and shares stay hidden until the election closes.',
      close: 'Close',
    },
  };

  function countryCode() {
    var path = String(location.pathname || '');
    if (path === '/us' || path.indexOf('/us/') === 0) return 'US';
    return 'KR';
  }

  function text(country) {
    return COPY[country] || COPY.KR;
  }

  function landName(country, territory) {
    var node = document.querySelector('[data-sc-tcard="' + territory + '"] .sc-tcard__name');
    var shown = node && String(node.textContent || '').replace(/\s+/g, ' ').trim();
    if (shown) return shown;
    var pack = text(country);
    return territory === 'guardian' ? pack.guardian : pack.pioneer;
  }

  function headers() {
    return { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Election': 'preview' };
  }

  function ensureStyle() {
    if (document.getElementById('sa-leader-election-style')) return;
    var style = document.createElement('style');
    style.id = 'sa-leader-election-style';
    style.textContent = '.sa-le{position:fixed;inset:0;z-index:21000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(2,6,23,.72)}.sa-le__panel{width:min(36rem,100%);max-height:92vh;overflow:auto;background:#0f172a;color:#e2e8f0;border:1px solid rgba(251,191,36,.75);border-radius:12px;padding:1rem}.sa-le__badge{margin:0 0 .35rem;color:#fbbf24;font-weight:700;font-size:.78rem}.sa-le__title{margin:0 0 .4rem;font-size:1.15rem}.sa-le__lead,.sa-le__meta{margin:.35rem 0;line-height:1.5;color:#cbd5e1}.sa-le__choice{min-height:44px;margin:.4rem .4rem 0 0;padding:.45rem .8rem;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit}.sa-le__choice.is-on{border-color:#fbbf24}.sa-le__choice:disabled{opacity:.45}.sa-le__x{float:right;min-height:44px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#e2e8f0}@media (max-width:720px){.sa-le{align-items:flex-end;padding:.5rem}.sa-le__panel{width:100%;border-bottom-left-radius:0;border-bottom-right-radius:0}}';
    document.head.appendChild(style);
  }

  function noticeFor(pack, reason) {
    if (!reason) return pack.saved;
    if (reason === 'DUPLICATE_VOTE') return pack.duplicate;
    if (reason === 'CLOSED') return pack.closed;
    if (reason === 'NOT_ELIGIBLE' || reason === 'US_PARTICIPATION_READ_ONLY' || reason === 'US_AGE_UNVERIFIED') return pack.ineligible;
    return pack.ineligible;
  }

  function render(pack, country, view, notice) {
    ensureStyle();
    var old = document.getElementById('sa-leader-election');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'sa-leader-election';
    wrap.className = 'sa-le';
    var panel = document.createElement('div');
    panel.className = 'sa-le__panel sc-panel sc-card';
    panel.setAttribute('data-territory', view.territory || 'pioneer');
    var hours = Math.floor((view.remainingMs || 0) / 3600000);
    var minutes = Math.floor(((view.remainingMs || 0) % 3600000) / 60000);
    var lines = [
      pack.country + ' · ' + landName(country, view.territory),
      pack.start + ' ' + new Date(view.startsAtMs).toISOString(),
      pack.end + ' ' + new Date(view.endsAtMs).toISOString(),
      pack.remaining + ' ' + hours + ':' + String(minutes).padStart(2, '0'),
      pack.turnout + ' ' + (view.turnoutPct == null ? '—' : view.turnoutPct + '%'),
      pack.turnoutNote,
      pack.testAuth,
    ];
    if (view.countsHidden) lines.push(pack.hidden);
    if (view.status === 'closed') lines.push(pack.closed);
    if (view.result === 'unconfirmed') lines.push(pack.unconfirmed);
    if (view.result === 'plurality') lines.push(pack.winner + ' ' + (view.winnerName || ''));
    if (notice) lines.push(notice);
    panel.innerHTML = '<button type="button" class="sa-le__x sc-btn"></button><p class="sa-le__badge"></p><h2 class="sa-le__title"></h2><p class="sa-le__lead"></p><p class="sa-le__meta"></p>';
    panel.querySelector('.sa-le__x').textContent = pack.close;
    panel.querySelector('.sa-le__badge').textContent = pack.badge;
    panel.querySelector('.sa-le__title').textContent = pack.title;
    panel.querySelector('.sa-le__lead').textContent = pack.notLive;
    panel.querySelector('.sa-le__meta').textContent = lines.join('\n');
    panel.querySelector('.sa-le__meta').style.whiteSpace = 'pre-line';
    panel.querySelector('.sa-le__x').addEventListener('click', function () { wrap.remove(); });
    var selected = '';
    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'sa-le__choice sc-btn';
    confirm.setAttribute('data-confirm', '1');
    confirm.textContent = pack.confirm;
    confirm.disabled = true;
    (view.candidates || []).forEach(function (candidate) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sa-le__choice sc-btn';
      button.setAttribute('data-candidate', candidate.id);
      button.textContent = candidate.name + ' · ' + pack.approved;
      button.disabled = view.status !== 'open' || !!notice;
      button.addEventListener('click', function () {
        if (button.disabled) return;
        selected = candidate.id;
        panel.querySelectorAll('[data-candidate]').forEach(function (item) { item.classList.remove('is-on'); });
        button.classList.add('is-on');
        confirm.disabled = false;
      });
      panel.appendChild(button);
    });
    confirm.addEventListener('click', function () {
      if (!selected || confirm.disabled) return;
      confirm.disabled = true;
      fetch(API + '/dev/leader-election/ballots/' + encodeURIComponent(view.id) + '/votes', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          actor: {
            id: country === 'US' ? 'v0' : 'v0',
            country: country,
            territory: view.territory,
            verified: true,
            authSource: 'test-fixture',
          },
          choice: selected,
          eligibility: country === 'US' ? {
            source: 'test-fixture',
            legalRow: {
              activity_region: 'US',
              age_policy_region: 'US',
              age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
              age_policy_version: 'age-policy-us-v1',
            },
          } : null,
          clockSource: 'test-fixture',
          nowMs: Date.now(),
        }),
      }).then(function (res) { return res.json(); }).then(function (saved) {
        return fetch(API + '/dev/leader-election/elections/' + encodeURIComponent(new URLSearchParams(location.search).get('electionId')), { headers: headers() }).then(function (res) { return res.json(); }).then(function (fresh) {
          if (!fresh || !fresh.publicView || fresh.publicView.productionAuth !== false) throw new Error('auth');
          render(pack, country, fresh.publicView, saved && saved.ok ? pack.saved : noticeFor(pack, saved && saved.reason));
        });
      }).catch(function () {
        render(pack, country, view, pack.ineligible);
      });
    });
    if ((view.candidates || []).length) panel.appendChild(confirm);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    if (!params.get('devLeaderElection')) return;
    var country = countryCode();
    var pack = text(country);
    var electionId = params.get('electionId') || '';
    fetch(API + '/dev/leader-election/elections/' + encodeURIComponent(electionId), { headers: headers() })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (!body || !body.publicView || body.publicView.productionAuth !== false) throw new Error('auth');
        render(pack, country, body.publicView, '');
      })
      .catch(function () {
        ensureStyle();
        var wrap = document.createElement('div');
        wrap.id = 'sa-leader-election';
        wrap.className = 'sa-le';
        wrap.innerHTML = '<div class="sa-le__panel sc-panel"><p class="sa-le__badge"></p><p class="sa-le__lead"></p></div>';
        wrap.querySelector('.sa-le__badge').textContent = pack.badge;
        wrap.querySelector('.sa-le__lead').textContent = pack.notLive;
        document.body.appendChild(wrap);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
