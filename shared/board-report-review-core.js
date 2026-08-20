/**
 * 신고 검토 · 확정 위반 행동 계산.
 * 신고 건수 ≠ 문제 행동 수. 정치성향 score 미사용.
 * Alien 이동 persist는 ALIEN_MODERATION_V1 에서만 수행한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoardReportReviewCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function boardReportReviewCoreFactory() {
  'use strict';

  var REVIEW_STATUS = Object.freeze({
    SUBMITTED: 'SUBMITTED',
    REVIEWING: 'REVIEWING',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    RESOLVED: 'RESOLVED',
  });

  var SANCTION_CLASS = Object.freeze({
    CONDUCT: 'CONDUCT',
    SERVICE_HARM: 'SERVICE_HARM',
    MISINFO: 'MISINFO',
    RIGHTS: 'RIGHTS',
    OTHER: 'OTHER',
    UNKNOWN: 'UNKNOWN',
  });

  var CONDUCT_REASONS = Object.freeze(['abuse', 'baiting']);
  var SERVICE_HARM_REASONS = Object.freeze(['spam']);
  var MISINFO_REASONS = Object.freeze(['misinfo']);
  var RIGHTS_REASONS = Object.freeze(['privacy']);
  var OTHER_REASONS = Object.freeze(['other']);

  var PENDING_STATUSES = Object.freeze(['SUBMITTED', 'REVIEWING']);
  var CONFIRMED_STATUSES = Object.freeze(['ACCEPTED']);
  var ALIEN_THRESHOLD = 3;
  var ALIEN_WARNING_AT = 1;

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function upper(v) {
    return String(v || '').trim().toUpperCase();
  }

  function reasonOf(report) {
    return String((report && (report.reasonCode || report.reason_code)) || '').trim().toLowerCase();
  }

  function statusOf(report) {
    return upper(report && report.status);
  }

  function classifySanctionClass(reasonCode) {
    var code = String(reasonCode || '').trim().toLowerCase();
    if (CONDUCT_REASONS.indexOf(code) !== -1) return SANCTION_CLASS.CONDUCT;
    if (SERVICE_HARM_REASONS.indexOf(code) !== -1) return SANCTION_CLASS.SERVICE_HARM;
    if (MISINFO_REASONS.indexOf(code) !== -1) return SANCTION_CLASS.MISINFO;
    if (RIGHTS_REASONS.indexOf(code) !== -1) return SANCTION_CLASS.RIGHTS;
    if (OTHER_REASONS.indexOf(code) !== -1) return SANCTION_CLASS.OTHER;
    return SANCTION_CLASS.UNKNOWN;
  }

  function isConductReason(reasonCode) {
    return classifySanctionClass(reasonCode) === SANCTION_CLASS.CONDUCT;
  }

  function isPendingStatus(status) {
    return PENDING_STATUSES.indexOf(upper(status)) !== -1;
  }

  function isConfirmedViolationNote(note) {
    return /VIOLATION_CONFIRMED/.test(String(note || ''));
  }

  function isConfirmedViolation(report) {
    var st = statusOf(report);
    if (CONFIRMED_STATUSES.indexOf(st) !== -1) return true;
    if (st === 'RESOLVED' && isConfirmedViolationNote(report && (report.resolutionNote || report.resolution_note))) {
      return true;
    }
    return false;
  }

  function targetIdOf(report) {
    var src = report || {};
    var type = upper(src.targetType || src.target_type);
    if (type === 'COMMENT') {
      return String(src.commentId || src.comment_id || src.targetId || '');
    }
    return String(src.postId || src.post_id || src.targetId || '');
  }

  function behaviorKeyFromParts(targetType, targetId) {
    var type = upper(targetType);
    var id = String(targetId || '').trim();
    if ((type !== 'POST' && type !== 'COMMENT') || !id) return null;
    return type + ':' + id;
  }

  function behaviorKeyFromReport(report) {
    var src = report || {};
    var type = upper(src.targetType || src.target_type);
    return behaviorKeyFromParts(type, targetIdOf(src));
  }

  function parseBehaviorKey(key) {
    var raw = String(key || '');
    var idx = raw.indexOf(':');
    if (idx <= 0) return { ok: false, error: 'BEHAVIOR_KEY_INVALID' };
    var type = upper(raw.slice(0, idx));
    var id = raw.slice(idx + 1).trim();
    if ((type !== 'POST' && type !== 'COMMENT') || !id) {
      return { ok: false, error: 'BEHAVIOR_KEY_INVALID' };
    }
    return { ok: true, targetType: type, targetId: id, behaviorKey: type + ':' + id };
  }

  function createdAtMs(report) {
    var raw = report && (report.createdAt || report.created_at);
    if (!raw) return 0;
    var t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  }

  function pickPrimaryReason(reasonCounts) {
    var counts = reasonCounts || {};
    var keys = Object.keys(counts);
    if (!keys.length) return null;
    keys.sort(function (a, b) {
      var diff = (counts[b] || 0) - (counts[a] || 0);
      if (diff) return diff;
      var ca = classifySanctionClass(a);
      var cb = classifySanctionClass(b);
      if (ca === SANCTION_CLASS.CONDUCT && cb !== SANCTION_CLASS.CONDUCT) return -1;
      if (cb === SANCTION_CLASS.CONDUCT && ca !== SANCTION_CLASS.CONDUCT) return 1;
      return a < b ? -1 : 1;
    });
    return keys[0];
  }

  function rollupStatus(reports) {
    var list = Array.isArray(reports) ? reports : [];
    if (!list.length) return null;
    var pending = false;
    var accepted = false;
    var rejected = false;
    var resolved = false;
    var first = statusOf(list[0]);
    var allSame = true;
    for (var i = 0; i < list.length; i++) {
      var st = statusOf(list[i]);
      if (st !== first) allSame = false;
      if (isPendingStatus(st)) pending = true;
      if (st === 'ACCEPTED') accepted = true;
      if (st === 'REJECTED') rejected = true;
      if (st === 'RESOLVED') resolved = true;
    }
    if (allSame) return first;
    if (pending) return 'REVIEWING';
    if (accepted && !rejected) return 'ACCEPTED';
    if (rejected && !accepted) return 'REJECTED';
    if (resolved) return 'RESOLVED';
    return 'REVIEWING';
  }

  function reportMatchesBehavior(report, parsed) {
    if (!parsed || !parsed.ok) return false;
    var key = behaviorKeyFromReport(report);
    return key === parsed.behaviorKey;
  }

  function groupReportsByBehavior(reports) {
    var list = Array.isArray(reports) ? reports : [];
    var map = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var key = behaviorKeyFromReport(row);
      if (!key) continue;
      if (!map[key]) {
        map[key] = {
          behaviorKey: key,
          targetType: upper(row.targetType || row.target_type),
          postId: row.postId || row.post_id || null,
          commentId: row.commentId || row.comment_id || null,
          targetAuthorUserId: row.targetAuthorUserId || row.target_author_user_id || null,
          reports: [],
          reasonCounts: {},
        };
      }
      map[key].reports.push(row);
      var reason = reasonOf(row);
      if (reason) map[key].reasonCounts[reason] = (map[key].reasonCounts[reason] || 0) + 1;
      if (!map[key].targetAuthorUserId) {
        map[key].targetAuthorUserId = row.targetAuthorUserId || row.target_author_user_id || null;
      }
    }
    var out = Object.keys(map).map(function (k) {
      var g = map[k];
      g.reportCount = g.reports.length;
      g.primaryReasonCode = pickPrimaryReason(g.reasonCounts);
      g.sanctionClass = classifySanctionClass(g.primaryReasonCode);
      g.status = rollupStatus(g.reports);
      g.confirmedViolation = g.reports.some(isConfirmedViolation);
      g.alienEligible = g.confirmedViolation && g.sanctionClass === SANCTION_CLASS.CONDUCT;
      g.reports.sort(function (a, b) {
        return createdAtMs(a) - createdAtMs(b);
      });
      return g;
    });
    out.sort(function (a, b) {
      var ta = a.reports.length ? createdAtMs(a.reports[a.reports.length - 1]) : 0;
      var tb = b.reports.length ? createdAtMs(b.reports[b.reports.length - 1]) : 0;
      return tb - ta;
    });
    return out;
  }

  function countConfirmedConductBehaviors(reports, options) {
    var opts = options || {};
    var targetUserId = String(opts.targetUserId || '');
    var cycleStartAt = opts.cycleStartAt ? new Date(opts.cycleStartAt).getTime() : 0;
    if (isNaN(cycleStartAt)) cycleStartAt = 0;
    var groups = groupReportsByBehavior(reports);
    var counted = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (targetUserId && String(g.targetAuthorUserId || '') !== targetUserId) continue;
      var confirmed = (g.reports || []).filter(isConfirmedViolation);
      if (!confirmed.length) continue;
      var confirmedCounts = {};
      for (var c = 0; c < confirmed.length; c++) {
        var cr = reasonOf(confirmed[c]);
        if (cr) confirmedCounts[cr] = (confirmedCounts[cr] || 0) + 1;
      }
      var primary = pickPrimaryReason(confirmedCounts);
      if (classifySanctionClass(primary) !== SANCTION_CLASS.CONDUCT) continue;
      var earliest = confirmed.reduce(function (min, row) {
        var t = createdAtMs(row);
        return min === 0 || (t && t < min) ? t : min;
      }, 0);
      if (cycleStartAt && earliest && earliest <= cycleStartAt) continue;
      counted.push(g);
    }
    return {
      count: counted.length,
      behaviors: counted,
    };
  }

  function evaluateConfirmedConductCycle(input) {
    var src = input || {};
    var counted = countConfirmedConductBehaviors(src.reports, {
      targetUserId: src.targetUserId,
      cycleStartAt: src.cycleStartAt,
    });
    var n = counted.count;
    var alreadyAlien = !!src.alreadyAlien;
    var warningAlreadyIssued = !!src.warningAlreadyIssued;
    var action = 'NONE';
    if (!alreadyAlien && n >= ALIEN_THRESHOLD) action = 'TRANSFER';
    else if (!alreadyAlien && n === ALIEN_WARNING_AT && !warningAlreadyIssued) action = 'WARN';
    return {
      sanctionClass: SANCTION_CLASS.CONDUCT,
      confirmedConductCount: n,
      action: action,
      alreadyAlien: alreadyAlien,
      countedBehaviorKeys: counted.behaviors.map(function (g) { return g.behaviorKey; }),
    };
  }

  function resolutionNoteForStatus(status, previousStatus, note) {
    var next = upper(status);
    var prev = upper(previousStatus);
    var base = note == null ? '' : String(note).trim();
    if (next === 'RESOLVED') {
      var wasConfirmed = prev === 'ACCEPTED' || isConfirmedViolationNote(base);
      if (wasConfirmed && !isConfirmedViolationNote(base)) {
        return ('VIOLATION_CONFIRMED' + (base ? ' ' + base : '')).trim();
      }
    }
    if (next === 'ACCEPTED' && !isConfirmedViolationNote(base) && base) {
      return base;
    }
    return base || null;
  }

  function isAllowedReviewStatus(status) {
    var s = upper(status);
    return s === 'REVIEWING' || s === 'ACCEPTED' || s === 'REJECTED' || s === 'RESOLVED';
  }

  return {
    REVIEW_STATUS: REVIEW_STATUS,
    SANCTION_CLASS: SANCTION_CLASS,
    CONDUCT_REASONS: CONDUCT_REASONS,
    SERVICE_HARM_REASONS: SERVICE_HARM_REASONS,
    PENDING_STATUSES: PENDING_STATUSES,
    CONFIRMED_STATUSES: CONFIRMED_STATUSES,
    ALIEN_THRESHOLD: ALIEN_THRESHOLD,
    ALIEN_WARNING_AT: ALIEN_WARNING_AT,
    clone: clone,
    classifySanctionClass: classifySanctionClass,
    isConductReason: isConductReason,
    isPendingStatus: isPendingStatus,
    isConfirmedViolation: isConfirmedViolation,
    behaviorKeyFromParts: behaviorKeyFromParts,
    behaviorKeyFromReport: behaviorKeyFromReport,
    parseBehaviorKey: parseBehaviorKey,
    reportMatchesBehavior: reportMatchesBehavior,
    groupReportsByBehavior: groupReportsByBehavior,
    countConfirmedConductBehaviors: countConfirmedConductBehaviors,
    evaluateConfirmedConductCycle: evaluateConfirmedConductCycle,
    resolutionNoteForStatus: resolutionNoteForStatus,
    isAllowedReviewStatus: isAllowedReviewStatus,
    pickPrimaryReason: pickPrimaryReason,
  };
});
