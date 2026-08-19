/**
 * 데일리 이슈 공개 API 클라이언트 1차
 * GET /api/daily-issues · GET /api/daily-issues/:id
 * POST /api/daily-issues/:id/reactions/toggle
 * PUBLISHED·미만료만 (서버가 필터). choices/stance/rawText/alignment_direction 미사용.
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

  function request(path, options) {
    var opt = options || {};
    var fetchFn = global.fetch;
    if (typeof fetchFn !== 'function') {
      return Promise.reject(makeError('FETCH_UNAVAILABLE', 'fetch를 사용할 수 없습니다'));
    }
    var headers = { Accept: 'application/json' };
    if (opt.body != null) headers['Content-Type'] = 'application/json';
    function withToken(token) {
      if (token) headers.Authorization = 'Bearer ' + String(token);
      return fetchFn(path, {
        method: opt.method || 'GET',
        credentials: 'same-origin',
        headers: headers,
        cache: 'no-store',
        body: opt.body != null ? JSON.stringify(opt.body) : undefined,
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
    if (opt.auth === false) return withToken('');
    if (global.ScAuth && typeof global.ScAuth.getAccessToken === 'function') {
      return Promise.resolve(global.ScAuth.getAccessToken()).then(function (token) {
        return withToken(token || '');
      });
    }
    return withToken('');
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

  function toggleReaction(id, reactionType) {
    return request('/api/daily-issues/' + encodeURIComponent(String(id || '')) + '/reactions/toggle', {
      method: 'POST',
      body: { reactionType: reactionType },
    });
  }

  function listComments(id) {
    return request('/api/daily-issues/' + encodeURIComponent(String(id || '')) + '/comments');
  }

  function createComment(id, body) {
    return request('/api/daily-issues/' + encodeURIComponent(String(id || '')) + '/comments', {
      method: 'POST',
      body: { body: body },
    });
  }

  function deleteComment(id, commentId) {
    return request(
      '/api/daily-issues/' +
        encodeURIComponent(String(id || '')) +
        '/comments/' +
        encodeURIComponent(String(commentId || '')),
      { method: 'DELETE' },
    );
  }

  var api = {
    listPublished: listPublished,
    getPublished: getPublished,
    toggleReaction: toggleReaction,
    listComments: listComments,
    createComment: createComment,
    deleteComment: deleteComment,
  };

  global.DailyIssuePublicApiClient = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
