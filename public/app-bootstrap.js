/**
 * SentenceArena — app entry (delegates to startSentenceArena)
 */
(function (global) {
  'use strict';

  function boot() {
    if (typeof global.startSentenceArena === 'function') {
      global.startSentenceArena();
      return;
    }
    if (global.__scApp && typeof global.__scApp.showLoginOnly === 'function') {
      global.__scApp.showLoginOnly();
    }
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
