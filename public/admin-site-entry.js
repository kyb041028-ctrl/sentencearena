/**
 * 일반 사이트에서 ADMIN/OWNER에게만 게시글 관리 진입점을 보여준다.
 * 버튼은 보안이 아니다.
 */
(function (global) {
  'use strict';

  var core = global.AdminRoleUiCore;

  function readSession() {
    try {
      var raw = global.sessionStorage.getItem('sc_sb_auth_session');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function isOperator() {
    if (!core) return false;
    var role = core.appRoleFromSession(readSession(), global.atob);
    return core.isAdminAppRole(role);
  }

  function mountPostManage(root, post) {
    if (!root || !post || !post.id) return;
    if (!isOperator()) return;
    if (root.querySelector('[data-sc-admin-post-entry]')) return;
    var a = global.document.createElement('a');
    a.setAttribute('data-sc-admin-post-entry', '1');
    a.className = 'sc-btn sc-btn--sm';
    a.textContent = '관리';
    a.href = '/admin/posts/#post=' + encodeURIComponent(post.id);
    root.appendChild(a);
  }

  global.ScAdminSiteEntry = {
    isOperator: isOperator,
    mountPostManage: mountPostManage,
  };
})(typeof window !== 'undefined' ? window : this);
