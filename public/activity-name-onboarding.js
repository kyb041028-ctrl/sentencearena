/**
 * SentenceArena — 활동명 온보딩 UI (인증 후 · 영토 선택 전)
 * OAuth/cookie auth를 제어하지 않는다. profile completion UI만 담당.
 */
(function (global) {
  'use strict';

  var ROOT_ID = 'sc-activity-name-onboarding';
  var Core = global.ActivityNameCore;

  function el(id) {
    return global.document.getElementById(id);
  }

  function ensureDom() {
    var existing = el(ROOT_ID);
    if (existing) return existing;

    var wrap = global.document.createElement('div');
    wrap.id = ROOT_ID;
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'sc-activity-name-title');
    wrap.innerHTML =
      '<div class="sc-activity-name-onboarding__panel sc-card">' +
      '<h2 id="sc-activity-name-title" class="sc-section-title">SentenceArena 활동명 설정</h2>' +
      '<p class="sc-activity-name-onboarding__lead">SentenceArena에서 사용할 활동명을 정해주세요.</p>' +
      '<div class="sc-activity-name-onboarding__row">' +
      '<input id="sc-activity-name-input" class="sc-input" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="예: 푸른개척자" />' +
      '<button type="button" id="sc-activity-name-dice" class="sc-btn sc-btn--secondary sc-btn--icon" aria-label="활동명 자동 생성">🎲</button>' +
      '</div>' +
      '<p id="sc-activity-name-status" class="sc-activity-name-onboarding__status" aria-live="polite"></p>' +
      '<button type="button" id="sc-activity-name-submit" class="sc-btn sc-btn--primary sc-btn--lg">이 활동명으로 시작하기</button>' +
      '</div>';
    global.document.body.appendChild(wrap);
    return wrap;
  }

  function setStatus(text, kind) {
    var s = el('sc-activity-name-status');
    if (!s) return;
    s.textContent = text || '';
    s.dataset.kind = kind || '';
  }

  function hideLoginOnly() {
    var loginV = el('view-login');
    if (loginV) loginV.hidden = true;
  }

  function show(onComplete) {
    if (!Core) {
      console.error('[activity-name] ActivityNameCore missing');
      if (typeof onComplete === 'function') onComplete(null);
      return;
    }
    var root = ensureDom();
    root.hidden = false;
    hideLoginOnly();
    var input = el('sc-activity-name-input');
    var dice = el('sc-activity-name-dice');
    var submit = el('sc-activity-name-submit');
    var avoid = [];
    var debounceTimer = null;
    var lastAvailability = { value: '', available: false };

    function checkAvailability(value) {
      var v = Core.validateActivityName(value);
      if (!v.ok) {
        lastAvailability = { value: value, available: false };
        setStatus(v.message, 'error');
        return Promise.resolve(false);
      }
      var fetchFn =
        global.ScAuth && typeof global.ScAuth.authFetch === 'function'
          ? global.ScAuth.authFetch.bind(global.ScAuth)
          : function (url, opts) {
              return global.fetch(url, opts);
            };
      return fetchFn(
        '/api/profile/display-name/availability?value=' + encodeURIComponent(v.value),
        {},
      )
        .then(function (r) {
          return r.json().then(function (j) {
            return { status: r.status, j: j };
          });
        })
        .then(function (pack) {
          var j = pack.j || {};
          if (pack.status === 401) {
            setStatus('로그인이 필요합니다.', 'error');
            lastAvailability = { value: v.value, available: false };
            return false;
          }
          if (j.available) {
            lastAvailability = { value: v.value, available: true };
            setStatus(j.message || '사용 가능한 활동명입니다.', 'ok');
            return true;
          }
          lastAvailability = { value: v.value, available: false };
          setStatus(j.message || Core.MESSAGES[Core.ERRORS.DUPLICATE], 'error');
          return false;
        })
        .catch(function () {
          lastAvailability = { value: v.value, available: false };
          setStatus('활동명 확인에 실패했습니다. 다시 시도해 주세요.', 'error');
          return false;
        });
    }

    function scheduleCheck() {
      if (debounceTimer) global.clearTimeout(debounceTimer);
      debounceTimer = global.setTimeout(function () {
        checkAvailability(input.value);
      }, 280);
    }

    function rollDice() {
      if (!Core) return;
      var tries = 0;
      function attempt() {
        tries += 1;
        var candidate = Core.generateActivityNameCandidate({ avoid: avoid, maxAttempts: 8 });
        input.value = candidate;
        return checkAvailability(candidate).then(function (ok) {
          if (ok) {
            avoid.push(candidate);
            return candidate;
          }
          avoid.push(candidate);
          if (tries >= 8) {
            var withNum = Core.withNumericSuffix(candidate.replace(/[0-9]+$/, ''), 10 + Math.floor(Math.random() * 89));
            if (withNum) {
              input.value = withNum;
              return checkAvailability(withNum);
            }
            setStatus('다른 활동명을 입력하거나 주사위를 다시 눌러 주세요.', 'error');
            return false;
          }
          return attempt();
        });
      }
      return attempt();
    }

    function submitName() {
      var v = Core.validateActivityName(input.value);
      if (!v.ok) {
        setStatus(v.message, 'error');
        return;
      }
      submit.disabled = true;
      setStatus('저장 중…', '');
      var fetchFn =
        global.ScAuth && typeof global.ScAuth.authFetch === 'function'
          ? global.ScAuth.authFetch.bind(global.ScAuth)
          : function (url, opts) {
              return global.fetch(url, opts);
            };
      fetchFn('/api/profile/me/display-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: v.value, userId: 'attacker-ignored' }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { status: r.status, j: j };
          });
        })
        .then(function (pack) {
          submit.disabled = false;
          var j = pack.j || {};
          if (pack.status >= 200 && pack.status < 300 && j.ok && j.profile) {
            root.hidden = true;
            if (typeof global.rememberDisplayName === 'function' && j.userId) {
              global.rememberDisplayName(j.userId, j.displayName || v.value);
            }
            if (typeof onComplete === 'function') onComplete(j.profile);
            return;
          }
          setStatus(j.message || Core.messageForError(j.error) || '저장에 실패했습니다.', 'error');
        })
        .catch(function () {
          submit.disabled = false;
          setStatus('저장에 실패했습니다. 다시 시도해 주세요.', 'error');
        });
    }

    if (!root.dataset.wired) {
      root.dataset.wired = '1';
      input.addEventListener('input', scheduleCheck);
      input.addEventListener('blur', function () {
        checkAvailability(input.value);
      });
      dice.addEventListener('click', function () {
        rollDice();
      });
      submit.addEventListener('click', submitName);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitName();
        }
      });
    }

    input.value = '';
    setStatus('', '');
    input.focus();
  }

  function hide() {
    var root = el(ROOT_ID);
    if (root) root.hidden = true;
  }

  global.ScActivityNameOnboarding = {
    show: show,
    hide: hide,
    ensureDom: ensureDom,
  };
})(typeof window !== 'undefined' ? window : this);
