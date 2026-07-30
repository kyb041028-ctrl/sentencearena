/**
 * 외계 관측 API client — 기본 LEGACY_LOCAL / 운영 비활성
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlienObservationApiClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function factory() {
  'use strict';

  var MODE = 'LEGACY_LOCAL';
  var OPERATIONAL = false;
  var cache = Object.create(null);
  var pending = Object.create(null);
  var TTL_MS = 15000;

  function setMode(mode) {
    var m = String(mode || 'LEGACY_LOCAL').toUpperCase();
    if (m === 'API_OPERATIONAL') {
      MODE = 'LEGACY_LOCAL';
      OPERATIONAL = false;
      return;
    }
    MODE = m === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL';
    OPERATIONAL = false;
  }

  function getMode() {
    return MODE;
  }

  function isOperational() {
    return false;
  }

  function invalidateCache(postId) {
    if (!postId) {
      cache = Object.create(null);
      return;
    }
    Object.keys(cache).forEach(function (k) {
      if (k.indexOf(String(postId) + '::') === 0) delete cache[k];
    });
  }

  async function fetchJson(path) {
    if (!OPERATIONAL) {
      return { ok: false, error: 'ALIEN_SYSTEM_NOT_ACTIVATED', mode: MODE };
    }
    if (MODE === 'API_DRY_RUN') {
      return { ok: true, dryRun: true, note: 'NO_FETCH_WRITE' };
    }
    var res = await fetch(path, { credentials: 'same-origin' });
    return res.json();
  }

  async function getObservationPost(postId, filter) {
    var key = String(postId) + '::' + String(filter || 'ALL');
    var hit = cache[key];
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    if (pending[key]) return pending[key];
    var p = fetchJson('/api/alien/observation/posts/' + encodeURIComponent(postId) + '?filter=' + encodeURIComponent(filter || 'ALL'))
      .then(function (value) {
        cache[key] = { at: Date.now(), value: value };
        delete pending[key];
        return value;
      })
      .catch(function (err) {
        delete pending[key];
        throw err;
      });
    pending[key] = p;
    return p;
  }

  async function postAlienComment(postId, body) {
    if (MODE === 'API_DRY_RUN') {
      return { ok: true, dryRun: true, note: 'NO_WRITE' };
    }
    if (!OPERATIONAL) {
      return { ok: false, error: 'ALIEN_SYSTEM_NOT_ACTIVATED' };
    }
    invalidateCache(postId);
    return { ok: false, error: 'ALIEN_SYSTEM_NOT_ACTIVATED' };
  }

  async function toggleAlienReaction(body) {
    if (MODE === 'API_DRY_RUN') {
      return { ok: true, dryRun: true, note: 'NO_WRITE' };
    }
    if (body && body.postId) invalidateCache(body.postId);
    return { ok: false, error: 'ALIEN_SYSTEM_NOT_ACTIVATED' };
  }

  return {
    setMode: setMode,
    getMode: getMode,
    isOperational: isOperational,
    invalidateCache: invalidateCache,
    getObservationPost: getObservationPost,
    postAlienComment: postAlienComment,
    toggleAlienReaction: toggleAlienReaction,
    TTL_MS: TTL_MS,
  };
});
