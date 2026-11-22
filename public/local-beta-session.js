/**
 * 로컬 시험 로그인. 서버가 꺼 두면 아무것도 하지 않는다.
 * 운영 화면 배치는 바꾸지 않는다.
 */
(function (global) {
  'use strict';

  var KEY = 'sa_local_beta_token';
  var USER_KEY = 'sa_local_beta_user';

  function token() {
    try { return global.sessionStorage.getItem(KEY) || ''; }
    catch (_) { return ''; }
  }

  function setToken(value) {
    try {
      if (value) global.sessionStorage.setItem(KEY, value);
      else global.sessionStorage.removeItem(KEY);
    } catch (_) {}
  }

  function install(userId) {
    var auth = global.ScAuth || {};
    auth.getAccessToken = function () { return Promise.resolve(token()); };
    auth.getAccessTokenSync = function () { return token(); };
    auth.authFetch = function (url, options) {
      var opts = options ? Object.assign({}, options) : {};
      opts.headers = Object.assign({}, opts.headers || {});
      opts.credentials = 'same-origin';
      if (token()) opts.headers.Authorization = 'Bearer ' + token();
      return global.fetch(url, opts);
    };
    auth.getSession = function () {
      return Promise.resolve({
        data: { session: token() ? { access_token: token(), user: { id: userId || 'local' } } : null },
      });
    };
    auth.login = function () { return Promise.resolve(); };
    auth.logout = function () {
      setToken('');
      return Promise.resolve();
    };
    global.ScAuth = auth;
  }

  function paint(userId) {
    if (global.document.getElementById('local-beta-login')) return;
    var box = global.document.createElement('form');
    box.id = 'local-beta-login';
    box.setAttribute('data-local-only', '1');
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:80;background:#111;color:#fff;padding:10px;display:grid;gap:6px;font:12px sans-serif';
    box.innerHTML = '<div>로컬 시험 로그인</div><input name="email" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button type="submit">로그인</button>';
    box.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(box);
      global.fetch('/api/local-session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      }).then(function (res) { return res.json(); }).then(function (body) {
        if (!body || !body.token) return;
        setToken(body.token);
        try { global.sessionStorage.setItem(USER_KEY, body.userId || ''); } catch (_) {}
        install(body.userId);
        global.location.reload();
      });
    });
    global.document.body.appendChild(box);
    if (userId) box.style.display = 'none';
  }

  function savedUser() {
    try { return global.sessionStorage.getItem(USER_KEY) || ''; }
    catch (_) { return ''; }
  }

  function refreshProfile() {
    if (typeof global.__scPrefetchUserProfile === 'function') {
      global.__scPrefetchUserProfile();
    }
  }

  function start() {
    if (token()) install(savedUser());
    global.fetch('/api/local-session/status', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (!body || body.enabled !== true) return;
        if (token()) {
          install(savedUser());
          refreshProfile();
        }
        if (global.document.body) paint(token());
        else global.addEventListener('DOMContentLoaded', function () { paint(token()); });
      })
      .catch(function () {});
  }

  start();
})(typeof window !== 'undefined' ? window : this);
