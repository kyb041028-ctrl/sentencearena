(function () {
  'use strict';

  var H = window.ScAdminHub;
  var KIND = { BUG: '오류', IMPROVEMENT: '개선', GENERAL: '일반 문의' };
  var STATUS = { RECEIVED: '접수', IN_PROGRESS: '확인 중', DONE: '처리 완료', ON_HOLD: '보류' };
  var state = { page: 1, total: null, pageSize: 20 };

  function $(id) { return document.getElementById(id); }

  function query() {
    var p = new URLSearchParams();
    p.set('page', String(state.page));
    if ($('sc-i-kind').value) p.set('kind', $('sc-i-kind').value);
    if ($('sc-i-status').value) p.set('status', $('sc-i-status').value);
    if ($('sc-i-q').value.trim()) p.set('q', $('sc-i-q').value.trim());
    return p.toString();
  }

  function renderPaging() {
    var pages = state.total == null ? null : Math.max(1, Math.ceil(state.total / state.pageSize));
    $('sc-i-page').textContent = state.page + (pages ? ' / ' + pages : '') + ' 페이지' + (state.total != null ? ' · 전체 ' + state.total + '건' : '');
    $('sc-i-prev').disabled = state.page <= 1;
    $('sc-i-next').disabled = pages != null ? state.page >= pages : true;
  }

  function renderList(items) {
    var host = $('sc-i-list');
    host.textContent = '';
    if (!items.length) { host.appendChild(H.el('p', '조건에 맞는 문의가 없습니다.', 'sc-hub-note')); return; }
    var table = H.el('table');
    var head = H.el('tr');
    ['종류', '제목', '상태', '내부 메모', '접수일'].forEach(function (t) { head.appendChild(H.el('th', t)); });
    table.appendChild(head);
    items.forEach(function (it) {
      var tr = H.el('tr');
      tr.appendChild(H.el('td', KIND[it.kind] || it.kind));
      var titleTd = H.el('td');
      var btn = H.el('button', it.title);
      btn.type = 'button';
      btn.addEventListener('click', function () { openDetail(it.id); });
      titleTd.appendChild(btn);
      tr.appendChild(titleTd);
      tr.appendChild(H.el('td', STATUS[it.status] || it.status));
      tr.appendChild(H.el('td', it.hasInternalNote ? '있음' : '없음'));
      tr.appendChild(H.el('td', H.fmtTime(it.createdAt) || '-'));
      table.appendChild(tr);
    });
    host.appendChild(table);
  }

  function load() {
    $('sc-i-state').textContent = '불러오는 중...';
    H.api('GET', '/api/admin/inquiries?' + query()).then(function (res) {
      var msg = H.authMessage(res.status);
      if (msg) { $('sc-i-state').textContent = msg; return; }
      var d = res.body;
      if (!d || !d.ok) { $('sc-i-state').textContent = '문의 목록을 불러오지 못했습니다.'; return; }
      $('sc-i-intake-note').textContent = d.intake && d.intake.note ? d.intake.note : '접수 상태를 확인하지 못했습니다.';
      $('sc-i-intake').className = 'sc-hub-box' + (d.intake && d.intake.enabled ? '' : ' sc-hub-disabled');
      if (d.available === false) {
        $('sc-i-state').textContent = '미확인: 문의 저장소(표)가 아직 연결되지 않았습니다. 승인된 SQL이 적용되기 전에는 목록을 볼 수 없습니다.';
        $('sc-i-list').textContent = '';
        return;
      }
      $('sc-i-state').textContent = '';
      state.total = d.total;
      state.pageSize = d.pageSize;
      renderList(d.items);
      renderPaging();
    }).catch(function () { $('sc-i-state').textContent = '문의 목록을 불러오지 못했습니다.'; });
  }

  function openDetail(id) {
    var box = $('sc-i-detail');
    box.hidden = false;
    box.textContent = '불러오는 중...';
    H.api('GET', '/api/admin/inquiries/' + encodeURIComponent(id)).then(function (res) {
      box.textContent = '';
      if (!res.body || !res.body.ok) { box.textContent = '문의 상세를 불러오지 못했습니다.'; return; }
      var inq = res.body.inquiry;
      box.appendChild(H.el('h2', '[' + (KIND[inq.kind] || inq.kind) + '] ' + inq.title));
      var body = H.el('p', inq.body || '(본문 없음)');
      body.style.whiteSpace = 'pre-wrap';
      box.appendChild(body);

      var statusLabel = H.el('label', '상태 ');
      var select = H.el('select');
      Object.keys(STATUS).forEach(function (k) {
        var opt = H.el('option', STATUS[k]);
        opt.value = k;
        if (k === inq.status) opt.selected = true;
        select.appendChild(opt);
      });
      statusLabel.appendChild(select);
      box.appendChild(statusLabel);

      box.appendChild(H.el('h2', '내부 메모 (회원에게 보이지 않음)'));
      var note = H.el('textarea');
      note.maxLength = 2000;
      note.value = inq.internalNote || '';
      box.appendChild(note);

      var save = H.el('button', '저장');
      save.type = 'button';
      var msg = H.el('span', '');
      save.addEventListener('click', function () {
        save.disabled = true;
        H.api('PATCH', '/api/admin/inquiries/' + encodeURIComponent(id), { status: select.value, internalNote: note.value }).then(function (r) {
          save.disabled = false;
          msg.textContent = r.body && r.body.ok ? ' 저장했습니다.' : ' 저장하지 못했습니다.';
          if (r.body && r.body.ok) { load(); openDetail(id); }
        }).catch(function () { save.disabled = false; msg.textContent = ' 저장하지 못했습니다.'; });
      });
      box.appendChild(save);
      box.appendChild(msg);

      var events = res.body.events || [];
      box.appendChild(H.el('h2', '처리 기록'));
      if (!events.length) box.appendChild(H.el('p', '기록이 없습니다.', 'sc-hub-note'));
      events.forEach(function (ev) {
        var label = ev.type === 'STATUS_CHANGED'
          ? '상태 변경 ' + (STATUS[ev.from] || ev.from) + ' → ' + (STATUS[ev.to] || ev.to)
          : '내부 메모 수정';
        box.appendChild(H.el('div', (H.fmtTime(ev.at) || '') + ' · ' + label));
      });
    });
  }

  $('sc-i-search').addEventListener('click', function () { state.page = 1; load(); });
  $('sc-i-prev').addEventListener('click', function () { if (state.page > 1) { state.page -= 1; load(); } });
  $('sc-i-next').addEventListener('click', function () { state.page += 1; load(); });
  load();
})();
