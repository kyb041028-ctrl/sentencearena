/**
 * 일반 신고 중 misinfo(허위정보)만 보강.
 * 의견/평가/예측/풍자는 자동 허위정보로 확정하지 않는다.
 * 정치성향 미저장. 접수만으로 삭제·제재·Alien 횟수 없음.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MisinfoReportCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function misinfoReportCoreFactory() {
  'use strict';

  var PREFIX = 'SC_MISINFO_V1:';
  var REASON_CODE = 'misinfo';
  var DETAIL_MAX = 8000;

  var CLAIM_KIND = Object.freeze({
    FACT: 'FACT',
    OPINION: 'OPINION',
    PREDICTION: 'PREDICTION',
    SATIRE: 'SATIRE',
    UNKNOWN: 'UNKNOWN',
  });

  var EXTERNAL_CHECK = Object.freeze({
    NONE: 'NONE',
    IN_PROGRESS: 'IN_PROGRESS',
    DECIDED: 'DECIDED',
  });

  var OPERATOR_DECISION = Object.freeze({
    INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
    NOT_APPLICABLE: 'NOT_APPLICABLE',
    NEEDS_MORE_INFO: 'NEEDS_MORE_INFO',
    CONFIRMED: 'CONFIRMED',
  });

  var DECISION_TO_STATUS = Object.freeze({
    INSUFFICIENT_EVIDENCE: 'REJECTED',
    NOT_APPLICABLE: 'REJECTED',
    NEEDS_MORE_INFO: 'REVIEWING',
    CONFIRMED: 'ACCEPTED',
  });

  var DECISION_NOTE = Object.freeze({
    INSUFFICIENT_EVIDENCE: 'MISINFO_INSUFFICIENT_EVIDENCE',
    NOT_APPLICABLE: 'MISINFO_NOT_APPLICABLE',
    NEEDS_MORE_INFO: 'MISINFO_NEEDS_MORE_INFO',
    CONFIRMED: 'MISINFO_CONFIRMED',
  });

  var ABUSE_ACTION = Object.freeze({
    WARNING: 'WARNING',
    RESTRICT_30D: 'RESTRICT_30D',
    RESTRICT_6M: 'RESTRICT_6M',
    SANCTION_REVIEW: 'SANCTION_REVIEW',
  });

  var ABUSE_RESTRICTION = Object.freeze({
    NONE: 'NONE',
    DAYS_30: 'DAYS_30',
    MONTHS_6: 'MONTHS_6',
  });

  var MIN = Object.freeze({
    excerpt: 10,
    falsehoodReason: 50,
    evidenceNote: 30,
    evidenceUrl: 12,
    externalOrg: 2,
    appeal: 20,
  });

  var WEAK_PHRASES = Object.freeze([
    '거짓입니다',
    '가짜뉴스',
    '구라임',
    '삭제해주세요',
    '인터넷에서봤음',
    '다들알고있음',
    '내생각에는',
  ]);

  var NOTICE_TITLE = '허위정보 신고 안내';
  var NOTICE_BODY =
    '허위정보 신고는 사실로 확인할 수 있는 구체적인 내용이 허위이거나 조작되었다고 판단되는 경우 사용하는 신고입니다.\n\n' +
    '정치적 의견 차이, 정책에 대한 찬반, 가치판단, 비판, 예측이나 추정, 풍자·패러디라는 이유만으로는 허위정보 신고 대상이 아닙니다.\n\n' +
    '신고하려는 정확한 표현과 허위라고 판단하는 구체적인 이유, 확인 가능한 근거를 작성해주세요.';

  var NON_FACT_HINT =
    '이 유형은 원칙적으로 허위정보 판단 대상이 아닙니다. 구체적으로 확인 가능한 사실 주장이 포함되어 있다면 그 부분을 정확히 지정해주세요.';

  var RIGHTS_HINT =
    '본인의 명예·개인정보 등 직접적인 권리침해에 대한 게시중단 요청이 필요한 경우 권리침해 처리 요청 절차를 이용할 수 있습니다.';

  var OPERATOR_CRITERIA = Object.freeze([
    '실제로 확인 가능한 사실 주장인가',
    '내용의 전부 또는 핵심 부분이 객관적 자료와 명확하게 다른가',
    '단순한 실수나 사소한 오류가 아니라 전체 메시지 이해에 실질적인 영향을 주는가',
    '작성자가 허위 또는 조작이라는 사실을 알면서도 피해를 주거나 부당한 이익을 얻을 목적으로 유포했다고 볼 근거가 있는가',
    '타인의 권리 또는 공공의 이익에 실제 침해 위험이 있는가',
  ]);

  var EVIDENCE_PRIORITY = Object.freeze([
    '정부·공공기관 공식 자료',
    '공식 통계·공식 기록',
    '학술적으로 검증된 자료',
    '공신력 있는 확인기관의 판단',
    '여러 신뢰할 수 있는 언론사의 교차 확인',
    '출처와 이해관계가 명확한 전문가 의견',
  ]);

  var EVIDENCE_CAUTION =
    '익명 글 하나, 출처 불명의 캡처, 한 사람의 주장, 상업적 이해관계가 있는 자료만으로 허위정보를 확정하지 않는다.';

  var NOT_AUTO_MISINFO = Object.freeze([
    '객관적 사실에 기반한 주관적 평가',
    '가치판단',
    '정치적 의견',
    '논리적 해석',
    '정책 찬반',
    '미래 예측',
    '추정',
    '풍자',
    '패러디',
    '창작물임이 명확한 허구',
    '사실관계가 아직 확정되지 않은 논쟁적 사안',
    '핵심 의미에 영향을 주지 않는 사소한 오류',
    '허위정보를 비판하거나 반박하기 위해 인용한 내용',
  ]);

  function trimText(v) {
    return String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
  }

  function compact(v) {
    return trimText(v).replace(/\s+/g, '');
  }

  function meaningfulLen(v) {
    return compact(v).length;
  }

  function upper(v) {
    return String(v || '').trim().toUpperCase();
  }

  function isWeak(v) {
    var c = compact(v);
    if (!c) return true;
    for (var i = 0; i < WEAK_PHRASES.length; i++) {
      if (c === compact(WEAK_PHRASES[i]) || c === WEAK_PHRASES[i]) return true;
    }
    return false;
  }

  function isHttpUrl(v) {
    var s = trimText(v);
    if (s.length < MIN.evidenceUrl) return false;
    return /^https?:\/\/[^\s]+\.[^\s]+/i.test(s);
  }

  function parseEncoded(detail) {
    var raw = String(detail || '');
    if (raw.indexOf(PREFIX) !== 0) return null;
    try {
      var parsed = JSON.parse(raw.slice(PREFIX.length));
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function readInput(input) {
    var src = input || {};
    var fromJson = parseEncoded(src.reasonDetail);
    var packed = fromJson || {};
    function pick(field, alt) {
      if (src[field] != null && String(src[field]).length) return src[field];
      if (packed[alt] != null) return packed[alt];
      return '';
    }
    return {
      claimKind: upper(pick('misinfoClaimKind', 'claimKind') || packed.claimKind),
      excerpt: trimText(pick('misinfoExcerpt', 'excerpt')),
      falsehoodReason: trimText(pick('misinfoFalsehoodReason', 'falsehoodReason')),
      evidenceUrl: trimText(pick('misinfoEvidenceUrl', 'evidenceUrl')),
      evidenceNote: trimText(pick('misinfoEvidenceNote', 'evidenceNote')),
      externalCheck: upper(pick('misinfoExternalCheck', 'externalCheck') || EXTERNAL_CHECK.NONE),
      externalOrg: trimText(pick('misinfoExternalOrg', 'externalOrg')),
      externalEvidence: trimText(pick('misinfoExternalEvidence', 'externalEvidence')),
    };
  }

  function normalizePayload(raw) {
    var src = raw || {};
    var kind = upper(src.claimKind);
    if (!CLAIM_KIND[kind]) kind = '';
    var ext = upper(src.externalCheck);
    if (!EXTERNAL_CHECK[ext]) ext = EXTERNAL_CHECK.NONE;
    return {
      v: 1,
      claimKind: kind,
      excerpt: trimText(src.excerpt).slice(0, 500),
      falsehoodReason: trimText(src.falsehoodReason).slice(0, 2000),
      evidenceUrl: trimText(src.evidenceUrl).slice(0, 500),
      evidenceNote: trimText(src.evidenceNote).slice(0, 2000),
      externalCheck: ext,
      externalOrg: trimText(src.externalOrg).slice(0, 200),
      externalEvidence: trimText(src.externalEvidence).slice(0, 500),
    };
  }

  function hasObjectiveEvidence(payload) {
    var src = payload || {};
    if (isHttpUrl(src.evidenceUrl)) return true;
    if (meaningfulLen(src.evidenceNote) >= MIN.evidenceNote && !isWeak(src.evidenceNote)) return true;
    return false;
  }

  function validatePayload(input) {
    var errors = [];
    var payload = normalizePayload(readInput(input));
    if (!payload.claimKind) errors.push('MISINFO_CLAIM_KIND_REQUIRED');
    if (meaningfulLen(payload.excerpt) < 1) errors.push('MISINFO_EXCERPT_REQUIRED');
    else if (meaningfulLen(payload.excerpt) < MIN.excerpt) errors.push('MISINFO_EXCERPT_TOO_SHORT');
    else if (isWeak(payload.excerpt)) errors.push('MISINFO_EXCERPT_TOO_WEAK');
    if (meaningfulLen(payload.falsehoodReason) < 1) errors.push('MISINFO_REASON_REQUIRED');
    else if (meaningfulLen(payload.falsehoodReason) < MIN.falsehoodReason) errors.push('MISINFO_REASON_TOO_SHORT');
    else if (isWeak(payload.falsehoodReason)) errors.push('MISINFO_REASON_TOO_WEAK');
    if (!hasObjectiveEvidence(payload)) errors.push('MISINFO_EVIDENCE_REQUIRED');
    if (payload.externalCheck === EXTERNAL_CHECK.IN_PROGRESS || payload.externalCheck === EXTERNAL_CHECK.DECIDED) {
      if (meaningfulLen(payload.externalOrg) < MIN.externalOrg) errors.push('MISINFO_EXTERNAL_ORG_REQUIRED');
    }
    if (JSON.stringify(payload).length > DETAIL_MAX) errors.push('BOARD_REPORT_DETAIL_TOO_LONG');
    return {
      ok: errors.length === 0,
      errors: errors,
      payload: payload,
    };
  }

  function encodePayload(payload) {
    return PREFIX + JSON.stringify(normalizePayload(payload));
  }

  function packFromInput(input) {
    var check = validatePayload(input);
    if (!check.ok) return check;
    return {
      ok: true,
      errors: [],
      payload: check.payload,
      encoded: encodePayload(check.payload),
    };
  }

  function isPendingStatus(status) {
    var s = upper(status);
    return s === 'SUBMITTED' || s === 'REVIEWING';
  }

  function isFinalStatus(status) {
    var s = upper(status);
    return s === 'ACCEPTED' || s === 'REJECTED' || s === 'RESOLVED';
  }

  function evidenceKey(payload) {
    var src = payload || {};
    return trimText(src.evidenceUrl).toLowerCase() + '|' + compact(src.evidenceNote);
  }

  function hasNewEvidence(previousDetail, nextInput) {
    var prev = parseEncoded(previousDetail) || {};
    var next = normalizePayload(readInput(nextInput));
    if (!hasObjectiveEvidence(next)) return false;
    return evidenceKey(prev) !== evidenceKey(next);
  }

  function canResubmitMisinfo(previousRow, nextInput) {
    var prev = previousRow || {};
    if (String(prev.reasonCode || '').toLowerCase() !== REASON_CODE) return false;
    if (isPendingStatus(prev.status)) return false;
    if (!isFinalStatus(prev.status)) return false;
    return hasNewEvidence(prev.reasonDetail, nextInput);
  }

  function operatorNote(decision, extra) {
    var code = DECISION_NOTE[upper(decision)] || '';
    var src = extra || {};
    var parts = [code];
    if (src.electionRelated) parts.push('electionRelated=1');
    if (trimText(src.agencyNote)) parts.push('agency=' + trimText(src.agencyNote).slice(0, 200));
    if (trimText(src.note)) parts.push(trimText(src.note).slice(0, 500));
    return parts.filter(Boolean).join(' | ');
  }

  function restrictionUntil(kind, nowIso) {
    var k = upper(kind);
    var start = nowIso ? new Date(nowIso).getTime() : Date.now();
    if (isNaN(start)) start = Date.now();
    if (k === ABUSE_RESTRICTION.DAYS_30) return new Date(start + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (k === ABUSE_RESTRICTION.MONTHS_6) return new Date(start + 182 * 24 * 60 * 60 * 1000).toISOString();
    return null;
  }

  function isRestrictionActive(row, nowIso) {
    var src = row || {};
    if (upper(src.restrictionKind) === ABUSE_RESTRICTION.NONE || !src.restrictionKind) return false;
    if (!src.restrictedUntil) return false;
    var until = new Date(src.restrictedUntil).getTime();
    var now = nowIso ? new Date(nowIso).getTime() : Date.now();
    if (isNaN(until) || isNaN(now)) return false;
    return until > now;
  }

  function publicRestrictionNotice(row) {
    var src = row || {};
    if (!isRestrictionActive(src)) {
      return {
        restricted: false,
        restrictionKind: ABUSE_RESTRICTION.NONE,
        restrictedUntil: null,
        reason: null,
        appealAvailable: false,
      };
    }
    return {
      restricted: true,
      restrictionKind: src.restrictionKind,
      restrictedUntil: src.restrictedUntil,
      reason: src.noticeReason || null,
      appealAvailable: upper(src.appealStatus) !== 'SUBMITTED',
      operatorMemo: undefined,
    };
  }

  function emptyAbuseState(userId) {
    return {
      userId: userId,
      warningCount: 0,
      restrictionKind: ABUSE_RESTRICTION.NONE,
      restrictedUntil: null,
      noticeReason: null,
      appealStatus: null,
      appealBody: null,
      appealReply: null,
      updatedAt: null,
    };
  }

  return {
    PREFIX: PREFIX,
    REASON_CODE: REASON_CODE,
    DETAIL_MAX: DETAIL_MAX,
    CLAIM_KIND: CLAIM_KIND,
    EXTERNAL_CHECK: EXTERNAL_CHECK,
    OPERATOR_DECISION: OPERATOR_DECISION,
    DECISION_TO_STATUS: DECISION_TO_STATUS,
    DECISION_NOTE: DECISION_NOTE,
    ABUSE_ACTION: ABUSE_ACTION,
    ABUSE_RESTRICTION: ABUSE_RESTRICTION,
    MIN: MIN,
    NOTICE_TITLE: NOTICE_TITLE,
    NOTICE_BODY: NOTICE_BODY,
    NON_FACT_HINT: NON_FACT_HINT,
    RIGHTS_HINT: RIGHTS_HINT,
    OPERATOR_CRITERIA: OPERATOR_CRITERIA,
    EVIDENCE_PRIORITY: EVIDENCE_PRIORITY,
    EVIDENCE_CAUTION: EVIDENCE_CAUTION,
    NOT_AUTO_MISINFO: NOT_AUTO_MISINFO,
    trimText: trimText,
    meaningfulLen: meaningfulLen,
    isWeak: isWeak,
    isHttpUrl: isHttpUrl,
    parseEncoded: parseEncoded,
    validatePayload: validatePayload,
    encodePayload: encodePayload,
    packFromInput: packFromInput,
    hasNewEvidence: hasNewEvidence,
    canResubmitMisinfo: canResubmitMisinfo,
    isPendingStatus: isPendingStatus,
    operatorNote: operatorNote,
    restrictionUntil: restrictionUntil,
    isRestrictionActive: isRestrictionActive,
    publicRestrictionNotice: publicRestrictionNotice,
    emptyAbuseState: emptyAbuseState,
  };
});
