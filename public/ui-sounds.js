/**
 * UI 효과음. OGG가 기본이고, 재생이 거절되면 WAV를 한 번만 시도한다.
 * 첫 사용자 조작 이후에만 재생한다. 자동재생 제한을 풀지 않는다.
 */
(function (g) {
  'use strict';

  var KEY = 'sa_ui_sfx_v1';
  var GAP_MS = 80;
  var FILES = {
    click: '01_ui_click',
    board: '02_board_navigate',
    territory: '03_territory_select',
    profile: '04_profile_open',
    tab: '05_tab_switch',
    reaction: '06_reaction',
    vote: '07_vote_confirm',
    achievement: '08_achievement_unlocked',
    error: '09_soft_error',
  };
  var GAIN = {
    click: 0.55,
    tab: 0.55,
    board: 0.9,
    territory: 1,
    profile: 1,
    reaction: 1,
    vote: 1.35,
    achievement: 1,
    error: 0.9,
  };

  var unlocked = false;
  var lastAt = 0;
  var lastErrorAt = 0;
  var playing = {};
  var log = [];

  function readSettings() {
    var on = true;
    var volume = 25;
    try {
      var raw = g.localStorage && g.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.on === false) on = false;
        if (parsed && parsed.volume != null && isFinite(Number(parsed.volume))) {
          volume = Math.max(0, Math.min(100, Math.round(Number(parsed.volume))));
        }
      }
    } catch (_) {}
    return { on: on, volume: volume };
  }

  function writeSettings(next) {
    try {
      if (g.localStorage) {
        g.localStorage.setItem(KEY, JSON.stringify({ on: next.on !== false, volume: next.volume }));
      }
    } catch (_) {}
  }

  function settings() {
    return readSettings();
  }

  function setEnabled(on) {
    var cur = readSettings();
    cur.on = !!on;
    writeSettings(cur);
    if (!cur.on) stopAll();
    paintControls();
  }

  function setVolume(volume) {
    var cur = readSettings();
    cur.volume = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    writeSettings(cur);
    paintControls();
  }

  function stopAll() {
    Object.keys(playing).forEach(function (id) {
      var node = playing[id];
      if (!node) return;
      try { node.pause(); } catch (_) {}
      playing[id] = null;
    });
  }

  function level(id) {
    var cur = readSettings();
    var gain = GAIN[id] == null ? 1 : GAIN[id];
    var value = (cur.volume / 100) * gain;
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    return value;
  }

  function remember(entry) {
    log.push(entry);
    if (log.length > 30) log.shift();
  }

  function startNode(id, url, useWav) {
    var node = new Audio(url);
    node.preload = 'auto';
    node.volume = level(id);
    playing[id] = node;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (playing[id] === node) playing[id] = null;
    }
    node.addEventListener('ended', finish);
    var attempt = node.play();
    remember({ id: id, src: url, at: Date.now(), called: true });
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(finishWait, function () {
        finish();
        var cur = readSettings();
        if (!useWav && cur.on && cur.volume > 0) startNode(id, wavUrl(id), true);
      });
    }
    function finishWait() {}
    return node;
  }

  function oggUrl(id) {
    return '/assets/ui-sfx/ogg/' + FILES[id] + '.ogg';
  }

  function wavUrl(id) {
    return '/assets/ui-sfx/wav/' + FILES[id] + '.wav';
  }

  function play(id) {
    if (!FILES[id]) return false;
    if (!unlocked) return false;
    var cur = readSettings();
    if (!cur.on || cur.volume <= 0) return false;
    var now = Date.now();
    if (id === 'error') {
      if (now - lastErrorAt < 1500) return false;
      lastErrorAt = now;
    }
    if (now - lastAt < GAP_MS) return false;
    if (playing[id]) return false;
    lastAt = now;
    try {
      startNode(id, oggUrl(id), false);
      return true;
    } catch (_) {
      return false;
    }
  }

  function denied(err) {
    if (!err) return false;
    var status = Number(err.status);
    if (status === 401 || status === 403 || status >= 500) return true;
    var code = String(err.code || err.error || '');
    return /FORBIDDEN|UNAUTHORIZED|PERMISSION|NOT_ALLOWED/i.test(code);
  }

  function selectedTab(el) {
    if (!el) return false;
    if (el.getAttribute('aria-selected') === 'true') return true;
    if (el.getAttribute('aria-pressed') === 'true' && el.classList.contains('is-active')) return true;
    return el.classList.contains('is-active') && el.getAttribute('role') === 'tab';
  }

  function kindFrom(raw) {
    if (!raw || !raw.closest) return '';
    if (raw.closest('[data-sc-no-click-sound], [data-sc-sfx="silent"], [data-sc-sfx="vote-arm"], [data-sc-sfx="reaction-arm"]')) {
      return '';
    }
    if (raw.closest('.sc-react-btn--empathy, .sc-react-btn--like, .sc-daily-public-like')) return '';
    var disabled = raw.closest('button[disabled], [aria-disabled="true"]');
    if (disabled) return '';
    if (raw.closest('.territory-hit-zone__hit, [data-sc-tcard]')) return 'territory';
    if (raw.closest('[data-sc-tdetail-enter], .board__feed-tab:not([data-common-hot-period])')) return 'board';
    if (raw.closest('.sc-user-profile-link')) return 'profile';
    if (raw.closest('#avatar-dock-tab')) {
      var dock = document.getElementById('avatar-dock');
      if (dock && dock.classList.contains('is-collapsed')) return 'profile';
      return 'click';
    }
    var tab = raw.closest('[role="tab"], [data-history-category], [data-period], [data-common-hot-period]');
    if (tab) {
      if (selectedTab(tab)) return '';
      return 'tab';
    }
    if (raw.closest('button, a[href], summary, [role="button"], [role="menuitem"]')) return 'click';
    return '';
  }

  function onPointerDown(ev) {
    if (ev.button != null && ev.button !== 0) return;
    if (ev.isTrusted === false) return;
    unlocked = true;
    var raw = ev.target;
    if (!raw) return;
    if (raw.nodeType !== 1) raw = raw.parentElement;
    var id = kindFrom(raw);
    if (id) play(id);
  }

  function onKeyDown(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    if (ev.isTrusted === false) return;
    unlocked = true;
  }

  function usPage() {
    try {
      return !!(g.location && /^\/us(?:\/|$)/.test(g.location.pathname || ''));
    } catch (_) {
      return false;
    }
  }

  function paintControls() {
    var cur = readSettings();
    var toggle = document.getElementById('sc-sfx-enabled');
    var range = document.getElementById('sc-sfx-volume');
    var value = document.getElementById('sc-sfx-volume-value');
    if (toggle) toggle.checked = cur.on;
    if (range && document.activeElement !== range) range.value = String(cur.volume);
    if (value) value.textContent = String(cur.volume) + '%';
    var title = document.getElementById('sc-sfx-title');
    var onLabel = document.getElementById('sc-sfx-on-label');
    var volLabel = document.getElementById('sc-sfx-volume-label');
    var en = usPage();
    if (title) title.textContent = en ? 'Sound' : '효과음';
    if (onLabel) onLabel.textContent = en ? 'Sound effects' : '효과음 사용';
    if (volLabel) volLabel.textContent = en ? 'Volume' : '음량';
  }

  function bindControls() {
    var toggle = document.getElementById('sc-sfx-enabled');
    var range = document.getElementById('sc-sfx-volume');
    if (toggle && toggle.dataset.scSfxBound !== '1') {
      toggle.dataset.scSfxBound = '1';
      toggle.addEventListener('change', function () {
        unlocked = true;
        setEnabled(toggle.checked);
      });
    }
    if (range && range.dataset.scSfxBound !== '1') {
      range.dataset.scSfxBound = '1';
      range.addEventListener('input', function () {
        unlocked = true;
        setVolume(range.value);
      });
    }
    paintControls();
  }

  function attach() {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    bindControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  g.ScUiSfx = {
    play: play,
    denied: denied,
    settings: settings,
    setEnabled: setEnabled,
    setVolume: setVolume,
    kindFrom: kindFrom,
    recent: function () { return log.slice(); },
    unlock: function () { unlocked = true; },
  };
  g.__scUiSound = {
    playClick: function () { unlocked = true; play('click'); },
    playTab: function () { unlocked = true; play('tab'); },
    setReducedMotionMute: function (mute) { if (mute) setEnabled(false); },
  };
})(typeof window !== 'undefined' ? window : this);
