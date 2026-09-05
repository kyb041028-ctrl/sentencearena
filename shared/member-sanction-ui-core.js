/**
 * 회원 제재/이의제기 화면용 표시 헬퍼.
 * 서버 제재 규칙·사다리는 변경하지 않는다. 기존 sanction type 이름만 라벨로 쓴다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MemberSanctionUiCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function memberSanctionUiCoreFactory() {
  'use strict';

  var TYPE_LABEL = Object.freeze({
    NONE: '제재 없음',
    WARNING: '경고',
    FINAL_WARNING: '최종 경고',
    ALIEN_TRANSFER: '외계행성 조건',
    WRITE_RESTRICT_24H: '24시간 작성 제한',
    ACCOUNT_RESTRICT_7D: '7일 제한',
    ACCOUNT_RESTRICT_30D: '30일 제한',
    TEMP_SUSPEND: '임시 활동중지',
    PERMANENT_BAN: '영구정지',
    PERMANENT_REVIEW: '영구정지 검토',
  });

  var STATUS_LABEL = Object.freeze({
    ACTIVE: '적용 중',
    EXPIRED: '만료',
    RELEASED: '해제',
    PENDING_REVIEW: '검토 중',
    SUBMITTED: '처리 중',
    UPHELD: '유지',
    SHORTENED: '기간 단축',
  });

  var HIDDEN_KEYS = Object.freeze([
    'decidedBy',
    'operatorMemo',
    'operatorUserId',
    'operatorNotes',
    'email',
    'app_metadata',
    'user_metadata',
    'reputation_score',
    'reputationScore',
    'alignmentScore',
    'politicalScore',
    'oauth',
  ]);

  function upper(v) {
    return String(v || '').trim().toUpperCase();
  }

  function typeLabel(type) {
    var t = upper(type);
    return TYPE_LABEL[t] || t || TYPE_LABEL.NONE;
  }

  function statusLabel(status) {
    var s = upper(status);
    return STATUS_LABEL[s] || s || '';
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch (_) {
      return String(iso);
    }
  }

  function isExpiredNotice(notice, nowMs) {
    var src = notice || {};
    var st = upper(src.status);
    if (st === 'EXPIRED' || st === 'RELEASED') return true;
    if (src.permanent) return false;
    if (!src.endsAt) return false;
    var t = new Date(src.endsAt).getTime();
    if (isNaN(t)) return false;
    return t <= (nowMs || Date.now());
  }

  function isActiveRestriction(notice, nowMs) {
    var src = notice || {};
    var type = upper(src.sanctionType || src.currentSanctionType);
    if (
      !type ||
      type === 'NONE' ||
      type === 'WARNING' ||
      type === 'FINAL_WARNING' ||
      type === 'ALIEN_TRANSFER' ||
      type === 'PERMANENT_REVIEW'
    ) {
      return false;
    }
    if (isExpiredNotice(src, nowMs)) return false;
    if (src.permanent || type === 'PERMANENT_BAN' || type === 'TEMP_SUSPEND') return true;
    if (src.endsAt) return !isExpiredNotice(src, nowMs);
    return upper(src.status) === 'ACTIVE';
  }

  function isCurrentNotice(notice, nowMs) {
    var src = notice || {};
    var type = upper(src.sanctionType);
    if (!type || type === 'NONE') return false;
    return !isExpiredNotice(src, nowMs);
  }

  function hasOpenAppeal(appeals, sanctionType) {
    var want = upper(sanctionType);
    return (appeals || []).some(function (a) {
      return upper(a && a.sanctionType) === want && upper(a && a.status) === 'SUBMITTED';
    });
  }

  function canSubmitAppeal(notice, appeals) {
    var src = notice || {};
    if (src.appealAvailable !== true) return false;
    if (isExpiredNotice(src)) return false;
    return !hasOpenAppeal(appeals, src.sanctionType);
  }

  function sanitizePublic(src) {
    var row = src ? JSON.parse(JSON.stringify(src)) : {};
    var i;
    for (i = 0; i < HIDDEN_KEYS.length; i++) {
      delete row[HIDDEN_KEYS[i]];
    }
    delete row.userId;
    delete row.id;
    delete row.behaviorKey;
    delete row.currentSanctionBehaviorKey;
    return row;
  }

  function containsHiddenPayload(obj) {
    var raw = JSON.stringify(obj || {});
    var hits = [];
    HIDDEN_KEYS.forEach(function (key) {
      if (raw.indexOf(key) !== -1) hits.push(key);
    });
    return hits;
  }

  return {
    TYPE_LABEL: TYPE_LABEL,
    STATUS_LABEL: STATUS_LABEL,
    HIDDEN_KEYS: HIDDEN_KEYS,
    typeLabel: typeLabel,
    statusLabel: statusLabel,
    formatDateTime: formatDateTime,
    isExpiredNotice: isExpiredNotice,
    isActiveRestriction: isActiveRestriction,
    isCurrentNotice: isCurrentNotice,
    hasOpenAppeal: hasOpenAppeal,
    canSubmitAppeal: canSubmitAppeal,
    sanitizePublic: sanitizePublic,
    containsHiddenPayload: containsHiddenPayload,
  };
});
