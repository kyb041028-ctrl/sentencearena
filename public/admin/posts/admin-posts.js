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
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'sc-btn';
    del.textContent = 'soft delete';
    del.disabled = post.status === 'DELETED';
    del.addEventListener('click', function () {
      api('/api/admin/posts/' + encodeURIComponent(post.id) + '/soft-delete', 'POST', {}).then(function (out) {
        if (!out.res.ok || !out.data || out.data.ok !== true) {
          setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || '삭제 실패');
          return;
        }
        setStatus('soft delete 했습니다. 직접조치 전체 이력 테이블은 아직 없습니다.');
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
      api('/api/admin/posts/' + encodeURIComponent(post.id) + '/restore', 'POST', {}).then(function (out) {
        if (!out.res.ok || !out.data || out.data.ok !== true) {
          setStatus((out.data && out.data.error && (out.data.error.message || out.data.error.code)) || '복구 실패');
          return;
        }
        setStatus('복구했습니다.');
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
      api('/api/admin/moderation/users/' + encodeURIComponent(post.author.userId) + '/sanction', 'POST', {
        action: sel.value,
        sourceId: post.id,
      }).then(function (out) {
        if (!out.res.ok || !out.data || out.data.ok !== true) {
          setStatus((out.data && out.data.error) || '제재 실패');
          return;
        }
        setStatus('기존 제재 API를 호출했습니다. 글 삭제와는 별개입니다.');
      });
    });
    actions.appendChild(del);
    actions.appendChild(restore);
    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(body);
    card.appendChild(actions);
    card.appendChild(label);
    card.appendChild(apply);
    box.appendChild(card);
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
