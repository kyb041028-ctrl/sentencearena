/**
 * SentenceArena account withdrawal — policy constants + request validation.
 * No PII. No legal retention periods.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AccountWithdrawalCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function accountWithdrawalCoreFactory() {
  'use strict';

  var POLICY_VERSION = 'withdrawal-v1';
  var WITHDRAWN_DISPLAY_NAME = '탈퇴한 사용자';
  var FORBIDDEN_AUDIT_KEY_RE =
    /"(user_id|userId|email|display_name|displayName|provider|oauth|google_id|kakao_id|naver_id|access_token|refresh_token|user_metadata|app_metadata|ipAddress|ip_address|user_agent|alignmentScore|political_score)"\s*:/i;

  function parseWithdrawBody(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    if (src.userId != null || src.user_id != null || src.targetUserId != null) {
      return { ok: false, error: 'WITHDRAW_USER_ID_NOT_ALLOWED', status: 400 };
    }
    if (src.acknowledged !== true) {
      return { ok: false, error: 'WITHDRAW_ACK_REQUIRED', status: 400 };
    }
    var version = src.policyVersion != null ? String(src.policyVersion).trim() : '';
    if (!version) {
      return { ok: false, error: 'WITHDRAW_POLICY_VERSION_REQUIRED', status: 400 };
    }
    if (version !== POLICY_VERSION) {
      return { ok: false, error: 'WITHDRAW_POLICY_VERSION_MISMATCH', status: 409 };
    }
    return { ok: true, acknowledged: true, policyVersion: POLICY_VERSION };
  }

  function withdrawnAuthor(territory) {
    return {
      displayName: WITHDRAWN_DISPLAY_NAME,
      userId: null,
      territory: territory || null,
    };
  }

  function resolvePublicAuthorDisplay(opts) {
    var o = opts || {};
    if (o.blinded) return '????';
    var userId = String(o.userId || '').trim();
    var name = o.displayName == null ? '' : String(o.displayName).trim();
    if (!userId) return name || WITHDRAWN_DISPLAY_NAME;
    if (o.isAnonymous) return '익명';
    return name || userId;
  }

  function containsForbiddenAuditKeys(obj) {
    return FORBIDDEN_AUDIT_KEY_RE.test(JSON.stringify(obj || {}));
  }

  return {
    POLICY_VERSION: POLICY_VERSION,
    WITHDRAWN_DISPLAY_NAME: WITHDRAWN_DISPLAY_NAME,
    parseWithdrawBody: parseWithdrawBody,
    withdrawnAuthor: withdrawnAuthor,
    resolvePublicAuthorDisplay: resolvePublicAuthorDisplay,
    containsForbiddenAuditKeys: containsForbiddenAuditKeys,
  };
});
