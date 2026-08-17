(function () {
  'use strict';

  var listEl = document.getElementById('mod-report-list');
  var statusEl = document.getElementById('mod-status');

  function authHeaders() {
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    try {
      var raw = sessionStorage.getItem('sc_sb_auth_session');
      if (raw) {
        var auth = JSON.parse(raw);
        var token = auth && auth.session && auth.session.access_token;
        if (token) headers.Authorization = 'Bearer ' + token;
      }
    } catch (_) {}
    return headers;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  function renderReports(reports) {
    if (!listEl) return;
    listEl.textContent = '';
    (reports || []).forEach(function (row) {
      var card = document.createElement('article');
      card.className = 'sc-card mod-card';
      card.setAttribute('data-report-id', row.id);
      card.setAttribute('data-classification', row.classification || '');
      var title = document.createElement('h2');
      title.className = 'sc-section-title';
      title.textContent = (row.classification || '') + ' · ' + (row.reasonCode || '');
      var meta = document.createElement('p');
      meta.textContent = '대상 ' + (row.targetAuthorUserId || '') + ' · 상태 ' + (row.status || '') + ' · ' + (row.reasonDetail || '');
      var actions = document.createElement('div');
      actions.className = 'mod-actions';
      ['NONE', 'NORMAL', 'IMMEDIATE_ALIEN'].forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-btn';
        btn.setAttribute('data-admin-action', action);
        btn.textContent = action === 'IMMEDIATE_ALIEN' ? '즉시 외계행' : action === 'NONE' ? '별도 조치 없음' : '일반 처리';
        btn.addEventListener('click', function () {
          postAction(row.id, action);
        });
        actions.appendChild(btn);
      });
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  function postAction(id, action) {
    fetch('/api/admin/moderation/reports/' + encodeURIComponent(id) + '/action', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ action: action }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '처리 완료: ' + action : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadReports();
      })
      .catch(function () { setStatus('요청 실패'); });
  }

  function loadReports() {
    fetch('/api/admin/moderation/reports?classification=OTHER', {
      headers: authHeaders(),
      credentials: 'same-origin',
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        if (!pack.res.ok || !pack.data || pack.data.ok === false) {
          setStatus((pack.data && pack.data.error) || '목록을 불러오지 못했습니다.');
          return;
        }
        setStatus('기타신고 ' + (pack.data.reports || []).length + '건');
        renderReports(pack.data.reports || []);
      })
      .catch(function () { setStatus('목록 요청 실패'); });
  }

  loadReports();
})();
