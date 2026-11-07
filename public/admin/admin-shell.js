(function (global) {
  'use strict';

  var MENU = [
    { key: 'dashboard', label: '운영 대시보드', href: '/admin/ops-stats/', children: [
      { label: '운영 통계', href: '/admin/ops-stats/' },
    ] },
    { key: 'members', label: '회원 관리', href: '/admin/members/', children: [
      { label: '회원 목록', href: '/admin/members/' },
    ] },
    { key: 'content', label: '콘텐츠 관리', href: '/admin/content/', children: [
      { label: '현재 공개 공식글', href: '/admin/content/' },
      { label: '게시물 관리', href: '/admin/posts/' },
      { label: '댓글 관리', href: '/admin/comments/' },
      { label: '공식글 작성·종료', href: '/admin/official-posts/' },
    ] },
    { key: 'moderation', label: '신고·제재', href: '/admin/moderation/', children: [
      { label: '신고 / 제재 / 이의제기', href: '/admin/moderation/' },
      { label: '권리침해', href: '/admin/rights-infringement/' },
    ] },
    { key: 'daily', label: 'Daily Issue', href: '/admin/daily-issues/', children: [
      { label: 'Daily Issue 검수', href: '/admin/daily-issues/' },
    ] },
    { key: 'system', label: '시스템 모니터링', href: '/admin/system/', children: [
      { label: '시스템 상태', href: '/admin/system/' },
    ] },
    { key: 'inquiries', label: '문의·피드백', href: '/admin/inquiries/', children: [
      { label: '문의 목록', href: '/admin/inquiries/' },
    ] },
    { key: 'settings', label: '운영 설정·기록', href: '/admin/settings/', children: [
      { label: '권한·수집 상태', href: '/admin/settings/' },
      { label: '운영 이력(감사)', href: '/admin/audit/' },
      { label: 'Legal Hold', href: '/admin/retention/' },
    ] },
  ];

  var PATH_GROUPS = [
    ['/admin/ops-stats', 'dashboard'],
    ['/admin/members', 'members'],
    ['/admin/content', 'content'],
    ['/admin/posts', 'content'],
    ['/admin/comments', 'content'],
    ['/admin/official-posts', 'content'],
    ['/admin/moderation', 'moderation'],
    ['/admin/rights-infringement', 'moderation'],
    ['/admin/daily-issues', 'daily'],
    ['/admin/system', 'system'],
    ['/admin/inquiries', 'inquiries'],
    ['/admin/settings', 'settings'],
    ['/admin/audit', 'settings'],
    ['/admin/retention', 'settings'],
  ];

  function groupForPath(path) {
    var p = String(path || '');
    for (var i = 0; i < PATH_GROUPS.length; i++) {
      if (p.indexOf(PATH_GROUPS[i][0]) === 0) return PATH_GROUPS[i][1];
    }
    return '';
  }

  function link(item, active) {
    var a = global.document.createElement('a');
    a.href = item.href;
    a.textContent = item.label;
    if (active) a.className = 'is-active';
    return a;
  }

  function mount() {
    var nav = global.document.getElementById('sc-admin-nav');
    if (!nav) {
      nav = global.document.createElement('nav');
      nav.id = 'sc-admin-nav';
      nav.setAttribute('aria-label', '관리자 메뉴');
      if (global.document.body) global.document.body.insertBefore(nav, global.document.body.firstChild);
    }
    nav.className = 'sc-admin-nav';
    nav.textContent = '';
    var path = String((global.location && global.location.pathname) || '');
    var group = groupForPath(path);
    var home = global.document.createElement('a');
    home.href = '/admin/';
    home.textContent = '관리자 홈';
    home.className = 'sc-admin-nav__home' + (path === '/admin' || path === '/admin/' ? ' is-active' : '');
    nav.appendChild(home);
    MENU.forEach(function (g) {
      nav.appendChild(link(g, g.key === group));
    });

    var old = global.document.getElementById('sc-admin-subnav');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var current = MENU.filter(function (g) { return g.key === group; })[0];
    if (current && current.children.length > 1) {
      var sub = global.document.createElement('nav');
      sub.id = 'sc-admin-subnav';
      sub.className = 'sc-admin-subnav';
      sub.setAttribute('aria-label', current.label + ' 하위 메뉴');
      current.children.forEach(function (child) {
        var childPath = child.href.replace(/\/$/, '');
        var isHere = path.replace(/\/$/, '') === childPath;
        sub.appendChild(link(child, isHere));
      });
      nav.parentNode.insertBefore(sub, nav.nextSibling);
    }
  }

  var api = { mount: mount, MENU: MENU, groupForPath: groupForPath };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  global.ScAdminShell = api;
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }
})(typeof window !== 'undefined' ? window : this);
