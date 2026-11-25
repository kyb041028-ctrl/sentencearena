(function (global) {
  'use strict';

  var STATE_LABEL = {
    OK: '정상',
    NOT_CONFIRMED: '미확인',
    NOT_COLLECTED: '미수집',
    NO_DATA: '데이터 없음',
    NO_RECORD: '기록 없음',
    NOT_SET: '미설정',
    FAIL: '실패',
  };

  function authHeaders(json) {
    var headers = { Accept: 'application/json' };
    if (json) headers['Content-Type'] = 'application/json';
    try {
      var raw = global.sessionStorage.getItem('sc_sb_auth_session');
      if (raw) {
        var auth = JSON.parse(raw);
        var token = auth && auth.session && auth.session.access_token;
        if (token) headers.Authorization = 'Bearer ' + token;
      }
    } catch (_) {}
    return headers;
  }

  function api(method, url, body) {
    var init = { method: method, headers: authHeaders(body != null), credentials: 'same-origin' };
    if (body != null) init.body = JSON.stringify(body);
    return global.fetch(url, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { status: res.status, body: data };
      });
    });
  }

  function el(tag, text, className) {
    var node = global.document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function authMessage(status) {
    if (status === 401) return '로그인이 필요합니다. 관리자 계정으로 로그인한 뒤 다시 열어 주세요.';
    if (status === 403) return '관리자(ADMIN/OWNER) 권한이 없습니다.';
    return null;
  }

  function stateBadge(status) {
    var cls = 'sc-hub-state' + (status === 'OK' ? ' sc-hub-state--ok' : status === 'FAIL' ? ' sc-hub-state--bad' : '');
    return el('span', STATE_LABEL[status] || status || '미확인', cls);
  }

  function fmtTime(iso) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    return new Date(t + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' KST';
  }

  global.ScAdminHub = {
    STATE_LABEL: STATE_LABEL,
    api: api,
    el: el,
    authMessage: authMessage,
    stateBadge: stateBadge,
    fmtTime: fmtTime,
  };
})(window);
