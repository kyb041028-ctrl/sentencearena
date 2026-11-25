(function () {
  'use strict';

  var H = window.ScAdminHub;
  var TYPE = { GENERAL: '일반', MAINTENANCE: '점검', INCIDENT: '장애', UPDATE: '업데이트' };
  var STATE = { PRIVATE: '비공개', SCHEDULED: '예약됨', LIVE: '공개 중', ENDED: '종료' };
  var editingId = null;

  function $(id) { return document.getElementById(id); }

  function kstInputToIso(v) {
    if (!v) return null;
    return v + ':00+09:00';
  }

  function isoToKstInput(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    return new Date(t + 9 * 3600000).toISOString().slice(0, 16);
  }

  function setMsg(text) { $('sc-n-msg').textContent = text ? ' ' + text : ''; }

  function resetForm() {
    editingId = null;
    $('sc-n-type').value = 'GENERAL';
    $('sc-n-title').value = '';
    $('sc-n-body').value = '';
    $('sc-n-start').value = '';
    $('sc-n-end').value = '';
    $('sc-n-public').checked = false;
    $('sc-n-create').textContent = '공지 등록';
  }

  function patch(id, body, done) {
    H.api('PATCH', '/api/admin/notices/' + encodeURIComponent(id), body).then(function (r) {
      if (r.body && r.body.ok) { setMsg('저장했습니다.'); load(); if (done) done(); return; }
      var code = r.body && r.body.error && r.body.error.code;
      setMsg(code === 'NOTICE_PERIOD_INVALID' ? '기간이 올바르지 않습니다. 종료는 시작보다 늦어야 합니다.' : '저장하지 못했습니다.');
    }).catch(function () { setMsg('저장하지 못했습니다.'); });
  }

  function renderList(items) {
    var host = $('sc-n-list');
    host.textContent = '';
    if (!items.length) { host.appendChild(H.el('p', '등록된 공지가 없습니다.', 'sc-hub-note')); return; }
    var table = H.el('table');
    var head = H.el('tr');
    ['유형', '제목', '상태', '시작', '종료', '관리'].forEach(function (t) { head.appendChild(H.el('th', t)); });
    table.appendChild(head);
    items.forEach(function (n) {
      var tr = H.el('tr');
      tr.appendChild(H.el('td', TYPE[n.type] || n.type));
      tr.appendChild(H.el('td', n.title));
      tr.appendChild(H.el('td', STATE[n.state] || n.state));
      tr.appendChild(H.el('td', H.fmtTime(n.startsAt) || '-'));
      tr.appendChild(H.el('td', H.fmtTime(n.endsAt) || '-'));
      var act = H.el('td');
      if (n.state !== 'ENDED') {
        var edit = H.el('button', '수정');
        edit.type = 'button';
        edit.addEventListener('click', function () {
          editingId = n.id;
          $('sc-n-type').value = n.type;
          $('sc-n-title').value = n.title;
          $('sc-n-body').value = n.body || '';
          $('sc-n-start').value = isoToKstInput(n.startsAt);
          $('sc-n-end').value = isoToKstInput(n.endsAt);
          $('sc-n-public').checked = n.isPublic;
          $('sc-n-create').textContent = '수정 저장';
          setMsg('수정 중입니다.');
        });
        act.appendChild(edit);
        var vis = H.el('button', n.isPublic ? '비공개로' : '공개로');
        vis.type = 'button';
        vis.addEventListener('click', function () { patch(n.id, { isPublic: !n.isPublic }); });
        act.appendChild(vis);
        if (n.state === 'LIVE') {
          var end = H.el('button', '지금 종료');
          end.type = 'button';
          end.addEventListener('click', function () { patch(n.id, { endNow: true }); });
          act.appendChild(end);
        }
      }
      tr.appendChild(act);
      table.appendChild(tr);
    });
    host.appendChild(table);
  }

  function load() {
    $('sc-n-status').textContent = '불러오는 중...';
    H.api('GET', '/api/admin/notices').then(function (res) {
      var msg = H.authMessage(res.status);
      if (msg) { $('sc-n-status').textContent = msg; return; }
      var d = res.body;
      if (!d || !d.ok) { $('sc-n-status').textContent = '공지 목록을 불러오지 못했습니다.'; return; }
      if (d.available === false) {
        $('sc-n-status').textContent = '미확인: 공지 저장소(표)가 아직 연결되지 않았습니다. 승인된 SQL이 적용되기 전에는 등록할 수 없습니다.';
        $('sc-n-list').textContent = '';
        return;
      }
      $('sc-n-status').textContent = '';
      renderList(d.items);
    }).catch(function () { $('sc-n-status').textContent = '공지 목록을 불러오지 못했습니다.'; });
  }

  $('sc-n-create').addEventListener('click', function () {
    var payload = {
      type: $('sc-n-type').value,
      title: $('sc-n-title').value,
      body: $('sc-n-body').value,
      isPublic: $('sc-n-public').checked,
      startsAt: kstInputToIso($('sc-n-start').value),
      endsAt: kstInputToIso($('sc-n-end').value),
    };
    if (!payload.title.trim()) { setMsg('제목을 입력해 주세요.'); return; }
    if (editingId) { patch(editingId, payload, resetForm); return; }
    H.api('POST', '/api/admin/notices', payload).then(function (r) {
      if (r.body && r.body.ok) { setMsg('등록했습니다.'); resetForm(); load(); return; }
      var code = r.body && r.body.error && r.body.error.code;
      setMsg(code === 'NOTICE_PERIOD_INVALID' ? '기간이 올바르지 않습니다. 종료는 시작보다 늦어야 합니다.' : '등록하지 못했습니다.');
    }).catch(function () { setMsg('등록하지 못했습니다.'); });
  });

  load();
})();
