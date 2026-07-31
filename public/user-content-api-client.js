/**
 * 사용자 콘텐츠 API client — LEGACY_LOCAL 기본 · OPERATIONAL 비활성
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./user-content-data-adapter'),
      require('../shared/user-content-list-core')
    );
  } else {
    root.UserContentApiClient = factory(root.UserContentDataAdapter, root.UserContentListCore);
  }
})(typeof self !== 'undefined' ? self : this, function factory(adapter, core) {
  'use strict';

  var MODE = {
    LEGACY_LOCAL: 'LEGACY_LOCAL',
    API_DRY_RUN: 'API_DRY_RUN',
    API_OPERATIONAL: 'API_OPERATIONAL',
  };

  var mode = MODE.LEGACY_LOCAL;
  var cache = Object.create(null);

  function setMode(next) {
    var m = String(next || MODE.LEGACY_LOCAL).toUpperCase();
    if (m === MODE.API_OPERATIONAL) {
      mode = MODE.LEGACY_LOCAL;
      return mode;
    }
    if (m === MODE.API_DRY_RUN || m === MODE.LEGACY_LOCAL) mode = m;
    else mode = MODE.LEGACY_LOCAL;
    return mode;
  }

  function getMode() {
    return mode;
  }

  function isActivated() {
    return false;
  }

  function invalidateUserContentCache(profileUserId) {
    var prefix = 'user-content:' + String(profileUserId || '');
    Object.keys(cache).forEach(function (k) {
      if (k.indexOf(prefix) === 0) delete cache[k];
    });
  }

  function listUserContent(query) {
    var q = query || {};
    if (mode === MODE.API_DRY_RUN) {
      return Promise.resolve({
        dryRun: true,
        note: 'NO_WRITE',
        dataStatus: core.DATA_STATUS.UNAVAILABLE,
        source: MODE.API_DRY_RUN,
        items: [],
        totalItems: 0,
        totalPages: 0,
        page: 1,
        pageSize: core.DEFAULT_PAGE_SIZE,
        contentType: core.normalizeUserContentType(q.contentType) || core.CONTENT_TYPE.POSTS,
        profileUserId: q.profileUserId || null,
        warnings: [],
      });
    }
    var key = adapter.buildCacheKey({
      profileUserId: q.profileUserId,
      viewerUserId: q.viewerUserId,
      contentType: q.contentType,
      page: q.page || 1,
    });
    if (cache[key] && cache[key].expiresAt > Date.now()) {
      return Promise.resolve(Object.assign({ cached: true }, cache[key].data));
    }
    var data = adapter.listUserContentLocal(q);
    cache[key] = { data: data, expiresAt: Date.now() + 15000 };
    return Promise.resolve(data);
  }

  return {
    MODE: MODE,
    setMode: setMode,
    getMode: getMode,
    isActivated: isActivated,
    listUserContent: listUserContent,
    invalidateUserContentCache: invalidateUserContentCache,
    _clearCacheForTest: function () {
      cache = Object.create(null);
    },
  };
});
