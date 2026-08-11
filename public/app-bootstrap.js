/**
 * SentenceArena — single app bootstrap (login → core → user → board)
 */
(function (global) {
  'use strict';

  var AUTH_KEY = 'sc_sb_auth_session';
  var GUEST_KEY = 'sc_sb_guest_ok';
  var POST_LOGIN_TARGET = 'sc_post_login_target';
  var bootOnce = false;
  var postLoginDone = false;

  function readStoredAuth() {
    try {
      var raw = global.sessionStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.session || !parsed.session.access_token) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function isGuestSession() {
    try {
      return global.sessionStorage.getItem(GUEST_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function applyAuthenticatedUser(auth) {
    if (!auth || !auth.user) return;
    if (typeof global.__scRenderAuthUserBar === 'function') {
      global.__scRenderAuthUserBar(auth.user.email || auth.user.id || '로그인됨');
    }
  }

  function validateAuthInBackground() {
    if (!global.ScAuthV2 || typeof global.ScAuthV2.applyUserOnce !== 'function') {
      return Promise.resolve();
    }
    return global.ScAuthV2.applyUserOnce().catch(function () {});
  }

  function applyPostLoginTarget() {
    if (postLoginDone) return;
    try {
      var target = global.sessionStorage.getItem(POST_LOGIN_TARGET);
      if (target !== 'board') return;
      if (!readStoredAuth()) return;
      if (!global.__scApp || typeof global.__scApp.goBoard !== 'function') return;
      if (typeof global.__scBoardGoTerritory !== 'function') return;
      postLoginDone = true;
      global.sessionStorage.removeItem(POST_LOGIN_TARGET);
      global.__scApp.goBoard('COMMON');
    } catch (_) {}
  }

  function startExistingAppCore(auth, guest) {
    if (guest && !auth && typeof global.__scEnterGuestApp === 'function') {
      global.__scEnterGuestApp();
      return;
    }
    if (auth && typeof global.startSentenceArenaCore === 'function') {
      global.startSentenceArenaCore();
      return;
    }
    if (global.__scApp && typeof global.__scApp.showLoginOnly === 'function') {
      global.__scApp.showLoginOnly();
    }
  }

  function onAuthUser(ev) {
    var user = ev && ev.detail && ev.detail.user;
    if (!user) return;
    applyAuthenticatedUser({ user: user });
    try {
      if (typeof global.__scPrefetchUserProfile === 'function') {
        global.setTimeout(function () {
          try {
            global.__scPrefetchUserProfile();
          } catch (_) {}
        }, 0);
      }
    } catch (_) {}
  }

  function onAuthSessionCleared() {
    var bar = global.document.getElementById('app-user-status');
    if (bar) bar.textContent = '';
    if (!isGuestSession() && global.__scApp && typeof global.__scApp.showLoginOnly === 'function') {
      global.__scApp.showLoginOnly();
    }
  }

  function bootstrapSentenceArena() {
    if (bootOnce) return;
    bootOnce = true;

    var auth = readStoredAuth();
    var guest = isGuestSession();

    if (global.ScAuthV2 && typeof global.ScAuthV2.wireLoginButtons === 'function') {
      global.ScAuthV2.wireLoginButtons();
    }

    global.addEventListener('sc:auth-user', onAuthUser);
    global.addEventListener('sc:auth-session-cleared', onAuthSessionCleared);

    startExistingAppCore(auth, guest);

    if (auth) {
      applyAuthenticatedUser(auth);
    }

    applyPostLoginTarget();

    if (auth) {
      validateAuthInBackground();
    }
  }

  global.bootstrapSentenceArena = bootstrapSentenceArena;

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bootstrapSentenceArena);
  } else {
    bootstrapSentenceArena();
  }
})(typeof window !== 'undefined' ? window : this);
