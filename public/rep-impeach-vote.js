/**
 * 개발용 대표 탄핵투표 화면.
 * 주소에 devRepImpeachVote가 있을 때만 연다. 실로그인만으로는 열리지 않는다.
 * 개발용 시뮬레이션이며 운영 투표가 아니다.
 */
(function () {
  'use strict';

  var API = 'http://127.0.0.1:3012';
  var COPY = {
    KR: {
      badge: '개발용 시뮬레이션',
      notLive: '운영 투표가 아닙니다. devAuth, 개발 헤더, 연령 확인 기록은 운영 인증이 아닙니다.',
      title: '대표 탄핵투표',
      yes: '찬성',
      no: '반대',
      abstain: '기권',
      citizen: '시민은 투표할 수 없습니다. 현직 대표만 찬성하거나 반대할 수 있습니다.',
      submitting: '제출 중',
      savedYes: '찬성 접수 완료',
      savedNo: '반대 접수 완료',
      savedAbstain: '기권 접수 완료',
      duplicate: '이미 투표했습니다',
      voteError: '오류',
      closed: '마감',
      halted: '중단',
      testAuth: '이 표는 테스트 인증입니다. devAuth와 개발 헤더는 운영 인증이 아닙니다.',
      leader: '대상 지도자',
      proposer: '발의자',
      country: '한국',
      pioneer: '진보영토',
      guardian: '보수영토',
      remaining: '남은 시간',
      turnout: '전체 투표율',
      passed: '가결. 시민 탄핵투표 대기입니다. 시민 투표는 열리지 않습니다.',
      failed: '부결. 같은 지도자는 28일 동안 다시 발의할 수 없습니다.',
      hidden: '진행 중에는 찬성·반대 수를 보여 주지 않습니다.',
      close: '닫기',
    },
    US: {
      badge: 'Development simulation',
      notLive: 'This is not a live vote. devAuth, the development header, and an age-policy record are not production authentication.',
      title: 'Representative impeachment vote',
      yes: 'Yes',
      no: 'No',
      abstain: 'Abstain',
      citizen: 'A citizen cannot vote. Only a current representative can vote yes or no.',
      submitting: 'Submitting',
      savedYes: 'Yes recorded',
      savedNo: 'No recorded',
      savedAbstain: 'Abstain recorded',
      duplicate: 'This account already voted',
      voteError: 'Error',
      closed: 'Closed',
      halted: 'Halted',
      testAuth: 'This ballot uses test-fixture authentication. devAuth and the development header are not production authentication.',
      leader: 'Sitting leader',
      proposer: 'Proposer',
      country: 'United States',
      pioneer: 'Progressive Territory',
      guardian: 'Conservative Territory',
      remaining: 'Time left',
      turnout: 'Overall turnout',
      passed: 'Passed. Waiting for the citizen impeachment vote. That vote is not open.',
      failed: 'Failed. The same leader cannot be proposed again for 28 days.',
      hidden: 'Yes and no totals stay hidden while the vote is open.',
      close: 'Close',
    },
  };

  function countryCode() {
    var path = String(location.pathname || '');
    if (path === '/us' || path.indexOf('/us/') === 0) return 'US';
    return 'KR';
  }

  function mode() {
    return new URLSearchParams(location.search).get('devRepImpeachVote');
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
    return { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Vote': 'preview' };
  }

  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) }).then(function (res) { return res.json(); });
  }

  function ensureStyle() {
    if (document.getElementById('sa-rep-vote-style')) return;
    var style = document.createElement('style');
    style.id = 'sa-rep-vote-style';
    style.textContent = '.sa-rv{position:fixed;inset:0;z-index:21000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(2,6,23,.72)}.sa-rv__panel{width:min(36rem,100%);max-height:92vh;overflow:auto;background:#0f172a;color:#e2e8f0;border:1px solid rgba(251,191,36,.75);border-radius:12px;padding:1rem}.sa-rv__badge{margin:0 0 .35rem;color:#fbbf24;font-weight:700;font-size:.78rem}.sa-rv__title{margin:0 0 .4rem;font-size:1.15rem}.sa-rv__lead,.sa-rv__meta,.sa-rv__line{margin:.35rem 0;line-height:1.5;color:#cbd5e1}.sa-rv__choice{min-height:44px;margin:.4rem .4rem 0 0;padding:.45rem .8rem;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit}.sa-rv__choice:disabled{opacity:.45}.sa-rv__x{float:right;min-height:44px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#e2e8f0}@media (max-width:720px){.sa-rv{align-items:flex-end;padding:.5rem}.sa-rv__panel{width:100%;border-bottom-left-radius:0;border-bottom-right-radius:0}}';
    document.head.appendChild(style);
  }

  function actor(country, citizen) {
    var territory = country === 'US' ? 'guardian' : 'pioneer';
    return {
      id: citizen ? 'citizen-1' : (country === 'US' ? 'u1' : 'r1'),
      name: citizen ? (country === 'US' ? 'Jordan' : '민재') : (country === 'US' ? 'Morgan' : '한결'),
      country: country,
      territory: territory,
      office: citizen ? 'citizen' : 'representative',
      verified: true,
      authSource: 'test-fixture',
    };
  }

  function noticeFor(pack, reason, choice) {
    if (reason === 'DUPLICATE_VOTE') return pack.duplicate;
    if (reason === 'CLOSED') return pack.closed;
    if (reason === 'HALTED') return pack.halted;
    if (reason === 'VOTE_ERROR' || reason === 'AUTH_UNVERIFIED' || reason === 'DEV_AUTH_NOT_PRODUCTION' || reason === 'PRODUCTION_AUTH_NOT_CONNECTED') return pack.voteError;
    if (choice === 'yes') return pack.savedYes;
    if (choice === 'no') return pack.savedNo;
    if (choice === 'abstain') return pack.savedAbstain;
    return '';
  }

  function render(pack, country, view, citizen, notice, onChoice) {
    ensureStyle();
    var old = document.getElementById('sa-rep-vote');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'sa-rep-vote';
    wrap.className = 'sa-rv';
    var panel = document.createElement('div');
    panel.className = 'sa-rv__panel sc-panel sc-card';
    panel.setAttribute('data-territory', view.territory);
    var hours = Math.floor(view.remainingMs / 3600000);
    var minutes = Math.floor((view.remainingMs % 3600000) / 60000);
    var lines = [
      pack.leader + ' ' + view.leaderName,
      pack.proposer + ' ' + view.proposerName,
      pack.country + ' · ' + landName(country, view.territory),
      pack.remaining + ' ' + hours + ':' + String(minutes).padStart(2, '0'),
      pack.turnout + ' ' + (view.turnoutPct == null ? '—' : view.turnoutPct + '%'),
    ];
    lines.push(pack.testAuth);
    if (view.countsHidden) lines.push(pack.hidden);
    if (view.status === 'closed') lines.push(pack.closed);
    if (view.status === 'error') lines.push(pack.voteError);
    if (view.status === 'halted') lines.push(pack.halted);
    if (view.status === 'closed' && view.result === 'passed') lines.push(pack.passed);
    if (view.status === 'closed' && view.result === 'failed') lines.push(pack.failed);
    if (notice) lines.push(notice);
    panel.innerHTML = '<button type="button" class="sa-rv__x sc-btn"></button><p class="sa-rv__badge"></p><h2 class="sa-rv__title"></h2><p class="sa-rv__lead"></p><p class="sa-rv__meta"></p>';
    panel.querySelector('.sa-rv__x').textContent = pack.close;
    panel.querySelector('.sa-rv__badge').textContent = pack.badge;
    panel.querySelector('.sa-rv__title').textContent = pack.title;
    panel.querySelector('.sa-rv__lead').textContent = pack.notLive;
    panel.querySelector('.sa-rv__meta').textContent = lines.join('\n');
    panel.querySelector('.sa-rv__meta').style.whiteSpace = 'pre-line';
    panel.querySelector('.sa-rv__x').addEventListener('click', function () { wrap.remove(); });
    var buttons = [];
    ['yes', 'no', 'abstain'].forEach(function (choice) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sa-rv__choice sc-btn';
      button.setAttribute('data-choice', choice);
      button.setAttribute('data-territory', view.territory);
      button.textContent = pack[choice];
      button.disabled = citizen || view.status !== 'open' || !!notice;
      button.addEventListener('click', function () {
        if (button.disabled) return;
        buttons.forEach(function (item) { item.disabled = true; });
        onChoice(choice);
      });
      buttons.push(button);
      panel.appendChild(button);
    });
    if (citizen) {
      var reason = document.createElement('p');
      reason.className = 'sa-rv__line';
      reason.textContent = pack.citizen;
      panel.appendChild(reason);
    }
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }

  function loadView(ballotId) {
    return fetch(API + '/dev/rep-impeach-vote/ballots/' + encodeURIComponent(ballotId), { headers: headers() }).then(function (res) { return res.json(); });
  }

  function boot() {
    var selected = mode();
    if (!selected) return;
    var country = countryCode();
    var pack = text(country);
    var territory = country === 'US' ? 'guardian' : 'pioneer';
    var citizen = selected === 'citizen';
    var params = new URLSearchParams(location.search);
    var proposalId = params.get('proposalId') || '';
    var startsAtMs = Date.now() - 60 * 60 * 1000;
    var ballotId = '';
    function paint(view, notice) {
      render(pack, country, view, citizen, notice, function (choice) {
        var status = document.querySelector('.sa-rv__meta');
        if (status) status.textContent = status.textContent + '\n' + pack.submitting;
        post('/dev/rep-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', {
          actor: actor(country, citizen),
          choice: choice,
          clockSource: 'test-fixture',
          nowMs: Date.now(),
        }).then(function (saved) {
          return loadView(ballotId).then(function (fresh) {
            var viewNext = fresh && fresh.publicView;
            if (!viewNext) throw new Error('reload failed');
            var note = saved && saved.ok ? noticeFor(pack, null, choice) : noticeFor(pack, saved && saved.reason, null);
            paint(viewNext, note || pack.voteError);
          });
        }).catch(function () {
          paint(view, pack.voteError);
        });
      });
    }
    post('/dev/rep-impeach-vote/ballots', {
      proposalId: proposalId,
      startsAtMs: startsAtMs,
      clockSource: 'test-fixture',
      nowMs: Date.now(),
      eligibleRepresentativeIds: ['client-must-not-count'],
    }).then(function (opened) {
      ballotId = opened && opened.ballotId;
      if (!ballotId) throw new Error(opened && opened.reason ? opened.reason : 'no ballot');
      return loadView(ballotId);
    }).then(function (body) {
      if (!body || !body.publicView || body.publicView.productionAuth !== false) throw new Error('auth');
      paint(body.publicView, '');
    }).catch(function () {
      ensureStyle();
      var wrap = document.createElement('div');
      wrap.id = 'sa-rep-vote';
      wrap.className = 'sa-rv';
      wrap.innerHTML = '<div class="sa-rv__panel sc-panel"><p class="sa-rv__badge"></p><p class="sa-rv__lead"></p></div>';
      wrap.querySelector('.sa-rv__badge').textContent = pack.badge;
      wrap.querySelector('.sa-rv__lead').textContent = pack.notLive + ' ' + pack.testAuth;
      document.body.appendChild(wrap);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
