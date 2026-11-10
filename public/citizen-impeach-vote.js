/**
 * 개발용 시민 탄핵투표 화면.
 * 주소에 devCitizenImpeachVote가 있을 때만 연다. 실로그인만으로는 열리지 않는다.
 * 개발 헤더와 passed 표시는 운영 가결이 아니다.
 */
(function () {
  'use strict';

  var API = 'http://127.0.0.1:3015';
  var COPY = {
    KR: {
      badge: '개발용 시뮬레이션',
      notLive: '운영 탄핵이 아닙니다. 개발 헤더와 테스트 기록은 운영 인증이 아닙니다.',
      title: '시민 탄핵투표',
      yes: '찬성',
      no: '반대',
      leader: '대상 지도자',
      scope: '국가·영토',
      reason: '사유',
      start: '시작',
      end: '종료',
      remaining: '남은 시간',
      turnout: '전체 투표율',
      turnoutNote: '전체 투표율은 개설 때 고정한 유권자 명부 기준입니다. 가결에 필요한 20%와 같은 분모입니다.',
      hidden: '진행 중에는 찬성·반대 수와 비율을 보여 주지 않습니다.',
      confirm: '확인',
      done: '완료',
      duplicate: '이미 투표했습니다.',
      ineligible: '투표 자격이 없습니다.',
      closed: '마감되었습니다.',
      passed: '최종 가결. 개발용 해임 기록만 남고 운영 직위는 바꾸지 않습니다.',
      failed: '최종 부결.',
      submitting: '서버에 저장하는 중',
      close: '닫기',
      country: '한국',
      pioneer: '진보영토',
      guardian: '보수영토',
    },
    US: {
      badge: 'Development simulation',
      notLive: 'This is not a live impeachment. The development header and test records are not production authentication.',
      title: 'Citizen impeachment vote',
      yes: 'Yes',
      no: 'No',
      leader: 'Sitting leader',
      scope: 'Country and territory',
      reason: 'Reason',
      start: 'Start',
      end: 'End',
      remaining: 'Time left',
      turnout: 'Overall turnout',
      turnoutNote: 'Overall turnout uses the voter roll fixed when the vote opened. That is the same denominator as the 20% requirement.',
      hidden: 'Yes and no totals and shares stay hidden while the vote is open.',
      confirm: 'Confirm',
      done: 'Done',
      duplicate: 'This account already voted.',
      ineligible: 'This account cannot vote.',
      closed: 'The vote is closed.',
      passed: 'Final result: passed. Only a development removal record is stored. No production office changes.',
      failed: 'Final result: failed.',
      submitting: 'Saving on the server',
      close: 'Close',
      country: 'United States',
      pioneer: 'Progressive Territory',
      guardian: 'Conservative Territory',
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
    return { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Citizen-Vote': 'preview' };
  }

  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) }).then(function (res) { return res.json(); });
  }

  function loadView(ballotId) {
    return fetch(API + '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId), { headers: headers() }).then(function (res) { return res.json(); });
  }

  function ensureStyle() {
    if (document.getElementById('sa-citizen-impeach-style')) return;
    var style = document.createElement('style');
    style.id = 'sa-citizen-impeach-style';
    style.textContent = '.sa-ci{position:fixed;inset:0;z-index:21000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(2,6,23,.72)}.sa-ci__panel{width:min(36rem,100%);max-height:92vh;overflow:auto;background:#0f172a;color:#e2e8f0;border:1px solid rgba(251,191,36,.75);border-radius:12px;padding:1rem}.sa-ci__badge{margin:0 0 .35rem;color:#fbbf24;font-weight:700;font-size:.78rem}.sa-ci__title{margin:0 0 .4rem;font-size:1.15rem}.sa-ci__lead,.sa-ci__meta{margin:.35rem 0;line-height:1.5;color:#cbd5e1}.sa-ci__choice{min-height:44px;margin:.4rem .4rem 0 0;padding:.45rem .8rem;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit}.sa-ci__choice.is-on{border-color:#fbbf24}.sa-ci__choice:disabled{opacity:.45}.sa-ci__x{float:right;min-height:44px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#e2e8f0}@media (max-width:720px){.sa-ci{align-items:flex-end;padding:.5rem}.sa-ci__panel{width:100%;border-bottom-left-radius:0;border-bottom-right-radius:0}}';
    document.head.appendChild(style);
  }

  function noticeFor(pack, reason, choice) {
    if (reason === 'DUPLICATE_VOTE') return pack.duplicate;
    if (reason === 'NOT_ELIGIBLE' || reason === 'US_AGE_UNVERIFIED' || reason === 'US_PARTICIPATION_READ_ONLY' || reason === 'CROSS_SCOPE') return pack.ineligible;
    if (reason === 'CLOSED' || reason === 'NOT_STARTED') return pack.closed;
    if (!reason && choice) return pack.done;
    return pack.ineligible;
  }

  function linesFor(pack, country, view, notice) {
    var hours = Math.floor((view.remainingMs || 0) / 3600000);
    var minutes = Math.floor(((view.remainingMs || 0) % 3600000) / 60000);
    var lines = [
      pack.leader + ' ' + (view.leaderName || ''),
      pack.scope + ' ' + pack.country + ' · ' + landName(country, view.territory),
      pack.reason + ' ' + (view.reason || ''),
      pack.start + ' ' + new Date(view.startsAtMs).toISOString(),
      pack.end + ' ' + new Date(view.endsAtMs).toISOString(),
      pack.remaining + ' ' + hours + ':' + String(minutes).padStart(2, '0'),
      pack.turnout + ' ' + (view.turnoutText || '0%') + ' ' + (view.turnoutRatio || ''),
      pack.turnoutNote,
    ];
    if (view.countsHidden) lines.push(pack.hidden);
    if (!view.countsHidden) lines.push(pack.yes + ' ' + view.yes + ' / ' + pack.no + ' ' + view.no);
    if (view.status === 'closed' && view.result === 'passed') lines.push(pack.passed);
    if (view.status === 'closed' && view.result === 'failed') lines.push(pack.failed);
    if (view.status === 'closed') lines.push(pack.closed);
    if (notice) lines.push(notice);
    return lines;
  }

  function render(pack, country, view, notice, onChoice) {
    ensureStyle();
    var old = document.getElementById('sa-citizen-impeach');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'sa-citizen-impeach';
    wrap.className = 'sa-ci';
    var panel = document.createElement('div');
    panel.className = 'sa-ci__panel sc-panel sc-card';
    panel.setAttribute('data-territory', view.territory || 'pioneer');
    panel.innerHTML = '<button type="button" class="sa-ci__x sc-btn"></button><p class="sa-ci__badge"></p><h2 class="sa-ci__title"></h2><p class="sa-ci__lead"></p><p class="sa-ci__meta"></p>';
    panel.querySelector('.sa-ci__x').textContent = pack.close;
    panel.querySelector('.sa-ci__badge').textContent = pack.badge;
    panel.querySelector('.sa-ci__title').textContent = pack.title;
    panel.querySelector('.sa-ci__lead').textContent = pack.notLive;
    panel.querySelector('.sa-ci__meta').textContent = linesFor(pack, country, view, notice).join('\n');
    panel.querySelector('.sa-ci__meta').style.whiteSpace = 'pre-line';
    panel.querySelector('.sa-ci__x').addEventListener('click', function () { wrap.remove(); });
    var selected = '';
    ['yes', 'no'].forEach(function (choice) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sa-ci__choice sc-btn';
      button.setAttribute('data-choice', choice);
      button.textContent = pack[choice];
      button.disabled = view.status !== 'open' || !!notice;
      button.addEventListener('click', function () {
        if (button.disabled) return;
        selected = choice;
        panel.querySelectorAll('[data-choice]').forEach(function (item) { item.classList.remove('is-on'); });
        button.classList.add('is-on');
        confirm.disabled = false;
      });
      panel.appendChild(button);
    });
    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'sa-ci__choice sc-btn';
    confirm.setAttribute('data-confirm', '1');
    confirm.textContent = pack.confirm;
    confirm.disabled = true;
    confirm.addEventListener('click', function () {
      if (!selected || confirm.disabled) return;
      confirm.disabled = true;
      var status = panel.querySelector('.sa-ci__meta');
      status.textContent = status.textContent + '\n' + pack.submitting;
      onChoice(selected);
    });
    panel.appendChild(confirm);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    if (params.get('devCitizenImpeachVote') !== '1') return;
    var country = countryCode();
    var pack = text(country);
    var proposalId = params.get('proposalId') || '';
    var ballotId = '';
    function paint(view, notice) {
      render(pack, country, view, notice, function (choice) {
        var actor = {
          id: 'v0',
          country: country,
          territory: view.territory,
          verified: true,
          authSource: 'test-fixture',
        };
        var body = { actor: actor, choice: choice, clockSource: 'test-fixture', nowMs: Date.now() };
        if (country === 'US') {
          body.eligibility = {
            source: 'test-fixture',
            legalRow: {
              activity_region: 'US',
              age_policy_region: 'US',
              age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
              age_policy_version: 'age-policy-us-v1',
            },
          };
        }
        post('/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', body).then(function (saved) {
          return loadView(ballotId).then(function (fresh) {
            if (!fresh || !fresh.publicView || fresh.publicView.productionAuth !== false) throw new Error('reload');
            paint(fresh.publicView, saved && saved.ok ? noticeFor(pack, null, choice) : noticeFor(pack, saved && saved.reason, null));
          });
        }).catch(function () {
          paint(view, pack.ineligible);
        });
      });
    }
    var records = [];
    for (var i = 0; i < 5; i += 1) {
      records.push({ id: 'v' + i, country: country, territory: country === 'US' ? 'guardian' : 'pioneer', valid: true, lastPostAtMs: Date.now() - 1000 });
    }
    post('/dev/citizen-impeach-vote/ballots', {
      proposalId: proposalId,
      passed: true,
      voterIds: ['forged-voter'],
      eligibleCount: 99999,
      population: { source: 'test-fixture', records: records },
      clockSource: 'test-fixture',
      nowMs: Date.now(),
    }).then(function (opened) {
      if (!opened || !opened.ballot || !opened.ballot.id) throw new Error(opened && opened.reason ? opened.reason : 'closed');
      if (!opened.ok && opened.reason !== 'BALLOT_EXISTS') throw new Error(opened.reason);
      ballotId = opened.ballot.id;
      return loadView(ballotId);
    }).then(function (body) {
      if (!body || !body.publicView || body.publicView.productionAuth !== false) throw new Error('auth');
      paint(body.publicView, '');
    }).catch(function () {
      ensureStyle();
      var wrap = document.createElement('div');
      wrap.id = 'sa-citizen-impeach';
      wrap.className = 'sa-ci';
      wrap.innerHTML = '<div class="sa-ci__panel sc-panel"><p class="sa-ci__badge"></p><p class="sa-ci__lead"></p></div>';
      wrap.querySelector('.sa-ci__badge').textContent = pack.badge;
      wrap.querySelector('.sa-ci__lead').textContent = pack.notLive;
      document.body.appendChild(wrap);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
