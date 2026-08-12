/**
 * SentenceArena — single Supabase browser auth client (PKCE session in browser storage)
 */
(function (global) {
  'use strict';

  var CALLBACK_PATH = '/auth-v2/callback.html';
  var client = null;
  var initPromise = null;
  var cachedAccessToken = null;

  function redirectTo() {
    return global.location.origin + CALLBACK_PATH;
  }

  function loadClient() {
    if (initPromise) return initPromise;
    initPromise = global
      .fetch('/api/supabase-config', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (pack) {
        var j = pack.j || {};
        if (!pack.ok || !j.ok || !j.url || !j.anonKey) {
          throw new Error('SUPABASE_NOT_CONFIGURED');
        }
        if (!global.supabase || typeof global.supabase.createClient !== 'function') {
          throw new Error('SUPABASE_JS_MISSING');
        }
        client = global.supabase.createClient(j.url, j.anonKey, {
          auth: {
            flowType: 'pkce',
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
        client.auth.onAuthStateChange(function (_event, session) {
          cachedAccessToken = session && session.access_token ? session.access_token : null;
        });
        return client.auth.getSession().then(function (result) {
          cachedAccessToken =
            result.data && result.data.session && result.data.session.access_token
              ? result.data.session.access_token
              : null;
          return client;
        });
      });
    return initPromise;
  }

  function getSession() {
    return loadClient().then(function (c) {
      return c.auth.getSession();
    });
  }

  function login(provider) {
    var p = provider ? String(provider).trim().toLowerCase() : 'google';
    if (p === 'naver') {
      return Promise.reject(new Error('NAVER_NOT_READY'));
    }
    return loadClient().then(function (c) {
      var options = { redirectTo: redirectTo() };
      if (p === 'kakao') {
        options.scopes = 'profile_nickname profile_image';
      }
      return c.auth.signInWithOAuth({ provider: p, options: options });
    });
  }

  function logout() {
    return loadClient()
      .then(function (c) {
        return c.auth.signOut();
      })
      .finally(function () {
        cachedAccessToken = null;
        initPromise = null;
        client = null;
      });
  }

  function getAccessToken() {
    if (cachedAccessToken) return Promise.resolve(cachedAccessToken);
    return getSession().then(function (result) {
      var token =
        result.data && result.data.session && result.data.session.access_token
          ? result.data.session.access_token
          : null;
      cachedAccessToken = token;
      return token;
    });
  }

  function getAccessTokenSync() {
    return cachedAccessToken;
  }

  function authFetch(url, options) {
    return getAccessToken().then(function (token) {
      var opts = options ? Object.assign({}, options) : {};
      opts.headers = Object.assign({}, opts.headers || {});
      if (token) opts.headers.Authorization = 'Bearer ' + token;
      return global.fetch(url, opts);
    });
  }

  /** OAuth callback page — session restore only, then redirect to / */
  function finishOAuthCallback() {
    return loadClient().then(function (c) {
      return c.auth.getSession().then(function (result) {
        if (result.error) throw result.error;
        if (result.data && result.data.session) return result.data.session;
        var params = new URLSearchParams(global.location.search);
        var code = params.get('code');
        if (!code) throw new Error('NO_AUTH_CODE');
        return c.auth.exchangeCodeForSession(code).then(function (ex) {
          if (ex.error) throw ex.error;
          cachedAccessToken = ex.data.session.access_token;
          return ex.data.session;
        });
      });
    });
  }

  global.ScAuth = {
    loadClient: loadClient,
    getSession: getSession,
    login: login,
    logout: logout,
    getAccessToken: getAccessToken,
    getAccessTokenSync: getAccessTokenSync,
    authFetch: authFetch,
    finishOAuthCallback: finishOAuthCallback,
    redirectTo: redirectTo,
  };
})(typeof window !== 'undefined' ? window : this);
