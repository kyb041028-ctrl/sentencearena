/**
 * 센텐스아레나 — Search System v1 (통합검색: 시민 + 토론)
 * displayName 기반 · userId는 내부 식별자
 */
(function (global) {
  'use strict';

  var BUNDLE_KEY = 'sc_board_bundle_v1';
  var MAX_CITIZEN_RESULTS = 15;
  var MAX_DISCUSSION_RESULTS = 20;
  var SNIPPET_LEN = 50;

  var TERRITORY_DATA_ATTR = {
    COMMON: 'centrist',
    CENTRIST: 'centrist',
    PROGRESSIVE: 'reform',
    CONSERVATIVE: 'order',
    KANTAPBIYA: 'alien',
  };

  var TERRITORY_LABELS = {
    COMMON: '중앙광장',
    CENTRIST: '중앙광장',
    CONSERVATIVE: '수호영토',
    PROGRESSIVE: '개척영토',
    KANTAPBIYA: '외계행성',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function trim(s) {
    return String(s || '').trim();
  }

  function normalizeQuery(q) {
    return trim(q).toLowerCase();
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function territoryIdToDataTerritory(tid) {
    var key = String(tid || 'COMMON').trim().toUpperCase() || 'COMMON';
    return TERRITORY_DATA_ATTR[key] || 'centrist';
  }

  function territoryShortLabel(tid) {
    var key = String(tid || 'COMMON').trim().toUpperCase() || 'COMMON';
    return TERRITORY_LABELS[key] || key;
  }

  function resolveDisplayName(userId) {
    if (typeof global.resolveDisplayName === 'function') {
      return global.resolveDisplayName(userId) || trim(userId);
    }
    return trim(userId);
  }

  function formatPostDate(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return '';
    }
  }

  function plainBodyText(body, format) {
    if (global.BoardRichContentCore && typeof global.BoardRichContentCore.excerptFromBody === 'function') {
      // full plain for search: use htmlToPlainText when rich
      if (String(format || '').toLowerCase() === 'rich' && global.BoardRichContentCore.htmlToPlainText) {
        return trim(global.BoardRichContentCore.htmlToPlainText(body));
      }
    }
    return trim(body);
  }

  function snippetBody(body, format) {
    if (global.BoardRichContentCore && typeof global.BoardRichContentCore.excerptFromBody === 'function') {
      return global.BoardRichContentCore.excerptFromBody(body, format, SNIPPET_LEN);
    }
    var s = String(body || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length <= SNIPPET_LEN) return s;
    return s.slice(0, SNIPPET_LEN) + '…';
  }

  function matchRank(query, text) {
    var nq = normalizeQuery(query);
    var nt = trim(text).toLowerCase();
    if (!nq || !nt) return -1;
    if (nt === nq) return 0;
    if (nt.indexOf(nq) === 0) return 1;
    if (nt.indexOf(nq) >= 0) return 2;
    return -1;
  }

  function scoreDiscussionPost(query, post) {
    var nq = normalizeQuery(query);
    if (!nq || !post) return -1;

    var title = trim(post.title);
    var body = plainBodyText(post.body, post.bodyFormat);
    var authorName = resolveDisplayName(post.authorId);

    var titleRank = matchRank(query, title);
    if (titleRank >= 0) return titleRank;

    var bodyLower = body.toLowerCase();
    if (bodyLower.indexOf(nq) >= 0) return 3;

    var authorRank = matchRank(query, authorName);
    if (authorRank >= 0) return 4 + authorRank;

    return -1;
  }

  function parsePostBucketKey(key) {
    var m = String(key || '').match(/^(.+)_s(\d+)$/);
    if (!m) return { territoryId: 'COMMON', stage: 1 };
    return { territoryId: m[1], stage: Math.max(1, Math.min(4, parseInt(m[2], 10) || 1)) };
  }

  function collectPostsFromBundle() {
    var out = [];
    var seen = {};
    try {
      var raw = localStorage.getItem(BUNDLE_KEY);
      if (!raw) return out;
      var bundle = JSON.parse(raw);
      var pmap = bundle && bundle.posts;
      if (!pmap || typeof pmap !== 'object') return out;

      Object.keys(pmap).forEach(function (key) {
        var loc = parsePostBucketKey(key);
        var arr = pmap[key];
        if (!Array.isArray(arr)) return;
        arr.forEach(function (p) {
          if (!p || typeof p !== 'object') return;
          var postId = trim(p.id);
          if (!postId || seen[postId]) return;
          seen[postId] = true;
          out.push({
            postId: postId,
            title: trim(p.title) || '(제목 없음)',
            body: p.body == null ? '' : String(p.body),
            bodyFormat: String(p.bodyFormat || '').toLowerCase() === 'rich' ? 'rich' : 'plain',
            authorId: trim(p.authorId),
            createdAt: p.createdAt,
            territoryId: loc.territoryId,
            stage: loc.stage,
          });
        });
      });
    } catch (_) {}
    return out;
  }

  function searchCitizensByDisplayName(query) {
    var q = trim(query);
    if (!q) return [];

    var index =
      typeof global.collectDisplayNameIndex === 'function'
        ? global.collectDisplayNameIndex()
        : { citizens: [] };
    var list = index && Array.isArray(index.citizens) ? index.citizens : [];
    var seen = {};
    var results = [];

    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row) continue;
      var userId = trim(row.userId);
      if (!userId || seen[userId]) continue;
      var displayName = trim(row.displayName) || resolveDisplayName(userId);
      var rank = matchRank(q, displayName);
      if (rank < 0) continue;
      seen[userId] = true;
      results.push({ userId: userId, displayName: displayName, _rank: rank });
    }

    results.sort(function (a, b) {
      if (a._rank !== b._rank) return a._rank - b._rank;
      return String(a.displayName).localeCompare(String(b.displayName), 'ko');
    });

    if (results.length > MAX_CITIZEN_RESULTS) results.length = MAX_CITIZEN_RESULTS;

    return results.map(function (r) {
      return { userId: r.userId, displayName: r.displayName };
    });
  }

  function searchDiscussionsByQuery(query) {
    var q = trim(query);
    if (!q) return [];

    var posts = collectPostsFromBundle();
    var results = [];

    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      var rank = scoreDiscussionPost(q, post);
      if (rank < 0) continue;
      results.push({
        postId: post.postId,
        title: post.title,
        body: post.body,
        bodyFormat: post.bodyFormat || 'plain',
        authorId: post.authorId,
        authorDisplayName: resolveDisplayName(post.authorId) || post.authorId || '익명',
        createdAt: post.createdAt,
        territoryId: post.territoryId,
        stage: post.stage,
        _rank: rank,
      });
    }

    results.sort(function (a, b) {
      if (a._rank !== b._rank) return a._rank - b._rank;
      var ta = new Date(a.createdAt).getTime() || 0;
      var tb = new Date(b.createdAt).getTime() || 0;
      return tb - ta;
    });

    if (results.length > MAX_DISCUSSION_RESULTS) results.length = MAX_DISCUSSION_RESULTS;

    return results.map(function (r) {
      return {
        postId: r.postId,
        title: r.title,
        body: r.body,
        bodyFormat: r.bodyFormat || 'plain',
        authorId: r.authorId,
        authorDisplayName: r.authorDisplayName,
        createdAt: r.createdAt,
        territoryId: r.territoryId,
        stage: r.stage,
      };
    });
  }

  function buildCitizenThumb(userId) {
    var span = document.createElement('span');
    span.className = 'sc-search-modal__thumb board__author-thumb';
    var url =
      typeof global.__scGetProfilePhotoDataUrl === 'function'
        ? global.__scGetProfilePhotoDataUrl(userId)
        : '';
    if (url) {
      var im = document.createElement('img');
      im.src = url;
      im.alt = '';
      im.className = 'board__author-thumb-img';
      span.appendChild(im);
    } else {
      span.classList.add('board__author-thumb--empty');
      span.setAttribute('aria-hidden', 'true');
    }
    return span;
  }

  function buildCitizenMeta(userId) {
    var P = global.PlayerProgression;
    if (!P) return null;
    var meta = document.createElement('span');
    meta.className = 'sc-search-modal__meta muted';
    var parts = [];
    if (typeof P.getState === 'function' && typeof P.territoryLabelKo === 'function') {
      var st = P.getState(userId);
      if (st && st.territoryId) {
        var badge = document.createElement('span');
        badge.className = 'sc-badge sc-search-modal__terr';
        badge.dataset.territory = territoryIdToDataTerritory(st.territoryId);
        badge.textContent = P.territoryLabelKo(st.territoryId);
        parts.push(badge);
      }
    }
    if (typeof P.getDisplay === 'function') {
      var d = P.getDisplay(userId);
      if (d && d.level != null) {
        var lv = document.createElement('span');
        lv.textContent = 'Lv.' + d.level;
        parts.push(lv);
      }
    }
    if (!parts.length) return null;
    parts.forEach(function (node, idx) {
      meta.appendChild(node);
      if (idx < parts.length - 1) {
        meta.appendChild(document.createTextNode(' · '));
      }
    });
    return meta;
  }

  function wireCitizenProfileLink(anchor, userId) {
    var id = trim(userId);
    if (!anchor || !id) return;
    anchor.classList.add('sc-user-profile-link');
    anchor.setAttribute('role', 'button');
    anchor.setAttribute('tabindex', '0');
    anchor.setAttribute('title', '클릭해서 유저 프로필 보기');
    var label = resolveDisplayName(id);
    anchor.setAttribute('aria-label', label + ' — 클릭해서 유저 프로필 보기');
    function openProfile(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      closeSearchModal();
      if (typeof global.openUserProfile === 'function') {
        global.openUserProfile(id);
      }
    }
    anchor.addEventListener('click', openProfile);
    anchor.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        openProfile(ev);
      }
    });
  }

  function wireDiscussionOpen(titleEl, row) {
    if (!titleEl || !row) return;
    titleEl.setAttribute('role', 'button');
    titleEl.setAttribute('tabindex', '0');
    titleEl.setAttribute(
      'aria-label',
      trim(row.title) + ' — 토론 글 열기',
    );
    function openPost(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      closeSearchModal();
      if (typeof global.__scBoardNavigateToPost === 'function') {
        global.__scBoardNavigateToPost(row.territoryId, row.stage, row.postId);
      }
    }
    titleEl.addEventListener('click', openPost);
    titleEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        openPost(ev);
      }
    });
  }

  function renderCitizenSearchResults(query) {
    var listEl = el('sc-search-citizens-list');
    var emptyEl = el('sc-search-citizens-empty');
    if (!listEl) return;

    listEl.textContent = '';
    var q = trim(query);

    if (!q) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '검색어를 입력해 주세요.';
      }
      return;
    }

    var rows = searchCitizensByDisplayName(q);

    if (!rows.length) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '검색 결과가 없습니다.';
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'sc-search-modal__item';
      li.setAttribute('role', 'listitem');

      var thumb = buildCitizenThumb(row.userId);
      wireCitizenProfileLink(thumb, row.userId);

      var body = document.createElement('div');
      body.className = 'sc-search-modal__item-body';

      var nameEl = document.createElement('span');
      nameEl.className = 'sc-search-modal__name';
      nameEl.textContent = row.displayName;
      wireCitizenProfileLink(nameEl, row.userId);

      body.appendChild(nameEl);
      var meta = buildCitizenMeta(row.userId);
      if (meta) body.appendChild(meta);

      li.appendChild(thumb);
      li.appendChild(body);
      listEl.appendChild(li);
    });
  }

  function renderDiscussionSearchResults(query) {
    var listEl = el('sc-search-discussions-list');
    var emptyEl = el('sc-search-discussions-empty');
    if (!listEl) return;

    listEl.textContent = '';
    var q = trim(query);

    if (!q) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '검색어를 입력해 주세요.';
      }
      return;
    }

    var rows = searchDiscussionsByQuery(q);

    if (!rows.length) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '검색 결과가 없습니다.';
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'board__item sc-search-modal__discussion-item';
      li.setAttribute('role', 'listitem');

      var hdr = document.createElement('div');
      hdr.className = 'board__item-hdr';

      var title = document.createElement('h3');
      title.className = 'board__item-title board__item-title--link';
      title.textContent = row.title || '(제목 없음)';
      wireDiscussionOpen(title, row);

      var snippet = document.createElement('p');
      snippet.className = 'sc-search-modal__discussion-snippet';
      snippet.textContent = snippetBody(row.body, row.bodyFormat);

      var meta = document.createElement('div');
      meta.className = 'board__item-meta';

      var metaTxt = document.createElement('span');
      metaTxt.className = 'board__author-line__text';
      metaTxt.textContent =
        (row.authorDisplayName || '익명') + ' · ' + formatPostDate(row.createdAt);

      var terrBadge = document.createElement('span');
      terrBadge.className = 'sc-badge sc-search-modal__terr';
      terrBadge.dataset.territory = territoryIdToDataTerritory(row.territoryId);
      terrBadge.textContent = territoryShortLabel(row.territoryId);

      meta.appendChild(metaTxt);
      meta.appendChild(terrBadge);

      hdr.appendChild(title);
      if (snippet.textContent) hdr.appendChild(snippet);
      hdr.appendChild(meta);
      li.appendChild(hdr);
      listEl.appendChild(li);
    });
  }

  function renderSearchResults(query) {
    renderCitizenSearchResults(query);
    renderDiscussionSearchResults(query);
  }

  function resetSearchModalState() {
    var input = el('sc-search-modal-input');
    if (input) input.value = '';
    renderSearchResults('');
  }

  function openSearchModal() {
    var modal = el('sc-search-modal');
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    resetSearchModalState();
    var input = el('sc-search-modal-input');
    if (input) {
      requestAnimationFrame(function () {
        input.focus();
      });
    }
  }

  function closeSearchModal() {
    var modal = el('sc-search-modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    resetSearchModalState();
  }

  function onSearchInput() {
    var input = el('sc-search-modal-input');
    renderSearchResults(input ? input.value : '');
  }

  function onDocKey(ev) {
    if (ev.key !== 'Escape') return;
    var modal = el('sc-search-modal');
    if (modal && !modal.hidden) {
      ev.preventDefault();
      closeSearchModal();
    }
  }

  function initUi() {
    var btn = el('sc-map-tab-search');
    var modal = el('sc-search-modal');
    if (!btn || !modal) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openSearchModal();
    });

    var backdrop = el('sc-search-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeSearchModal);

    var closeBtn = el('sc-search-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeSearchModal);

    var input = el('sc-search-modal-input');
    if (input) {
      input.addEventListener('input', onSearchInput);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeSearchModal();
        }
      });
    }

    document.addEventListener('keydown', onDocKey);
  }

  global.searchCitizensByDisplayName = searchCitizensByDisplayName;
  global.searchDiscussionsByQuery = searchDiscussionsByQuery;
  global.openSearchModal = openSearchModal;
  global.closeSearchModal = closeSearchModal;
  global.renderCitizenSearchResults = renderCitizenSearchResults;
  global.renderDiscussionSearchResults = renderDiscussionSearchResults;
  global.renderSearchResults = renderSearchResults;
  global.__scSearchCitizens = searchCitizensByDisplayName;
  global.__scSearchDiscussions = searchDiscussionsByQuery;

  global.SearchSystem = {
    open: openSearchModal,
    close: closeSearchModal,
    searchCitizens: searchCitizensByDisplayName,
    searchDiscussions: searchDiscussionsByQuery,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUi);
  } else {
    initUi();
  }
})(typeof window !== 'undefined' ? window : this);
