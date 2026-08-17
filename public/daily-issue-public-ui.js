/**
 * 데일리 이슈 사용자 공개 화면 1차 — 중앙광장 패널
 * 목록/상세 · 로딩·빈·오류 구분 · 금지 필드 미표시
 */
(function (global) {
  'use strict';

  var FORBIDDEN_KEYS = [
    'rawText',
    'reviewerId',
    'choices',
    'stance',
    'audit',
    'auditLogs',
    'alignmentDirection',
    'alignment_direction',
  ];

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
    var t = Date.parse(iso);
    if (!isFinite(t)) return escapeHtml(String(iso));
    try {
      return escapeHtml(new Date(t).toLocaleString('ko-KR'));
    } catch (_) {
      return escapeHtml(String(iso));
    }
  }

  function assertNoForbidden(obj) {
    var raw = JSON.stringify(obj || {});
    for (var i = 0; i < FORBIDDEN_KEYS.length; i++) {
      if (raw.indexOf('"' + FORBIDDEN_KEYS[i] + '"') >= 0) {
        throw new Error('FORBIDDEN_FIELD:' + FORBIDDEN_KEYS[i]);
      }
    }
  }

  function claimsByClass(item, classification) {
    return (item && Array.isArray(item.claims) ? item.claims : []).filter(function (c) {
      return c && c.classification === classification && c.text;
    });
  }

  function createStateEl(kind, text) {
    var p = document.createElement('p');
    p.className = 'sc-daily-public-state sc-daily-public-state--' + kind;
    p.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    p.textContent = text;
    return p;
  }

  function createPublicUi(deps) {
    var api = (deps && deps.api) || global.DailyIssuePublicApiClient;
    var panel = deps && deps.panel;
    var tabs = deps && deps.tabs;
    var moreBtn = deps && deps.moreBtn;
    var editionBar = deps && deps.editionBar;
    var state = {
      view: 'list',
      selectedId: null,
      list: [],
      detail: null,
      loading: false,
      error: null,
      generation: 0,
      viewerReaction: null,
    };

    var LOCAL_REACTION_KEY = 'sc_daily_issue_seed_reaction_v1';

    function loadLocalMap() {
      try {
        if (typeof localStorage === 'undefined') return {};
        return JSON.parse(localStorage.getItem(LOCAL_REACTION_KEY) || '{}') || {};
      } catch (_) {
        return {};
      }
    }

    function readLocalReaction(id) {
      var map = loadLocalMap();
      return map[String(id)] || null;
    }

    function setLocalReaction(id, value) {
      if (typeof localStorage === 'undefined') return;
      var map = loadLocalMap();
      if (!value) delete map[String(id)];
      else map[String(id)] = value;
      try {
        localStorage.setItem(LOCAL_REACTION_KEY, JSON.stringify(map));
      } catch (_) {}
    }

    function toggleLocalReaction(id, type) {
      var cur = readLocalReaction(id);
      setLocalReaction(id, cur === type ? null : type);
      return readLocalReaction(id);
    }

    function setChromeForPublic() {
      if (tabs) {
        tabs.hidden = true;
        tabs.textContent = '';
      }
      if (moreBtn) {
        moreBtn.hidden = true;
        if (typeof moreBtn.setAttribute === 'function') moreBtn.setAttribute('aria-expanded', 'false');
      }
      if (panel) {
        if (panel.classList && typeof panel.classList.remove === 'function') {
          panel.classList.remove('centrist-issues-panel--clip');
        } else if (typeof panel.className === 'string') {
          panel.className = String(panel.className || '')
            .split(/\s+/)
            .filter(function (c) {
              return c && c !== 'centrist-issues-panel--clip';
            })
            .join(' ');
        }
      }
      if (editionBar) {
        editionBar.textContent = '게시 중인 데일리 이슈';
      }
    }

    function renderList() {
      if (!panel) return;
      panel.textContent = '';
      panel.removeAttribute('aria-labelledby');
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', '게시 중인 데일리 이슈 목록');

      if (state.loading) {
        panel.appendChild(createStateEl('loading', '데일리 이슈를 불러오는 중…'));
        return;
      }
      if (state.error) {
        panel.appendChild(createStateEl('error', '데일리 이슈를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'sc-daily-public-retry sc-btn';
        retry.textContent = '다시 시도';
        retry.addEventListener('click', function () {
          loadList();
        });
        panel.appendChild(retry);
        return;
      }
      if (!state.list.length) {
        panel.appendChild(createStateEl('empty', '현재 게시된 데일리 이슈가 없습니다'));
        return;
      }

      var ul = document.createElement('ul');
      ul.className = 'sc-daily-public-list';
      state.list.forEach(function (it) {
        if (!it || !it.id) return;
        var li = document.createElement('li');
        li.className = 'sc-daily-public-list__item';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-daily-public-list__btn centrist-issue-card';
        btn.setAttribute('data-issue-id', String(it.id));
        var h = document.createElement('h3');
        h.className = 'centrist-issue-card__topic';
        h.textContent = it.title || '(제목 없음)';
        var meta = document.createElement('p');
        meta.className = 'sc-daily-public-meta muted';
        meta.textContent =
          '게시 ' + plainTime(it.publishedAt) + ' · 만료 ' + plainTime(it.publishExpiresAt);
        btn.appendChild(h);
        btn.appendChild(meta);
        btn.addEventListener('click', function () {
          openDetail(it.id);
        });
        li.appendChild(btn);
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    }

    function plainTime(iso) {
      if (!iso) return '—';
      var t = Date.parse(iso);
      if (!isFinite(t)) return String(iso);
      try {
        return new Date(t).toLocaleString('ko-KR');
      } catch (_) {
        return String(iso);
      }
    }

    function appendClaimBlock(parent, title, claims) {
      if (!claims || !claims.length) return;
      var wrap = document.createElement('div');
      wrap.className = 'centrist-issue-card__claim-section';
      var h = document.createElement('h4');
      h.className = 'centrist-issue-card__claim-title';
      h.textContent = title;
      wrap.appendChild(h);
      var ul = document.createElement('ul');
      ul.className = 'centrist-issue-card__claim-list';
      claims.forEach(function (c) {
        var li = document.createElement('li');
        li.textContent = c.text;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      parent.appendChild(wrap);
    }

    function renderDetail() {
      if (!panel) return;
      panel.textContent = '';
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', '데일리 이슈 상세');

      if (state.loading) {
        panel.appendChild(createStateEl('loading', '이슈 상세를 불러오는 중…'));
        return;
      }
      if (state.error) {
        panel.appendChild(createStateEl('error', '이슈 상세를 불러오지 못했습니다.'));
        var backErr = document.createElement('button');
        backErr.type = 'button';
        backErr.className = 'sc-daily-public-back sc-btn';
        backErr.textContent = '목록으로';
        backErr.addEventListener('click', function () {
          state.view = 'list';
          state.detail = null;
          state.error = null;
          renderList();
        });
        panel.appendChild(backErr);
        return;
      }

      var item = state.detail;
      if (!item) {
        panel.appendChild(createStateEl('empty', '현재 게시된 데일리 이슈가 없습니다'));
        return;
      }

      try {
        assertNoForbidden(item);
      } catch (_) {
        panel.appendChild(createStateEl('error', '표시할 수 없는 이슈 데이터입니다.'));
        return;
      }

      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'sc-daily-public-back sc-btn';
      back.textContent = '← 목록으로';
      back.addEventListener('click', function () {
        state.view = 'list';
        state.detail = null;
        state.error = null;
        renderList();
      });
      panel.appendChild(back);

      var art = document.createElement('article');
      art.className = 'centrist-issue-card sc-daily-public-detail';

      var h3 = document.createElement('h3');
      h3.className = 'centrist-issue-card__topic';
      h3.textContent = item.title || '(제목 없음)';
      art.appendChild(h3);

      var times = document.createElement('p');
      times.className = 'sc-daily-public-meta muted';
      times.textContent =
        '게시 ' + plainTime(item.publishedAt) + ' · 만료 ' + plainTime(item.publishExpiresAt);
      art.appendChild(times);

      var confirmed = claimsByClass(item, 'CONFIRMED_FACT');
      if (confirmed.length) {
        appendClaimBlock(art, '핵심 사실', confirmed);
      } else if (item.confirmedSummary) {
        var sum = document.createElement('p');
        sum.className = 'centrist-issue-card__summary';
        sum.textContent = '핵심 사실: ' + String(item.confirmedSummary);
        art.appendChild(sum);
      }

      appendClaimBlock(art, '확인 중인 내용', claimsByClass(item, 'UNVERIFIED'));

      var refs = Array.isArray(item.sourceRefs) ? item.sourceRefs : [];
      if (refs.length) {
        var sw = document.createElement('div');
        sw.className = 'centrist-issue-card__sources';
        var sh = document.createElement('h4');
        sh.className = 'centrist-issue-card__claim-title';
        sh.textContent = '출처';
        sw.appendChild(sh);
        var sul = document.createElement('ul');
        refs.forEach(function (r) {
          if (!r) return;
          var li = document.createElement('li');
          var line = String(r.publisher || '') + (r.title ? ' · ' + String(r.title) : '');
          li.textContent = line;
          if (r.url) {
            var a = document.createElement('a');
            a.href = String(r.url);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = ' 원문 보기';
            li.appendChild(a);
          }
          sul.appendChild(li);
        });
        sw.appendChild(sul);
        art.appendChild(sw);
      }

      if (item.discussionPrompt) {
        var pq = document.createElement('p');
        pq.className = 'centrist-issue-card__question';
        pq.textContent = String(item.discussionPrompt);
        art.appendChild(pq);
      }

      var reactWrap = document.createElement('div');
      reactWrap.className = 'sc-daily-public-reactions';
      var likeBtn = document.createElement('button');
      likeBtn.type = 'button';
      likeBtn.className = 'sc-btn sc-daily-public-like';
      likeBtn.textContent = '추천';
      var dislikeBtn = document.createElement('button');
      dislikeBtn.type = 'button';
      dislikeBtn.className = 'sc-btn sc-daily-public-dislike';
      dislikeBtn.textContent = '비추천';
      function currentReaction() {
        return state.viewerReaction || readLocalReaction(item.id);
      }
      function paintReactionButtons() {
        var cur = currentReaction();
        likeBtn.setAttribute('aria-pressed', cur === 'LIKE' ? 'true' : 'false');
        dislikeBtn.setAttribute('aria-pressed', cur === 'DISLIKE' ? 'true' : 'false');
      }
      function onToggle(type) {
        if (!api || typeof api.toggleReaction !== 'function') {
          state.viewerReaction = toggleLocalReaction(item.id, type);
          paintReactionButtons();
          return;
        }
        api
          .toggleReaction(item.id, type)
          .then(function (data) {
            state.viewerReaction = data && data.active ? data.reactionType : null;
            setLocalReaction(item.id, state.viewerReaction);
            paintReactionButtons();
          })
          .catch(function (err) {
            if (err && (err.status === 401 || err.code === 'UNAUTHORIZED')) {
              state.viewerReaction = toggleLocalReaction(item.id, type);
              paintReactionButtons();
              return;
            }
            state.error = err;
          });
      }
      likeBtn.addEventListener('click', function () {
        onToggle('LIKE');
      });
      dislikeBtn.addEventListener('click', function () {
        onToggle('DISLIKE');
      });
      reactWrap.appendChild(likeBtn);
      reactWrap.appendChild(dislikeBtn);
      art.appendChild(reactWrap);
      paintReactionButtons();

      panel.appendChild(art);
    }

    function paint() {
      setChromeForPublic();
      if (state.view === 'detail') renderDetail();
      else renderList();
    }

    function loadList() {
      if (!api || typeof api.listPublished !== 'function') {
        state.loading = false;
        state.error = makeLocalError('API_UNAVAILABLE');
        state.list = [];
        paint();
        return;
      }
      var gen = ++state.generation;
      state.view = 'list';
      state.loading = true;
      state.error = null;
      paint();
      api
        .listPublished({ limit: 20, offset: 0 })
        .then(function (data) {
          if (gen !== state.generation) return;
          var items = (data && data.items) || [];
          items.forEach(assertNoForbidden);
          state.list = items;
          state.loading = false;
          state.error = null;
          paint();
        })
        .catch(function (err) {
          if (gen !== state.generation) return;
          state.loading = false;
          state.error = err || makeLocalError('LIST_FAILED');
          state.list = [];
          paint();
        });
    }

    function openDetail(id) {
      if (!api || typeof api.getPublished !== 'function') return;
      var gen = ++state.generation;
      state.view = 'detail';
      state.selectedId = id;
      state.loading = true;
      state.error = null;
      state.detail = null;
      paint();
      api
        .getPublished(id)
        .then(function (data) {
          if (gen !== state.generation) return;
          var item = data && data.item ? data.item : data;
          assertNoForbidden(item);
          state.detail = item;
          state.viewerReaction = (data && data.viewerReaction) || readLocalReaction(item && item.id) || null;
          state.loading = false;
          state.error = null;
          paint();
        })
        .catch(function (err) {
          if (gen !== state.generation) return;
          state.loading = false;
          state.error = err || makeLocalError('DETAIL_FAILED');
          state.detail = null;
          paint();
        });
    }

    function makeLocalError(code) {
      var e = new Error(code);
      e.code = code;
      return e;
    }

    return {
      refresh: loadList,
      openDetail: openDetail,
      getState: function () {
        return state;
      },
      paint: paint,
    };
  }

  var ui = {
    create: createPublicUi,
    FORBIDDEN_KEYS: FORBIDDEN_KEYS,
  };
  global.DailyIssuePublicUi = ui;
  if (typeof module === 'object' && module.exports) module.exports = ui;
})(typeof window !== 'undefined' ? window : globalThis);
