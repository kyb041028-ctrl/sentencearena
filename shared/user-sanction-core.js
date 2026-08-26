/**
 * SentenceArena 제재 단계 · 차단 범위 · 공개 안내.
 * 정치성향 score/territory 명칭/정당 지지는 입력도 결과도 사용하지 않는다.
 * 신고 묶기(SSOT)는 board-report-review-core. 이 모듈은 확정 위반 이후만 다룬다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      typeof require === 'function' ? require('./board-report-review-core') : root.BoardReportReviewCore
    );
  } else {
    root.UserSanctionCore = factory(root.BoardReportReviewCore);
  }
})(typeof self !== 'undefined' ? self : this, function userSanctionCoreFactory(reviewCore) {
  'use strict';

  var SANCTION_TYPE = Object.freeze({
    NONE: 'NONE',
    WARNING: 'WARNING',
    FINAL_WARNING: 'FINAL_WARNING',
    ALIEN_TRANSFER: 'ALIEN_TRANSFER',
    WRITE_RESTRICT_24H: 'WRITE_RESTRICT_24H',
    ACCOUNT_RESTRICT_7D: 'ACCOUNT_RESTRICT_7D',
    ACCOUNT_RESTRICT_30D: 'ACCOUNT_RESTRICT_30D',
    TEMP_SUSPEND: 'TEMP_SUSPEND',
    PERMANENT_BAN: 'PERMANENT_BAN',
    PERMANENT_REVIEW: 'PERMANENT_REVIEW',
  });

  var SANCTION_STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    EXPIRED: 'EXPIRED',
    RELEASED: 'RELEASED',
    PENDING_REVIEW: 'PENDING_REVIEW',
  });

  var LADDER = Object.freeze({
    CONDUCT_EARTH: 'CONDUCT_EARTH',
    CONDUCT_ALIEN: 'CONDUCT_ALIEN',
    SERVICE_HARM: 'SERVICE_HARM',
    SEVERE: 'SEVERE',
    MASS_HARM: 'MASS_HARM',
  });

  var ACTION_KIND = Object.freeze({
    WRITE: 'WRITE',
    PARTICIPATE: 'PARTICIPATE',
    ACCOUNT: 'ACCOUNT',
    WITHDRAW: 'WITHDRAW',
    LEGAL: 'LEGAL',
    NOTICE: 'NOTICE',
    APPEAL: 'APPEAL',
  });

  var APPEAL_DECISION = Object.freeze({
    UPHELD: 'UPHELD',
    SHORTENED: 'SHORTENED',
    RELEASED: 'RELEASED',
  });

  var SEVERE_CODE = Object.freeze({
    CSAM: 'CSAM',
    NCII: 'NCII',
    CREDIBLE_THREAT: 'CREDIBLE_THREAT',
    DOXXING_ATTACK: 'DOXXING_ATTACK',
    FRAUD_PHISHING: 'FRAUD_PHISHING',
    SYSTEM_ATTACK: 'SYSTEM_ATTACK',
    COORDINATED_MANIPULATION: 'COORDINATED_MANIPULATION',
    MASS_SPAM: 'MASS_SPAM',
    BAN_EVASION: 'BAN_EVASION',
  });

  var OPERATOR_ACTION = Object.freeze({
    AUTO: 'AUTO',
    NONE: 'NONE',
    WARNING: 'WARNING',
    FINAL_WARNING: 'FINAL_WARNING',
    ALIEN_TRANSFER: 'ALIEN_TRANSFER',
    WRITE_RESTRICT_24H: 'WRITE_RESTRICT_24H',
    ACCOUNT_RESTRICT_7D: 'ACCOUNT_RESTRICT_7D',
    ACCOUNT_RESTRICT_30D: 'ACCOUNT_RESTRICT_30D',
    TEMP_SUSPEND: 'TEMP_SUSPEND',
    PERMANENT_BAN: 'PERMANENT_BAN',
  });

  var POLITICAL_KEYS = Object.freeze([
    'alignmentScore',
    'politicalScore',
    'alignment',
    'politicalAlignment',
    'territoryScore',
    'pioneerScore',
    'centralScore',
    'guardianScore',
    'planetPct',
  ]);

  var MS_HOUR = 60 * 60 * 1000;
  var MS_DAY = 24 * MS_HOUR;

  var USER_MESSAGES = Object.freeze({
    WARNING: '커뮤니티 운영정책 위반이 확인되었습니다.',
    FINAL_WARNING:
      '동일하거나 유사한 운영정책 위반이 반복되었습니다.\n추가 위반이 확인될 경우 외계행성으로 이동할 수 있습니다.',
    ALIEN_TRANSFER: '외계행성으로 이동되었습니다. 운영정책은 외계행성에서도 동일하게 적용됩니다.',
    ALIEN_TRANSFER_CONDITION: '커뮤니티 운영정책 위반이 반복 확인되었습니다.',
    WRITE_RESTRICT_24H: '24시간 동안 게시글·댓글 작성이 제한됩니다. 읽기는 가능합니다.',
    ACCOUNT_RESTRICT_7D: '7일 동안 회원 참여 기능이 제한됩니다. 회원탈퇴와 계정 관리 기능은 사용할 수 있습니다.',
    ACCOUNT_RESTRICT_30D: '30일 동안 회원 참여 기능이 제한됩니다. 회원탈퇴와 계정 관리 기능은 사용할 수 있습니다.',
    TEMP_SUSPEND: '운영자 확인을 위해 임시로 활동이 중지되었습니다. 읽기는 가능합니다.',
    PERMANENT_BAN: '영구정지되었습니다. 본인 제재 안내 확인, 이의신청, 회원탈퇴는 가능합니다.',
    PERMANENT_REVIEW: '영구정지 검토 대상으로 전환되었습니다. 운영자 확인 전까지 자동 영구정지되지 않습니다.',
    NONE: '',
  });

  var POLICY_LABEL = Object.freeze({
    CONDUCT: '일반 행동 위반(욕설·분쟁 유도 등)',
    SERVICE_HARM: '광고·대량 도배 등 서비스 훼손',
    SEVERE: '중대한 운영정책 위반',
    MASS_HARM: '대규모 악성 광고·자동 도배',
    MISINFO: '허위정보(운영자 검토, 자동 제재 없음)',
    RIGHTS: '개인정보·권리침해(운영자 검토)',
    OTHER: '기타(운영자 검토)',
  });

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function upper(v) {
    return String(v || '').trim().toUpperCase();
  }

  function hasPoliticalInput(src) {
    var row = src || {};
    for (var i = 0; i < POLITICAL_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(row, POLITICAL_KEYS[i]) && row[POLITICAL_KEYS[i]] != null) {
        return true;
      }
    }
    return false;
  }

  function stripPolitical(src) {
    var row = clone(src) || {};
    for (var i = 0; i < POLITICAL_KEYS.length; i++) {
      delete row[POLITICAL_KEYS[i]];
    }
    return row;
  }

  function isSanctionType(v) {
    var s = upper(v);
    return Object.keys(SANCTION_TYPE).indexOf(s) !== -1;
  }

  function isSevereCode(v) {
    var s = upper(v);
    return Object.keys(SEVERE_CODE).indexOf(s) !== -1;
  }

  function isOperatorAction(v) {
    var s = upper(v);
    return Object.keys(OPERATOR_ACTION).indexOf(s) !== -1;
  }

  function alienForbiddenForLadder(ladder) {
    var l = upper(ladder);
    return l === LADDER.SERVICE_HARM || l === LADDER.SEVERE || l === LADDER.MASS_HARM;
  }

  function canSelectAlien(sanctionClass, ladder, severeCode, massHarm) {
    if (massHarm || isSevereCode(severeCode)) return false;
    var cls = upper(sanctionClass);
    if (cls === 'SERVICE_HARM') return false;
    if (alienForbiddenForLadder(ladder)) return false;
    return cls === 'CONDUCT';
  }

  function durationMsFor(type) {
    var t = upper(type);
    if (t === SANCTION_TYPE.WRITE_RESTRICT_24H) return 24 * MS_HOUR;
    if (t === SANCTION_TYPE.ACCOUNT_RESTRICT_7D) return 7 * MS_DAY;
    if (t === SANCTION_TYPE.ACCOUNT_RESTRICT_30D) return 30 * MS_DAY;
    return null;
  }

  function isPermanentType(type) {
    return upper(type) === SANCTION_TYPE.PERMANENT_BAN;
  }

  function canAppealType(type) {
    var t = upper(type);
    return t === SANCTION_TYPE.ALIEN_TRANSFER
      || t === SANCTION_TYPE.ACCOUNT_RESTRICT_7D
      || t === SANCTION_TYPE.ACCOUNT_RESTRICT_30D
      || t === SANCTION_TYPE.PERMANENT_BAN;
  }

  function inquiryOnlyType(type) {
    return upper(type) === SANCTION_TYPE.WRITE_RESTRICT_24H;
  }

  function eventTypeFor(type) {
    var t = upper(type);
    if (t === SANCTION_TYPE.WARNING || t === SANCTION_TYPE.FINAL_WARNING) return 'WARNING_ISSUED';
    if (t === SANCTION_TYPE.ALIEN_TRANSFER) return 'ALIEN_TRANSFERRED';
    if (t === SANCTION_TYPE.WRITE_RESTRICT_24H
      || t === SANCTION_TYPE.ACCOUNT_RESTRICT_7D
      || t === SANCTION_TYPE.ACCOUNT_RESTRICT_30D) {
      return 'PENALTY_EXTENDED';
    }
    if (t === SANCTION_TYPE.NONE) return 'OPERATOR_RELEASED';
    return 'OPERATOR_ASSIGNED';
  }

  function recommendEarthConduct(count) {
    var n = Number(count) || 0;
    if (n <= 0) return { type: SANCTION_TYPE.NONE, ladder: LADDER.CONDUCT_EARTH };
    if (n === 1) return { type: SANCTION_TYPE.WARNING, ladder: LADDER.CONDUCT_EARTH };
    if (n === 2) return { type: SANCTION_TYPE.FINAL_WARNING, ladder: LADDER.CONDUCT_EARTH };
    return { type: SANCTION_TYPE.ALIEN_TRANSFER, ladder: LADDER.CONDUCT_EARTH };
  }

  function recommendAlienConduct(count) {
    var n = Number(count) || 0;
    if (n <= 0) return { type: SANCTION_TYPE.NONE, ladder: LADDER.CONDUCT_ALIEN };
    if (n === 1) return { type: SANCTION_TYPE.WRITE_RESTRICT_24H, ladder: LADDER.CONDUCT_ALIEN };
    if (n === 2) return { type: SANCTION_TYPE.ACCOUNT_RESTRICT_7D, ladder: LADDER.CONDUCT_ALIEN };
    if (n === 3) return { type: SANCTION_TYPE.ACCOUNT_RESTRICT_30D, ladder: LADDER.CONDUCT_ALIEN };
    return { type: SANCTION_TYPE.PERMANENT_REVIEW, ladder: LADDER.CONDUCT_ALIEN };
  }

  function recommendServiceHarm(count) {
    var n = Number(count) || 0;
    if (n <= 0) return { type: SANCTION_TYPE.NONE, ladder: LADDER.SERVICE_HARM };
    if (n === 1) return { type: SANCTION_TYPE.WARNING, ladder: LADDER.SERVICE_HARM, hideContent: true };
    if (n === 2) return { type: SANCTION_TYPE.WRITE_RESTRICT_24H, ladder: LADDER.SERVICE_HARM };
    if (n === 3) return { type: SANCTION_TYPE.ACCOUNT_RESTRICT_7D, ladder: LADDER.SERVICE_HARM };
    if (n === 4) return { type: SANCTION_TYPE.ACCOUNT_RESTRICT_30D, ladder: LADDER.SERVICE_HARM };
    return { type: SANCTION_TYPE.PERMANENT_REVIEW, ladder: LADDER.SERVICE_HARM };
  }

  function recommendSevere() {
    return { type: SANCTION_TYPE.TEMP_SUSPEND, ladder: LADDER.SEVERE, alienForbidden: true };
  }

  function recommendMassHarm() {
    return { type: SANCTION_TYPE.TEMP_SUSPEND, ladder: LADDER.MASS_HARM, alienForbidden: true };
  }

  function resolveRecommended(input) {
    var src = stripPolitical(input || {});
    void hasPoliticalInput(input);
    if (src.massHarm || upper(src.severeCode) === SEVERE_CODE.MASS_SPAM) {
      return recommendMassHarm();
    }
    if (isSevereCode(src.severeCode)) {
      return recommendSevere();
    }
    var cls = upper(src.sanctionClass);
    if (cls === 'SERVICE_HARM') return recommendServiceHarm(src.harmCount);
    if (cls === 'CONDUCT') {
      if (src.alreadyAlien) return recommendAlienConduct(src.alienConductCount);
      return recommendEarthConduct(src.conductCount);
    }
    return { type: SANCTION_TYPE.NONE, ladder: cls || 'OTHER', auto: false, reviewOnly: true };
  }

  function resolveChosen(input) {
    var src = stripPolitical(input || {});
    var recommended = resolveRecommended(src);
    var op = upper(src.operatorSanction || src.operatorAction || OPERATOR_ACTION.AUTO);
    if (!op || op === OPERATOR_ACTION.AUTO) {
      return Object.assign({}, recommended, { chosenBy: 'AUTO' });
    }
    if (op === OPERATOR_ACTION.NONE) {
      return { type: SANCTION_TYPE.NONE, ladder: recommended.ladder, chosenBy: 'OPERATOR', applied: false };
    }
    if (op === SANCTION_TYPE.ALIEN_TRANSFER && !canSelectAlien(src.sanctionClass, recommended.ladder, src.severeCode, src.massHarm)) {
      return {
        ok: false,
        error: 'ALIEN_FORBIDDEN_FOR_CLASS',
        type: SANCTION_TYPE.NONE,
        ladder: recommended.ladder,
      };
    }
    if (!isSanctionType(op) || op === SANCTION_TYPE.PERMANENT_REVIEW) {
      if (op === SANCTION_TYPE.PERMANENT_REVIEW) {
        return Object.assign({}, recommended, { type: SANCTION_TYPE.PERMANENT_REVIEW, chosenBy: 'OPERATOR' });
      }
      return { ok: false, error: 'OPERATOR_ACTION_INVALID', type: SANCTION_TYPE.NONE };
    }
    return {
      type: op,
      ladder: recommended.ladder,
      hideContent: !!recommended.hideContent && op === SANCTION_TYPE.WARNING,
      chosenBy: 'OPERATOR',
      alienForbidden: recommended.alienForbidden,
    };
  }

  function buildSchedule(type, nowIso, endsAtOverride) {
    var t = upper(type);
    var start = nowIso || new Date().toISOString();
    var permanent = isPermanentType(t);
    var endsAt = null;
    if (permanent) endsAt = null;
    else if (endsAtOverride) endsAt = endsAtOverride;
    else {
      var ms = durationMsFor(t);
      if (ms) endsAt = new Date(new Date(start).getTime() + ms).toISOString();
    }
    return {
      sanctionType: t,
      startsAt: start,
      endsAt: endsAt,
      permanent: permanent,
      status: t === SANCTION_TYPE.PERMANENT_REVIEW ? SANCTION_STATUS.PENDING_REVIEW : SANCTION_STATUS.ACTIVE,
    };
  }

  function isActiveRecord(row, nowMs) {
    var src = row || {};
    var type = upper(src.currentSanctionType || src.sanctionType);
    if (!type || type === SANCTION_TYPE.NONE || type === SANCTION_TYPE.WARNING || type === SANCTION_TYPE.FINAL_WARNING) {
      return false;
    }
    if (type === SANCTION_TYPE.PERMANENT_REVIEW) return false;
    if (type === SANCTION_TYPE.ALIEN_TRANSFER) return false;
    var st = upper(src.currentSanctionStatus || src.status);
    if (st === SANCTION_STATUS.RELEASED || st === SANCTION_STATUS.EXPIRED) return false;
    if (src.currentSanctionPermanent || src.permanent) return true;
    var ends = src.currentSanctionEndsAt || src.endsAt;
    if (!ends) {
      return type === SANCTION_TYPE.TEMP_SUSPEND || type === SANCTION_TYPE.PERMANENT_BAN;
    }
    var t = new Date(ends).getTime();
    if (isNaN(t)) return false;
    return t > (nowMs || Date.now());
  }

  function activeType(row, nowMs) {
    if (!isActiveRecord(row, nowMs)) return SANCTION_TYPE.NONE;
    return upper(row.currentSanctionType || row.sanctionType);
  }

  function blocksWrite(type) {
    var t = upper(type);
    return t === SANCTION_TYPE.WRITE_RESTRICT_24H
      || t === SANCTION_TYPE.ACCOUNT_RESTRICT_7D
      || t === SANCTION_TYPE.ACCOUNT_RESTRICT_30D
      || t === SANCTION_TYPE.TEMP_SUSPEND
      || t === SANCTION_TYPE.PERMANENT_BAN;
  }

  function blocksParticipate(type) {
    var t = upper(type);
    return t === SANCTION_TYPE.ACCOUNT_RESTRICT_7D
      || t === SANCTION_TYPE.ACCOUNT_RESTRICT_30D
      || t === SANCTION_TYPE.TEMP_SUSPEND
      || t === SANCTION_TYPE.PERMANENT_BAN;
  }

  function blocksAccount(type) {
    return blocksParticipate(type);
  }

  function errorForKind(type, kind) {
    var t = upper(type);
    if (t === SANCTION_TYPE.PERMANENT_BAN) return 'SANCTION_PERMANENT_BAN';
    if (t === SANCTION_TYPE.TEMP_SUSPEND) return 'SANCTION_TEMP_SUSPENDED';
    if (t === SANCTION_TYPE.ACCOUNT_RESTRICT_7D || t === SANCTION_TYPE.ACCOUNT_RESTRICT_30D) {
      return 'SANCTION_ACCOUNT_RESTRICTED';
    }
    if (t === SANCTION_TYPE.WRITE_RESTRICT_24H && upper(kind) === ACTION_KIND.WRITE) {
      return 'SANCTION_WRITE_RESTRICTED';
    }
    return 'SANCTION_ACCOUNT_RESTRICTED';
  }

  function assertAllows(row, kind, nowMs) {
    var k = upper(kind);
    if (k === ACTION_KIND.WITHDRAW || k === ACTION_KIND.LEGAL || k === ACTION_KIND.NOTICE || k === ACTION_KIND.APPEAL) {
      return { ok: true, allowed: true };
    }
    var type = activeType(row, nowMs);
    if (type === SANCTION_TYPE.NONE) return { ok: true, allowed: true, sanctionType: type };
    if (k === ACTION_KIND.WRITE && blocksWrite(type)) {
      return { ok: false, allowed: false, error: errorForKind(type, k), sanctionType: type };
    }
    if (k === ACTION_KIND.PARTICIPATE && blocksParticipate(type)) {
      return { ok: false, allowed: false, error: errorForKind(type, k), sanctionType: type };
    }
    if (k === ACTION_KIND.ACCOUNT && blocksAccount(type)) {
      return { ok: false, allowed: false, error: errorForKind(type, k), sanctionType: type };
    }
    return { ok: true, allowed: true, sanctionType: type };
  }

  function behaviorKindLabel(behaviorKey) {
    var raw = String(behaviorKey || '');
    if (raw.indexOf('COMMENT:') === 0) return '댓글';
    if (raw.indexOf('POST:') === 0) return '게시글';
    return '활동';
  }

  function isActualAlienResidence(src) {
    var row = src || {};
    if (row.alienTransferCompleted === true) return true;
    if (row.alienTransferCompleted === false) return false;
    var cit = String(row.citizenshipStatus || '').toUpperCase();
    var st = String(row.status || '').toUpperCase();
    return cit === 'KANTAPBIYA_RESIDENT' || st === 'ALIEN_ACTIVE';
  }

  function userMessageFor(type, src) {
    if (type === SANCTION_TYPE.ALIEN_TRANSFER && !isActualAlienResidence(src)) {
      return USER_MESSAGES.ALIEN_TRANSFER_CONDITION;
    }
    return USER_MESSAGES[type] || '';
  }

  function toPublicNotice(row) {
    var src = stripPolitical(row || {});
    var type = upper(src.currentSanctionType || src.sanctionType || SANCTION_TYPE.NONE);
    var ladder = upper(src.currentSanctionLadder || src.ladder || '');
    var appeal = canAppealType(type) && upper(src.currentSanctionStatus || src.status) !== SANCTION_STATUS.RELEASED;
    return {
      sanctionType: type,
      policyViolation: POLICY_LABEL[ladder] || POLICY_LABEL[upper(src.sanctionClass)] || POLICY_LABEL.CONDUCT,
      behaviorKind: behaviorKindLabel(src.currentSanctionBehaviorKey || src.behaviorKey),
      reasonCode: src.currentSanctionReasonCode || src.reasonCode || null,
      startsAt: src.currentSanctionStartsAt || src.startsAt || null,
      endsAt: src.currentSanctionEndsAt || src.endsAt || null,
      permanent: !!(src.currentSanctionPermanent || src.permanent),
      status: src.currentSanctionStatus || src.status || null,
      pendingPermanentReview: !!src.pendingPermanentReview,
      appealAvailable: appeal,
      inquiryAvailable: inquiryOnlyType(type) || appeal,
      userMessage: userMessageFor(type, src),
      operatorMemo: undefined,
    };
  }

  function allowedOperatorActions(input) {
    var src = input || {};
    var actions = [
      OPERATOR_ACTION.NONE,
      OPERATOR_ACTION.WARNING,
      OPERATOR_ACTION.FINAL_WARNING,
      OPERATOR_ACTION.WRITE_RESTRICT_24H,
      OPERATOR_ACTION.ACCOUNT_RESTRICT_7D,
      OPERATOR_ACTION.ACCOUNT_RESTRICT_30D,
      OPERATOR_ACTION.TEMP_SUSPEND,
      OPERATOR_ACTION.PERMANENT_BAN,
    ];
    if (canSelectAlien(src.sanctionClass, src.ladder, src.severeCode, src.massHarm)) {
      actions.splice(3, 0, OPERATOR_ACTION.ALIEN_TRANSFER);
    }
    return actions;
  }

  function countConfirmedByClass(reports, options) {
    if (!reviewCore || typeof reviewCore.groupReportsByBehavior !== 'function') {
      return { count: 0, behaviors: [] };
    }
    var opts = options || {};
    var want = upper(opts.sanctionClass);
    var targetUserId = String(opts.targetUserId || '');
    var cycleStartAt = opts.cycleStartAt ? new Date(opts.cycleStartAt).getTime() : 0;
    if (isNaN(cycleStartAt)) cycleStartAt = 0;
    var groups = reviewCore.groupReportsByBehavior(reports);
    var counted = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (targetUserId && String(g.targetAuthorUserId || '') !== targetUserId) continue;
      var confirmed = (g.reports || []).filter(reviewCore.isConfirmedViolation);
      if (!confirmed.length) continue;
      var confirmedCounts = {};
      for (var c = 0; c < confirmed.length; c++) {
        var cr = String((confirmed[c] && (confirmed[c].reasonCode || confirmed[c].reason_code)) || '').trim().toLowerCase();
        if (cr) confirmedCounts[cr] = (confirmedCounts[cr] || 0) + 1;
      }
      var primary = reviewCore.pickPrimaryReason(confirmedCounts);
      if (upper(reviewCore.classifySanctionClass(primary)) !== want) continue;
      var earliest = confirmed.reduce(function (min, row) {
        var raw = row && (row.createdAt || row.created_at);
        var t = raw ? new Date(raw).getTime() : 0;
        if (isNaN(t)) t = 0;
        return min === 0 || (t && t < min) ? t : min;
      }, 0);
      if (cycleStartAt && earliest && earliest < cycleStartAt) continue;
      counted.push(g);
    }
    return { count: counted.length, behaviors: counted };
  }

  return {
    SANCTION_TYPE: SANCTION_TYPE,
    SANCTION_STATUS: SANCTION_STATUS,
    LADDER: LADDER,
    ACTION_KIND: ACTION_KIND,
    APPEAL_DECISION: APPEAL_DECISION,
    SEVERE_CODE: SEVERE_CODE,
    OPERATOR_ACTION: OPERATOR_ACTION,
    USER_MESSAGES: USER_MESSAGES,
    POLITICAL_KEYS: POLITICAL_KEYS,
    clone: clone,
    stripPolitical: stripPolitical,
    hasPoliticalInput: hasPoliticalInput,
    isSanctionType: isSanctionType,
    isSevereCode: isSevereCode,
    isOperatorAction: isOperatorAction,
    canSelectAlien: canSelectAlien,
    durationMsFor: durationMsFor,
    canAppealType: canAppealType,
    inquiryOnlyType: inquiryOnlyType,
    eventTypeFor: eventTypeFor,
    recommendEarthConduct: recommendEarthConduct,
    recommendAlienConduct: recommendAlienConduct,
    recommendServiceHarm: recommendServiceHarm,
    resolveRecommended: resolveRecommended,
    resolveChosen: resolveChosen,
    buildSchedule: buildSchedule,
    isActiveRecord: isActiveRecord,
    activeType: activeType,
    assertAllows: assertAllows,
    toPublicNotice: toPublicNotice,
    allowedOperatorActions: allowedOperatorActions,
    countConfirmedByClass: countConfirmedByClass,
  };
});
