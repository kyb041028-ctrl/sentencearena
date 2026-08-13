/**
 * 센텐스아레나 — 게시판 API 클라이언트 (운영 adapter)
 * - LEGACY_LOCAL / API_DRY_RUN 기본: 실제 쓰기 차단
 * - API_OPERATIONAL + BOARD_OPERATIONAL 활성화 후에만 서버 저장
 */
(function (global) {
  'use strict';

  var BoardConfig = global.BoardConfigCore;
  var BoardSchema = global.BoardSchemaCore;
  var LegacyAdapter = global.BoardLegacyAdapter;

  function getAuthToken() {
    return '';
  }

  function makeError(code, message) {
    var err = new Error(message || code);
    err.code = code;
    return err;
  }

  function resolveDataMode(opts) {
    var src = opts || {};
    if (src.dataMode) {
      var direct = String(src.dataMode).trim().toUpperCase();
      if (direct === 'API_DRY_RUN' || direct === 'API_OPERATIONAL' || direct === 'LEGACY_LOCAL') {
        return direct;
      }
    }
    if (BoardConfig && typeof BoardConfig.resolveBoardDataMode === 'function') {
      return BoardConfig.resolveBoardDataMode(src);
    }
    return 'LEGACY_LOCAL';
  }

  function normalizeTerritoryForApi(value) {
    if (!BoardConfig) return value;
    return BoardConfig.normalizeBoardTerritory(value, { allowLegacy: true, strict: false });
  }

  function validateCommentPayload(body) {
    if (!BoardSchema) return { valid: true, errors: [] };
    return BoardSchema.validateCommentInput({
      content: body && body.content != null ? body.content : body,
      parentCommentId: body && body.parentCommentId,
    });
  }

  function validatePostPayload(body) {
    if (!BoardSchema) return { valid: true, errors: [] };
    var territory = body && body.territory != null ? normalizeTerritoryForApi(body.territory) : undefined;
    return BoardSchema.validatePostInput({
      title: body && body.title,
      content: body && body.content,
      territory: territory,
    });
  }

  function validateReactionPayload(body) {
    if (!BoardSchema) return { valid: true, errors: [] };
    var type = body && (body.reactionType || body.type);
    if (BoardConfig) {
      if (BoardConfig.isSocialReactionType(type) || BoardConfig.isDeferredLegacyReactionType(type)) {
        return { valid: false, errors: ['BOARD_LEGACY_REACTION_NOT_SUPPORTED'] };
      }
    }
    return BoardSchema.validateReactionInput(body || {});
  }

  function sanitizeWriteBody(method, path, body) {
    var snapshot = body == null ? null : JSON.parse(JSON.stringify(body));
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    if (snapshot.territory != null) {
      var normalized = normalizeTerritoryForApi(snapshot.territory);
      if (!normalized) throw makeError('BOARD_TERRITORY_INVALID');
      snapshot.territory = normalized;
    }
    delete snapshot.actorTerritory;
    delete snapshot.audienceScope;
    delete snapshot.empathy;
    delete snapshot.planetVoters;
    return snapshot;
  }

  function createBoardApiClient(options) {
    var opts = options || {};
    var baseUrl = opts.baseUrl || '/api/board';
    var dataMode = resolveDataMode(opts);
    var writeEnabled = dataMode === 'API_OPERATIONAL';

    function request(method, path, body, meta) {
      var isWrite = method !== 'GET';
      var payload = body == null ? undefined : sanitizeWriteBody(method, path, body);

      if (isWrite && !writeEnabled) {
        if (dataMode === 'API_DRY_RUN') {
          return Promise.resolve({
            ok: true,
            dryRun: true,
            dataMode: dataMode,
            method: method,
            path: path,
            body: payload,
            meta: meta || null,
          });
        }
        return Promise.reject(makeError('BOARD_API_NOT_ACTIVATED', 'Board API writes are disabled until API_OPERATIONAL mode.'));
      }

      var headers = { 'Content-Type': 'application/json' };
      return global.fetch(baseUrl + path, {
        method: method,
        headers: headers,
        body: payload == null ? undefined : JSON.stringify(payload),
        credentials: 'same-origin',
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data || data.ok === false) {
            var err = makeError((data && data.error) || 'BOARD_REQUEST_FAILED');
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
    }

    function createPost(body) {
      var validation = validatePostPayload(body);
      if (!validation.valid) throw makeError(validation.errors[0]);
      return request('POST', '/posts', body, { kind: 'post' });
    }

    function createMemberCanonicalPost(body) {
      var validation = validatePostPayload(body);
      if (!validation.valid) {
        return Promise.reject(makeError(validation.errors[0]));
      }
      var payload = sanitizeWriteBody('POST', '/posts', body);
      function doFetch(token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        return global.fetch(baseUrl + '/posts', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload || {}),
          credentials: 'same-origin',
        }).then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok || !data || data.ok === false) {
              var err = makeError((data && data.error) || 'BOARD_REQUEST_FAILED');
              err.status = res.status;
              throw err;
            }
            return data;
          });
        });
      }
      if (global.ScAuth && typeof global.ScAuth.getAccessToken === 'function') {
        return global.ScAuth.getAccessToken().then(doFetch);
      }
      return doFetch(null);
    }

    function createComment(postId, body) {
      var validation = validateCommentPayload(body);
      if (!validation.valid) throw makeError(validation.errors[0]);
      return request('POST', '/posts/' + encodeURIComponent(postId) + '/comments', body, { kind: 'comment' });
    }

    function toggleReaction(body) {
      var validation = validateReactionPayload(body);
      if (!validation.valid) throw makeError(validation.errors[0]);
      return request('POST', '/reactions/toggle', body, { kind: 'reaction' });
    }

    return {
      getDataMode: function () {
        return dataMode;
      },
      isWriteEnabled: function () {
        return writeEnabled;
      },
      validateCommentPayload: validateCommentPayload,
      validatePostPayload: validatePostPayload,
      validateReactionPayload: validateReactionPayload,
      listPosts: function (query) {
        var q = [];
        if (query && query.territory) {
          var t = normalizeTerritoryForApi(query.territory);
          if (!t) return Promise.reject(makeError('BOARD_TERRITORY_INVALID'));
          q.push('territory=' + encodeURIComponent(t));
        }
        if (query && query.status) q.push('status=' + encodeURIComponent(query.status));
        return request('GET', '/posts' + (q.length ? '?' + q.join('&') : ''));
      },
      getPost: function (postId) {
        return request('GET', '/posts/' + encodeURIComponent(postId));
      },
      createPost: createPost,
      createMemberCanonicalPost: createMemberCanonicalPost,
      updatePost: function (postId, body) {
        var validation = validatePostPayload(body);
        if (!validation.valid) throw makeError(validation.errors[0]);
        return request('PATCH', '/posts/' + encodeURIComponent(postId), body, { kind: 'post' });
      },
      deletePost: function (postId) {
        return request('DELETE', '/posts/' + encodeURIComponent(postId), null, { kind: 'post' });
      },
      listComments: function (postId) {
        return request('GET', '/posts/' + encodeURIComponent(postId) + '/comments');
      },
      createComment: createComment,
      updateComment: function (commentId, body) {
        var validation = validateCommentPayload(body);
        if (!validation.valid) throw makeError(validation.errors[0]);
        return request('PATCH', '/comments/' + encodeURIComponent(commentId), body, { kind: 'comment' });
      },
      deleteComment: function (commentId) {
        return request('DELETE', '/comments/' + encodeURIComponent(commentId), null, { kind: 'comment' });
      },
      toggleReaction: toggleReaction,
      createReport: function (body) {
        return request('POST', '/reports', body, { kind: 'report' });
      },
      dryRunLegacyPost: function (legacyPost, context) {
        if (!LegacyAdapter) throw makeError('BOARD_LEGACY_ADAPTER_REQUIRED');
        var mapped = LegacyAdapter.mapLegacyPostToBoardDraft(legacyPost, context || {});
        return Promise.resolve({
          ok: true,
          dryRun: true,
          dataMode: dataMode,
          draft: mapped.draft,
          warnings: mapped.warnings,
          social: mapped.social,
        });
      },
    };
  }

  global.createBoardApiClient = createBoardApiClient;
  global.resolveBoardDataMode = resolveDataMode;
  global.createMemberCanonicalBoardPost = function (body) {
    var client = createBoardApiClient({ dataMode: 'API_OPERATIONAL' });
    return client.createMemberCanonicalPost(body);
  };
  if (typeof global.window !== 'undefined') {
    global.window.__scCreateBoardApiClient = createBoardApiClient;
    global.window.__scResolveBoardDataMode = resolveDataMode;
  }
})(typeof window !== 'undefined' ? window : globalThis);
