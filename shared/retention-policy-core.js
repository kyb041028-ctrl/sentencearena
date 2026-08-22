/**
 * SentenceArena 보관정책 코어.
 * 정치성향 미저장. 권리침해 요청은 별도 시스템(정식 사건 5년, 비정식 접수 1년).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RetentionPolicyCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function retentionPolicyCoreFactory() {
  'use strict';

  var POLITICAL_KEYS = Object.freeze([
    'alignmentScore',
    'alignment_score',
    'planetPct',
    'progressivePct',
    'conservativePct',
    'centerPct',
    'xp',
    'level',
    'achievements',
  ]);

  var CONTENT_KIND = Object.freeze({
    POST: 'POST',
    COMMENT: 'COMMENT',
  });

  var DELETE_REASON = Object.freeze({
    USER_DELETE: 'USER_DELETE',
  });

  var FINAL_REPORT_STATUSES = Object.freeze(['ACCEPTED', 'REJECTED', 'RESOLVED']);
  var PENDING_REPORT_STATUSES = Object.freeze(['SUBMITTED', 'REVIEWING']);

  var POLICY_COPY = Object.freeze({
    DELETED_CONTENT:
      '회원이 삭제한 게시글 및 댓글은 서비스 화면에서 즉시 삭제되며, 분쟁 해결, 권리침해 대응 및 부정이용 확인을 위해 필요한 최소 정보와 함께 삭제일로부터 6개월간 별도로 보관한 후 파기한다.',
    REPORTS:
      '커뮤니티 신고 및 처리 기록은 최종 처리일로부터 1년간 보관 후 파기한다.',
    SANCTIONS:
      '서비스 운영정책 위반에 따른 제재 기록은 제재 종료 후 1년간 보관할 수 있다.',
    RIGHTS:
      '명예훼손, 개인정보·사생활 침해, 저작권·초상권 등 정식 권리침해 신고 및 처리 기록은 최종 처리일로부터 5년간 보관한다.',
    PERMANENT_BAN_WITHDRAW:
      '영구 이용제한 사용자가 탈퇴한 경우 제재 회피 및 재가입 방지를 위해 필요한 최소 식별정보와 제재 기록을 탈퇴 후 1년간 별도로 보관할 수 있다.',
    LEGAL_HOLD:
      '수사기관 또는 법원의 적법한 요청 등 법령상 보전이 필요한 경우에는 해당 요청에 필요한 기간 동안 관련 자료의 파기를 유예할 수 있다.',
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
    delete row.ip;
    delete row.ipAddress;
    delete row.userAgent;
    delete row.device;
    delete row.oauth;
    delete row.email;
    delete row.rawEmail;
    return row;
  }

  function addUtcMonths(iso, months) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) d = new Date();
    d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
    return d.toISOString();
  }

  function addUtcYears(iso, years) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + Number(years || 0));
    return d.toISOString();
  }

  function isFinalReportStatus(status) {
    return FINAL_REPORT_STATUSES.indexOf(upper(status)) !== -1;
  }

  function isPendingReportStatus(status) {
    return PENDING_REPORT_STATUSES.indexOf(upper(status)) !== -1;
  }

  function deletedContentRetentionUntil(deletedAt) {
    return addUtcMonths(deletedAt || new Date().toISOString(), 6);
  }

  function reportRetentionUntil(finalizedAt) {
    return addUtcYears(finalizedAt || new Date().toISOString(), 1);
  }

  function sanctionRetentionUntil(endedAt) {
    return addUtcYears(endedAt || new Date().toISOString(), 1);
  }

  function bannedRejoinRetentionUntil(withdrawnAt) {
    return addUtcYears(withdrawnAt || new Date().toISOString(), 1);
  }

  function laterIso(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
  }

  function shouldPurge(row, nowIso) {
    var src = row || {};
    if (src.legalHold === true || src.legal_hold === true) return false;
    var until = src.retentionUntil || src.retention_until;
    if (!until) return false;
    var now = nowIso ? new Date(nowIso).getTime() : Date.now();
    var t = new Date(until).getTime();
    if (isNaN(t)) return false;
    return t <= now;
  }

  function reportReviewPatch(status, nowIso, existing) {
    var prev = existing || {};
    if (prev.legalHold || prev.legal_hold) {
      return {
        finalizedAt: isFinalReportStatus(status) ? (nowIso || new Date().toISOString()) : null,
        retentionUntil: null,
        legalHold: true,
      };
    }
    if (isFinalReportStatus(status)) {
      var finalized = nowIso || new Date().toISOString();
      return {
        finalizedAt: finalized,
        retentionUntil: reportRetentionUntil(finalized),
        legalHold: false,
      };
    }
    if (isPendingReportStatus(status)) {
      return {
        finalizedAt: null,
        retentionUntil: null,
        legalHold: false,
      };
    }
    return {
      finalizedAt: prev.finalizedAt || prev.finalized_at || null,
      retentionUntil: prev.retentionUntil || prev.retention_until || null,
      legalHold: false,
    };
  }

  function buildDeletedEvidence(input) {
    var src = stripPolitical(input || {});
    var deletedAt = src.deletedAt || new Date().toISOString();
    var kind = upper(src.contentKind || src.kind);
    if (kind !== CONTENT_KIND.POST && kind !== CONTENT_KIND.COMMENT) {
      return { ok: false, error: 'CONTENT_KIND_INVALID' };
    }
    if (!src.sourceContentId) return { ok: false, error: 'SOURCE_CONTENT_ID_REQUIRED' };
    return {
      ok: true,
      row: {
        contentKind: kind,
        sourceContentId: String(src.sourceContentId),
        body: src.body == null ? '' : String(src.body),
        title: kind === CONTENT_KIND.POST ? (src.title == null ? '' : String(src.title)) : null,
        createdAt: src.createdAt || null,
        deletedAt: deletedAt,
        deleteReason: src.deleteReason || DELETE_REASON.USER_DELETE,
        authorUserId: src.authorUserId || null,
        authorDisplayName: src.authorDisplayName ? String(src.authorDisplayName).slice(0, 80) : null,
        retentionUntil: deletedContentRetentionUntil(deletedAt),
        legalHold: !!src.legalHold,
        legalHoldReason: src.legalHold ? (src.legalHoldReason || null) : null,
      },
    };
  }

  function buildBannedRejoinRecord(input) {
    var src = stripPolitical(input || {});
    if (upper(src.sanctionType) !== 'PERMANENT_BAN') {
      return { ok: false, error: 'NOT_PERMANENT_BAN' };
    }
    if (!src.identityHash) return { ok: false, error: 'IDENTITY_HASH_REQUIRED' };
    var withdrawnAt = src.withdrawnAt || new Date().toISOString();
    return {
      ok: true,
      row: {
        identityHash: String(src.identityHash),
        identityKind: src.identityKind || 'UID',
        sanctionType: 'PERMANENT_BAN',
        bannedAt: src.bannedAt || withdrawnAt,
        reasonCode: src.reasonCode || null,
        withdrawnAt: withdrawnAt,
        retentionUntil: bannedRejoinRetentionUntil(withdrawnAt),
        legalHold: !!src.legalHold,
      },
    };
  }

  function buildSanctionRecord(input) {
    var src = stripPolitical(input || {});
    var type = upper(src.sanctionType);
    if (!type || type === 'NONE') return { ok: false, error: 'SANCTION_TYPE_REQUIRED' };
    var permanent = !!src.permanent || type === 'PERMANENT_BAN';
    var endsAt = src.endsAt || null;
    var retentionUntil = null;
    if (!permanent && endsAt) retentionUntil = sanctionRetentionUntil(endsAt);
    return {
      ok: true,
      row: {
        userId: src.userId || null,
        sanctionType: type,
        startsAt: src.startsAt || null,
        endsAt: endsAt,
        permanent: permanent,
        reasonCode: src.reasonCode || null,
        retentionUntil: retentionUntil,
        legalHold: !!src.legalHold,
      },
    };
  }

  function maxRetention(currentUntil, candidateUntil) {
    return laterIso(currentUntil, candidateUntil);
  }

  return {
    POLITICAL_KEYS: POLITICAL_KEYS,
    CONTENT_KIND: CONTENT_KIND,
    DELETE_REASON: DELETE_REASON,
    FINAL_REPORT_STATUSES: FINAL_REPORT_STATUSES,
    PENDING_REPORT_STATUSES: PENDING_REPORT_STATUSES,
    POLICY_COPY: POLICY_COPY,
    RIGHTS_RETENTION_YEARS: 5,
    clone: clone,
    stripPolitical: stripPolitical,
    hasPoliticalInput: hasPoliticalInput,
    addUtcMonths: addUtcMonths,
    addUtcYears: addUtcYears,
    isFinalReportStatus: isFinalReportStatus,
    isPendingReportStatus: isPendingReportStatus,
    deletedContentRetentionUntil: deletedContentRetentionUntil,
    reportRetentionUntil: reportRetentionUntil,
    sanctionRetentionUntil: sanctionRetentionUntil,
    bannedRejoinRetentionUntil: bannedRejoinRetentionUntil,
    shouldPurge: shouldPurge,
    reportReviewPatch: reportReviewPatch,
    buildDeletedEvidence: buildDeletedEvidence,
    buildBannedRejoinRecord: buildBannedRejoinRecord,
    buildSanctionRecord: buildSanctionRecord,
    maxRetention: maxRetention,
  };
});
