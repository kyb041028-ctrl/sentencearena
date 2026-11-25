/**
 * One phone-only notice. Does not rotate the device or create a session.
 * Hidden while login, signup, legal consent, or withdrawal is open.
 */
(function (global) {
  'use strict';

  var SEEN_KEY = 'sc_mobile_pc_notice_seen';
  var BLOCKING_IDS = [
    'view-login',
    'sc-auth-error',
    'sc-legal-gate',
    'sc-activity-name-onboarding',
    'sc-first-visit-guide',
    'sc-withdraw-dialog',
    'sc-sensitive-withdraw-dialog',
  ];
  var seenMemory = false;
  var observer = null;
  var scheduled = false;

  function el(id) {
    return global.document && global.document.getElementById(id);
  }

  function isSeen() {
    if (seenMemory) return true;
    try {
      return global.sessionStorage.getItem(SEEN_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function markSeen() {
    seenMemory = true;
    try {
      global.sessionStorage.setItem(SEEN_KEY, '1');
    } catch (_) {}
  }

  function isActualMobile() {
    var root = global.document && global.document.documentElement;
    return !!(root && root.classList.contains('sc-mobile-pc-scale'));
  }

  function isOpen(id) {
    var node = el(id);
    if (!node || node.hidden) return false;
    if (node.getAttribute('aria-hidden') === 'true' && id !== 'view-login') return false;
    return true;
  }

  function isBlockingRequiredFlow() {
    var doc = global.document;
    if (doc && doc.documentElement && doc.documentElement.classList.contains('sc-auth-checking')) {
      return true;
    }
    for (var i = 0; i < BLOCKING_IDS.length; i++) {
      if (isOpen(BLOCKING_IDS[i])) return true;
    }
    return false;
  }

  function hideNotice() {
    var notice = el('sc-mobile-landscape-notice');
    if (notice) notice.hidden = true;
  }

  function sync() {
    var notice = el('sc-mobile-landscape-notice');
    if (!notice) return;
    if (isSeen() || !isActualMobile() || isBlockingRequiredFlow()) {
      hideNotice();
      if (isSeen() && observer) {
        observer.disconnect();
        observer = null;
      }
      return;
    }
    notice.hidden = false;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var raf = global.requestAnimationFrame || function (fn) { return global.setTimeout(fn, 16); };
    raf(function () {
      scheduled = false;
      sync();
    });
  }

  function wire() {
    var ok = el('sc-mobile-pc-notice-ok');
    if (ok && !ok.dataset.scWired) {
      ok.dataset.scWired = '1';
      ok.addEventListener('click', function () {
        markSeen();
        hideNotice();
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      });
    }
  }

  function boot() {
    wire();
    sync();
    if (!global.MutationObserver || !global.document) return;
    observer = new global.MutationObserver(function () {
      schedule();
    });
    observer.observe(global.document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden'],
      subtree: true,
    });
    global.addEventListener('resize', schedule);
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
