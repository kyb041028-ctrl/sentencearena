/**
 * SentenceArena sensitive-consent withdrawal UI.
 * Does not delete the account. Calls POST /api/me/legal/withdraw-sensitive-consent only.
 * Does not change auth.js or the account-withdrawal dialog.
 */
(function (global) {
  'use strict';

  var ENDPOINT = '/api/me/legal/withdraw-sensitive-consent';
  var STATUS_ENDPOINT = '/api/me/legal/status';
  var SCORE_KEY = 'sc_political_scores_v1';
  var HISTORY_KEY = 'sc_tendency_history_v2';
  var SUCCESS_TEXT =
    '민감정보 동의를 철회했습니다. 계정은 유지됩니다. 정치성향 상태와 변화 기록은 삭제되었고, 화면의 성향·영토 표시는 철회 전 상태를 더 이상 보여 주지 않습니다.';

  var finished = false;
  var pending = false;

  function currentUserId() {
    return String(global.__scAuthUserId || '').trim();
  }

  function isMemberId(id) {
    var s = String(id || '').trim();
    return !!(s && s !== 'guest' && s !== 'guest_demo');
  }

  function byId(id) {
    return global.document && global.document.getElementById(id);
  }

  function dialogEl() {
    return byId('sc-sensitive-withdraw-dialog');
  }

  function setError(msg) {
    var el = byId('sc-sensitive-withdraw-error');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function setStatus(msg) {
    var el = byId('sc-sensitive-withdraw-status');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function syncSubmitEnabled() {
    var ack = byId('sc-sensitive-withdraw-ack');
    var btn = byId('sc-sensitive-withdraw-submit');
    if (!btn) return;
    if (finished || pending) {
      btn.disabled = true;
      return;
    }
    btn.disabled = !(ack && ack.checked);
  }

  function fetchFn(url, opts) {
    var fn =
      global.ScAuth && typeof global.ScAuth.authFetch === 'function'
        ? global.ScAuth.authFetch.bind(global.ScAuth)
        : function (nextUrl, nextOpts) {
            return global.fetch(nextUrl, nextOpts);
          };
    return fn(url, opts);
  }

  function readJson(response) {
    return response.json().then(
      function (body) {
        return { status: response.status, j: body };
      },
      function () {
        return { status: response.status, j: null };
      },
    );
  }

  function consentWord(on) {
    return on ? '동의함' : '동의하지 않음';
  }

  function paintConsentStatus(text) {
    var el = byId('sc-sensitive-consent-status');
    if (!el) return;
    el.textContent = text || '';
  }

  function setWithdrawEnabled(on) {
    var btn = byId('sc-sensitive-consent-withdraw');
    if (!btn) return;
    btn.disabled = !on;
  }

  function paintLegal(legal) {
    paintConsentStatus(
      '정치 관련 정보 처리: ' +
        consentWord(!!(legal && legal.sensitiveConsented)) +
        '\n소속 영토 공개: ' +
        consentWord(!!(legal && legal.territoryDisclosureConsented)),
    );
    var canWithdraw = !!(
      legal &&
      (legal.sensitiveConsented === true || legal.territoryDisclosureConsented === true)
    );
    setWithdrawEnabled(canWithdraw);
  }

  function loadConsentStatus() {
    paintConsentStatus('동의 상태를 확인하는 중...');
    setWithdrawEnabled(false);
    if (!isMemberId(currentUserId())) {
      paintConsentStatus('로그인한 회원만 동의 상태를 확인할 수 있습니다.');
      return Promise.resolve();
    }
    return fetchFn(STATUS_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
      .then(readJson)
      .then(function (pack) {
        if (!pack.j || pack.j.ok !== true || !pack.j.legal) {
          paintConsentStatus('동의 상태를 불러오지 못했습니다.');
          setWithdrawEnabled(false);
          return;
        }
        paintLegal(pack.j.legal);
      })
      .catch(function () {
        paintConsentStatus('동의 상태를 불러오지 못했습니다.');
        setWithdrawEnabled(false);
      });
  }

  function openSettings() {
    var panel = byId('sc-settings-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    loadConsentStatus();
  }

  function closeSettings() {
    var panel = byId('sc-settings-panel');
    if (!panel) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  }

  function dropUserKey(storageKey, userId) {
    if (!global.localStorage) return;
    try {
      var raw = global.localStorage.getItem(storageKey);
      if (!raw) return;
      var map = JSON.parse(raw);
      if (!map || typeof map !== 'object') return;
      if (!Object.prototype.hasOwnProperty.call(map, userId)) return;
      delete map[userId];
      global.localStorage.setItem(storageKey, JSON.stringify(map));
    } catch (_) {}
  }

  function clearWithdrawnAlignmentUi(userId) {
    var uid = String(userId || '').trim();
    if (!isMemberId(uid)) return;
    dropUserKey(SCORE_KEY, uid);
    dropUserKey(HISTORY_KEY, uid);
    var prev = global.__scPlayer || {};
    var rank = prev.rank || '참여자';
    if (typeof global.__scDockSetMeta === 'function') {
      global.__scDockSetMeta(uid, '정치 성향 없음 (미분류)', 'COMMON · 중앙광장', rank, null);
    } else {
      global.__scPlayer = {
        userId: uid,
        territoryId: 'COMMON',
        affiliationDisplay: '중앙광장',
        tendency: '정치 성향 없음 (미분류)',
        rank: rank,
        tendencyPct: { none: true },
      };
    }
    if (typeof global.setProfileTerritorySkin === 'function') {
      global.setProfileTerritorySkin('center');
    }
    if (global.document && typeof global.document.querySelectorAll === 'function') {
      var maps = global.document.querySelectorAll('.profile-frame__alignment-map');
      for (var i = 0; i < maps.length; i++) {
        maps[i].hidden = true;
      }
    }
    if (
      global.ScProfileModal &&
      typeof global.ScProfileModal.getUserId === 'function' &&
      global.ScProfileModal.getUserId() === uid &&
      typeof global.renderProfileFrameInModal === 'function'
    ) {
      global.renderProfileFrameInModal(uid);
    }
  }

  function open() {
    if (!isMemberId(currentUserId())) return;
    var dlg = dialogEl();
    if (!dlg) return;
    finished = false;
    pending = false;
    var ack = byId('sc-sensitive-withdraw-ack');
    var ackLabel = byId('sc-sensitive-withdraw-ack-label');
    if (ack) ack.checked = false;
    if (ackLabel) ackLabel.hidden = false;
    setError('');
    setStatus('');
    var cancelBtn = byId('sc-sensitive-withdraw-cancel');
    if (cancelBtn) cancelBtn.textContent = '취소';
    syncSubmitEnabled();
    dlg.hidden = false;
    dlg.setAttribute('aria-hidden', 'false');
    if (cancelBtn && typeof cancelBtn.focus === 'function') cancelBtn.focus();
  }

  function close() {
    var dlg = dialogEl();
    if (!dlg) return;
    dlg.hidden = true;
    dlg.setAttribute('aria-hidden', 'true');
    setError('');
  }

  function markSuccess() {
    finished = true;
    pending = false;
    var ackLabel = byId('sc-sensitive-withdraw-ack-label');
    if (ackLabel) ackLabel.hidden = true;
    setError('');
    setStatus(SUCCESS_TEXT);
    var cancelBtn = byId('sc-sensitive-withdraw-cancel');
    if (cancelBtn) cancelBtn.textContent = '닫기';
    syncSubmitEnabled();
  }

  function markFailure(message) {
    pending = false;
    setStatus('');
    setError(message);
    syncSubmitEnabled();
  }

  function submit() {
    var ack = byId('sc-sensitive-withdraw-ack');
    if (finished || pending) return;
    if (!ack || !ack.checked) return;
    if (!isMemberId(currentUserId())) {
      markFailure('로그인한 회원만 민감정보 동의를 철회할 수 있습니다.');
      return;
    }
    pending = true;
    syncSubmitEnabled();
    setError('');
    setStatus('');
    var uid = currentUserId();
    return fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    })
      .then(readJson)
      .then(function (pack) {
        var legal = pack.j && pack.j.legal;
        var cleared =
          pack.j &&
          pack.j.ok === true &&
          legal &&
          legal.sensitiveConsented === false &&
          legal.territoryDisclosureConsented === false;
        if (!cleared) {
          var code = (pack.j && pack.j.error) || 'WITHDRAW_SENSITIVE_CONSENT_FAILED';
          markFailure('민감정보 동의를 철회하지 못했습니다. (' + code + ')');
          return;
        }
        clearWithdrawnAlignmentUi(uid);
        paintLegal(legal);
        markSuccess();
      })
      .catch(function () {
        markFailure('민감정보 동의를 철회하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      });
  }

  function bind() {
    var dlg = dialogEl();
    if (!dlg || dlg.dataset.scSensitiveWithdrawBound) return;
    dlg.dataset.scSensitiveWithdrawBound = '1';
    var ack = byId('sc-sensitive-withdraw-ack');
    var submitBtn = byId('sc-sensitive-withdraw-submit');
    var cancelBtn = byId('sc-sensitive-withdraw-cancel');
    var backdrop = dlg.querySelector('[data-sc-sensitive-withdraw-close]');
    var opener = byId('sc-sensitive-consent-withdraw');
    var settingsBtn = byId('sc-map-tab-settings');
    var settingsClose = byId('sc-settings-close');
    var settingsBackdrop = byId('sc-settings-backdrop');
    if (ack) ack.addEventListener('change', syncSubmitEnabled);
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        submit();
      });
    }
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        openSettings();
      });
    }
    if (settingsClose) settingsClose.addEventListener('click', closeSettings);
    if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);
    if (opener) {
      opener.addEventListener('click', function () {
        if (!isMemberId(currentUserId())) {
          paintConsentStatus('로그인한 회원만 민감정보 동의를 철회할 수 있습니다.');
          return;
        }
        open();
      });
    }
    if (global.document && typeof global.document.addEventListener === 'function') {
      global.document.addEventListener('keydown', function (ev) {
        if (!ev || ev.key !== 'Escape') return;
        if (!dlg || dlg.hidden) return;
        close();
      });
    }
    syncSubmitEnabled();
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bind);
  } else if (global.document) {
    bind();
  }

  global.SensitiveConsentWithdrawUI = {
    ENDPOINT: ENDPOINT,
    STATUS_ENDPOINT: STATUS_ENDPOINT,
    SUCCESS_TEXT: SUCCESS_TEXT,
    open: open,
    close: close,
    openSettings: openSettings,
    closeSettings: closeSettings,
    submit: submit,
    bind: bind,
    clearWithdrawnAlignmentUi: clearWithdrawnAlignmentUi,
  };
})(typeof window !== 'undefined' ? window : this);
