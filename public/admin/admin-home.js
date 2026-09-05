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
    { href: '/admin/posts/', title: '게시물 관리', body: '신고 없이 글을 찾아 확인·삭제·복구합니다.' },
    { href: '/admin/moderation/', title: '신고 / 제재 / 이의제기', body: '기존 신고 검토와 제재 화면입니다.', countKey: 'moderation' },
    { href: '/admin/official-posts/', title: '공식글', body: 'ADMIN/OWNER 공식글 작성·종료.' },
    { href: '/admin/daily-issues/', title: 'Daily Issue', body: '아침판 검수.', countKey: 'daily' },
    { href: '/admin/rights-infringement/', title: '권리침해', body: '권리침해 요청 검토.', countKey: 'rights' },
    { href: '/admin/moderation/', title: 'Alien 관리', body: '현재 Production OFF. 기존 검토 화면에서만 확인합니다.' },
  ];

  function render(counts) {
    var grid = document.getElementById('sc-admin-home-grid');
    if (!grid) return;
    grid.textContent = '';
    CARDS.forEach(function (card) {
      var a = document.createElement('a');
      a.className = 'sc-card sc-admin-home-card';
      a.href = card.href;
      var t = document.createElement('strong');
      t.textContent = card.title;
      var p = document.createElement('p');
      p.className = 'muted';
      var extra = counts && card.countKey && counts[card.countKey] != null ? ' · ' + counts[card.countKey] : '';
      p.textContent = card.body + extra;
      a.appendChild(t);
      a.appendChild(p);
      grid.appendChild(a);
    });
  }

  function setStatus(text) {
    var el = document.getElementById('sc-admin-home-status');
    if (el) el.textContent = text || '';
  }

  render({});
  Promise.all([
    fetch('/api/admin/moderation/reports', { headers: authHeaders(), credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return null; }),
    fetch('/api/admin/rights-infringement/requests', { headers: authHeaders(), credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return null; }),
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
    var rights = packs[1];
    if (rights && rights.ok && Array.isArray(rights.requests)) {
      counts.rights = '요청 ' + rights.requests.length;
    }
    var daily = packs[2];
    if (daily && daily.ok && daily.total != null) {
      counts.daily = '검수 대기 ' + daily.total;
    }
    render(counts);
  }).catch(function () {
    setStatus('바로가기만 표시합니다.');
  });
})();
