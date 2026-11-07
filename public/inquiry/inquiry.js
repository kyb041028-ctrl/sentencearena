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
    INQUIRY_STORE_NOT_AVAILABLE: '문의 저장소를 사용할 수 없습니다.',
  };

  function $(id) { return document.getElementById(id); }

  function token() {
    try {
      var raw = window.sessionStorage.getItem('sc_sb_auth_session');
      var auth = raw ? JSON.parse(raw) : null;
      return (auth && auth.session && auth.session.access_token) || '';
    } catch (_) { return ''; }
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
        var b = text('button', '[' + (KIND[it.kind] || it.kind) + '] ' + it.title);
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
      host.appendChild(text('p', '상태: ' + (STATUS[q.status] || q.status)));
      host.appendChild(text('div', q.body)).className = 'sc-inq-body';
    });
  }

  $('sc-q-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('sc-q-submit');
    btn.disabled = true;
    $('sc-q-result').textContent = '';
    api('POST', '/api/inquiries', { kind: $('sc-q-kind').value, title: $('sc-q-title').value, body: $('sc-q-body').value }).then(function (r) {
      btn.disabled = false;
      if (r.body && r.body.ok) {
        $('sc-q-result').textContent = '접수되었습니다. 상태는 아래 "내 문의"에서 확인할 수 있습니다.';
        $('sc-q-title').value = '';
        $('sc-q-body').value = '';
        loadMine();
        return;
      }
      var code = r.body && r.body.error && r.body.error.code;
      $('sc-q-result').textContent = ERRORS[code] || '접수하지 못했습니다.';
    }).catch(function () { btn.disabled = false; $('sc-q-result').textContent = '접수하지 못했습니다.'; });
  });

  if (!token()) {
    $('sc-q-state').textContent = '로그인한 회원만 문의할 수 있습니다. 로그인한 뒤 다시 열어 주세요.';
    return;
  }
  api('GET', '/api/inquiries/status').then(function (r) {
    if (r.status === 401) { $('sc-q-state').textContent = '로그인이 필요하거나 세션이 만료되었습니다. 다시 로그인해 주세요.'; return; }
    if (!r.body || !r.body.ok) { $('sc-q-state').textContent = '문의 상태를 확인하지 못했습니다.'; return; }
    $('sc-q-mine-box').hidden = false;
    loadMine();
    if (!r.body.intakeEnabled) {
      $('sc-q-state').textContent = '지금은 문의 접수가 열려 있지 않습니다. 이전에 접수한 문의만 볼 수 있습니다.';
      return;
    }
    $('sc-q-form').hidden = false;
  });
})();
