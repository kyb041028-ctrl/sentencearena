/**
 * 센텐스아레나 — 프로필 API Client + 메모리 캐시
 *
 * 모드: LEGACY_LOCAL(기본) · API_DRY_RUN · API_OPERATIONAL(이번 작업 미활성)
 */
(function (global) {
  'use strict';

  var cfg = global.UserDataConfigCore;
  var schema = global.UserDataSchemaCore;
  var publicProfile = global.PublicProfileCore;
  var dataAdapter = global.UserProfileDataAdapter;

  var TTL_MS = (publicProfile && publicProfile.PROFILE_CACHE_TTL_MS) || 30000;
  var cache = Object.create(null);
  var pending = Object.create(null);

  function getDataMode() {
    if (cfg) {
      return cfg.resolveUserDataMode({
        USER_DATA_MODE: '',
        USER_DATA_OPERATIONAL: '',
        dataMode: (global.__scUserDataMode) || '',
      });
    }
    return 'LEGACY_LOCAL';
  }

  function isOperational() { return getDataMode() === 'API_OPERATIONAL'; }
  function isDryRun() { return getDataMode() === 'API_DRY_RUN'; }

  function getAuthToken() {
    try {
      var raw = sessionStorage.getItem('sc_sb_auth_session');
      if (!raw) return null;
      var auth = JSON.parse(raw);
      return (auth && auth.session && auth.session.access_token) || null;
    } catch (_) { return null; }
  }

  function getCurrentUserId() {
    try {
      var raw = sessionStorage.getItem('sc_sb_auth_session');
      if (raw) {
        var auth = JSON.parse(raw);
        var user = auth && (auth.user || (auth.session && auth.session.user));
        if (user && user.id) return String(user.id).trim();
      }
    } catch (_) {}
    return (global.__scPlayer && global.__scPlayer.userId) || null;
  }

  function makeHeaders() {
    var h = { 'Content-Type': 'application/json' };
    var token = getAuthToken();
    if (token) h.Authorization = 'Bearer ' + token;
    var userId = getCurrentUserId();
    if (userId) h['x-sc-user-id'] = userId;
    return h;
  }

  function cacheKey(kind, userId) {
    return kind + ':' + String(userId || '');
  }

  function getCached(key) {
    var entry = cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      delete cache[key];
      return null;
    }
    return entry.value;
  }

  function setCached(key, value) {
    cache[key] = { value: value, expiresAt: Date.now() + TTL_MS };
  }

  function invalidateProfileCache(userId) {
    if (!userId) {
      cache = Object.create(null);
      pending = Object.create(null);
      return;
    }
    delete cache[cacheKey('public', userId)];
    delete cache[cacheKey('self', userId)];
    delete pending[cacheKey('public', userId)];
    delete pending[cacheKey('self', userId)];
  }

  function invalidateFollowStateCache(viewerId, targetId) {
    if (targetId) delete cache[cacheKey('public', targetId)];
    if (viewerId) delete cache[cacheKey('self', viewerId)];
  }

  async function apiGet(path) {
    if (!isOperational()) {
      return { ok: false, error: 'USER_DATA_API_NOT_ACTIVATED', mode: getDataMode() };
    }
    try {
      var resp = await fetch(path, { method: 'GET', headers: makeHeaders() });
      return await resp.json();
    } catch (e) {
      return { ok: false, error: 'USER_DATA_NETWORK_ERROR' };
    }
  }

  function resolveLegacyPublic(userId) {
    if (dataAdapter && publicProfile) {
      return publicProfile.buildUnavailableProfileViewModel(userId, 'LEGACY_LOCAL');
    }
    return { userId: userId, dataStatus: 'UNAVAILABLE', mode: 'LEGACY_LOCAL' };
  }

  /**
   * 공개 프로필 조회 — 모드별
   * 익명 context에서는 호출하지 말 것 (canOpenProfileFromAuthorContext 선행)
   */
  function getPublicProfile(userId, authorContext) {
    if (authorContext) {
      var gate = dataAdapter
        ? dataAdapter.canOpenProfileFromAuthorContext(authorContext)
        : { allowed: true };
      if (!gate.allowed) {
        if (gate.reason === 'ANONYMOUS') {
          return Promise.resolve({
            ok: true,
            mode: getDataMode(),
            data: dataAdapter.buildAnonymousProfileViewModel(),
          });
        }
        return Promise.resolve({
          ok: false,
          error: 'PROFILE_OPEN_FORBIDDEN',
          reason: gate.reason,
          mode: getDataMode(),
        });
      }
    }

    if (schema) {
      var idCheck = schema.validateUserId(userId, { strict: true });
      if (!idCheck.valid) {
        return Promise.resolve({ ok: false, error: idCheck.error, mode: getDataMode() });
      }
    }

    var key = cacheKey('public', userId);
    var hit = getCached(key);
    if (hit) return Promise.resolve({ ok: true, mode: getDataMode(), data: hit, cached: true });

    if (pending[key]) return pending[key];

    var work = (async function () {
      if (isOperational()) {
        var res = await apiGet('/api/users/' + encodeURIComponent(userId) + '/profile/public');
        if (res && res.ok && res.data) {
          setCached(key, res.data);
          return { ok: true, mode: 'API_OPERATIONAL', data: res.data };
        }
        return res || { ok: false, error: 'USER_DATA_PROFILE_FETCH_FAILED' };
      }

      if (isDryRun()) {
        var dry = resolveLegacyPublic(userId);
        return {
          ok: true,
          mode: 'API_DRY_RUN',
          data: dry,
          validation: publicProfile
            ? publicProfile.validatePublicProfileContract(dry)
            : { valid: true },
          note: 'API_DRY_RUN: 실제 fetch 미호출',
        };
      }

      var legacy = resolveLegacyPublic(userId);
      setCached(key, legacy);
      return { ok: true, mode: 'LEGACY_LOCAL', data: legacy };
    })();

    pending[key] = work.then(function (r) {
      delete pending[key];
      return r;
    }, function (e) {
      delete pending[key];
      throw e;
    });

    return pending[key];
  }

  function getSelfProfile() {
    var userId = getCurrentUserId();
    if (!userId) {
      return Promise.resolve({ ok: false, error: 'USER_DATA_AUTH_REQUIRED', mode: getDataMode() });
    }
    var key = cacheKey('self', userId);
    var hit = getCached(key);
    if (hit) return Promise.resolve({ ok: true, mode: getDataMode(), data: hit, cached: true });

    if (pending[key]) return pending[key];

    var work = (async function () {
      if (isOperational()) {
        var res = await apiGet('/api/users/me/profile/full');
        if (res && res.ok && res.data) {
          setCached(key, res.data);
          return { ok: true, mode: 'API_OPERATIONAL', data: res.data };
        }
        return res || { ok: false, error: 'USER_DATA_PROFILE_FETCH_FAILED' };
      }
      if (isDryRun()) {
        return {
          ok: true,
          mode: 'API_DRY_RUN',
          data: publicProfile
            ? publicProfile.buildUnavailableProfileViewModel(userId, 'API_DRY_RUN')
            : { userId: userId, dataStatus: 'UNAVAILABLE' },
          note: 'API_DRY_RUN: 실제 fetch 미호출',
        };
      }
      var legacy = publicProfile
        ? publicProfile.buildUnavailableProfileViewModel(userId, 'LEGACY_LOCAL')
        : { userId: userId, dataStatus: 'UNAVAILABLE' };
      setCached(key, legacy);
      return { ok: true, mode: 'LEGACY_LOCAL', data: legacy };
    })();

    pending[key] = work.then(function (r) {
      delete pending[key];
      return r;
    }, function (e) {
      delete pending[key];
      throw e;
    });
    return pending[key];
  }

  function updateSelfProfile(patch) {
    if (isOperational()) {
      return fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: makeHeaders(),
        body: JSON.stringify(patch || {}),
      }).then(function (r) { return r.json(); }).then(function (res) {
        invalidateProfileCache(getCurrentUserId());
        return res;
      });
    }
    if (isDryRun()) {
      var validation = schema ? schema.validateProfilePatch(patch) : { valid: true };
      return Promise.resolve({
        ok: true,
        mode: 'API_DRY_RUN',
        validation: validation,
        note: 'API_DRY_RUN: 실제 fetch 쓰기 미호출',
      });
    }
    return Promise.resolve({ ok: false, error: 'USER_DATA_API_NOT_ACTIVATED', mode: getDataMode() });
  }

  function dryRunPublicProfile(input) {
    var src = input || {};
    var contract = dataAdapter
      ? dataAdapter.mapLegacyUserToPublicProfile(src.legacy || src, {
        userId: src.userId,
        isMine: !!src.isMine,
      })
      : src;
    var validation = publicProfile
      ? publicProfile.validatePublicProfileContract(contract)
      : { valid: true };
    var leaks = publicProfile
      ? publicProfile.detectPublicLeaks(contract)
      : { publicLeakDetected: false, leakedFields: [] };
    return {
      ok: true,
      mode: 'API_DRY_RUN',
      contract: contract,
      validation: validation,
      privacy: leaks,
      note: 'API_DRY_RUN: 실제 서버 미호출',
    };
  }

  /**
   * 개발용 프로필 검사 — 민감 정보 미출력
   */
  function inspectUserProfileData(userId) {
    var mode = getDataMode();
    var userIdValid = schema ? schema.validateUserId(userId, { strict: true }).valid : false;
    var warnings = [];
    var result = {
      mode: mode,
      userIdValid: userIdValid,
      source: mode === 'API_OPERATIONAL' ? 'API' : 'LEGACY_OR_DRY_RUN',
      profile: { found: false, dataStatus: null, missingFields: [] },
      progression: { found: false, level: null, xpAvailable: false },
      territory: { found: false, source: 'UNAVAILABLE', available: false },
      featuredAchievements: { count: 0, invalidKeys: [] },
      followState: { available: false },
      privacy: { publicLeakDetected: false, leakedFields: [] },
      warnings: warnings,
    };

    if (!userIdValid) {
      warnings.push('USER_ID_INVALID');
      return result;
    }

    return getPublicProfile(userId).then(function (res) {
      var data = res && res.data;
      if (!data) {
        warnings.push('PROFILE_UNAVAILABLE');
        return result;
      }
      result.profile.found = data.dataStatus === 'READY' || data.dataStatus === 'LEGACY_MOCK' || data.dataStatus === 'PRIVATE';
      result.profile.dataStatus = data.dataStatus;
      if (publicProfile) {
        var v = publicProfile.validatePublicProfileContract(data);
        result.profile.missingFields = v.errors || [];
        result.privacy = publicProfile.detectPublicLeaks(data);
      }
      result.progression.found = data.level != null;
      result.progression.level = data.level;
      result.progression.xpAvailable = data.xp != null; // public이면 false 여야 함
      if (data.xp != null) warnings.push('XP_LEAKED_IN_PUBLIC');
      result.territory.found = data.territory != null;
      result.territory.available = data.territory != null;
      result.territory.source = data.territory != null ? 'PROFILE_OR_ADAPTER' : 'UNAVAILABLE';
      result.featuredAchievements.count = Array.isArray(data.featuredAchievements)
        ? data.featuredAchievements.length
        : 0;
      result.followState.available = typeof data.isFollowing === 'boolean';
      return result;
    });
  }

  // 테스트용 캐시 훅
  function _getCacheForTest() { return cache; }
  function _setCacheEntryForTest(key, value, expiresAt) {
    cache[key] = { value: value, expiresAt: expiresAt || (Date.now() + TTL_MS) };
  }
  function _clearCacheForTest() {
    cache = Object.create(null);
    pending = Object.create(null);
  }

  global.UserProfileApiClient = {
    getPublicProfile: getPublicProfile,
    getSelfProfile: getSelfProfile,
    updateSelfProfile: updateSelfProfile,
    getProfileDataMode: getDataMode,
    dryRunPublicProfile: dryRunPublicProfile,
    invalidateProfileCache: invalidateProfileCache,
    invalidateFollowStateCache: invalidateFollowStateCache,
    inspectUserProfileData: inspectUserProfileData,
    PROFILE_CACHE_TTL_MS: TTL_MS,
    _getCacheForTest: _getCacheForTest,
    _setCacheEntryForTest: _setCacheEntryForTest,
    _clearCacheForTest: _clearCacheForTest,
  };

  global.__scInspectUserProfileData = function (userId) {
    return inspectUserProfileData(userId);
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = global.UserProfileApiClient;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
