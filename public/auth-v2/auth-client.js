/**
 * SentenceArena auth-v2 — cookie session (no browser token storage)
 */
(function (global) {
  'use strict';

  function wireLoginButtons() {
    var grid = global.document && global.document.getElementById('oauth-buttons');
    if (!grid || grid.dataset.scAuthV2Wired) return;
    grid.dataset.scAuthV2Wired = '1';
    var links = grid.querySelectorAll('a[href*="/api/auth/oauth/"]');
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        a.addEventListener('click', function () {});
      })(links[i]);
    }
  }

  function startOAuth(provider) {
    var p = provider ? String(provider).trim().toLowerCase() : 'google';
    global.location.assign('/api/auth/oauth/' + encodeURIComponent(p));
  }

  function signOut() {
    return global
      .fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(function () {})
      .finally(function () {
        try {
          global.sessionStorage.removeItem('sc_sb_guest_ok');
        } catch (_) {}
        try {
          if (typeof global.CustomEvent === 'function') {
            global.dispatchEvent(new CustomEvent('sc:auth-session-cleared', { detail: { reason: 'logout' } }));
          }
        } catch (_) {}
        global.location.assign('/');
      });
  }

  function boot() {
    wireLoginButtons();
  }

  global.ScAuthV2 = {
    wireLoginButtons: wireLoginButtons,
    startOAuth: startOAuth,
    signOut: signOut,
    boot: boot,
  };
})(typeof window !== 'undefined' ? window : this);
