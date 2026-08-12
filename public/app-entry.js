/**
 * SentenceArena — minimal app entry (login → profile → activity name → territory)
 */
(function (global) {
  'use strict';

  var GUEST_KEY = 'sc_sb_guest_ok';
  var SESSION_TIMEOUT_MS = 5000;

  function el(id) {
    return global.document && global.document.getElementById(id);
  }

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
    if (login) login.hidden = true;
    if (app) app.hidden = true;
    if (onboard) onboard.hidden = true;
    if (err) err.hidden = true;
    try {
      global.document.body.classList.remove('sc-app-mode');
    } catch (_) {}
  }

  function showLogin() {
    hideAllRoots();
    setGuestFlag(false);
    try {
      delete global.__scAuthUserId;
    } catch (_) {
      global.__scAuthUserId = null;
    }
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
    if (global.ScActivityNameOnboarding && typeof global.ScActivityNameOnboarding.show === 'function') {
      global.ScActivityNameOnboarding.show(function (savedProfile) {
        showTerritorySelection(user, savedProfile || profile);
      });
      return;
    }
    showAuthError();
  }

  function loadCurrentProfile(userId) {
    return global.ScAuth.authFetch('/api/me/profile').then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) {
          var err = new Error((j && j.error) || 'PROFILE_LOAD_FAILED');
          err.status = r.status;
          throw err;
        }
        return j.profile;
      });
    });
  }

  function handleAuthenticatedUser(user) {
    return loadCurrentProfile(user.id)
      .then(function (profile) {
        if (needsActivityNameOnboarding(profile)) {
          showActivityName(user, profile);
          return;
        }
        showTerritorySelection(user, profile);
      })
      .catch(function () {
        showAuthError();
      });
  }

  function enterGuest() {
    setGuestFlag(true);
    hideAllRoots();
    try {
      delete global.__scAuthUserId;
    } catch (_) {
      global.__scAuthUserId = null;
    }
    global.__scUserProfileCache = null;
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
          if (provider === 'naver') {
            var status = el('auth-status-login');
            if (status) status.textContent = 'Naver 로그인은 준비 중입니다.';
            return;
          }
          global.ScAuth.login(provider).catch(function (err) {
            var status = el('auth-status-login');
            if (status) {
              status.textContent =
                err && err.message === 'NAVER_NOT_READY'
                  ? 'Naver 로그인은 준비 중입니다.'
                  : '로그인을 시작하지 못했습니다.';
            }
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
    return Promise.race([global.ScAuth.getSession(), timeout])
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
        return handleAuthenticatedUser(session.user);
      })
      .catch(function () {
        showAuthError();
      });
  }

  global.startSentenceArena = startSentenceArena;
})(typeof window !== 'undefined' ? window : this);
