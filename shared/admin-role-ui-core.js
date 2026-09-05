/**
 * 관리자 화면 표시용 역할 판정.
 * 보안이 아니다. 실제 조치는 createAdminAccessGuard가 막는다.
 * app_metadata.role 만 본다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdminRoleUiCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function adminRoleUiCoreFactory() {
  'use strict';

  function normalizeRole(v) {
    return String(v || '').trim().toUpperCase();
  }

  function isAdminAppRole(role) {
    var r = normalizeRole(role);
    return r === 'ADMIN' || r === 'OWNER';
  }

  function decodeJwtPayload(token, atobFn) {
    var parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    var raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (raw.length % 4) raw += '=';
    try {
      var json;
      if (typeof atobFn === 'function') {
        json = atobFn(raw);
      } else if (typeof Buffer !== 'undefined') {
        json = Buffer.from(raw, 'base64').toString('utf8');
      } else {
        return null;
      }
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function appRoleFromAccessToken(token, atobFn) {
    var payload = decodeJwtPayload(token, atobFn);
    if (!payload || !payload.app_metadata) return '';
    return normalizeRole(payload.app_metadata.role);
  }

  function appRoleFromSession(session, atobFn) {
    var bundle = session || {};
    var token = bundle.session && bundle.session.access_token;
    if (token) return appRoleFromAccessToken(token, atobFn);
    return '';
  }

  return {
    normalizeRole: normalizeRole,
    isAdminAppRole: isAdminAppRole,
    decodeJwtPayload: decodeJwtPayload,
    appRoleFromAccessToken: appRoleFromAccessToken,
    appRoleFromSession: appRoleFromSession,
  };
});
