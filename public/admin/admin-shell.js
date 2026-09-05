(function (global) {
  'use strict';

  var ITEMS = [
    { href: '/admin/', label: '관리자 홈', key: 'home' },
    { href: '/admin/posts/', label: '게시물 관리', key: 'posts' },
    { href: '/admin/moderation/', label: '신고/제재', key: 'moderation' },
    { href: '/admin/official-posts/', label: '공식글', key: 'official' },
    { href: '/admin/daily-issues/', label: 'Daily Issue', key: 'daily' },
    { href: '/admin/rights-infringement/', label: '권리침해', key: 'rights' },
    { href: '/admin/moderation/', label: 'Alien 관리 (OFF)', key: 'alien', off: true },
  ];

  function currentKey() {
    var path = String((global.location && global.location.pathname) || '');
    if (path === '/admin' || path === '/admin/') return 'home';
    if (path.indexOf('/admin/posts') === 0) return 'posts';
    if (path.indexOf('/admin/official-posts') === 0) return 'official';
    if (path.indexOf('/admin/daily-issues') === 0) return 'daily';
    if (path.indexOf('/admin/rights-infringement') === 0) return 'rights';
    if (path.indexOf('/admin/moderation') === 0) return 'moderation';
    return '';
  }

  function mount() {
    var nav = global.document.getElementById('sc-admin-nav');
    if (!nav) {
      nav = global.document.createElement('nav');
      nav.id = 'sc-admin-nav';
      nav.className = 'sc-admin-nav';
      nav.setAttribute('aria-label', '관리자 메뉴');
      if (global.document.body) {
        global.document.body.insertBefore(nav, global.document.body.firstChild);
      }
    } else {
      nav.className = (nav.className + ' sc-admin-nav').replace(/sc-admin-nav\s+sc-admin-nav/, 'sc-admin-nav');
    }
    nav.textContent = '';
    var active = currentKey();
    ITEMS.forEach(function (item) {
      var a = global.document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (item.key === active) a.className = 'is-active';
      if (item.off) a.className = (a.className ? a.className + ' ' : '') + 'sc-admin-nav__off';
      nav.appendChild(a);
    });
  }

  global.ScAdminShell = { mount: mount, ITEMS: ITEMS };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }
})(typeof window !== 'undefined' ? window : this);
