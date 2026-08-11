/**
 * SentenceArena — browser auth (session only; does not gate app boot)
 * Session: sc_sb_auth_session { user, session:{ access_token, ... } }
 */
(function (global) {
  'use strict';

  var AUTH_KEY = 'sc_sb_auth_session';
  var GUEST_KEY = 'sc_sb_guest_ok';
  var OAUTH_SID_KEY = 'sc_oauth_sid';
  var OAUTH_VERIFIER_KEY = 'sc_oauth_verifier';

  var applyStarted = false;
  var pendingUser = null;

  function readSession() {
    try {
      var raw = global.sessionStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.session || !parsed.session.access_token) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeSession(bundle) {
    if (
      !bundle ||
      !bundle.user ||
      !bundle.user.id ||
      !bundle.session ||
      !bundle.session.access_token ||
      !bundle.session.refresh_token
    ) {
      return false;
    }
    global.sessionStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        user: {
          id: bundle.user.id,
          email: bundle.user.email || null,
          role: bundle.user.role || null,
        },
        session: {
          access_token: bundle.session.access_token,
          refresh_token: bundle.session.refresh_token,
          token_type: bundle.session.token_type || 'bearer',
          expires_in: bundle.session.expires_in,
          expires_at: bundle.session.expires_at,
        },
      }),
    );
    return true;
  }

  function clearSession() {
    try {
      global.sessionStorage.removeItem(AUTH_KEY);
    } catch (_) {}
  }

  function clearOAuthTemp() {
    try {
      global.sessionStorage.removeItem(OAUTH_SID_KEY);
      global.sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
    } catch (_) {}
  }

  function getAccessToken() {
    var auth = readSession();
    return auth && auth.session && auth.session.access_token
      ? String(auth.session.access_token)
      : '';
  }

  function emit(name, detail) {
    var payload = detail || {};
    if (name === 'sc:auth-user') pendingUser = payload;
    try {
      if (typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new CustomEvent(name, { detail: payload }));
      }
    } catch (_) {}
  }

  function fetchMe(token, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer =
      ctrl &&
      setTimeout(function () {
        try {
          ctrl.abort();
        } catch (_) {}
      }, ms || 8000);
    var opts = { headers: { Authorization: 'Bearer ' + token } };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch('/api/auth/me', opts).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  /** Non-blocking: verify session and apply user UI only */
  function applyUserOnce() {
    if (applyStarted) return Promise.resolve(null);
    applyStarted = true;

    var auth = readSession();
    var token = auth && auth.session && auth.session.access_token;
    if (!token) return Promise.resolve(null);

    return fetchMe(token, 8000)
      .then(function (r) {
        return r
          .json()
          .then(function (j) {
            return { status: r.status, okHttp: r.ok, j: j };
          })
          .catch(function () {
            return { status: r.status, okHttp: r.ok, j: { ok: false } };
          });
      })
      .then(function (pack) {
        var j = pack.j || {};
        if (pack.okHttp && j.ok && j.user && j.user.id) {
          var cur = readSession() || { session: auth.session };
          cur.user = {
            id: j.user.id,
            email: j.user.email || null,
            role: j.user.role || null,
          };
          if (cur.session) writeSession(cur);
          emit('sc:auth-user', { user: cur.user });
          return cur.user;
        }
        if (pack.status === 401) {
          clearSession();
          emit('sc:auth-session-cleared', { reason: 'unauthorized' });
          return null;
        }
        if (auth.user && auth.user.id) {
          emit('sc:auth-user', { user: auth.user, soft: true });
          return auth.user;
        }
        return null;
      })
      .catch(function () {
        if (auth && auth.user && auth.user.id) {
          emit('sc:auth-user', { user: auth.user, soft: true });
          return auth.user;
        }
        return null;
      });
  }

  function boot() {
    applyUserOnce();
  }

  function startGoogleOAuth() {
    global.location.assign('/api/auth/oauth/google');
  }

  function signOut() {
    var token = getAccessToken();
    var req = token
      ? fetch('/api/auth/signout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
        }).catch(function () {})
      : Promise.resolve();
    return req.finally(function () {
      clearSession();
      clearOAuthTemp();
      try {
        global.sessionStorage.removeItem(GUEST_KEY);
      } catch (_) {}
      global.location.reload();
    });
  }

  function consumePendingUser() {
    var d = pendingUser;
    pendingUser = null;
    return d;
  }

  global.ScAuth = {
    AUTH_KEY: AUTH_KEY,
    readSession: readSession,
    writeSession: writeSession,
    clearSession: clearSession,
    getAccessToken: getAccessToken,
    boot: boot,
    applyUserOnce: applyUserOnce,
    startGoogleOAuth: startGoogleOAuth,
    signOut: signOut,
    consumePendingUser: consumePendingUser,
  };
})(typeof window !== 'undefined' ? window : this);
