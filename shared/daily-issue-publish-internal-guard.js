'use strict';

/**
 * 운영/HTTP 경로에서 skipHaltCheck·forceAutoPublish 등 클라이언트 우회 옵션 차단.
 * 의도된 서버 내부 force는 __internalForceApproved 로만 허용.
 */

var FORBIDDEN_HTTP_BODY_KEYS = Object.freeze([
  'skipHaltCheck',
  'forceAutoPublish',
  '__testDailyIssueOverride',
  'publishedTodayOverride',
  '__trustedInternalPublishOptions',
  '__internalForceApproved',
]);

function isTrustedInternalContext(opt) {
  var o = opt || {};
  if (o.__trustedInternalPublishOptions !== true) return false;
  if (String(process.env.NODE_ENV || '') === 'test') return true;
  return String(process.env.DAILY_ISSUE_TRUST_INTERNAL_PUBLISH_OPTIONS || '').trim() === '1';
}

function findForbiddenHttpBodyKey(body) {
  var b = body && typeof body === 'object' ? body : {};
  for (var i = 0; i < FORBIDDEN_HTTP_BODY_KEYS.length; i += 1) {
    var k = FORBIDDEN_HTTP_BODY_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(b, k) && b[k] != null) {
      return k;
    }
  }
  return null;
}

function validateTransitionOptions(opt) {
  var o = opt || {};
  if (o.skipHaltCheck === true && !isTrustedInternalContext(o)) {
    return { ok: false, error: 'UNAUTHORIZED_PUBLISH_OPTION', field: 'skipHaltCheck' };
  }
  if (o.forceAutoPublish === true && o.__internalForceApproved !== true && !isTrustedInternalContext(o)) {
    return { ok: false, error: 'UNAUTHORIZED_PUBLISH_OPTION', field: 'forceAutoPublish' };
  }
  if (o.__testDailyIssueOverride === true && !isTrustedInternalContext(o)) {
    return { ok: false, error: 'UNAUTHORIZED_PUBLISH_OPTION', field: '__testDailyIssueOverride' };
  }
  if (o.publishedTodayOverride != null && !isTrustedInternalContext(o)) {
    return { ok: false, error: 'UNAUTHORIZED_PUBLISH_OPTION', field: 'publishedTodayOverride' };
  }
  return { ok: true };
}

function markInternalForceApproved(opt) {
  return Object.assign({}, opt || {}, { __internalForceApproved: true });
}

module.exports = {
  FORBIDDEN_HTTP_BODY_KEYS: FORBIDDEN_HTTP_BODY_KEYS,
  findForbiddenHttpBodyKey: findForbiddenHttpBodyKey,
  validateTransitionOptions: validateTransitionOptions,
  isTrustedInternalContext: isTrustedInternalContext,
  markInternalForceApproved: markInternalForceApproved,
};
