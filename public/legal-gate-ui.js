/**
 * Legal signup gate UI. Does not change auth.js.
 * Pre-OAuth: provider click → age → sensitive consent → ScAuth.login(provider).
 * Post-login: remaining steps before app READY.
 */
(function (global) {
  'use strict';

  var Core = global.LegalGateCore;
  var ROOT_ID = 'sc-legal-gate';
  var TMP_DOB_KEY = 'sc_legal_dob_tmp';
  var TMP_CONSENT_KEY = 'sc_legal_consent_tmp';
  var PENDING_PROVIDER_KEY = 'sc_legal_pending_provider';

  function el(id) {
    return global.document && global.document.getElementById(id);
  }

  function fetchFn() {
    if (global.ScAuth && typeof global.ScAuth.authFetch === 'function') {
      return global.ScAuth.authFetch.bind(global.ScAuth);
    }
    return function (url, opts) {
      return global.fetch(url, opts);
    };
  }

  function saveTmpDob(dob) {
    try {
      global.sessionStorage.setItem(TMP_DOB_KEY, JSON.stringify(dob));
    } catch (_) {}
  }

  function readTmpDob() {
    try {
      var raw = global.sessionStorage.getItem(TMP_DOB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearTmpDob() {
    try {
      global.sessionStorage.removeItem(TMP_DOB_KEY);
    } catch (_) {}
  }

  function saveTmpConsent(payload) {
    try {
      global.sessionStorage.setItem(TMP_CONSENT_KEY, JSON.stringify(payload || {}));
    } catch (_) {}
  }

  function readTmpConsent() {
    try {
      var raw = global.sessionStorage.getItem(TMP_CONSENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearTmpConsent() {
    try {
      global.sessionStorage.removeItem(TMP_CONSENT_KEY);
    } catch (_) {}
  }

  function readPendingProvider() {
    try {
      return global.sessionStorage.getItem(PENDING_PROVIDER_KEY);
    } catch (_) {
      return null;
    }
  }

  function setPendingProvider(provider) {
    try {
      global.sessionStorage.setItem(PENDING_PROVIDER_KEY, String(provider || ''));
    } catch (_) {}
  }

  function clearPendingProvider() {
    try {
      global.sessionStorage.removeItem(PENDING_PROVIDER_KEY);
    } catch (_) {}
  }

  function clearAbandonedPreOAuthState() {
    clearPendingProvider();
    clearTmpDob();
    clearTmpConsent();
  }

  function yearOptions() {
    var today = Core.seoulToday();
    var html = '';
    for (var y = today.year; y >= 1901; y--) {
      html += '<option value="' + y + '">' + y + '</option>';
    }
    return html;
  }

  function ensureDom() {
    var existing = el(ROOT_ID);
    if (existing) return existing;
    var wrap = global.document.createElement('div');
    wrap.id = ROOT_ID;
    wrap.className = 'sc-legal-gate';
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML =
      '<div class="sc-legal-gate__backdrop"></div>' +
      '<section class="sc-card sc-legal-gate__panel">' +
      '<div id="sc-legal-step-age">' +
      '<h2 class="sc-section-title">연령 확인</h2>' +
      '<p class="sc-legal-gate__lead">' +
      (Core ? Core.AGE_NOTICE : '') +
      '</p>' +
      '<div class="sc-legal-gate__dob">' +
      '<label>년<select id="sc-legal-year" class="sc-input"></select></label>' +
      '<label>월<select id="sc-legal-month" class="sc-input"></select></label>' +
      '<label>일<select id="sc-legal-day" class="sc-input"></select></label>' +
      '</div>' +
      '<p id="sc-legal-age-error" class="sc-legal-gate__error" hidden></p>' +
      '<div class="sc-legal-gate__actions">' +
      '<button type="button" id="sc-legal-age-cancel" class="sc-btn">취소</button>' +
      '<button type="button" id="sc-legal-age-next" class="sc-btn sc-btn--primary">다음</button>' +
      '</div>' +
      '</div>' +
      '<div id="sc-legal-step-consent" hidden>' +
      '<h2 class="sc-section-title" id="sc-legal-consent-title"></h2>' +
      '<h3 class="sc-legal-gate__h">처리하는 민감정보</h3>' +
      '<ul id="sc-legal-items"></ul>' +
      '<h3 class="sc-legal-gate__h">이용 목적</h3>' +
      '<ul id="sc-legal-purposes"></ul>' +
      '<h3 class="sc-legal-gate__h">보유 기간</h3>' +
      '<p id="sc-legal-retention"></p>' +
      '<h3 class="sc-legal-gate__h">동의 거부</h3>' +
      '<p id="sc-legal-refusal" class="sc-legal-gate__refusal"></p>' +
      '<label class="sc-legal-gate__ack">' +
      '<input type="checkbox" id="sc-legal-consent-ack" />' +
      '<span id="sc-legal-check-label"></span>' +
      '</label>' +
      '<h3 class="sc-legal-gate__h">내 정치성향 공개</h3>' +
      '<label class="sc-legal-gate__radio"><input type="radio" name="sc-legal-vis" value="private" checked /> 비공개</label>' +
      '<label class="sc-legal-gate__radio"><input type="radio" name="sc-legal-vis" value="public" /> 공개</label>' +
      '<p id="sc-legal-consent-error" class="sc-legal-gate__error" hidden></p>' +
      '<div class="sc-legal-gate__actions">' +
      '<button type="button" id="sc-legal-consent-cancel" class="sc-btn">취소</button>' +
      '<button type="button" id="sc-legal-consent-submit" class="sc-btn sc-btn--primary" disabled>동의하고 계속</button>' +
      '</div>' +
      '</div>' +
      '</section>';
    global.document.body.appendChild(wrap);
    fillStatic();
    bind(wrap);
    return wrap;
  }

  function fillStatic() {
    if (!Core) return;
    var title = el('sc-legal-consent-title');
    if (title) title.textContent = Core.SENSITIVE_TITLE;
    var items = el('sc-legal-items');
    if (items && !items.dataset.filled) {
      items.dataset.filled = '1';
      Core.SENSITIVE_ITEMS.forEach(function (t) {
        var li = global.document.createElement('li');
        li.textContent = t;
        items.appendChild(li);
      });
    }
    var purposes = el('sc-legal-purposes');
    if (purposes && !purposes.dataset.filled) {
      purposes.dataset.filled = '1';
      Core.SENSITIVE_PURPOSES.forEach(function (t) {
        var li = global.document.createElement('li');
        li.textContent = t;
        purposes.appendChild(li);
      });
    }
    var ret = el('sc-legal-retention');
    if (ret) ret.textContent = Core.SENSITIVE_RETENTION;
    var refusal = el('sc-legal-refusal');
    if (refusal) refusal.textContent = Core.SENSITIVE_REFUSAL;
    var chk = el('sc-legal-check-label');
    if (chk) chk.textContent = Core.SENSITIVE_CHECK_LABEL;
    var year = el('sc-legal-year');
    if (year && !year.dataset.filled) {
      year.dataset.filled = '1';
      year.innerHTML = '<option value="">년</option>' + yearOptions();
    }
    var month = el('sc-legal-month');
    if (month && !month.dataset.filled) {
      month.dataset.filled = '1';
      var mh = '<option value="">월</option>';
      for (var m = 1; m <= 12; m++) mh += '<option value="' + m + '">' + m + '</option>';
      month.innerHTML = mh;
    }
    var day = el('sc-legal-day');
    if (day && !day.dataset.filled) {
      day.dataset.filled = '1';
      var dh = '<option value="">일</option>';
      for (var d = 1; d <= 31; d++) dh += '<option value="' + d + '">' + d + '</option>';
      day.innerHTML = dh;
    }
  }

  function setError(id, text) {
    var node = el(id);
    if (!node) return;
    if (!text) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.textContent = text;
  }

  function ageErrorText(code) {
    if (code === 'AGE_UNDER_14') return '만 14세 미만은 가입할 수 없습니다.';
    if (code === 'AGE_FUTURE') return '미래 날짜는 입력할 수 없습니다.';
    return '올바른 생년월일을 입력해 주세요.';
  }

  function currentDob() {
    return {
      year: Number(el('sc-legal-year') && el('sc-legal-year').value),
      month: Number(el('sc-legal-month') && el('sc-legal-month').value),
      day: Number(el('sc-legal-day') && el('sc-legal-day').value),
    };
  }

  function showStep(age, consent) {
    var a = el('sc-legal-step-age');
    var c = el('sc-legal-step-consent');
    if (a) a.hidden = !age;
    if (c) c.hidden = !consent;
  }

  function hide() {
    var root = el(ROOT_ID);
    if (root) root.hidden = true;
  }

  function show() {
    var root = ensureDom();
    root.hidden = false;
  }

  var postLoginState = null;

  function bind() {
    var ack = el('sc-legal-consent-ack');
    var submit = el('sc-legal-consent-submit');
    if (ack && !ack.dataset.wired) {
      ack.dataset.wired = '1';
      ack.checked = false;
      ack.addEventListener('change', function () {
        if (submit) submit.disabled = !ack.checked;
      });
    }
    var ageNext = el('sc-legal-age-next');
    if (ageNext && !ageNext.dataset.wired) {
      ageNext.dataset.wired = '1';
      ageNext.addEventListener('click', onAgeNext);
    }
    if (submit && !submit.dataset.wired) {
      submit.dataset.wired = '1';
      submit.addEventListener('click', onConsentSubmit);
    }
    var ageCancel = el('sc-legal-age-cancel');
    if (ageCancel && !ageCancel.dataset.wired) {
      ageCancel.dataset.wired = '1';
      ageCancel.addEventListener('click', cancelToLogin);
    }
    var consentCancel = el('sc-legal-consent-cancel');
    if (consentCancel && !consentCancel.dataset.wired) {
      consentCancel.dataset.wired = '1';
      consentCancel.addEventListener('click', cancelToLogin);
    }
  }

  function resetConsentControls() {
    var ack = el('sc-legal-consent-ack');
    var submit = el('sc-legal-consent-submit');
    if (ack) ack.checked = false;
    if (submit) submit.disabled = true;
    setError('sc-legal-consent-error', '');
  }

  function beginSelectedOAuth(provider) {
    var name = String(provider || '').trim();
    clearPendingProvider();
    hide();
    if (!name || !global.ScAuth || typeof global.ScAuth.login !== 'function') {
      var status = el('auth-status-login');
      if (status) status.textContent = '로그인을 시작하지 못했습니다.';
      return;
    }
    global.ScAuth.login(name).catch(function () {
      var node = el('auth-status-login');
      if (node) node.textContent = '로그인을 시작하지 못했습니다.';
    });
  }

  function cancelToLogin() {
    clearAbandonedPreOAuthState();
    postLoginState = null;
    hide();
    if (global.__scApp && typeof global.__scApp.showLoginOnly === 'function') {
      global.__scApp.showLoginOnly();
    } else {
      var login = el('view-login');
      if (login) login.hidden = false;
    }
  }

  function onAgeNext() {
    if (!Core) return;
    var dob = currentDob();
    var evaluated = Core.evaluateAge(dob);
    if (!evaluated.ok) {
      setError('sc-legal-age-error', ageErrorText(evaluated.error));
      return;
    }
    setError('sc-legal-age-error', '');
    saveTmpDob({ year: dob.year, month: dob.month, day: dob.day });
    resetConsentControls();
    if (readPendingProvider()) {
      showStep(false, true);
      return;
    }
    if (postLoginState) {
      postAgeToServer(dob).then(function (ok) {
        if (!ok) return;
        showStep(false, true);
      });
    }
  }

  function postAgeToServer(dob) {
    return fetchFn()('/api/me/legal/age-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: dob.year,
        month: dob.month,
        day: dob.day,
        policyVersion: Core.AGE_POLICY_VERSION,
      }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, j: j };
        });
      })
      .then(function (pack) {
        if (!pack.j || pack.j.ok !== true) {
          setError('sc-legal-age-error', ageErrorText(pack.j && pack.j.error));
          return false;
        }
        clearTmpDob();
        if (postLoginState) postLoginState.legal = pack.j.legal;
        return true;
      })
      .catch(function () {
        setError('sc-legal-age-error', '연령 확인을 저장하지 못했습니다.');
        return false;
      });
  }

  function selectedVisibility() {
    var nodes = global.document.querySelectorAll('input[name="sc-legal-vis"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].checked) return nodes[i].value;
    }
    return 'private';
  }

  function postConsentToServer(visibility) {
    var btn = el('sc-legal-consent-submit');
    return fetchFn()('/api/me/legal/sensitive-consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consented: true,
        policyVersion: Core.SENSITIVE_POLICY_VERSION,
        politicalProfileVisibility: visibility || 'private',
      }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, j: j };
        });
      })
      .then(function (pack) {
        if (!pack.j || pack.j.ok !== true) {
          setError('sc-legal-consent-error', '동의를 저장하지 못했습니다.');
          if (btn) btn.disabled = false;
          return false;
        }
        clearTmpConsent();
        if (postLoginState) postLoginState.legal = pack.j.legal;
        return true;
      })
      .catch(function () {
        setError('sc-legal-consent-error', '동의를 저장하지 못했습니다.');
        if (btn) btn.disabled = false;
        return false;
      });
  }

  function finishPostLogin() {
    var legal = (postLoginState && postLoginState.legal) || {};
    hide();
    clearTmpDob();
    clearTmpConsent();
    var cb = postLoginState && postLoginState.onComplete;
    postLoginState = null;
    if (typeof cb === 'function') cb(legal);
  }

  function continuePostLogin() {
    var legal = (postLoginState && postLoginState.legal) || {};
    if (!legal.ageConfirmed) {
      var tmp = readTmpDob();
      if (tmp && Core.evaluateAge(tmp).ok) {
        return postAgeToServer(tmp).then(function (ok) {
          if (!ok) {
            show();
            showStep(true, false);
            return;
          }
          return continuePostLogin();
        });
      }
      show();
      showStep(true, false);
      return;
    }
    if (!legal.sensitiveConsented) {
      var tmpC = readTmpConsent();
      if (tmpC && tmpC.consented) {
        return postConsentToServer(tmpC.politicalProfileVisibility).then(function (ok) {
          if (!ok) {
            show();
            showStep(false, true);
            resetConsentControls();
            return;
          }
          return continuePostLogin();
        });
      }
      show();
      showStep(false, true);
      resetConsentControls();
      return;
    }
    finishPostLogin();
  }

  function onConsentSubmit() {
    var ack = el('sc-legal-consent-ack');
    var btn = el('sc-legal-consent-submit');
    if (!ack || !ack.checked) return;
    var pending = readPendingProvider();
    if (pending) {
      saveTmpConsent({
        consented: true,
        politicalProfileVisibility: selectedVisibility(),
      });
      beginSelectedOAuth(pending);
      return;
    }
    if (btn) btn.disabled = true;
    postConsentToServer(selectedVisibility()).then(function (ok) {
      if (!ok) return;
      finishPostLogin();
    });
  }

  function startOAuth(provider) {
    if (!Core) return;
    var name = String(provider || '').trim().toLowerCase();
    if (name !== 'google' && name !== 'kakao' && name !== 'naver') return;
    setPendingProvider(name);
    postLoginState = null;
    show();
    showStep(true, false);
    setError('sc-legal-age-error', '');
    resetConsentControls();
  }

  function showPostLogin(opts) {
    var o = opts || {};
    postLoginState = { legal: o.legal || {}, onComplete: o.onComplete };
    continuePostLogin();
  }

  global.ScLegalGateUI = {
    startOAuth: startOAuth,
    showPostLogin: showPostLogin,
    hide: hide,
    clearAbandonedPreOAuthState: clearAbandonedPreOAuthState,
    cancelToLogin: cancelToLogin,
  };
})(typeof window !== 'undefined' ? window : this);
