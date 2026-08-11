/**
 * SentenceArena — app bootstrap (cookie auth via /api/auth/me)
 */
(function (global) {
  'use strict';

  var GUEST_KEY = 'sc_sb_guest_ok';
  var LEGACY_BOARD_TARGET_KEY = 'sc_post_login_target';
  var bootOnce = false;
  var authChecked = false;

  function isGuestSession() {
    try {
      return global.sessionStorage.getItem(GUEST_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function clearLegacyBoardTarget() {
    try {
      global.sessionStorage.removeItem(LEGACY_BOARD_TARGET_KEY);
    } catch (_) {}
    try {
      var params = new URLSearchParams(global.location.search);
      if (!params.has('postLogin')) return;
      params.delete('postLogin');
      var qs = params.toString();
      var next =
        global.location.pathname + (qs ? '?' + qs : '') + (global.location.hash || '');
      global.history.replaceState({}, '', next);
    } catch (_) {}
  }

  function applyAuthenticatedUser(user) {
    if (!user) return;
    if (typeof global.__scRenderAuthUserBar === 'function') {
      global.__scRenderAuthUserBar(user.email || user.id || '로그인됨');
    }
    try {
      if (typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new CustomEvent('sc:auth-user', { detail: { user: user } }));
      }
    } catch (_) {}
  }

  function showLoginScreen() {
    if (global.__scApp && typeof global.__scApp.showLoginOnly === 'function') {
      global.__scApp.showLoginOnly();
    }
  }

  function startGuestApp() {
    if (typeof global.__scEnterGuestApp === 'function') {
      global.__scEnterGuestApp();
    }
  }

  function startAuthenticatedApp(user) {
    if (typeof global.startSentenceArenaCore === 'function') {
      global.startSentenceArenaCore();
    }
    applyAuthenticatedUser(user);
  }

  function fetchAuthMeOnce() {
    if (authChecked) return Promise.resolve(null);
    authChecked = true;
    return global
      .fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) {
        return r
          .json()
          .then(function (j) {
            return { status: r.status, j: j };
          })
          .catch(function () {
            return { status: r.status, j: { ok: false } };
          });
      })
      .catch(function () {
        return { status: 0, j: { ok: false } };
      });
  }

  function onAuthSessionCleared() {
    var bar = global.document && global.document.getElementById('app-user-status');
    if (bar) bar.textContent = '';
    if (!isGuestSession()) showLoginScreen();
  }

  function bootstrapSentenceArena() {
    if (bootOnce) return;
    bootOnce = true;

    clearLegacyBoardTarget();

    if (global.ScAuthV2 && typeof global.ScAuthV2.wireLoginButtons === 'function') {
      global.ScAuthV2.wireLoginButtons();
    }

    global.addEventListener('sc:auth-session-cleared', onAuthSessionCleared);

    fetchAuthMeOnce().then(function (pack) {
      var j = pack.j || {};
      if (pack.status === 200 && j.ok && j.user && j.user.id) {
        startAuthenticatedApp(j.user);
        return;
      }
      if (isGuestSession()) {
        startGuestApp();
        return;
      }
      showLoginScreen();
    });
  }

  global.bootstrapSentenceArena = bootstrapSentenceArena;

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bootstrapSentenceArena);
  } else {
    bootstrapSentenceArena();
  }
})(typeof window !== 'undefined' ? window : this);
