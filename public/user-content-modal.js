/**
 * 센텐스아레나 — 사용자 작성글·댓글 활동 목록 모달 (ScUserContentModal)
 */
(function (global) {
  'use strict';

  var state = {
    open: false,
    profileUserId: null,
    displayName: '',
    isSelf: false,
    activeTab: 'POSTS',
    postsPage: 1,
    commentsPage: 1,
    postsTotal: 0,
    commentsTotal: 0,
    profileCountPosts: null,
    profileCountComments: null,
    viewerCanSeeAlien: false,
    lastWarnings: [],
  };

  function el(id) {
    return document.getElementById(id);
  }

  function core() {
    return global.UserContentListCore || null;
  }

  function adapter() {
    return global.UserContentDataAdapter || null;
  }

  function client() {
    return global.UserContentApiClient || null;
  }

  function meId() {
    return String((global.__scPlayer && global.__scPlayer.userId) || '').trim();
  }

  function resolveName(userId) {
    if (typeof global.resolveDisplayName === 'function') {
      return global.resolveDisplayName(userId) || String(userId || '');
    }
    return String(userId || '');
  }

  function formatDate(iso) {
    if (adapter() && typeof adapter().formatListDate === 'function') {
      return adapter().formatListDate(iso);
    }
    return '';
  }

  function territoryLabel(tid) {
    if (adapter() && typeof adapter().formatTerritoryLabel === 'function') {
      return adapter().formatTerritoryLabel(tid);
    }
    return String(tid || '');
  }

  function setTabUi() {
    var postsTab = el('sc-user-content-tab-posts');
    var commentsTab = el('sc-user-content-tab-comments');
    if (postsTab) {
      postsTab.classList.toggle('is-active', state.activeTab === 'POSTS');
      postsTab.setAttribute('aria-selected', state.activeTab === 'POSTS' ? 'true' : 'false');
      postsTab.textContent = '작성 글' + (state.postsTotal != null ? ' ' + state.postsTotal : '');
    }
    if (commentsTab) {
      commentsTab.classList.toggle('is-active', state.activeTab === 'COMMENTS');
      commentsTab.setAttribute('aria-selected', state.activeTab === 'COMMENTS' ? 'true' : 'false');
      commentsTab.textContent = '댓글' + (state.commentsTotal != null ? ' ' + state.commentsTotal : '');
    }
  }

  function renderPagination(slice) {
    var nav = el('sc-user-content-pagination');
    if (!nav) return;
    nav.textContent = '';
    if (!slice || !slice.totalPages || slice.totalPages <= 1) {
      nav.hidden = true;
      return;
    }
    nav.hidden = false;
    var scope = state.activeTab === 'POSTS' ? 'user-content-posts' : 'user-content-comments';

    function go(page) {
      if (state.activeTab === 'POSTS') state.postsPage = page;
      else state.commentsPage = page;
      refreshList();
    }

    if (typeof global.renderBoardPagination === 'function' && typeof global.paginatePostList === 'function') {
      // 공용 렌더러가 sessionStorage를 쓰므로 직접 버튼 구성
    }

    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'board-pagination__btn';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', '이전 페이지');
    prev.disabled = slice.page <= 1;
    prev.addEventListener('click', function () {
      go(Math.max(1, slice.page - 1));
    });
    nav.appendChild(prev);

    var start = Math.max(1, slice.page - 3);
    var end = Math.min(slice.totalPages, start + 6);
    start = Math.max(1, end - 6);
    for (var n = start; n <= end; n++) {
      (function (pageNum) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'board-pagination__btn' + (pageNum === slice.page ? ' is-active' : '');
        b.textContent = String(pageNum);
        if (pageNum === slice.page) b.setAttribute('aria-current', 'page');
        b.addEventListener('click', function () {
          go(pageNum);
        });
        nav.appendChild(b);
      })(n);
    }

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'board-pagination__btn';
    next.textContent = '›';
    next.setAttribute('aria-label', '다음 페이지');
    next.disabled = slice.page >= slice.totalPages;
    next.addEventListener('click', function () {
      go(Math.min(slice.totalPages, slice.page + 1));
    });
    nav.appendChild(next);
    void scope;
  }

  function emptyMessage(status) {
    if (status === 'PRIVATE') return '공개된 활동이 없습니다.';
    if (status === 'FORBIDDEN') return '이 활동을 볼 수 없습니다.';
    if (status === 'UNAVAILABLE') return '활동 목록을 불러올 수 없습니다.';
    if (state.activeTab === 'COMMENTS') return '작성한 댓글이 없습니다.';
    return '작성한 글이 없습니다.';
  }

  function onItemActivate(item) {
    if (!item) return;
    if (state.activeTab === 'POSTS') {
      if (typeof global.openUserPostActivityItem === 'function') {
        global.openUserPostActivityItem(item);
      }
    } else if (typeof global.openUserCommentActivityItem === 'function') {
      global.openUserCommentActivityItem(item);
    }
  }

  function renderItems(vm) {
    var list = el('sc-user-content-list');
    var empty = el('sc-user-content-empty');
    if (!list) return;
    list.textContent = '';
    var items = (vm && vm.items) || [];
    if (!items.length) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = emptyMessage(vm && vm.dataStatus);
      }
      renderPagination(null);
      return;
    }
    if (empty) empty.hidden = true;

    items.forEach(function (item) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-user-content-modal__item';
      var title = document.createElement('span');
      title.className = 'sc-user-content-modal__item-title';
      var meta = document.createElement('span');
      meta.className = 'sc-user-content-modal__item-meta';

      if (state.activeTab === 'POSTS') {
        title.textContent = item.title || '(제목 없음)';
        meta.textContent =
          territoryLabel(item.territory) +
          ' · ' +
          formatDate(item.createdAt) +
          ' · 댓글 ' +
          item.commentCount +
          ' · 공감 ' +
          item.empathyCount;
        if (item.status && item.status !== 'ACTIVE') {
          meta.textContent += ' · ' + item.status;
        }
      } else {
        title.textContent = item.contentPreview ? '“' + item.contentPreview + '”' : '(내용 없음)';
        meta.textContent =
          '「' +
          (item.postTitle || '원문') +
          '」 · ' +
          territoryLabel(item.territory) +
          ' · ' +
          formatDate(item.createdAt) +
          ' · 공감 ' +
          item.empathyCount;
      }

      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener('click', function () {
        onItemActivate(item);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });

    renderPagination(vm);
  }

  function refreshList() {
    var ad = adapter();
    var c = core();
    if (!ad || !c) return;
    var contentType = state.activeTab;
    var page = contentType === 'POSTS' ? state.postsPage : state.commentsPage;
    var profileCount =
      contentType === 'POSTS' ? state.profileCountPosts : state.profileCountComments;
    var req = {
      profileUserId: state.profileUserId,
      viewerUserId: meId(),
      contentType: contentType,
      page: page,
      pageSize: c.DEFAULT_PAGE_SIZE,
      isSelf: state.isSelf,
      viewerCanSeeAlien: state.viewerCanSeeAlien,
      profileCount: profileCount,
    };

    function apply(vm) {
      if (contentType === 'POSTS') {
        state.postsTotal = vm.totalItems || 0;
        state.postsPage = vm.page || 1;
      } else {
        state.commentsTotal = vm.totalItems || 0;
        state.commentsPage = vm.page || 1;
      }
      state.lastWarnings = vm.warnings || [];
      setTabUi();
      renderItems(vm);
    }

    if (client() && typeof client().listUserContent === 'function') {
      client()
        .listUserContent(req)
        .then(apply)
        .catch(function () {
          apply(ad.listUserContentLocal(req));
        });
    } else {
      apply(ad.listUserContentLocal(req));
    }
  }

  function bindOnce() {
    var modal = el('sc-user-content-modal');
    if (!modal || modal.dataset.scBound === '1') return;
    modal.dataset.scBound = '1';
    var closeBtn = el('sc-user-content-close');
    var backdrop = el('sc-user-content-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    var postsTab = el('sc-user-content-tab-posts');
    var commentsTab = el('sc-user-content-tab-comments');
    if (postsTab) {
      postsTab.addEventListener('click', function () {
        if (state.activeTab === 'POSTS') return;
        state.activeTab = 'POSTS';
        state.postsPage = 1;
        refreshList();
      });
    }
    if (commentsTab) {
      commentsTab.addEventListener('click', function () {
        if (state.activeTab === 'COMMENTS') return;
        state.activeTab = 'COMMENTS';
        state.commentsPage = 1;
        refreshList();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) close();
    });
  }

  function open(options) {
    bindOnce();
    var opts = options || {};
    var profileUserId = String(opts.profileUserId || '').trim();
    if (!profileUserId) return;
    if (state.profileUserId && state.profileUserId !== profileUserId) {
      state.postsPage = 1;
      state.commentsPage = 1;
    }
    state.profileUserId = profileUserId;
    state.displayName = opts.displayName || resolveName(profileUserId);
    state.isSelf = opts.isSelf != null ? !!opts.isSelf : meId() === profileUserId;
    state.activeTab = opts.contentType === 'COMMENTS' ? 'COMMENTS' : 'POSTS';
    state.viewerCanSeeAlien = !!opts.viewerCanSeeAlien;
    state.profileCountPosts = opts.profileCountPosts != null ? opts.profileCountPosts : null;
    state.profileCountComments = opts.profileCountComments != null ? opts.profileCountComments : null;
    if (state.activeTab === 'POSTS') state.postsPage = 1;
    else state.commentsPage = 1;

    var modal = el('sc-user-content-modal');
    var title = el('sc-user-content-title');
    if (title) {
      title.textContent = state.isSelf ? '내 활동' : state.displayName + '님의 활동';
    }
    if (!modal) return;
    state.open = true;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sc-user-content-modal-open');
    refreshList();
  }

  function close() {
    var modal = el('sc-user-content-modal');
    if (!modal) return;
    state.open = false;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sc-user-content-modal-open');
  }

  function getState() {
    return {
      profileUserId: state.profileUserId,
      isSelf: state.isSelf,
      visibility: 'PUBLIC',
      postsClickable: true,
      commentsClickable: true,
      keyboardAccessible: true,
      modalOpen: state.open,
      activeTab: state.activeTab,
      postsPage: state.postsPage,
      commentsPage: state.commentsPage,
      postsTotal: state.postsTotal,
      commentsTotal: state.commentsTotal,
      countMismatch: (state.lastWarnings || []).indexOf('PROFILE_COUNT_MISMATCH') >= 0,
      source: 'LEGACY_LOCAL',
      commentAnchorAvailable: false,
      acquiredDateScale: 1.2,
    };
  }

  global.ScUserContentModal = {
    open: open,
    close: close,
    isOpen: function () {
      return !!state.open;
    },
    getState: getState,
  };
  global.__scGetUserContentModalState = getState;
})(typeof window !== 'undefined' ? window : this);
