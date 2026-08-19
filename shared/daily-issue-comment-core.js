/**
 * Daily Issue public comments — validation + public serializer
 * Length matches board commentMaxLength (1500). No territory/alignment fields.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueCommentCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueCommentCoreFactory() {
  'use strict';

  var COMMENT_MAX_LENGTH = 1500;
  var FALLBACK_DISPLAY_NAME = '활동명 없음';
  var WITHDRAWN_DISPLAY_NAME = '탈퇴한 사용자';
  if (typeof require === 'function') {
    try {
      WITHDRAWN_DISPLAY_NAME = require('./account-withdrawal-core').WITHDRAWN_DISPLAY_NAME;
    } catch (_) {}
  } else if (typeof AccountWithdrawalCore !== 'undefined' && AccountWithdrawalCore.WITHDRAWN_DISPLAY_NAME) {
    WITHDRAWN_DISPLAY_NAME = AccountWithdrawalCore.WITHDRAWN_DISPLAY_NAME;
  }

  function parseCommentBody(raw) {
    var body = raw == null ? '' : String(raw);
    var trimmed = body.trim();
    if (!trimmed) {
      return { ok: false, error: 'COMMENT_BODY_REQUIRED' };
    }
    if (body.length > COMMENT_MAX_LENGTH || trimmed.length > COMMENT_MAX_LENGTH) {
      return { ok: false, error: 'COMMENT_TOO_LONG', max: COMMENT_MAX_LENGTH };
    }
    return { ok: true, body: trimmed };
  }

  function toPublicComment(row, viewerUserId, displayName) {
    if (!row || row.deletedAt) return null;
    var authorId = row.userId || row.user_id || null;
    var viewer = viewerUserId ? String(viewerUserId) : '';
    var name = !authorId
      ? WITHDRAWN_DISPLAY_NAME
      : displayName == null || String(displayName).trim() === ''
        ? FALLBACK_DISPLAY_NAME
        : String(displayName);
    return {
      id: row.id,
      body: row.body,
      createdAt: row.createdAt || row.created_at || null,
      isMine: !!(viewer && authorId && String(authorId) === viewer),
      author: {
        userId: authorId ? String(authorId) : null,
        displayName: name,
      },
    };
  }

  function containsForbiddenPublicKeys(obj) {
    var raw = JSON.stringify(obj || {});
    return /"rawText"|"reviewerId"|"choices"|"stance"|"alignmentDirection"|"alignment_direction"|"email"|"app_metadata"|"user_metadata"/.test(
      raw,
    );
  }

  return {
    COMMENT_MAX_LENGTH: COMMENT_MAX_LENGTH,
    FALLBACK_DISPLAY_NAME: FALLBACK_DISPLAY_NAME,
    parseCommentBody: parseCommentBody,
    toPublicComment: toPublicComment,
    containsForbiddenPublicKeys: containsForbiddenPublicKeys,
  };
});
