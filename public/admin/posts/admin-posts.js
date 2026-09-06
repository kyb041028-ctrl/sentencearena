(function () {
  'use strict';

  var SANCTIONS = [
    { id: '', label: '제재 없음' },
    { id: 'WARNING', label: '경고' },
    { id: 'FINAL_WARNING', label: '최종 경고' },
    { id: 'ALIEN_TRANSFER', label: '외계행성 이동' },
    { id: 'WRITE_RESTRICT_24H', label: '24시간 작성 제한' },
    { id: 'ACCOUNT_RESTRICT_7D', label: '7일 계정 제한' },
    { id: 'ACCOUNT_RESTRICT_30D', label: '30일 계정 제한' },
    { id: 'TEMP_SUSPEND', label: '임시 활동중지' },
    { id: 'PERMANENT_BAN', label: '영구정지' },
  ];

  function authHeaders() {
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
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
    var el = document.getElementById('ap-status');
    if (el) el.textContent = text || '';
  }

  function api(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        return { res: res, data: data };
      });
    });
  }

  function postIdFromHash() {
    var h = String(location.hash || '');
    if (h.indexOf('#post=') === 0) return h.slice(6);
    return '';
  }

  function renderList(posts) {
    var list = document.getElementById('ap-list');
    if (!list) return;
    list.textContent = '';
    var h = document.createElement('h2');
    h.className = 'sc-section-title';
    h.textContent = '최근 게시글';
    list.appendChild(h);
    (posts || []).forEach(function (post) {
      var card = document.createElement('article');
      card.className = 'sc-card ap-card';
      var title = document.createElement('h3');
      title.className = 'sc-section-title';
      title.textContent = (post.isOfficial ? '[공식] ' : '') + (post.title || '(제목 없음)');
      var meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent =
        (post.status || '') +
        ' · ' + (post.createdAt || '') +
        (post.author && post.author.displayName ? ' · ' + post.author.displayName : '');
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'sc-btn';
      open.textContent = '상세';
      open.addEventListener('click', function () {
        location.hash = 'post=' + post.id;
        loadDetail(post.id);
      });
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(open);
      list.appendChild(card);
    });
    if (!(posts || []).length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '게시글이 없습니다.';
      list.appendChild(empty);
    }
  }

  function renderDetail(post) {
    var box = document.getElementById('ap-detail');
    if (!box) return;
    box.textContent = '';
    if (!post) return;
    var card = document.createElement('article');
    card.className = 'sc-card ap-card';
    var title = document.createElement('h2');
    title.className = 'sc-section-title';
    title.textContent = (post.isOfficial ? '[공식] ' : '') + (post.title || '(제목 없음)');
    var meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent =
      '상태 ' + (post.status || '') +
      ' · 공식 ' + (post.isOfficial ? '예' : '아니오') +
      ' · 작성 ' + (post.createdAt || '') +
      (post.author && post.author.userId ? ' · 작성자 ' + (post.author.displayName || post.author.userId) : '');
    var body = document.createElement('p');
    body.textContent = post.content || '';
    var actions = document.createElement('div');
    actions.className = 'ap-actions';
    var reasonLabel = document.createElement('label');
    reasonLabel.className = 'ap-field';
    reasonLabel.appendChild(document.createTextNode('조치 사유'));
    var reasonSel = document.createElement('select');
    [
      { id: 'abuse', label: '욕설 / 인신공격' },
      { id: 'spam', label: '도배 / 광고' },
      { id: 'baiting', label: '분쟁 유도' },
      { id: 'misinfo', label: '허위정보' },
      { id: 'privacy', label: '개인정보' },
      { id: 'other', label: '기타(메모 필수)' },
    ].forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      reasonSel.appendChild(opt);
    });
    reasonLabel.appendChild(reasonSel);
    var restoreReasonLabel = document.createElement('label');
    restoreReasonLabel.className = 'ap-field';
    restoreReasonLabel.appendChild(document.createTextNode('복구 사유'));
    var restoreReasonSel = document.createElement('select');
    [
      { id: 'OPERATOR_CORRECTION', label: '운영 판단 정정' },
      { id: 'APPEAL_RESULT', label: '이의 결과' },
      { id: 'OTHER', label: '기타(메모 필수)' },
    ].forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      restoreReasonSel.appendChild(opt);
    });
    restoreReasonLabel.appendChild(restoreReasonSel);
    var noteLabel = document.createElement('label');
    noteLabel.className = 'ap-field';
    noteLabel.appendChild(document.createTextNode('운영 메모'));
    var note = document.createElement('textarea');
    note.maxLength = 500;
    note.rows = 3;
    noteLabel.appendChild(note);
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'sc-btn';
    del.textContent = 'soft delete';
    del.disabled = post.status === 'DELETED';
    del.addEventListener('click', function () {
      api('/api/admin/posts/' + encodeURIComponent(post.id) + '/soft-delete', 'POST', {
        reasonCode: reasonSel.value,
        operatorNote: note.value,
      }).then(function (out) {
        if (!out.res.ok || !out.data || out.data.ok !== true) {
          setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || '삭제 실패');
          return;
        }
        setStatus('soft delete 하고 운영 이력을 남겼습니다.');
        loadDetail(post.id);
        loadList();
      });
    });
    var restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'sc-btn';
    restore.textContent = '복구';
    restore.disabled = post.status === 'ACTIVE';
    restore.addEventListener('click', function () {
      api('/api/admin/posts/' + encodeURIComponent(post.id) + '/restore', 'POST', {
        reasonCode: restoreReasonSel.value,
        operatorNote: note.value,
      }).then(function (out) {
        if (!out.res.ok || !out.data || out.data.ok !== true) {
          setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || '복구 실패');
          return;
        }
        setStatus('복구하고 운영 이력을 남겼습니다.');
        loadDetail(post.id);
        loadList();
      });
    });
    var label = document.createElement('label');
    label.className = 'ap-field';
    label.appendChild(document.createTextNode('기존 제재 적용(선택)'));
    var sel = document.createElement('select');
    SANCTIONS.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      sel.appendChild(opt);
    });
    label.appendChild(sel);
    var apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'sc-btn';
    apply.textContent = '제재 적용';
    apply.addEventListener('click', function () {
      if (!sel.value) {
        setStatus('제재 종류를 고르거나, 글만 삭제하세요.');
        return;
      }
      if (!post.author || !post.author.userId) {
        setStatus('작성자 정보가 없어 제재할 수 없습니다.');
        return;
      }
      api('/api/admin/posts/' + encodeURIComponent(post.id) + '/sanction', 'POST', {
        action: sel.value,
        reasonCode: reasonSel.value,
        operatorNote: note.value,
        sourceId: post.id,
      }).then(function (out) {
        if (!out.res.ok || !out.data || out.data.ok !== true) {
          setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || out.data.error || '제재 실패');
          return;
        }
        var extra = out.data.limitation ? ' 제재와 이력은 별도 저장입니다.' : '';
        setStatus('기존 제재 API를 호출하고 운영 이력을 남겼습니다.' + extra);
        loadPostAudit(post.id);
      });
    });
    var histLink = document.createElement('a');
    histLink.className = 'sc-btn';
    histLink.href = '/admin/audit/#targetType=POST&targetId=' + encodeURIComponent(post.id);
    histLink.textContent = '운영 이력 전체 보기';
    var histBox = document.createElement('div');
    histBox.id = 'ap-post-audit';
    var histTitle = document.createElement('h3');
    histTitle.className = 'sc-section-title';
    histTitle.textContent = '이 게시물 운영 이력';
    histBox.appendChild(histTitle);
    actions.appendChild(del);
    actions.appendChild(restore);
    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(body);
    card.appendChild(reasonLabel);
    card.appendChild(restoreReasonLabel);
    card.appendChild(noteLabel);
    card.appendChild(actions);
    card.appendChild(label);
    card.appendChild(apply);
    card.appendChild(histLink);
    card.appendChild(histBox);
    box.appendChild(card);
    loadPostAudit(post.id, histBox);
  }

  function loadPostAudit(postId, box) {
    var host = box || document.getElementById('ap-post-audit');
    if (!host) return Promise.resolve();
    return api(
      '/api/admin/audit?targetType=POST&targetId=' + encodeURIComponent(postId) + '&limit=20',
      'GET'
    ).then(function (out) {
      var title = host.querySelector('h3') || host.firstChild;
      host.textContent = '';
      if (title) host.appendChild(title);
      else {
        var h = document.createElement('h3');
        h.className = 'sc-section-title';
        h.textContent = '이 게시물 운영 이력';
        host.appendChild(h);
      }
      if (!out.res.ok || !out.data || out.data.ok !== true) {
        var fail = document.createElement('p');
        fail.className = 'muted';
        fail.textContent = '이력을 불러오지 못했습니다.';
        host.appendChild(fail);
        return;
      }
      var evs = out.data.events || [];
      if (!evs.length) {
        var empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = '이 게시물 직접조치 이력이 없습니다.';
        host.appendChild(empty);
        return;
      }
      evs.forEach(function (ev) {
        var p = document.createElement('p');
        p.className = 'muted';
        p.textContent =
          (ev.createdAt || '') +
          ' · ' + (ev.actorDisplayName || ev.actorUserId || '관리자') +
          ' · ' + (ev.actionType || '') +
          ' · ' + (ev.reasonCode || '') +
          (ev.sanctionId ? ' · 제재있음' : '') +
          (ev.operatorNote ? ' · ' + ev.operatorNote.slice(0, 40) : '');
        host.appendChild(p);
      });
    });
  }

  function loadList() {
    var q = document.getElementById('ap-q');
    var query = q && q.value ? '?q=' + encodeURIComponent(q.value) : '';
    return api('/api/admin/posts' + query, 'GET').then(function (out) {
      if (!out.res.ok || !out.data || out.data.ok !== true) {
        setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || '목록을 불러오지 못했습니다.');
        return;
      }
      renderList(out.data.posts || []);
    });
  }

  function loadDetail(id) {
    return api('/api/admin/posts/' + encodeURIComponent(id), 'GET').then(function (out) {
      if (!out.res.ok || !out.data || out.data.ok !== true) {
        setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || '상세를 불러오지 못했습니다.');
        return;
      }
      renderDetail(out.data.post);
    });
  }

  var form = document.getElementById('ap-search');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      loadList();
    });
  }

  loadList();
  var hashed = postIdFromHash();
  if (hashed) loadDetail(hashed);
})();
