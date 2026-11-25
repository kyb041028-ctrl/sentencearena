(function () {
  'use strict';

  var H = window.ScAdminHub;
  var SOURCE = { INQUIRY: '문의 처리', NOTICE: '공지 변경' };
  var EVENT = {
    STATUS_CHANGED: '상태 변경',
    NOTE_UPDATED: '내부 메모 수정',
    CREATED: '공지 등록',
    UPDATED: '공지 내용 수정',
    VISIBILITY_CHANGED: '공개 여부 변경',
    ENDED: '공지 종료',
  };

  function $(id) { return document.getElementById(id); }

  function load() {
    $('ao-status').textContent = '불러오는 중...';
    var q = $('ao-type').value ? '?targetType=' + encodeURIComponent($('ao-type').value) : '';
    H.api('GET', '/api/admin/ops-events' + q).then(function (res) {
      var host = $('ao-list');
      host.textContent = '';
      var msg = H.authMessage(res.status);
      if (msg) { $('ao-status').textContent = msg; return; }
      var d = res.body;
      if (!d || !d.ok) { $('ao-status').textContent = '운영 기록을 불러오지 못했습니다.'; return; }
      if (d.available === false) {
        $('ao-status').textContent = '미확인: 운영 기록 저장소(뷰)가 아직 연결되지 않았습니다.';
        return;
      }
      $('ao-status').textContent = d.items.length ? '' : '기록이 없습니다.';
      if (!d.items.length) return;
      var table = H.el('table');
      var head = H.el('tr');
      ['출처', '종류', '대상 ID', '처리자 ID', '시각'].forEach(function (t) { head.appendChild(H.el('th', t)); });
      table.appendChild(head);
      d.items.forEach(function (it) {
        var tr = H.el('tr');
        tr.appendChild(H.el('td', SOURCE[it.targetType] || it.targetType));
        tr.appendChild(H.el('td', EVENT[it.eventType] || it.eventType));
        tr.appendChild(H.el('td', it.targetId));
        tr.appendChild(H.el('td', it.actorUserId || '-'));
        tr.appendChild(H.el('td', H.fmtTime(it.at) || '-'));
        table.appendChild(tr);
      });
      host.appendChild(table);
    }).catch(function () { $('ao-status').textContent = '운영 기록을 불러오지 못했습니다.'; });
  }

  $('ao-load').addEventListener('click', load);
  load();
})();
