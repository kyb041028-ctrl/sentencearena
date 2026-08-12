/**
 * SentenceArena — single post-auth session controller (provider-agnostic)
 * Owns: BOOTING → UNAUTHENTICATED | PROFILE_INCOMPLETE | READY | GUEST | ERROR
 * Does not own OAuth / PKCE / cookie exchange.
 */
(function (global) {
  'use strict';

  var GUEST_KEY = 'sc_sb_guest_ok';
  var LEGACY_BOARD_TARGET_KEY = 'sc_post_login_target';
  var BOOTSTRAP_PATH = '/api/session/bootstrap';
  var BOOTSTRAP_TIMEOUT_MS = 8000;

  var Core = global.SessionBootstrapCore;
  var STATES = (Core && Core.STATES) || {
    BOOTING: 'BOOTING',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
    READY: 'READY',
    GUEST: 'GUEST',
    ERROR: 'ERROR',
  };

  var started = false;
  var currentState = STATES.BOOTING;
  var lastPayload = null;
  var coreStarted = false;

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

  function setBodyState(state) {
    try {
      if (global.document && global.document.body) {
        global.document.body.setAttribute('data-sc-session', state);
      }
      if (global.document && global.document.documentElement) {
        global.document.documentElement.setAttribute('data-sc-session', state);
      }
    } catch (_) {}
  }

  function hideAllRoots() {
    var login = el('view-login');
    var app = el('view-app');
    var onboard = el('sc-activity-name-onboarding');
    var boot = el('sc-session-boot');
    var err = el('sc-session-error');
    if (login) login.hidden = true;
    if (app) app.hidden = true;
    if (onboard) onboard.hidden = true;
    if (boot) boot.hidden = true;
    if (err) err.hidden = true;
    try {
      global.document.body.classList.remove('sc-app-mode');
    } catch (_) {}
  }

  function cacheAuthProfile(user, profile) {
    global.__scUserProfileCache = {
      authUser: user || null,
      dbProfile: profile || null,
      fetchedAt: Date.now(),
    };
    if (user && user.id) {
      global.__scPlayer = Object.assign({}, global.__scPlayer || {}, { userId: user.id });
      global.__scAuthUserId = user.id;
    }
  }

  function applyReadyChrome(user, profile) {
    var label =
      (profile && profile.display_name && String(profile.display_name).trim()) ||
      (user && user.email) ||
      (user && user.id) ||
      '로그인됨';
    if (typeof global.__scRenderAuthUserBar === 'function') {
      global.__scRenderAuthUserBar(label);
    }
    if (typeof global.__scDockSetMeta === 'function' && user && user.id) {
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
    if (typeof global.rememberDisplayName === 'function' && user && user.id && profile && profile.display_name) {
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

  function startAppCore(user, profile) {
    cacheAuthProfile(user, profile);
    if (!coreStarted) {
      coreStarted = true;
      if (typeof global.startSentenceArenaCore === 'function') {
        global.startSentenceArenaCore();
      } else if (global.__scApp && typeof global.__scApp.enterAppMain === 'function') {
        global.__scApp.enterAppMain();
      }
    }
    applyReadyChrome(user, profile);
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

  function ensureErrorDom() {
    var existing = el('sc-session-error');
    if (existing) return existing;
    var wrap = global.document.createElement('div');
    wrap.id = 'sc-session-error';
    wrap.hidden = true;
    wrap.setAttribute('role', 'alert');
    wrap.innerHTML =
      '<div class="sc-session-error__panel sc-card">' +
      '<p class="sc-session-error__msg">정보를 불러오지 못했습니다.<br />다시 시도해 주세요.</p>' +
      '<button type="button" id="sc-session-error-retry" class="sc-btn sc-btn--primary">다시 시도</button>' +
      '</div>';
    global.document.body.appendChild(wrap);
    var btn = wrap.querySelector('#sc-session-error-retry');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () {
        retryBootstrap();
      });
    }
    return wrap;
  }

  function ensureBootDom() {
    var existing = el('sc-session-boot');
    if (existing) return existing;
    var wrap = global.document.createElement('div');
    wrap.id = 'sc-session-boot';
    wrap.hidden = true;
    wrap.setAttribute('aria-live', 'polite');
    wrap.innerHTML = '<p class="sc-session-boot__msg">회원 상태를 확인하는 중…</p>';
    global.document.body.appendChild(wrap);
    return wrap;
  }

  function renderState(state, payload) {
    currentState = state;
    lastPayload = payload || null;
    setBodyState(state);
    hideAllRoots();
    ensureBootDom();
    ensureErrorDom();

    if (state === STATES.BOOTING) {
      var boot = el('sc-session-boot');
      if (boot) boot.hidden = false;
      return;
    }

    if (state === STATES.UNAUTHENTICATED) {
      coreStarted = false;
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
      return;
    }

    if (state === STATES.PROFILE_INCOMPLETE) {
      var user = payload && payload.user;
      var profile = payload && payload.profile;
      cacheAuthProfile(user, profile);
      setGuestFlag(false);
      if (global.ScActivityNameOnboarding && typeof global.ScActivityNameOnboarding.show === 'function') {
        global.ScActivityNameOnboarding.show(function (savedProfile) {
          renderState(STATES.READY, {
            user: user,
            profile: savedProfile || profile,
          });
        });
      } else {
        renderState(STATES.ERROR, { error: 'ONBOARDING_UI_MISSING', user: user });
      }
      return;
    }

    if (state === STATES.READY) {
      setGuestFlag(false);
      startAppCore(payload && payload.user, payload && payload.profile);
      return;
    }

    if (state === STATES.GUEST) {
      coreStarted = false;
      try {
        delete global.__scAuthUserId;
      } catch (_) {
        global.__scAuthUserId = null;
      }
      if (typeof global.__scEnterGuestApp === 'function') {
        global.__scEnterGuestApp();
      } else if (global.__scApp && typeof global.__scApp.enterAppMain === 'function') {
        global.__scApp.enterAppMain();
      }
      return;
    }

    if (state === STATES.ERROR) {
      var err = el('sc-session-error');
      if (err) err.hidden = false;
      return;
    }
  }

  function fetchBootstrapOnce() {
    var ctrl = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    var timer = null;
    var p = global.fetch(BOOTSTRAP_PATH, {
      credentials: 'same-origin',
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      return r
        .json()
        .then(function (j) {
          return { status: r.status, j: j };
        })
        .catch(function () {
          return { status: r.status, j: null };
        });
    });

    var timeout = new Promise(function (resolve) {
      timer = global.setTimeout(function () {
        try {
          if (ctrl) ctrl.abort();
        } catch (_) {}
        resolve({ status: 0, j: null, timeout: true });
      }, BOOTSTRAP_TIMEOUT_MS);
    });

    return Promise.race([p, timeout]).then(function (pack) {
      if (timer) global.clearTimeout(timer);
      return pack;
    });
  }

  function applyBootstrapResult(pack) {
    if (!pack || pack.timeout || !pack.j) {
      renderState(STATES.ERROR, { error: pack && pack.timeout ? 'TIMEOUT' : 'TRANSPORT' });
      return;
    }
    var j = pack.j;
    var state = j.state;

    if (state === STATES.UNAUTHENTICATED) {
      if (isGuestFlag()) {
        renderState(STATES.GUEST, {});
        return;
      }
      renderState(STATES.UNAUTHENTICATED, {});
      return;
    }

    if (state === STATES.PROFILE_INCOMPLETE) {
      renderState(STATES.PROFILE_INCOMPLETE, { user: j.user, profile: j.profile });
      return;
    }

    if (state === STATES.READY) {
      renderState(STATES.READY, { user: j.user, profile: j.profile });
      return;
    }

    if (state === STATES.ERROR || j.ok === false) {
      renderState(STATES.ERROR, { error: j.error || 'SESSION_BOOTSTRAP_FAILED', user: j.user });
      return;
    }

    renderState(STATES.ERROR, { error: 'UNKNOWN_STATE' });
  }

  function runBootstrap() {
    renderState(STATES.BOOTING, {});
    return fetchBootstrapOnce()
      .then(applyBootstrapResult)
      .catch(function () {
        renderState(STATES.ERROR, { error: 'TRANSPORT' });
      });
  }

  function retryBootstrap() {
    return runBootstrap();
  }

  function enterGuest() {
    setGuestFlag(true);
    renderState(STATES.GUEST, {});
  }

  function onAuthSessionCleared() {
    setGuestFlag(false);
    coreStarted = false;
    lastPayload = null;
    try {
      delete global.__scAuthUserId;
    } catch (_) {
      global.__scAuthUserId = null;
    }
    var bar = el('app-user-status');
    if (bar) bar.textContent = '';
    renderState(STATES.UNAUTHENTICATED, {});
  }

  function wireGuestButton() {
    /* Guest click is owned by index.html → ScSessionController.enterGuest() */
  }

  function start() {
    if (started) return;
    started = true;
    clearLegacyBoardTarget();
    if (global.ScAuthV2 && typeof global.ScAuthV2.wireLoginButtons === 'function') {
      global.ScAuthV2.wireLoginButtons();
    }
    wireGuestButton();
    global.addEventListener('sc:auth-session-cleared', onAuthSessionCleared);
    runBootstrap();
  }

  global.ScSessionController = {
    STATES: STATES,
    start: start,
    retry: retryBootstrap,
    enterGuest: enterGuest,
    getState: function () {
      return currentState;
    },
    renderState: renderState,
  };

  // Back-compat entry used by index.html script tag order
  global.bootstrapSentenceArena = start;
})(typeof window !== 'undefined' ? window : this);
