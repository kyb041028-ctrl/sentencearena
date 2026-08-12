/**
 * display-name.js — 닉네임(displayName) 조회·캐시 공통 헬퍼
 * Search System v1 사전 기반: userId는 내부 식별자, 표시·검색은 displayName 기준.
 */
(function (global) {
  'use strict';

  var LS_KEY = 'sc_display_names_v1';
  var BOARD_BUNDLE_KEY = 'sc_board_bundle_v1';

  function trim(s) {
    return String(s || '').trim();
  }

  function loadMap() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveMap(map) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(map || {}));
      return true;
    } catch (_) {
      return false;
    }
  }

  function readCachedName(userId) {
    var id = trim(userId);
    if (!id) return '';
    var map = loadMap();
    return trim(map[id]);
  }

  function readCurrentUserNickname() {
    if (typeof global.getCurrentProfileData !== 'function') return '';
    try {
      var prof = global.getCurrentProfileData();
      if (!prof) return '';
      return trim(prof.nickname);
    } catch (_) {
      return '';
    }
  }

  function readAuthNicknameForId(userId) {
    var id = trim(userId);
    if (!id) return '';
    var cache = global.__scUserProfileCache || {};
    var dbProfile = cache.dbProfile && typeof cache.dbProfile === 'object' ? cache.dbProfile : {};
    var name = trim(dbProfile.display_name);
    if (name) {
      if (
        global.ActivityNameCore &&
        typeof global.ActivityNameCore.isCompleteActivityName === 'function' &&
        !global.ActivityNameCore.isCompleteActivityName(name)
      ) {
        return '';
      }
      return name;
    }
    /* OAuth provider metadata 는 SentenceArena 활동명으로 확정하지 않음 */
    return '';
  }

  function isCurrentUserId(userId) {
    var id = trim(userId);
    if (!id) return false;
    var player = global.__scPlayer || {};
    if (trim(player.userId) === id) return true;
    if (typeof global.getCurrentProfileData === 'function') {
      try {
        var prof = global.getCurrentProfileData();
        if (prof) {
          if (trim(prof.authUserId) === id) return true;
          if (trim(prof.email) === id) return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function rememberDisplayName(userId, displayName) {
    var id = trim(userId);
    var name = trim(displayName);
    if (!id || !name || name === id) return false;
    var map = loadMap();
    if (map[id] === name) return true;
    map[id] = name;
    return saveMap(map);
  }

  function rememberDisplayNamesForAliases(primaryUserId, displayName, aliases) {
    var name = trim(displayName);
    if (!name) return;
    var ids = [trim(primaryUserId)];
    if (aliases && aliases.length) {
      aliases.forEach(function (a) {
        var s = trim(a);
        if (s && ids.indexOf(s) < 0) ids.push(s);
      });
    }
    ids.forEach(function (id) {
      if (id) rememberDisplayName(id, name);
    });
  }

  function syncCurrentUserDisplayName(existingProf) {
    var prof = existingProf;
    if (!prof) {
      if (typeof global.getCurrentProfileData !== 'function') return;
      try {
        prof = global.getCurrentProfileData();
      } catch (_) {
        return;
      }
    }
    if (!prof) return;
    var nickname = trim(prof.nickname);
    if (!nickname) return;
    var player = global.__scPlayer || {};
    var aliases = [player.userId, prof.authUserId, prof.email].filter(function (a) {
      return !!trim(a);
    });
    var primary = trim(player.userId) || trim(prof.authUserId) || trim(prof.email);
    if (primary) rememberDisplayNamesForAliases(primary, nickname, aliases);
  }

  function resolveDisplayName(userId) {
    var id = trim(userId);
    if (!id) return '';

    if (isCurrentUserId(id)) {
      var nick = readCurrentUserNickname();
      if (nick) return nick;
      var authNick = readAuthNicknameForId(id);
      if (authNick) return authNick;
    }

    var cached = readCachedName(id);
    if (cached) return cached;

    if (isCurrentUserId(id)) {
      var authName = readAuthNicknameForId(id);
      if (authName) return authName;
    }

    return id;
  }

  function walkBundleAuthorIds(bundle, out) {
    if (!bundle || typeof bundle !== 'object' || !out) return;
    var posts = bundle.posts;
    if (posts && typeof posts === 'object') {
      Object.keys(posts).forEach(function (stageKey) {
        var list = posts[stageKey];
        if (!Array.isArray(list)) return;
        list.forEach(function (p) {
          if (!p) return;
          var aid = trim(p.authorId);
          if (aid) out[aid] = true;
          var comments = p.comments;
          if (!Array.isArray(comments)) return;
          comments.forEach(function (c) {
            if (!c) return;
            var cid = trim(c.authorId);
            if (cid) out[cid] = true;
          });
        });
      });
    }
    var categories = bundle.categories;
    if (categories && typeof categories === 'object') {
      Object.keys(categories).forEach(function (catId) {
        var block = categories[catId];
        if (!block || !Array.isArray(block.issues)) return;
        block.issues.forEach(function (issue) {
          if (!issue || !Array.isArray(issue.comments)) return;
          issue.comments.forEach(function (c) {
            if (!c) return;
            var cid = trim(c.authorId);
            if (cid) out[cid] = true;
          });
        });
      });
    }
  }

  function collectAuthorIdsFromBundle() {
    var ids = {};
    try {
      var raw = localStorage.getItem(BOARD_BUNDLE_KEY);
      if (!raw) return ids;
      var bundle = JSON.parse(raw);
      walkBundleAuthorIds(bundle, ids);
    } catch (_) {}
    return ids;
  }

  /**
   * Search System v1 준비용 — userId → 표시 이름 인덱스 (클라이언트 스캔).
   * 향후 통합검색: 시민(displayName) + 토론(제목/본문) 그룹 분리 표시.
   */
  function collectDisplayNameIndex() {
    var byUserId = {};
    var map = loadMap();
    Object.keys(map).forEach(function (id) {
      var name = trim(map[id]);
      if (name) byUserId[id] = name;
    });

    var authorIds = collectAuthorIdsFromBundle();
    Object.keys(authorIds).forEach(function (id) {
      if (!byUserId[id]) byUserId[id] = resolveDisplayName(id);
    });

    try {
      var progRaw = localStorage.getItem('sc_player_progression_v1');
      if (progRaw) {
        var progMap = JSON.parse(progRaw);
        if (progMap && typeof progMap === 'object') {
          Object.keys(progMap).forEach(function (id) {
            if (!byUserId[id]) byUserId[id] = resolveDisplayName(id);
          });
        }
      }
    } catch (_) {}

    var citizens = Object.keys(byUserId)
      .map(function (id) {
        return { userId: id, displayName: byUserId[id] };
      })
      .sort(function (a, b) {
        return String(a.displayName).localeCompare(String(b.displayName), 'ko');
      });

    return {
      version: 1,
      byUserId: byUserId,
      citizens: citizens,
      searchNote: 'Search System v1: displayName 기반 통합검색 (시민 + 토론)',
    };
  }

  global.resolveDisplayName = resolveDisplayName;
  global.rememberDisplayName = rememberDisplayName;
  global.rememberDisplayNamesForAliases = rememberDisplayNamesForAliases;
  global.syncCurrentUserDisplayName = syncCurrentUserDisplayName;
  global.collectDisplayNameIndex = collectDisplayNameIndex;
  global.__scResolveDisplayName = resolveDisplayName;
  global.__scCollectDisplayNameIndex = collectDisplayNameIndex;
})(typeof window !== 'undefined' ? window : this);
