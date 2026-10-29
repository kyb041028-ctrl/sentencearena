'use strict';

const assert = require('assert');
const plan = require('../docs/candidates/report-audit-compensation.candidate.js');

const fn = plan.planAuditCompensation;

const open = fn({ finished: false, sanctionAlreadyApplied: true, reportStatus: 'ACCEPTED' });
assert.strictEqual(open.reapplySanction, false);
assert.strictEqual(open.insertAudit, null);
assert.strictEqual(open.sendNotice, false);
assert.strictEqual(open.reason, 'CASE_NOT_FINISHED');

const missingSanction = fn({
  finished: true,
  sanctionAlreadyApplied: true,
  reportStatus: 'ACCEPTED',
  existingAudits: [{ actionType: 'SANCTION_APPLIED', ok: false }],
  noticeRecordMissing: false,
});
assert.strictEqual(missingSanction.reapplySanction, false);
assert.strictEqual(missingSanction.changeReportStatus, false);
assert.strictEqual(missingSanction.hideAgain, false);
assert.strictEqual(missingSanction.insertAudit, 'SANCTION_APPLIED');
assert.strictEqual(missingSanction.sendNotice, false);
assert.strictEqual(missingSanction.reason, 'MISSING_SANCTION_AUDIT');

const sanctionDone = fn({
  finished: true,
  sanctionAlreadyApplied: true,
  reportStatus: 'RESOLVED',
  existingAudits: ['SANCTION_APPLIED'],
  noticeRecordMissing: false,
});
assert.strictEqual(sanctionDone.insertAudit, null);
assert.strictEqual(sanctionDone.sendNotice, false);
assert.strictEqual(sanctionDone.reason, 'AUDIT_ALREADY_PRESENT');

const rejectMissing = fn({
  finished: true,
  sanctionAlreadyApplied: false,
  reportStatus: 'REJECTED',
  existingAudits: [],
  noticeRecordMissing: true,
});
assert.strictEqual(rejectMissing.insertAudit, 'REPORT_REJECTED');
assert.strictEqual(rejectMissing.sendNotice, true);
assert.strictEqual(rejectMissing.reapplySanction, false);

const rejectAuditKept = fn({
  finished: true,
  sanctionAlreadyApplied: false,
  reportStatus: 'REJECTED',
  existingAudits: [{ action_type: 'REPORT_REJECTED' }],
  noticeRecordMissing: true,
});
assert.strictEqual(rejectAuditKept.insertAudit, null);
assert.strictEqual(rejectAuditKept.sendNotice, true);
assert.strictEqual(rejectAuditKept.reason, 'NOTICE_RECORD_MISSING');

const noticeAlreadyThere = fn({
  finished: true,
  sanctionAlreadyApplied: false,
  reportStatus: 'REJECTED',
  existingAudits: ['REPORT_REJECTED'],
  noticeRecordMissing: false,
});
assert.strictEqual(noticeAlreadyThere.sendNotice, false);
assert.strictEqual(noticeAlreadyThere.insertAudit, null);

const noSecondRejectAudit = fn({
  finished: true,
  sanctionAlreadyApplied: true,
  reportStatus: 'ACCEPTED',
  existingAudits: [],
  noticeRecordMissing: true,
});
assert.strictEqual(noSecondRejectAudit.insertAudit, 'SANCTION_APPLIED');
assert.notStrictEqual(noSecondRejectAudit.insertAudit, 'REPORT_REJECTED');

const ambiguousNotice = fn({
  finished: true,
  sanctionAlreadyApplied: true,
  reportStatus: 'ACCEPTED',
  existingAudits: ['SANCTION_APPLIED'],
});
assert.strictEqual(ambiguousNotice.sendNotice, false);

console.log('OK 8');
