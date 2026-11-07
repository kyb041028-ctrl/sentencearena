'use strict';

const usOps = require('../shared/daily-issue-us-ops-core');

function mailConfigured(env) {
  const src = env || process.env;
  return !!(String(src.SMTP_HOST || '').trim() || String(src.SMTP_URL || '').trim());
}

function createUsNoticeAdapter(options) {
  const opt = options || {};
  const sent = [];
  return {
    sent: sent,
    notify: function (input) {
      const decision = usOps.noticeDecision(input);
      if (!decision.send) return { ok: true, delivered: false, reason: decision.reason };
      if (sent.some(function (row) { return row.dedupeKey === decision.dedupeKey; })) {
        return { ok: true, delivered: false, reason: 'DUPLICATE_NOTICE_SUPPRESSED' };
      }
      const record = {
        kind: decision.kind,
        dedupeKey: decision.dedupeKey,
        delivered: false,
        reason: 'MAIL_NOT_CONFIGURED',
      };
      if (mailConfigured(opt.env || process.env) && typeof opt.send === 'function') {
        record.delivered = true;
        record.reason = 'SENT';
      }
      sent.push(record);
      return { ok: true, delivered: record.delivered, reason: record.reason, internal: true };
    },
  };
}

module.exports = {
  mailConfigured: mailConfigured,
  createUsNoticeAdapter: createUsNoticeAdapter,
};
