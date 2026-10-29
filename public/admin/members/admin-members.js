(function () {
  'use strict';

  var H = window.ScAdminHub;
  var TERRITORY = { pioneer: '개척자', central: '중앙', guardian: '수호자', alien: '외계' };
  var SANCTION = {
    WARNING: '경고', FINAL_WARNING: '최종 경고', ALIEN_TRANSFER: 'Alien 이동', WRITE_RESTRICT_24H: '글쓰기 24시간 제한',
    ACCOUNT_RESTRICT_7D: '계정 7일 제한', ACCOUNT_RESTRICT_30D: '계정 30일 제한', TEMP_SUSPEND: '일시 정지',
    PERMANENT_BAN: '영구 정지', PERMANENT_REVIEW: '영구 검토',
  };
  var state = { page: 1, total: null, pageSize: 20 };

  function $(id) { return document.getElementById(id); }

  function cellValue(value, status, text) {
    if (status && status !== 'OK') return H.stateBadge(status);
    return document.createTextNode(text != null ? text : String(value));
  }

  function query() {
    var p = new URLSearchParams();
    p.set('page', String(state.page));
    var q = $('sc-m-q').value.trim();
    if (q) p.set('q', q);
    if ($('sc-m-from').value) p.set('from', $('sc-m-from').value);
    if ($('sc-m-to').value) p.set('to', $('sc-m-to').value);
    return p.toString();
  }

  function renderPeriod(period) {
    var box = $('sc-m-period');
    box.textContent = '';
    box.appendChild(H.el('h2', '기간 가입·탈퇴 (' + period.from + ' ~ ' + period.to + ', 한국 시간)'));
    var kv = H.el('div', null, 'sc-hub-kv');
    [['가입', period.signups], ['탈퇴', period.withdrawals]].forEach(function (pair) {
      kv.appendChild(H.el('span', pair[0]));
      var cell = H.el('span');
      cell.appendChild(cellValue(pair[1].value, pair[1].status, pair[1].value == null ? null : pair[1].value + '명'));
      kv.appendChild(cell);
    });
    box.appendChild(kv);
    box.hidden = false;
  }

  function renderList(data) {
    var host = $('sc-m-list');
    host.textContent = '';
    if (!data.members.length) {
      host.appendChild(H.el('p', '조건에 맞는 회원이 없습니다.', 'sc-hub-note'));
      return;
    }
    var table = H.el('table');
    var head = H.el('tr');
    ['활동명', 'ID', '가입일', '최근 활동', '상태', '영토', '레벨', '명성', '제재(진행/전체)'].forEach(function (t) {
      head.appendChild(H.el('th', t));
    });
    table.appendChild(head);
    data.members.forEach(function (m) {
      var tr = H.el('tr');
      var nameTd = H.el('td');
      var btn = H.el('button', m.displayName || '(이름 없음)');
      btn.type = 'button';
      btn.addEventListener('click', function () { openDetail(m.id); });
      nameTd.appendChild(btn);
      tr.appendChild(nameTd);
      tr.appendChild(H.el('td', m.id));
      tr.appendChild(H.el('td', H.fmtTime(m.joinedAt) || '-'));
      var act = H.el('td');
      act.appendChild(cellValue(m.lastActivityAt, m.lastActivityStatus, H.fmtTime(m.lastActivityAt)));
      tr.appendChild(act);
      var st = H.el('td');
      st.appendChild(m.status === 'NORMAL' ? document.createTextNode('정상') : m.status === 'SANCTIONED' ? document.createTextNode('제재 중') : H.stateBadge(m.status));
      tr.appendChild(st);
      var terr = H.el('td');
      terr.appendChild(cellValue(m.territory, m.territoryStatus, TERRITORY[m.territory] || m.territory));
      tr.appendChild(terr);
      var lv = H.el('td');
      lv.appendChild(cellValue(m.level, m.progressionStatus, m.level == null ? null : 'Lv.' + m.level));
      tr.appendChild(lv);
      var rep = H.el('td');
      rep.appendChild(cellValue(m.reputation, m.progressionStatus, m.reputation == null ? null : String(m.reputation)));
      tr.appendChild(rep);
      var san = H.el('td');
      san.appendChild(cellValue(m.sanctionCount, m.sanctionStatus, m.activeSanctionCount + ' / ' + m.sanctionCount));
      tr.appendChild(san);
      table.appendChild(tr);
    });
    host.appendChild(table);
  }

  function renderPaging() {
    var pages = state.total == null ? null : Math.max(1, Math.ceil(state.total / state.pageSize));
    $('sc-m-page').textContent = state.page + (pages ? ' / ' + pages : '') + ' 페이지' + (state.total != null ? ' · 전체 ' + state.total + '명' : '');
    $('sc-m-prev').disabled = state.page <= 1;
    $('sc-m-next').disabled = pages != null ? state.page >= pages : true;
  }

  function load() {
    $('sc-m-status').textContent = '불러오는 중...';
    H.api('GET', '/api/admin/members?' + query()).then(function (res) {
      var msg = H.authMessage(res.status);
      if (msg) { $('sc-m-status').textContent = msg; $('sc-m-list').textContent = ''; return; }
      var data = res.body;
      if (res.status === 400) { $('sc-m-status').textContent = '기간이 올바르지 않습니다. 최대 90일까지 조회할 수 있습니다.'; return; }
      if (!data || !data.ok) { $('sc-m-status').textContent = '회원 목록을 불러오지 못했습니다.'; return; }
      if (data.available === false) {
        $('sc-m-status').textContent = '미확인: ' + (data.message || 'DB 연결이 없습니다.');
        $('sc-m-list').textContent = '';
        $('sc-m-period').hidden = true;
        return;
      }
      $('sc-m-status').textContent = '';
      state.total = data.total;
      state.pageSize = data.pageSize;
      renderPeriod(data.period);
      renderList(data);
      renderPaging();
    }).catch(function () { $('sc-m-status').textContent = '회원 목록을 불러오지 못했습니다.'; });
  }

  function openDetail(id) {
    var box = $('sc-m-detail');
    box.hidden = false;
    box.textContent = '불러오는 중...';
    H.api('GET', '/api/admin/members/' + encodeURIComponent(id)).then(function (res) {
      box.textContent = '';
      if (!res.body || !res.body.ok || !res.body.member) { box.textContent = '회원 상세를 불러오지 못했습니다.'; return; }
      var d = res.body;
      box.appendChild(H.el('h2', (d.member.displayName || '(이름 없음)') + ' · 제재 이력'));
      if (d.sanctionHistoryStatus !== 'OK') { box.appendChild(H.stateBadge(d.sanctionHistoryStatus)); return; }
      if (!d.sanctionHistory.length) { box.appendChild(H.el('p', '제재 기록이 없습니다.', 'sc-hub-note')); return; }
      var table = H.el('table');
      var head = H.el('tr');
      ['종류', '시작', '종료', '사유 코드', '기록일'].forEach(function (t) { head.appendChild(H.el('th', t)); });
      table.appendChild(head);
      d.sanctionHistory.forEach(function (s) {
        var tr = H.el('tr');
        tr.appendChild(H.el('td', SANCTION[s.type] || s.type));
        tr.appendChild(H.el('td', H.fmtTime(s.startsAt) || '-'));
        tr.appendChild(H.el('td', s.permanent ? '영구' : (H.fmtTime(s.endsAt) || '-')));
        tr.appendChild(H.el('td', s.reasonCode || '-'));
        tr.appendChild(H.el('td', H.fmtTime(s.createdAt) || '-'));
        table.appendChild(tr);
      });
      box.appendChild(table);
    });
  }

  $('sc-m-search').addEventListener('click', function () { state.page = 1; load(); });
  $('sc-m-q').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { state.page = 1; load(); } });
  $('sc-m-prev').addEventListener('click', function () { if (state.page > 1) { state.page -= 1; load(); } });
  $('sc-m-next').addEventListener('click', function () { state.page += 1; load(); });
  load();
})();
