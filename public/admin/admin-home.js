(function () {
  'use strict';

  function authHeaders() {
    var headers = { Accept: 'application/json' };
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

  var CARDS = [
    { href: '/admin/ops-stats/', title: '운영 대시보드', body: '방문·회원·유입·운영 집계. 수집하지 않은 항목은 미수집으로 둡니다.', links: [] },
    { href: '/admin/members/', title: '회원 관리', body: '회원 조회(읽기 전용).', links: [] },
    { href: '/admin/content/', title: '콘텐츠 관리', body: '게시물·댓글·공식글.', links: [['게시물', '/admin/posts/'], ['댓글', '/admin/comments/'], ['공식글', '/admin/official-posts/']] },
    { href: '/admin/moderation/', title: '신고·제재', body: '신고 검토, 제재, 이의제기.', countKey: 'moderation', links: [['권리침해', '/admin/rights-infringement/']] },
    { href: '/admin/daily-issues/', title: 'Daily Issue', body: '아침판 검수.', countKey: 'daily', links: [] },
    { href: '/admin/system/', title: '시스템 모니터링', body: '서버·DB·배치 상태(조회 전용).', links: [] },
    { href: '/admin/inquiries/', title: '문의·피드백', body: '오류·개선·일반 문의 처리.', links: [] },
    { href: '/admin/settings/', title: '운영 설정·기록', body: '권한·수집 상태 조회, 감사, Legal Hold.', links: [['운영 이력', '/admin/audit/'], ['Legal Hold', '/admin/retention/']] },
  ];

  function render(counts) {
    var grid = document.getElementById('sc-admin-home-grid');
    if (!grid) return;
    grid.textContent = '';
    CARDS.forEach(function (card) {
      var box = document.createElement('div');
      box.className = 'sc-card sc-admin-home-card';
      var a = document.createElement('a');
      a.href = card.href;
      a.style.color = 'inherit';
      a.style.textDecoration = 'none';
      var t = document.createElement('strong');
      t.textContent = card.title;
      var p = document.createElement('p');
      p.className = 'muted';
      var extra = counts && card.countKey && counts[card.countKey] != null ? ' · ' + counts[card.countKey] : '';
      p.textContent = card.body + extra;
      a.appendChild(t);
      a.appendChild(p);
      box.appendChild(a);
      if (card.links && card.links.length) {
        var ul = document.createElement('ul');
        card.links.forEach(function (pair) {
          var li = document.createElement('li');
          var l = document.createElement('a');
          l.href = pair[1];
          l.textContent = pair[0];
          li.appendChild(l);
          ul.appendChild(li);
        });
        box.appendChild(ul);
      }
      grid.appendChild(box);
    });
  }

  function setStatus(text) {
    var el = document.getElementById('sc-admin-home-status');
    if (el) el.textContent = text || '';
  }

  render({});
  Promise.all([
    fetch('/api/admin/moderation/reports', { headers: authHeaders(), credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return null; }),
    fetch('/api/admin/daily-issues/review?status=READY_FOR_REVIEW&limit=1', { headers: authHeaders(), credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return null; }),
  ]).then(function (packs) {
    var counts = {};
    var mod = packs[0];
    if (mod && mod.ok) {
      var pendingReports = (mod.behaviors || []).length;
      var pendingAppeals = (mod.appeals || []).filter(function (a) {
        return String(a.status || '').toUpperCase() === 'SUBMITTED';
      }).length;
      counts.moderation = '대기 신고묶음 ' + pendingReports + ' · 이의 ' + pendingAppeals;
    }
    var daily = packs[1];
    if (daily && daily.ok && daily.total != null) {
      counts.daily = '검수 대기 ' + daily.total;
    }
    render(counts);
  }).catch(function () {
    setStatus('바로가기만 표시합니다.');
  });
})();
