(function () {
  'use strict';

  var listEl = document.getElementById('op-list');
  var statusEl = document.getElementById('op-status');
  var formEl = document.getElementById('op-form');
  var titleEl = document.getElementById('op-title');
  var contentEl = document.getElementById('op-content');
  var idEl = document.getElementById('op-post-id');
  var saveEl = document.getElementById('op-save');
  var resetEl = document.getElementById('op-reset');

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
    if (statusEl) statusEl.textContent = text || '';
  }

  function apiError(data, fallback) {
    var err = data && data.error;
    if (err && typeof err === 'object') return err.message || err.code || fallback;
    if (typeof err === 'string') return err;
    return fallback;
  }

  function resetForm() {
    if (idEl) idEl.value = '';
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    if (saveEl) saveEl.textContent = '작성';
  }

  function fillForm(post) {
    if (!post) return;
    if (idEl) idEl.value = post.id || '';
    if (titleEl) titleEl.value = post.title || '';
    if (contentEl) contentEl.value = post.content || '';
    if (saveEl) saveEl.textContent = '수정 저장';
  }

  function renderList(posts) {
    if (!listEl) return;
    listEl.textContent = '';
    (posts || []).forEach(function (post) {
      var card = document.createElement('article');
      card.className = 'sc-card op-card';
      var title = document.createElement('h3');
      title.className = 'sc-section-title';
      title.textContent = (post.isOfficial === true ? '[공식] ' : '') + (post.title || '(제목 없음)');
      var meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent = (post.createdAt || '') + (post.author && post.author.displayName ? ' · ' + post.author.displayName : '');
      var body = document.createElement('p');
      body.textContent = post.content || '';
      var actions = document.createElement('div');
      actions.className = 'op-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'sc-btn';
      editBtn.textContent = '수정';
      editBtn.addEventListener('click', function () {
        fillForm(post);
        setStatus('수정 중: ' + (post.title || ''));
      });
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sc-btn';
      delBtn.textContent = '종료/삭제';
      delBtn.addEventListener('click', function () {
        if (!window.confirm('이 공식글을 종료(삭제)할까요?')) return;
        fetch('/api/admin/board/official-posts/' + encodeURIComponent(post.id), {
          method: 'DELETE',
          headers: authHeaders(),
          credentials: 'same-origin',
        }).then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        }).then(function (out) {
          if (!out.res.ok || !out.data || out.data.ok !== true) {
            setStatus(apiError(out.data, '삭제에 실패했습니다.'));
            return;
          }
          if (idEl && idEl.value === post.id) resetForm();
          setStatus('공식글을 종료했습니다.');
          loadList();
        }).catch(function () {
          setStatus('삭제에 실패했습니다.');
        });
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(body);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
    if (!(posts || []).length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '현재 공식글이 없습니다.';
      listEl.appendChild(empty);
    }
  }

  function loadList() {
    fetch('/api/admin/board/official-posts', {
      headers: authHeaders(),
      credentials: 'same-origin',
    }).then(function (res) {
      return res.json().then(function (data) {
        return { res: res, data: data };
      });
    }).then(function (out) {
      if (!out.res.ok || !out.data || out.data.ok !== true) {
        setStatus(apiError(out.data, '공식글 목록을 불러오지 못했습니다.'));
        return;
      }
      renderList(out.data.posts || []);
    }).catch(function () {
      setStatus('공식글 목록을 불러오지 못했습니다.');
    });
  }

  if (formEl) {
    formEl.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var title = titleEl ? String(titleEl.value || '').trim() : '';
      var content = contentEl ? String(contentEl.value || '').trim() : '';
      if (!title || !content) {
        setStatus('제목과 본문을 입력하세요.');
        return;
      }
      var editingId = idEl ? String(idEl.value || '').trim() : '';
      var url = editingId
        ? '/api/admin/board/official-posts/' + encodeURIComponent(editingId)
        : '/api/admin/board/official-posts';
      fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: authHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ title: title, content: content }),
      }).then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      }).then(function (out) {
        if (!out.res.ok || !out.data || out.data.ok !== true) {
          setStatus(apiError(out.data, '저장에 실패했습니다.'));
          return;
        }
        resetForm();
        setStatus(editingId ? '공식글을 수정했습니다.' : '공식글을 작성했습니다.');
        loadList();
      }).catch(function () {
        setStatus('저장에 실패했습니다.');
      });
    });
  }

  if (resetEl) {
    resetEl.addEventListener('click', function () {
      resetForm();
      setStatus('');
    });
  }

  loadList();
})();
