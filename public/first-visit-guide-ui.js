/**
 * SentenceArena — 신규 회원 3단계 첫 방문 안내 UI
 * auth.js / 성향 계산 / 자동 영토 이동을 건드리지 않는다.
 */
(function (global) {
  'use strict';

  var ROOT_ID = 'sc-first-visit-guide';
  var HINT_ID = 'sc-central-first-hint';
  var Core = global.FirstVisitGuideCore;
  var currentStep = 0;
  var completeCb = null;
  var hintPersistStarted = false;

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

  function ensureHintDom() {
    var existing = el(HINT_ID);
    if (existing) return existing;
    var wrap = global.document.createElement('div');
    wrap.id = HINT_ID;
    wrap.className = 'board__inline-notice sc-central-first-hint';
    wrap.hidden = true;
    wrap.setAttribute('role', 'status');
    wrap.innerHTML =
      '<p id="sc-central-first-hint-text" class="sc-central-first-hint__text"></p>' +
      '<button type="button" id="sc-central-first-hint-ok" class="sc-btn sc-btn--secondary">확인</button>';
    var list = el('board-list');
    if (list && list.parentNode) {
      list.parentNode.insertBefore(wrap, list);
    } else {
      var board = el('screen-board');
      if (board) board.appendChild(wrap);
      else if (global.document.body) global.document.body.appendChild(wrap);
    }
    return wrap;
  }

  function ensureDom() {
    var existing = el(ROOT_ID);
    if (existing) return existing;
    var wrap = global.document.createElement('div');
    wrap.id = ROOT_ID;
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'sc-first-visit-title');
    wrap.innerHTML =
      '<div class="sc-first-visit-guide__panel sc-card">' +
      '<p id="sc-first-visit-progress" class="sc-first-visit-guide__progress" aria-live="polite"></p>' +
      '<h2 id="sc-first-visit-title" class="sc-section-title"></h2>' +
      '<div id="sc-first-visit-body" class="sc-first-visit-guide__body"></div>' +
      '<button type="button" id="sc-first-visit-next" class="sc-btn sc-btn--primary sc-btn--lg"></button>' +
      '</div>';
    global.document.body.appendChild(wrap);
    return wrap;
  }

  function renderStep() {
    if (!Core) return;
    var steps = Core.STEPS;
    var step = steps[currentStep] || steps[0];
    var title = el('sc-first-visit-title');
    var body = el('sc-first-visit-body');
    var next = el('sc-first-visit-next');
    var prog = el('sc-first-visit-progress');
    if (title) title.textContent = step.title;
    if (body) {
      body.textContent = '';
      for (var i = 0; i < step.body.length; i++) {
        var p = global.document.createElement('p');
        p.textContent = step.body[i];
        body.appendChild(p);
      }
    }
    if (next) {
      next.textContent = step.nextLabel;
      next.classList.toggle('sc-first-visit-guide__start', currentStep === steps.length - 1);
    }
    if (prog) prog.textContent = currentStep + 1 + ' / ' + steps.length;
  }

  function hide() {
    var root = el(ROOT_ID);
    if (root) root.hidden = true;
  }

  function persistComplete() {
    return fetchFn()('/api/me/first-visit/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        });
      })
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function persistHint() {
    if (hintPersistStarted) return;
    hintPersistStarted = true;
    fetchFn()('/api/me/first-visit/central-hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(function () {});
  }

  function hideHint() {
    var hint = el(HINT_ID);
    if (hint) hint.hidden = true;
  }

  function showCentralHint() {
    if (!Core) return;
    var hint = ensureHintDom();
    var text = el('sc-central-first-hint-text');
    if (text) text.textContent = Core.CENTRAL_HINT;
    hint.hidden = false;
    persistHint();
    var ok = el('sc-central-first-hint-ok');
    if (ok && !ok.dataset.wired) {
      ok.dataset.wired = '1';
      ok.addEventListener('click', function () {
        hideHint();
      });
    }
  }

  function wireNext() {
    var next = el('sc-first-visit-next');
    if (!next || next.dataset.wired) return;
    next.dataset.wired = '1';
    next.addEventListener('click', function () {
      if (!Core) return;
      if (currentStep < Core.STEPS.length - 1) {
        currentStep += 1;
        renderStep();
        return;
      }
      next.disabled = true;
      persistComplete().then(function () {
        next.disabled = false;
        hide();
        if (typeof completeCb === 'function') completeCb();
      });
    });
  }

  function show(onComplete) {
    if (!Core) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }
    completeCb = onComplete;
    currentStep = 0;
    hintPersistStarted = false;
    var root = ensureDom();
    root.hidden = false;
    wireNext();
    renderStep();
  }

  function onBoardOpened(tid) {
    if (!Core) return;
    if (String(tid || '') !== Core.CENTRAL_TERRITORY_ID) return;
    if (global.__scFirstVisitJustFinished === true) {
      global.__scFirstVisitJustFinished = false;
      showCentralHint();
    }
  }

  global.ScFirstVisitGuideUI = {
    show: show,
    hide: hide,
    showCentralHint: showCentralHint,
    hideHint: hideHint,
    onBoardOpened: onBoardOpened,
    persistComplete: persistComplete,
  };
})(typeof window !== 'undefined' ? window : this);
