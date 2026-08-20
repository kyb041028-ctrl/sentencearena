/**
 * 센텐스아레나 — 신고 기반 외계행 판정 공용 규칙
 * 정치성향 score는 입력으로 받지 않으며 판정에 사용하지 않는다.
 * 기존 board reason_code 를 유지한 채 SIMPLE / OTHER 만 분류한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      typeof require === 'function' ? require('./alien-moderation-core') : root.AlienModerationCore,
      typeof require === 'function' ? require('./board-schema-core') : root.BoardSchemaCore,
      typeof require === 'function' ? require('./board-report-review-core') : root.BoardReportReviewCore
    );
  } else {
    root.AlienReportModerationCore = factory(root.AlienModerationCore, root.BoardSchemaCore, root.BoardReportReviewCore);
  }
})(typeof self !== 'undefined' ? self : this, function alienReportModerationCoreFactory(modCore, boardSchema, reviewCore) {
  'use strict';

  var SIMPLE_REPORT_REASONS = Object.freeze(['abuse', 'spam', 'baiting', 'misinfo', 'privacy']);
  var OTHER_REPORT_REASONS = Object.freeze(['other']);

  var CLASSIFICATION = Object.freeze({
    SIMPLE: 'SIMPLE',
    OTHER: 'OTHER',
    UNKNOWN: 'UNKNOWN',
  });

  var TRANSFER_REASON = Object.freeze({
    AUTO_SIMPLE_REPORT_THRESHOLD: 'AUTO_SIMPLE_REPORT_THRESHOLD',
    ADMIN_IMMEDIATE_ALIEN: 'ADMIN_IMMEDIATE_ALIEN',
  });

  var ADMIN_ACTION = Object.freeze({
    NONE: 'NONE',
    NORMAL: 'NORMAL',
    IMMEDIATE_ALIEN: 'IMMEDIATE_ALIEN',
  });

  var CITIZENSHIP = Object.freeze({
    EARTH: 'CITIZEN',
    ALIEN: 'KANTAPBIYA_RESIDENT',
  });

  var COUNTABLE_STATUSES = Object.freeze(['ACCEPTED']);
  var INVALID_STATUSES = Object.freeze(['REJECTED', 'SUBMITTED', 'REVIEWING']);

  var SIMPLE_REPORT_THRESHOLD = 3;
  var WARNING_AT_COUNT = 1;

  var WARNING_MESSAGE =
    '회원님의 활동이 신고되었습니다. 반복적인 신고가 누적될 경우 외계행 조치가 적용될 수 있습니다.';
  var TRANSFER_MESSAGE = '외계행성 소속으로 편입되었습니다. 복귀 가능 시점 전까지 Earth 시민 활동이 제한됩니다.';

  var FIXTURE_DETAIL_MARKERS = Object.freeze(['SC_TEST_FIXTURE', '__SC_FIXTURE__']);

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function classifyReportReason(reasonCode) {
    var code = String(reasonCode || '').trim().toLowerCase();
    if (SIMPLE_REPORT_REASONS.indexOf(code) !== -1) return CLASSIFICATION.SIMPLE;
    if (OTHER_REPORT_REASONS.indexOf(code) !== -1) return CLASSIFICATION.OTHER;
    return CLASSIFICATION.UNKNOWN;
  }

  function isSimpleReportReason(reasonCode) {
    return classifyReportReason(reasonCode) === CLASSIFICATION.SIMPLE;
  }

  function isOtherReportReason(reasonCode) {
    return classifyReportReason(reasonCode) === CLASSIFICATION.OTHER;
  }

  function isCountableReportStatus(status) {
    return COUNTABLE_STATUSES.indexOf(String(status || '').toUpperCase()) !== -1;
  }

  function isInvalidReportStatus(status) {
    return INVALID_STATUSES.indexOf(String(status || '').toUpperCase()) !== -1;
  }

  function isFixtureReport(report) {
    var src = report || {};
    if (src.fixture === true || src.isFixture === true) return true;
    var detail = String(src.reasonDetail || src.reason_detail || '');
    for (var i = 0; i < FIXTURE_DETAIL_MARKERS.length; i++) {
      if (detail.indexOf(FIXTURE_DETAIL_MARKERS[i]) !== -1) return true;
    }
    return false;
  }

  function incidentKey(report) {
    var src = report || {};
    var reporter = String(src.reporterUserId || src.reporter_user_id || '');
    var targetType = String(src.targetType || src.target_type || 'POST').toUpperCase();
    var targetId = String(src.postId || src.post_id || src.commentId || src.comment_id || src.targetId || '');
    return reporter + ':' + targetType + ':' + targetId;
  }

  function reportCreatedAtMs(report) {
    var raw = report && (report.createdAt || report.created_at);
    if (!raw) return 0;
    var t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  }

  /**
   * 확정 위반된 일반 행동(abuse/baiting)만 게시글/댓글 단위로 센다.
   * 접수·검토 중·spam/misinfo/privacy/other 는 외계행 누적에 넣지 않는다.
   */
  function countValidSimpleReports(reports, options) {
    if (reviewCore && typeof reviewCore.countConfirmedConductBehaviors === 'function') {
      var grouped = reviewCore.countConfirmedConductBehaviors(reports, options || {});
      var flat = [];
      (grouped.behaviors || []).forEach(function (g) {
        (g.reports || []).forEach(function (row) {
          if (reviewCore.isConfirmedViolation(row)) flat.push(row);
        });
      });
      return { count: grouped.count, reports: flat, behaviors: grouped.behaviors };
    }
    return { count: 0, reports: [] };
  }

  function warningDedupeKey(userId, cycleKey) {
    return 'ALIEN_WARNING:' + String(userId || '') + ':cycle:' + String(cycleKey || '0');
  }

  function transferDedupeKey(sourceId) {
    return 'ALIEN_TRANSFERRED:source:' + String(sourceId || '');
  }

  function evaluateSimpleReportCycle(input) {
    var src = input || {};
    var frozen = clone(src);
    void frozen;
    var alreadyAlien = src.citizenshipStatus === CITIZENSHIP.ALIEN
      || src.status === (modCore && modCore.STATUS && modCore.STATUS.ALIEN_ACTIVE);
    var evalC = reviewCore && typeof reviewCore.evaluateConfirmedConductCycle === 'function'
      ? reviewCore.evaluateConfirmedConductCycle({
        reports: src.reports,
        targetUserId: src.targetUserId,
        cycleStartAt: src.cycleStartAt,
        alreadyAlien: !!alreadyAlien,
        warningAlreadyIssued: !!src.warningAlreadyIssued,
      })
      : { confirmedConductCount: 0, action: 'NONE', alreadyAlien: !!alreadyAlien, countedBehaviorKeys: [] };
    var n = evalC.confirmedConductCount || 0;
    var action = evalC.action || 'NONE';

    return {
      classification: CLASSIFICATION.SIMPLE,
      simpleCount: n,
      confirmedConductCount: n,
      action: action,
      alreadyAlien: !!alreadyAlien,
      warningMessage: WARNING_MESSAGE,
      transferReason: action === 'TRANSFER' ? TRANSFER_REASON.AUTO_SIMPLE_REPORT_THRESHOLD : null,
      countedReportIds: (evalC.countedBehaviorKeys || []).slice(),
      countedBehaviorKeys: (evalC.countedBehaviorKeys || []).slice(),
    };
  }

  function evaluateOtherReport(input) {
    var src = input || {};
    return {
      classification: CLASSIFICATION.OTHER,
      simpleCount: null,
      action: 'ADMIN_REVIEW',
      autoTransfer: false,
      adminAction: src.adminAction || null,
    };
  }

  function resolveReturnPolicy(strikeCount) {
    if (!modCore || typeof modCore.getAlienPenaltyPolicy !== 'function') {
      return { policyType: 'NONE', durationDays: 0, returnPolicy: 'NONE' };
    }
    var policy = modCore.getAlienPenaltyPolicy(strikeCount);
    if (!policy || !policy.valid) {
      return { policyType: null, durationDays: null, returnPolicy: null, error: policy && policy.error };
    }
    if (policy.requiresSeasonEnd) {
      return {
        policyType: 'SEASON_END',
        durationDays: null,
        returnPolicy: 'SEASON_END',
        requiresSeasonEnd: true,
        adminReturnOnly: true,
      };
    }
    return {
      policyType: policy.policyType,
      durationDays: policy.durationDays,
      returnPolicy: policy.policyType === 'NONE' ? 'NONE' : 'DAYS',
      requiresSeasonEnd: false,
      adminReturnOnly: false,
    };
  }

  function buildTransferApplyInput(input) {
    var src = input || {};
    var strikeBefore = Number(src.strikeBefore) || 0;
    if (strikeBefore < 0) strikeBefore = 0;
    var enteredAt = src.enteredAt || new Date().toISOString();
    var plan = modCore && typeof modCore.buildAlienTransferPlan === 'function'
      ? modCore.buildAlienTransferPlan({
        userId: src.userId,
        strikeBefore: strikeBefore,
        enteredAt: enteredAt,
        previousStatus: src.previousStatus,
        reasonCodes: src.reasonCodes,
        sourceType: src.sourceType,
        currentTerritory: src.earthTerritory,
        alienOriginTerritory: src.earthTerritory,
      })
      : { ok: false, error: 'MODERATION_CORE_MISSING' };
    if (!plan.ok) return plan;
    var returnPolicy = resolveReturnPolicy(plan.strikeAfter);
    return {
      ok: true,
      userId: src.userId,
      strikeBefore: plan.strikeBefore,
      strikeAfter: plan.strikeAfter,
      enteredAt: plan.enteredAt,
      releaseEligibleAt: plan.releaseEligibleAt,
      returnPolicy: returnPolicy.returnPolicy,
      requiresSeasonEnd: !!returnPolicy.requiresSeasonEnd,
      adminReturnOnly: !!returnPolicy.adminReturnOnly,
      durationDays: returnPolicy.durationDays,
      citizenshipStatus: CITIZENSHIP.ALIEN,
      earthTerritory: src.earthTerritory || null,
      transferReason: src.transferReason || TRANSFER_REASON.AUTO_SIMPLE_REPORT_THRESHOLD,
      sourceId: src.sourceId || null,
      sourceType: src.sourceType || 'SIMPLE_REPORT',
    };
  }

  return {
    SIMPLE_REPORT_REASONS: SIMPLE_REPORT_REASONS,
    OTHER_REPORT_REASONS: OTHER_REPORT_REASONS,
    CLASSIFICATION: CLASSIFICATION,
    TRANSFER_REASON: TRANSFER_REASON,
    ADMIN_ACTION: ADMIN_ACTION,
    CITIZENSHIP: CITIZENSHIP,
    COUNTABLE_STATUSES: COUNTABLE_STATUSES,
    INVALID_STATUSES: INVALID_STATUSES,
    SIMPLE_REPORT_THRESHOLD: SIMPLE_REPORT_THRESHOLD,
    WARNING_AT_COUNT: WARNING_AT_COUNT,
    WARNING_MESSAGE: WARNING_MESSAGE,
    TRANSFER_MESSAGE: TRANSFER_MESSAGE,
    clone: clone,
    classifyReportReason: classifyReportReason,
    isSimpleReportReason: isSimpleReportReason,
    isOtherReportReason: isOtherReportReason,
    isCountableReportStatus: isCountableReportStatus,
    isInvalidReportStatus: isInvalidReportStatus,
    isFixtureReport: isFixtureReport,
    incidentKey: incidentKey,
    countValidSimpleReports: countValidSimpleReports,
    warningDedupeKey: warningDedupeKey,
    transferDedupeKey: transferDedupeKey,
    evaluateSimpleReportCycle: evaluateSimpleReportCycle,
    evaluateOtherReport: evaluateOtherReport,
    resolveReturnPolicy: resolveReturnPolicy,
    buildTransferApplyInput: buildTransferApplyInput,
    REPORT_REASONS: boardSchema && boardSchema.REPORT_REASONS ? boardSchema.REPORT_REASONS : null,
  };
});
