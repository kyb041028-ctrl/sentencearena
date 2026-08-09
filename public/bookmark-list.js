/**
 * 센텐스아레나 — Community System v2 (북마크 목록 1차)
 * sc_bookmarks_v1 · findPostByIdAnywhere · __scBoardNavigateToPost 재사용
 */
(function (global) {
  'use strict';

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

  function formatDate(isoOrMs) {
    try {
      var d = new Date(isoOrMs);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return '';
    }
  }

  function showToast(message) {
    if (typeof global.showScShareToast === 'function') {
      global.showScShareToast(message);
      return;
    }
  }

  function loadSortedBookmarks() {
    var list =
      typeof global.loadBookmarks === 'function' ? global.loadBookmarks() : [];
    if (!Array.isArray(list)) return [];
    return list
      .slice()
      .sort(function (a, b) {
        return (Number(b && b.createdAt) || 0) - (Number(a && a.createdAt) || 0);
      });
  }

  function resolveBookmarkEntries() {
    var bookmarks = loadSortedBookmarks();
    var find =
      typeof global.findPostByIdAnywhere === 'function'
        ? global.findPostByIdAnywhere
        : null;
    return bookmarks.map(function (item) {
      var postId = trim(item && item.postId);
      var savedAt = Number(item && item.createdAt) || 0;
      var found = find && postId ? find(postId) : null;
      return {
        postId: postId,
        savedAt: savedAt,
        found: found,
      };
    });
  }

  function wireOpenPost(titleEl, row) {
    if (!titleEl || !row || !row.found) return;
    var found = row.found;
    titleEl.setAttribute('role', 'button');
    titleEl.setAttribute('tabindex', '0');
    titleEl.setAttribute(
      'aria-label',
      trim(found.post && found.post.title) + ' — 게시글 열기',
    );
    function openPost(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      closeBookmarkModal();
      if (typeof global.__scBoardNavigateToPost === 'function') {
        global.__scBoardNavigateToPost(found.territoryId, found.stage, row.postId);
      }
    }
    titleEl.addEventListener('click', openPost);
    titleEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        openPost(ev);
      }
    });
  }

  function renderBookmarkList() {
    var listEl = el('sc-bookmark-modal-list');
    var emptyEl = el('sc-bookmark-modal-empty');
    if (!listEl) return;

    listEl.textContent = '';
    var entries = resolveBookmarkEntries();

    if (!entries.length) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '저장한 게시글이 없습니다.';
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    entries.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'board__item sc-bookmark-modal__item';
      li.setAttribute('role', 'listitem');

      var hdr = document.createElement('div');
      hdr.className = 'board__item-hdr';

      var found = row.found;
      var post = found && found.post ? found.post : null;
      var titleText = post
        ? trim(post.title) || '(제목 없음)'
        : '(글을 찾을 수 없음)';

      var title = document.createElement('h3');
      title.className = 'board__item-title board__item-title--link';
      if (!found) title.classList.add('sc-bookmark-modal__title--missing');
      title.textContent = titleText;
      if (found) wireOpenPost(title, row);

      var meta = document.createElement('div');
      meta.className = 'board__item-meta';

      var metaTxt = document.createElement('span');
      metaTxt.className = 'board__author-line__text';
      var parts = [];
      if (post) {
        var author = resolveDisplayName(post.authorId) || '익명';
        var postDate = formatDate(post.createdAt);
        if (author) parts.push(author);
        if (postDate) parts.push(postDate);
      }
      if (row.savedAt) {
        parts.push('저장 ' + formatDate(row.savedAt));
      }
      metaTxt.textContent = parts.join(' · ');

      meta.appendChild(metaTxt);

      if (found && found.territoryId) {
        var terrBadge = document.createElement('span');
        terrBadge.className = 'sc-badge sc-bookmark-modal__terr';
        terrBadge.dataset.territory = territoryIdToDataTerritory(found.territoryId);
        terrBadge.textContent = territoryShortLabel(found.territoryId);
        meta.appendChild(terrBadge);
      }

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'sc-bookmark-modal__remove sc-btn';
      removeBtn.textContent = '삭제';
      removeBtn.setAttribute('aria-label', titleText + ' 북마크 해제');
      removeBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof global.togglePostBookmark === 'function') {
          global.togglePostBookmark(row.postId);
        }
        showToast('북마크를 해제했습니다.');
        renderBookmarkList();
      });

      meta.appendChild(removeBtn);

      hdr.appendChild(title);
      hdr.appendChild(meta);
      li.appendChild(hdr);
      listEl.appendChild(li);
    });
  }

  function openBookmarkModal() {
    var modal = el('sc-bookmark-modal');
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    renderBookmarkList();
  }

  function closeBookmarkModal() {
    var modal = el('sc-bookmark-modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  function onDocKey(ev) {
    if (ev.key !== 'Escape') return;
    var modal = el('sc-bookmark-modal');
    if (modal && !modal.hidden) {
      ev.preventDefault();
      closeBookmarkModal();
    }
  }

  function initUi() {
    var btn = el('sc-map-tab-bookmarks');
    var modal = el('sc-bookmark-modal');
    if (!btn || !modal) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openBookmarkModal();
    });

    var backdrop = el('sc-bookmark-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeBookmarkModal);

    var closeBtn = el('sc-bookmark-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeBookmarkModal);

    document.addEventListener('keydown', onDocKey);
  }

  global.openBookmarkModal = openBookmarkModal;
  global.closeBookmarkModal = closeBookmarkModal;
  global.renderBookmarkList = renderBookmarkList;

  global.BookmarkList = {
    open: openBookmarkModal,
    close: closeBookmarkModal,
    refresh: renderBookmarkList,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUi);
  } else {
    initUi();
  }
})(typeof window !== 'undefined' ? window : this);
