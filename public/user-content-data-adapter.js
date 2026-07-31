/**
 * 사용자 콘텐츠 client adapter — localStorage board bundle → view-model
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../shared/user-content-list-core'));
  } else {
    root.UserContentDataAdapter = factory(root.UserContentListCore);
  }
})(typeof self !== 'undefined' ? self : this, function factory(core) {
  'use strict';

  var BOARD_BUNDLE_KEY = 'sc_board_bundle_v1';

  function readBoardBundlePosts(storage) {
    var store = storage;
    if (!store && typeof localStorage !== 'undefined') store = localStorage;
    if (!store || typeof store.getItem !== 'function') return [];
    try {
      var raw = store.getItem(BOARD_BUNDLE_KEY);
      if (!raw) return [];
      var o = JSON.parse(raw);
      var postsMap = o && o.posts && typeof o.posts === 'object' ? o.posts : o;
      if (!postsMap || typeof postsMap !== 'object') return [];
      var out = [];
      Object.keys(postsMap).forEach(function (key) {
        var arr = postsMap[key];
        if (!Array.isArray(arr)) return;
        var parts = String(key).split('_s');
        var tid = parts[0] || 'COMMON';
        var stage = Math.max(1, Math.floor(Number(parts[1]) || 1));
        for (var i = 0; i < arr.length; i++) {
          var p = arr[i];
          if (!p || typeof p !== 'object') continue;
          out.push(
            Object.assign({}, p, {
              territory: p.territory || p.territoryId || tid,
              territoryId: p.territoryId || tid,
              boardStage: p.boardStage || p.stage || stage,
              stage: p.stage || stage,
            })
          );
        }
      });
      return out;
    } catch (_) {
      return [];
    }
  }

  function listFromPostsSnapshot(posts, query) {
    var q = query || {};
    var contentType = core.normalizeUserContentType(q.contentType) || core.CONTENT_TYPE.POSTS;
    var profileUserId = String(q.profileUserId || '').trim();
    var raw = [];
    var list = Array.isArray(posts) ? posts : [];

    if (contentType === core.CONTENT_TYPE.POSTS) {
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (String(p.authorId || p.authorUserId || '').trim() !== profileUserId) continue;
        raw.push(p);
      }
      raw.sort(function (a, b) {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
    } else {
      for (var pi = 0; pi < list.length; pi++) {
        var post = list[pi];
        var comments = Array.isArray(post.comments) ? post.comments : [];
        for (var ci = 0; ci < comments.length; ci++) {
          var c = comments[ci];
          if (String(c.authorId || c.authorUserId || '').trim() !== profileUserId) continue;
          raw.push(
            Object.assign({}, c, {
              postId: post.id,
              postTitle: post.title || '(원문)',
              territory: post.territory || post.territoryId,
              categoryKey: post.categoryKey || post.category || null,
              boardStage: post.boardStage || post.stage || 1,
            })
          );
        }
      }
      raw.sort(function (a, b) {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
    }

    return core.buildUserContentListViewModel({
      profileUserId: profileUserId,
      contentType: contentType,
      page: q.page || 1,
      pageSize: q.pageSize || core.DEFAULT_PAGE_SIZE,
      items: raw,
      isSelf: !!q.isSelf,
      viewerCanSeeAlien: !!q.viewerCanSeeAlien,
      dataStatus: core.DATA_STATUS.LEGACY_MOCK,
      source: 'LEGACY_LOCAL',
      profileCount: q.profileCount,
      useFilteredTotal: true,
    });
  }

  function listUserContentLocal(query, storage) {
    return listFromPostsSnapshot(readBoardBundlePosts(storage), query);
  }

  function formatTerritoryLabel(tid) {
    var t = String(tid || '').toUpperCase();
    if (t === 'COMMON' || t === 'CENTRAL') return '중앙광장';
    if (t === 'PROGRESSIVE') return '개척';
    if (t === 'CONSERVATIVE') return '수호';
    if (t === 'KANTAPBIYA' || t === 'ALIEN') return '외계';
    return t || '게시판';
  }

  function formatListDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return '';
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
  }

  return {
    BOARD_BUNDLE_KEY: BOARD_BUNDLE_KEY,
    readBoardBundlePosts: readBoardBundlePosts,
    listFromPostsSnapshot: listFromPostsSnapshot,
    listUserContentLocal: listUserContentLocal,
    formatTerritoryLabel: formatTerritoryLabel,
    formatListDate: formatListDate,
    CONTENT_TYPE: core.CONTENT_TYPE,
    DATA_STATUS: core.DATA_STATUS,
    DEFAULT_PAGE_SIZE: core.DEFAULT_PAGE_SIZE,
    buildNavigationTarget: core.buildNavigationTarget,
    buildCacheKey: core.buildCacheKey,
    planContentCacheInvalidation: core.planContentCacheInvalidation,
  };
});
