(function () {
  'use strict';

  var ACTION_LABEL = {
    POST_SOFT_DELETE: '게시글 숨김',
    POST_RESTORE: '게시글 복구',
    COMMENT_SOFT_DELETE: '댓글 숨김',
    COMMENT_RESTORE: '댓글 복구',
    SANCTION_APPLIED: '제재 적용',
    REPORT_REJECTED: '신고 기각',
  };

  var nextCursor = null;
  var items = [];

  function authHeaders() {
    var headers = { Accept: 'application/json' };
    try {
      var raw = sessionStorage.getItem('sc_sb_auth_session');
      if (raw) {
        var auth = JSON.parse(raw);
        var token = auth && auth.session && auth.session.access_token;
        if (token) headers.Authorization = 'Bearer ' + token;
      }
    } catch (_) {}
    return headers;
  }

  function setStatus(text) {
    var el = document.getElementById('aa-status');
    if (el) el.textContent = text || '';
  }

  function val(id) {
    var el = document.getElementById(id);
    return el && el.value ? String(el.value).trim() : '';
  }

  function toIsoLocal(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toISOString();
  }

  function qsFromForm(cursor) {
    var q = [];
    function add(k, v) {
      if (v) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    add('from', toIsoLocal(val('aa-from')));
    add('to', toIsoLocal(val('aa-to')));
    add('actorUserId', val('aa-actor'));
    add('actionType', val('aa-action'));
    add('targetType', val('aa-target-type'));
    add('targetId', val('aa-target-id'));
    add('targetUserId', val('aa-target-user'));
    add('reasonCode', val('aa-reason'));
    add('sanctionId', val('aa-sanction'));
    add('reportId', val('aa-report'));
    add('operatorNote', val('aa-note'));
    add('limit', '30');
    add('cursor', cursor || '');
    return q.length ? '?' + q.join('&') : '';
  }

  function applyHashFilters() {
    var hash = String(location.hash || '').replace(/^#/, '');
    if (!hash) return;
    hash.split('&').forEach(function (part) {
      var idx = part.indexOf('=');
      if (idx < 1) return;
      var k = decodeURIComponent(part.slice(0, idx));
      var v = decodeURIComponent(part.slice(idx + 1));
      var map = {
        targetType: 'aa-target-type',
        targetId: 'aa-target-id',
        actorUserId: 'aa-actor',
        actionType: 'aa-action',
        reasonCode: 'aa-reason',
      };
      if (map[k]) {
        var el = document.getElementById(map[k]);
        if (el) el.value = v;
      }
    });
  }

  function notePreview(note) {
    var s = String(note || '');
    if (s.length <= 40) return s || '(메모 없음)';
    return s.slice(0, 40) + '…';
  }

  function render() {
    var list = document.getElementById('aa-list');
    if (!list) return;
    list.textContent = '';
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '이력이 없습니다.';
      list.appendChild(empty);
      return;
    }
    items.forEach(function (ev) {
      var card = document.createElement('article');
      card.className = 'sc-card aa-row';
      var title = document.createElement('p');
      title.textContent =
        (ev.createdAt || '') +
        ' · ' + (ev.actorDisplayName || ev.actorUserId || '관리자') +
        ' · ' + (ACTION_LABEL[ev.actionType] || ev.actionType) +
        ' · ' + (ev.targetType || '') + ' ' + (ev.targetId || '');
      var meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent =
        '사유 ' + (ev.reasonCode || '-') +
        ' · ' + notePreview(ev.operatorNote) +
        ' · 제재 ' + (ev.sanctionId ? '있음' : '없음') +
        ' · 신고 ' + (ev.reportId ? '있음' : '없음');
      var detail = document.createElement('pre');
      detail.className = 'aa-detail muted';
      detail.hidden = true;
      detail.textContent =
        'id: ' + (ev.id || '') + '\n' +
        '관리자: ' + (ev.actorDisplayName || ev.actorUserId || '') + '\n' +
        '조치: ' + (ev.actionType || '') + '\n' +
        '대상: ' + (ev.targetType || '') + ' ' + (ev.targetId || '') + '\n' +
        '대상 회원: ' + (ev.targetDisplayName || ev.targetUserId || '') + '\n' +
        '사유: ' + (ev.reasonCode || '') + '\n' +
        '메모: ' + (ev.operatorNote || '') + '\n' +
        'sanction: ' + (ev.sanctionId || '') + '\n' +
        'report: ' + (ev.reportId || '') + '\n' +
        '시각: ' + (ev.createdAt || '');
      card.addEventListener('click', function () {
        detail.hidden = !detail.hidden;
      });
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(detail);
      list.appendChild(card);
    });
  }

  function load(reset) {
    var cursor = reset ? '' : nextCursor;
    if (!reset && !cursor) {
      setStatus('더 이상 없습니다.');
      return Promise.resolve();
    }
    return fetch('/api/admin/audit' + qsFromForm(cursor), {
      headers: authHeaders(),
      credentials: 'same-origin',
    }).then(function (res) {
      return res.json().then(function (data) {
        return { res: res, data: data };
      });
    }).then(function (out) {
      if (!out.res.ok || !out.data || out.data.ok !== true) {
        setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || '이력을 불러오지 못했습니다.');
        return;
      }
      var evs = out.data.events || [];
      nextCursor = out.data.nextCursor || null;
      if (reset) items = evs;
      else items = items.concat(evs);
      setStatus(items.length + '건 · 최신순' + (nextCursor ? '' : ' · 끝'));
      render();
    });
  }

  var form = document.getElementById('aa-search');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      load(true);
    });
  }
  var more = document.getElementById('aa-more');
  if (more) {
    more.addEventListener('click', function () {
      load(false);
    });
  }

  applyHashFilters();
  load(true);
})();
