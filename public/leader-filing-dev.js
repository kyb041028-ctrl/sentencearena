/**
 * 개발 인증이 있는 주소에서만 후보 등록·탄핵 발의 화면을 연다.
 * devAuth와 개발 헤더는 운영 인증이 아니다.
 * 등록 기간의 날짜는 이 화면이 정하지 않는다. 기간이 없으면 신청을 열지 않는다.
 * 투표, 당선, 탄핵 확정은 하지 않는다.
 */
(function () {
  'use strict';

  var API = 'http://127.0.0.1:3011';
  var COPY = {
    KR: {
      badge: '개발용 인증',
      notAuth: 'devAuth와 개발 헤더는 운영 인증이 아닙니다. 연령 자격은 테스트 대역이며 운영 인증이 아닙니다.',
      notLive: '운영 선거가 아닙니다. 신청과 접수만 개발 서버에서 확인합니다.',
      noDates: '등록 기간의 날짜는 정해져 있지 않습니다. 밖에서 열림을 넣은 경우에만 신청할 수 있습니다.',
      filingTitle: '지도자 후보 등록',
      impeachTitle: '탄핵 발의',
      country: '국가',
      territory: '영토',
      applicant: '신청자',
      proposer: '발의자',
      officeRep: '현직 대표',
      officeOther: '대표 아님',
      intent: '출마 의사를 확인합니다',
      submit: '등록 접수',
      propose: '발의 접수',
      reasonLabel: '발의 사유',
      close: '닫기',
      status: '접수 상태',
      history: '등록 내역',
      received: '접수 완료',
      next: '다음 단계',
      nextSentence: '대표 투표 24시간으로 이어집니다. 이 화면에서 투표하지 않습니다.',
      leader: '대상 지도자',
      countryKR: '한국',
      countryUS: '미국',
      disconnected: '개발 서버에 연결되지 않았습니다. 신청을 열지 않습니다.',
      reasons: {
        DEV_AUTH_REQUIRED: '개발 인증이 없습니다. 권한 없는 계정입니다.',
        NOT_REPRESENTATIVE: '자격 미달. 현직 대표만 할 수 있습니다.',
        TERRITORY_NOT_ELIGIBLE: '중앙광장과 외계영토에는 지도자 후보 등록이 없습니다.',
        CROSS_SCOPE: '다른 국가나 영토 계정으로는 신청할 수 없습니다.',
        DUPLICATE_CANDIDACY: '중복 신청. 이미 등록된 신청이 있습니다.',
        FILING_WINDOW_UNCONFIRMED: '등록 기간이 미확정입니다. 신청할 수 없습니다.',
        OUTSIDE_WINDOW: '등록 마감. 등록 기간 밖입니다.',
        NO_SITTING_LEADER: '현직 지도자가 없습니다. 발의할 수 없습니다.',
        REPROPOSAL_BLOCKED_28D: '같은 지도자는 부결 뒤 28일 동안 다시 발의할 수 없습니다.',
        PROCEDURE_CONFLICT: '진행 중인 탄핵이 있어 발의할 수 없습니다.',
        REASON_REQUIRED: '발의 사유가 필요합니다.',
        INTENT_NOT_CONFIRMED: '출마 의사를 확인해야 신청할 수 있습니다.',
        US_PARTICIPATION_READ_ONLY: '한국 만 14~17세 계정은 미국 영역을 읽기만 할 수 있습니다. 후보 등록과 탄핵 발의는 할 수 없습니다.',
        US_AGE_UNVERIFIED: '연령·참여 자격을 확인할 수 없어 신청할 수 없습니다.',
      },
    },
    US: {
      badge: 'Development authorization',
      notAuth: 'devAuth and the development header are not production authentication. Age eligibility here is a test fixture, not production authentication.',
      notLive: 'This is not a live election. The development server only checks filing and receipt.',
      noDates: 'This screen does not set filing dates. Filing opens only when an outside signal says the period is open.',
      filingTitle: 'Leader candidate filing',
      impeachTitle: 'Impeachment proposal',
      country: 'Country',
      territory: 'Territory',
      applicant: 'Applicant',
      proposer: 'Proposer',
      officeRep: 'Current representative',
      officeOther: 'Not a representative',
      intent: 'I confirm that I want to run',
      submit: 'Submit filing',
      propose: 'Submit proposal',
      reasonLabel: 'Reason',
      close: 'Close',
      status: 'Receipt status',
      history: 'Filing record',
      received: 'Filing received',
      next: 'Next step',
      nextSentence: 'This continues to the 24-hour representative vote step. This screen does not take votes.',
      leader: 'Sitting leader',
      countryKR: 'Korea',
      countryUS: 'United States',
      disconnected: 'The development server is not connected. Filing stays closed.',
      reasons: {
        DEV_AUTH_REQUIRED: 'Development authorization is missing. This account has no authority.',
        NOT_REPRESENTATIVE: 'Not qualified. Only a current representative can do this.',
        TERRITORY_NOT_ELIGIBLE: 'Central Plaza and Alien Territory have no leader filing.',
        CROSS_SCOPE: 'An account from another country or territory cannot file.',
        DUPLICATE_CANDIDACY: 'Duplicate filing. A filing is already open.',
        FILING_WINDOW_UNCONFIRMED: 'The filing period is not set. Filing is not allowed.',
        OUTSIDE_WINDOW: 'Filing is closed. The period is not open.',
        NO_SITTING_LEADER: 'There is no sitting leader. A proposal cannot be filed.',
        REPROPOSAL_BLOCKED_28D: 'The same leader cannot be proposed again for 28 days after a failure.',
        PROCEDURE_CONFLICT: 'An impeachment is already in progress.',
        REASON_REQUIRED: 'A reason is required.',
        INTENT_NOT_CONFIRMED: 'Confirm the intent to run before filing.',
        US_PARTICIPATION_READ_ONLY: 'A Korean account aged 14 to 17 can only read the United States area. Candidate filing and impeachment proposals are not allowed.',
        US_AGE_UNVERIFIED: 'Age and participation eligibility could not be verified. Filing is not allowed.',
      },
    },
  };

  function countryCode() {
    var path = String(location.pathname || '');
    if (path === '/us' || path.indexOf('/us/') === 0) return 'US';
    return 'KR';
  }

  function scenario() {
    return new URLSearchParams(location.search).get('devLeaderFiling');
  }

  function text(country) {
    return COPY[country] || COPY.KR;
  }

  function reasonText(country, code) {
    var pack = text(country).reasons;
    return pack[code] || code;
  }

  function placeName(pack, country) {
    return country === 'US' ? pack.countryUS : pack.countryKR;
  }

  function landName(territory) {
    var node = document.querySelector('[data-sc-tcard="' + territory + '"] .sc-tcard__name');
    var shown = node && String(node.textContent || '').replace(/\s+/g, ' ').trim();
    if (shown) return shown;
    var labels = window.ActivityRegionCore && window.ActivityRegionCore.US_TERRITORY_LABELS;
    if (countryCode() === 'US' && labels && labels[territory]) return labels[territory];
    if (territory === 'guardian') return '보수영토';
    if (territory === 'pioneer') return '진보영토';
    return territory;
  }

  function actorFor(country, mode) {
    var territory = country === 'US' ? 'guardian' : 'pioneer';
    var representative = {
      id: 'dev-rep-' + country + '-' + territory,
      name: country === 'US' ? 'Morgan' : '한결',
      country: country,
      territory: territory,
      office: 'representative',
      devAuth: true,
    };
    if (mode === 'filing-blocked' || mode === 'rejected') {
      return {
        id: 'dev-citizen-' + country,
        name: country === 'US' ? 'Jordan' : '민재',
        country: country,
        territory: territory,
        office: 'citizen',
        devAuth: true,
      };
    }
    if (mode === 'filing-unauthorized') {
      representative.devAuth = false;
      representative.name = country === 'US' ? 'Jordan' : '민재';
      return representative;
    }
    if (mode === 'impeach-second') {
      return {
        id: 'dev-rep-' + country + '-' + territory + '-2',
        name: country === 'US' ? 'Riley' : '오름',
        country: country,
        territory: territory,
        office: 'representative',
        devAuth: true,
      };
    }
    if (mode === 'filing-cross') {
      return {
        id: 'dev-rep-other-country',
        name: country === 'US' ? '한결' : 'Morgan',
        country: country === 'US' ? 'KR' : 'US',
        territory: country === 'US' ? 'pioneer' : 'guardian',
        office: 'representative',
        devAuth: true,
      };
    }
    return representative;
  }

  function leaderFor(country, mode) {
    if (mode === 'impeach-blocked') return null;
    var territory = country === 'US' ? 'guardian' : 'pioneer';
    return {
      id: 'dev-leader-' + country + '-' + territory,
      name: country === 'US' ? 'Avery' : '가온',
      country: country,
      territory: territory,
    };
  }

  function eligibilityFor(mode) {
    var minor = mode === 'filing-kr-minor' || mode === 'impeach-kr-minor';
    return {
      source: 'test-fixture',
      legalRow: minor ? {
        activity_region: 'KR',
        age_policy_region: 'KR',
        age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
        age_policy_version: 'age-policy-v1',
        usParticipation: 'read-only',
      } : {
        activity_region: 'US',
        age_policy_region: 'US',
        age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
        age_policy_version: 'age-policy-us-v1',
      },
    };
  }

  function payload(country, mode, extra) {
    var territory = country === 'US' ? 'guardian' : 'pioneer';
    var impeach = mode.indexOf('impeach') === 0;
    var windowSpec = null;
    if (mode === 'filing-open') windowSpec = { provided: true, open: true };
    if (mode === 'filing-closed') windowSpec = { provided: true, open: false };
    var body = {
      actor: actorFor(country, mode),
      country: country,
      territory: territory,
      nowMs: Date.now(),
      leader: impeach ? leaderFor(country, mode) : null,
      reason: impeach ? (country === 'US' ? 'Preview reason' : '개발용 발의 사유') : '',
    };
    if (!impeach && windowSpec) body.window = windowSpec;
    if (country === 'US') body.eligibility = eligibilityFor(mode);
    if (extra) {
      Object.keys(extra).forEach(function (key) { body[key] = extra[key]; });
    }
    return body;
  }

  function ensureStyle() {
    if (document.getElementById('sa-leader-filing-style')) return;
    var style = document.createElement('style');
    style.id = 'sa-leader-filing-style';
    style.textContent = '.sa-lf{position:fixed;inset:0;z-index:21000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(2,6,23,.72)}.sa-lf__panel{width:min(36rem,100%);max-height:92vh;overflow:auto;background:#0f172a;color:#e2e8f0;border:1px solid rgba(251,191,36,.75);border-radius:12px;padding:1rem}.sa-lf__badge{margin:0 0 .35rem;color:#fbbf24;font-weight:700;font-size:.78rem}.sa-lf__title{margin:0 0 .4rem;font-size:1.15rem}.sa-lf__lead,.sa-lf__meta,.sa-lf__reason,.sa-lf__leader{margin:.35rem 0;line-height:1.5;color:#cbd5e1}.sa-lf__status{margin-top:.7rem;white-space:pre-line;line-height:1.5}.sa-lf__check{display:flex;align-items:center;gap:.6rem;min-height:44px;margin-top:.6rem}.sa-lf__check input{width:1.25rem;height:1.25rem}.sa-lf__choice{min-height:44px;margin-top:.6rem;padding:.45rem .8rem;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit}.sa-lf__choice:disabled{opacity:.45}.sa-lf__choice[data-territory="pioneer"]{border-color:rgba(56,189,248,.75)}.sa-lf__choice[data-territory="guardian"]{border-color:rgba(248,113,113,.75)}.sa-lf__input{width:100%;min-height:44px;margin-top:.4rem;box-sizing:border-box;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:#020617;color:#e2e8f0;padding:.5rem}.sa-lf__x{float:right;min-height:44px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#e2e8f0}@media (max-width:720px){.sa-lf{align-items:flex-end;padding:.5rem}.sa-lf__panel{width:100%;border-bottom-left-radius:0;border-bottom-right-radius:0}}';
    document.head.appendChild(style);
  }

  function headers() {
    return { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Filing': 'preview' };
  }

  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) }).then(function (res) { return res.json(); });
  }

  function get(path) {
    return fetch(API + path, { headers: { 'X-SentenceArena-Dev-Filing': 'preview' } }).then(function (res) { return res.json(); });
  }

  function receiptLines(pack, row) {
    var place = placeName(pack, row.country);
    var land = landName(row.territory);
    var who = row.actorName || row.actorId;
    return pack.status + ': ' + pack.received + '\n' + pack.history + ': ' + who + ' · ' + place + ' · ' + land + ' · ' + pack.received;
  }

  function boot() {
    var mode = scenario();
    if (!mode) return;
    var country = countryCode();
    var pack = text(country);
    var body = payload(country, mode);
    var impeach = mode.indexOf('impeach') === 0;
    ensureStyle();
    var wrap = document.createElement('div');
    wrap.id = 'sa-leader-filing';
    wrap.className = 'sa-lf';
    var panel = document.createElement('div');
    panel.className = 'sa-lf__panel';
    panel.setAttribute('data-territory', body.territory);
    panel.innerHTML = '<button type="button" class="sa-lf__x"></button><p class="sa-lf__badge"></p><h2 class="sa-lf__title"></h2><p class="sa-lf__lead"></p><p class="sa-lf__meta"></p><p class="sa-lf__reason"></p><div class="sa-lf__status"></div>';
    panel.querySelector('.sa-lf__x').textContent = pack.close;
    panel.querySelector('.sa-lf__badge').textContent = pack.badge;
    panel.querySelector('.sa-lf__title').textContent = impeach ? pack.impeachTitle : pack.filingTitle;
    panel.querySelector('.sa-lf__lead').textContent = pack.notLive + ' ' + pack.notAuth;
    var office = body.actor.office === 'representative' ? pack.officeRep : pack.officeOther;
    var whoLabel = impeach ? pack.proposer : pack.applicant;
    panel.querySelector('.sa-lf__meta').textContent = placeName(pack, country) + ' · ' + landName(body.territory) + '\n' + whoLabel + ' ' + body.actor.name + ' · ' + office;
    panel.querySelector('.sa-lf__meta').style.whiteSpace = 'pre-line';
    panel.querySelector('.sa-lf__x').addEventListener('click', function () { wrap.remove(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') wrap.remove();
    });
    wrap.appendChild(panel);
    document.body.appendChild(wrap);

    var listPath = impeach
      ? '/dev/leader-filing/impeachments?country=' + country + '&territory=' + body.territory
      : '/dev/leader-filing/candidacies?country=' + country + '&territory=' + body.territory;
    var writePath = impeach ? '/dev/leader-filing/impeachments' : '/dev/leader-filing/candidacies';

    get(listPath).then(function (listed) {
      var rows = listed && listed.rows ? listed.rows : [];
      var mine = rows.filter(function (row) {
        return impeach ? row.status === 'received' : row.actorId === body.actor.id && (row.status === 'submitted' || row.status === 'in_review');
      })[0];
      var blocking = mode === 'filing-closed' || mode === 'filing-unconfirmed' || mode === 'filing-blocked' || mode === 'rejected' || mode === 'filing-cross' || mode === 'filing-unauthorized';
      if (!blocking && mine && !impeach) {
        panel.querySelector('.sa-lf__status').textContent = receiptLines(pack, mine);
      }
      if (mine && impeach && mine.actorId === body.actor.id) {
        panel.querySelector('.sa-lf__status').textContent = pack.status + ': ' + pack.received + '\n' + pack.next + ': ' + mine.nextStep + '\n' + pack.nextSentence;
        var known = document.createElement('p');
        known.className = 'sa-lf__leader';
        known.textContent = pack.leader + ' ' + (mine.leaderName || mine.leaderId) + ' · ' + landName(mine.territory);
        panel.appendChild(known);
        return null;
      }
      if (!blocking && mine && !impeach) return { ok: true, already: true };
      return post(writePath, Object.assign({ preview: true }, body));
    }).then(function (result) {
      if (!result) return;
      var reason = panel.querySelector('.sa-lf__reason');
      if (!result || result.ok !== true) {
        reason.textContent = result ? reasonText(country, result.reason) : pack.disconnected;
        return;
      }
      if (result.already) {
        var again = document.createElement('button');
        again.type = 'button';
        again.className = 'sa-lf__choice';
        again.setAttribute('data-territory', body.territory);
        again.textContent = pack.submit;
        again.addEventListener('click', function () {
          var next = payload(country, mode, { intentConfirmed: true, preview: false });
          post(writePath, next).then(function (saved) {
            panel.querySelector('.sa-lf__reason').textContent = (!saved || saved.ok !== true)
              ? reasonText(country, saved && saved.reason)
              : receiptLines(pack, saved.candidacy);
          });
        });
        panel.appendChild(again);
        return;
      }
      if (!impeach) reason.textContent = pack.noDates;
      if (impeach) {
        if (!result.leaderView || !result.leaderView.name) {
          reason.textContent = reasonText(country, 'NO_SITTING_LEADER');
          return;
        }
        var leaderLine = document.createElement('p');
        leaderLine.className = 'sa-lf__leader';
        leaderLine.textContent = pack.leader + ' ' + result.leaderView.name + ' · ' + landName(result.leaderView.territory);
        panel.appendChild(leaderLine);
        var input = document.createElement('textarea');
        input.className = 'sa-lf__input';
        input.setAttribute('aria-label', pack.reasonLabel);
        input.value = body.reason;
        panel.appendChild(input);
      }
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sa-lf__choice';
      button.setAttribute('data-territory', body.territory);
      button.textContent = impeach ? pack.propose : pack.submit;
      if (!impeach) {
        var label = document.createElement('label');
        label.className = 'sa-lf__check';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'sa-lf__intent';
        button.disabled = true;
        box.addEventListener('change', function () { button.disabled = !box.checked; });
        label.appendChild(box);
        label.appendChild(document.createTextNode(pack.intent));
        panel.appendChild(label);
      }
      button.addEventListener('click', function () {
        var next = payload(country, mode, impeach ? {} : { intentConfirmed: true, preview: false });
        next.preview = false;
        if (impeach) next.reason = panel.querySelector('textarea').value;
        if (!impeach) next.intentConfirmed = !!(panel.querySelector('.sa-lf__intent') && panel.querySelector('.sa-lf__intent').checked);
        post(writePath, next).then(function (saved) {
          var slot = panel.querySelector('.sa-lf__status');
          if (!saved || saved.ok !== true) {
            slot.textContent = reasonText(country, saved && saved.reason);
            return;
          }
          var row = saved.candidacy || saved.proposal;
          if (impeach) {
            slot.textContent = pack.status + ': ' + pack.received + '\n' + pack.next + ': ' + row.nextStep + '\n' + pack.nextSentence;
          } else {
            slot.textContent = receiptLines(pack, row);
          }
          button.disabled = true;
        }).catch(function () {
          panel.querySelector('.sa-lf__status').textContent = pack.disconnected;
        });
      });
      panel.appendChild(button);
    }).catch(function () {
      panel.querySelector('.sa-lf__reason').textContent = pack.disconnected;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
