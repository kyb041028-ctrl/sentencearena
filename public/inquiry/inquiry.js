(function () {
  'use strict';

  var KIND = { BUG: '오류 제보', IMPROVEMENT: '기능 개선', GENERAL: '일반 문의' };
  var STATUS = { RECEIVED: '접수됨', IN_PROGRESS: '확인 중', DONE: '처리 완료', ON_HOLD: '보류' };
  var ERRORS = {
    INQUIRY_DUPLICATE: '같은 내용의 문의가 이미 접수되어 처리 중입니다.',
    INQUIRY_RATE_LIMITED: '한 시간에 접수할 수 있는 횟수를 넘었습니다. 잠시 뒤 다시 시도해 주세요.',
    INQUIRY_INTAKE_DISABLED: '지금은 문의 접수가 열려 있지 않습니다.',
    INQUIRY_TITLE_INVALID: '제목을 1~200자로 입력해 주세요.',
    INQUIRY_BODY_INVALID: '내용을 1~4000자로 입력해 주세요.',
    INQUIRY_BUG_FIELDS_REQUIRED: '오류 제보는 화면, 현상, 재현, 기대, 실제 결과를 모두 입력해 주세요.',
    INQUIRY_REGION_REQUIRED: '한국 또는 미국 화면의 버그 제보 메뉴에서 다시 열어 주세요. 국가를 확인하지 못해 접수하지 않았습니다.',
    INQUIRY_STORE_NOT_AVAILABLE: '문의 저장소를 사용할 수 없습니다.',
  };

  var US_LABEL = {
    title: 'Report a Bug',
    kind: 'Type',
    bug: 'Bug',
    improvement: 'Improvement',
    general: 'General',
    subject: 'Title',
    screen: 'Screen or feature',
    symptom: 'What happened',
    steps: 'Steps to reproduce',
    expected: 'Expected',
    actual: 'Actual result',
    body: 'Message',
    send: 'Submit',
    mine: 'My reports',
    login: 'Sign in to report a bug.',
    region: 'Open Report a Bug from the United States menu so the country is known.',
    closed: 'Bug reports are not open right now. Earlier reports stay in the list.',
    ok: 'Received. Your report number is ',
    list: 'No reports yet.',
  };

  function $(id) { return document.getElementById(id); }

  var localReady = false;

  function supabaseToken() {
    try {
      var raw = window.sessionStorage.getItem('sc_sb_auth_session');
      var auth = raw ? JSON.parse(raw) : null;
      return (auth && auth.session && auth.session.access_token) || '';
    } catch (_) { return ''; }
  }

  function localToken() {
    if (!localReady) return '';
    try { return window.sessionStorage.getItem('sa_local_beta_token') || ''; }
    catch (_) { return ''; }
  }

  function token() {
    return supabaseToken() || localToken();
  }

  function api(method, url, body) {
    var headers = { Accept: 'application/json' };
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    if (body != null) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: method, headers: headers, body: body != null ? JSON.stringify(body) : undefined }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { status: res.status, body: data }; });
    });
  }

  function text(tag, value) {
    var n = document.createElement(tag);
    n.textContent = value;
    return n;
  }

  function fmt(iso) {
    var t = Date.parse(iso);
    return isFinite(t) ? new Date(t + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' KST' : '';
  }

  function loadMine() {
    api('GET', '/api/inquiries/mine').then(function (r) {
      var host = $('sc-q-mine');
      host.textContent = '';
      if (!r.body || !r.body.ok) { host.appendChild(text('p', '내 문의를 불러오지 못했습니다.')); return; }
      if (!r.body.items.length) { host.appendChild(text('p', '접수한 문의가 없습니다.')); return; }
      r.body.items.forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'sc-inq-row';
        var b = text('button', (it.id || '') + ' · [' + (KIND[it.kind] || it.kind) + '] ' + it.title);
        b.type = 'button';
        b.addEventListener('click', function () { openDetail(it.id); });
        row.appendChild(b);
        row.appendChild(text('span', (STATUS[it.status] || it.status) + ' · ' + fmt(it.createdAt)));
        host.appendChild(row);
      });
    });
  }

  function openDetail(id) {
    api('GET', '/api/inquiries/mine/' + encodeURIComponent(id)).then(function (r) {
      var host = $('sc-q-detail');
      host.textContent = '';
      if (!r.body || !r.body.ok) { host.appendChild(text('p', '문의를 불러오지 못했습니다.')); return; }
      var q = r.body.inquiry;
      host.appendChild(text('h2', q.title));
      host.appendChild(text('p', '제보번호: ' + (q.id || '')));
      host.appendChild(text('p', '상태: ' + (STATUS[q.status] || q.status)));
      host.appendChild(text('div', q.body)).className = 'sc-inq-body';
    });
  }

  function syncKind() {
    var bug = $('sc-q-kind').value === 'BUG';
    $('sc-q-bug-fields').hidden = !bug;
    $('sc-q-body-label').hidden = bug;
  }

  $('sc-q-kind').addEventListener('change', syncKind);
  syncKind();

  $('sc-q-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('sc-q-submit');
    btn.disabled = true;
    $('sc-q-result').textContent = '';
    var payload = { kind: $('sc-q-kind').value, title: $('sc-q-title').value };
    if (payload.kind === 'BUG') {
      payload.screen = $('sc-q-screen').value;
      payload.symptom = $('sc-q-symptom').value;
      payload.steps = $('sc-q-steps').value;
      payload.expected = $('sc-q-expected').value;
      payload.actual = $('sc-q-actual').value;
    } else {
      payload.body = $('sc-q-body').value;
    }
    api('POST', '/api/inquiries', payload).then(function (r) {
      btn.disabled = false;
      if (r.body && r.body.ok && r.body.inquiry && r.body.inquiry.id) {
        $('sc-q-result').textContent = '접수되었습니다. 제보번호 ' + r.body.inquiry.id;
        $('sc-q-title').value = '';
        $('sc-q-body').value = '';
        $('sc-q-screen').value = '';
        $('sc-q-symptom').value = '';
        $('sc-q-steps').value = '';
        $('sc-q-expected').value = '';
        $('sc-q-actual').value = '';
        loadMine();
        return;
      }
      var code = r.body && r.body.error && r.body.error.code;
      $('sc-q-result').textContent = ERRORS[code] || '접수하지 못했습니다.';
    }).catch(function () { btn.disabled = false; $('sc-q-result').textContent = '접수하지 못했습니다.'; });
  });

  function applyRegion(region) {
    if (region !== 'US') return;
    document.title = 'Report a Bug · SentenceArena';
    document.querySelector('h1').textContent = US_LABEL.title;
    $('sc-q-submit').textContent = US_LABEL.send;
    document.querySelector('#sc-q-mine-box h2').textContent = US_LABEL.mine;
  }

  function startInquiry() {
    if (!token()) {
      $('sc-q-state').textContent = window.ScAuthCopy ? window.ScAuthCopy.text('LOGIN_REQUIRED') : '로그인한 회원만 문의할 수 있습니다. 로그인한 뒤 다시 열어 주세요.';
      return;
    }
    api('GET', '/api/inquiries/status').then(function (r) {
    if (r.status === 401) { $('sc-q-state').textContent = window.ScAuthCopy ? window.ScAuthCopy.text('SESSION_EXPIRED') : '세션이 만료되었습니다. 다시 로그인해 주세요.'; return; }
    if (!r.body || !r.body.ok) { $('sc-q-state').textContent = '문의 상태를 확인하지 못했습니다.'; return; }
    applyRegion(r.body.activityRegion);
    if (r.body.bugBusters === true) {
      $('sc-q-state').textContent = r.body.activityRegion === 'US' ? 'Bug Busters is saved for this country.' : '이 나라의 센스코 업적이 저장되어 있습니다.';
    }
    $('sc-q-mine-box').hidden = false;
    loadMine();
    if (!r.body.activityRegion) {
      $('sc-q-state').textContent = '한국 또는 미국 화면의 버그 제보 메뉴에서 열어 주세요. 국가가 없으면 접수하지 않습니다.';
      return;
    }
    if (!r.body.intakeEnabled) {
      $('sc-q-state').textContent = '지금은 문의 접수가 열려 있지 않습니다. 이전에 접수한 문의만 볼 수 있습니다.';
      return;
    }
    $('sc-q-form').hidden = false;
  });
  }

  fetch('/api/local-session/status', { cache: 'no-store' })
    .then(function (res) { return res.json(); })
    .then(function (body) { localReady = !!(body && body.enabled === true); })
    .catch(function () { localReady = false; })
    .then(startInquiry);
})();
