/**
 * 데일리 이슈 — 검수·게시 생명주기 상태 전환 (순수)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueLifecycleCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueLifecycleCoreFactory() {
  'use strict';

  var REVIEW_STATUS = Object.freeze({
    READY_FOR_REVIEW: 'READY_FOR_REVIEW',
    HELD: 'HELD',
    APPROVED: 'APPROVED',
    PUBLISHED: 'PUBLISHED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED',
    RETIRED: 'RETIRED',
    SUPERSEDED: 'SUPERSEDED',
    UPDATE_PENDING: 'UPDATE_PENDING',
  });

  var HOLD_REASONS = Object.freeze({
    NEED_MORE_INDEPENDENT_SOURCE: 'NEED_MORE_INDEPENDENT_SOURCE',
    EVENT_MATCH_UNCERTAIN: 'EVENT_MATCH_UNCERTAIN',
    EVIDENCE_REVIEW_REQUIRED: 'EVIDENCE_REVIEW_REQUIRED',
    TITLE_REVIEW_REQUIRED: 'TITLE_REVIEW_REQUIRED',
    SOURCE_DISAGREEMENT_REVIEW: 'SOURCE_DISAGREEMENT_REVIEW',
    DUPLICATE_REVIEW_REQUIRED: 'DUPLICATE_REVIEW_REQUIRED',
    UPDATE_OR_NEW_ISSUE_UNCERTAIN: 'UPDATE_OR_NEW_ISSUE_UNCERTAIN',
    OTHER: 'OTHER',
  });

  var REJECT_REASONS = Object.freeze({
    WRONG_CLUSTER: 'WRONG_CLUSTER',
    DUPLICATE_EVENT: 'DUPLICATE_EVENT',
    MISLEADING_TITLE: 'MISLEADING_TITLE',
    SOURCE_QUALITY_CONCERN: 'SOURCE_QUALITY_CONCERN',
    EVIDENCE_MISMATCH: 'EVIDENCE_MISMATCH',
    CLAIM_OVERSTATEMENT: 'CLAIM_OVERSTATEMENT',
    NO_NEW_DEVELOPMENT: 'NO_NEW_DEVELOPMENT',
    BACKGROUND_ONLY: 'BACKGROUND_ONLY',
    STALE_EVENT: 'STALE_EVENT',
    UNSUITABLE_FOR_DAILY_ISSUE: 'UNSUITABLE_FOR_DAILY_ISSUE',
    OTHER: 'OTHER',
  });

  var RETIRE_REASONS = Object.freeze({
    DISPLAY_WINDOW_ENDED: 'DISPLAY_WINDOW_ENDED',
    SUPERSEDED_BY_UPDATE: 'SUPERSEDED_BY_UPDATE',
    MANUAL_RETIRE: 'MANUAL_RETIRE',
    SOURCE_INVALIDATED: 'SOURCE_INVALIDATED',
    QUALITY_RECHECK_FAILED: 'QUALITY_RECHECK_FAILED',
    FRESHNESS_EXPIRED: 'FRESHNESS_EXPIRED',
    OTHER: 'OTHER',
  });

  /** from → allowed to[] */
  var ALLOWED_TRANSITIONS = Object.freeze({
    READY_FOR_REVIEW: Object.freeze(['APPROVED', 'HELD', 'REJECTED', 'EXPIRED']),
    HELD: Object.freeze(['READY_FOR_REVIEW', 'REJECTED', 'EXPIRED']),
    APPROVED: Object.freeze(['PUBLISHED', 'HELD', 'REJECTED', 'EXPIRED']),
    UPDATE_PENDING: Object.freeze(['APPROVED', 'HELD', 'REJECTED', 'EXPIRED']),
    PUBLISHED: Object.freeze(['RETIRED', 'SUPERSEDED']),
    REJECTED: Object.freeze([]),
    EXPIRED: Object.freeze([]),
    RETIRED: Object.freeze([]),
    SUPERSEDED: Object.freeze([]),
  });

  var QUEUE_STATUSES = Object.freeze([
    'READY_FOR_REVIEW',
    'HELD',
    'APPROVED',
    'UPDATE_PENDING',
    'EXPIRED',
  ]);

  function canTransition(fromStatus, toStatus) {
    var from = String(fromStatus || '');
    var to = String(toStatus || '');
    var allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.indexOf(to) >= 0;
  }

  function assertTransition(fromStatus, toStatus) {
    if (canTransition(fromStatus, toStatus)) {
      return { ok: true, fromStatus: fromStatus, toStatus: toStatus };
    }
    return {
      ok: false,
      error: 'INVALID_TRANSITION',
      fromStatus: fromStatus,
      toStatus: toStatus,
      message: String(fromStatus) + ' → ' + String(toStatus) + ' is not allowed',
    };
  }

  function isQueueStatus(status) {
    return QUEUE_STATUSES.indexOf(String(status || '')) >= 0;
  }

  function storageBucketForStatus(status) {
    var s = String(status || '');
    if (s === REVIEW_STATUS.PUBLISHED) return 'published';
    if (s === REVIEW_STATUS.REJECTED) return 'rejected';
    if (s === REVIEW_STATUS.RETIRED || s === REVIEW_STATUS.SUPERSEDED) return 'retired';
    if (isQueueStatus(s)) return 'queue';
    return null;
  }

  return {
    REVIEW_STATUS: REVIEW_STATUS,
    HOLD_REASONS: HOLD_REASONS,
    REJECT_REASONS: REJECT_REASONS,
    RETIRE_REASONS: RETIRE_REASONS,
    ALLOWED_TRANSITIONS: ALLOWED_TRANSITIONS,
    QUEUE_STATUSES: QUEUE_STATUSES,
    canTransition: canTransition,
    assertTransition: assertTransition,
    isQueueStatus: isQueueStatus,
    storageBucketForStatus: storageBucketForStatus,
  };
});
