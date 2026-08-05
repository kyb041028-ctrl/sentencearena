/**
 * 데일리 이슈 관리자 검수 화면 1차
 * — 토큰: sessionStorage만 · 하드코딩·쿼리·쿠키·영구브라우저저장 금지
 * — 상태 변경: 관리자 API만 · approve ≠ publish
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ScAdminDailyIssue = api;
  if (typeof document !== 'undefined' && !root.__SC_ADMIN_DAILY_ISSUE_NO_AUTO__) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        api.mount();
      });
    } else {
      api.mount();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function scAdminDailyIssueFactory() {
  'use strict';

  var TOKEN_KEY = 'sc_admin_daily_issue_api_token';
  var REVIEWER_ID = 'dev-admin';
  var MAX_REASON_TEXT = 500;

  /** API allowlist — lifecycle-core와 동일 (프론트 임의 코드 생성 금지) */
  var HOLD_REASONS = [
    'NEED_MORE_INDEPENDENT_SOURCE',
    'EVENT_MATCH_UNCERTAIN',
    'EVIDENCE_REVIEW_REQUIRED',
    'TITLE_REVIEW_REQUIRED',
    'SOURCE_DISAGREEMENT_REVIEW',
    'DUPLICATE_REVIEW_REQUIRED',
    'UPDATE_OR_NEW_ISSUE_UNCERTAIN',
    'OTHER',
  ];
  var REJECT_REASONS = [
    'WRONG_CLUSTER',
    'DUPLICATE_EVENT',
    'MISLEADING_TITLE',
    'SOURCE_QUALITY_CONCERN',
    'EVIDENCE_MISMATCH',
    'CLAIM_OVERSTATEMENT',
    'NO_NEW_DEVELOPMENT',
    'BACKGROUND_ONLY',
    'STALE_EVENT',
    'UNSUITABLE_FOR_DAILY_ISSUE',
    'OTHER',
  ];

  var ACTION_TO_STATUS = {
    approve: 'APPROVED',
    hold: 'HELD',
    reject: 'REJECTED',
    publish: 'PUBLISHED',
    retire: 'RETIRED',
    expire: 'EXPIRED',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(iso) {
    if (!iso) return '—';
    var d = Date.parse(iso);
    if (!isFinite(d)) return escapeHtml(iso);
    try {
      return escapeHtml(new Date(d).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'));
    } catch (_) {
      return escapeHtml(iso);
    }
  }

  function humanError(status, code, requestId) {
    var msg =
      status === 400
        ? '입력값을 확인해 주세요.'
        : status === 401
          ? '관리자 토큰이 올바르지 않습니다. 다시 입력해 주세요.'
          : status === 403
            ? '요청 권한이 없거나 허용되지 않은 인증 방식입니다.'
            : status === 404
              ? '항목이 없거나 이미 제거되었습니다.'
              : status === 409
                ? '다른 작업으로 상태가 변경되었습니다. 최신 내용을 다시 불러옵니다.'
                : status === 422
                  ? '품질·최신성·사유 검증에 실패했습니다.'
                  : status === 429
                    ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
                    : status === 503
                      ? '데이터베이스에 연결할 수 없습니다.'
                      : status >= 500
                        ? '내부 오류가 발생했습니다.'
                        : '요청을 처리하지 못했습니다.';
    if (code === 'ADMIN_TOKEN_MISSING' || code === 'ADMIN_TOKEN_INVALID' || code === 'ADMIN_TOKEN_NOT_CONFIGURED') {
      msg = '토큰이 올바르지 않습니다.';
    }
    if (code === 'QUERY_TOKEN_FORBIDDEN') {
      msg = '허용되지 않은 인증 방식입니다.';
    }
    if (code === 'DATABASE_UNAVAILABLE') {
      msg = '데이터베이스에 연결할 수 없습니다.';
    }
    return { message: msg, requestId: requestId || null, code: code || null };
  }

  function createTokenStore(storage) {
    var store = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    return {
      get: function () {
        if (!store) return '';
        try {
          return String(store.getItem(TOKEN_KEY) || '');
        } catch (_) {
          return '';
        }
      },
      set: function (token) {
        if (!store) return;
        store.setItem(TOKEN_KEY, String(token || ''));
      },
      clear: function () {
        if (!store) return;
        try {
          store.removeItem(TOKEN_KEY);
        } catch (_) {}
      },
      KEY: TOKEN_KEY,
    };
  }

  function createApiClient(options) {
    var opt = options || {};
    var tokenStore = opt.tokenStore || createTokenStore();
    var fetchFn = opt.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
    var baseUrl = opt.baseUrl || '';

    async function request(method, path, body) {
      var token = tokenStore.get();
      var headers = { Accept: 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      var init = { method: method, headers: headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      var res = await fetchFn(baseUrl + path, init);
      var json = null;
      var raw = '';
      try {
        raw = await res.text();
        json = raw ? JSON.parse(raw) : null;
      } catch (_) {
        json = null;
      }
      return {
        status: res.status,
        ok: !!(json && json.ok),
        body: json,
        requestId: (json && json.requestId) || (res.headers && res.headers.get && res.headers.get('x-request-id')) || null,
        errorCode: json && json.error && json.error.code,
      };
    }

    return {
      tokenStore: tokenStore,
      request: request,
      listReview: function (query) {
        var q = query || {};
        var params = new URLSearchParams();
        if (q.status) params.set('status', q.status);
        if (q.category) params.set('category', q.category);
        if (q.limit) params.set('limit', String(q.limit));
        if (q.offset != null) params.set('offset', String(q.offset));
        var qs = params.toString();
        return request('GET', '/api/admin/daily-issues/review' + (qs ? '?' + qs : ''));
      },
      getReview: function (id) {
        return request('GET', '/api/admin/daily-issues/review/' + encodeURIComponent(id));
      },
      getHistory: function (id) {
        return request('GET', '/api/admin/daily-issues/review/' + encodeURIComponent(id) + '/history?limit=50');
      },
      transition: function (id, action, payload) {
        return request('POST', '/api/admin/daily-issues/review/' + encodeURIComponent(id) + '/' + action, payload);
      },
      revalidate: function (id) {
        return request('POST', '/api/admin/daily-issues/review/' + encodeURIComponent(id) + '/revalidate', {});
      },
      probeAuth: function () {
        return request('GET', '/api/admin/daily-issues/review?limit=1');
      },
    };
  }

  function buildTransitionBody(item, extra) {
    var body = {
      expectedStatus: item.status,
      expectedLockVersion: item.lockVersion,
      reviewerId: REVIEWER_ID,
    };
    if (extra) {
      if (extra.reasonCode) body.reasonCode = extra.reasonCode;
      if (extra.reasonText != null) body.reasonText = String(extra.reasonText).slice(0, MAX_REASON_TEXT);
    }
    return body;
  }

  function canAction(item, action) {
    if (!item) return false;
    var next = ACTION_TO_STATUS[action];
    if (!next) return action === 'revalidate';
    var allowed = item.allowedNextStatuses || [];
    return allowed.indexOf(next) >= 0;
  }

  function createController(deps) {
    var d = deps || {};
    var api = d.api || createApiClient(d);
    var doc = d.document || (typeof document !== 'undefined' ? document : null);
    var state = {
      authenticated: false,
      items: [],
      total: 0,
      offset: 0,
      selectedId: null,
      detail: null,
      history: [],
      loadingList: false,
      loadingDetail: false,
      reasonMode: null,
      busy: false,
    };

    function $(id) {
      return doc ? doc.getElementById(id) : null;
    }

    function setBanner(message, isError, requestId) {
      var el = $('sc-admin-daily-issue-banner');
      if (!el) return;
      el.className = 'sc-admin-daily-issue-banner' + (isError ? ' is-error' : '');
      if (!message) {
        el.textContent = '';
        return;
      }
      el.textContent = message;
      if (requestId) {
        var span = doc.createElement('span');
        span.className = 'sc-admin-daily-issue-reqid';
        span.textContent = 'requestId: ' + requestId;
        el.appendChild(span);
      }
    }

    function showTokenModal(message) {
      var modal = $('sc-admin-daily-issue-token-modal');
      var app = $('sc-admin-daily-issue-app');
      var err = $('sc-admin-daily-issue-token-error');
      var input = $('sc-admin-daily-issue-token-input');
      if (app) app.hidden = true;
      if (modal) modal.hidden = false;
      if (err) err.textContent = message || '';
      if (input) {
        input.value = '';
        setTimeout(function () {
          input.focus();
        }, 0);
      }
      state.authenticated = false;
    }

    function hideTokenModal() {
      var modal = $('sc-admin-daily-issue-token-modal');
      var app = $('sc-admin-daily-issue-app');
      if (modal) modal.hidden = true;
      if (app) app.hidden = false;
      state.authenticated = true;
    }

    function logout() {
      api.tokenStore.clear();
      state.items = [];
      state.detail = null;
      state.history = [];
      state.selectedId = null;
      renderList();
      renderDetail();
      setBanner('');
      showTokenModal('');
    }

    function handleAuthFailure(res) {
      api.tokenStore.clear();
      var h = humanError(res.status, res.errorCode, res.requestId);
      showTokenModal(h.message);
    }

    async function handleResponse(res, opts) {
      var o = opts || {};
      if (res.status === 401) {
        handleAuthFailure(res);
        return false;
      }
      if (res.status === 409) {
        var h409 = humanError(409, res.errorCode, res.requestId);
        setBanner(h409.message, true, h409.requestId);
        await refreshAll({ keepSelection: true });
        return false;
      }
      if (!res.ok) {
        var h = humanError(res.status, res.errorCode, res.requestId);
        if (o.tokenProbe) {
          showTokenModal(h.message);
        } else {
          setBanner(h.message, true, h.requestId);
        }
        return false;
      }
      return true;
    }

    function renderList() {
      var list = $('sc-admin-daily-issue-list');
      var empty = $('sc-admin-daily-issue-list-empty');
      var loading = $('sc-admin-daily-issue-list-loading');
      var meta = $('sc-admin-daily-issue-list-meta');
      var more = $('sc-admin-daily-issue-more');
      if (!list) return;
      if (loading) loading.hidden = !state.loadingList;
      list.innerHTML = '';
      if (!state.loadingList && !state.items.length) {
        if (empty) empty.hidden = false;
      } else if (empty) {
        empty.hidden = true;
      }
      if (meta) {
        meta.textContent = state.total ? state.items.length + ' / ' + state.total + '건' : state.items.length + '건';
      }
      state.items.forEach(function (it) {
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.className =
          'sc-admin-daily-issue-list-item' + (it.id === state.selectedId ? ' is-selected' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', it.id === state.selectedId ? 'true' : 'false');
        btn.dataset.id = it.id;
        btn.innerHTML =
          '<div class="sc-admin-daily-issue-item-title">' +
          escapeHtml(it.title || '(제목 없음)') +
          '</div>' +
          '<div class="sc-admin-daily-issue-item-meta">' +
          '<span class="sc-admin-daily-issue-badge" data-status="' +
          escapeHtml(it.status) +
          '" data-label="' +
          escapeHtml(it.status) +
          '"></span>' +
          '<span>' +
          escapeHtml(it.category || '—') +
          '</span>' +
          '<span>출처 ' +
          escapeHtml(String(it.sourceCount != null ? it.sourceCount : 0)) +
          '</span>' +
          '<span>독립 ' +
          escapeHtml(String(it.independentSourceCount != null ? it.independentSourceCount : 0)) +
          '</span>' +
          '<span>' +
          escapeHtml(it.freshnessClass || '—') +
          '</span>' +
          '<span>대기 ' +
          formatTime(it.queuedAt) +
          '</span>' +
          '<span>만료 ' +
          formatTime(it.expiresAt) +
          '</span>' +
          '</div>';
        btn.addEventListener('click', function () {
          selectItem(it.id);
        });
        list.appendChild(btn);
      });
      if (more) {
        more.hidden = !(state.items.length < state.total);
      }
    }

    function renderActions(item) {
      var box = $('sc-admin-daily-issue-actions');
      if (!box) return;
      box.innerHTML = '';
      if (!item) return;
      var defs = [
        { action: 'approve', label: '승인', className: '' },
        { action: 'hold', label: '보류', className: '' },
        { action: 'reject', label: '반려', className: 'sc-admin-daily-issue-btn-danger' },
        { action: 'publish', label: '게시', className: '' },
        { action: 'retire', label: '종료', className: 'sc-admin-daily-issue-btn-danger' },
        { action: 'revalidate', label: '재검증', className: 'sc-admin-daily-issue-btn-ghost' },
      ];
      defs.forEach(function (def) {
        if (def.action !== 'revalidate' && !canAction(item, def.action)) return;
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'sc-admin-daily-issue-btn ' + (def.className || '');
        b.textContent = def.label;
        b.disabled = !!state.busy;
        b.addEventListener('click', function () {
          onAction(def.action);
        });
        box.appendChild(b);
      });
    }

    function renderDetail() {
      var wrap = $('sc-admin-daily-issue-detail');
      var empty = $('sc-admin-daily-issue-detail-empty');
      if (!wrap) return;
      var item = state.detail;
      if (!item) {
        wrap.hidden = true;
        if (empty) empty.hidden = false;
        renderActions(null);
        return;
      }
      if (empty) empty.hidden = true;
      wrap.hidden = false;
      renderActions(item);

      var claimsHtml = (item.claims || [])
        .map(function (c) {
          return (
            '<div class="sc-admin-daily-issue-claim">' +
            '<strong>' +
            escapeHtml(c.classification || '') +
            (c.isCore ? ' · CORE' : '') +
            '</strong>' +
            '<div>' +
            escapeHtml(c.text || '') +
            '</div></div>'
          );
        })
        .join('');

      var sourcesHtml = (item.sourceRefs || [])
        .map(function (s) {
          var href = s.url ? escapeHtml(s.url) : '';
          var link = href
            ? '<a href="' + href + '" target="_blank" rel="noopener noreferrer">원문 열기</a>'
            : '—';
          return (
            '<div class="sc-admin-daily-issue-source">' +
            '<div><strong>' +
            escapeHtml(s.publisher || s.originDomain || '출처') +
            '</strong> · ' +
            escapeHtml(s.originDomain || '') +
            '</div>' +
            '<div>' +
            escapeHtml(s.title || '') +
            '</div>' +
            '<div>게시 ' +
            formatTime(s.publishedAt) +
            ' · 업데이트 ' +
            formatTime(s.updatedAt) +
            ' · ' +
            escapeHtml(s.sourceType || '') +
            '</div>' +
            '<div>' +
            link +
            '</div></div>'
          );
        })
        .join('');

      var evidenceHtml = (item.evidenceSummary || [])
        .map(function (e) {
          return (
            '<div class="sc-admin-daily-issue-claim">' +
            escapeHtml(e.id || '') +
            ' · ' +
            escapeHtml(e.evidenceType || '') +
            '<div>' +
            escapeHtml(e.textPreview || '') +
            '</div></div>'
          );
        })
        .join('') || '<p class="sc-admin-daily-issue-meta">요약 없음</p>';

      var histHtml = (state.history || [])
        .map(function (h) {
          return (
            '<div class="sc-admin-daily-issue-history-row">' +
            escapeHtml(h.action || '') +
            ' · ' +
            escapeHtml(h.fromStatus || '') +
            ' → ' +
            escapeHtml(h.toStatus || '') +
            ' · ' +
            escapeHtml(h.actorId || '') +
            ' · ' +
            formatTime(h.timestamp) +
            (h.reasonCode ? ' · ' + escapeHtml(h.reasonCode) : '') +
            '</div>'
          );
        })
        .join('') || '<p class="sc-admin-daily-issue-meta">이력 없음</p>';

      var q = item.qualityMeta || {};
      var f = item.freshnessMeta || {};
      var dup = item.duplicateMeta || {};

      wrap.innerHTML =
        '<h3>기본</h3><dl class="sc-admin-daily-issue-kv">' +
        '<dt>제목</dt><dd>' +
        escapeHtml(item.title || '') +
        '</dd>' +
        '<dt>상태</dt><dd><span class="sc-admin-daily-issue-badge" data-status="' +
        escapeHtml(item.status) +
        '" data-label="' +
        escapeHtml(item.status) +
        '"></span></dd>' +
        '<dt>lockVersion</dt><dd>' +
        escapeHtml(String(item.lockVersion)) +
        '</dd>' +
        '<dt>허용 다음 상태</dt><dd>' +
        escapeHtml((item.allowedNextStatuses || []).join(', ') || '—') +
        '</dd>' +
        '<dt>게시 만료</dt><dd>' +
        formatTime(item.publishExpiresAt) +
        '</dd>' +
        '</dl>' +
        '<h3>Claims</h3>' +
        (claimsHtml || '<p class="sc-admin-daily-issue-meta">없음</p>') +
        '<h3>출처</h3>' +
        (sourcesHtml || '<p class="sc-admin-daily-issue-meta">없음</p>') +
        '<h3>Evidence 요약</h3>' +
        evidenceHtml +
        '<h3>Quality</h3><dl class="sc-admin-daily-issue-kv">' +
        '<dt>통과</dt><dd>' +
        escapeHtml(String(q.passed)) +
        '</dd>' +
        '<dt>독립 출처</dt><dd>' +
        escapeHtml(String(q.independentSourceCount != null ? q.independentSourceCount : '—')) +
        '</dd>' +
        '<dt>실패 사유</dt><dd>' +
        escapeHtml((q.failureReasons || []).join(', ') || '—') +
        '</dd></dl>' +
        '<h3>Freshness</h3><dl class="sc-admin-daily-issue-kv">' +
        '<dt>등급</dt><dd>' +
        escapeHtml(f.freshnessClass || '—') +
        '</dd>' +
        '<dt>통과</dt><dd>' +
        escapeHtml(String(f.passed)) +
        '</dd>' +
        '<dt>실패 사유</dt><dd>' +
        escapeHtml((f.failureReasons || []).join(', ') || '—') +
        '</dd></dl>' +
        '<h3>Duplicate</h3><dl class="sc-admin-daily-issue-kv">' +
        '<dt>판정</dt><dd>' +
        escapeHtml(dup.decision || '—') +
        '</dd></dl>' +
        '<h3>updateHistory</h3>' +
        ((item.updateHistory || [])
          .map(function (u) {
            return (
              '<div class="sc-admin-daily-issue-history-row">' +
              formatTime(u.at) +
              ' · ' +
              escapeHtml(u.type || '') +
              ' · ' +
              escapeHtml(u.note || '') +
              '</div>'
            );
          })
          .join('') || '<p class="sc-admin-daily-issue-meta">없음</p>') +
        '<h3>감사 이력</h3>' +
        histHtml;

      // Safety: never leave rawText visible if API leaked (should not)
      if (/rawText/i.test(wrap.textContent || '')) {
        wrap.textContent = '표시할 수 없는 데이터가 포함되어 상세를 숨겼습니다.';
      }
    }

    async function loadList(opts) {
      var o = opts || {};
      state.loadingList = true;
      renderList();
      var status = ($('sc-admin-daily-issue-filter-status') || {}).value || '';
      var category = ($('sc-admin-daily-issue-filter-category') || {}).value || '';
      var limit = Number(($('sc-admin-daily-issue-filter-limit') || {}).value || 20);
      var offset = o.append ? state.offset : 0;
      var res = await api.listReview({ status: status, category: category, limit: limit, offset: offset });
      state.loadingList = false;
      if (!(await handleResponse(res))) {
        renderList();
        return;
      }
      var data = (res.body && res.body.data) || {};
      var page = data.items || [];
      if (o.append) {
        state.items = state.items.concat(page);
      } else {
        state.items = page;
      }
      state.total = data.total != null ? data.total : state.items.length;
      state.offset = state.items.length;
      if (state.selectedId && !state.items.some(function (it) { return it.id === state.selectedId; })) {
        if (!o.keepSelection) {
          state.selectedId = null;
          state.detail = null;
          state.history = [];
        }
      }
      renderList();
      if (!state.selectedId && state.items[0] && o.autoSelect !== false) {
        await selectItem(state.items[0].id);
      } else if (state.selectedId && o.reloadDetail) {
        await selectItem(state.selectedId);
      } else {
        renderDetail();
      }
    }

    async function selectItem(id) {
      state.selectedId = id;
      renderList();
      state.loadingDetail = true;
      var detailRes = await api.getReview(id);
      if (!(await handleResponse(detailRes))) {
        state.detail = null;
        renderDetail();
        return;
      }
      state.detail = detailRes.body.data.item;
      var histRes = await api.getHistory(id);
      if (histRes.ok) {
        state.history = (histRes.body.data && histRes.body.data.events) || [];
      } else {
        state.history = [];
      }
      state.loadingDetail = false;
      renderDetail();
    }

    async function refreshAll(opts) {
      await loadList({ keepSelection: true, reloadDetail: true, autoSelect: false });
      if (state.selectedId) await selectItem(state.selectedId);
      void opts;
    }

    function openReasonModal(mode) {
      state.reasonMode = mode;
      var modal = $('sc-admin-daily-issue-reason-modal');
      var title = $('sc-admin-daily-issue-reason-title');
      var sel = $('sc-admin-daily-issue-reason-code');
      var text = $('sc-admin-daily-issue-reason-text');
      var err = $('sc-admin-daily-issue-reason-error');
      if (!modal || !sel) return;
      var codes = mode === 'hold' ? HOLD_REASONS : mode === 'reject' ? REJECT_REASONS : ['MANUAL_RETIRE', 'OTHER'];
      sel.innerHTML = codes
        .map(function (c) {
          return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
        })
        .join('');
      if (title) {
        title.textContent = mode === 'hold' ? '보류 사유' : mode === 'reject' ? '반려 사유' : '종료 사유';
      }
      if (text) text.value = '';
      if (err) err.textContent = '';
      modal.hidden = false;
      sel.focus();
    }

    function closeReasonModal() {
      var modal = $('sc-admin-daily-issue-reason-modal');
      if (modal) modal.hidden = true;
      state.reasonMode = null;
    }

    async function submitReason() {
      var mode = state.reasonMode;
      var code = (($('sc-admin-daily-issue-reason-code') || {}).value || '').trim();
      var text = (($('sc-admin-daily-issue-reason-text') || {}).value || '').trim();
      var err = $('sc-admin-daily-issue-reason-error');
      if (!code) {
        if (err) err.textContent = 'reasonCode는 필수입니다.';
        return;
      }
      if (text.length > MAX_REASON_TEXT) {
        if (err) err.textContent = 'reasonText가 너무 깁니다.';
        return;
      }
      closeReasonModal();
      await runTransition(mode, { reasonCode: code, reasonText: text });
    }

    async function runTransition(action, extra) {
      var item = state.detail;
      if (!item || state.busy) return;
      if (action === 'publish') {
        if (!window.confirm('이 이슈를 게시할까요? (승인 ≠ 게시, 만료 시각은 서버가 계산합니다)')) return;
      }
      if (action === 'retire' && !extra) {
        openReasonModal('retire');
        return;
      }
      state.busy = true;
      renderActions(item);
      var body = buildTransitionBody(item, extra);
      var res = await api.transition(item.id, action, body);
      state.busy = false;
      if (!(await handleResponse(res))) {
        renderActions(state.detail);
        return;
      }
      var data = res.body.data || {};
      var msg = action + ' 완료';
      if (action === 'publish' && data.item && data.item.publishExpiresAt) {
        msg += ' · publishExpiresAt ' + data.item.publishExpiresAt;
      }
      setBanner(msg, false, res.requestId);
      await refreshAll({ keepSelection: true });
    }

    async function onAction(action) {
      if (action === 'hold' || action === 'reject') {
        openReasonModal(action);
        return;
      }
      if (action === 'retire') {
        openReasonModal('retire');
        return;
      }
      if (action === 'revalidate') {
        await runRevalidate();
        return;
      }
      await runTransition(action);
    }

    async function runRevalidate() {
      var item = state.detail;
      if (!item || state.busy) return;
      state.busy = true;
      renderActions(item);
      var res = await api.revalidate(item.id);
      state.busy = false;
      renderActions(state.detail);
      if (!(await handleResponse(res))) return;
      var re = (res.body.data && res.body.data.revalidation) || {};
      var modal = $('sc-admin-daily-issue-reval-modal');
      var body = $('sc-admin-daily-issue-reval-body');
      if (body) {
        var fails = [].concat(re.qualityFailureReasons || [], re.freshnessFailureReasons || re.failureReasons || []);
        body.innerHTML =
          '<div>quality: ' +
          escapeHtml(String(re.qualityOk != null ? re.qualityOk : re.qualityPassed)) +
          '</div>' +
          '<div>freshness: ' +
          escapeHtml(String(re.freshnessOk != null ? re.freshnessOk : re.freshnessPassed)) +
          '</div>' +
          '<div>duplicate: ' +
          escapeHtml(String((re.duplicateMeta && re.duplicateMeta.decision) || re.duplicateDecision || '—')) +
          '</div>' +
          '<div>만료: ' +
          escapeHtml(String(re.expired != null ? re.expired : re.isExpired)) +
          '</div>' +
          (fails.length
            ? '<ul>' +
              fails
                .map(function (f) {
                  return '<li>' + escapeHtml(f) + '</li>';
                })
                .join('') +
              '</ul>'
            : '<p>failure reasons 없음</p>');
      }
      if (modal) {
        modal.hidden = false;
        var closeBtn = $('sc-admin-daily-issue-reval-close');
        if (closeBtn) closeBtn.focus();
      }
      setBanner('재검증 완료 (자동 승인·게시 없음)', false, res.requestId);
    }

    async function submitToken() {
      var input = $('sc-admin-daily-issue-token-input');
      var token = input ? String(input.value || '').trim() : '';
      var err = $('sc-admin-daily-issue-token-error');
      if (!token) {
        if (err) err.textContent = '토큰을 입력해 주세요.';
        return;
      }
      api.tokenStore.set(token);
      if (input) input.value = '';
      var res = await api.probeAuth();
      if (!(await handleResponse(res, { tokenProbe: true }))) {
        api.tokenStore.clear();
        return;
      }
      hideTokenModal();
      setBanner('검수 화면에 연결되었습니다.');
      await loadList({ autoSelect: true });
    }

    function bind() {
      if (!doc) return;
      var submit = $('sc-admin-daily-issue-token-submit');
      var input = $('sc-admin-daily-issue-token-input');
      if (submit) submit.addEventListener('click', function () { submitToken(); });
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') submitToken();
        });
      }
      var refresh = $('sc-admin-daily-issue-refresh');
      if (refresh) refresh.addEventListener('click', function () { loadList({ reloadDetail: true, autoSelect: false }); });
      var logoutBtn = $('sc-admin-daily-issue-logout');
      if (logoutBtn) logoutBtn.addEventListener('click', logout);
      ['filter-status', 'filter-category', 'filter-limit'].forEach(function (suffix) {
        var el = $('sc-admin-daily-issue-' + suffix);
        if (el) el.addEventListener('change', function () { loadList({ autoSelect: true }); });
      });
      var more = $('sc-admin-daily-issue-more');
      if (more) more.addEventListener('click', function () { loadList({ append: true, autoSelect: false }); });
      var reasonCancel = $('sc-admin-daily-issue-reason-cancel');
      var reasonSubmit = $('sc-admin-daily-issue-reason-submit');
      if (reasonCancel) reasonCancel.addEventListener('click', closeReasonModal);
      if (reasonSubmit) reasonSubmit.addEventListener('click', function () { submitReason(); });
      var revalClose = $('sc-admin-daily-issue-reval-close');
      if (revalClose) {
        revalClose.addEventListener('click', function () {
          var m = $('sc-admin-daily-issue-reval-modal');
          if (m) m.hidden = true;
        });
      }
      doc.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var reason = $('sc-admin-daily-issue-reason-modal');
        var reval = $('sc-admin-daily-issue-reval-modal');
        if (reason && !reason.hidden) closeReasonModal();
        if (reval && !reval.hidden) reval.hidden = true;
      });
    }

    async function start() {
      bind();
      var existing = api.tokenStore.get();
      if (existing) {
        var res = await api.probeAuth();
        if (await handleResponse(res, { tokenProbe: true })) {
          hideTokenModal();
          await loadList({ autoSelect: true });
          return;
        }
        api.tokenStore.clear();
      }
      showTokenModal('');
    }

    return {
      state: state,
      start: start,
      logout: logout,
      loadList: loadList,
      selectItem: selectItem,
      buildTransitionBody: buildTransitionBody,
      canAction: canAction,
      humanError: humanError,
      submitToken: submitToken,
      api: api,
      TOKEN_KEY: TOKEN_KEY,
      HOLD_REASONS: HOLD_REASONS,
      REJECT_REASONS: REJECT_REASONS,
    };
  }

  function mount(options) {
    var ctrl = createController(options || {});
    return ctrl.start().then(function () {
      return ctrl;
    });
  }

  return {
    TOKEN_KEY: TOKEN_KEY,
    HOLD_REASONS: HOLD_REASONS,
    REJECT_REASONS: REJECT_REASONS,
    REVIEWER_ID: REVIEWER_ID,
    createTokenStore: createTokenStore,
    createApiClient: createApiClient,
    createController: createController,
    buildTransitionBody: buildTransitionBody,
    canAction: canAction,
    humanError: humanError,
    escapeHtml: escapeHtml,
    mount: mount,
  };
});
