/**
 * =============================================================================
 * 센텐스크래프트 — 사용자 업적 Mock (1~2차)
 * =============================================================================
 * - currentAchievements: 현재 보유 · 대표 선택 대상
 * - seasonHistory: 종료 시즌 기록 · 프로필 선택 불가
 * - featuredAchievementIds: 직접 체크한 대표 업적(최대 3 · 배열 순서 = 슬롯 순서)
 * - grantCurrentUserAchievement: CONFIRMED Mock 지급 · 중복 방지 · 알림
 *
 * 이름·희귀도는 ACHIEVEMENT_DEFINITIONS에서 조회. 사용자 기록에 중복 저장하지 않음.
 * Mock seasonId('mock-season-1')는 시즌 UNSCHEDULED 상태의 테스트용 값.
 *
 * 실제 게시글/댓글/공감/레벨 이벤트 · Firebase · DB · API · 시즌 종료 배치 미구현.
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

  /** 런타임 Mock 상태 (원본 DEFAULT는 변경하지 않음) */
  var userAchievementState = createDefaultUserAchievementMock();

  function trimId(value) {
    return String(value == null ? '' : value).trim();
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
    return deepClone(userAchievementState);
  }

  function getCurrentUserAchievements() {
    return deepClone(userAchievementState.currentAchievements || []);
  }

  function getCurrentUserSeasonHistory() {
    return deepClone(userAchievementState.seasonHistory || []);
  }

  function getCurrentUserFeaturedAchievementIds() {
    return (userAchievementState.featuredAchievementIds || []).slice();
  }

  function hasCurrentUserAchievement(achievementId) {
    var id = trimId(achievementId);
    if (!id) return false;
    var list = userAchievementState.currentAchievements || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (trimId(list[i] && list[i].achievementId) === id) return true;
    }
    return false;
  }

  function isInSeasonHistory(achievementId) {
    var id = trimId(achievementId);
    if (!id) return false;
    var list = userAchievementState.seasonHistory || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (trimId(list[i] && list[i].achievementId) === id) return true;
    }
    return false;
  }

  function getCurrentUserAchievement(achievementId) {
    var id = trimId(achievementId);
    if (!id) return null;
    var list = userAchievementState.currentAchievements || [];
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
    var list = userAchievementState.currentAchievements || [];
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
    var list = userAchievementState.currentAchievements || [];
    var hist = userAchievementState.seasonHistory || [];
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
    var list = userAchievementState.currentAchievements || [];
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
   * CONFIRMED 업적 Mock 지급.
   * 신규 지급 시에만 알림 · 대표 업적 자동 선택 없음.
   */
  function grantCurrentUserAchievement(achievementId, options) {
    var opts = options && typeof options === 'object' ? options : {};
    if (
      !userAchievementState ||
      !Array.isArray(userAchievementState.currentAchievements) ||
      !Array.isArray(userAchievementState.featuredAchievementIds) ||
      !Array.isArray(userAchievementState.seasonHistory)
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

    var pType = def.persistenceType;
    var seasonId =
      opts.seasonId == null || String(opts.seasonId).trim() === ''
        ? null
        : String(opts.seasonId).trim();

    if (pType === 'PERMANENT_ONCE') {
      seasonId = null;
      if (hasCurrentUserAchievement(id)) {
        return { success: true, granted: false, reason: 'ALREADY_ACQUIRED' };
      }
    } else if (pType === 'SEASON_REPEATABLE') {
      if (!seasonId) {
        if (!hasActiveSeasonSafe(opts.now)) {
          return { success: false, granted: false, reason: 'SEASON_NOT_AVAILABLE' };
        }
        return { success: false, granted: false, reason: 'SEASON_ID_REQUIRED' };
      }
      if (findCurrentRecordIndex(id, seasonId) !== -1) {
        return { success: true, granted: false, reason: 'ALREADY_ACQUIRED' };
      }
      /*
       * 현재 시즌 기록만 current에 유지.
       * 시즌 종료 배치(히스토리 이동) 미구현이므로, 다른 seasonId 재획득 테스트 시
       * 동일 achievementId의 기존 current 기록은 제거만 한다(히스토리로 옮기지 않음).
       */
      var list = userAchievementState.currentAchievements;
      var ri;
      for (ri = list.length - 1; ri >= 0; ri--) {
        if (trimId(list[ri] && list[ri].achievementId) === id) {
          list.splice(ri, 1);
        }
      }
    } else if (pType === 'EVENT_PERMANENT') {
      /* witness-of-an-era 등 BLOCKED · 사건 식별자 필요 — 지급 거부 */
      return { success: false, granted: false, reason: 'NOT_CONFIRMED' };
    } else {
      return { success: false, granted: false, reason: 'NOT_CONFIRMED' };
    }

    var record = {
      achievementId: id,
      acquiredAt: acquiredAt,
      acquisitionSequence: nextAcquisitionSequence(),
      seasonId: seasonId,
    };
    userAchievementState.currentAchievements.push(record);
    sortCurrentAchievementsBySequence();
    notifyAchievementAcquired(def, record);
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
    var current = userAchievementState.currentAchievements || [];
    var history = userAchievementState.seasonHistory || [];
    var i;

    function pushEntry(rec, historyType) {
      if (!rec) return;
      var hid = trimId(rec.achievementId);
      var def = getAchievementDefinitionSafe(hid);
      out.push({
        achievementId: hid,
        name: def && def.name ? String(def.name) : hid || '알 수 없는 업적',
        rarity: def && def.rarity ? String(def.rarity) : 'COMMON',
        persistenceType: def && def.persistenceType ? String(def.persistenceType) : '',
        acquiredAt: rec.acquiredAt != null ? String(rec.acquiredAt) : '',
        acquisitionSequence: Number(rec.acquisitionSequence) || 0,
        seasonId: rec.seasonId == null ? null : String(rec.seasonId),
        historyType: historyType,
        canFeature: !!(def && def.canFeature === true),
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
    var featured = userAchievementState.featuredAchievementIds || [];
    var i;
    for (i = 0; i < featured.length; i++) {
      if (trimId(featured[i]) === id) return i;
    }
    return -1;
  }

  function getCurrentUserAchievementDisplayList() {
    var list = userAchievementState.currentAchievements || [];
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
      });
    }
    out.sort(function (a, b) {
      return (a.acquisitionSequence || 0) - (b.acquisitionSequence || 0);
    });
    return out;
  }

  function getCurrentUserFeaturedAchievements() {
    var ids = userAchievementState.featuredAchievementIds || [];
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
    var ids = userAchievementState.featuredAchievementIds || [];
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
        title: String(def.name || ''),
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
    var prev = (userAchievementState.featuredAchievementIds || []).slice();
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
    userAchievementState.featuredAchievementIds = normalized.slice(0, FEATURED_MAX);
    refreshUserAchievementViews();
    return {
      ok: true,
      featuredAchievementIds: getCurrentUserFeaturedAchievementIds(),
    };
  }

  function toggleFeaturedAchievement(achievementId) {
    var id = trimId(achievementId);
    var prev = (userAchievementState.featuredAchievementIds || []).slice();
    var idx = getFeaturedIndex(id);
    if (idx !== -1) {
      prev.splice(idx, 1);
      userAchievementState.featuredAchievementIds = prev;
      refreshUserAchievementViews();
      return { ok: true, featuredAchievementIds: getCurrentUserFeaturedAchievementIds() };
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
    userAchievementState.featuredAchievementIds = next;
    refreshUserAchievementViews();
    return { ok: true, featuredAchievementIds: getCurrentUserFeaturedAchievementIds() };
  }

  function clearFeaturedAchievements() {
    userAchievementState.featuredAchievementIds = [];
    refreshUserAchievementViews();
    return { ok: true, featuredAchievementIds: [] };
  }

  /**
   * 현재 보유하지 않거나 canFeature=false인 대표 업적 제거.
   * 남은 순서 유지 · 빈 슬롯 자동 대체 없음.
   * 시즌 종료 배치와는 아직 연결하지 않음 (개발 테스트용).
   */
  function removeUnavailableFeaturedAchievements() {
    var featured = userAchievementState.featuredAchievementIds || [];
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
    userAchievementState.featuredAchievementIds = kept;
    refreshUserAchievementViews();
    return getCurrentUserFeaturedAchievementIds();
  }

  function isValidIsoLikeDate(value) {
    return !!parseAcquiredDate(value);
  }

  function validateCurrentUserAchievementData() {
    var data = userAchievementState;
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

  function ensureFeaturedPanel() {
    var existing = document.getElementById('sc-featured-achievement-panel');
    if (existing) return existing;
    var panel = document.createElement('div');
    panel.id = 'sc-featured-achievement-panel';
    panel.className = 'sc-featured-achievement-panel';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<div class="sc-featured-achievement-panel__backdrop" data-sc-featured-close="1"></div>' +
      '<div class="sc-featured-achievement-panel__dialog sc-panel" role="dialog" aria-modal="true" aria-labelledby="sc-featured-achievement-title">' +
      '  <header class="sc-featured-achievement-panel__head">' +
      '    <h2 id="sc-featured-achievement-title" class="sc-section-title">대표 업적 선택</h2>' +
      '    <p class="sc-featured-achievement-panel__hint">프로필에 표시할 업적을 최대 3개 선택하세요.</p>' +
      '    <p class="sc-featured-achievement-panel__count" id="sc-featured-achievement-count">0/3</p>' +
      '  </header>' +
      '  <div class="sc-featured-achievement-panel__list" id="sc-featured-achievement-list" role="list"></div>' +
      '  <section class="sc-featured-achievement-panel__history" aria-labelledby="sc-achievement-history-title">' +
      '    <h3 id="sc-achievement-history-title" class="sc-featured-achievement-panel__history-title">획득 기록</h3>' +
      '    <div class="sc-featured-achievement-panel__history-list" id="sc-achievement-history-list"></div>' +
      '  </section>' +
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
        closeFeaturedAchievementPanel();
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

  function renderFeaturedAchievementPanelIfOpen() {
    var panel = document.getElementById('sc-featured-achievement-panel');
    if (!panel || panel.hidden) return;
    renderFeaturedAchievementPanel();
  }

  function renderAchievementHistorySection(panel) {
    var histEl = panel.querySelector('#sc-achievement-history-list');
    if (!histEl) return;
    histEl.innerHTML = '';
    var history;
    try {
      history = getCurrentUserAchievementHistory();
    } catch (_) {
      history = [];
    }
    if (!history.length) {
      var empty = document.createElement('p');
      empty.className = 'sc-featured-achievement-panel__empty';
      empty.textContent = '획득 기록이 없습니다.';
      histEl.appendChild(empty);
      return;
    }
    var i;
    for (i = 0; i < history.length; i++) {
      try {
        var item = history[i] || {};
        var row = document.createElement('div');
        row.className = 'sc-achievement-history-row';
        if (item.historyType === 'PAST_SEASON') {
          row.classList.add('is-past-season');
        }
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
        metaEl.textContent =
          rarityLabel +
          ' · ' +
          dateText +
          (item.historyType === 'PAST_SEASON' ? ' · 지난 시즌' : '');
        metaEl.title = formatAchievementAcquiredDateTitle(item.acquiredAt);
        row.appendChild(nameEl);
        row.appendChild(metaEl);
        histEl.appendChild(row);
      } catch (_) {
        /* 잘못된 기록 하나가 패널 전체를 깨지 않도록 */
      }
    }
  }

  function renderFeaturedAchievementPanel() {
    var panel = ensureFeaturedPanel();
    var listEl = panel.querySelector('#sc-featured-achievement-list');
    var countEl = panel.querySelector('#sc-featured-achievement-count');
    var featured = getCurrentUserFeaturedAchievementIds();
    if (countEl) countEl.textContent = featured.length + '/' + FEATURED_MAX;

    var display = getCurrentUserAchievementDisplayList();
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!display.length) {
      var empty = document.createElement('p');
      empty.className = 'sc-featured-achievement-panel__empty';
      empty.textContent = '현재 보유한 업적이 없습니다.';
      listEl.appendChild(empty);
    } else {
      var i;
      for (i = 0; i < display.length; i++) {
        (function (item) {
          try {
            var row = document.createElement('label');
            row.className = 'sc-featured-achievement-row';
            row.setAttribute('role', 'listitem');
            if (item.isFeatured) row.classList.add('is-featured');

            var check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'sc-featured-achievement-row__check';
            check.checked = !!item.isFeatured;
            check.disabled = item.canFeature !== true;
            check.setAttribute('data-achievement-id', item.achievementId);

            check.addEventListener('change', function () {
              var wantChecked = check.checked;
              var result = toggleFeaturedAchievement(item.achievementId);
              if (!result.ok) {
                check.checked = !wantChecked;
                showFeaturedLimitNotice(result.message);
                return;
              }
              renderFeaturedAchievementPanel();
            });

            var iconWrap = document.createElement('span');
            iconWrap.className = 'sc-featured-achievement-row__icon sc-profile-achievement';
            iconWrap.setAttribute('data-rarity', item.rarity || 'COMMON');
            var iconImg = document.createElement('img');
            iconImg.className = 'sc-featured-achievement-row__icon-img';
            iconImg.alt = '';
            iconImg.decoding = 'async';
            var iconId = item.iconId || '';
            iconImg.src = iconId
              ? '/assets/achievements/' + iconId + '.png'
              : '/assets/achievements/achievement_empty.png';
            var frameImg = document.createElement('img');
            frameImg.className = 'sc-featured-achievement-row__rarity-frame';
            frameImg.alt = '';
            frameImg.setAttribute('aria-hidden', 'true');
            var frameSrc = rarityFrameSrc(item.rarity);
            if (frameSrc) {
              frameImg.src = frameSrc;
            } else {
              frameImg.hidden = true;
            }
            iconWrap.appendChild(iconImg);
            iconWrap.appendChild(frameImg);

            var meta = document.createElement('span');
            meta.className = 'sc-featured-achievement-row__meta';
            var nameEl = document.createElement('span');
            nameEl.className = 'sc-featured-achievement-row__name';
            nameEl.textContent = item.name || item.achievementId;
            var dateEl = document.createElement('span');
            dateEl.className = 'sc-featured-achievement-row__date';
            dateEl.textContent = formatAchievementAcquiredDate(item.acquiredAt);
            dateEl.title = formatAchievementAcquiredDateTitle(item.acquiredAt);
            meta.appendChild(nameEl);
            meta.appendChild(dateEl);

            row.appendChild(check);
            row.appendChild(iconWrap);
            row.appendChild(meta);
            listEl.appendChild(row);
          } catch (_) {
            /* 행 단위 오류 무시 */
          }
        })(display[i]);
      }
    }

    renderAchievementHistorySection(panel);
  }

  function openFeaturedAchievementPanel() {
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
    userAchievementState = createDefaultUserAchievementMock();
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
  global.getCurrentUserAchievementHistory = getCurrentUserAchievementHistory;
  global.validateCurrentUserAchievementData = validateCurrentUserAchievementData;
  global.refreshUserAchievementViews = refreshUserAchievementViews;
  global.openFeaturedAchievementPanel = openFeaturedAchievementPanel;
  global.closeFeaturedAchievementPanel = closeFeaturedAchievementPanel;
  global.CONFIRMED_GRANT_IDS = CONFIRMED_GRANT_IDS;
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
    return grantCurrentUserAchievement(achievementId, options || { source: 'DEBUG' });
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
    var seqs = (userAchievementState.currentAchievements || []).map(function (r) {
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
    userAchievementState.currentAchievements = (
      userAchievementState.currentAchievements || []
    ).filter(function (r) {
      return trimId(r && r.achievementId) !== 'empathy-from-many';
    });
    userAchievementState.featuredAchievementIds = (
      userAchievementState.featuredAchievementIds || []
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
  } else {
    bindFeaturedAchievementOpeners();
  }
})(typeof window !== 'undefined' ? window : globalThis);
