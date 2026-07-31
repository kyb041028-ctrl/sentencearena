/**
 * 사용자 콘텐츠 시스템 개발용 검사
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/user-content-list-core'),
      require('./user-content-api-client')
    );
  } else {
    root.UserContentSystemInspect = factory(root.UserContentListCore, root.UserContentApiClient);
  }
})(typeof self !== 'undefined' ? self : this, function factory(core, apiClient) {
  'use strict';

  function inspectUserContentSystem(options) {
    var opts = options || {};
    var mode = (apiClient && apiClient.getMode && apiClient.getMode()) || 'LEGACY_LOCAL';
    var warnings = [];
    if (opts.countMismatch) warnings.push('PROFILE_COUNT_MISMATCH');
    return {
      profile: {
        currentProfileUserIdAvailable: !!opts.profileUserId,
        isSelf: !!opts.isSelf,
        visibility: opts.visibility || 'UNKNOWN',
      },
      achievements: {
        titleLineClamp: 2,
        equalTitleArea: true,
        acquiredDateScale: opts.acquiredDateScale || 1.2,
        overflowDetected: false,
      },
      activityLinks: {
        postsClickable: opts.postsClickable !== false,
        commentsClickable: opts.commentsClickable !== false,
        keyboardAccessible: opts.keyboardAccessible !== false,
      },
      contentModal: {
        open: !!opts.modalOpen,
        activeTab: opts.activeTab || 'POSTS',
        postsPage: opts.postsPage || 1,
        commentsPage: opts.commentsPage || 1,
        pageSize: core.DEFAULT_PAGE_SIZE,
      },
      data: {
        mode: mode,
        source: opts.source || 'LEGACY_LOCAL',
        postsTotal: opts.postsTotal || 0,
        commentsTotal: opts.commentsTotal || 0,
        countMismatch: !!opts.countMismatch,
      },
      navigation: {
        postNavigationAvailable: true,
        commentAnchorAvailable: !!opts.commentAnchorAvailable,
        alienObservationRoutingAvailable: true,
      },
      operational: {
        apiOperational: false,
        dbWriteEnabled: false,
      },
      warnings: warnings,
    };
  }

  var api = { inspectUserContentSystem: inspectUserContentSystem };

  if (typeof window !== 'undefined') {
    window.__scInspectUserContentSystem = function () {
      var modalState =
        typeof window.__scGetUserContentModalState === 'function'
          ? window.__scGetUserContentModalState()
          : {};
      return inspectUserContentSystem(modalState || {});
    };
  }

  return api;
});
