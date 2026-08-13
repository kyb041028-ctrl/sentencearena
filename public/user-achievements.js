/**
 * =============================================================================
 * 센텐스아레나 — 사용자 업적 (Guest Mock + 실회원 DB 영구 저장)
 * =============================================================================
 * - currentAchievements: 현재 보유 · 대표 선택 대상
 * - seasonHistory: 종료 시즌 기록 · 프로필 선택 불가
 * - featuredAchievementIds: 직접 체크한 대표 업적(최대 3 · 배열 순서 = 슬롯 순서)
 * - grantCurrentUserAchievement: CONFIRMED 지급 · 중복 방지 · 알림
 * - 실회원: /api/users/me/achievements hydrate · featured persist (browser self-grant 금지)
 * - Guest/demo: DEFAULT_USER_ACHIEVEMENT_MOCK 유지 (실회원에 Mock seed 금지)
 * - 실제 행동 기반 automatic earning은 아직 비활성 (서버 evaluator 연결 후)
 *
 * 이름·희귀도는 ACHIEVEMENT_DEFINITIONS에서 조회. 사용자 기록에 중복 저장하지 않음.
 * Mock seasonId('mock-season-1')는 시즌 UNSCHEDULED 상태의 테스트용 값.
 *
 * 개발용 __sc* 헬퍼는 배포 전 제거/비활성 대상.
 * =============================================================================
 */
(function (global) {
  'use strict';

  var FEATURED_MAX = 3;
  var MOCK_TEST_SEASON_ID = 'mock-season-1';

  var CONFIRMED_GRANT_IDS = Object.freeze([
    'first-post',
    'first-comment',
    'first-empathy-received',
    'territory-citizen',
    'steady-footsteps',
    'record-builder',
    'conversation-bridge',
    'empathy-from-many',
    'beta-citizen',
  ]);

  /**
   * Mock 아이콘 파일 id (레거시 PNG). 정의 id와 파일명이 다를 때만 사용.
   * 아이콘 이미지 자체는 변경하지 않음.
   */
  var MOCK_ACHIEVEMENT_ICON_IDS = Object.freeze({
    'first-post': 'achievement_first_post',
    'territory-citizen': 'achievement_lv5',
    'empathy-from-many': 'achievement_popular',
    'beta-citizen': 'achievement_first_post',
  });

  var DEFAULT_USER_ACHIEVEMENT_MOCK = Object.freeze({
    userId: 'currentUser',
    currentAchievements: Object.freeze([
      Object.freeze({
        achievementId: 'territory-citizen',
        acquiredAt: '2026-07-10T05:00:00.000Z',
        acquisitionSequence: 1,
        seasonId: null,
      }),
      Object.freeze({
        achievementId: 'empathy-from-many',
        acquiredAt: '2026-07-15T05:00:00.000Z',
        acquisitionSequence: 2,
        /* 시즌 시스템이 UNSCHEDULED인 동안의 테스트용 seasonId */
        seasonId: 'mock-season-1',
      }),
      Object.freeze({
        achievementId: 'beta-citizen',
        acquiredAt: '2026-07-20T05:00:00.000Z',
        acquisitionSequence: 3,
        seasonId: null,
      }),
    ]),
    seasonHistory: Object.freeze([]),
    featuredAchievementIds: Object.freeze([
      'territory-citizen',
      'empathy-from-many',
      'beta-citizen',
    ]),
  });

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createDefaultUserAchievementMock() {
    return deepClone(DEFAULT_USER_ACHIEVEMENT_MOCK);
  }

  function createEmptyUserAchievementState() {
    return {
      userId: '',
      currentAchievements: [],
      seasonHistory: [],
      featuredAchievementIds: [],
    };
  }

  /**
   * 데이터 source 분리:
   * - 실회원: 빈 canonical state (Mock seed 없음)
   * - Guest/demo: DEFAULT_USER_ACHIEVEMENT_MOCK
   * 모듈 로드 시점의 인증 여부와 무관하게 두 bucket을 분리한다.
   */
  var memberAchievementState = createEmptyUserAchievementState();
  var guestAchievementState = createDefaultUserAchievementMock();
  var memberHydratePromises = {};
  var memberHydratedUsers = {};
  var memberPersistInFlight = 0;
  var memberHydrateGeneration = 0;
  /** UI 세션 중복 방지 보조 — 영구 정본은 acquisitionNotifiedAt */
  var memberAlertBaseline = null;
  /** 이번 세션에서 중앙 알람 queue에 넣은 획득 key */
  var memberAlertQueued = Object.create(null);

  function trimId(value) {
    return String(value == null ? '' : value).trim();
  }

  function authFetchJson(url, options) {
    var opts = options || {};
    var method = opts.method || 'GET';
    var body = opts.body;
    function doFetch(token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      return global.fetch(url, {
        method: method,
        headers: headers,
        body:
          body == null
            ? undefined
            : typeof body === 'string'
              ? body
              : JSON.stringify(body),
        credentials: 'same-origin',
      }).then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      });
    }
    if (global.ScAuth && typeof global.ScAuth.getAccessToken === 'function') {
      return global.ScAuth.getAccessToken().then(doFetch);
    }
    return doFetch(null);
  }

  function achievementRecordKey(rec) {
    var id = trimId(rec && rec.achievementId);
    if (!id) return '';
    var season =
      rec && rec.seasonId != null && String(rec.seasonId).trim() !== ''
        ? String(rec.seasonId).trim()
        : '';
    return season ? id + '::' + season : id;
  }

  function snapshotAchievementKeys(list) {
    var map = Object.create(null);
    (list || []).forEach(function (rec) {
      var k = achievementRecordKey(rec);
      if (k) map[k] = Number(rec.acquisitionSequence) || 0;
    });
    return map;
  }

  function findNewlyAcquiredRecords(beforeMap, afterList) {
    var newly = [];
    (afterList || []).forEach(function (rec) {
      var k = achievementRecordKey(rec);
      if (k && !beforeMap[k]) newly.push(rec);
    });
    return newly;
  }

  function getAchievementDisplayName(def) {
    if (!def) return '';
    if (def.id === 'territory-citizen') return '당당한 영토시민!';
    return String(def.name || def.id || '');
  }

  function isAcquisitionUnnotified(rec) {
    if (!rec) return false;
    var v = rec.acquisitionNotifiedAt;
    return v == null || v === '';
  }

  function collectUnnotifiedAlertRecords(list) {
    var out = [];
    (list || []).forEach(function (rec) {
      var k = achievementRecordKey(rec);
      if (!k) return;
      if (!isAcquisitionUnnotified(rec)) return;
      if (memberAlertQueued[k]) return;
      out.push(rec);
    });
    out.sort(function (a, b) {
      return (Number(a.acquisitionSequence) || 0) - (Number(b.acquisitionSequence) || 0);
    });
    return out;
  }

  function markAchievementAcquisitionNotified(rec) {
    if (!isAuthenticatedMemberContext()) {
      return Promise.resolve({ ok: false, reason: 'NOT_MEMBER' });
    }
    var id = trimId(rec && rec.achievementId);
    var seq = Number(rec && rec.acquisitionSequence);
    if (!id || !seq || !isFinite(seq) || Math.floor(seq) !== seq) {
      return Promise.resolve({ ok: false, reason: 'INVALID_RECORD' });
    }
    return authFetchJson('/api/users/me/achievements/notified', {
      method: 'POST',
      body: {
        achievementId: id,
        acquisitionSequence: seq,
      },
    })
      .then(function (resp) {
        var data = resp.data;
        if (!data || data.ok !== true) {
          return {
            ok: false,
            error: (data && data.error) || 'NOTIFY_FAILED',
            status: resp.status,
          };
        }
        var ts =
          data.acquisitionNotifiedAt ||
          (data.data && data.data.acquisitionNotifiedAt) ||
          new Date().toISOString();
        var list = getActiveAchievementState().currentAchievements || [];
        var i;
        for (i = 0; i < list.length; i++) {
          if (
            trimId(list[i] && list[i].achievementId) === id &&
            Number(list[i].acquisitionSequence) === seq
          ) {
            list[i].acquisitionNotifiedAt = ts;
            break;
          }
        }
        return { ok: true, acquisitionNotifiedAt: ts };
      })
      .catch(function (e) {
        return { ok: false, error: 'NOTIFY_NETWORK', detail: String(e) };
      });
  }

  function notifyNewlyAcquiredAchievements(records, options) {
    var opts = options || {};
    if (!Array.isArray(records) || !records.length) return;
    var i;
    for (i = 0; i < records.length; i++) {
      var rec = records[i];
      var def = getAchievementDefinitionSafe(trimId(rec && rec.achievementId));
      if (!def) continue;
      if (opts.centeredAlert !== false && typeof global.enqueueAchievementAcquiredAlert === 'function') {
        var enqueueOpts = {};
        if (opts.markNotifiedOnShown === true && isAuthenticatedMemberContext()) {
          enqueueOpts.onShown = (function (record) {
            return function () {
              return markAchievementAcquisitionNotified(record);
            };
          })(rec);
        }
        global.enqueueAchievementAcquiredAlert(def, rec, enqueueOpts);
      }
      if (opts.bellNotification !== false) {
        notifyAchievementAcquired(def, rec);
      }
    }
  }

  function queueUnnotifiedAcquisitionAlerts(records) {
    var pending = collectUnnotifiedAlertRecords(records);
    var i;
    for (i = 0; i < pending.length; i++) {
      var k = achievementRecordKey(pending[i]);
      if (k) memberAlertQueued[k] = true;
    }
    notifyNewlyAcquiredAchievements(pending, { markNotifiedOnShown: true });
    return pending.length;
  }

  function resetMemberAlertBaseline() {
    memberAlertBaseline = null;
    memberAlertQueued = Object.create(null);
  }

  function applyCanonicalGrantedAchievements(grantedList) {
    if (!isAuthenticatedMemberContext()) return { shown: 0 };
    var records = [];
    (grantedList || []).forEach(function (item) {
      var rec = item && item.record ? item.record : item;
      if (rec && trimId(rec.achievementId)) records.push(rec);
    });
    if (!records.length) return { shown: 0 };
    if (memberAlertBaseline == null) {
      memberAlertBaseline = snapshotAchievementKeys(
        getActiveAchievementState().currentAchievements || []
      );
    }
    var newly = findNewlyAcquiredRecords(memberAlertBaseline, records);
    newly.forEach(function (rec) {
      if (findCurrentRecordIndex(rec.achievementId, rec.seasonId) === -1) {
        getActiveAchievementState().currentAchievements.push(deepClone(rec));
      }
    });
    sortCurrentAchievementsBySequence();
    memberAlertBaseline = snapshotAchievementKeys(
      getActiveAchievementState().currentAchievements || []
    );
    var shown = queueUnnotifiedAcquisitionAlerts(newly);
    refreshUserAchievementViews();
    return { shown: shown };
  }

  function applyServerAchievementBundle(bundle, userId) {
    if (!bundle || !isAuthenticatedMemberContext()) return;
    var uid = trimId(userId) || getAuthenticatedMemberId();
    if (uid) memberHydratedUsers[uid] = true;
    var state = bindMemberAchievementState(uid);
    var nextList = Array.isArray(bundle.currentAchievements)
      ? deepClone(bundle.currentAchievements)
      : [];
    state.currentAchievements = nextList;
    state.featuredAchievementIds = Array.isArray(bundle.featuredAchievementIds)
      ? bundle.featuredAchievementIds.slice(0, FEATURED_MAX)
      : [];
    state.seasonHistory = Array.isArray(bundle.seasonHistory)
      ? deepClone(bundle.seasonHistory)
      : [];
    sortCurrentAchievementsBySequence();
    memberAlertBaseline = snapshotAchievementKeys(nextList);
    queueUnnotifiedAcquisitionAlerts(nextList);
    refreshUserAchievementViews();
  }

  function hydrateCurrentUserAchievementsFromServer(force) {
    if (!isAuthenticatedMemberContext()) {
      return Promise.resolve({ ok: false, reason: 'NOT_MEMBER' });
    }
    var uid = getAuthenticatedMemberId();
    if (!uid) {
      var player = global.__scPlayer;
      uid = player && String(player.userId || '').trim();
    }
    if (!uid) return Promise.resolve({ ok: false, reason: 'NO_USER_ID' });
    if (!force && memberHydratePromises[uid]) return memberHydratePromises[uid];

    var gen = ++memberHydrateGeneration;
    var p = authFetchJson('/api/users/me/achievements', { method: 'GET' })
      .then(function (resp) {
        if (gen !== memberHydrateGeneration) {
          return { ok: false, reason: 'STALE_HYDRATE' };
        }
        if (memberPersistInFlight > 0) {
          return { ok: false, reason: 'PERSIST_IN_FLIGHT' };
        }
        var data = resp.data;
        if (!data || data.ok !== true || !data.data) {
          return {
            ok: false,
            error: (data && data.error) || 'HYDRATE_FAILED',
            status: resp.status,
          };
        }
        var nowId = getAuthenticatedMemberId() || uid;
        if (nowId !== uid) return { ok: false, reason: 'USER_SWITCHED' };
        applyServerAchievementBundle(data.data, uid);
        memberHydratedUsers[uid] = true;
        return { ok: true, data: data.data };
      })
      .catch(function (e) {
        delete memberHydratePromises[uid];
        return { ok: false, error: 'HYDRATE_NETWORK', detail: String(e) };
      });

    memberHydratePromises[uid] = p;
    return p;
  }

  function persistMemberFeatured(keys) {
    if (!isAuthenticatedMemberContext()) {
      return Promise.resolve({ ok: false, reason: 'SKIP' });
    }
    memberPersistInFlight += 1;
    memberHydrateGeneration += 1;
    return authFetchJson('/api/users/me/featured-achievements', {
      method: 'PUT',
      body: { keys: Array.isArray(keys) ? keys : [] },
    })
      .then(function (resp) {
        var data = resp.data;
        if (!data || data.ok !== true) {
          return {
            ok: false,
            error: (data && data.error) || 'FEATURED_PERSIST_FAILED',
            status: resp.status,
          };
        }
        if (data.data) applyServerAchievementBundle(data.data);
        else if (Array.isArray(data.featuredAchievementIds)) {
          getActiveAchievementState().featuredAchievementIds =
            data.featuredAchievementIds.slice(0, FEATURED_MAX);
          refreshUserAchievementViews();
        }
        return {
          ok: true,
          featuredAchievementIds: getCurrentUserFeaturedAchievementIds(),
        };
      })
      .catch(function (e) {
        return { ok: false, error: 'FEATURED_PERSIST_NETWORK', detail: String(e) };
      })
      .then(function (result) {
        memberPersistInFlight = Math.max(0, memberPersistInFlight - 1);
        return result;
      });
  }

  function getAuthenticatedMemberId() {
    var authId = String(global.__scAuthUserId || '').trim();
    if (authId && authId !== 'guest' && authId !== 'guest_demo') return authId;
    try {
      var cache = global.__scUserProfileCache;
      var cacheId = cache && cache.authUser && String(cache.authUser.id || '').trim();
      if (cacheId && cacheId !== 'guest' && cacheId !== 'guest_demo') return cacheId;
    } catch (_) {}
    return '';
  }

  function isGuestFlagSet() {
    try {
      return !!(global.sessionStorage && global.sessionStorage.getItem('sc_sb_guest_ok') === '1');
    } catch (_) {
      return false;
    }
  }

  function isAuthenticatedMemberContext() {
    if (getAuthenticatedMemberId()) return true;
    if (isGuestFlagSet()) return false;
    var player = global.__scPlayer;
    var uid = player && String(player.userId || '').trim();
    if (uid && uid !== 'guest' && uid !== 'guest_demo') return true;
    return false;
  }

  function bindMemberAchievementState(userId) {
    var uid = trimId(userId);
    if (uid && memberAchievementState.userId && memberAchievementState.userId !== uid) {
      var prev = memberAchievementState.userId;
      memberAchievementState = createEmptyUserAchievementState();
      delete memberHydratePromises[prev];
      delete memberHydratedUsers[prev];
      resetMemberAlertBaseline();
    }
    if (uid) memberAchievementState.userId = uid;
    return memberAchievementState;
  }

  function maybeScheduleMemberHydrate() {
    if (!isAuthenticatedMemberContext()) return;
    var uid = getAuthenticatedMemberId();
    if (!uid) {
      var player = global.__scPlayer;
      uid = player && String(player.userId || '').trim();
    }
    if (!uid) return;
    if (memberHydratedUsers[uid] || memberHydratePromises[uid]) return;
    hydrateCurrentUserAchievementsFromServer(false);
  }

  function getActiveAchievementState() {
    if (isAuthenticatedMemberContext()) {
      var uid = getAuthenticatedMemberId();
      if (!uid) {
        var player = global.__scPlayer;
        uid = player && String(player.userId || '').trim();
      }
      var state = bindMemberAchievementState(uid);
      maybeScheduleMemberHydrate();
      return state;
    }
    return guestAchievementState;
  }

  function parseAcquiredDate(acquiredAt) {
    if (acquiredAt == null || acquiredAt === '') return null;
    if (acquiredAt instanceof Date) {
      return isNaN(acquiredAt.getTime()) ? null : acquiredAt;
    }
    var d = new Date(acquiredAt);
    return isNaN(d.getTime()) ? null : d;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** 한국어 날짜: 2026. 7. 10. · 잘못된 값 → 획득일 미확인 */
  function formatAchievementAcquiredDate(acquiredAt) {
    var d = parseAcquiredDate(acquiredAt);
    if (!d) return '획득일 미확인';
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
  }

  /** title/툴팁용: 2026. 7. 10. 오후 2:00 */
  function formatAchievementAcquiredDateTitle(acquiredAt) {
    var d = parseAcquiredDate(acquiredAt);
    if (!d) return '획득일 미확인';
    var hours = d.getHours();
    var period = hours < 12 ? '오전' : '오후';
    var h12 = hours % 12;
    if (h12 === 0) h12 = 12;
    return (
      formatAchievementAcquiredDate(acquiredAt) +
      ' ' +
      period +
      ' ' +
      h12 +
      ':' +
      pad2(d.getMinutes())
    );
  }

  function getAchievementDefinitionSafe(achievementId) {
    if (typeof global.getAchievementDefinition === 'function') {
      return global.getAchievementDefinition(achievementId);
    }
    return null;
  }

  function getMockAchievementIconId(achievementId) {
    var id = trimId(achievementId);
    return MOCK_ACHIEVEMENT_ICON_IDS[id] || '';
  }

  function getCurrentUserAchievementData() {
    return deepClone(getActiveAchievementState());
  }

  function getCurrentUserAchievements() {
    return deepClone(getActiveAchievementState().currentAchievements || []);
  }

  function getCurrentUserSeasonHistory() {
    return deepClone(getActiveAchievementState().seasonHistory || []);
  }

  function getCurrentUserFeaturedAchievementIds() {
    return (getActiveAchievementState().featuredAchievementIds || []).slice();
  }

  function hasCurrentUserAchievement(achievementId) {
    var id = trimId(achievementId);
    if (!id) return false;
    var list = getActiveAchievementState().currentAchievements || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (trimId(list[i] && list[i].achievementId) === id) return true;
    }
    return false;
  }

  function isInSeasonHistory(achievementId) {
    var id = trimId(achievementId);
    if (!id) return false;
    var list = getActiveAchievementState().seasonHistory || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (trimId(list[i] && list[i].achievementId) === id) return true;
    }
    return false;
  }

  function getCurrentUserAchievement(achievementId) {
    var id = trimId(achievementId);
    if (!id) return null;
    var list = getActiveAchievementState().currentAchievements || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (trimId(list[i] && list[i].achievementId) === id) {
        return deepClone(list[i]);
      }
    }
    return null;
  }

  function findCurrentRecordIndex(achievementId, seasonId) {
    var id = trimId(achievementId);
    var list = getActiveAchievementState().currentAchievements || [];
    var wantSeason =
      seasonId == null || String(seasonId).trim() === ''
        ? null
        : String(seasonId).trim();
    var i;
    for (i = 0; i < list.length; i++) {
      var rec = list[i];
      if (!rec || trimId(rec.achievementId) !== id) continue;
      var recSeason =
        rec.seasonId == null || String(rec.seasonId).trim() === ''
          ? null
          : String(rec.seasonId).trim();
      if (wantSeason === null && recSeason === null) return i;
      if (wantSeason !== null && recSeason === wantSeason) return i;
    }
    return -1;
  }

  function nextAcquisitionSequence() {
    var list = getActiveAchievementState().currentAchievements || [];
    var hist = getActiveAchievementState().seasonHistory || [];
    var max = 0;
    var i;
    for (i = 0; i < list.length; i++) {
      var s = Number(list[i] && list[i].acquisitionSequence);
      if (isFinite(s) && s > max) max = s;
    }
    for (i = 0; i < hist.length; i++) {
      var hs = Number(hist[i] && hist[i].acquisitionSequence);
      if (isFinite(hs) && hs > max) max = hs;
    }
    return max + 1;
  }

  function sortCurrentAchievementsBySequence() {
    var list = getActiveAchievementState().currentAchievements || [];
    list.sort(function (a, b) {
      return (Number(a.acquisitionSequence) || 0) - (Number(b.acquisitionSequence) || 0);
    });
  }

  function hasActiveSeasonSafe(now) {
    return typeof global.hasActiveSeason === 'function' ? !!global.hasActiveSeason(now) : false;
  }

  function notifyAchievementAcquired(definition, record) {
    if (typeof global.addNotification !== 'function') return null;
    var name = definition && definition.name ? String(definition.name) : record.achievementId;
    try {
      return global.addNotification({
        type: 'ACHIEVEMENT_ACQUIRED',
        title: '업적을 획득했습니다',
        message: '‘' + name + '’ 업적을 획득했습니다.',
        linkTarget: {
          view: 'achievement',
          achievementId: record.achievementId,
          rarity: definition && definition.rarity ? definition.rarity : 'COMMON',
          acquiredAt: record.acquiredAt,
        },
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * CONFIRMED 업적 지급.
   * - Guest/demo: 로컬 Mock 즉시 반영
   * - 실회원: DB grant 성공 후 서버 canonical 값으로만 state 확정 (실패 시 미획득 유지)
   * 신규 지급 시에만 알림 · 대표 업적 자동 선택 없음.
   */
  function grantCurrentUserAchievement(achievementId, options) {
    var opts = options && typeof options === 'object' ? options : {};
    if (
      !getActiveAchievementState() ||
      !Array.isArray(getActiveAchievementState().currentAchievements) ||
      !Array.isArray(getActiveAchievementState().featuredAchievementIds) ||
      !Array.isArray(getActiveAchievementState().seasonHistory)
    ) {
      return { success: false, granted: false, reason: 'INVALID_USER_DATA' };
    }

    var id = trimId(achievementId);
    var def = getAchievementDefinitionSafe(id);
    if (!def) {
      return { success: false, granted: false, reason: 'UNKNOWN_ACHIEVEMENT' };
    }
    if (def.implementationStatus !== 'CONFIRMED') {
      return { success: false, granted: false, reason: 'NOT_CONFIRMED' };
    }

    var pType = def.persistenceType;
    var seasonId =
      opts.seasonId == null || String(opts.seasonId).trim() === ''
        ? null
        : String(opts.seasonId).trim();

    if (pType === 'PERMANENT_ONCE') {
      seasonId = null;
      if (hasCurrentUserAchievement(id)) {
        return {
          success: true,
          granted: false,
          reason: 'ALREADY_ACQUIRED',
          record: getCurrentUserAchievement(id),
          definition: def,
        };
      }
    } else if (pType === 'SEASON_REPEATABLE') {
      if (!seasonId) {
        if (!hasActiveSeasonSafe(opts.now)) {
          return { success: false, granted: false, reason: 'SEASON_NOT_AVAILABLE' };
        }
        return { success: false, granted: false, reason: 'SEASON_ID_REQUIRED' };
      }
      if (findCurrentRecordIndex(id, seasonId) !== -1) {
        var existingIdx = findCurrentRecordIndex(id, seasonId);
        return {
          success: true,
          granted: false,
          reason: 'ALREADY_ACQUIRED',
          record: deepClone(getActiveAchievementState().currentAchievements[existingIdx]),
          definition: def,
        };
      }
    } else if (pType === 'EVENT_PERMANENT') {
      return { success: false, granted: false, reason: 'NOT_CONFIRMED' };
    } else {
      return { success: false, granted: false, reason: 'NOT_CONFIRMED' };
    }

    /* 실회원: 브라우저 self-grant 금지 — hydrate로만 반영 (서버 evaluator 지급 후) */
    if (isAuthenticatedMemberContext()) {
      return {
        success: false,
        granted: false,
        reason: 'CLIENT_GRANT_FORBIDDEN',
        definition: def,
      };
    }

    /* Guest/demo: 로컬 Mock */
    var acquiredAt =
      opts.acquiredAt != null && opts.acquiredAt !== ''
        ? opts.acquiredAt
        : new Date().toISOString();
    if (acquiredAt instanceof Date) {
      acquiredAt = acquiredAt.toISOString();
    }
    acquiredAt = String(acquiredAt);
    if (!parseAcquiredDate(acquiredAt)) {
      return { success: false, granted: false, reason: 'INVALID_ACQUIRED_AT' };
    }

    if (pType === 'SEASON_REPEATABLE') {
      /*
       * 현재 시즌 기록만 current에 유지.
       * 시즌 종료 배치(히스토리 이동) 미구현이므로, 다른 seasonId 재획득 테스트 시
       * 동일 achievementId의 기존 current 기록은 제거만 한다(히스토리로 옮기지 않음).
       */
      var list = getActiveAchievementState().currentAchievements;
      var ri;
      for (ri = list.length - 1; ri >= 0; ri--) {
        if (trimId(list[ri] && list[ri].achievementId) === id) {
          list.splice(ri, 1);
        }
      }
    }

    var record = {
      achievementId: id,
      acquiredAt: acquiredAt,
      acquisitionSequence: nextAcquisitionSequence(),
      seasonId: seasonId,
    };
    getActiveAchievementState().currentAchievements.push(record);
    sortCurrentAchievementsBySequence();
    /* Guest Mock: bell만(선택) · 중앙 알람은 preview helper 전용 */
    refreshUserAchievementViews();
    return {
      success: true,
      granted: true,
      record: deepClone(record),
      definition: def,
    };
  }

  function getCurrentUserAchievementHistory() {
    var out = [];
    var current = getActiveAchievementState().currentAchievements || [];
    var history = getActiveAchievementState().seasonHistory || [];
    var i;

    function pushEntry(rec, historyType) {
      if (!rec) return;
      var hid = trimId(rec.achievementId);
      var def = getAchievementDefinitionSafe(hid);
      out.push({
        achievementId: hid,
        name: def && def.name ? String(def.name) : hid || '알 수 없는 업적',
        rarity: def && def.rarity ? String(def.rarity) : 'COMMON',
        category: def && def.category ? String(def.category).toUpperCase() : '',
        persistenceType: def && def.persistenceType ? String(def.persistenceType) : '',
        acquiredAt: rec.acquiredAt != null ? String(rec.acquiredAt) : '',
        acquisitionSequence: Number(rec.acquisitionSequence) || 0,
        seasonId: rec.seasonId == null ? null : String(rec.seasonId),
        historyType: historyType,
        canFeature: !!(def && def.canFeature === true),
        iconId: getMockAchievementIconId(hid),
      });
    }

    for (i = 0; i < current.length; i++) pushEntry(current[i], 'CURRENT');
    for (i = 0; i < history.length; i++) pushEntry(history[i], 'PAST_SEASON');

    out.sort(function (a, b) {
      var ta = parseAcquiredDate(a.acquiredAt);
      var tb = parseAcquiredDate(b.acquiredAt);
      var na = ta ? ta.getTime() : 0;
      var nb = tb ? tb.getTime() : 0;
      if (nb !== na) return nb - na;
      return (Number(b.acquisitionSequence) || 0) - (Number(a.acquisitionSequence) || 0);
    });
    return out;
  }

  function getFeaturedIndex(achievementId) {
    var id = trimId(achievementId);
    var featured = getActiveAchievementState().featuredAchievementIds || [];
    var i;
    for (i = 0; i < featured.length; i++) {
      if (trimId(featured[i]) === id) return i;
    }
    return -1;
  }

  function getCurrentUserAchievementDisplayList() {
    var list = getActiveAchievementState().currentAchievements || [];
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var rec = list[i] || {};
      var id = trimId(rec.achievementId);
      var def = getAchievementDefinitionSafe(id);
      out.push({
        achievementId: id,
        name: def && def.name ? String(def.name) : id || '알 수 없는 업적',
        description: def && def.description ? String(def.description) : '',
        rarity: def && def.rarity ? String(def.rarity) : 'COMMON',
        persistenceType: def && def.persistenceType ? String(def.persistenceType) : '',
        acquiredAt: rec.acquiredAt != null ? String(rec.acquiredAt) : '',
        acquisitionSequence: Number(rec.acquisitionSequence) || 0,
        seasonId: rec.seasonId == null ? null : String(rec.seasonId),
        canFeature: !!(def && def.canFeature === true),
        isFeatured: getFeaturedIndex(id) !== -1,
        iconId: getMockAchievementIconId(id),
        category: def && def.category ? String(def.category).toUpperCase() : '',
      });
    }
    out.sort(function (a, b) {
      return (a.acquisitionSequence || 0) - (b.acquisitionSequence || 0);
    });
    return out;
  }

  function getCurrentUserFeaturedAchievements() {
    var ids = getActiveAchievementState().featuredAchievementIds || [];
    var out = [];
    var i;
    for (i = 0; i < ids.length; i++) {
      var id = trimId(ids[i]);
      var rec = getCurrentUserAchievement(id);
      var def = getAchievementDefinitionSafe(id);
      if (!id || !rec || !def) {
        out.push({
          achievementId: id,
          missing: true,
          name: '',
          rarity: 'COMMON',
          acquiredAt: '',
          canFeature: false,
        });
        continue;
      }
      out.push({
        achievementId: id,
        missing: false,
        name: String(def.name || ''),
        description: String(def.description || ''),
        rarity: String(def.rarity || 'COMMON'),
        persistenceType: String(def.persistenceType || ''),
        acquiredAt: rec.acquiredAt != null ? String(rec.acquiredAt) : '',
        acquisitionSequence: Number(rec.acquisitionSequence) || 0,
        seasonId: rec.seasonId == null ? null : String(rec.seasonId),
        canFeature: def.canFeature === true,
        iconId: getMockAchievementIconId(id),
      });
    }
    return out;
  }

  /**
   * ProfileFrame achievements 슬롯용 엔트리.
   * featured 순서 유지 · 잘못된 id는 해당 슬롯만 빈 칸 · 자동 채움 없음.
   */
  function buildProfileAchievementsFromFeatured() {
    var ids = getActiveAchievementState().featuredAchievementIds || [];
    var slots = [];
    var i;
    for (i = 0; i < ids.length && i < FEATURED_MAX; i++) {
      var id = trimId(ids[i]);
      var rec = getCurrentUserAchievement(id);
      var def = getAchievementDefinitionSafe(id);
      if (!id || !rec || !def) {
        slots.push({
          id: '',
          title: '',
          date: '',
          dateTitle: '',
          rarity: 'COMMON',
          iconId: '',
        });
        continue;
      }
      slots.push({
        id: id,
        achievementId: id,
        title: getAchievementDisplayName(def),
        date: formatAchievementAcquiredDate(rec.acquiredAt),
        dateTitle: formatAchievementAcquiredDateTitle(rec.acquiredAt),
        rarity: String(def.rarity || 'COMMON'),
        iconId: getMockAchievementIconId(id),
      });
    }
    return slots;
  }

  function validateFeaturedAchievementSelection(achievementIds) {
    var errors = [];
    var ids = Array.isArray(achievementIds) ? achievementIds : null;
    if (!ids) {
      return {
        valid: false,
        errors: [{ code: 'not-array', message: 'featuredAchievementIds는 배열이어야 합니다.' }],
      };
    }
    if (ids.length > FEATURED_MAX) {
      errors.push({
        code: 'max-featured',
        message: '대표 업적은 최대 3개까지 선택할 수 있습니다.',
      });
    }
    var seen = {};
    var i;
    for (i = 0; i < ids.length; i++) {
      var id = trimId(ids[i]);
      if (!id) {
        errors.push({ code: 'empty-id', message: '빈 업적 id는 선택할 수 없습니다.' });
        continue;
      }
      if (seen[id]) {
        errors.push({
          code: 'duplicate-featured',
          message: '대표 업적을 중복 선택할 수 없습니다: ' + id,
        });
        continue;
      }
      seen[id] = true;
      if (!hasCurrentUserAchievement(id)) {
        if (isInSeasonHistory(id)) {
          errors.push({
            code: 'history-only',
            message: '시즌 히스토리 업적은 대표로 선택할 수 없습니다: ' + id,
          });
        } else {
          errors.push({
            code: 'not-owned',
            message: '현재 보유하지 않은 업적은 선택할 수 없습니다: ' + id,
          });
        }
        continue;
      }
      var def = getAchievementDefinitionSafe(id);
      if (!def) {
        errors.push({
          code: 'unknown-achievement',
          message: '존재하지 않는 업적입니다: ' + id,
        });
        continue;
      }
      if (def.canFeature !== true) {
        errors.push({
          code: 'cannot-feature',
          message: '대표로 선택할 수 없는 업적입니다: ' + id,
        });
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function setFeaturedAchievementIds(achievementIds) {
    var prev = (getActiveAchievementState().featuredAchievementIds || []).slice();
    var normalized = [];
    var seen = {};
    var i;
    var raw = Array.isArray(achievementIds) ? achievementIds : [];
    for (i = 0; i < raw.length; i++) {
      var id = trimId(raw[i]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      normalized.push(id);
    }
    var check = validateFeaturedAchievementSelection(normalized);
    if (!check.valid) {
      return {
        ok: false,
        message:
          (check.errors[0] && check.errors[0].message) ||
          '대표 업적은 최대 3개까지 선택할 수 있습니다.',
        featuredAchievementIds: prev,
        errors: check.errors,
      };
    }
    getActiveAchievementState().featuredAchievementIds = normalized.slice(0, FEATURED_MAX);
    refreshUserAchievementViews();
    var featuredOut = {
      ok: true,
      featuredAchievementIds: getCurrentUserFeaturedAchievementIds(),
    };
    if (isAuthenticatedMemberContext()) {
      featuredOut.persistPromise = persistMemberFeatured(featuredOut.featuredAchievementIds);
    }
    return featuredOut;
  }

  function toggleFeaturedAchievement(achievementId) {
    var id = trimId(achievementId);
    var prev = (getActiveAchievementState().featuredAchievementIds || []).slice();
    var idx = getFeaturedIndex(id);
    if (idx !== -1) {
      prev.splice(idx, 1);
      getActiveAchievementState().featuredAchievementIds = prev;
      refreshUserAchievementViews();
      var toggledOff = {
        ok: true,
        featuredAchievementIds: getCurrentUserFeaturedAchievementIds(),
      };
      if (isAuthenticatedMemberContext()) {
        toggledOff.persistPromise = persistMemberFeatured(toggledOff.featuredAchievementIds);
      }
      return toggledOff;
    }

    if (!hasCurrentUserAchievement(id)) {
      if (isInSeasonHistory(id)) {
        return {
          ok: false,
          message: '시즌 히스토리 업적은 대표로 선택할 수 없습니다: ' + id,
          featuredAchievementIds: prev,
        };
      }
      return {
        ok: false,
        message: '현재 보유하지 않은 업적은 선택할 수 없습니다: ' + id,
        featuredAchievementIds: prev,
      };
    }

    var def = getAchievementDefinitionSafe(id);
    if (!def) {
      return {
        ok: false,
        message: '존재하지 않는 업적입니다: ' + id,
        featuredAchievementIds: prev,
      };
    }
    if (def.canFeature !== true) {
      return {
        ok: false,
        message: '대표로 선택할 수 없는 업적입니다: ' + id,
        featuredAchievementIds: prev,
      };
    }

    if (prev.length >= FEATURED_MAX) {
      return {
        ok: false,
        message: '대표 업적은 최대 3개까지 선택할 수 있습니다.',
        featuredAchievementIds: prev,
      };
    }

    var next = prev.concat([id]);
    var check = validateFeaturedAchievementSelection(next);
    if (!check.valid) {
      return {
        ok: false,
        message:
          (check.errors[0] && check.errors[0].message) ||
          '대표 업적은 최대 3개까지 선택할 수 있습니다.',
        featuredAchievementIds: prev,
        errors: check.errors,
      };
    }
    getActiveAchievementState().featuredAchievementIds = next;
    refreshUserAchievementViews();
    var toggledOn = {
      ok: true,
      featuredAchievementIds: getCurrentUserFeaturedAchievementIds(),
    };
    if (isAuthenticatedMemberContext()) {
      toggledOn.persistPromise = persistMemberFeatured(toggledOn.featuredAchievementIds);
    }
    return toggledOn;
  }

  function clearFeaturedAchievements() {
    getActiveAchievementState().featuredAchievementIds = [];
    refreshUserAchievementViews();
    var cleared = { ok: true, featuredAchievementIds: [] };
    if (isAuthenticatedMemberContext()) {
      cleared.persistPromise = persistMemberFeatured([]);
    }
    return cleared;
  }

  /**
   * 현재 보유하지 않거나 canFeature=false인 대표 업적 제거.
   * 남은 순서 유지 · 빈 슬롯 자동 대체 없음.
   * 시즌 종료 배치와는 아직 연결하지 않음 (개발 테스트용).
   */
  function removeUnavailableFeaturedAchievements() {
    var featured = getActiveAchievementState().featuredAchievementIds || [];
    var kept = [];
    var i;
    for (i = 0; i < featured.length; i++) {
      var id = trimId(featured[i]);
      if (!id) continue;
      if (!hasCurrentUserAchievement(id)) continue;
      var def = getAchievementDefinitionSafe(id);
      if (!def || def.canFeature !== true) continue;
      kept.push(id);
    }
    getActiveAchievementState().featuredAchievementIds = kept;
    refreshUserAchievementViews();
    return getCurrentUserFeaturedAchievementIds();
  }

  function isValidIsoLikeDate(value) {
    return !!parseAcquiredDate(value);
  }

  function validateCurrentUserAchievementData() {
    var data = getActiveAchievementState();
    var errors = [];
    var warnings = [];

    if (!Array.isArray(data.currentAchievements)) {
      errors.push({ code: 'current-not-array', message: 'currentAchievements는 배열이어야 합니다.' });
    }
    if (!Array.isArray(data.seasonHistory)) {
      errors.push({ code: 'history-not-array', message: 'seasonHistory는 배열이어야 합니다.' });
    }
    if (!Array.isArray(data.featuredAchievementIds)) {
      errors.push({
        code: 'featured-not-array',
        message: 'featuredAchievementIds는 배열이어야 합니다.',
      });
    }

    var permanentSeen = {};
    var seasonPairSeen = {};
    var seqSeen = {};
    var current = Array.isArray(data.currentAchievements) ? data.currentAchievements : [];
    var hi;
    for (hi = 0; hi < current.length; hi++) {
      var rec = current[hi] || {};
      var aid = trimId(rec.achievementId);
      if (!aid) {
        errors.push({ code: 'empty-achievementId', message: 'achievementId가 비어 있습니다.' });
        continue;
      }
      if (
        rec.acquiredAt == null ||
        rec.acquisitionSequence == null ||
        !Object.prototype.hasOwnProperty.call(rec, 'seasonId')
      ) {
        errors.push({
          code: 'invalid-record-shape',
          message: '기록 형식 오류(achievementId/acquiredAt/acquisitionSequence/seasonId): ' + aid,
        });
      }

      var seq = Number(rec.acquisitionSequence);
      if (!isFinite(seq) || seq < 1 || Math.floor(seq) !== seq) {
        errors.push({
          code: 'invalid-sequence',
          message: 'acquisitionSequence 무효: ' + aid,
        });
      } else if (seqSeen[seq]) {
        errors.push({
          code: 'duplicate-sequence',
          message: 'acquisitionSequence 중복: ' + seq,
        });
      } else {
        seqSeen[seq] = true;
      }

      if (!isValidIsoLikeDate(rec.acquiredAt)) {
        errors.push({
          code: 'invalid-acquiredAt',
          message: 'acquiredAt 무효: ' + aid,
        });
      }

      var def = getAchievementDefinitionSafe(aid);
      if (!def) {
        errors.push({
          code: 'unknown-achievement',
          message: '존재하지 않는 업적 id: ' + aid,
        });
        continue;
      }

      if (def.implementationStatus !== 'CONFIRMED') {
        warnings.push({
          code: 'non-confirmed-owned',
          id: aid,
          message:
            'CONFIRMED가 아닌 업적이 현재 보유에 있습니다: ' +
            aid +
            ' (' +
            def.implementationStatus +
            ')',
        });
      }

      var pType = def.persistenceType;
      var sid =
        rec.seasonId == null || String(rec.seasonId).trim() === ''
          ? null
          : String(rec.seasonId).trim();

      if (pType === 'PERMANENT_ONCE' || pType === 'EVENT_PERMANENT') {
        if (sid != null) {
          errors.push({
            code: 'permanent-seasonId',
            message: '영구 업적의 seasonId는 null이어야 합니다: ' + aid,
          });
        }
        if (permanentSeen[aid]) {
          errors.push({
            code: 'duplicate-permanent',
            message: 'PERMANENT_ONCE/EVENT 중복: ' + aid,
          });
        }
        permanentSeen[aid] = true;
      } else if (pType === 'SEASON_REPEATABLE') {
        if (!sid) {
          errors.push({
            code: 'season-without-seasonId',
            message: 'SEASON_REPEATABLE에 seasonId가 필요합니다: ' + aid,
          });
        } else {
          var pairKey = aid + '::' + sid;
          if (seasonPairSeen[pairKey]) {
            errors.push({
              code: 'duplicate-season-pair',
              message: '같은 시즌 업적 중복: ' + aid + ' / ' + sid,
            });
          }
          seasonPairSeen[pairKey] = true;
          if (
            typeof global.isSeasonSystemScheduled === 'function' &&
            !global.isSeasonSystemScheduled()
          ) {
            warnings.push({
              code: 'mock-season-id',
              id: aid,
              message:
                '시즌 미정(UNSCHEDULED) 상태의 테스트용 seasonId입니다: ' + sid,
            });
          }
        }
      }
    }

    var featured = Array.isArray(data.featuredAchievementIds)
      ? data.featuredAchievementIds
      : [];
    if (featured.length > FEATURED_MAX) {
      errors.push({
        code: 'featured-max',
        message: 'featuredAchievementIds는 최대 3개입니다.',
      });
    }
    var featSeen = {};
    var fi;
    for (fi = 0; fi < featured.length; fi++) {
      var fid = trimId(featured[fi]);
      if (!fid) {
        errors.push({ code: 'featured-empty', message: '빈 대표 업적 id' });
        continue;
      }
      if (featSeen[fid]) {
        errors.push({
          code: 'featured-duplicate',
          message: '대표 업적 중복: ' + fid,
        });
      }
      featSeen[fid] = true;
      if (!hasCurrentUserAchievement(fid)) {
        if (isInSeasonHistory(fid)) {
          errors.push({
            code: 'featured-from-history',
            message: '시즌 히스토리 업적이 대표에 포함됨: ' + fid,
          });
        } else {
          errors.push({
            code: 'featured-not-owned',
            message: '현재 보유하지 않은 대표 업적: ' + fid,
          });
        }
      } else {
        var fdef = getAchievementDefinitionSafe(fid);
        if (fdef && fdef.canFeature !== true) {
          errors.push({
            code: 'featured-cannot-feature',
            message: 'canFeature=false 업적이 대표에 포함됨: ' + fid,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings,
    };
  }

  function showFeaturedLimitNotice(message) {
    var text =
      message || '대표 업적은 최대 3개까지 선택할 수 있습니다.';
    var el = document.getElementById('sc-soft-notice');
    if (el) {
      el.textContent = text;
      el.hidden = false;
      setTimeout(function () {
        el.hidden = true;
      }, 2800);
      return;
    }
    if (typeof global.showScShareToast === 'function') {
      global.showScShareToast(text);
    }
  }

  function syncProfileDataAchievements() {
    var slots = buildProfileAchievementsFromFeatured();
    if (global.SC_PROFILE_DATA && typeof global.SC_PROFILE_DATA === 'object') {
      global.SC_PROFILE_DATA.achievements = slots;
    }
    return slots;
  }

  function refreshUserAchievementViews() {
    syncProfileDataAchievements();
    try {
      if (typeof global.renderProfileAchievements === 'function') {
        var dockData =
          typeof global.getCurrentProfileData === 'function'
            ? global.getCurrentProfileData()
            : global.SC_PROFILE_DATA;
        global.renderProfileAchievements(dockData || { achievements: buildProfileAchievementsFromFeatured() });
      }
    } catch (_) {}

    try {
      if (
        typeof global.isProfileFrameExpanded === 'function' &&
        global.isProfileFrameExpanded() &&
        typeof global.renderProfileData === 'function'
      ) {
        var data =
          typeof global.getCurrentProfileData === 'function'
            ? global.getCurrentProfileData()
            : global.SC_PROFILE_DATA;
        if (data) global.renderProfileData(data);
      }
    } catch (_) {}

    try {
      var mount = document.getElementById('sc-profile-modal-frame-mount');
      var frame = mount && !mount.hidden ? mount.querySelector('.profile-frame') : null;
      if (frame && typeof global.renderProfileData === 'function') {
        var modalData =
          typeof global.getCurrentProfileData === 'function'
            ? global.getCurrentProfileData()
            : global.SC_PROFILE_DATA;
        if (modalData) global.renderProfileData(modalData, { frameRoot: frame });
      }
    } catch (_) {}

    renderFeaturedAchievementPanelIfOpen();
  }

  /* ─── 대표 업적 선택 패널 UI ─── */

  var HISTORY_PAGE_SIZE = 5;
  var historyUiState = {
    activeCategory: 'ALL',
    page: 1,
    pageSize: HISTORY_PAGE_SIZE,
  };
  /** 모달 임시 선택 — 선택 완료 전까지 실제 featured에 반영하지 않음 */
  var featuredDraftKeys = [];

  function cloneFeaturedDraftKeys(ids) {
    var raw = Array.isArray(ids) ? ids : [];
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < raw.length && out.length < FEATURED_MAX; i++) {
      var id = trimId(raw[i]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  function getFeaturedDraftKeys() {
    return featuredDraftKeys.slice();
  }

  function isInFeaturedDraft(achievementId) {
    var id = trimId(achievementId);
    return id ? featuredDraftKeys.indexOf(id) !== -1 : false;
  }

  function canSelectFeaturedFromHistoryItem(item) {
    if (!item) return false;
    if (item.historyType === 'PAST_SEASON') return false;
    var id = trimId(item.achievementId);
    if (!id) return false;
    if (!hasCurrentUserAchievement(id)) return false;
    return item.canFeature === true;
  }

  function toggleFeaturedDraftKey(achievementId) {
    var id = trimId(achievementId);
    if (!id) {
      return { ok: false, message: '빈 업적 id는 선택할 수 없습니다.', keys: getFeaturedDraftKeys() };
    }
    var idx = featuredDraftKeys.indexOf(id);
    if (idx !== -1) {
      featuredDraftKeys.splice(idx, 1);
      return { ok: true, keys: getFeaturedDraftKeys() };
    }
    if (!hasCurrentUserAchievement(id)) {
      if (isInSeasonHistory(id)) {
        return {
          ok: false,
          message: '시즌 히스토리 업적은 대표로 선택할 수 없습니다: ' + id,
          keys: getFeaturedDraftKeys(),
        };
      }
      return {
        ok: false,
        message: '현재 보유하지 않은 업적은 선택할 수 없습니다: ' + id,
        keys: getFeaturedDraftKeys(),
      };
    }
    var def = getAchievementDefinitionSafe(id);
    if (!def) {
      return { ok: false, message: '존재하지 않는 업적입니다: ' + id, keys: getFeaturedDraftKeys() };
    }
    if (def.canFeature !== true) {
      return {
        ok: false,
        message: '대표로 선택할 수 없는 업적입니다: ' + id,
        keys: getFeaturedDraftKeys(),
      };
    }
    if (featuredDraftKeys.length >= FEATURED_MAX) {
      return {
        ok: false,
        message: '대표 업적은 최대 3개까지 선택할 수 있습니다.',
        keys: getFeaturedDraftKeys(),
      };
    }
    featuredDraftKeys.push(id);
    return { ok: true, keys: getFeaturedDraftKeys() };
  }

  function confirmFeaturedDraftSelection() {
    return setFeaturedAchievementIds(featuredDraftKeys.slice());
  }

  function normalizeAchievementCategory(value) {
    var key = String(value || '').trim().toUpperCase();
    if (!key) return 'UNCATEGORIZED';
    var map = global.ACHIEVEMENT_CATEGORIES || null;
    if (map && Object.prototype.hasOwnProperty.call(map, key)) return key;
    var keys = global.ACHIEVEMENT_CATEGORY_KEYS;
    if (Array.isArray(keys) && keys.indexOf(key) !== -1) return key;
    return 'UNCATEGORIZED';
  }

  function getAchievementCategoryLabel(categoryKey) {
    var raw = String(categoryKey || '').trim().toUpperCase();
    if (raw === 'ALL') return '전체';
    var key = normalizeAchievementCategory(categoryKey);
    if (key === 'UNCATEGORIZED') return '미분류';
    var map = global.ACHIEVEMENT_CATEGORIES || {};
    if (map[key]) return String(map[key]);
    return key;
  }

  function listAvailableAchievementHistoryCategories(history) {
    return collectHistoryCategoryTabs(history);
  }

  function filterAcquisitionHistoryByCategory(history, categoryKey) {
    var list = Array.isArray(history) ? history : [];
    var key = String(categoryKey || 'ALL').toUpperCase();
    if (key === 'ALL') return list.slice();
    return list.filter(function (item) {
      return normalizeAchievementCategory(item && item.category) === key;
    });
  }

  function paginateAcquisitionHistory(items, page, pageSize) {
    var list = Array.isArray(items) ? items : [];
    var size = Math.max(1, Math.floor(Number(pageSize) || HISTORY_PAGE_SIZE));
    var totalItems = list.length;
    var totalPages = totalItems === 0 ? 0 : Math.max(1, Math.ceil(totalItems / size) || 1);
    var p = Math.floor(Number(page) || 1);
    if (!isFinite(p) || p < 1) p = 1;
    if (totalPages > 0 && p > totalPages) p = totalPages;
    var start = (p - 1) * size;
    return {
      page: totalPages === 0 ? 1 : p,
      pageSize: size,
      totalItems: totalItems,
      totalPages: totalPages,
      items: totalItems === 0 ? [] : list.slice(start, start + size),
    };
  }

  function buildAchievementHistoryPaginationState(options) {
    var opts = options || {};
    var history = Array.isArray(opts.history) ? opts.history : [];
    var category = String(opts.activeCategory || 'ALL').toUpperCase() || 'ALL';
    var filtered = filterAcquisitionHistoryByCategory(history, category);
    var pageState = paginateAcquisitionHistory(filtered, opts.page || 1, opts.pageSize || HISTORY_PAGE_SIZE);
    return {
      activeCategory: category,
      categories: collectHistoryCategoryTabs(history),
      page: pageState.page,
      pageSize: pageState.pageSize,
      totalItems: pageState.totalItems,
      totalPages: pageState.totalPages,
      items: pageState.items,
      internalScrollbar: false,
    };
  }

  function collectHistoryCategoryTabs(history) {
    var list = Array.isArray(history) ? history : [];
    var seen = {};
    var cats = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var key = normalizeAchievementCategory(list[i] && list[i].category);
      if (seen[key]) continue;
      seen[key] = true;
      cats.push(key);
    }
    var order = Array.isArray(global.ACHIEVEMENT_CATEGORY_KEYS)
      ? global.ACHIEVEMENT_CATEGORY_KEYS.slice()
      : ['GROWTH', 'ACTIVITY', 'INTERACTION', 'TERRITORY', 'SEASON', 'SPECIAL'];
    cats.sort(function (a, b) {
      if (a === 'UNCATEGORIZED') return 1;
      if (b === 'UNCATEGORIZED') return -1;
      var ia = order.indexOf(a);
      var ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return ['ALL'].concat(cats);
  }

  function ensureFeaturedPanel() {
    var existing = document.getElementById('sc-featured-achievement-panel');
    if (existing && !existing.querySelector('#sc-featured-preview')) {
      existing.parentNode && existing.parentNode.removeChild(existing);
      existing = null;
    }
    if (existing) return existing;
    var panel = document.createElement('div');
    panel.id = 'sc-featured-achievement-panel';
    panel.className = 'sc-featured-achievement-panel';
    panel.setAttribute('data-sc-profile-interaction-surface', '1');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<div class="sc-featured-achievement-panel__backdrop" data-sc-featured-close="1"></div>' +
      '<div class="sc-featured-achievement-panel__dialog sc-panel" role="dialog" aria-modal="true" aria-labelledby="sc-featured-achievement-title">' +
      '  <header class="sc-featured-achievement-panel__head">' +
      '    <h2 id="sc-featured-achievement-title" class="sc-section-title">대표 업적 선택</h2>' +
      '    <p class="sc-featured-achievement-panel__hint">아래 획득 기록에서 업적을 선택하세요. 최대 3개까지 가능합니다.</p>' +
      '    <p class="sc-featured-achievement-panel__count" id="sc-featured-achievement-count">0/3</p>' +
      '  </header>' +
      '  <div class="sc-featured-achievement-panel__body">' +
      '    <div class="sc-featured-preview" id="sc-featured-preview" role="list" aria-label="선택된 대표 업적 미리보기"></div>' +
      '    <section class="sc-featured-achievement-panel__history" aria-labelledby="sc-achievement-history-title">' +
      '      <h3 id="sc-achievement-history-title" class="sc-featured-achievement-panel__history-title">획득 기록</h3>' +
      '      <div class="sc-featured-achievement-panel__history-tabs" id="sc-achievement-history-tabs" role="tablist" aria-label="업적 분류"></div>' +
      '      <div class="sc-featured-achievement-panel__history-list" id="sc-achievement-history-list"></div>' +
      '      <nav class="board-pagination sc-featured-achievement-panel__history-pager" id="sc-achievement-history-pagination" hidden aria-label="획득 기록 페이지"></nav>' +
      '    </section>' +
      '  </div>' +
      '  <footer class="sc-featured-achievement-panel__foot">' +
      '    <button type="button" class="sc-btn sc-btn--primary" id="sc-featured-achievement-done">선택 완료</button>' +
      '    <button type="button" class="sc-btn sc-btn--ghost" data-sc-featured-close="1">닫기</button>' +
      '  </footer>' +
      '</div>';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-sc-featured-close') === '1') {
        closeFeaturedAchievementPanel();
      }
    });
    var doneBtn = panel.querySelector('#sc-featured-achievement-done');
    if (doneBtn) {
      doneBtn.addEventListener('click', function () {
        var result = confirmFeaturedDraftSelection();
        if (!result.ok) {
          showFeaturedLimitNotice(
            result.message || '대표 업적은 최대 3개까지 선택할 수 있습니다.'
          );
          return;
        }
        closeFeaturedAchievementPanel();
      });
    }
    var tabsEl = panel.querySelector('#sc-achievement-history-tabs');
    if (tabsEl && tabsEl.dataset.scBound !== '1') {
      tabsEl.dataset.scBound = '1';
      tabsEl.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-history-category]') : null;
        if (!btn) return;
        var cat = String(btn.getAttribute('data-history-category') || 'ALL').toUpperCase();
        if (historyUiState.activeCategory === cat) return;
        historyUiState.activeCategory = cat;
        historyUiState.page = 1;
        renderAchievementHistorySection(panel);
      });
    }
    return panel;
  }

  function rarityFrameSrc(rarity) {
    if (typeof global.getAchievementRarityFrame === 'function') {
      return global.getAchievementRarityFrame(rarity) || '';
    }
    return '';
  }

  function appendAchievementIcon(parent, item, iconClass) {
    var iconWrap = document.createElement('span');
    iconWrap.className = iconClass || 'sc-featured-preview__icon';
    iconWrap.setAttribute('data-rarity', (item && item.rarity) || 'COMMON');
    var iconImg = document.createElement('img');
    iconImg.className = iconClass
      ? iconClass.replace(/__icon$/, '__icon-img')
      : 'sc-featured-preview__icon-img';
    if (iconClass && iconClass.indexOf('history') !== -1) {
      iconImg.className = 'sc-achievement-history-row__icon-img';
    }
    iconImg.alt = '';
    iconImg.decoding = 'async';
    var iconId = (item && item.iconId) || getMockAchievementIconId(item && item.achievementId);
    iconImg.src = iconId
      ? '/assets/achievements/' + iconId + '.png'
      : '/assets/achievements/achievement_empty.png';
    var frameImg = document.createElement('img');
    frameImg.className =
      iconClass && iconClass.indexOf('history') !== -1
        ? 'sc-achievement-history-row__rarity-frame'
        : 'sc-featured-preview__rarity-frame';
    frameImg.alt = '';
    frameImg.setAttribute('aria-hidden', 'true');
    var frameSrc = rarityFrameSrc(item && item.rarity);
    if (frameSrc) {
      frameImg.src = frameSrc;
    } else {
      frameImg.hidden = true;
    }
    iconWrap.appendChild(iconImg);
    iconWrap.appendChild(frameImg);
    parent.appendChild(iconWrap);
    return iconWrap;
  }

  function renderFeaturedAchievementPanelIfOpen() {
    var panel = document.getElementById('sc-featured-achievement-panel');
    if (!panel || panel.hidden) return;
    renderFeaturedAchievementPanel();
  }

  function renderHistoryPagination(nav, slice) {
    if (!nav) return;
    nav.textContent = '';
    if (!slice || !slice.totalPages || slice.totalPages <= 1) {
      nav.hidden = true;
      return;
    }
    nav.hidden = false;

    function go(page) {
      historyUiState.page = page;
      var panel = document.getElementById('sc-featured-achievement-panel');
      if (panel) renderAchievementHistorySection(panel);
    }

    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'board-pagination__btn';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', '이전 페이지');
    prev.disabled = slice.page <= 1;
    prev.addEventListener('click', function () {
      go(Math.max(1, slice.page - 1));
    });
    nav.appendChild(prev);

    var start = Math.max(1, slice.page - 3);
    var end = Math.min(slice.totalPages, start + 6);
    start = Math.max(1, end - 6);
    var n;
    for (n = start; n <= end; n++) {
      (function (pageNum) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'board-pagination__btn' + (pageNum === slice.page ? ' is-active' : '');
        b.textContent = String(pageNum);
        if (pageNum === slice.page) b.setAttribute('aria-current', 'page');
        b.addEventListener('click', function () {
          go(pageNum);
        });
        nav.appendChild(b);
      })(n);
    }

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'board-pagination__btn';
    next.textContent = '›';
    next.setAttribute('aria-label', '다음 페이지');
    next.disabled = slice.page >= slice.totalPages;
    next.addEventListener('click', function () {
      go(Math.min(slice.totalPages, slice.page + 1));
    });
    nav.appendChild(next);
  }

  function renderHistoryCategoryTabs(tabsEl, categories, activeCategory) {
    if (!tabsEl) return;
    tabsEl.textContent = '';
    var i;
    for (i = 0; i < categories.length; i++) {
      (function (cat) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'sc-featured-achievement-panel__history-tab' +
          (cat === activeCategory ? ' is-active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', cat === activeCategory ? 'true' : 'false');
        btn.setAttribute('data-history-category', cat);
        btn.textContent = getAchievementCategoryLabel(cat);
        tabsEl.appendChild(btn);
      })(categories[i]);
    }
  }

  function resolveDraftPreviewItem(achievementId) {
    var id = trimId(achievementId);
    var rec = getCurrentUserAchievement(id);
    var def = getAchievementDefinitionSafe(id);
    if (!id || !rec || !def) {
      return {
        achievementId: id,
        name: id || '알 수 없는 업적',
        rarity: 'COMMON',
        iconId: getMockAchievementIconId(id),
        missing: true,
      };
    }
    return {
      achievementId: id,
      name: String(def.name || id),
      rarity: String(def.rarity || 'COMMON'),
      iconId: getMockAchievementIconId(id),
      acquiredAt: rec.acquiredAt != null ? String(rec.acquiredAt) : '',
      missing: false,
    };
  }

  function renderFeaturedPreview(panel) {
    var previewEl = panel.querySelector('#sc-featured-preview');
    var countEl = panel.querySelector('#sc-featured-achievement-count');
    if (countEl) countEl.textContent = featuredDraftKeys.length + '/' + FEATURED_MAX;
    if (!previewEl) return;
    previewEl.textContent = '';
    var i;
    for (i = 0; i < FEATURED_MAX; i++) {
      var slot = document.createElement('div');
      slot.className = 'sc-featured-preview__slot';
      slot.setAttribute('role', 'listitem');
      var key = featuredDraftKeys[i];
      if (!key) {
        slot.classList.add('is-empty');
        slot.setAttribute('aria-label', '선택 대기 슬롯 ' + (i + 1));
        var emptyLabel = document.createElement('span');
        emptyLabel.className = 'sc-featured-preview__empty-label';
        emptyLabel.textContent = '선택 대기';
        slot.appendChild(emptyLabel);
        previewEl.appendChild(slot);
        continue;
      }
      var item = resolveDraftPreviewItem(key);
      slot.setAttribute(
        'aria-label',
        '선택된 대표 업적 ' + (i + 1) + '번: ' + (item.name || key)
      );
      appendAchievementIcon(slot, item, 'sc-featured-preview__icon');
      var nameEl = document.createElement('span');
      nameEl.className = 'sc-featured-preview__name';
      nameEl.textContent = item.name || key;
      slot.appendChild(nameEl);
      previewEl.appendChild(slot);
    }
  }

  function renderAchievementHistorySection(panel) {
    var histEl = panel.querySelector('#sc-achievement-history-list');
    var tabsEl = panel.querySelector('#sc-achievement-history-tabs');
    var pagerEl = panel.querySelector('#sc-achievement-history-pagination');
    if (!histEl) return;
    histEl.innerHTML = '';
    var history;
    try {
      history = getCurrentUserAchievementHistory();
    } catch (_) {
      history = [];
    }

    var state = buildAchievementHistoryPaginationState({
      history: history,
      activeCategory: historyUiState.activeCategory,
      page: historyUiState.page,
      pageSize: historyUiState.pageSize,
    });
    historyUiState.activeCategory = state.activeCategory;
    historyUiState.page = state.page;
    renderHistoryCategoryTabs(tabsEl, state.categories, state.activeCategory);

    if (!state.totalItems) {
      var empty = document.createElement('p');
      empty.className = 'sc-featured-achievement-panel__empty';
      empty.textContent =
        history.length === 0
          ? '아직 획득한 업적이 없습니다.'
          : '이 분류에 표시할 기록이 없습니다.';
      histEl.appendChild(empty);
      renderHistoryPagination(pagerEl, null);
      return;
    }

    var i;
    for (i = 0; i < state.items.length; i++) {
      try {
        var item = state.items[i] || {};
        var selectable = canSelectFeaturedFromHistoryItem(item);
        var checked = isInFeaturedDraft(item.achievementId);
        var row = document.createElement(selectable ? 'label' : 'div');
        row.className = 'sc-achievement-history-row';
        if (item.historyType === 'PAST_SEASON') {
          row.classList.add('is-past-season');
        }
        if (checked) row.classList.add('is-selected');
        if (!selectable) row.classList.add('is-disabled');

        appendAchievementIcon(row, item, 'sc-achievement-history-row__icon');

        var content = document.createElement('span');
        content.className = 'sc-achievement-history-row__content';
        var nameEl = document.createElement('span');
        nameEl.className = 'sc-achievement-history-row__name';
        nameEl.textContent = item.name || item.achievementId || '';
        var metaEl = document.createElement('span');
        metaEl.className = 'sc-achievement-history-row__meta';
        var rarityLabel =
          typeof global.getAchievementRarityLabel === 'function'
            ? global.getAchievementRarityLabel(item.rarity)
            : item.rarity || '';
        var dateText = formatAchievementAcquiredDate(item.acquiredAt);
        var catLabel = getAchievementCategoryLabel(item.category);
        metaEl.textContent =
          catLabel +
          ' · ' +
          rarityLabel +
          ' · ' +
          dateText +
          (item.historyType === 'PAST_SEASON' ? ' · 지난 시즌' : '');
        metaEl.title = formatAchievementAcquiredDateTitle(item.acquiredAt);
        content.appendChild(nameEl);
        content.appendChild(metaEl);
        row.appendChild(content);

        var selectWrap = document.createElement('span');
        selectWrap.className = 'sc-achievement-history-row__select';
        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'sc-achievement-history-row__check';
        check.checked = checked;
        check.disabled = !selectable;
        check.setAttribute('data-achievement-id', item.achievementId || '');
        check.setAttribute(
          'aria-label',
          (item.name || item.achievementId || '업적') +
            (checked ? ' 대표 업적 선택 해제' : '을 대표 업적으로 선택')
        );
        if (selectable) {
          check.addEventListener('click', function (ev) {
            ev.stopPropagation();
          });
          (function (achievementId, checkbox) {
            checkbox.addEventListener('change', function () {
              var wantChecked = checkbox.checked;
              var result = toggleFeaturedDraftKey(achievementId);
              if (!result.ok) {
                checkbox.checked = !wantChecked;
                showFeaturedLimitNotice(result.message);
                return;
              }
              renderFeaturedPreview(panel);
              renderAchievementHistorySection(panel);
            });
          })(item.achievementId, check);
        }
        selectWrap.appendChild(check);
        row.appendChild(selectWrap);
        histEl.appendChild(row);
      } catch (_) {
        /* 잘못된 기록 하나가 패널 전체를 깨지 않도록 */
      }
    }
    renderHistoryPagination(pagerEl, state);
  }

  function renderFeaturedAchievementPanel() {
    var panel = ensureFeaturedPanel();
    renderFeaturedPreview(panel);
    renderAchievementHistorySection(panel);
  }

  function openFeaturedAchievementPanel() {
    featuredDraftKeys = cloneFeaturedDraftKeys(getCurrentUserFeaturedAchievementIds());
    historyUiState.activeCategory = 'ALL';
    historyUiState.page = 1;
    historyUiState.pageSize = HISTORY_PAGE_SIZE;
    var panel = ensureFeaturedPanel();
    renderFeaturedAchievementPanel();
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sc-featured-achievement-open');
  }

  function closeFeaturedAchievementPanel() {
    var panel = document.getElementById('sc-featured-achievement-panel');
    if (!panel) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sc-featured-achievement-open');
  }

  function inspectFeaturedAchievementModal() {
    var panel = document.getElementById('sc-featured-achievement-panel');
    var open = !!(panel && !panel.hidden);
    var saved = getCurrentUserFeaturedAchievementIds();
    var draft = getFeaturedDraftKeys();
    var history = [];
    try {
      history = getCurrentUserAchievementHistory();
    } catch (_) {}
    var histState = buildAchievementHistoryPaginationState({
      history: history,
      activeCategory: historyUiState.activeCategory,
      page: historyUiState.page,
      pageSize: historyUiState.pageSize,
    });
    var histSection = panel && panel.querySelector('.sc-featured-achievement-panel__history');
    var bodyEl = panel && panel.querySelector('.sc-featured-achievement-panel__body');
    var previewEl = panel && panel.querySelector('#sc-featured-preview');
    var histList = panel && panel.querySelector('#sc-achievement-history-list');
    var visibleChecks =
      histList && histList.querySelectorAll
        ? histList.querySelectorAll('.sc-achievement-history-row__check')
        : [];
    var checkedVisible = 0;
    var vi;
    for (vi = 0; vi < visibleChecks.length; vi++) {
      if (visibleChecks[vi].checked) checkedVisible += 1;
    }
    function overflowAuto(el) {
      if (!el) return false;
      try {
        var st = global.getComputedStyle ? global.getComputedStyle(el) : null;
        if (!st) return false;
        return st.overflowY === 'auto' || st.overflowY === 'scroll';
      } catch (_) {
        return false;
      }
    }
    return {
      selectedPreview: {
        slotCount: FEATURED_MAX,
        selectedCount: draft.length,
        keys: draft.slice(),
        hasCheckboxes: !!(
          previewEl &&
          previewEl.querySelector &&
          previewEl.querySelector('input[type="checkbox"]')
        ),
        orderPreserved: true,
      },
      acquisitionSelection: {
        checkboxSource: 'ACQUISITION_HISTORY',
        activeCategory: histState.activeCategory,
        page: histState.page,
        pageSize: histState.pageSize,
        visibleRows: histState.items.length,
        checkedVisibleRows: checkedVisible,
      },
      state: {
        selectionPersistsAcrossPages: true,
        selectionPersistsAcrossCategories: true,
        savedOnlyOnConfirm: true,
        draftMatchesSaved: JSON.stringify(draft) === JSON.stringify(saved),
      },
      featuredAchievementModal: {
        open: open,
        selectedCount: draft.length,
        maxSelected: FEATURED_MAX,
        savedCount: saved.length,
      },
      acquisitionHistory: {
        activeCategory: histState.activeCategory,
        categories: histState.categories,
        page: histState.page,
        pageSize: histState.pageSize,
        totalItems: histState.totalItems,
        totalPages: histState.totalPages,
        internalScrollbar: overflowAuto(histSection),
      },
      modalBodySingleScroll: overflowAuto(bodyEl),
      warnings: [],
    };
  }

  function bindFeaturedAchievementOpeners() {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btn = t.closest('[data-sc-open-featured-achievements]');
      if (!btn) return;
      ev.preventDefault();
      openFeaturedAchievementPanel();
    });
  }

  function resetUserAchievementMock() {
    memberAchievementState = createEmptyUserAchievementState();
    guestAchievementState = createDefaultUserAchievementMock();
    refreshUserAchievementViews();
    return getCurrentUserAchievementData();
  }

  /* 전역 노출 */
  global.MOCK_ACHIEVEMENT_ICON_IDS = MOCK_ACHIEVEMENT_ICON_IDS;
  global.formatAchievementAcquiredDate = formatAchievementAcquiredDate;
  global.formatAchievementAcquiredDateTitle = formatAchievementAcquiredDateTitle;
  global.getCurrentUserAchievementData = getCurrentUserAchievementData;
  global.getCurrentUserAchievements = getCurrentUserAchievements;
  global.getCurrentUserSeasonHistory = getCurrentUserSeasonHistory;
  global.getCurrentUserFeaturedAchievementIds = getCurrentUserFeaturedAchievementIds;
  global.getCurrentUserFeaturedAchievements = getCurrentUserFeaturedAchievements;
  global.hasCurrentUserAchievement = hasCurrentUserAchievement;
  global.getCurrentUserAchievement = getCurrentUserAchievement;
  global.getCurrentUserAchievementDisplayList = getCurrentUserAchievementDisplayList;
  global.buildProfileAchievementsFromFeatured = buildProfileAchievementsFromFeatured;
  global.setFeaturedAchievementIds = setFeaturedAchievementIds;
  global.toggleFeaturedAchievement = toggleFeaturedAchievement;
  global.clearFeaturedAchievements = clearFeaturedAchievements;
  global.validateFeaturedAchievementSelection = validateFeaturedAchievementSelection;
  global.removeUnavailableFeaturedAchievements = removeUnavailableFeaturedAchievements;
  global.grantCurrentUserAchievement = grantCurrentUserAchievement;
  global.hydrateCurrentUserAchievementsFromServer = hydrateCurrentUserAchievementsFromServer;
  global.getCurrentUserAchievementHistory = getCurrentUserAchievementHistory;
  global.validateCurrentUserAchievementData = validateCurrentUserAchievementData;
  global.refreshUserAchievementViews = refreshUserAchievementViews;
  global.openFeaturedAchievementPanel = openFeaturedAchievementPanel;
  global.closeFeaturedAchievementPanel = closeFeaturedAchievementPanel;
  global.getFeaturedDraftKeys = getFeaturedDraftKeys;
  global.toggleFeaturedDraftKey = toggleFeaturedDraftKey;
  global.confirmFeaturedDraftSelection = confirmFeaturedDraftSelection;
  global.normalizeAchievementCategory = normalizeAchievementCategory;
  global.getAchievementCategoryLabel = getAchievementCategoryLabel;
  global.filterAcquisitionHistoryByCategory = filterAcquisitionHistoryByCategory;
  global.paginateAcquisitionHistory = paginateAcquisitionHistory;
  global.buildAchievementHistoryPaginationState = buildAchievementHistoryPaginationState;
  global.listAvailableAchievementHistoryCategories = listAvailableAchievementHistoryCategories;
  global.inspectFeaturedAchievementModal = inspectFeaturedAchievementModal;
  global.__scInspectFeaturedAchievementModal = inspectFeaturedAchievementModal;
  global.getAchievementDisplayName = getAchievementDisplayName;
  global.notifyNewlyAcquiredAchievements = notifyNewlyAcquiredAchievements;
  global.resetMemberAlertBaseline = resetMemberAlertBaseline;
  global.applyCanonicalGrantedAchievements = applyCanonicalGrantedAchievements;
  global.markAchievementAcquisitionNotified = markAchievementAcquisitionNotified;
  global.MOCK_TEST_SEASON_ID = MOCK_TEST_SEASON_ID;

  /** 개발용 Mock/debug — 배포 전 제거 또는 비활성 대상 */
  global.__scSetFeaturedAchievements = function (ids) {
    return setFeaturedAchievementIds(ids);
  };
  global.__scToggleFeaturedAchievement = function (id) {
    return toggleFeaturedAchievement(id);
  };
  global.__scClearFeaturedAchievements = function () {
    return clearFeaturedAchievements();
  };
  global.__scResetUserAchievementMock = function () {
    return resetUserAchievementMock();
  };
  global.__scValidateUserAchievements = function () {
    return validateCurrentUserAchievementData();
  };
  global.__scRemoveUnavailableFeaturedAchievements = function () {
    return removeUnavailableFeaturedAchievements();
  };
  global.__scGrantAchievement = function (achievementId, options) {
    var result = grantCurrentUserAchievement(achievementId, options || { source: 'DEBUG' });
    if (result && result.persistPromise) {
      return result.persistPromise;
    }
    return result;
  };

  global.__scHydrateAchievements = function (force) {
    return hydrateCurrentUserAchievementsFromServer(!!force);
  };
  global.__scGrantConfirmedAchievements = function () {
    var results = [];
    var i;
    for (i = 0; i < CONFIRMED_GRANT_IDS.length; i++) {
      var gid = CONFIRMED_GRANT_IDS[i];
      var gdef = getAchievementDefinitionSafe(gid);
      var gopts = { source: 'DEBUG' };
      if (gdef && gdef.persistenceType === 'SEASON_REPEATABLE') {
        gopts.seasonId = MOCK_TEST_SEASON_ID;
      }
      results.push({
        achievementId: gid,
        result: grantCurrentUserAchievement(gid, gopts),
      });
    }
    return results;
  };
  global.__scTestAchievementDuplicateGrant = function () {
    resetUserAchievementMock();
    var before =
      typeof global.loadNotifications === 'function' ? global.loadNotifications().length : null;
    var first = grantCurrentUserAchievement('first-post', { source: 'DEBUG' });
    var afterFirst =
      typeof global.loadNotifications === 'function' ? global.loadNotifications().length : null;
    var second = grantCurrentUserAchievement('first-post', { source: 'DEBUG' });
    var afterSecond =
      typeof global.loadNotifications === 'function' ? global.loadNotifications().length : null;
    return {
      first: first,
      second: second,
      alreadyAcquired: second && second.reason === 'ALREADY_ACQUIRED',
      notificationCountBefore: before,
      notificationCountAfterFirst: afterFirst,
      notificationCountAfterSecond: afterSecond,
      notificationOnlyOnce:
        afterFirst != null && afterSecond != null ? afterSecond === afterFirst : null,
    };
  };
  global.__scTestAchievementSequence = function () {
    resetUserAchievementMock();
    var ids = ['first-post', 'first-comment', 'first-empathy-received'];
    var granted = [];
    var i;
    for (i = 0; i < ids.length; i++) {
      granted.push(grantCurrentUserAchievement(ids[i], { source: 'DEBUG' }));
    }
    var seqs = (getActiveAchievementState().currentAchievements || []).map(function (r) {
      return Number(r.acquisitionSequence);
    });
    var unique = {};
    var dup = false;
    for (i = 0; i < seqs.length; i++) {
      if (unique[seqs[i]]) dup = true;
      unique[seqs[i]] = true;
    }
    var increasing = true;
    for (i = 1; i < seqs.length; i++) {
      if (seqs[i] <= seqs[i - 1]) increasing = false;
    }
    return {
      granted: granted,
      sequences: seqs,
      noDuplicates: !dup,
      monotonicallyIncreasing: increasing,
    };
  };
  global.__scTestSeasonAchievementGrant = function () {
    resetUserAchievementMock();
    /* empathy는 기본 Mock에 있으므로 제거 후 테스트 */
    getActiveAchievementState().currentAchievements = (
      getActiveAchievementState().currentAchievements || []
    ).filter(function (r) {
      return trimId(r && r.achievementId) !== 'empathy-from-many';
    });
    getActiveAchievementState().featuredAchievementIds = (
      getActiveAchievementState().featuredAchievementIds || []
    ).filter(function (id) {
      return trimId(id) !== 'empathy-from-many';
    });
    var first = grantCurrentUserAchievement('empathy-from-many', {
      source: 'DEBUG',
      seasonId: 'mock-season-1',
    });
    var dupSame = grantCurrentUserAchievement('empathy-from-many', {
      source: 'DEBUG',
      seasonId: 'mock-season-1',
    });
    var otherSeason = grantCurrentUserAchievement('empathy-from-many', {
      source: 'DEBUG',
      seasonId: 'mock-season-2',
    });
    var noSeason = grantCurrentUserAchievement('steady-footsteps', { source: 'DEBUG' });
    return {
      first: first,
      duplicateSameSeason: dupSame,
      otherSeason: otherSeason,
      withoutSeasonId: noSeason,
      sameSeasonRejected: dupSame && dupSame.reason === 'ALREADY_ACQUIRED',
      otherSeasonGranted: !!(otherSeason && otherSeason.granted),
      seasonRequired: noSeason && noSeason.reason === 'SEASON_NOT_AVAILABLE',
    };
  };
  global.__scGetAchievementHistory = function () {
    return getCurrentUserAchievementHistory();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindFeaturedAchievementOpeners);
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () {
        maybeScheduleMemberHydrate();
      }, 0);
    });
  } else {
    bindFeaturedAchievementOpeners();
    setTimeout(function () {
      maybeScheduleMemberHydrate();
    }, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
