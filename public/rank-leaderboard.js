/**
 * 센텐스아레나 — 명성 순위 (전체 · 영토별, 1~100위)
 */
(function (global) {
  'use strict';

  var MODE_GLOBAL = 'global';

  var TAB_MODES = [
    { mode: 'global', label: '전체', title: '전체 명성 순위', filter: null },
    { mode: 'COMMON', label: '중앙', title: '중앙광장 명성 순위', filter: 'COMMON' },
    { mode: 'PROGRESSIVE', label: '개척', title: '개척영토 명성 순위', filter: 'PROGRESSIVE' },
    { mode: 'CONSERVATIVE', label: '수호', title: '수호영토 명성 순위', filter: 'CONSERVATIVE' },
    { mode: 'KANTAPBIYA', label: '외계', title: '외계행성 명성 순위', filter: 'KANTAPBIYA' },
  ];

  var TOP5_META = {
    1: { icon: '👑', cls: 'sc-rank-modal__item--top1', badge: '' },
    2: { icon: '🥈', cls: 'sc-rank-modal__item--top2', badge: '' },
    3: { icon: '🥉', cls: 'sc-rank-modal__item--top3', badge: '' },
    4: { icon: '⭐', cls: 'sc-rank-modal__item--top4', badge: 'TOP4' },
    5: { icon: '⭐', cls: 'sc-rank-modal__item--top5', badge: 'TOP5' },
  };

  var TERRITORY_DATA_ATTR = {
    COMMON: 'centrist',
    CENTRIST: 'centrist',
    PROGRESSIVE: 'reform',
    CONSERVATIVE: 'order',
    KANTAPBIYA: 'alien',
  };

  var currentMode = MODE_GLOBAL;

  function meId() {
    return String((global.__scPlayer && global.__scPlayer.userId) || 'guest').trim() || 'guest';
  }

  function P() {
    return global.PlayerProgression;
  }

  function isAuthenticatedMemberViewer() {
    try {
      var authId = global.__scAuthUserId != null ? String(global.__scAuthUserId).trim() : '';
      if (authId) return true;
      var player = global.__scPlayer || {};
      var uid = String(player.userId || '').trim();
      if (uid && uid !== 'guest' && uid !== 'guest_demo') return true;
    } catch (_) {}
    return false;
  }

  function getTabConfig(mode) {
    var m = String(mode || MODE_GLOBAL);
    for (var i = 0; i < TAB_MODES.length; i++) {
      if (TAB_MODES[i].mode === m) return TAB_MODES[i];
    }
    return TAB_MODES[0];
  }

  function guestDemoTitle(tab) {
    if (!tab) return '체험용 명성 예시';
    if (tab.mode === MODE_GLOBAL) return '체험용 명성 예시';
    return '체험용 · ' + String(tab.label || '') + ' 명성 예시';
  }

  function syncRankEntryVisibility() {
    var btnMapRank = document.getElementById('sc-map-tab-ranking');
    if (!btnMapRank) return;
    if (isAuthenticatedMemberViewer()) {
      btnMapRank.hidden = true;
      btnMapRank.setAttribute('aria-hidden', 'true');
      btnMapRank.disabled = true;
    } else {
      btnMapRank.hidden = false;
      btnMapRank.removeAttribute('aria-hidden');
      btnMapRank.disabled = false;
      btnMapRank.setAttribute('aria-label', '랭킹 (체험용 명성 예시)');
      btnMapRank.setAttribute('title', '랭킹 · 체험용 명성 예시');
    }
  }

  function getLeaderboardForMode(mode) {
    var prog = P();
    if (!prog) return { top: [], total: 0, all: [] };
    var tab = getTabConfig(mode);
    return prog.getLeaderboard(tab.filter);
  }

  function findRankInBoard(board, uid) {
    var all = board && board.all ? board.all : [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].userId === uid) {
        return { rank: i + 1, total: board.total || all.length };
      }
    }
    return { rank: null, total: board.total || all.length };
  }

  function territoryIdToDataTerritory(tid) {
    var key = String(tid || 'COMMON').trim().toUpperCase() || 'COMMON';
    return TERRITORY_DATA_ATTR[key] || 'centrist';
  }

  function buildTerritoryBadgeHtml(row) {
    var tid = row && row.territoryId ? row.territoryId : 'COMMON';
    var label = row && row.territoryLabel ? row.territoryLabel : '중앙광장';
    return (
      '<span class="sc-rank-modal__terr sc-badge" data-territory="' +
      escapeHtml(territoryIdToDataTerritory(tid)) +
      '">' +
      escapeHtml(label) +
      '</span>'
    );
  }

  function renderMyPanel(myEl, stats) {
    if (!myEl) return;
    var rankText = stats.rank != null ? stats.rank + '위' : '—';
    var totalText = stats.total != null ? stats.total + '명' : '—';
    myEl.innerHTML =
      '<div class="sc-rank-modal__my-grid">' +
      '<div class="sc-rank-modal__my-cell">' +
      '<span class="sc-rank-modal__my-lbl">내 순위</span>' +
      '<span class="sc-rank-modal__my-val">' +
      escapeHtml(rankText) +
      '</span>' +
      '</div>' +
      '<div class="sc-rank-modal__my-cell">' +
      '<span class="sc-rank-modal__my-lbl">참여 인원</span>' +
      '<span class="sc-rank-modal__my-val">' +
      escapeHtml(totalText) +
      '</span>' +
      '</div>' +
      '<div class="sc-rank-modal__my-cell">' +
      '<span class="sc-rank-modal__my-lbl">명성</span>' +
      '<span class="sc-rank-modal__my-val">' +
      escapeHtml(String(stats.score != null ? stats.score.toLocaleString('ko-KR') : '0')) +
      '</span>' +
      '</div>' +
      '<div class="sc-rank-modal__my-cell">' +
      '<span class="sc-rank-modal__my-lbl">팔로워</span>' +
      '<span class="sc-rank-modal__my-val">' +
      escapeHtml(String(stats.followers != null ? stats.followers.toLocaleString('ko-KR') : '0')) +
      '명</span>' +
      '</div>' +
      '</div>';
  }

  function openModal() {
    /* Production 실회원: localStorage 기반 「전체 명성 순위」 숨김 */
    if (isAuthenticatedMemberViewer()) {
      syncRankEntryVisibility();
      closeModal();
      return;
    }
    var modal = document.getElementById('sc-rank-modal');
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    renderModal();
  }

  function closeModal() {
    var modal = document.getElementById('sc-rank-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  function setActiveTab(mode) {
    currentMode = String(mode || MODE_GLOBAL);
    var tabs = document.querySelectorAll('.sc-rank-modal__tab');
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-mode') === currentMode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderModal();
  }

  function buildPosHtml(rankNum) {
    var top = TOP5_META[rankNum];
    if (!top) return String(rankNum);
    return (
      '<span class="sc-rank-modal__top-icon" aria-hidden="true">' +
      top.icon +
      '</span>' +
      '<span class="sc-rank-modal__pos-num">' +
      rankNum +
      '</span>'
    );
  }

  function buildBadgeHtml(rankNum) {
    var top = TOP5_META[rankNum];
    if (!top || !top.badge) return '';
    return '<span class="sc-rank-modal__badge">' + top.badge + '</span>';
  }

  function renderModal() {
    var prog = P();
    if (!prog) return;
    var listEl = document.getElementById('sc-rank-modal-list');
    var myEl = document.getElementById('sc-rank-modal-my');
    var titleEl = document.getElementById('sc-rank-modal-title');
    if (!listEl) return;

    var uid = meId();
    var standings = prog.getMyStandings(uid);
    var tab = getTabConfig(currentMode);
    var board = getLeaderboardForMode(currentMode);

    if (titleEl) {
      titleEl.textContent = isAuthenticatedMemberViewer() ? tab.title : guestDemoTitle(tab);
    }

    if (myEl) {
      if (currentMode === MODE_GLOBAL) {
        renderMyPanel(myEl, {
          rank: standings.globalRank,
          total: standings.globalTotal,
          score: standings.score,
          followers: standings.followers,
        });
      } else {
        var place = findRankInBoard(board, uid);
        renderMyPanel(myEl, {
          rank: place.rank,
          total: place.total,
          score: standings.score,
          followers: standings.followers,
        });
      }
    }

    listEl.textContent = '';
    if (!board.top.length) {
      var empty = document.createElement('li');
      empty.className = 'sc-rank-modal__empty muted';
      empty.textContent = '집계된 유저가 없습니다.';
      listEl.appendChild(empty);
      return;
    }

    board.top.forEach(function (row, idx) {
      var li = document.createElement('li');
      var rankNum = idx + 1;
      var isMe = row.userId === uid;
      var topMeta = TOP5_META[rankNum];
      var cls = 'sc-rank-modal__item';
      if (isMe) cls += ' is-me';
      if (topMeta) cls += ' sc-rank-modal__item--top ' + topMeta.cls;
      li.className = cls;
      li.innerHTML =
        '<span class="sc-rank-modal__pos">' +
        buildPosHtml(rankNum) +
        '</span>' +
        '<span class="sc-rank-modal__main">' +
        '<strong>' +
        escapeHtml(displayNameForRow(row.userId)) +
        '</strong>' +
        buildBadgeHtml(rankNum) +
        ' · ' +
        escapeHtml(row.rankTitle) +
        ' · Lv.' +
        row.level +
        '</span>' +
        '<span class="sc-rank-modal__sub">' +
        '<span>명성 ' +
        row.score.toLocaleString('ko-KR') +
        '</span>' +
        buildTerritoryBadgeHtml(row) +
        '<span>팔로워 ' +
        row.followers +
        '</span>' +
        '</span>';
      var mainEl = li.querySelector('.sc-rank-modal__main strong');
      if (typeof global.wireScUserProfileLink === 'function') {
        global.wireScUserProfileLink(mainEl, row.userId);
      }
      listEl.appendChild(li);
    });

    if (board.total > prog.LEADERBOARD_MAX) {
      var more = document.createElement('li');
      more.className = 'sc-rank-modal__more muted';
      more.textContent = '상위 ' + prog.LEADERBOARD_MAX + '위까지만 표시 (전체 ' + board.total + '명)';
      listEl.appendChild(more);
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shortUserId(id) {
    var s = String(id || '');
    if (s.length <= 18) return s;
    return s.slice(0, 8) + '…' + s.slice(-6);
  }

  function displayNameForRow(userId) {
    if (typeof global.resolveDisplayName === 'function') {
      return global.resolveDisplayName(userId) || shortUserId(userId);
    }
    return shortUserId(userId);
  }

  function initUi() {
    var btnMapRank = document.getElementById('sc-map-tab-ranking');
    var btnClose = document.getElementById('sc-rank-modal-close');
    var backdrop = document.getElementById('sc-rank-modal-backdrop');
    var modal = document.getElementById('sc-rank-modal');
    var tabs = document.querySelectorAll('.sc-rank-modal__tab');

    syncRankEntryVisibility();
    if (btnMapRank) {
      btnMapRank.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (isAuthenticatedMemberViewer()) {
          syncRankEntryVisibility();
          return;
        }
        openModal();
      });
    }
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        setActiveTab(tab.getAttribute('data-mode') || MODE_GLOBAL);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });
    document.addEventListener('sc:auth-ready', syncRankEntryVisibility);
  }

  global.RankLeaderboard = {
    open: openModal,
    close: closeModal,
    refresh: renderModal,
    syncVisibility: syncRankEntryVisibility,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUi);
  } else {
    initUi();
  }
})(typeof window !== 'undefined' ? window : this);
