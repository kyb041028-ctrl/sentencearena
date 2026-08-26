/**
 * 센텐스아레나 — 외계 moderation 상태·복귀 페널티 공용 core
 * ALIEN ≠ alignment 영토 점수. 자동 판정 공식 없음.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlienModerationCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function alienModerationCoreFactory() {
  'use strict';
  var originCore = null;
  if (typeof require === 'function') {
    try { originCore = require('./alien-origin-core'); } catch (_) {}
  } else if (typeof self !== 'undefined' && self.AlienOriginCore) {
    originCore = self.AlienOriginCore;
  }

  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  var STATUS = Object.freeze({
    EARTH: 'EARTH',
    ALIEN_ACTIVE: 'ALIEN_ACTIVE',
    RETURN_ELIGIBLE: 'RETURN_ELIGIBLE',
    RETURNED: 'RETURNED',
    SUSPENDED: 'SUSPENDED',
    UNAVAILABLE: 'UNAVAILABLE',
  });

  var RETURN_STATUS = Object.freeze({
    NOT_APPLICABLE: 'NOT_APPLICABLE',
    WAITING_PERIOD: 'WAITING_PERIOD',
    ELIGIBLE: 'ELIGIBLE',
    SEASON_END: 'SEASON_END',
    OPERATOR_HOLD: 'OPERATOR_HOLD',
    UNAVAILABLE: 'UNAVAILABLE',
  });

  var RESTRICTION = Object.freeze({
    NONE: 'NONE',
    OBSERVATION_ONLY: 'OBSERVATION_ONLY',
    ALIEN_SPACE_ONLY: 'ALIEN_SPACE_ONLY',
    SUSPENDED: 'SUSPENDED',
  });

  var DATA_STATUS = Object.freeze({
    READY: 'READY',
    LOADING: 'LOADING',
    UNAVAILABLE: 'UNAVAILABLE',
    LEGACY_MOCK: 'LEGACY_MOCK',
  });

  var EVENT_TYPE = Object.freeze({
    WARNING_ISSUED: 'WARNING_ISSUED',
    ALIEN_TRANSFERRED: 'ALIEN_TRANSFERRED',
    RETURN_ELIGIBLE: 'RETURN_ELIGIBLE',
    RETURNED: 'RETURNED',
    PENALTY_EXTENDED: 'PENALTY_EXTENDED',
    OPERATOR_ASSIGNED: 'OPERATOR_ASSIGNED',
    OPERATOR_RELEASED: 'OPERATOR_RELEASED',
  });

  var SIGNAL_TYPE = Object.freeze({
    REPORT_ACCEPTED: 'REPORT_ACCEPTED',
    CONFLICT_BAITING: 'CONFLICT_BAITING',
    SPAM: 'SPAM',
    FLOODING: 'FLOODING',
    HEATED_BEHAVIOR: 'HEATED_BEHAVIOR',
    REPEATED_CONFLICT: 'REPEATED_CONFLICT',
    OPERATOR_FLAG: 'OPERATOR_FLAG',
  });

  /** strike → 페널티 (확정) */
  var PENALTY_DAYS = Object.freeze({ 1: 7, 2: 15, 3: 30 });

  var NOTIFICATION_TYPES = Object.freeze([
    'ALIEN_WARNING',
    'ALIEN_TRANSFER',
    'ALIEN_RETURN_ELIGIBLE',
    'ALIEN_RETURNED',
    'ALIEN_PENALTY_EXTENDED',
    'ALIEN_WEEKLY_LEGEND',
    'ALIEN_RANK_CHANGED',
  ]);

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function parseStrikeCount(value) {
    if (value === null || value === undefined || value === '') {
      return { valid: false, error: 'STRIKE_MISSING', strikeCount: null };
    }
    var n = Math.floor(Number(value));
    if (!isFinite(n) || isNaN(n)) {
      return { valid: false, error: 'STRIKE_INVALID', strikeCount: null };
    }
    if (n < 0) {
      return { valid: false, error: 'STRIKE_NEGATIVE', strikeCount: null };
    }
    return { valid: true, error: null, strikeCount: n };
  }

  function getAlienPenaltyPolicy(strikeCount) {
    var parsed = parseStrikeCount(strikeCount);
    if (!parsed.valid) {
      return { valid: false, error: parsed.error, policyType: null, durationDays: null, requiresSeasonEnd: false };
    }
    var s = parsed.strikeCount;
    if (s === 0) {
      return { valid: true, error: null, policyType: 'NONE', durationDays: 0, requiresSeasonEnd: false };
    }
    if (s === 1) {
      return { valid: true, error: null, policyType: 'DAYS', durationDays: 7, requiresSeasonEnd: false, requiresOperatorReturn: false };
    }
    if (s === 2) {
      return { valid: true, error: null, policyType: 'DAYS', durationDays: 15, requiresSeasonEnd: false, requiresOperatorReturn: false };
    }
    if (s === 3) {
      return { valid: true, error: null, policyType: 'DAYS', durationDays: 30, requiresSeasonEnd: false, requiresOperatorReturn: false };
    }
    // 4회차 이상(임시): 30일 + 운영자 복귀 검토. 시즌 시스템 완성 전 SEASON_END 신규 사용 금지.
    return {
      valid: true,
      error: null,
      policyType: 'OPERATOR_REVIEW',
      durationDays: 30,
      requiresSeasonEnd: false,
      requiresOperatorReturn: true,
    };
  }

  /**
   * @param {{ strikeCount, enteredAt, seasonEndAt?, now? }} input
   */
  function calculateAlienReleaseEligibility(input) {
    var src = input || {};
    var frozen = clone(src);
    void frozen;

    var parsed = parseStrikeCount(src.strikeCount);
    if (!parsed.valid) {
      return { policyType: null, durationDays: null, releaseEligibleAt: null, requiresSeasonEnd: false, available: false, error: parsed.error };
    }

    if (parsed.strikeCount === 0) {
      return {
        policyType: 'NONE',
        durationDays: 0,
        releaseEligibleAt: null,
        requiresSeasonEnd: false,
        available: true,
        returnStatus: RETURN_STATUS.NOT_APPLICABLE,
      };
    }

    if (!src.enteredAt) {
      return {
        policyType: null,
        durationDays: null,
        releaseEligibleAt: null,
        requiresSeasonEnd: false,
        available: false,
        error: 'ENTERED_AT_MISSING',
      };
    }

    var entered = new Date(src.enteredAt);
    if (isNaN(entered.getTime())) {
      return {
        policyType: null,
        durationDays: null,
        releaseEligibleAt: null,
        requiresSeasonEnd: false,
        available: false,
        error: 'ENTERED_AT_INVALID',
      };
    }

    var policy = getAlienPenaltyPolicy(parsed.strikeCount);
    // Legacy SEASON_END rows (과거 자료) — 신규 Production 정책은 OPERATOR_REVIEW.
    if (policy.requiresSeasonEnd || src.returnPolicy === 'SEASON_END') {
      if (!src.seasonEndAt) {
        return {
          policyType: 'SEASON_END',
          durationDays: null,
          releaseEligibleAt: null,
          requiresSeasonEnd: true,
          requiresOperatorReturn: true,
          available: false,
          error: 'SEASON_END_UNAVAILABLE',
          returnStatus: RETURN_STATUS.SEASON_END,
        };
      }
      var seasonEnd = new Date(src.seasonEndAt);
      if (isNaN(seasonEnd.getTime())) {
        return {
          policyType: 'SEASON_END',
          durationDays: null,
          releaseEligibleAt: null,
          requiresSeasonEnd: true,
          requiresOperatorReturn: true,
          available: false,
          error: 'SEASON_END_INVALID',
          returnStatus: RETURN_STATUS.SEASON_END,
        };
      }
      var now = src.now ? new Date(src.now) : new Date();
      var eligible = now.getTime() >= seasonEnd.getTime();
      return {
        policyType: 'SEASON_END',
        durationDays: null,
        releaseEligibleAt: seasonEnd.toISOString(),
        requiresSeasonEnd: true,
        requiresOperatorReturn: true,
        available: true,
        returnStatus: eligible ? RETURN_STATUS.ELIGIBLE : RETURN_STATUS.SEASON_END,
      };
    }

    var days = policy.durationDays != null ? policy.durationDays : 30;
    var release = new Date(entered.getTime() + days * MS_PER_DAY);
    var now2 = src.now ? new Date(src.now) : new Date();
    var waiting = now2.getTime() < release.getTime();
    var opReview = !!policy.requiresOperatorReturn || policy.policyType === 'OPERATOR_REVIEW'
      || src.returnPolicy === 'OPERATOR_REVIEW';
    return {
      policyType: opReview ? 'OPERATOR_REVIEW' : 'DAYS',
      durationDays: days,
      releaseEligibleAt: release.toISOString(),
      requiresSeasonEnd: false,
      requiresOperatorReturn: opReview,
      available: true,
      returnStatus: waiting
        ? RETURN_STATUS.WAITING_PERIOD
        : (opReview ? RETURN_STATUS.ELIGIBLE : RETURN_STATUS.ELIGIBLE),
    };
  }

  function isAlienRestrictedStatus(status) {
    return status === STATUS.ALIEN_ACTIVE || status === STATUS.RETURN_ELIGIBLE;
  }

  function buildModerationStateContract(parts) {
    var p = parts || {};
    var strike = parseStrikeCount(p.strikeCount != null ? p.strikeCount : 0);
    var strikeCount = strike.valid ? strike.strikeCount : 0;
    var status = p.status || (strikeCount === 0 ? STATUS.EARTH : STATUS.ALIEN_ACTIVE);
    var operatorHold = !!p.operatorHold;

    var release = calculateAlienReleaseEligibility({
      strikeCount: strikeCount,
      enteredAt: p.enteredAt,
      seasonEndAt: p.seasonEndAt,
      now: p.now,
    });

    var returnStatus = RETURN_STATUS.NOT_APPLICABLE;
    var canReturn = false;
    if (operatorHold) {
      returnStatus = RETURN_STATUS.OPERATOR_HOLD;
      canReturn = false;
    } else if (isAlienRestrictedStatus(status)) {
      returnStatus = release.returnStatus || RETURN_STATUS.UNAVAILABLE;
      canReturn = returnStatus === RETURN_STATUS.ELIGIBLE;
    }

    var restriction = RESTRICTION.NONE;
    if (status === STATUS.SUSPENDED) restriction = RESTRICTION.SUSPENDED;
    else if (isAlienRestrictedStatus(status)) restriction = RESTRICTION.ALIEN_SPACE_ONLY;

    return {
      userId: p.userId || null,
      status: status,
      strikeCount: strikeCount,
      enteredAt: p.enteredAt || null,
      releaseEligibleAt: release.releaseEligibleAt || null,
      seasonReleaseKey: p.seasonReleaseKey || null,
      entryReasonCodes: Array.isArray(p.entryReasonCodes) ? p.entryReasonCodes.slice() : [],
      operatorAssigned: !!p.operatorAssigned,
      operatorNoteAvailable: false,
      currentRestriction: restriction,
      alienOriginTerritory: originCore && typeof originCore.normalizeAlienOriginTerritory === 'function'
        ? originCore.normalizeAlienOriginTerritory(p.alienOriginTerritory)
        : (p.alienOriginTerritory || 'UNKNOWN'),
      originCapturedAt: p.originCapturedAt || null,
      originSource: p.originSource || null,
      canReturn: canReturn,
      returnStatus: returnStatus,
      dataStatus: p.dataStatus || DATA_STATUS.READY,
      updatedAt: p.updatedAt || null,
    };
  }

  function sanitizePublicModerationView(state) {
    if (!state) return null;
    return {
      userId: state.userId,
      status: isAlienRestrictedStatus(state.status) ? STATUS.ALIEN_ACTIVE : STATUS.EARTH,
      dataStatus: state.dataStatus,
    };
  }

  function buildAlienTransferPlan(input) {
    var src = input || {};
    var frozen = clone(src);
    void frozen;
    var before = parseStrikeCount(src.strikeBefore != null ? src.strikeBefore : 0);
    if (!before.valid) return { ok: false, error: before.error };
    var after = before.strikeCount + 1;
    var enteredAt = src.enteredAt || new Date().toISOString();
    var release = calculateAlienReleaseEligibility({
      strikeCount: after,
      enteredAt: enteredAt,
      seasonEndAt: src.seasonEndAt,
    });
    return {
      ok: true,
      userId: src.userId,
      strikeBefore: before.strikeCount,
      strikeAfter: after,
      previousStatus: src.previousStatus || STATUS.EARTH,
      nextStatus: STATUS.ALIEN_ACTIVE,
      enteredAt: enteredAt,
      releaseEligibleAt: release.releaseEligibleAt,
      seasonReleaseKey: release.requiresSeasonEnd ? (src.seasonReleaseKey || null) : null,
      reasonCodes: Array.isArray(src.reasonCodes) ? src.reasonCodes.slice() : [],
      sourceType: src.sourceType || 'OPERATOR',
      alienOriginTerritory: originCore && typeof originCore.normalizeAlienOriginTerritory === 'function'
        ? originCore.normalizeAlienOriginTerritory(src.alienOriginTerritory || src.currentTerritory)
        : (src.alienOriginTerritory || 'UNKNOWN'),
      originCapturedAt: src.originCapturedAt || enteredAt,
      originSource: src.originSource || 'MODERATION_TRANSFER_SNAPSHOT',
      releaseAvailable: release.available,
      releaseError: release.error || null,
      note: 'PLAN_ONLY_NOT_PERSISTED',
    };
  }

  function buildAlienReturnPlan(input) {
    var src = input || {};
    if (src.operatorHold) {
      return { ok: false, error: 'OPERATOR_HOLD' };
    }
    var release = calculateAlienReleaseEligibility({
      strikeCount: src.strikeCount,
      enteredAt: src.enteredAt,
      seasonEndAt: src.seasonEndAt,
      now: src.now,
    });
    if (!release.available) {
      return { ok: false, error: release.error || 'RELEASE_UNAVAILABLE' };
    }
    if (release.returnStatus !== RETURN_STATUS.ELIGIBLE && !src.operatorForced) {
      return { ok: false, error: 'NOT_YET_ELIGIBLE', returnStatus: release.returnStatus };
    }
    return {
      ok: true,
      userId: src.userId,
      previousStatus: src.previousStatus || STATUS.ALIEN_ACTIVE,
      nextStatus: STATUS.RETURNED,
      note: 'PLAN_ONLY_NOT_PERSISTED',
    };
  }

  function buildNotificationEventContract(type, userId, payload) {
    return {
      type: type,
      userId: userId,
      dedupeKey: String(type) + ':' + String(userId) + ':' + (payload && payload.key ? payload.key : Date.now()),
      payload: payload || {},
      occurredAt: new Date().toISOString(),
      note: 'NOTIFICATION_NOT_SENT',
    };
  }

  return {
    STATUS: STATUS,
    RETURN_STATUS: RETURN_STATUS,
    RESTRICTION: RESTRICTION,
    DATA_STATUS: DATA_STATUS,
    EVENT_TYPE: EVENT_TYPE,
    SIGNAL_TYPE: SIGNAL_TYPE,
    PENALTY_DAYS: PENALTY_DAYS,
    NOTIFICATION_TYPES: NOTIFICATION_TYPES,
    MS_PER_DAY: MS_PER_DAY,
    clone: clone,
    parseStrikeCount: parseStrikeCount,
    getAlienPenaltyPolicy: getAlienPenaltyPolicy,
    calculateAlienReleaseEligibility: calculateAlienReleaseEligibility,
    isAlienRestrictedStatus: isAlienRestrictedStatus,
    buildModerationStateContract: buildModerationStateContract,
    sanitizePublicModerationView: sanitizePublicModerationView,
    buildAlienTransferPlan: buildAlienTransferPlan,
    buildAlienReturnPlan: buildAlienReturnPlan,
    buildNotificationEventContract: buildNotificationEventContract,
  };
});
