/**
 * SentenceArena — app bootstrap (cookie auth via /api/auth/me)
 * 인증 후 display_name 미완료면 활동명 온보딩 → 완료 후 영토 선택
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

  function clearGuestSession() {
    try {
      global.sessionStorage.removeItem(GUEST_KEY);
    } catch (_) {}
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

  function needsActivityName(profile) {
    var Core = global.ActivityNameCore;
    var name = profile && profile.display_name != null ? profile.display_name : '';
    if (Core && typeof Core.isCompleteActivityName === 'function') {
      return !Core.isCompleteActivityName(name);
    }
    return !String(name || '').trim();
  }

  function cacheAuthProfile(user, profile) {
    global.__scUserProfileCache = {
      authUser: user || null,
      dbProfile: profile || null,
      fetchedAt: Date.now(),
    };
    if (user && user.id) {
      global.__scPlayer = Object.assign({}, global.__scPlayer || {}, {
        userId: user.id,
      });
    }
  }

  function applyAuthenticatedUser(user, profile) {
    if (!user) return;
    var label =
      (profile && profile.display_name && String(profile.display_name).trim()) ||
      user.email ||
      user.id ||
      '로그인됨';
    if (typeof global.__scRenderAuthUserBar === 'function') {
      global.__scRenderAuthUserBar(label);
    }
    if (typeof global.__scDockSetMeta === 'function' && user.id) {
      try {
        global.__scDockSetMeta(
          user.id,
          '정치 성향 없음 (미분류)',
          'COMMON · 중앙광장',
          '명성 · 레벨 4 달성 후 해금',
          null,
        );
      } catch (_) {}
    }
    if (typeof global.rememberDisplayName === 'function' && user.id && profile && profile.display_name) {
      global.rememberDisplayName(user.id, profile.display_name);
    }
    try {
      if (typeof global.CustomEvent === 'function') {
        global.dispatchEvent(
          new CustomEvent('sc:auth-user', { detail: { user: user, profile: profile || null } }),
        );
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

  function startAuthenticatedApp(user, profile) {
    cacheAuthProfile(user, profile);
    if (typeof global.startSentenceArenaCore === 'function') {
      global.startSentenceArenaCore();
    }
    applyAuthenticatedUser(user, profile);
    if (typeof global.__scPrefetchUserProfile === 'function') {
      try {
        global.__scPrefetchUserProfile();
      } catch (_) {}
    }
    if (typeof global.refreshCurrentProfile === 'function') {
      try {
        global.refreshCurrentProfile();
      } catch (_) {}
    }
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

  function fetchMyProfile() {
    return global
      .fetch('/api/me/profile', { credentials: 'same-origin' })
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

  function enterWithProfileGate(user) {
    clearGuestSession();
    cacheAuthProfile(user, null);
    return fetchMyProfile().then(function (pack) {
      var profile = pack.j && pack.j.ok ? pack.j.profile : null;
      cacheAuthProfile(user, profile);
      if (needsActivityName(profile)) {
        if (global.ScActivityNameOnboarding && typeof global.ScActivityNameOnboarding.show === 'function') {
          global.ScActivityNameOnboarding.show(function (savedProfile) {
            startAuthenticatedApp(user, savedProfile || profile);
          });
          return;
        }
      }
      startAuthenticatedApp(user, profile);
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
        enterWithProfileGate(j.user);
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
