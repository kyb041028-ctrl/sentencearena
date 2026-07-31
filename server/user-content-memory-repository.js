'use strict';
/**
 * 사용자 콘텐츠 memory repository — board 원본 참조 (복제 저장 없음)
 */

function createUserContentMemoryRepository(options) {
  var opts = options || {};
  var postsProvider =
    typeof opts.getPostsSnapshot === 'function'
      ? opts.getPostsSnapshot
      : function () {
          return Array.isArray(opts.posts) ? opts.posts : [];
        };

  function snapshot() {
    var list = postsProvider() || [];
    return Array.isArray(list) ? list : [];
  }

  function matchAuthor(item, userId) {
    var a = String((item && (item.authorUserId || item.authorId)) || '').trim();
    return !!userId && a === String(userId).trim();
  }

  function listPostsByAuthor(userId, paging, context) {
    var page = Math.max(1, Math.floor(Number(paging && paging.page) || 1));
    var pageSize = Math.max(1, Math.floor(Number(paging && paging.pageSize) || 10));
    var all = snapshot().filter(function (p) {
      return matchAuthor(p, userId);
    });
    all.sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    var start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize).map(function (p) {
        return Object.assign({}, p, {
          postId: p.id || p.postId,
          territory: p.territory || p.territoryId,
          boardStage: p.boardStage || p.stage || 1,
        });
      }),
      total: all.length,
      page: page,
      pageSize: pageSize,
      context: context || null,
    };
  }

  function countPostsByAuthor(userId) {
    return snapshot().filter(function (p) {
      return matchAuthor(p, userId);
    }).length;
  }

  function collectComments(userId) {
    var out = [];
    var posts = snapshot();
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i];
      var comments = Array.isArray(p.comments) ? p.comments : [];
      for (var j = 0; j < comments.length; j++) {
        var c = comments[j];
        if (!matchAuthor(c, userId)) continue;
        out.push(
          Object.assign({}, c, {
            commentId: c.id || c.commentId,
            postId: p.id || p.postId,
            postTitle: p.title || '(원문)',
            territory: p.territory || p.territoryId || c.territory,
            categoryKey: p.categoryKey || p.category || null,
            boardStage: p.boardStage || p.stage || 1,
            parentCommentId: c.parentCommentId || c.parentId || null,
            audienceScope: c.audienceScope || c.audience_scope || 'EARTH',
          })
        );
      }
    }
    out.sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    return out;
  }

  function listCommentsByAuthor(userId, paging, context) {
    var page = Math.max(1, Math.floor(Number(paging && paging.page) || 1));
    var pageSize = Math.max(1, Math.floor(Number(paging && paging.pageSize) || 10));
    var all = collectComments(userId);
    var start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      total: all.length,
      page: page,
      pageSize: pageSize,
      context: context || null,
    };
  }

  function countCommentsByAuthor(userId) {
    return collectComments(userId).length;
  }

  function getPostNavigationTarget(postId) {
    var id = String(postId || '').trim();
    var posts = snapshot();
    for (var i = 0; i < posts.length; i++) {
      if (String(posts[i].id || posts[i].postId) === id) {
        return {
          postId: id,
          territory: posts[i].territory || posts[i].territoryId || 'COMMON',
          boardStage: posts[i].boardStage || posts[i].stage || 1,
          categoryKey: posts[i].categoryKey || posts[i].category || null,
        };
      }
    }
    return null;
  }

  function getCommentNavigationTarget(commentId) {
    var id = String(commentId || '').trim();
    var posts = snapshot();
    for (var i = 0; i < posts.length; i++) {
      var comments = Array.isArray(posts[i].comments) ? posts[i].comments : [];
      for (var j = 0; j < comments.length; j++) {
        if (String(comments[j].id || comments[j].commentId) === id) {
          return {
            postId: posts[i].id || posts[i].postId,
            commentId: id,
            parentCommentId: comments[j].parentCommentId || comments[j].parentId || null,
            territory: posts[i].territory || posts[i].territoryId || 'COMMON',
            boardStage: posts[i].boardStage || posts[i].stage || 1,
            audienceScope: comments[j].audienceScope || comments[j].audience_scope || 'EARTH',
            commentAnchorSupported: false,
          };
        }
      }
    }
    return null;
  }

  function healthCheck() {
    return { ok: true, mode: 'MEMORY', writeEnabled: false };
  }

  return {
    listPostsByAuthor: listPostsByAuthor,
    countPostsByAuthor: countPostsByAuthor,
    listCommentsByAuthor: listCommentsByAuthor,
    countCommentsByAuthor: countCommentsByAuthor,
    getPostNavigationTarget: getPostNavigationTarget,
    getCommentNavigationTarget: getCommentNavigationTarget,
    healthCheck: healthCheck,
  };
}

module.exports = {
  createUserContentMemoryRepository: createUserContentMemoryRepository,
};
