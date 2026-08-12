/**
 * SentenceArena — app entry (thin wrapper)
 * Post-auth member entry is owned by public/session-controller.js
 */
(function (global) {
  'use strict';

  function boot() {
    if (global.ScSessionController && typeof global.ScSessionController.start === 'function') {
      global.ScSessionController.start();
      return;
    }
    // Fallback should never hit if scripts load in order.
    if (typeof global.bootstrapSentenceArena === 'function' && global.bootstrapSentenceArena !== boot) {
      global.bootstrapSentenceArena();
    }
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
