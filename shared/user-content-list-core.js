/**
 * 사용자 작성글·댓글 활동 목록 공용 contract
 * (게시글/댓글 원문 복제 금지 · board source 기준)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UserContentListCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function factory() {
  'use strict';

  var CONTENT_TYPE = { POSTS: 'POSTS', COMMENTS: 'COMMENTS' };
  var DATA_STATUS = {
    AVAILABLE: 'AVAILABLE',
    EMPTY: 'EMPTY',
    PRIVATE: 'PRIVATE',
    FORBIDDEN: 'FORBIDDEN',
    UNAVAILABLE: 'UNAVAILABLE',
    LEGACY_MOCK: 'LEGACY_MOCK',
  };
  var DEFAULT_PAGE_SIZE = 10;
  var ACCESS = {
    VISIBLE: 'VISIBLE',
    HIDDEN: 'HIDDEN',
    FORBIDDEN: 'FORBIDDEN',
    DELETED: 'DELETED',
    BLINDED: 'BLINDED',
    ANONYMOUS_HIDDEN: 'ANONYMOUS_HIDDEN',
    ALIEN_SCOPE_HIDDEN: 'ALIEN_SCOPE_HIDDEN',
  };

  function freezeInput(obj) {
    return obj;
  }

  function normalizeUserContentType(value) {
    var v = String(value || '').toUpperCase();
    if (v === 'POST' || v === 'POSTS' || v === 'WRITES') return CONTENT_TYPE.POSTS;
    if (v === 'COMMENT' || v === 'COMMENTS' || v === 'REPLIES') return CONTENT_TYPE.COMMENTS;
    return null;
  }

  function normalizeUserContentPage(page, totalPages) {
    var tot = Math.max(0, Math.floor(Number(totalPages) || 0));
    var p = Math.floor(Number(page) || 1);
    if (!isFinite(p) || p < 1) p = 1;
    if (tot <= 0) return 1;
    return Math.min(p, tot);
  }

  function getPageCount(totalItems, pageSize) {
    var size = Math.max(1, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE));
    var total = Math.max(0, Math.floor(Number(totalItems) || 0));
    if (total === 0) return 0;
    return Math.max(1, Math.ceil(total / size) || 1);
  }

  function plainTextPreview(raw, maxLen) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/<[^>]*>/g, ' ');
    s = s.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
    s = s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    var limit = Math.max(24, Math.floor(Number(maxLen) || 120));
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1) + '…';
  }

  function statusOf(item) {
    var st = String((item && (item.status || item.state)) || 'ACTIVE').toUpperCase();
    if (item && (item.deleted === true || item.isDeleted === true)) st = 'DELETED';
    if (item && (item.blinded === true || item.isBlinded === true)) st = 'BLINDED';
    return st;
  }

  function isAnonymousItem(item) {
    return !!(item && (item.isAnonymous === true || item.anonymous === true));
  }

  function audienceScopeOf(item) {
    var s = String((item && (item.audienceScope || item.audience_scope)) || 'EARTH').toUpperCase();
    return s === 'ALIEN' ? 'ALIEN' : 'EARTH';
  }

  function canViewerSeeUserContentItem(item, context) {
    var ctx = context || {};
    var isSelf = !!ctx.isSelf;
    var viewerCanSeeAlien = !!ctx.viewerCanSeeAlien;
    var contentType = normalizeUserContentType(ctx.contentType) || CONTENT_TYPE.POSTS;
    if (!item || typeof item !== 'object') {
      return { allowed: false, reason: ACCESS.HIDDEN };
    }
    var st = statusOf(item);
    if (st === 'DELETED' || st === 'HIDDEN_BY_OPERATOR') {
      return { allowed: false, reason: ACCESS.DELETED };
    }
    if (st === 'BLINDED' && !isSelf) {
      return { allowed: false, reason: ACCESS.BLINDED };
    }
    if (st === 'PRIVATE' || item.isPrivate === true) {
      return { allowed: isSelf, reason: isSelf ? ACCESS.VISIBLE : ACCESS.HIDDEN };
    }
    if (isAnonymousItem(item) && !isSelf) {
      return { allowed: false, reason: ACCESS.ANONYMOUS_HIDDEN };
    }
    if (contentType === CONTENT_TYPE.COMMENTS && audienceScopeOf(item) === 'ALIEN' && !viewerCanSeeAlien) {
      return { allowed: false, reason: ACCESS.ALIEN_SCOPE_HIDDEN };
    }
    if (contentType === CONTENT_TYPE.POSTS) {
      var territory = String(item.territory || item.territoryId || '').toUpperCase();
      var cat = String(item.categoryKey || item.category || '').toUpperCase();
      var isAlienBoard =
        territory === 'ALIEN' ||
        territory === 'KANTAPBIYA' ||
        cat.indexOf('ALIEN_') === 0;
      if (isAlienBoard && !viewerCanSeeAlien && !isSelf) {
        return { allowed: false, reason: ACCESS.ALIEN_SCOPE_HIDDEN };
      }
    }
    return { allowed: true, reason: ACCESS.VISIBLE };
  }

  function sanitizeUserPostActivityItem(raw, context) {
    freezeInput(raw);
    var item = raw && typeof raw === 'object' ? raw : {};
    var gate = canViewerSeeUserContentItem(item, Object.assign({}, context, { contentType: CONTENT_TYPE.POSTS }));
    if (!gate.allowed) return null;
    var st = statusOf(item);
    var blinded = st === 'BLINDED';
    var title = blinded && !(context && context.isSelf)
      ? '블라인드된 게시글'
      : String(item.title || '(제목 없음)');
    var body = blinded && !(context && context.isSelf) ? '' : String(item.body || item.content || '');
    return {
      postId: String(item.postId || item.id || ''),
      title: title,
      excerpt: plainTextPreview(body, 140),
      territory: String(item.territory || item.territoryId || item.boardTid || 'COMMON'),
      categoryKey: item.categoryKey || item.category || null,
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      commentCount: Math.max(0, Math.floor(Number(item.commentCount != null ? item.commentCount : (item.comments && item.comments.length) || 0))),
      empathyCount: Math.max(0, Math.floor(Number(item.empathyCount != null ? item.empathyCount : ((item.reactions && item.reactions.empathy && item.reactions.empathy.length) || 0)))),
      reactionSummary: item.reactionSummary || null,
      status: st,
      isAnonymous: isAnonymousItem(item),
      accessState: gate.reason,
      boardStage: item.boardStage || item.stage || 1,
    };
  }

  function sanitizeUserCommentActivityItem(raw, context) {
    freezeInput(raw);
    var item = raw && typeof raw === 'object' ? raw : {};
    var gate = canViewerSeeUserContentItem(item, Object.assign({}, context, { contentType: CONTENT_TYPE.COMMENTS }));
    if (!gate.allowed) return null;
    var st = statusOf(item);
    var blinded = st === 'BLINDED';
    var text = blinded && !(context && context.isSelf)
      ? ''
      : String(item.content || item.text || item.body || '');
    return {
      commentId: String(item.commentId || item.id || ''),
      postId: String(item.postId || ''),
      parentCommentId: item.parentCommentId || item.parentId || null,
      contentPreview: plainTextPreview(text, 140),
      postTitle: String(item.postTitle || '(원문)'),
      territory: String(item.territory || item.territoryId || item.boardTid || 'COMMON'),
      categoryKey: item.categoryKey || item.category || null,
      createdAt: item.createdAt || null,
      empathyCount: Math.max(0, Math.floor(Number(item.empathyCount != null ? item.empathyCount : ((item.reactions && item.reactions.empathy && item.reactions.empathy.length) || 0)))),
      status: st,
      isAnonymous: isAnonymousItem(item),
      audienceScope: audienceScopeOf(item),
      accessState: gate.reason,
      boardStage: item.boardStage || item.stage || 1,
    };
  }

  function buildUserContentListViewModel(options) {
    var opts = options || {};
    var contentType = normalizeUserContentType(opts.contentType) || CONTENT_TYPE.POSTS;
    var pageSize = Math.max(1, Math.floor(Number(opts.pageSize) || DEFAULT_PAGE_SIZE));
    var profileUserId = opts.profileUserId || null;
    var source = opts.source || 'LEGACY_LOCAL';
    var dataStatus = opts.dataStatus || DATA_STATUS.AVAILABLE;
    var warnings = Array.isArray(opts.warnings) ? opts.warnings.slice() : [];
    var ctx = {
      isSelf: !!opts.isSelf,
      viewerCanSeeAlien: !!opts.viewerCanSeeAlien,
      contentType: contentType,
    };
    var rawItems = Array.isArray(opts.items) ? opts.items : [];
    var sanitized = [];
    for (var i = 0; i < rawItems.length; i++) {
      var row =
        contentType === CONTENT_TYPE.COMMENTS
          ? sanitizeUserCommentActivityItem(rawItems[i], ctx)
          : sanitizeUserPostActivityItem(rawItems[i], ctx);
      if (row) sanitized.push(row);
    }
    var totalItems =
      opts.totalItems != null ? Math.max(0, Math.floor(Number(opts.totalItems) || 0)) : sanitized.length;
    if (opts.useFilteredTotal) totalItems = sanitized.length;
    var totalPages = getPageCount(totalItems, pageSize);
    var page = normalizeUserContentPage(opts.page || 1, totalPages || 1);
    var start = (page - 1) * pageSize;
    var pageItems =
      opts.alreadyPaged === true ? sanitized : sanitized.slice(start, start + pageSize);

    if (dataStatus === DATA_STATUS.AVAILABLE && totalItems === 0) {
      dataStatus = DATA_STATUS.EMPTY;
    }
    if (opts.profileCount != null && Number(opts.profileCount) !== totalItems) {
      warnings.push('PROFILE_COUNT_MISMATCH');
    }

    return {
      profileUserId: profileUserId,
      contentType: contentType,
      page: page,
      pageSize: pageSize,
      totalItems: totalItems,
      totalPages: totalPages,
      items: pageItems,
      dataStatus: dataStatus,
      source: source,
      warnings: warnings,
    };
  }

  function buildNavigationTarget(kind, item) {
    if (!item) return null;
    if (kind === 'COMMENT' || kind === CONTENT_TYPE.COMMENTS) {
      return {
        postId: item.postId,
        commentId: item.commentId,
        parentCommentId: item.parentCommentId || null,
        territory: item.territory,
        categoryKey: item.categoryKey || null,
        audienceScope: item.audienceScope || 'EARTH',
        boardStage: item.boardStage || 1,
        source: 'USER_CONTENT_LIST',
        commentAnchorSupported: false,
      };
    }
    return {
      postId: item.postId,
      territory: item.territory,
      categoryKey: item.categoryKey || null,
      boardStage: item.boardStage || 1,
      source: 'USER_CONTENT_LIST',
    };
  }

  function buildCacheKey(parts) {
    return [
      'user-content',
      parts.profileUserId || 'unknown',
      parts.viewerUserId || 'anon',
      parts.contentType || 'POSTS',
      parts.page || 1,
    ].join(':');
  }

  function planContentCacheInvalidation(eventType) {
    var t = String(eventType || '').toUpperCase();
    var targets = [];
    if (
      t === 'POST_CREATED' ||
      t === 'POST_DELETED' ||
      t === 'COMMENT_CREATED' ||
      t === 'COMMENT_DELETED' ||
      t === 'PRIVACY_CHANGED' ||
      t === 'MODERATION_STATUS_CHANGED'
    ) {
      targets.push('user-content:list');
    }
    return { targets: targets, execute: false, note: 'INVALIDATE_NOT_EXECUTED' };
  }

  return {
    CONTENT_TYPE: CONTENT_TYPE,
    DATA_STATUS: DATA_STATUS,
    ACCESS: ACCESS,
    DEFAULT_PAGE_SIZE: DEFAULT_PAGE_SIZE,
    normalizeUserContentType: normalizeUserContentType,
    normalizeUserContentPage: normalizeUserContentPage,
    getPageCount: getPageCount,
    plainTextPreview: plainTextPreview,
    canViewerSeeUserContentItem: canViewerSeeUserContentItem,
    sanitizeUserPostActivityItem: sanitizeUserPostActivityItem,
    sanitizeUserCommentActivityItem: sanitizeUserCommentActivityItem,
    buildUserContentListViewModel: buildUserContentListViewModel,
    buildNavigationTarget: buildNavigationTarget,
    buildCacheKey: buildCacheKey,
    planContentCacheInvalidation: planContentCacheInvalidation,
  };
});
