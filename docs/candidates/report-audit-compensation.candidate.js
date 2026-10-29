'use strict';

/**
 * 후보 전용. 서버 경로에 연결하지 않는다.
 * 이미 끝난 신고 처리에서 감사 행만 빠졌거나, 알림 기록이 없다고 확인된 경우의 계획이다.
 * 제재를 다시 적용하지 않고, 신고 상태를 다시 바꾸지 않으며, 숨김을 다시 하지 않는다.
 */

var AUDIT = Object.freeze({
  SANCTION_APPLIED: 'SANCTION_APPLIED',
  REPORT_REJECTED: 'REPORT_REJECTED',
});

function actionOf(item) {
  if (typeof item === 'string') return item;
  if (!item) return '';
  return String(item.actionType || item.action_type || '');
}

function hasSuccessfulAudit(existing, action) {
  var list = existing || [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (actionOf(item) !== action) continue;
    if (item && item.ok === false) continue;
    return true;
  }
  return false;
}

function noticeOutcome(status) {
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'ACCEPTED' || status === 'RESOLVED') return 'ACTION_TAKEN';
  return null;
}

function planAuditCompensation(input) {
  var src = input || {};
  var plan = {
    reapplySanction: false,
    changeReportStatus: false,
    hideAgain: false,
    insertAudit: null,
    sendNotice: false,
    reason: 'NO_ACTION',
  };

  if (src.finished !== true) {
    plan.reason = 'CASE_NOT_FINISHED';
    return plan;
  }

  var status = String(src.reportStatus || '').trim().toUpperCase();
  var sanctionApplied = src.sanctionAlreadyApplied === true;
  var existing = src.existingAudits || [];

  if (sanctionApplied) {
    if (!hasSuccessfulAudit(existing, AUDIT.SANCTION_APPLIED)) {
      plan.insertAudit = AUDIT.SANCTION_APPLIED;
      plan.reason = 'MISSING_SANCTION_AUDIT';
    } else {
      plan.reason = 'AUDIT_ALREADY_PRESENT';
    }
  } else if (status === 'REJECTED') {
    if (!hasSuccessfulAudit(existing, AUDIT.REPORT_REJECTED)) {
      plan.insertAudit = AUDIT.REPORT_REJECTED;
      plan.reason = 'MISSING_REJECT_AUDIT';
    } else {
      plan.reason = 'AUDIT_ALREADY_PRESENT';
    }
  }

  var outcome = noticeOutcome(status);
  if (src.noticeRecordMissing === true && outcome) {
    plan.sendNotice = true;
    if (plan.reason === 'NO_ACTION' || plan.reason === 'AUDIT_ALREADY_PRESENT') {
      plan.reason = 'NOTICE_RECORD_MISSING';
    }
  }

  return plan;
}

module.exports = {
  AUDIT: AUDIT,
  planAuditCompensation: planAuditCompensation,
};
