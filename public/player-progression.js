/**
 * 센텐스아레나 — 레벨(1~5) · 경험치 · 명성·등급(localStorage)
 *
 * 철학: 레벨=활동 경험, 명성 등급=받은 반응 기반(권력 계급 아님). 상대평가 하위 컷 없음.
 */
(function (global) {
  'use strict';

  var LS_KEY = 'sc_player_progression_v1';
  var MAX_LEVEL = 10;
  var LURK_UNLOCK_LEVEL = 3;
  var RANK_UNLOCK_LEVEL = 4;
  var MAX_RANK_TIER = 4;

  var XP_REWARDS = {
    post_write: 25,
    board_comment: 12,
    issue_comment: 10,
  };

  /** 공식 Lv1~10 · shared/progression-xp-core SSOT와 동일 */
  var XP_PER_LEVEL = [40, 50, 60, 70, 80, 120, 160, 220, 300, 400];
  var MAX_TOTAL_XP = 1500;

  var LEVEL_CUMULATIVE_XP = [0];
  (function buildThresholds() {
    var sum = 0;
    for (var i = 0; i < XP_PER_LEVEL.length; i++) {
      sum += XP_PER_LEVEL[i];
      LEVEL_CUMULATIVE_XP.push(sum);
    }
  })();

  var RANK_ABSOLUTE = {
    2: { postLikes: 3, commentLikes: 2, followers: 2 },
    3: { postLikes: 15, commentLikes: 8, followers: 8 },
    4: { postLikes: 40, commentLikes: 20, followers: 20 },
  };

  var RANK_FOLLOWER_WEIGHT = 5;

  var RANK_CAPS = {
    politicianMaxRatio: 0.1,
    chiefsMaxCount: 5,
  };

  var RANK_TIERS = [
    { tier: 1, labelKo: '시민', shortKo: '시민' },
    { tier: 2, labelKo: '논객', shortKo: '논객' },
    { tier: 3, labelKo: '대표', shortKo: '대표' },
    { tier: 4, labelKo: '지도자', shortKo: '지도자' },
  ];

  var TERRITORY_LABELS = {
    UNASSIGNED: '미편입',
    CONSERVATIVE: '질서',
    COMMON: '중앙광장',
    CENTRIST: '중앙광장',
    PROGRESSIVE: '개혁',
    KANTAPBIYA: '외계행성',
  };

  var LEADERBOARD_MAX = 100;

  function levelFromTotalXp(totalXp) {
    var xp = Math.max(0, Math.floor(Number(totalXp) || 0));
    var lv = 1;
    for (var i = LEVEL_CUMULATIVE_XP.length - 1; i >= 0; i--) {
      if (xp >= LEVEL_CUMULATIVE_XP[i]) {
        lv = i + 1;
        break;
      }
    }
    return Math.min(MAX_LEVEL, Math.max(1, lv));
  }

  function xpProgressInLevel(level, totalXp) {
    var lv = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
    var xp = Math.max(0, Math.floor(Number(totalXp) || 0));
    var floor = LEVEL_CUMULATIVE_XP[lv - 1] || 0;
    if (lv >= MAX_LEVEL) {
      var maxFloor = LEVEL_CUMULATIVE_XP[9] || 1100;
      var maxCeil = LEVEL_CUMULATIVE_XP[10] != null ? LEVEL_CUMULATIVE_XP[10] : MAX_TOTAL_XP;
      var neededMax = Math.max(1, maxCeil - maxFloor);
      var currentMax = Math.max(0, Math.min(neededMax, xp - maxFloor));
      var pctMax = xp >= MAX_TOTAL_XP ? 100 : Math.round((100 * currentMax) / neededMax);
      return {
        floor: maxFloor,
        ceiling: maxCeil,
        current: currentMax,
        needed: neededMax,
        pct: Math.max(0, Math.min(100, pctMax)),
        isMaxLevel: true,
      };
    }
    var ceiling = LEVEL_CUMULATIVE_XP[lv] || floor;
    var needed = Math.max(1, ceiling - floor);
    var current = Math.max(0, Math.min(needed, xp - floor));
    var pct = Math.round((100 * current) / needed);
    return {
      floor: floor,
      ceiling: ceiling,
      current: current,
      needed: needed,
      pct: Math.max(0, Math.min(100, pct)),
      isMaxLevel: false,
    };
  }

  function getRankTierRow(tier) {
    var t = Math.floor(Number(tier));
    if (!isFinite(t) || t < 1) return RANK_TIERS[0];
    if (t > RANK_TIERS.length) return RANK_TIERS[RANK_TIERS.length - 1];
    return RANK_TIERS[t - 1];
  }

  function normLikes(n) {
    return Math.max(0, Math.floor(Number(n) || 0));
  }

  function currentTerritoryId() {
    var p = global.__scPlayer;
    return (p && p.territoryId) || 'COMMON';
  }

  function loadMap() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return {};
      var changed = false;
      Object.keys(o).forEach(function (uid) {
        var row = o[uid];
        if (row && String(row.territoryId) === 'CENTRIST') {
          row.territoryId = 'COMMON';
          changed = true;
        }
      });
      if (changed) saveMap(o);
      return o;
    } catch (_) {
      return {};
    }
  }

  function saveMap(map) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(map));
      return true;
    } catch (e) {
      console.warn('[progression] save failed', e);
      return false;
    }
  }

  /** 게스트 입장 등: 로컬 데모 계정 행만 제거 */
  function clearProgressForUsers(ids) {
    var map = loadMap();
    var changed = false;
    (ids || []).forEach(function (raw) {
      var k = String(raw || '').trim();
      if (!k || map[k] == null) return;
      delete map[k];
      changed = true;
    });
    if (changed) saveMap(map);
  }

  function rankReputationScore(row) {
    return (
      normLikes(row.receivedPostLikes) +
      normLikes(row.receivedCommentLikes) * 2 +
      normLikes(row.receivedFollowers) * RANK_FOLLOWER_WEIGHT
    );
  }

  function meetsAbsoluteThreshold(tier, postLikes, commentLikes, followers) {
    var th = RANK_ABSOLUTE[tier];
    if (!th) return false;
    return (
      normLikes(postLikes) >= th.postLikes &&
      normLikes(commentLikes) >= th.commentLikes &&
      normLikes(followers) >= th.followers
    );
  }

  function absoluteRankTierFromStats(level, postLikes, commentLikes, followers) {
    if (level < RANK_UNLOCK_LEVEL) return 0;
    if (meetsAbsoluteThreshold(4, postLikes, commentLikes, followers)) return 4;
    if (meetsAbsoluteThreshold(3, postLikes, commentLikes, followers)) return 3;
    if (meetsAbsoluteThreshold(2, postLikes, commentLikes, followers)) return 2;
    return 1;
  }

  function countTerritoryMembers(territoryId, map, excludeUserId) {
    var tid = String(territoryId || 'COMMON');
    var n = 0;
    Object.keys(map).forEach(function (uid) {
      if (excludeUserId && uid === excludeUserId) return;
      var row = map[uid];
      if (!row || String(row.territoryId || 'COMMON') !== tid) return;
      if (levelFromTotalXp(row.totalXp) >= RANK_UNLOCK_LEVEL) n += 1;
    });
    return Math.max(1, n);
  }

  function countRankHolders(territoryId, map, minTier, excludeUserId, tierByUser) {
    var tid = String(territoryId || 'COMMON');
    var n = 0;
    Object.keys(map).forEach(function (uid) {
      if (excludeUserId && uid === excludeUserId) return;
      var row = map[uid];
      if (!row || String(row.territoryId || 'COMMON') !== tid) return;
      var rt =
        tierByUser && tierByUser[uid] !== undefined
          ? Math.floor(Number(tierByUser[uid]) || 0)
          : Math.floor(Number(row.rankTier) || 0);
      if (rt >= minTier) n += 1;
    });
    return n;
  }

  function applyPopulationCaps(userId, territoryId, tier, map, tierByUser) {
    var t = tier;
    var tid = String(territoryId || 'COMMON');
    if (t >= 4) {
      if (countRankHolders(tid, map, 4, userId, tierByUser) >= RANK_CAPS.chiefsMaxCount) t = Math.min(t, 3);
    }
    if (t >= 3) {
      var pop = countTerritoryMembers(tid, map, userId);
      var maxPol = Math.max(1, Math.floor(pop * RANK_CAPS.politicianMaxRatio));
      if (countRankHolders(tid, map, 3, userId, tierByUser) >= maxPol) t = Math.min(t, 2);
    }
    return t;
  }

  function recomputeAllRanks(map) {
    var absolute = {};
    Object.keys(map).forEach(function (uid) {
      var row = map[uid];
      if (!row) return;
      var level = levelFromTotalXp(row.totalXp);
      if (level < RANK_UNLOCK_LEVEL) {
        absolute[uid] = 0;
        return;
      }
      absolute[uid] = absoluteRankTierFromStats(
        level,
        row.receivedPostLikes,
        row.receivedCommentLikes,
        row.receivedFollowers,
      );
    });

    var provisional = {};
    Object.keys(map).forEach(function (uid) {
      var row = map[uid];
      if (!row) return;
      var level = levelFromTotalXp(row.totalXp);
      if (level < RANK_UNLOCK_LEVEL) {
        provisional[uid] = 0;
        return;
      }
      provisional[uid] = absolute[uid] || 0;
    });

    Object.keys(map).forEach(function (uid) {
      var row = map[uid];
      if (!row) return;
      row.rankTier = applyPopulationCaps(uid, row.territoryId, provisional[uid] || 0, map, provisional);
    });
  }

  function normalizeState(raw, userId, map) {
    var totalXp = Math.max(0, Math.floor(Number(raw && raw.totalXp) || 0));
    var draft = {
      totalXp: totalXp,
      territoryId: String((raw && raw.territoryId) || currentTerritoryId()).trim() || 'COMMON',
      receivedPostLikes: normLikes(raw && raw.receivedPostLikes),
      receivedCommentLikes: normLikes(raw && raw.receivedCommentLikes),
      receivedFollowers: normLikes(raw && raw.receivedFollowers),
      rankTier: 0,
    };
    var m = Object.assign({}, map || {});
    m[userId] = draft;
    recomputeAllRanks(m);
    return m[userId] || draft;
  }

  function getState(userId) {
    var id = String(userId || '').trim() || 'guest';
    var map = loadMap();
    return normalizeState(map[id] || {}, id, map);
  }

  function setState(userId, partial) {
    var id = String(userId || '').trim() || 'guest';
    var map = loadMap();
    var prev = map[id] || {};
    var merged = Object.assign({}, prev, partial || {});
    merged.territoryId = String(merged.territoryId || currentTerritoryId()).trim() || 'COMMON';
    map[id] = normalizeState(merged, id, map);
    recomputeAllRanks(map);
    saveMap(map);
    return map[id];
  }

  function grantXp(userId, action) {
    var amount = XP_REWARDS[action];
    if (!amount) return null;
    var prev = getState(userId);
    var prevLevel = levelFromTotalXp(prev.totalXp);
    var nextXp = prev.totalXp + amount;
    var next = setState(userId, {
      totalXp: nextXp,
      territoryId: currentTerritoryId(),
      receivedPostLikes: prev.receivedPostLikes,
      receivedCommentLikes: prev.receivedCommentLikes,
      receivedFollowers: prev.receivedFollowers,
    });
    var nextLevel = levelFromTotalXp(next.totalXp);
    return {
      action: action,
      amount: amount,
      leveledUp: nextLevel > prevLevel,
      prevLevel: prevLevel,
      nextLevel: nextLevel,
      state: next,
    };
  }

  function grantReceivedLike(authorId, kind, delta) {
    var id = String(authorId || '').trim();
    if (!id) return null;
    var d = Math.floor(Number(delta) || 0);
    if (!d) return null;
    var prev = getState(id);
    var post = prev.receivedPostLikes;
    var comment = prev.receivedCommentLikes;
    if (kind === 'post') post = normLikes(post + d);
    else if (kind === 'comment') comment = normLikes(comment + d);
    else return null;
    var next = setState(id, {
      totalXp: prev.totalXp,
      territoryId: prev.territoryId || currentTerritoryId(),
      receivedPostLikes: post,
      receivedCommentLikes: comment,
      receivedFollowers: prev.receivedFollowers,
    });
    return { authorId: id, kind: kind, delta: d, state: next };
  }

  function setFollowerCount(userId, count) {
    var id = String(userId || '').trim();
    if (!id) return null;
    var prev = getState(id);
    return setState(id, {
      totalXp: prev.totalXp,
      territoryId: prev.territoryId,
      receivedPostLikes: prev.receivedPostLikes,
      receivedCommentLikes: prev.receivedCommentLikes,
      receivedFollowers: normLikes(count),
    });
  }

  function affiliationShortLabel() {
    var p = global.__scPlayer;
    var s = (p && p.affiliationDisplay) || '';
    if (s.indexOf('·') >= 0) return s.split('·').slice(1).join('·').trim() || s;
    return s || currentTerritoryId();
  }

  function formatRankWithAffiliation(rankText) {
    var aff = affiliationShortLabel();
    if (!aff) return rankText;
    return rankText + ' · 소속 ' + aff;
  }

  function rankProgressHint(level, postLikes, commentLikes, followers, effectiveTier) {
    if (level < RANK_UNLOCK_LEVEL) return '';
    var qual = absoluteRankTierFromStats(level, postLikes, commentLikes, followers);
    var base = effectiveTier > 0 ? effectiveTier : qual;
    if (base >= MAX_RANK_TIER) return '';
    var nextTier = base < 2 ? 2 : base + 1;
    if (nextTier < 2 || nextTier > MAX_RANK_TIER) return '';
    var th = RANK_ABSOLUTE[nextTier];
    if (!th) return '';
    return (
      ' · 다음 ' +
      getRankTierRow(nextTier).shortKo +
      ' 글♥' +
      postLikes +
      '/' +
      th.postLikes +
      ' 댓♥' +
      commentLikes +
      '/' +
      th.commentLikes +
      ' 팔로워 ' +
      followers +
      '/' +
      th.followers
    );
  }

  function getDisplay(userId) {
    var st = getState(userId);
    var level = levelFromTotalXp(st.totalXp);
    var prog = xpProgressInLevel(level, st.totalXp);
    var rankUnlocked = level >= RANK_UNLOCK_LEVEL;
    var rankLabel;
    if (!rankUnlocked) {
      rankLabel = '명성 · 레벨 ' + RANK_UNLOCK_LEVEL + ' 달성 후 해금';
    } else if (st.rankTier === 1) {
      rankLabel =
        '시민' +
        rankProgressHint(level, st.receivedPostLikes, st.receivedCommentLikes, st.receivedFollowers, st.rankTier);
    } else if (st.rankTier >= 2) {
      rankLabel =
        getRankTierRow(st.rankTier).labelKo +
        rankProgressHint(level, st.receivedPostLikes, st.receivedCommentLikes, st.receivedFollowers, st.rankTier);
    } else {
      rankLabel =
        '시민' +
        rankProgressHint(level, st.receivedPostLikes, st.receivedCommentLikes, st.receivedFollowers, st.rankTier);
    }
    rankLabel = formatRankWithAffiliation(rankLabel);
    var rankShortOut = null;
    if (rankUnlocked) {
      if (st.rankTier >= 1) rankShortOut = getRankTierRow(st.rankTier).shortKo;
    } else {
      rankShortOut = '참여자';
    }
    var xpLegend = prog.isMaxLevel
      ? 'MAX · 누적 ' + st.totalXp.toLocaleString('ko-KR') + ' XP'
      : prog.current.toLocaleString('ko-KR') +
        ' / ' +
        prog.needed.toLocaleString('ko-KR') +
        ' XP (' +
        prog.pct +
        '%)';
    return {
      level: level,
      maxLevel: MAX_LEVEL,
      totalXp: st.totalXp,
      rankTier: st.rankTier,
      rankUnlocked: rankUnlocked,
      rankLabel: rankLabel,
      rankShort: rankShortOut,
      receivedPostLikes: st.receivedPostLikes,
      receivedCommentLikes: st.receivedCommentLikes,
      receivedFollowers: st.receivedFollowers,
      progress: prog,
      xpLegend: xpLegend,
      levelLabel: 'Lv. ' + level,
    };
  }

  function territoryLabelKo(tid) {
    var t = String(tid || 'COMMON').trim() || 'COMMON';
    return TERRITORY_LABELS[t] || t;
  }

  function rankTitleShort(row) {
    var level = levelFromTotalXp(row.totalXp);
    if (level < RANK_UNLOCK_LEVEL) return '레벨 ' + level;
    if (row.rankTier === 1) return '시민';
    if (row.rankTier >= 2) return getRankTierRow(row.rankTier).shortKo;
    return '참여자';
  }

  function loadAllStatesMap() {
    var map = loadMap();
    recomputeAllRanks(map);
    return map;
  }

  function buildSortedEntries(territoryFilter) {
    var map = loadAllStatesMap();
    var tidFilter = territoryFilter ? String(territoryFilter).trim() : '';
    var entries = [];
    Object.keys(map).forEach(function (userId) {
      var row = map[userId];
      if (!row) return;
      var tid = String(row.territoryId || 'COMMON').trim() || 'COMMON';
      if (tidFilter && tid !== tidFilter) return;
      entries.push({
        userId: userId,
        score: rankReputationScore(row),
        level: levelFromTotalXp(row.totalXp),
        rankTier: row.rankTier,
        rankTitle: rankTitleShort(row),
        territoryId: tid,
        territoryLabel: territoryLabelKo(tid),
        followers: normLikes(row.receivedFollowers),
        postLikes: normLikes(row.receivedPostLikes),
        commentLikes: normLikes(row.receivedCommentLikes),
      });
    });
    entries.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.userId).localeCompare(String(b.userId));
    });
    return entries;
  }

  function findPlacement(sortedEntries, userId) {
    var uid = String(userId || '').trim();
    for (var i = 0; i < sortedEntries.length; i++) {
      if (sortedEntries[i].userId === uid) {
        return {
          rank: i + 1,
          score: sortedEntries[i].score,
          total: sortedEntries.length,
          entry: sortedEntries[i],
        };
      }
    }
    return { rank: null, score: 0, total: sortedEntries.length, entry: null };
  }

  function getLeaderboard(territoryFilter) {
    var all = buildSortedEntries(territoryFilter);
    return {
      top: all.slice(0, LEADERBOARD_MAX),
      total: all.length,
      all: all,
    };
  }

  function getMyStandings(userId) {
    var uid = String(userId || '').trim() || 'guest';
    var globalAll = buildSortedEntries(null);
    var globalPlace = findPlacement(globalAll, uid);
    var row = globalPlace.entry;
    var tid = row ? row.territoryId : currentTerritoryId();
    var territoryAll = buildSortedEntries(tid);
    var territoryPlace = findPlacement(territoryAll, uid);
    return {
      userId: uid,
      score: globalPlace.score,
      globalRank: globalPlace.rank,
      globalTotal: globalPlace.total,
      territoryId: tid,
      territoryLabel: territoryLabelKo(tid),
      territoryRank: territoryPlace.rank,
      territoryTotal: territoryPlace.total,
      followers: row ? row.followers : normLikes(getState(uid).receivedFollowers),
    };
  }

  function formatStandingsLine(standings) {
    if (!standings) return '—';
    var g =
      standings.globalRank != null
        ? '전체 ' + standings.globalRank + '위 / ' + standings.globalTotal + '명'
        : '전체 집계 없음';
    var t =
      standings.territoryRank != null
        ? '소속(' + standings.territoryLabel + ') ' + standings.territoryRank + '위 / ' + standings.territoryTotal + '명'
        : '소속 집계 없음';
    return g + ' · ' + t + ' · 명성 ' + standings.score.toLocaleString('ko-KR');
  }

  function isGuestProgressionViewer(uid) {
    if (global.__scAuthUserId) return false;
    var cache = global.__scUserProfileCache;
    if (cache && cache.authUser && cache.authUser.id) return false;
    return true;
  }

  function paintGuestEmptyAvatarDock() {
    var elLevel = document.getElementById('avatar-meta-level');
    var elXpFill = document.getElementById('avatar-xpbar-fill');
    var elXpTrack = document.getElementById('avatar-xpbar-track');
    var elXpLegend = document.getElementById('avatar-xpbar-legend');
    var elXpRemain = document.getElementById('avatar-xpbar-remain');
    var elRank = document.getElementById('avatar-meta-rank');
    var elFollowers = document.getElementById('avatar-meta-followers');
    var elFollowing = document.getElementById('avatar-meta-following');
    if (elLevel) elLevel.textContent = '—';
    if (typeof global.__scSyncAvatarHeroSummary === 'function') {
      global.__scSyncAvatarHeroSummary('—', '');
    }
    if (elXpFill) elXpFill.style.width = '0%';
    if (elXpTrack) {
      elXpTrack.setAttribute('aria-valuenow', '0');
      elXpTrack.setAttribute('aria-label', '회원가입 후 시작');
    }
    if (elXpLegend) elXpLegend.textContent = '회원가입 후 시작';
    if (elXpRemain) elXpRemain.textContent = '';
    if (elRank) elRank.textContent = '명성 : —';
    if (elFollowers) elFollowers.textContent = '—';
    if (elFollowing) elFollowing.textContent = '—';
    if (global.__scPlayer) {
      global.__scPlayer.level = null;
      global.__scPlayer.totalXp = null;
      global.__scPlayer.rankTier = null;
      global.__scPlayer.reputationScore = null;
    }
  }

  function refreshAvatarDock() {
    var elLevel = document.getElementById('avatar-meta-level');
    var elXpFill = document.getElementById('avatar-xpbar-fill');
    var elXpTrack = document.getElementById('avatar-xpbar-track');
    var elXpLegend = document.getElementById('avatar-xpbar-legend');
    var elRank = document.getElementById('avatar-meta-rank');
    var elFollowers = document.getElementById('avatar-meta-followers');
    var elFollowing = document.getElementById('avatar-meta-following');
    if (!elLevel) return;

    var uid = (global.__scPlayer && global.__scPlayer.userId) || 'guest';
    var memberAuth =
      !!(global.__scAuthUserId && String(global.__scAuthUserId) === String(uid)) ||
      !!(
        global.__scUserProfileCache &&
        global.__scUserProfileCache.authUser &&
        global.__scUserProfileCache.authUser.id &&
        String(global.__scUserProfileCache.authUser.id) === String(uid)
      );
    if (!memberAuth || uid === 'guest' || uid === 'guest_demo' || isGuestProgressionViewer(uid)) {
      paintGuestEmptyAvatarDock();
      return;
    }

    setState(uid, { territoryId: currentTerritoryId() });
    var d = getDisplay(uid);
    var standings = getMyStandings(uid);

    /* 실회원 LEVEL/EXP: __scUserProfileCache(canonical) only — localStorage 무시 */
    if (memberAuth && uid !== 'guest' && uid !== 'guest_demo') {
      var cache = global.__scUserProfileCache || {};
      var cLevel =
        typeof cache.canonicalLevel === 'number'
          ? cache.canonicalLevel
          : typeof cache.level === 'number'
            ? cache.level
            : null;
      var cXp =
        typeof cache.canonicalXp === 'number'
          ? cache.canonicalXp
          : typeof cache.xp === 'number'
            ? cache.xp
            : null;
      var cPct =
        typeof cache.canonicalExpPercent === 'number'
          ? cache.canonicalExpPercent
          : typeof cache.expPercent === 'number'
            ? cache.expPercent
            : null;
      if (cLevel != null && isFinite(cLevel)) {
        d.level = Math.floor(cLevel);
        d.levelLabel = 'Lv. ' + d.level;
      }
      if (cXp != null && isFinite(cXp)) {
        d.totalXp = Math.max(0, Math.floor(cXp));
        d.progress = xpProgressInLevel(d.level, d.totalXp);
        if (cPct != null && isFinite(cPct)) {
          d.progress.pct = Math.max(0, Math.min(100, Math.round(cPct)));
        }
        d.xpLegend = d.progress.isMaxLevel
          ? 'MAX · 누적 ' + d.totalXp.toLocaleString('ko-KR') + ' XP'
          : d.progress.current.toLocaleString('ko-KR') +
            ' / ' +
            d.progress.needed.toLocaleString('ko-KR') +
            ' XP (' +
            d.progress.pct +
            '%)';
      } else if (cPct != null && isFinite(cPct)) {
        d.progress.pct = Math.max(0, Math.min(100, Math.round(cPct)));
      }
    }

    if (elLevel) elLevel.textContent = d.levelLabel;
    if (typeof global.__scSyncAvatarHeroSummary === 'function') {
      var elTerrHidden = document.getElementById('avatar-meta-territory');
      global.__scSyncAvatarHeroSummary(
        d.levelLabel,
        elTerrHidden ? elTerrHidden.textContent : '',
      );
    }
    if (elXpFill) elXpFill.style.width = d.progress.pct + '%';
    if (elXpTrack) {
      elXpTrack.setAttribute('aria-valuenow', String(d.progress.pct));
      elXpTrack.setAttribute('aria-label', '레벨 ' + d.level + ' 경험치 ' + d.progress.pct + '퍼센트');
    }
    if (elXpLegend) elXpLegend.textContent = d.xpLegend;
    if (elRank) elRank.textContent = '명성 : ' + (d.rankShort || '참여자');
    if (elFollowers) {
      elFollowers.textContent = standings.followers.toLocaleString('ko-KR');
    }
    if (elFollowing) {
      var fc = 0;
      if (global.FollowSystem && typeof global.FollowSystem.getFollowingCount === 'function') {
        fc = global.FollowSystem.getFollowingCount(uid);
      }
      elFollowing.textContent = String(fc);
    }

    if (global.__scPlayer) {
      global.__scPlayer.level = d.level;
      global.__scPlayer.totalXp = d.totalXp;
      global.__scPlayer.rankTier = d.rankTier;
      global.__scPlayer.rank = d.rankLabel;
      global.__scPlayer.rankUnlocked = d.rankUnlocked;
      global.__scPlayer.receivedPostLikes = d.receivedPostLikes;
      global.__scPlayer.receivedCommentLikes = d.receivedCommentLikes;
      global.__scPlayer.receivedFollowers = d.receivedFollowers;
      global.__scPlayer.globalRank = standings.globalRank;
      global.__scPlayer.territoryRank = standings.territoryRank;
      global.__scPlayer.reputationScore = standings.score;
    }
    if (typeof global.__scRefreshBoardView === 'function') {
      global.__scRefreshBoardView();
    }
  }

  function getPermissionsGuideData() {
    return {
      maxLevel: MAX_LEVEL,
      lurkUnlockLevel: LURK_UNLOCK_LEVEL,
      rankUnlockLevel: RANK_UNLOCK_LEVEL,
      xpRewards: Object.assign({}, XP_REWARDS),
      xpPerLevel: XP_PER_LEVEL.slice(),
      levelCumulativeXp: LEVEL_CUMULATIVE_XP.slice(),
      rankTiers: RANK_TIERS.map(function (r) {
        return { tier: r.tier, labelKo: r.labelKo, shortKo: r.shortKo };
      }),
      rankAbsolute: Object.assign({}, RANK_ABSOLUTE),
      rankCaps: Object.assign({}, RANK_CAPS),
      rankFollowerWeight: RANK_FOLLOWER_WEIGHT,
    };
  }

  /** 게시물·스레드당 반응으로 작가에게 들어가는 성향치·외계치 상한 (명성 등급 티어, 클라이언트) */
  var PER_POST_REACTION_CAP = [120, 200, 320, 480, 720];

  function getPerPostReactionCap(rankTier) {
    var t = Math.max(0, Math.min(4, Math.floor(Number(rankTier) || 0)));
    return PER_POST_REACTION_CAP[t] != null ? PER_POST_REACTION_CAP[t] : 120;
  }

  function getReactionCapsForUser(userId) {
    var st = getState(userId);
    var c = getPerPostReactionCap(st.rankTier || 0);
    return { align: c, planet: c };
  }

  global.PlayerProgression = {
    MAX_LEVEL: MAX_LEVEL,
    LURK_UNLOCK_LEVEL: LURK_UNLOCK_LEVEL,
    RANK_UNLOCK_LEVEL: RANK_UNLOCK_LEVEL,
    MAX_RANK_TIER: MAX_RANK_TIER,
    XP_REWARDS: XP_REWARDS,
    RANK_ABSOLUTE: RANK_ABSOLUTE,
    getPermissionsGuideData: getPermissionsGuideData,
    getReactionCapsForUser: getReactionCapsForUser,
    getState: getState,
    setState: setState,
    grantXp: grantXp,
    grantReceivedLike: grantReceivedLike,
    setFollowerCount: setFollowerCount,
    getDisplay: getDisplay,
    refreshAvatarDock: refreshAvatarDock,
    rankReputationScore: rankReputationScore,
    territoryLabelKo: territoryLabelKo,
    rankTitleShort: rankTitleShort,
    getLeaderboard: getLeaderboard,
    getMyStandings: getMyStandings,
    formatStandingsLine: formatStandingsLine,
    LEADERBOARD_MAX: LEADERBOARD_MAX,
    findPlacement: findPlacement,
    buildSortedEntries: buildSortedEntries,
    clearProgressForUsers: clearProgressForUsers,
  };

  global.__scRefreshProgressionUI = refreshAvatarDock;
  global.__scGrantProgressionXp = function (action) {
    var uid = (global.__scPlayer && global.__scPlayer.userId) || 'guest';
    if (isGuestProgressionViewer(uid)) return null;
    var P = global.PlayerProgression;
    if (!P) return null;
    var res = P.grantXp(uid, action);
    refreshAvatarDock();
    return res;
  };
  global.__scGrantReceivedLike = function (authorId, kind, delta) {
    var P = global.PlayerProgression;
    if (!P) return null;
    var res = P.grantReceivedLike(authorId, kind, delta);
    var me = (global.__scPlayer && global.__scPlayer.userId) || '';
    if (String(authorId) === String(me)) refreshAvatarDock();
    return res;
  };
  global.__scSetFollowerCount = function (userId, count) {
    var P = global.PlayerProgression;
    if (!P) return null;
    var res = P.setFollowerCount(userId, count);
    var me = (global.__scPlayer && global.__scPlayer.userId) || '';
    if (String(userId) === String(me)) refreshAvatarDock();
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshAvatarDock);
  } else {
    refreshAvatarDock();
  }
})(typeof window !== 'undefined' ? window : this);
