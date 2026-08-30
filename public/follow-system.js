/**
 * 센텐스아레나 — 유저 팔로우 · 팔로워/팔로우 알림 · 새 글 알림 (localStorage)
 */
(function (global) {
  'use strict';

  var LS_KEY = 'sc_follow_v1';
  var NOTIFY_KEY = 'sc_follow_notify_v1';
  var PREFS_KEY = 'sc_follow_notify_prefs_v1';
  var MAX_NOTIFY = 60;

  function meId() {
    return String((global.__scPlayer && global.__scPlayer.userId) || 'guest').trim() || 'guest';
  }

  function genId() {
    return 'fn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function loadGraph() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return { following: {}, followers: {} };
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return { following: {}, followers: {} };
      if (!o.following || typeof o.following !== 'object') o.following = {};
      if (!o.followers || typeof o.followers !== 'object') o.followers = {};
      return o;
    } catch (_) {
      return { following: {}, followers: {} };
    }
  }

  function saveGraph(g) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(g));
      return true;
    } catch (e) {
      console.warn('[follow] save failed', e);
      return false;
    }
  }

  function uniqList(arr) {
    var out = [];
    var seen = {};
    (arr || []).forEach(function (id) {
      var s = String(id || '').trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out;
  }

  function getFollowing(userId) {
    var g = loadGraph();
    return uniqList(g.following[String(userId || '').trim()]);
  }

  function getFollowers(userId) {
    var g = loadGraph();
    return uniqList(g.followers[String(userId || '').trim()]);
  }

  function getFollowerCount(userId) {
    return getFollowers(userId).length;
  }

  function getFollowingCount(userId) {
    return getFollowing(userId).length;
  }

  function isFollowing(targetId) {
    var me = meId();
    var t = String(targetId || '').trim();
    if (!t || t === me) return false;
    return getFollowing(me).indexOf(t) >= 0;
  }

  function syncProgressionFollowers(targetId) {
    var n = getFollowerCount(targetId);
    if (typeof global.__scSetFollowerCount === 'function') {
      global.__scSetFollowerCount(targetId, n);
    }
  }

  function loadNotifyPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      var d = raw ? JSON.parse(raw) : {};
      if (!d || typeof d !== 'object') d = {};
      return {
        relFollowing: d.relFollowing !== false,
        relFollower: d.relFollower !== false,
        postFollowing: d.postFollowing === true,
        postFollower: d.postFollower === true,
      };
    } catch (_) {
      return {
        relFollowing: true,
        relFollower: true,
        postFollowing: false,
        postFollower: false,
      };
    }
  }

  function saveNotifyPrefs(p) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch (_) {}
  }

  function normalizeNotifyItem(n) {
    if (!n || typeof n !== 'object') return n;
    if (n.postId && !n.type) {
      return Object.assign({}, n, { type: 'post', fromFollowee: true, fromFollower: false });
    }
    return n;
  }

  function itemVisible(n, prefs) {
    var x = normalizeNotifyItem(n);
    if (!x || !prefs) return true;
    if (x.type === 'rel_my_follow') return prefs.relFollowing;
    if (x.type === 'rel_follower') return prefs.relFollower;
    if (x.type === 'post') {
      var fe = !!x.fromFollowee;
      var fr = !!x.fromFollower;
      return (fe && prefs.postFollowing) || (fr && prefs.postFollower);
    }
    if (x.type === 'post_followee') return prefs.postFollowing;
    if (x.type === 'post_follower') return prefs.postFollower;
    return true;
  }

  function formatNotifyTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var now = new Date();
      var opts = {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      };
      if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
      return d.toLocaleString('ko-KR', opts);
    } catch (_) {
      return '';
    }
  }

  function notifyLabelForPost(n) {
    var x = normalizeNotifyItem(n);
    if (x.type !== 'post') return '';
    var fe = !!x.fromFollowee;
    var fr = !!x.fromFollower;
    if (fe && fr) return '「맞팔」 ';
    if (fe) return '「팔로우」 ';
    if (fr) return '「팔로워」 ';
    return '';
  }

  function resolveActorLabel(id) {
    var s = String(id || '').trim();
    if (!s) return '유저';
    if (typeof global.resolveDisplayName === 'function') return global.resolveDisplayName(s) || s;
    return s;
  }

  function buildNotifyLines(n) {
    var x = normalizeNotifyItem(n);
    var time = formatNotifyTime(x.createdAt);
    var actor = resolveActorLabel(x.actorId);
    var author = resolveActorLabel(x.authorId);

    if (x.type === 'rel_my_follow') {
      if (x.verb === 'follow') {
        return { main: actor + ' 님을 팔로우했어요.', meta: time };
      }
      return { main: actor + ' 님 팔로우를 해제했어요.', meta: time };
    }
    if (x.type === 'rel_follower') {
      if (x.verb === 'follow') {
        return { main: actor + ' 님이 나를 팔로우했어요.', meta: time };
      }
      return { main: actor + ' 님이 나를 팔로우 취소했어요.', meta: time };
    }
    if (x.postId && (x.type === 'post' || x.type === 'post_followee' || x.type === 'post_follower')) {
      var pre = notifyLabelForPost(x);
      var t = String(x.title || '제목 없음').slice(0, 68);
      return {
        main: pre + author + ' 님의 새 글 「' + t + '」',
        meta: time + ' · ' + territoryLabel(x.territoryId),
      };
    }
    return { main: JSON.stringify(x).slice(0, 80), meta: time };
  }

  function toggleFollow(targetId) {
    if (typeof global.__scRequireLoggedInMember === 'function' && !global.__scRequireLoggedInMember()) {
      return { ok: false, reason: 'AUTH_REQUIRED' };
    }
    var me = meId();
    var t = String(targetId || '').trim();
    if (!t || t === me) return { ok: false, reason: 'SELF' };
    var g = loadGraph();
    if (!g.following[me]) g.following[me] = [];
    if (!g.followers[t]) g.followers[t] = [];
    var fl = uniqList(g.following[me]);
    var ix = fl.indexOf(t);
    var nowFollowing;
    if (ix >= 0) {
      fl.splice(ix, 1);
      nowFollowing = false;
      var fb = uniqList(g.followers[t]);
      var j = fb.indexOf(me);
      if (j >= 0) fb.splice(j, 1);
      g.followers[t] = fb;
    } else {
      fl.push(t);
      nowFollowing = true;
      var fb2 = uniqList(g.followers[t]);
      if (fb2.indexOf(me) < 0) fb2.push(me);
      g.followers[t] = fb2;
    }
    g.following[me] = fl;
    saveGraph(g);
    syncProgressionFollowers(t);

    var iso = new Date().toISOString();
    if (nowFollowing && typeof global.addActivityFeedItem === 'function') {
      global.addActivityFeedItem({
        type: 'follow_created',
        message: '새로운 연결이 생겼습니다.',
      });
    }
    pushNotification(me, {
      id: genId(),
      type: 'rel_my_follow',
      actorId: t,
      verb: nowFollowing ? 'follow' : 'unfollow',
      createdAt: iso,
      read: false,
    });
    pushNotification(t, {
      id: genId(),
      type: 'rel_follower',
      actorId: me,
      verb: nowFollowing ? 'follow' : 'unfollow',
      createdAt: iso,
      read: false,
    });

    renderFollowButtons();
    if (typeof global.__scRefreshProgressionUI === 'function') {
      global.__scRefreshProgressionUI();
    }
    if (global.RankLeaderboard && typeof global.RankLeaderboard.refresh === 'function') {
      var modal = document.getElementById('sc-rank-modal');
      if (modal && !modal.hidden) global.RankLeaderboard.refresh();
    }
    return { ok: true, following: nowFollowing, targetId: t };
  }

  function loadNotifyMap() {
    try {
      var raw = localStorage.getItem(NOTIFY_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveNotifyMap(map) {
    try {
      localStorage.setItem(NOTIFY_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function pushNotification(userId, item) {
    var uid = String(userId || '').trim();
    if (!uid) return;
    var n = normalizeNotifyItem(item);
    if (typeof global.addNotification === 'function') {
      if (n.type === 'rel_follower' && n.verb === 'follow') {
        global.addNotification(
          {
            type: 'follow',
            title: '새 팔로워',
            message: resolveActorLabel(n.actorId) + ' 님이 나를 팔로우했습니다.',
            linkTarget: { view: 'profile', userId: n.actorId || null },
          },
          uid,
        );
        return;
      }
    }
    var map = loadNotifyMap();
    if (!Array.isArray(map[uid])) map[uid] = [];
    map[uid].unshift(item);
    if (map[uid].length > MAX_NOTIFY) map[uid] = map[uid].slice(0, MAX_NOTIFY);
    saveNotifyMap(map);
    renderNotificationPanel();
  }

  function territoryLabel(tid) {
    var m = {
      COMMON: '중앙광장',
      CENTRIST: '중앙광장',
      CONSERVATIVE: '질서',
      PROGRESSIVE: '개혁',
      KANTAPBIYA: '외계행성',
      KANTAPBIYA_LEFT: '외계행성',
      KANTAPBIYA_RIGHT: '외계행성',
      KANTAPBIYA_CENTER: '외계행성',
      UNASSIGNED: '미편입',
    };
    return m[tid] || tid || '영토';
  }

  function onAuthorNewPost(meta) {
    var authorId = String(meta && meta.authorId || '').trim();
    if (!authorId) return;
    var followersOfAuthor = getFollowers(authorId);
    var recipientSet = {};
    followersOfAuthor.forEach(function (fid) {
      if (fid !== authorId) recipientSet[fid] = true;
    });
    var g = loadGraph();
    Object.keys(g.followers || {}).forEach(function (uid) {
      if (uid === authorId) return;
      if (uniqList(g.followers[uid]).indexOf(authorId) >= 0) recipientSet[uid] = true;
    });
    var createdAt = new Date().toISOString();
    var postId = String(meta.postId || '');
    var title = String(meta.title || '(제목 없음)').slice(0, 80);
    var territoryId = String(meta.territoryId || 'COMMON');
    var stage = Math.max(1, Math.floor(Number(meta.stage) || 1));

    Object.keys(recipientSet).forEach(function (uid) {
      var fromFollowee = followersOfAuthor.indexOf(uid) >= 0;
      var fromFollower = getFollowers(uid).indexOf(authorId) >= 0;
      pushNotification(uid, {
        id: genId(),
        type: 'post',
        postId: postId,
        authorId: authorId,
        title: title,
        territoryId: territoryId,
        stage: stage,
        fromFollowee: fromFollowee,
        fromFollower: fromFollower,
        createdAt: createdAt,
        read: false,
      });
    });
  }

  function getMyNotifications() {
    return loadNotifyMap()[meId()] || [];
  }

  function markAllRead() {
    if (typeof global.markAllNotificationsRead === 'function') {
      global.markAllNotificationsRead();
      return;
    }
    var map = loadNotifyMap();
    var uid = meId();
    if (!Array.isArray(map[uid])) return;
    map[uid].forEach(function (n) {
      n.read = true;
    });
    saveNotifyMap(map);
    renderNotificationPanel();
  }

  function clearMyNotifications() {
    var map = loadNotifyMap();
    map[meId()] = [];
    saveNotifyMap(map);
    renderNotificationPanel();
  }

  /** 게스트 입장 등: 해당 id를 팔로 그래프·알림 키에서 제거 */
  function purgeFollowStateForUsers(ids) {
    var set = {};
    (ids || []).forEach(function (raw) {
      var k = String(raw || '').trim();
      if (k) set[k] = true;
    });
    var purgeKeys = Object.keys(set);
    if (!purgeKeys.length) return;
    var g = loadGraph();
    var gCh = false;
    purgeKeys.forEach(function (id) {
      if (g.following[id]) {
        delete g.following[id];
        gCh = true;
      }
      if (g.followers[id]) {
        delete g.followers[id];
        gCh = true;
      }
    });
    function strip(side) {
      Object.keys(g[side]).forEach(function (uid) {
        var arr = g[side][uid];
        if (!Array.isArray(arr)) return;
        var next = arr.filter(function (x) {
          return !set[String(x || '').trim()];
        });
        if (next.length !== arr.length) {
          g[side][uid] = next;
          gCh = true;
        }
      });
    }
    strip('following');
    strip('followers');
    if (gCh) saveGraph(g);

    var nm = loadNotifyMap();
    var nCh = false;
    purgeKeys.forEach(function (id) {
      if (nm[id]) {
        delete nm[id];
        nCh = true;
      }
    });
    if (nCh) saveNotifyMap(nm);
    syncAllFollowerCountsToProgression();
    renderFollowButtons();
    if (typeof global.__scRefreshProgressionUI === 'function') global.__scRefreshProgressionUI();
  }

  function unreadCount() {
    var prefs = loadNotifyPrefs();
    return getMyNotifications().filter(function (n) {
      return !normalizeNotifyItem(n).read && itemVisible(n, prefs);
    }).length;
  }

  function renderNotificationPanel() {
    if (typeof global.renderNotifications === 'function') {
      global.renderNotifications();
      return;
    }
    var panel = document.getElementById('sc-follow-notify-panel');
    var list = document.getElementById('sc-follow-notify-list');
    var badge = document.getElementById('sc-follow-notify-badge');
    if (!list) return;
    var prefs = loadNotifyPrefs();
    var items = getMyNotifications();
    var unread = unreadCount();
    if (badge) {
      badge.textContent = String(unread);
      badge.hidden = unread <= 0;
    }
    list.textContent = '';
    var visible = items.filter(function (n) {
      return itemVisible(n, prefs);
    });
    if (!visible.length) {
      var empty = document.createElement('li');
      empty.className = 'sc-follow-notify__empty muted';
      empty.textContent =
        items.length > 0
          ? '지금은 보이는 알림이 없어요. 오른쪽 위 스위치에서 받을 알림을 켜 주세요.'
          : '새 소식이 없어요. 팔로우하거나 글이 올라오면 여기에 모여요.';
      list.appendChild(empty);
      return;
    }
    visible.forEach(function (n) {
      var x = normalizeNotifyItem(n);
      var li = document.createElement('li');
      li.className = 'sc-follow-notify__item' + (x.read ? '' : ' is-unread');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-follow-notify__btn';
      var lines = buildNotifyLines(x);
      var main = document.createElement('span');
      main.className = 'sc-follow-notify__line sc-follow-notify__line--main';
      main.textContent = lines.main;
      var meta = document.createElement('span');
      meta.className = 'sc-follow-notify__line sc-follow-notify__line--meta';
      meta.textContent = lines.meta;
      btn.appendChild(main);
      btn.appendChild(meta);
      var isPost = !!(x.postId && (x.type === 'post' || x.type === 'post_followee' || x.type === 'post_follower'));
      btn.addEventListener('click', function () {
        x.read = true;
        n.read = true;
        var map = loadNotifyMap();
        var uid = meId();
        if (Array.isArray(map[uid])) saveNotifyMap(map);
        if (isPost && typeof global.__scBoardNavigateToPost === 'function') {
          global.__scBoardNavigateToPost(x.territoryId, x.stage, x.postId);
        }
        if (panel) panel.hidden = true;
        var tgl = document.getElementById('sc-follow-notify-toggle');
        if (tgl) tgl.setAttribute('aria-expanded', 'false');
        var settingsPop = document.getElementById('sc-follow-notify-settings-pop');
        if (settingsPop) settingsPop.hidden = true;
        renderNotificationPanel();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function renderFollowButtons() {
    document.querySelectorAll('.board__follow-btn[data-author-id]').forEach(function (btn) {
      var aid = btn.getAttribute('data-author-id');
      var on = isFollowing(aid);
      btn.textContent = on ? '팔로잉 ✓' : '팔로우';
      btn.classList.toggle('is-following', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncAllFollowerCountsToProgression() {
    var g = loadGraph();
    Object.keys(g.followers || {}).forEach(function (targetId) {
      syncProgressionFollowers(targetId);
    });
  }

  function syncSettingsUiFromPrefs() {
    var p = loadNotifyPrefs();
    var pairs = [
      ['sc-follow-pref-rel-following', p.relFollowing],
      ['sc-follow-pref-rel-follower', p.relFollower],
      ['sc-follow-pref-post-following', p.postFollowing],
      ['sc-follow-pref-post-follower', p.postFollower],
    ];
    pairs.forEach(function (row) {
      var el = document.getElementById(row[0]);
      if (!el) return;
      el.setAttribute('aria-checked', row[1] ? 'true' : 'false');
    });
  }

  function bindPrefSwitch(id, key) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      var p = loadNotifyPrefs();
      var cur = p[key] === true;
      p[key] = !cur;
      saveNotifyPrefs(p);
      el.setAttribute('aria-checked', p[key] ? 'true' : 'false');
      renderNotificationPanel();
    });
  }

  function setNotifyPanelOpen(open) {
    var panel = document.getElementById('sc-follow-notify-panel');
    var toggle = document.getElementById('sc-follow-notify-toggle');
    var settingsPop = document.getElementById('sc-follow-notify-settings-pop');
    if (panel) panel.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (settingsPop) {
      settingsPop.hidden = !open;
      if (open) syncSettingsUiFromPrefs();
    }
  }

  function initNotificationUi() {
    syncAllFollowerCountsToProgression();
    if (typeof global.initNotificationCenterUi === 'function') {
      global.initNotificationCenterUi();
      renderFollowButtons();
      return;
    }
    var toggle = document.getElementById('sc-follow-notify-toggle');
    var panel = document.getElementById('sc-follow-notify-panel');
    var btnClear = document.getElementById('sc-follow-notify-clear');
    var btnRead = document.getElementById('sc-follow-notify-read');
    if (toggle && panel) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        setNotifyPanelOpen(panel.hidden);
      });
    }
    document.addEventListener('click', function () {
      if (!panel || panel.hidden) return;
      setNotifyPanelOpen(false);
    });
    if (panel) {
      panel.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }
    var settingsPop = document.getElementById('sc-follow-notify-settings-pop');
    if (settingsPop) {
      settingsPop.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }
    if (btnClear) {
      btnClear.addEventListener('click', function (e) {
        e.stopPropagation();
        clearMyNotifications();
      });
    }
    if (btnRead) {
      btnRead.addEventListener('click', function (e) {
        e.stopPropagation();
        markAllRead();
      });
    }
    bindPrefSwitch('sc-follow-pref-rel-following', 'relFollowing');
    bindPrefSwitch('sc-follow-pref-rel-follower', 'relFollower');
    bindPrefSwitch('sc-follow-pref-post-following', 'postFollowing');
    bindPrefSwitch('sc-follow-pref-post-follower', 'postFollower');
    syncSettingsUiFromPrefs();
    renderNotificationPanel();
  }

  global.FollowSystem = {
    getFollowing: getFollowing,
    getFollowers: getFollowers,
    getFollowerCount: getFollowerCount,
    getFollowingCount: getFollowingCount,
    isFollowing: isFollowing,
    toggleFollow: toggleFollow,
    onAuthorNewPost: onAuthorNewPost,
    getMyNotifications: getMyNotifications,
    loadNotifyPrefs: loadNotifyPrefs,
    renderNotificationPanel: renderNotificationPanel,
    renderFollowButtons: renderFollowButtons,
    purgeFollowStateForUsers: purgeFollowStateForUsers,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNotificationUi);
  } else {
    initNotificationUi();
  }
})(typeof window !== 'undefined' ? window : this);
