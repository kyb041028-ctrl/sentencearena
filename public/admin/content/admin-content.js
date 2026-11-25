(function () {
  'use strict';

  var H = window.ScAdminHub;

  H.api('GET', '/api/admin/board/official-posts').then(function (res) {
    var status = document.getElementById('sc-c-status');
    var host = document.getElementById('sc-c-list');
    var msg = H.authMessage(res.status);
    if (msg) { status.textContent = msg; return; }
    var body = res.body;
    if (res.status === 503) { status.textContent = '미확인: 게시판 저장소가 연결되어 있지 않습니다.'; return; }
    if (!body || !body.ok) { status.textContent = '공식글 목록을 불러오지 못했습니다.'; return; }
    var live = (body.posts || []).filter(function (p) { return String(p.status || '').toUpperCase() === 'ACTIVE'; });
    if (!live.length) { status.textContent = '현재 공개 중인 공식글이 없습니다.'; return; }
    status.textContent = '공개 중 ' + live.length + '건';
    var table = H.el('table');
    var head = H.el('tr');
    ['제목', '작성(수정)', '구분'].forEach(function (t) { head.appendChild(H.el('th', t)); });
    table.appendChild(head);
    live.forEach(function (p) {
      var tr = H.el('tr');
      tr.appendChild(H.el('td', p.title));
      tr.appendChild(H.el('td', H.fmtTime(p.updatedAt || p.createdAt) || '-'));
      tr.appendChild(H.el('td', p.categoryKey || '-'));
      table.appendChild(tr);
    });
    host.appendChild(table);
  }).catch(function () {
    document.getElementById('sc-c-status').textContent = '공식글 목록을 불러오지 못했습니다.';
  });
})();
