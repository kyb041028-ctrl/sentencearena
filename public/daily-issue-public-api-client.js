/**
 * 데일리 이슈 공개 API 클라이언트 1차
 * GET /api/daily-issues · GET /api/daily-issues/:id
 * PUBLISHED·미만료만 (서버가 필터). choices/stance/rawText 미사용.
 */
(function (global) {
  'use strict';

  function makeError(code, message, status) {
    var err = new Error(message || code);
    err.code = code;
    err.status = status || 0;
    return err;
  }

  function parseJsonSafe(res) {
    return res.text().then(function (t) {
      if (!t) return {};
      try {
        return JSON.parse(t);
      } catch (_) {
        return { ok: false, error: { code: 'INVALID_JSON', message: '응답 파싱 실패' } };
      }
    });
  }

  function request(path) {
    var fetchFn = global.fetch;
    if (typeof fetchFn !== 'function') {
      return Promise.reject(makeError('FETCH_UNAVAILABLE', 'fetch를 사용할 수 없습니다'));
    }
    return fetchFn(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }).then(function (res) {
      return parseJsonSafe(res).then(function (body) {
        if (!res.ok || body.ok === false) {
          var code = (body.error && body.error.code) || 'HTTP_' + res.status;
          var msg = (body.error && body.error.message) || '요청 실패';
          throw makeError(code, msg, res.status);
        }
        return body.data != null ? body.data : body;
      });
    });
  }

  function listPublished(opts) {
    var o = opts || {};
    var params = new URLSearchParams();
    if (o.limit != null) params.set('limit', String(o.limit));
    if (o.offset != null) params.set('offset', String(o.offset));
    if (o.category) params.set('category', String(o.category));
    var qs = params.toString();
    return request('/api/daily-issues' + (qs ? '?' + qs : ''));
  }

  function getPublished(id) {
    return request('/api/daily-issues/' + encodeURIComponent(String(id || '')));
  }

  var api = {
    listPublished: listPublished,
    getPublished: getPublished,
  };

  global.DailyIssuePublicApiClient = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
