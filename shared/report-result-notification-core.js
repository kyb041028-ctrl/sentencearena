/**
 * 신고 처리 결과 — 신고자 공개 알림 (제재 상세 미포함).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReportResultNotificationCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function reportResultNotificationCoreFactory() {
  'use strict';

  var OUTCOME = Object.freeze({
    ACTION_TAKEN: 'ACTION_TAKEN',
    REJECTED: 'REJECTED',
  });

  var NOTIFICATION_TYPE = Object.freeze({
    ACTION_TAKEN: 'report_result_action',
    REJECTED: 'report_result_rejected',
  });

  var TITLE = Object.freeze({
    ACTION_TAKEN: '신고 처리 결과',
    REJECTED: '신고 처리 결과',
  });

  var MESSAGE = Object.freeze({
    ACTION_TAKEN: '신고하신 내용을 검토한 결과 운영정책 위반이 확인되어 필요한 조치를 진행했습니다.',
    REJECTED: '신고하신 내용을 검토했으나 운영정책 위반으로 판단되지 않았습니다.',
  });

  function outcomeFromReviewStatus(status) {
    var s = String(status || '').trim().toUpperCase();
    if (s === 'REJECTED') return OUTCOME.REJECTED;
    if (s === 'ACCEPTED' || s === 'RESOLVED') return OUTCOME.ACTION_TAKEN;
    return null;
  }

  function dedupeKey(reportId, outcome) {
    return 'REPORT_RESULT:' + String(reportId || '') + ':' + String(outcome || '');
  }

  function buildPublicNotification(input) {
    var src = input || {};
    var outcome = src.outcome || outcomeFromReviewStatus(src.status);
    if (!outcome) return { ok: false, error: 'REPORT_RESULT_OUTCOME_INVALID' };
    var reportId = String(src.reportId || src.report_id || '').trim();
    if (!reportId) return { ok: false, error: 'REPORT_RESULT_REPORT_ID_REQUIRED' };
    var userId = String(src.reporterUserId || src.reporter_user_id || src.userId || '').trim();
    if (!userId) return { ok: false, error: 'REPORT_RESULT_REPORTER_REQUIRED' };

    var isReject = outcome === OUTCOME.REJECTED;
    return {
      ok: true,
      notification: {
        userId: userId,
        type: isReject ? NOTIFICATION_TYPE.REJECTED : NOTIFICATION_TYPE.ACTION_TAKEN,
        title: isReject ? TITLE.REJECTED : TITLE.ACTION_TAKEN,
        message: isReject ? MESSAGE.REJECTED : MESSAGE.ACTION_TAKEN,
        dedupeKey: dedupeKey(reportId, outcome),
      },
      outcome: outcome,
    };
  }

  function previewText(raw, maxLen) {
    var text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    var limit = Math.max(20, Math.min(200, Number(maxLen) || 120));
    if (text.length <= limit) return text;
    return text.slice(0, limit) + '…';
  }

  return {
    OUTCOME: OUTCOME,
    NOTIFICATION_TYPE: NOTIFICATION_TYPE,
    TITLE: TITLE,
    MESSAGE: MESSAGE,
    outcomeFromReviewStatus: outcomeFromReviewStatus,
    dedupeKey: dedupeKey,
    buildPublicNotification: buildPublicNotification,
    previewText: previewText,
  };
});
