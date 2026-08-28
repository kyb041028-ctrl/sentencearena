/**
 * 데일리 이슈 관리자 검수 화면 1차
 * — 인증: Supabase 이메일 로그인(sessionStorage auth session)
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

  var AUTH_SESSION_KEY = 'sc_sb_auth_session';
  var REVIEWER_ID = 'dev-admin';
  var MAX_REASON_TEXT = 500;

  var LABELS = {
    status: {
      READY_FOR_REVIEW: '검수 필요',
      APPROVED: '승인됨',
      PUBLISHED: '게시 중',
      HELD: '보류',
      REJECTED: '반려',
      RETIRED: '종료됨',
      EXPIRED: '만료됨',
      UPDATE_PENDING: '업데이트 대기',
      SUPERSEDED: '대체됨',
    },
    publicationDecision: {
      AUTO_PUBLISH_ELIGIBLE: '자동 게시 가능',
      MANUAL_REVIEW_REQUIRED: '관리자 검수 필요',
    },
    runStatus: {
      SUCCESS: '정상 완료',
      PARTIAL_SUCCESS: '일부 완료',
      FAILED: '실패',
      SKIPPED_DUPLICATE: '중복 실행 생략',
      MISSED: '실행 시간 놓침',
      BLOCKED: '실행 차단',
      STARTED: '실행 중',
    },
    freshnessClass: {
      BREAKING: '속보',
      RECENT_UPDATE: '최근 업데이트',
      ONGOING_WITH_NEW_DEVELOPMENT: '진행 중인 이슈',
    },
    duplicateDecision: {
      NEW_ISSUE: '새로운 이슈',
      NEW: '새로운 이슈',
      ALLOW_NEW: '새로운 이슈',
      EXACT_DUPLICATE: '동일 이슈',
      NEAR_DUPLICATE: '유사 이슈',
      NEAR_DUPLICATE_BLOCK: '유사 이슈 차단',
      UPDATE_ELIGIBLE: '업데이트 가능',
    },
    claimClassification: {
      CONFIRMED_FACT: '확인된 사실',
      UNVERIFIED: '확인 필요',
      SOURCE_DISAGREEMENT: '출처 불일치',
      ATTRIBUTED_CLAIM: '인용·전달',
      REJECTED: '제외됨',
    },
    auditAction: {
      enqueue: '검수 후보 생성',
      approve: '승인',
      auto_approve: '자동 승인',
      publish: '게시',
      auto_publish: '자동 게시',
      hold: '보류',
      reject: '반려',
      retire: '종료',
      revalidate: '재검증',
      expire: '만료',
      alignment: '성향 분류',
      ops_version_manual_edit: '직접 수정',
      ops_version_ai_revise: 'AI 수정',
      ops_version_recollect: '자료 재취합',
      ops_version_scheduled_recollect: '예약 재취합',
      ops_version_update_draft: '업데이트 초안',
      operator_approve: '운영자 승인',
      operator_publish: '운영자 공개',
    },
    actor: {
      AUTO_MORNING_EDITORIAL: '아침판 자동 편집',
      admin: '관리자',
      system: '시스템',
      'dev-admin': '관리자',
      MORNING_SCHEDULER: '아침판 스케줄러',
    },
    category: {
      world: '국제',
      'korea-economy': '한국 경제',
      'korea-policy': '한국 정책',
      society: '사회',
      tech: '기술',
      other: '기타',
    },
  };

  function label(map, key, fallback) {
    if (key == null || key === '') return fallback != null ? fallback : '—';
    return (map && map[key]) || fallback || String(key);
  }

  function labelStatus(s) {
    return label(LABELS.status, s, s);
  }

  function labelPublicationDecision(item) {
    if (!item) return '—';
    var d = item.publicationDecision;
    if (d) return label(LABELS.publicationDecision, d, d);
    if (item.requiresManualReview === true) return LABELS.publicationDecision.MANUAL_REVIEW_REQUIRED;
    if (item.requiresManualReview === false) return LABELS.publicationDecision.AUTO_PUBLISH_ELIGIBLE;
    return '—';
  }

  function labelCategory(c) {
    return label(LABELS.category, c, c || '—');
  }

  function labelDuplicate(d) {
    return label(LABELS.duplicateDecision, d, d || '—');
  }

  function labelFreshnessClass(c) {
    return label(LABELS.freshnessClass, c, c || '—');
  }

  function labelRunStatus(s) {
    return label(LABELS.runStatus, s, s || '—');
  }

  function labelAuditAction(a) {
    return label(LABELS.auditAction, a, a || '—');
  }

  function labelActor(a) {
    return label(LABELS.actor, a, a || '—');
  }

  function labelClaimClass(c) {
    return label(LABELS.claimClassification, c, c || '—');
  }

  function formatTimeKst(iso) {
    if (!iso) return '—';
    var d = Date.parse(iso);
    if (!isFinite(d)) return '—';
    try {
      var parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).formatToParts(new Date(d));
      var y = '';
      var mo = '';
      var da = '';
      var hr = '';
      var mi = '';
      var dp = '';
      parts.forEach(function (p) {
        if (p.type === 'year') y = p.value;
        if (p.type === 'month') mo = p.value;
        if (p.type === 'day') da = p.value;
        if (p.type === 'hour') hr = p.value;
        if (p.type === 'minute') mi = p.value;
        if (p.type === 'dayPeriod') dp = p.value;
      });
      return y + '-' + mo + '-' + da + ' ' + dp + ' ' + hr + ':' + mi;
    } catch (_) {
      return '—';
    }
  }

  function formatTimeUtc(iso) {
    if (!iso) return '—';
    var d = Date.parse(iso);
    if (!isFinite(d)) return '—';
    try {
      return new Date(d).toISOString();
    } catch (_) {
      return String(iso);
    }
  }

  function formatTime(iso) {
    return formatTimeKst(iso);
  }

  function statusBadgeHtml(status) {
    var s = String(status || '');
    return (
      '<span class="sc-admin-daily-issue-badge" data-status="' +
      escapeHtml(s) +
      '" data-label="' +
      escapeHtml(labelStatus(s)) +
      '"></span>'
    );
  }

  function formatRunBrief(run) {
    if (!run) return '—';
    var parts = [labelRunStatus(run.status)];
    if (run.candidateCount != null) parts.push('후보 ' + run.candidateCount + '건');
    if (run.autoPublishedCount != null && run.runType === 'PUBLISH') {
      parts.push('자동 게시 ' + run.autoPublishedCount + '건');
    }
    if (run.errorCode) parts.push(String(run.errorCode));
    return parts.join(' · ');
  }

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

  function formatPassLabel(v) {
    if (v === true) return '통과';
    if (v === false) return '실패';
    return '—';
  }

  function listSecondaryTime(it) {
    if (!it) return { label: '만료', time: null };
    if (it.status === 'PUBLISHED') return { label: '만료 예정', time: it.expiresAt };
    return { label: '만료', time: it.expiresAt };
  }

  function humanError(status, code, requestId) {
    var msg =
      status === 400
        ? '입력값을 확인해 주세요.'
        : status === 401
          ? '관리자 로그인이 필요합니다. 다시 로그인해 주세요.'
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
    if (
      code === 'ADMIN_TOKEN_MISSING' ||
      code === 'ADMIN_TOKEN_INVALID' ||
      code === 'ADMIN_TOKEN_NOT_CONFIGURED' ||
      code === 'ADMIN_AUTH_NOT_CONFIGURED'
    ) {
      msg = '관리자 로그인이 필요하거나 인증 구성이 누락되었습니다.';
    }
    if (code === 'ADMIN_ROLE_MISSING' || code === 'ADMIN_ROLE_FORBIDDEN') {
      msg = '관리자 권한(ADMIN/OWNER)이 없어 접근할 수 없습니다.';
    }
    if (code === 'QUERY_TOKEN_FORBIDDEN') {
      msg = '허용되지 않은 인증 방식입니다.';
    }
    if (code === 'DATABASE_UNAVAILABLE') {
      msg = '데이터베이스에 연결할 수 없습니다.';
    }
    return { message: msg, requestId: requestId || null, code: code || null };
  }

  function safeJsonParse(raw) {
    try {
      return JSON.parse(String(raw || ''));
    } catch (_) {
      return null;
    }
  }

  function createAuthSessionStore(storage) {
    var store = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    return {
      getSession: function () {
        if (!store) return null;
        try {
          var raw = store.getItem(AUTH_SESSION_KEY);
          var parsed = safeJsonParse(raw);
          if (!parsed || typeof parsed !== 'object') return null;
          if (!parsed.session || typeof parsed.session !== 'object') return null;
          return parsed;
        } catch (_) {
          return null;
        }
      },
      getAccessToken: function () {
        var sess = this.getSession();
        if (!sess || !sess.session) return '';
        return String(sess.session.access_token || sess.session.accessToken || '');
      },
      setSession: function (sessionObject) {
        if (!store) return;
        store.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionObject || {}));
      },
      clear: function () {
        if (!store) return;
        try {
          store.removeItem(AUTH_SESSION_KEY);
        } catch (_) {}
      },
      KEY: AUTH_SESSION_KEY,
    };
  }

  function createApiClient(options) {
    var opt = options || {};
    var sessionStore = opt.sessionStore || createAuthSessionStore();
    var fetchFn = opt.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
    var baseUrl = opt.baseUrl || '';

    async function request(method, path, body) {
      var accessToken = sessionStore.getAccessToken();
      var headers = { Accept: 'application/json' };
      if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
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
      sessionStore: sessionStore,
      request: request,
      signIn: function (email, password) {
        return request('POST', '/api/auth/signin', { email: email, password: password });
      },
      signOut: function () {
        return request('POST', '/api/auth/signout', {});
      },
      getMe: function () {
        return request('GET', '/api/auth/me');
      },
      listReview: function (query) {
        var q = query || {};
        var params = new URLSearchParams();
        if (q.status) params.set('status', q.status);
        if (q.category) params.set('category', q.category);
        if (q.limit) params.set('limit', String(q.limit));
        if (q.offset != null) params.set('offset', String(q.offset));
        if (q.postReviewQueue) params.set('postReviewQueue', '1');
        if (q.publicationDecision) params.set('publicationDecision', q.publicationDecision);
        if (q.publishedBy) params.set('publishedBy', q.publishedBy);
        if (q.pendingApproval) params.set('pendingApproval', '1');
        var qs = params.toString();
        return request('GET', '/api/admin/daily-issues/review' + (qs ? '?' + qs : ''));
      },
      getMorningStatus: function () {
        return request('GET', '/api/admin/daily-issues/morning/status');
      },
      getMorningHistory: function (query) {
        var q = query || {};
        var params = new URLSearchParams();
        if (q.limit) params.set('limit', String(q.limit));
        if (q.runType) params.set('runType', q.runType);
        return request('GET', '/api/admin/daily-issues/morning/history' + (params.toString() ? '?' + params.toString() : ''));
      },
      runMorningCollect: function (body) {
        return request('POST', '/api/admin/daily-issues/morning/run-collect', body || {});
      },
      runMorningPublish: function (body) {
        return request('POST', '/api/admin/daily-issues/morning/run-publish', body || {});
      },
      getReview: function (id) {
        return request('GET', '/api/admin/daily-issues/review/' + encodeURIComponent(id));
      },
      setAlignment: function (id, payload) {
        return request('POST', '/api/admin/daily-issues/review/' + encodeURIComponent(id) + '/alignment', payload);
      },
      getHistory: function (id) {
        return request('GET', '/api/admin/daily-issues/review/' + encodeURIComponent(id) + '/history?limit=50');
      },
      transition: function (id, action, payload) {
        return request('POST', '/api/admin/daily-issues/review/' + encodeURIComponent(id) + '/' + action, payload);
      },
      opsAction: function (id, action, payload) {
        return request('POST', '/api/admin/daily-issues/review/' + encodeURIComponent(id) + '/' + action, payload || {});
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

    function showLoginModal(message) {
      var modal = $('sc-admin-daily-issue-login-modal');
      var app = $('sc-admin-daily-issue-app');
      var err = $('sc-admin-daily-issue-login-error');
      var emailInput = $('sc-admin-daily-issue-login-email');
      var passInput = $('sc-admin-daily-issue-login-password');
      if (app) app.hidden = true;
      if (modal) modal.hidden = false;
      if (err) err.textContent = message || '';
      if (passInput) passInput.value = '';
      setTimeout(function () {
        if (emailInput) emailInput.focus();
      }, 0);
      state.authenticated = false;
    }

    function hideLoginModal() {
      var modal = $('sc-admin-daily-issue-login-modal');
      var app = $('sc-admin-daily-issue-app');
      if (modal) modal.hidden = true;
      if (app) app.hidden = false;
      state.authenticated = true;
    }

    async function logout() {
      try {
        await api.signOut();
      } catch (_) {}
      api.sessionStore.clear();
      state.items = [];
      state.detail = null;
      state.history = [];
      state.selectedId = null;
      renderList();
      renderDetail();
      setBanner('');
      showLoginModal('');
    }

    function handleAuthFailure(res) {
      api.sessionStore.clear();
      var h = humanError(res.status, res.errorCode, res.requestId);
      showLoginModal(h.message);
    }

    async function handleResponse(res, opts) {
      var o = opts || {};
      if (res.status === 401 || res.status === 403) {
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
        if (o.loginProbe) {
          showLoginModal(h.message);
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
          statusBadgeHtml(it.status) +
          '<span>' +
          escapeHtml(labelCategory(it.category)) +
          '</span>' +
          '<span>' +
          escapeHtml(labelPublicationDecision(it)) +
          '</span>' +
          '<span>출처 ' +
          escapeHtml(String(it.sourceCount != null ? it.sourceCount : 0)) +
          '</span>' +
          '<span>수집 ' +
          escapeHtml(formatTimeKst(it.queuedAt)) +
          '</span>' +
          '<span>' +
          escapeHtml(listSecondaryTime(it).label) +
          ' ' +
          escapeHtml(formatTimeKst(listSecondaryTime(it).time)) +
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
      if (
        item.status === 'READY_FOR_REVIEW' ||
        item.status === 'APPROVED' ||
        item.status === 'UPDATE_PENDING' ||
        item.status === 'PUBLISHED'
      ) {
        defs.push({ action: 'approve-and-publish', label: '승인 및 공개', className: '' });
      }
      defs.forEach(function (def) {
        if (
          def.action !== 'revalidate' &&
          def.action !== 'approve-and-publish' &&
          !canAction(item, def.action)
        ) {
          return;
        }
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

      var confirmedClaims = [];
      var reviewClaims = [];
      (item.claims || []).forEach(function (c) {
        if (!c) return;
        if (c.classification === 'CONFIRMED_FACT') confirmedClaims.push(c);
        else if (c.classification !== 'REJECTED') reviewClaims.push(c);
      });

      var confirmedHtml =
        (item.confirmedSummary
          ? '<p class="sc-admin-daily-issue-summary">' + escapeHtml(item.confirmedSummary) + '</p>'
          : '') +
        confirmedClaims
          .map(function (c) {
            return '<div class="sc-admin-daily-issue-claim">' + escapeHtml(c.text || '') + '</div>';
          })
          .join('');

      var reviewHtml = reviewClaims
        .map(function (c) {
          return (
            '<div class="sc-admin-daily-issue-claim">' +
            '<strong>' +
            escapeHtml(labelClaimClass(c.classification)) +
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
            '</strong></div>' +
            '<div>' +
            escapeHtml(s.title || '') +
            '</div>' +
            '<div>게시 ' +
            escapeHtml(formatTimeKst(s.publishedAt)) +
            '</div>' +
            '<div>' +
            link +
            '</div></div>'
          );
        })
        .join('');

      var histHtml = (state.history || [])
        .map(function (h) {
          return (
            '<div class="sc-admin-daily-issue-history-row">' +
            escapeHtml(labelAuditAction(h.action)) +
            ' · ' +
            escapeHtml(labelStatus(h.fromStatus) || '—') +
            ' → ' +
            escapeHtml(labelStatus(h.toStatus) || '—') +
            ' · ' +
            escapeHtml(labelActor(h.actorId)) +
            ' · ' +
            escapeHtml(formatTimeKst(h.timestamp)) +
            '</div>'
          );
        })
        .join('') || '<p class="sc-admin-daily-issue-meta">이력 없음</p>';

      var q = item.qualityMeta || {};
      var f = item.freshnessMeta || {};
      var dup = item.duplicateMeta || {};

      var devRows = [
        ['내부 상태', item.status],
        ['candidateId', item.candidateId],
        ['lockVersion', item.lockVersion],
        ['publicationDecision', item.publicationDecision],
        ['판정 근거', (item.publicationDecisionReasons || []).join(', ')],
        ['자동 차단 사유', (item.autoPublishBlockedReasons || []).join(', ')],
        ['수집 시각(UTC)', formatTimeUtc(item.queuedAt)],
        ['만료 시각(UTC)', formatTimeUtc(item.expiresAt)],
        ['게시 만료(UTC)', formatTimeUtc(item.publishExpiresAt)],
        ['이슈 날짜', item.issueDate],
        ['승인 만료', formatTimeUtc(item.approvalExpiresAt)],
        ['선택 버전', item.selectedVersionNumber],
        ['허용 다음 상태', (item.allowedNextStatuses || []).join(', ')],
      ];

      var versions = item.draftVersions || (item.ops && item.ops.versions) || [];
      var versionHtml =
        versions
          .map(function (v) {
            var sel = v.selected || Number(v.versionNumber) === Number(item.selectedVersionNumber);
            return (
              '<div class="sc-admin-daily-issue-history-row">' +
              '<button type="button" class="sc-admin-daily-issue-btn sc-admin-daily-issue-btn-ghost" data-ops-select-version="' +
              escapeHtml(String(v.versionNumber)) +
              '">v' +
              escapeHtml(String(v.versionNumber)) +
              (sel ? ' (선택됨)' : '') +
              '</button> ' +
              escapeHtml(v.originMethod || '') +
              ' · ' +
              escapeHtml(formatTimeKst(v.revisedAt || v.createdAt)) +
              (v.operatorInstruction ? ' · ' + escapeHtml(v.operatorInstruction) : '') +
              '</div>'
            );
          })
          .join('') || '<p class="sc-admin-daily-issue-meta">버전 1</p>';
      var diffRows = ((item.ops && item.ops.diff) || [])
        .map(function (d) {
          return (
            '<div class="sc-admin-daily-issue-meta">' +
            escapeHtml(d.field) +
            ': ' +
            escapeHtml(String(d.from)) +
            ' → ' +
            escapeHtml(String(d.to)) +
            '</div>'
          );
        })
        .join('');
      var jobs = item.recollectJobs || [];
      var jobsHtml =
        jobs
          .filter(function (j) {
            return j && (j.status === 'PENDING' || j.status === 'RUNNING');
          })
          .map(function (j) {
            return (
              '<div class="sc-admin-daily-issue-history-row">' +
              escapeHtml(j.status) +
              ' · ' +
              escapeHtml(formatTimeKst(j.scheduledAt)) +
              ' <button type="button" class="sc-admin-daily-issue-btn sc-admin-daily-issue-btn-ghost" data-ops-cancel="' +
              escapeHtml(j.runKey || j.id) +
              '">예약 취소</button></div>'
            );
          })
          .join('') || '<p class="sc-admin-daily-issue-meta">예약 없음</p>';
      var expiredNote = item.ops && item.ops.approvalExpired ? '만료됨 · 승인대기 목록에서 제외' : '승인대기 7일';

      wrap.innerHTML =
        '<h3 class="sc-admin-daily-issue-section-title">제목</h3>' +
        '<p class="sc-admin-daily-issue-detail-title">' +
        escapeHtml(item.title || '') +
        '</p>' +
        '<h3 class="sc-admin-daily-issue-section-title">상태</h3>' +
        '<div>' +
        statusBadgeHtml(item.status) +
        '</div>' +
        '<h3 class="sc-admin-daily-issue-section-title">게시 판정</h3>' +
        '<p>' +
        escapeHtml(labelPublicationDecision(item)) +
        '</p>' +
        '<h3 class="sc-admin-daily-issue-section-title">Alignment</h3>' +
        '<p class="sc-admin-daily-issue-meta">내부 분류. 발행 조건이 아닙니다.</p>' +
        '<div class="sc-admin-daily-issue-alignment">' +
        '<label for="sc-admin-daily-issue-alignment-select">Alignment</label> ' +
        '<select id="sc-admin-daily-issue-alignment-select" class="sc-input">' +
        ['PIONEER', 'GUARDIAN', 'NEUTRAL']
          .map(function (d) {
            var cur = item.alignmentDirection === 'PIONEER' || item.alignmentDirection === 'GUARDIAN' ? item.alignmentDirection : 'NEUTRAL';
            return (
              '<option value="' +
              d +
              '"' +
              (cur === d ? ' selected' : '') +
              '>' +
              d +
              '</option>'
            );
          })
          .join('') +
        '</select> ' +
        '<button type="button" class="sc-btn" id="sc-admin-daily-issue-alignment-save">저장</button>' +
        '</div>' +
        '<h3 class="sc-admin-daily-issue-section-title">승인대기 운영</h3>' +
        '<p class="sc-admin-daily-issue-meta">생성일 ' +
        escapeHtml(item.issueDate || '—') +
        ' · 생성 ' +
        escapeHtml(formatTimeKst(item.queuedAt || item.createdAt)) +
        ' · ' +
        escapeHtml(expiredNote) +
        (item.approvalExpiresAt ? ' · 승인 만료 ' + formatTimeKst(item.approvalExpiresAt) : '') +
        '</p>' +
        '<div class="sc-admin-daily-issue-actions" id="sc-admin-daily-issue-ops-actions">' +
        '<button type="button" class="sc-admin-daily-issue-btn" data-ops="edit-draft">직접 수정</button>' +
        '<button type="button" class="sc-admin-daily-issue-btn" data-ops="ai-revise">AI 수정 요청</button>' +
        '<button type="button" class="sc-admin-daily-issue-btn" data-ops="recollect">지금 다시 취합</button>' +
        '<button type="button" class="sc-admin-daily-issue-btn" data-ops="schedule-recollect">시간 후 다시 취합</button>' +
        (item.status === 'PUBLISHED'
          ? '<button type="button" class="sc-admin-daily-issue-btn" data-ops="update-draft">업데이트 초안 만들기</button>'
          : '<button type="button" class="sc-admin-daily-issue-btn sc-admin-daily-issue-btn-danger" data-ops="discard">폐기</button>') +
        '</div>' +
        '<label class="sc-admin-daily-issue-field sc-admin-daily-issue-field-block">제목<br><input class="sc-input" id="sc-admin-daily-issue-edit-title" value="' +
        escapeHtml(item.title || '') +
        '"></label>' +
        '<label class="sc-admin-daily-issue-field sc-admin-daily-issue-field-block">요약<br><textarea class="sc-input" id="sc-admin-daily-issue-edit-summary" rows="3">' +
        escapeHtml(item.confirmedSummary || '') +
        '</textarea></label>' +
        '<label class="sc-admin-daily-issue-field sc-admin-daily-issue-field-block">본문·토론 질문<br><textarea class="sc-input" id="sc-admin-daily-issue-edit-prompt" rows="2">' +
        escapeHtml(item.discussionPrompt || '') +
        '</textarea></label>' +
        '<h3 class="sc-admin-daily-issue-section-title">버전</h3>' +
        versionHtml +
        (diffRows ? '<p class="sc-admin-daily-issue-meta">이전 버전 대비</p>' + diffRows : '') +
        '<h3 class="sc-admin-daily-issue-section-title">재취합 예약</h3>' +
        jobsHtml +
        '<h3 class="sc-admin-daily-issue-section-title">확인된 사실</h3>' +
        (confirmedHtml || '<p class="sc-admin-daily-issue-meta">없음</p>') +
        '<h3 class="sc-admin-daily-issue-section-title">확인이 필요한 내용</h3>' +
        (reviewHtml || '<p class="sc-admin-daily-issue-meta">없음</p>') +
        '<h3 class="sc-admin-daily-issue-section-title">출처</h3>' +
        (sourcesHtml || '<p class="sc-admin-daily-issue-meta">없음</p>') +
        '<h3 class="sc-admin-daily-issue-section-title">품질 검증</h3>' +
        '<p>품질 검증: ' +
        escapeHtml(formatPassLabel(q.passed)) +
        '</p>' +
        '<h3 class="sc-admin-daily-issue-section-title">최신성 검증</h3>' +
        '<p>최신성 검증: ' +
        escapeHtml(formatPassLabel(f.passed)) +
        (f.freshnessClass ? ' · ' + escapeHtml(labelFreshnessClass(f.freshnessClass)) : '') +
        '</p>' +
        '<h3 class="sc-admin-daily-issue-section-title">중복 여부</h3>' +
        '<p>중복 여부: ' +
        escapeHtml(labelDuplicate(dup.decision)) +
        '</p>' +
        '<h3 class="sc-admin-daily-issue-section-title">감사 이력</h3>' +
        histHtml +
        '<details class="sc-admin-daily-issue-dev">' +
        '<summary>개발 정보 보기</summary>' +
        '<dl class="sc-admin-daily-issue-kv">' +
        devRows
          .map(function (row) {
            return (
              '<dt>' +
              escapeHtml(row[0]) +
              '</dt><dd>' +
              escapeHtml(row[1] == null || row[1] === '' ? '—' : String(row[1])) +
              '</dd>'
            );
          })
          .join('') +
        '</dl></details>';

      var saveAlign = wrap.querySelector ? wrap.querySelector('#sc-admin-daily-issue-alignment-save') : null;
      if (saveAlign) {
        saveAlign.addEventListener('click', function () {
          saveAlignment(item);
        });
      }
      if (wrap.querySelectorAll) {
        wrap.querySelectorAll('[data-ops]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            onOpsCommand(btn.getAttribute('data-ops'));
          });
        });
        wrap.querySelectorAll('[data-ops-select-version]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            runOps('select-version', { versionNumber: Number(btn.getAttribute('data-ops-select-version')) });
          });
        });
        wrap.querySelectorAll('[data-ops-cancel]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            runOps('cancel-recollect', { runKey: btn.getAttribute('data-ops-cancel') });
          });
        });
      }

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
      var queue = ($('sc-admin-daily-issue-filter-queue') || {}).value || '';
      var limit = Number(($('sc-admin-daily-issue-filter-limit') || {}).value || 20);
      var offset = o.append ? state.offset : 0;
      var query = { category: category, limit: limit, offset: offset };
      if (status === 'AUTO_ELIGIBLE') {
        query.status = 'READY_FOR_REVIEW';
        query.publicationDecision = 'AUTO_PUBLISH_ELIGIBLE';
      } else if (status) {
        query.status = status;
      }
      if (queue === 'post-review') {
        query.status = 'PUBLISHED';
        query.postReviewQueue = true;
        query.publishedBy = 'AUTO_MORNING_EDITORIAL';
      } else if (queue === 'pending-approval') {
        query.pendingApproval = true;
        if (!query.status) query.status = '';
      } else if (queue === 'manual-review') {
        if (!query.status) query.status = 'READY_FOR_REVIEW';
        query.publicationDecision = 'MANUAL_REVIEW_REQUIRED';
      }
      var res = await api.listReview(query);
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

    async function saveAlignment(item) {
      if (!item || state.busy) return;
      var sel = $('sc-admin-daily-issue-alignment-select');
      var value = sel && sel.value ? sel.value : 'NEUTRAL';
      state.busy = true;
      var res = await api.setAlignment(item.id, {
        alignmentDirection: value,
        expectedLockVersion: item.lockVersion,
        reviewerId: 'admin',
      });
      state.busy = false;
      if (!(await handleResponse(res))) return;
      setBanner('Alignment 저장', false, res.requestId);
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
      if (action === 'approve-and-publish') {
        if (!window.confirm('선택한 버전을 승인하고 공개할까요? 자동 공개가 아닙니다.')) return;
        await runOps('approve-and-publish', {
          versionNumber: state.detail && state.detail.selectedVersionNumber,
        });
        return;
      }
      await runTransition(action);
    }

    async function runOps(action, payload) {
      var item = state.detail;
      if (!item || state.busy) return;
      state.busy = true;
      renderActions(item);
      var body = Object.assign(
        {
          expectedStatus: item.status,
          expectedLockVersion: item.lockVersion,
          reviewerId: REVIEWER_ID,
        },
        payload || {},
      );
      var res = await api.opsAction(item.id, action, body);
      state.busy = false;
      if (!(await handleResponse(res))) {
        renderActions(state.detail);
        return;
      }
      showBanner((action === 'approve-and-publish' ? '승인 및 공개' : action) + ' 완료');
      await loadList({ reloadDetail: true, keepSelection: true, autoSelect: false });
      if (state.selectedId) await selectItem(state.selectedId);
    }

    function collectEditPatch() {
      return {
        title: (($('sc-admin-daily-issue-edit-title') || {}).value || '').trim(),
        confirmedSummary: (($('sc-admin-daily-issue-edit-summary') || {}).value || '').trim(),
        discussionPrompt: (($('sc-admin-daily-issue-edit-prompt') || {}).value || '').trim(),
      };
    }

    function onOpsCommand(action) {
      if (action === 'edit-draft') {
        runOps('edit-draft', { patch: collectEditPatch() });
        return;
      }
      if (action === 'discard') {
        if (!window.confirm('이 승인대기 초안을 폐기할까요? 다시 자동 실행되지 않습니다.')) return;
        runOps('discard', {});
        return;
      }
      if (action === 'recollect' || action === 'update-draft') {
        openOpsModal(action, { showDelay: false, requireInstruction: false });
        return;
      }
      if (action === 'ai-revise') {
        openOpsModal(action, { showDelay: false, requireInstruction: true });
        return;
      }
      if (action === 'schedule-recollect') {
        openOpsModal(action, { showDelay: true, requireInstruction: false });
      }
    }

    function openOpsModal(action, flags) {
      state.opsMode = action;
      state.opsFlags = flags || {};
      var modal = $('sc-admin-daily-issue-ops-modal');
      var title = $('sc-admin-daily-issue-ops-title');
      var delayWrap = $('sc-admin-daily-issue-ops-delay-wrap');
      var err = $('sc-admin-daily-issue-ops-error');
      var inst = $('sc-admin-daily-issue-ops-instruction');
      if (title) {
        title.textContent =
          action === 'ai-revise'
            ? 'AI 수정 요청'
            : action === 'schedule-recollect'
              ? '시간 후 다시 취합'
              : action === 'update-draft'
                ? '업데이트 초안'
                : '자료 다시 취합';
      }
      if (delayWrap) delayWrap.hidden = !flags.showDelay;
      var customWrap = $('sc-admin-daily-issue-ops-custom-wrap');
      if (customWrap) customWrap.hidden = true;
      if (inst) inst.value = '';
      if (err) err.textContent = '';
      if (modal) modal.hidden = false;
    }

    function closeOpsModal() {
      var modal = $('sc-admin-daily-issue-ops-modal');
      if (modal) modal.hidden = true;
      state.opsMode = null;
    }

    async function submitOpsModal() {
      var action = state.opsMode;
      var flags = state.opsFlags || {};
      var inst = (($('sc-admin-daily-issue-ops-instruction') || {}).value || '').trim();
      var err = $('sc-admin-daily-issue-ops-error');
      if (flags.requireInstruction && !inst) {
        if (err) err.textContent = '수정 지시를 입력하세요.';
        return;
      }
      var payload = { instruction: inst };
      if (action === 'schedule-recollect') {
        var delay = (($('sc-admin-daily-issue-ops-delay') || {}).value || '60');
        if (delay === 'custom') {
          payload.customMinutes = Number(($('sc-admin-daily-issue-ops-custom') || {}).value || 0);
        } else {
          payload.presetMinutes = Number(delay);
        }
      }
      closeOpsModal();
      await runOps(action, payload);
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

    async function submitLogin() {
      var emailInput = $('sc-admin-daily-issue-login-email');
      var passInput = $('sc-admin-daily-issue-login-password');
      var err = $('sc-admin-daily-issue-login-error');
      var email = emailInput ? String(emailInput.value || '').trim() : '';
      var password = passInput ? String(passInput.value || '') : '';
      if (!email || !password) {
        if (err) err.textContent = '이메일과 비밀번호를 입력해 주세요.';
        return;
      }
      if (err) err.textContent = '';
      var signInRes = await api.signIn(email, password);
      if (!signInRes.ok) {
        var signInErr = humanError(signInRes.status, signInRes.errorCode, signInRes.requestId);
        if (err) err.textContent = signInErr.message;
        return;
      }
      var authData = signInRes.body || {};
      if (!authData.session || !authData.session.access_token) {
        if (err) err.textContent = '세션을 생성하지 못했습니다.';
        return;
      }
      api.sessionStore.setSession({
        user: authData.user || null,
        session: authData.session,
      });
      if (passInput) passInput.value = '';
      var res = await api.probeAuth();
      if (!(await handleResponse(res, { loginProbe: true }))) {
        api.sessionStore.clear();
        return;
      }
      hideLoginModal();
      setBanner('검수 화면에 연결되었습니다.');
      await loadMorningStatus();
      await loadList({ autoSelect: true });
    }

    async function loadMorningStatus() {
      var wrap = $('sc-admin-daily-issue-morning-status');
      var alertsEl = $('sc-admin-daily-issue-morning-alerts');
      if (!wrap) return;
      var res = await api.getMorningStatus();
      if (!(await handleResponse(res))) {
        wrap.innerHTML = '<dt>상태</dt><dd>불러오기 실패</dd>';
        return;
      }
      var d = (res.body && res.body.data) || {};
      var alerts = d.alerts || [];
      if (alertsEl) {
        if (!alerts.length) {
          alertsEl.innerHTML = '';
          alertsEl.hidden = true;
        } else {
          alertsEl.hidden = false;
          alertsEl.innerHTML = alerts
            .map(function (a) {
              return (
                '<div class="sc-admin-daily-issue-alert sc-admin-daily-issue-alert-' +
                escapeHtml(a.severity || 'warn') +
                '">' +
                escapeHtml(a.message || a.code || '') +
                '</div>'
              );
            })
            .join('');
        }
      }
      wrap.innerHTML =
        '<dt>스케줄러</dt><dd>' +
        escapeHtml(d.enabled ? '사용 중' : '중지') +
        '</dd>' +
        '<dt>다음 수집</dt><dd>' +
        escapeHtml(formatTimeKst(d.nextCollectAt)) +
        '</dd>' +
        '<dt>다음 게시</dt><dd>' +
        escapeHtml(formatTimeKst(d.nextPublishAt)) +
        '</dd>' +
        '<dt>최근 수집 결과</dt><dd>' +
        escapeHtml(formatRunBrief(d.lastCollect)) +
        '</dd>' +
        '<dt>최근 게시 결과</dt><dd>' +
        escapeHtml(formatRunBrief(d.lastPublish)) +
        '</dd>';
    }

    async function runMorning(kind) {
      setBanner(kind === 'collect' ? '수동 수집 실행 중…' : '만료·예약 처리 실행 중…');
      var res =
        kind === 'collect'
          ? await api.runMorningCollect({ allowRetry: true })
          : await api.runMorningPublish({ allowRetry: true });
      if (!(await handleResponse(res))) return;
      var data = (res.body && res.body.data) || {};
      setBanner(
          ' 완료: ' +
          escapeHtml(labelRunStatus(data.status) || (data.skipped ? '중복 실행 생략' : '정상 완료')),
      );
      await loadMorningStatus();
      await loadList({ reloadDetail: true, autoSelect: false });
    }

    function bind() {
      if (!doc) return;
      var submit = $('sc-admin-daily-issue-login-submit');
      var emailInput = $('sc-admin-daily-issue-login-email');
      var passInput = $('sc-admin-daily-issue-login-password');
      if (submit) submit.addEventListener('click', function () { submitLogin(); });
      if (emailInput) {
        emailInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') submitLogin();
        });
      }
      if (passInput) {
        passInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') submitLogin();
        });
      }
      var refresh = $('sc-admin-daily-issue-refresh');
      if (refresh) refresh.addEventListener('click', function () {
        loadMorningStatus();
        loadList({ reloadDetail: true, autoSelect: false });
      });
      var logoutBtn = $('sc-admin-daily-issue-logout');
      if (logoutBtn) logoutBtn.addEventListener('click', function () { logout(); });
      ['filter-status', 'filter-category', 'filter-limit', 'filter-queue'].forEach(function (suffix) {
        var el = $('sc-admin-daily-issue-' + suffix);
        if (el) el.addEventListener('change', function () { loadList({ autoSelect: true }); });
      });
      var morningRefresh = $('sc-admin-daily-issue-morning-refresh');
      if (morningRefresh) morningRefresh.addEventListener('click', function () { loadMorningStatus(); });
      var morningCollect = $('sc-admin-daily-issue-morning-collect');
      if (morningCollect) morningCollect.addEventListener('click', function () { runMorning('collect'); });
      var morningPublish = $('sc-admin-daily-issue-morning-publish');
      if (morningPublish) morningPublish.addEventListener('click', function () { runMorning('publish'); });
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
      var opsCancel = $('sc-admin-daily-issue-ops-cancel');
      var opsSubmit = $('sc-admin-daily-issue-ops-submit');
      var opsDelay = $('sc-admin-daily-issue-ops-delay');
      if (opsCancel) opsCancel.addEventListener('click', closeOpsModal);
      if (opsSubmit) opsSubmit.addEventListener('click', function () { submitOpsModal(); });
      if (opsDelay) {
        opsDelay.addEventListener('change', function () {
          var customWrap = $('sc-admin-daily-issue-ops-custom-wrap');
          if (customWrap) customWrap.hidden = opsDelay.value !== 'custom';
        });
      }
      doc.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var reason = $('sc-admin-daily-issue-reason-modal');
        var reval = $('sc-admin-daily-issue-reval-modal');
        var ops = $('sc-admin-daily-issue-ops-modal');
        if (reason && !reason.hidden) closeReasonModal();
        if (reval && !reval.hidden) reval.hidden = true;
        if (ops && !ops.hidden) closeOpsModal();
      });
    }

    async function start() {
      bind();
      var existing = api.sessionStore.getSession();
      if (existing && existing.session && existing.session.access_token) {
        var res = await api.probeAuth();
        if (await handleResponse(res, { loginProbe: true })) {
          hideLoginModal();
          await loadMorningStatus();
          await loadList({ autoSelect: true });
          return;
        }
        api.sessionStore.clear();
      }
      showLoginModal('');
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
      submitLogin: submitLogin,
      api: api,
      AUTH_SESSION_KEY: AUTH_SESSION_KEY,
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
    AUTH_SESSION_KEY: AUTH_SESSION_KEY,
    HOLD_REASONS: HOLD_REASONS,
    REJECT_REASONS: REJECT_REASONS,
    REVIEWER_ID: REVIEWER_ID,
    createAuthSessionStore: createAuthSessionStore,
    createApiClient: createApiClient,
    createController: createController,
    buildTransitionBody: buildTransitionBody,
    canAction: canAction,
    humanError: humanError,
    escapeHtml: escapeHtml,
    formatTimeKst: formatTimeKst,
    labelStatus: labelStatus,
    labelPublicationDecision: labelPublicationDecision,
    LABELS: LABELS,
    mount: mount,
  };
});
