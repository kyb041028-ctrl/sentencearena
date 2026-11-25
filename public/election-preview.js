/**
 * 개발용 선거·탄핵 화면.
 * devElectionPreview 주소가 있을 때만 표시한다.
 */
(function (global) {
  'use strict';

  var core = global.ElectionPreviewCore;
  var memory = core.createHideMemory();
  var openState = null;
  var escBound = false;

  function countryCode() {
    if (global.SAActivityRegion && global.SAActivityRegion.get() === 'US') return 'US';
    var path = String(global.location && global.location.pathname || '');
    if (path === '/us' || path.indexOf('/us/') === 0) return 'US';
    return 'KR';
  }

  function queryState() {
    var params = new URLSearchParams(global.location.search || '');
    return params.get('devElectionPreview');
  }

  function clockDate() {
    var params = new URLSearchParams(global.location.search || '');
    return params.get('previewDate') || '2026-11-08';
  }

  function memberId() {
    return 'preview-member';
  }

  function ensureStyle() {
    if (document.getElementById('sa-election-preview-style')) return;
    var style = document.createElement('style');
    style.id = 'sa-election-preview-style';
    style.textContent =
      '.sa-ep{position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;padding:1rem;}' +
      '.sa-ep__backdrop{position:absolute;inset:0;background:rgba(2,6,23,.72);}' +
      '.sa-ep__panel{position:relative;width:min(36rem,100%);max-height:min(40rem,100%);overflow:auto;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:1rem 1rem 1.1rem;box-shadow:0 18px 50px rgba(0,0,0,.35);}' +
      '.sa-ep__sim{margin:0 0 .35rem;font-size:.78rem;letter-spacing:.04em;color:#fbbf24;font-weight:700;}' +
      '.sa-ep__title{margin:0 0 .4rem;font-size:1.15rem;}' +
      '.sa-ep__lead,.sa-ep__rule{margin:.35rem 0;font-size:.9rem;line-height:1.5;color:#cbd5e1;}' +
      '.sa-ep__turnout{margin:.6rem 0;font-weight:700;}' +
      '.sa-ep__list{display:grid;gap:.45rem;margin:.6rem 0;}' +
      '.sa-ep__choice{display:flex;align-items:center;justify-content:space-between;gap:.5rem;min-height:44px;padding:.45rem .7rem;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit;text-align:left;}' +
      '.sa-ep__choice[data-territory="pioneer"]{border-color:rgba(56,189,248,.7);}' +
      '.sa-ep__choice[data-territory="guardian"]{border-color:rgba(248,113,113,.75);}' +
      '.sa-ep__x{position:absolute;top:.7rem;right:.7rem;min-height:44px;padding:0 .8rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#e2e8f0;}' +
      '.sa-ep__note{margin:.4rem 0 0;font-size:.82rem;color:#94a3b8;}' +
      '.sa-ep-menu{position:fixed;right:.6rem;bottom:.6rem;z-index:19000;width:min(18rem,calc(100% - 1.2rem));background:#0f172a;color:#e2e8f0;border:1px solid rgba(251,191,36,.7);border-radius:10px;padding:.6rem;}' +
      '.sa-ep-menu button{display:block;width:100%;min-height:44px;margin-top:.3rem;text-align:left;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit;padding:.35rem .6rem;}' +
      '@media (max-width:720px){.sa-ep{padding:.5rem;align-items:flex-end;}.sa-ep__panel{width:100%;max-height:92vh;border-bottom-left-radius:0;border-bottom-right-radius:0;}.sa-ep__choice,.sa-ep__x{width:auto;}}';
    document.head.appendChild(style);
  }

  function closeModal() {
    var node = document.getElementById('sa-election-preview');
    if (node) node.remove();
    openState = null;
  }

  function onEsc(event) {
    if (event.key === 'Escape') closeModal();
  }

  function bindEsc() {
    if (escBound) return;
    escBound = true;
    document.addEventListener('keydown', onEsc);
  }

  function line(parent, className, value) {
    var p = document.createElement('p');
    p.className = className;
    p.textContent = value;
    parent.appendChild(p);
    return p;
  }

  function closeButton(panel, country) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sa-ep__x';
    btn.setAttribute('data-ep-close', '1');
    btn.textContent = core.text(country, 'close');
    btn.addEventListener('click', closeModal);
    panel.appendChild(btn);
  }

  function mount(country, build) {
    ensureStyle();
    closeModal();
    var wrap = document.createElement('div');
    wrap.id = 'sa-election-preview';
    wrap.className = 'sa-ep';
    var backdrop = document.createElement('div');
    backdrop.className = 'sa-ep__backdrop';
    backdrop.addEventListener('click', closeModal);
    var panel = document.createElement('div');
    panel.className = 'sa-ep__panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    closeButton(panel, country);
    line(panel, 'sa-ep__sim', core.text(country, 'sim'));
    build(panel);
    wrap.appendChild(backdrop);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    bindEsc();
    panel.focus && panel.setAttribute('tabindex', '-1');
    panel.focus();
  }

  function renderRecord(panel, country, record) {
    panel.setAttribute('data-territory', record.territory || 'pioneer');
    var title = record.type === 'impeachment' ? core.text(country, 'impeachTitle') : core.text(country, 'electionTitle');
    line(panel, 'sa-ep__title', title);
    line(panel, 'sa-ep__lead', core.text(country, 'notLive'));
    if (record.eligibility === 'ineligible') {
      line(panel, 'sa-ep__lead', core.text(country, 'ineligible'));
      return;
    }
    if (record.votingStatus === 'ended') {
      line(panel, 'sa-ep__lead', core.text(country, 'ended'));
      if (record.finalResult === 'tie-rejected') line(panel, 'sa-ep__lead', core.text(country, 'tie'));
      return;
    }
    if (record.votingStatus === 'voted') {
      line(panel, 'sa-ep__lead', core.text(country, 'voted'));
      line(panel, 'sa-ep__turnout', core.turnoutLabel(record, country));
      return;
    }
    line(panel, 'sa-ep__turnout', core.turnoutLabel(record, country));
    if (record.type === 'leader-election' && (!record.candidates || record.candidates.length < 2)) {
      line(panel, 'sa-ep__lead', core.text(country, 'sole'));
    } else if (core.showsChoices(record)) {
      var list = document.createElement('div');
      list.className = 'sa-ep__list';
      if (record.type === 'impeachment') {
        ['yes', 'no'].forEach(function (key) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sa-ep__choice';
          btn.setAttribute('data-territory', record.territory);
          btn.textContent = core.text(country, key);
          btn.addEventListener('click', function () {
            line(panel, 'sa-ep__note', core.text(country, 'previewOnly'));
          });
          list.appendChild(btn);
        });
      } else {
        record.candidates.forEach(function (candidate) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sa-ep__choice';
          btn.setAttribute('data-territory', candidate.territory);
          btn.textContent = candidate.name + ' · ' + core.text(country, 'choose');
          btn.addEventListener('click', function () {
            line(panel, 'sa-ep__note', core.text(country, 'previewOnly'));
          });
          list.appendChild(btn);
        });
      }
      panel.appendChild(list);
    }
    line(panel, 'sa-ep__rule', record.type === 'impeachment' ? core.text(country, 'rulesImpeach') : core.text(country, 'rulesElection'));
  }

  function renderHide(panel, country) {
    var date = clockDate();
    line(panel, 'sa-ep__title', core.text(country, 'hideTitle'));
    line(panel, 'sa-ep__lead', core.text(country, 'hideBody'));
    line(panel, 'sa-ep__note', core.text(country, 'hideDate') + ' ' + date + '. ' + core.text(country, 'tz'));
    ['leader-election', 'impeachment'].forEach(function (kind) {
      var block = document.createElement('div');
      block.className = 'sa-ep__list';
      var label = kind === 'impeachment' ? core.text(country, 'impeachKind') : core.text(country, 'electionKind');
      if (!memory.isHidden(country, memberId(), kind, date)) {
        memory.dismiss(country, memberId(), kind, date);
      }
      line(block, 'sa-ep__lead', label + ' · ' + core.text(country, 'autoHidden'));
      var manual = document.createElement('button');
      manual.type = 'button';
      manual.className = 'sa-ep__choice';
      manual.textContent = core.text(country, 'manual');
      manual.addEventListener('click', function () {
        open(kind === 'impeachment' ? 'impeach-open' : 'election-open');
      });
      block.appendChild(manual);
      panel.appendChild(block);
    });
  }

  function open(state) {
    var country = countryCode();
    if (core.STATES.indexOf(state) < 0) state = 'none';
    openState = state;
    mount(country, function (panel) {
      if (state === 'none') {
        line(panel, 'sa-ep__title', core.text(country, 'none'));
        line(panel, 'sa-ep__lead', core.text(country, 'notLive'));
        return;
      }
      if (state === 'hide-today') {
        renderHide(panel, country);
        return;
      }
      var record = core.fixture(country, state);
      if (!record) {
        line(panel, 'sa-ep__title', core.text(country, 'none'));
        return;
      }
      renderRecord(panel, country, record);
    });
  }

  function showMenu() {
    ensureStyle();
    if (document.getElementById('sa-election-preview-menu')) return;
    var menu = document.createElement('aside');
    menu.id = 'sa-election-preview-menu';
    menu.className = 'sa-ep-menu';
    line(menu, 'sa-ep__sim', core.text(countryCode(), 'sim'));
    var states = core.STATES;
    states.forEach(function (state) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = state;
      btn.addEventListener('click', function () {
        open(state);
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
  }

  function boot() {
    var flag = queryState();
    if (!flag) return;
    if (flag === '1' || flag === 'menu') {
      showMenu();
      return;
    }
    open(flag);
  }

  var api = {
    STATES: core.STATES,
    open: open,
    close: closeModal,
    boot: boot,
    fixture: function (state) {
      return core.fixture(countryCode(), state);
    },
  };
  global.ElectionPreviewUI = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
