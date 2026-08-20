/**
 * SentenceArena — minimal app entry (login → profile → activity name → territory)
 */
(function (global) {
  'use strict';

  var GUEST_KEY = 'sc_sb_guest_ok';
  var SESSION_TIMEOUT_MS = 5000;
  var sessionInflight = null;
  var meProfileInflight = null;

  function el(id) {
    return global.document && global.document.getElementById(id);
  }

  function beginAuthChecking() {
    try {
      if (global.document && global.document.documentElement) {
        global.document.documentElement.classList.add('sc-auth-checking');
      }
    } catch (_) {}
    var boot = el('auth-boot-status');
    if (boot) boot.textContent = '접속중입니다..';
  }

  function endAuthChecking() {
    try {
      if (global.document && global.document.documentElement) {
        global.document.documentElement.classList.remove('sc-auth-checking');
      }
    } catch (_) {}
  }

  function clearSharedAuthFetch(userId) {
    sessionInflight = null;
    if (!userId) {
      meProfileInflight = null;
      try {
        delete global.__scMeProfilePack;
      } catch (_) {
        global.__scMeProfilePack = null;
      }
      return;
    }
    var uid = String(userId || '').trim();
    if (meProfileInflight && meProfileInflight.userId !== uid) meProfileInflight = null;
    var pack = global.__scMeProfilePack;
    if (pack && pack.userId !== uid) {
      try {
        delete global.__scMeProfilePack;
      } catch (_) {
        global.__scMeProfilePack = null;
      }
    }
  }

  function getSessionShared() {
    if (sessionInflight) return sessionInflight;
    if (!global.ScAuth || typeof global.ScAuth.getSession !== 'function') {
      return Promise.reject(new Error('NO_AUTH'));
    }
    sessionInflight = global.ScAuth.getSession();
    return sessionInflight;
  }

  function fetchMeProfileJson(userId) {
    var uid = String(userId || '').trim();
    if (!uid) return Promise.reject(new Error('NO_USER'));
    var pack = global.__scMeProfilePack;
    if (pack && pack.userId === uid && pack.json && pack.json.ok) {
      return Promise.resolve(pack.json);
    }
    if (meProfileInflight && meProfileInflight.userId === uid) {
      return meProfileInflight.promise;
    }
    var promise = global.ScAuth.authFetch('/api/me/profile').then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) {
          var err = new Error((j && j.error) || 'PROFILE_LOAD_FAILED');
          err.status = r.status;
          throw err;
        }
        global.__scMeProfilePack = { userId: uid, json: j, fetchedAt: Date.now() };
        return j;
      });
    });
    meProfileInflight = { userId: uid, promise: promise };
    promise.then(
      function () {},
      function () {},
    ).then(function () {
      if (meProfileInflight && meProfileInflight.promise === promise) meProfileInflight = null;
    });
    return promise;
  }

  global.__scGetSessionShared = getSessionShared;
  global.__scFetchMeProfileJson = fetchMeProfileJson;

  function isGuestFlag() {
    try {
      return global.sessionStorage.getItem(GUEST_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setGuestFlag(on) {
    try {
      if (on) global.sessionStorage.setItem(GUEST_KEY, '1');
      else global.sessionStorage.removeItem(GUEST_KEY);
    } catch (_) {}
  }

  function hideAllRoots() {
    var login = el('view-login');
    var app = el('view-app');
    var onboard = el('sc-activity-name-onboarding');
    var err = el('sc-auth-error');
    var legal = el('sc-legal-gate');
    if (login) login.hidden = true;
    if (app) app.hidden = true;
    if (onboard) onboard.hidden = true;
    if (err) err.hidden = true;
    if (legal) legal.hidden = true;
    try {
      global.document.body.classList.remove('sc-app-mode');
    } catch (_) {}
  }

  function showLogin() {
    hideAllRoots();
    setGuestFlag(false);
    clearSharedAuthFetch();
    try {
      delete global.__scAuthUserId;
    } catch (_) {
      global.__scAuthUserId = null;
    }
    endAuthChecking();
    if (global.__scApp && typeof global.__scApp.showLoginOnly === 'function') {
      global.__scApp.showLoginOnly();
    } else {
      var login = el('view-login');
      if (login) login.hidden = false;
    }
    var boot = el('auth-boot-status');
    if (boot) boot.textContent = '';
  }

  function ensureErrorDom() {
    var existing = el('sc-auth-error');
    if (existing) return existing;
    var wrap = global.document.createElement('div');
    wrap.id = 'sc-auth-error';
    wrap.hidden = true;
    wrap.setAttribute('role', 'alert');
    wrap.innerHTML =
      '<div class="sc-auth-error__panel sc-card">' +
      '<p class="sc-auth-error__msg">로그인 정보를 확인하지 못했습니다.</p>' +
      '<button type="button" id="sc-auth-error-retry" class="sc-btn sc-btn--primary">다시 시도</button>' +
      '</div>';
    global.document.body.appendChild(wrap);
    var btn = wrap.querySelector('#sc-auth-error-retry');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () {
        startSentenceArena();
      });
    }
    return wrap;
  }

  function showAuthError() {
    hideAllRoots();
    endAuthChecking();
    var err = ensureErrorDom();
    err.hidden = false;
  }

  function needsActivityNameOnboarding(profile) {
    if (!profile) return true;
    var Core = global.ActivityNameCore;
    if (Core && typeof Core.isCompleteActivityName === 'function') {
      return !Core.isCompleteActivityName(profile.display_name);
    }
    return !String(profile.display_name || '').trim();
  }

  function cacheMember(user, profile) {
    global.__scAuthUserId = user.id;
    global.__scPlayer = Object.assign({}, global.__scPlayer || {}, { userId: user.id });
    global.__scUserProfileCache = {
      authUser: user,
      dbProfile: profile || null,
      fetchedAt: Date.now(),
    };
  }

  function showTerritorySelection(user, profile) {
    hideAllRoots();
    setGuestFlag(false);
    cacheMember(user, profile);
    endAuthChecking();
    if (typeof global.startSentenceArenaCore === 'function') {
      global.startSentenceArenaCore();
    } else if (global.__scApp && typeof global.__scApp.enterAppMain === 'function') {
      global.__scApp.enterAppMain();
    }
    var label =
      (profile && profile.display_name && String(profile.display_name).trim()) ||
      (user && user.email) ||
      (user && user.id) ||
      '로그인됨';
    if (typeof global.__scRenderAuthUserBar === 'function') {
      global.__scRenderAuthUserBar(label);
    }
    if (typeof global.rememberDisplayName === 'function' && user.id && profile && profile.display_name) {
      global.rememberDisplayName(user.id, profile.display_name);
    }
    try {
      if (typeof global.CustomEvent === 'function') {
        global.dispatchEvent(
          new global.CustomEvent('sc:auth-user', { detail: { user: user, profile: profile || null } }),
        );
      }
    } catch (_) {}
  }

  function showActivityName(user, profile) {
    hideAllRoots();
    setGuestFlag(false);
    cacheMember(user, profile);
    endAuthChecking();
    if (global.ScActivityNameOnboarding && typeof global.ScActivityNameOnboarding.show === 'function') {
      global.ScActivityNameOnboarding.show(function (savedProfile) {
        showTerritorySelection(user, savedProfile || profile);
      });
      return;
    }
    showAuthError();
  }

  function loadCurrentProfile(userId) {
    return fetchMeProfileJson(userId).then(function (j) {
      return j.profile;
    });
  }

  function continueAfterLegal(user, profile) {
    if (needsActivityNameOnboarding(profile)) {
      showActivityName(user, profile);
      return;
    }
    showTerritorySelection(user, profile);
  }

  function showLegalGate(user, profile, legal) {
    hideAllRoots();
    setGuestFlag(false);
    cacheMember(user, profile);
    endAuthChecking();
    if (!global.ScLegalGateUI || typeof global.ScLegalGateUI.showPostLogin !== 'function') {
      showAuthError();
      return;
    }
    global.ScLegalGateUI.showPostLogin({
      legal: legal || {},
      onComplete: function () {
        clearSharedAuthFetch(user.id);
        loadCurrentProfile(user.id)
          .then(function (nextProfile) {
            continueAfterLegal(user, nextProfile || profile);
          })
          .catch(function () {
            showAuthError();
          });
      },
    });
  }

  function handleAuthenticatedUser(user) {
    return fetchMeProfileJson(user.id)
      .then(function (j) {
        var profile = j && j.profile;
        var legal = (j && j.legal) || {};
        if (!legal.complete) {
          showLegalGate(user, profile, legal);
          return;
        }
        continueAfterLegal(user, profile);
      })
      .catch(function () {
        showAuthError();
      });
  }

  function enterGuest() {
    setGuestFlag(true);
    hideAllRoots();
    clearSharedAuthFetch();
    try {
      delete global.__scAuthUserId;
    } catch (_) {
      global.__scAuthUserId = null;
    }
    global.__scUserProfileCache = null;
    endAuthChecking();
    if (typeof global.__scResetLocalStateForGuestEntry === 'function') {
      global.__scResetLocalStateForGuestEntry();
    }
    if (typeof global.__scDockSetMeta === 'function') {
      global.__scDockSetMeta(
        'guest_demo',
        '정치 성향 없음 (미분류)',
        'COMMON · 중앙광장',
        '명성 · 레벨 4 달성 후 해금',
        null,
      );
    }
    if (typeof global.__scApplyStoredKantaAffiliation === 'function') {
      global.__scApplyStoredKantaAffiliation();
    }
    if (typeof global.__scRefreshAlignmentUI === 'function') {
      global.__scRefreshAlignmentUI();
    }
    if (typeof global.__scRefreshProgressionUI === 'function') {
      global.__scRefreshProgressionUI();
    }
    if (typeof global.__scRefreshBoardView === 'function') {
      global.__scRefreshBoardView();
    }
    if (typeof global.__scEnterGuestApp === 'function') {
      global.__scEnterGuestApp();
    } else if (global.__scApp && typeof global.__scApp.enterAppMain === 'function') {
      global.__scApp.enterAppMain();
    }
  }

  function wireLoginButtons() {
    var grid = el('oauth-buttons');
    if (!grid || grid.dataset.scAuthWired) return;
    grid.dataset.scAuthWired = '1';
    var links = grid.querySelectorAll('[data-provider]');
    for (var i = 0; i < links.length; i++) {
      (function (node) {
        node.addEventListener('click', function (e) {
          e.preventDefault();
          var provider = node.getAttribute('data-provider');
          if (global.ScLegalGateUI && typeof global.ScLegalGateUI.startOAuth === 'function') {
            global.ScLegalGateUI.startOAuth(provider);
            return;
          }
          global.ScAuth.login(provider).catch(function () {
            var status = el('auth-status-login');
            if (status) status.textContent = '로그인을 시작하지 못했습니다.';
          });
        });
      })(links[i]);
    }
    var guestBtn = el('auth-guest-btn');
    if (guestBtn && !guestBtn.dataset.scGuestWired) {
      guestBtn.dataset.scGuestWired = '1';
      guestBtn.addEventListener('click', function () {
        enterGuest();
      });
    }
  }

  function startSentenceArena() {
    beginAuthChecking();
    wireLoginButtons();
    if (isGuestFlag()) {
      enterGuest();
      return Promise.resolve();
    }
    if (!global.ScAuth || typeof global.ScAuth.getSession !== 'function') {
      showAuthError();
      return Promise.resolve();
    }
    var timeout = new Promise(function (_resolve, reject) {
      global.setTimeout(function () {
        reject(new Error('TIMEOUT'));
      }, SESSION_TIMEOUT_MS);
    });
    return Promise.race([getSessionShared(), timeout])
      .then(function (result) {
        if (!result || result.error) {
          showAuthError();
          return;
        }
        var session = result.data && result.data.session;
        if (!session || !session.user || !session.user.id) {
          showLogin();
          return;
        }
        clearSharedAuthFetch(session.user.id);
        return handleAuthenticatedUser(session.user);
      })
      .catch(function () {
        showAuthError();
      });
  }

  global.startSentenceArena = startSentenceArena;
})(typeof window !== 'undefined' ? window : this);
