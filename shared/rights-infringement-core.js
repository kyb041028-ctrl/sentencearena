/**
 * SentenceArena 권리침해 처리 요청 코어.
 * 일반 신고(board_reports)와 분리. 정치성향 미저장.
 * 접수만으로 정식 사건·게시삭제·회원제재를 만들지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RightsInfringementCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function rightsInfringementCoreFactory() {
  'use strict';

  var STATUS = Object.freeze({
    RECEIVED: 'RECEIVED',
    NEEDS_SUPPLEMENT: 'NEEDS_SUPPLEMENT',
    INTAKE_REJECTED: 'INTAKE_REJECTED',
    FORMAL_CASE: 'FORMAL_CASE',
    IN_REVIEW: 'IN_REVIEW',
    TEMP_TAKEDOWN: 'TEMP_TAKEDOWN',
    AUTHOR_OBJECTED: 'AUTHOR_OBJECTED',
    COMPLETED: 'COMPLETED',
  });

  var STATUS_LABEL = Object.freeze({
    RECEIVED: '접수됨',
    NEEDS_SUPPLEMENT: '보완 필요',
    INTAKE_REJECTED: '접수 반려',
    FORMAL_CASE: '정식 사건 전환',
    IN_REVIEW: '처리 중',
    TEMP_TAKEDOWN: '임시 게시중단',
    AUTHOR_OBJECTED: '작성자 이의제기',
    COMPLETED: '처리 완료',
  });

  var CLAIM_TYPE = Object.freeze({
    DEFAMATION: 'DEFAMATION',
    PRIVACY: 'PRIVACY',
    LIKENESS: 'LIKENESS',
    COPYRIGHT: 'COPYRIGHT',
    OTHER_RIGHTS: 'OTHER_RIGHTS',
  });

  var CLAIM_TYPE_LABEL = Object.freeze({
    DEFAMATION: '명예훼손',
    PRIVACY: '개인정보·사생활 침해',
    LIKENESS: '사진·영상·초상 관련 권리침해',
    COPYRIGHT: '저작권 침해',
    OTHER_RIGHTS: '기타 권리침해',
  });

  var CLAIMANT_KIND = Object.freeze({
    SELF: 'SELF',
    ORGANIZATION: 'ORGANIZATION',
    AGENT: 'AGENT',
  });

  var CLAIMANT_KIND_LABEL = Object.freeze({
    SELF: '내 권리가 침해됨',
    ORGANIZATION: '회사/단체의 권리를 대표하여 신청',
    AGENT: '권리자의 정당한 대리인',
  });

  var TARGET_KIND = Object.freeze({
    POST: 'POST',
    COMMENT: 'COMMENT',
    DELETED_UNKNOWN: 'DELETED_UNKNOWN',
  });

  var REQUESTED_ACTION = Object.freeze({
    HIDE: 'HIDE',
    DELETE: 'DELETE',
    CORRECTION: 'CORRECTION',
    OTHER: 'OTHER',
  });

  var OPERATOR_ACTION = Object.freeze({
    REQUEST_SUPPLEMENT: 'REQUEST_SUPPLEMENT',
    REJECT_INTAKE: 'REJECT_INTAKE',
    CONVERT_FORMAL: 'CONVERT_FORMAL',
    START_REVIEW: 'START_REVIEW',
    TEMP_TAKEDOWN: 'TEMP_TAKEDOWN',
    LIFT_TAKEDOWN: 'LIFT_TAKEDOWN',
    COMPLETE: 'COMPLETE',
    ABUSE_WARNING: 'ABUSE_WARNING',
    RESTRICT_30D: 'RESTRICT_30D',
    RESTRICT_6M: 'RESTRICT_6M',
    SANCTION_REVIEW: 'SANCTION_REVIEW',
    LINK_EVIDENCE: 'LINK_EVIDENCE',
  });

  var REJECTION_CODE = Object.freeze({
    TARGET_UNCLEAR: 'TARGET_UNCLEAR',
    RIGHTS_UNSUBSTANTIATED: 'RIGHTS_UNSUBSTANTIATED',
    EVIDENCE_INSUFFICIENT: 'EVIDENCE_INSUFFICIENT',
    POLITICAL_DISAGREEMENT: 'POLITICAL_DISAGREEMENT',
    MERE_DISCOMFORT: 'MERE_DISCOMFORT',
    REPEAT_SAME: 'REPEAT_SAME',
    SUSPECTED_FALSE_OR_MALICIOUS: 'SUSPECTED_FALSE_OR_MALICIOUS',
    NOT_RIGHTS_USE_GENERAL_REPORT: 'NOT_RIGHTS_USE_GENERAL_REPORT',
    OTHER: 'OTHER',
  });

  var REJECTION_CODE_LABEL = Object.freeze({
    TARGET_UNCLEAR: '대상이 분명하지 않습니다',
    RIGHTS_UNSUBSTANTIATED: '권리관계 소명이 부족합니다',
    EVIDENCE_INSUFFICIENT: '증빙자료가 부족합니다',
    POLITICAL_DISAGREEMENT: '단순 정치적 의견 충돌입니다',
    MERE_DISCOMFORT: '단순 불쾌감만으로는 권리침해 신청 대상이 아닙니다',
    REPEAT_SAME: '같은 내용의 반복 신청입니다',
    SUSPECTED_FALSE_OR_MALICIOUS: '허위 또는 악의적 신고로 의심됩니다',
    NOT_RIGHTS_USE_GENERAL_REPORT: '권리침해가 아니라 일반 신고로 다뤄야 하는 내용입니다',
    OTHER: '기타',
  });

  var TRIVIAL_PHRASES = Object.freeze([
    '기분나쁨',
    '기분나빠요',
    '기분나빠',
    '처벌해주세요',
    '처벌해줘',
    '저사람처벌해주세요',
    '신고합니다',
    '그냥싫어요',
    '정치적으로반대',
    '의견이다름',
  ]);

  var GUIDE_INTRO = Object.freeze([
    '이곳은 일반적인 의견 충돌을 신고하는 곳이 아닙니다. 욕설·도배·분쟁유도는 일반 신고를 이용해 주세요.',
    '정치적 반대, 비판, 불쾌감만으로는 권리침해 신청 대상이 아닙니다.',
    '신청자는 자신의 권리와 침해 사실을 구체적으로 소명해야 합니다.',
    '자료가 부족하면 접수가 반려될 수 있습니다.',
    '허위·악의적 반복 신고는 운영정책 위반으로 처리될 수 있습니다.',
    '신고가 접수되어도 상대에게 자동 제재가 적용되지 않습니다. 운영자가 자료를 보고 판단합니다.',
    '범죄 피해가 의심되면 수사기관 신고 등 별도 절차가 필요할 수 있습니다.',
  ]);

  var MASK_PII_NOTICE =
    '주민등록번호 등 불필요한 개인정보는 가려서 제출해 주세요. 신분증 전체 사본이나 주민등록번호는 받지 않습니다.';

  var GUEST_VERIFY_UNAVAILABLE_NOTICE =
    '현재 비회원 본인확인 기능은 준비 중입니다. 지금은 로그인한 회원이 권리침해 처리 요청을 접수할 수 있습니다.';

  var CONFIRM_TRUTH_TEXT = '제출하는 내용은 제가 알고 있는 범위에서 사실입니다.';
  var CONFIRM_NOT_MALICIOUS_TEXT = '허위이거나 보복·괴롭힘 목적의 신청이 아닙니다.';

  var ABUSE_RESTRICTION = Object.freeze({
    NONE: 'NONE',
    DAYS_30: 'DAYS_30',
    MONTHS_6: 'MONTHS_6',
  });

  var OBJECTION_GROUND = Object.freeze({
    FACT_BASED: 'FACT_BASED',
    PUBLIC_INTEREST: 'PUBLIC_INTEREST',
    POLITICAL_OPINION: 'POLITICAL_OPINION',
    LICENSE: 'LICENSE',
    CLAIM_FALSE: 'CLAIM_FALSE',
    OTHER: 'OTHER',
  });

  var HIGH_RISK_PRIVACY = Object.freeze([
    'ADDRESS',
    'PHONE',
    'SCHOOL',
    'WORKPLACE',
    'FAMILY',
    'ID_NUMBER',
  ]);

  var BLIND_REASON = 'RIGHTS_TEMP_TAKEDOWN';
  var TAKEDOWN_NOTICE =
    '권리침해 처리 요청으로 인해 현재 임시로 게시가 중단된 콘텐츠입니다.';
  var TAKEDOWN_MAX_DAYS = 30;
  var FORMAL_RETENTION_YEARS = 5;
  var INTAKE_RETENTION_YEARS = 1;

  var MIN = Object.freeze({
    name: 2,
    problemExcerpt: 10,
    claimedRight: 8,
    infringementReason: 50,
    caseNarrative: 50,
    requestedActionOther: 20,
    defamationStatement: 10,
    defamationTarget: 2,
    defamationFalsehood: 30,
    defamationHonor: 30,
    privacyInfo: 8,
    privacyWhose: 2,
    privacyLocation: 8,
    privacyBasis: 20,
    privacyHarm: 20,
    likenessWho: 2,
    likenessRelation: 8,
    likenessInfringement: 20,
    copyrightWork: 20,
    copyrightBasis: 30,
    copyrightSource: 8,
    copyrightPortion: 20,
    evidenceRequired: 20,
    evidenceDescription: 20,
    deletedPeriod: 4,
    deletedTitle: 2,
    deletedAuthor: 2,
    deletedBody: 20,
    deletedPhrase: 8,
    deletedDiscovered: 4,
    objection: 50,
    supplement: 20,
  });

  var ABUSE_NOTICE_TITLE = '권리침해 처리 요청 제도 악용 안내';
  var ABUSE_NOTICE_BODY =
    '권리침해 처리 요청은 본인 또는 정당한 권리자가 실제 권리침해에 대한 조치를 요청하기 위한 절차입니다.\n\n' +
    '단순한 정치적 의견 차이, 비판, 불쾌감만으로 게시물 삭제를 요구하는 절차가 아닙니다.\n\n' +
    '사실과 다르다는 것을 알면서 허위 내용을 제출하거나, 자료를 조작하거나, 특정 이용자를 괴롭히거나 표현을 막을 목적으로 반복 신청하거나, 동일한 요청을 새로운 근거 없이 반복하는 경우 권리침해 처리 요청 기능이 제한될 수 있습니다.\n\n' +
    '반복적이거나 중대한 악용이 확인되는 경우 SentenceArena 이용이 제한될 수 있습니다.';

  var CONFIRM_TEXT =
    '위 안내를 확인했으며, 제출하는 내용은 제가 알고 있는 범위에서 사실이고 권리침해 처리 목적으로 신청하는 것임을 확인합니다.';

  var POLITICAL_PROTECTION =
    '특정 정당·정치인·정부 비판, 정책 찬성/반대, 정치적 가치판단과 강한 평가 자체는 권리침해 사유가 아니다. 구체적인 사실 주장과 개인정보 공개는 별도로 검토한다.';

  var OPEN_STATUSES = Object.freeze([
    STATUS.RECEIVED,
    STATUS.NEEDS_SUPPLEMENT,
    STATUS.FORMAL_CASE,
    STATUS.IN_REVIEW,
    STATUS.TEMP_TAKEDOWN,
    STATUS.AUTHOR_OBJECTED,
  ]);

  var FORMAL_STATUSES = Object.freeze([
    STATUS.FORMAL_CASE,
    STATUS.IN_REVIEW,
    STATUS.TEMP_TAKEDOWN,
    STATUS.AUTHOR_OBJECTED,
    STATUS.COMPLETED,
  ]);

  var FINAL_STATUSES = Object.freeze([
    STATUS.INTAKE_REJECTED,
    STATUS.COMPLETED,
  ]);

  var PUBLIC_SUBMIT_FIELDS = Object.freeze([
    'caseNumber',
    'status',
    'claimType',
    'createdAt',
  ]);

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
    'territory',
  ]);

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function upper(v) {
    return String(v || '').trim().toUpperCase();
  }

  function trimText(v) {
    return String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
  }

  function compactLength(v) {
    return trimText(v).replace(/\s+/g, '').length;
  }

  function hasMeaningfulText(v, minChars) {
    var t = trimText(v);
    if (!t) return false;
    var min = Number(minChars) || 1;
    if (t.length < min) return false;
    if (compactLength(t) < Math.min(min, 2)) return false;
    return true;
  }

  function compactLetters(v) {
    return trimText(v).replace(/[\s.,!?'"~·\-]/g, '').toLowerCase();
  }

  function isTrivialClaimText(v) {
    var c = compactLetters(v);
    if (!c) return false;
    var leftover = c;
    var hit = false;
    for (var i = 0; i < TRIVIAL_PHRASES.length; i++) {
      if (c.indexOf(TRIVIAL_PHRASES[i]) !== -1) {
        hit = true;
        leftover = leftover.split(TRIVIAL_PHRASES[i]).join('');
      }
    }
    if (!hit) return false;
    return compactLength(leftover) < 8;
  }

  function isEmail(v) {
    var s = trimText(v).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
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
    return row;
  }

  function addUtcDays(iso, days) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) d = new Date();
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString();
  }

  function addUtcYears(iso, years) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + Number(years || 0));
    return d.toISOString();
  }

  function isUuid(v) {
    return typeof v === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  }

  function makeCaseNumber(nowIso, id) {
    var d = nowIso ? new Date(nowIso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var day = String(d.getUTCDate()).padStart(2, '0');
    var tail = String(id || 'xxxxxxxx').replace(/-/g, '').slice(0, 8).toUpperCase();
    return 'RI-' + y + m + day + '-' + tail;
  }

  function isOpenStatus(status) {
    return OPEN_STATUSES.indexOf(upper(status)) !== -1;
  }

  function isFormalStatus(status, isFormalFlag) {
    if (isFormalFlag === true) return true;
    var s = upper(status);
    if (s === STATUS.COMPLETED) return false;
    return FORMAL_STATUSES.indexOf(s) !== -1;
  }

  function isFinalStatus(status) {
    return FINAL_STATUSES.indexOf(upper(status)) !== -1;
  }

  function retentionUntilFor(status, isFormal, finalizedAt) {
    var years = (isFormal || upper(status) === STATUS.COMPLETED && isFormal)
      ? FORMAL_RETENTION_YEARS
      : INTAKE_RETENTION_YEARS;
    if (isFormal) years = FORMAL_RETENTION_YEARS;
    else years = INTAKE_RETENTION_YEARS;
    return addUtcYears(finalizedAt || new Date().toISOString(), years);
  }

  function requireChoice(value, allowed, error) {
    var v = upper(value);
    if (!allowed[v] && Object.keys(allowed).indexOf(v) === -1) {
      return error;
    }
    var keys = Object.keys(allowed);
    if (keys.indexOf(v) === -1) return error;
    return null;
  }

  function enumHas(map, value) {
    return Object.keys(map).indexOf(upper(value)) !== -1;
  }

  function pushIf(errors, cond, code) {
    if (cond) errors.push(code);
  }

  function validateCommon(input) {
    var src = stripPolitical(input || {});
    var errors = [];
    if (!enumHas(CLAIM_TYPE, src.claimType)) errors.push('CLAIM_TYPE_REQUIRED');
    if (!enumHas(CLAIMANT_KIND, src.claimantKind)) errors.push('CLAIMANT_KIND_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.claimantName, MIN.name), 'CLAIMANT_NAME_REQUIRED');
    pushIf(errors, !isEmail(src.claimantEmail), 'CLAIMANT_EMAIL_REQUIRED');
    if (!enumHas(TARGET_KIND, src.targetKind)) errors.push('TARGET_KIND_REQUIRED');

    var kind = upper(src.claimantKind);
    if (kind === CLAIMANT_KIND.ORGANIZATION || kind === CLAIMANT_KIND.AGENT) {
      pushIf(errors, !hasMeaningfulText(src.representativeOf, 2), 'REPRESENTATIVE_OF_REQUIRED');
      pushIf(errors, !hasMeaningfulText(src.representativeRelation, 4), 'REPRESENTATIVE_RELATION_REQUIRED');
      pushIf(errors, !hasMeaningfulText(src.representativeAuthority, 10), 'REPRESENTATIVE_AUTHORITY_REQUIRED');
    }

    var targetKind = upper(src.targetKind);
    if (targetKind === TARGET_KIND.POST) {
      if (!isUuid(src.postId) && !trimText(src.targetUrl)) errors.push('TARGET_POST_REQUIRED');
    } else if (targetKind === TARGET_KIND.COMMENT) {
      if (!isUuid(src.commentId) && !trimText(src.targetUrl)) errors.push('TARGET_COMMENT_REQUIRED');
    } else if (targetKind === TARGET_KIND.DELETED_UNKNOWN) {
      pushIf(errors, !hasMeaningfulText(src.deletedPeriodApprox, MIN.deletedPeriod), 'DELETED_PERIOD_REQUIRED');
      pushIf(errors, !hasMeaningfulText(src.rememberedTitle, MIN.deletedTitle), 'DELETED_TITLE_REQUIRED');
      pushIf(errors, !hasMeaningfulText(src.rememberedAuthor, MIN.deletedAuthor), 'DELETED_AUTHOR_REQUIRED');
      pushIf(errors, !hasMeaningfulText(src.rememberedBody, MIN.deletedBody), 'DELETED_BODY_REQUIRED');
      pushIf(errors, !hasMeaningfulText(src.rememberedPhrase, MIN.deletedPhrase), 'DELETED_PHRASE_REQUIRED');
      pushIf(errors, !hasMeaningfulText(src.discoveredAt, MIN.deletedDiscovered), 'DELETED_DISCOVERED_REQUIRED');
    }

    pushIf(errors, !hasMeaningfulText(src.problemExcerpt, MIN.problemExcerpt), 'PROBLEM_EXCERPT_TOO_SHORT');
    pushIf(errors, !hasMeaningfulText(src.claimedRight, MIN.claimedRight), 'CLAIMED_RIGHT_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.infringementReason, MIN.infringementReason), 'INFRINGEMENT_REASON_TOO_SHORT');
    pushIf(errors, !hasMeaningfulText(src.caseNarrative, MIN.caseNarrative), 'CASE_NARRATIVE_TOO_SHORT');

    if (!enumHas(REQUESTED_ACTION, src.requestedAction)) {
      errors.push('REQUESTED_ACTION_REQUIRED');
    } else if (upper(src.requestedAction) === REQUESTED_ACTION.OTHER) {
      pushIf(errors, !hasMeaningfulText(src.requestedActionDetail, MIN.requestedActionOther), 'REQUESTED_ACTION_DETAIL_REQUIRED');
    }

    if (src.truthConfirmed !== true && src.truthDeclaration !== true) {
      errors.push('TRUTH_CONFIRMATION_REQUIRED');
    }
    if (src.abuseNoticeConfirmed !== true) {
      errors.push('ABUSE_NOTICE_CONFIRMATION_REQUIRED');
    }

    pushIf(errors, !hasMeaningfulText(src.evidenceDescription, MIN.evidenceDescription), 'EVIDENCE_DESCRIPTION_REQUIRED');

    var attachmentCount = 0;
    if (Array.isArray(src.attachments)) attachmentCount += src.attachments.length;
    if (Array.isArray(src.stagingIds)) attachmentCount += src.stagingIds.length;
    if (src.attachmentCount != null) attachmentCount = Math.max(attachmentCount, Number(src.attachmentCount) || 0);
    pushIf(errors, attachmentCount < 1, 'EVIDENCE_FILE_REQUIRED');

    if (isTrivialClaimText(src.infringementReason) || isTrivialClaimText(src.caseNarrative)) {
      errors.push('TRIVIAL_CLAIM_NOT_ALLOWED');
    }

    return { errors: errors, src: src };
  }

  function validateDefamation(src, errors) {
    pushIf(errors, !hasMeaningfulText(src.defamationStatement, MIN.defamationStatement), 'DEFAMATION_STATEMENT_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.defamationRefersTo, MIN.defamationTarget), 'DEFAMATION_REFERS_TO_REQUIRED');
    var nature = upper(src.defamationNature);
    if (nature !== 'FACT' && nature !== 'OPINION') errors.push('DEFAMATION_NATURE_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.defamationFalsehood, MIN.defamationFalsehood), 'DEFAMATION_FALSEHOOD_TOO_SHORT');
    pushIf(errors, !hasMeaningfulText(src.defamationHonorHarm, MIN.defamationHonor), 'DEFAMATION_HONOR_REQUIRED');
  }

  function validatePrivacy(src, errors) {
    pushIf(errors, !hasMeaningfulText(src.privacyInfoType, MIN.privacyInfo), 'PRIVACY_INFO_TYPE_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.privacyWhose, MIN.privacyWhose), 'PRIVACY_WHOSE_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.privacyLocation, MIN.privacyLocation), 'PRIVACY_LOCATION_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.privacyBasis, MIN.privacyBasis), 'PRIVACY_BASIS_REQUIRED');
    var consent = upper(src.privacyConsent);
    if (consent !== 'YES' && consent !== 'NO' && consent !== 'UNKNOWN') {
      errors.push('PRIVACY_CONSENT_REQUIRED');
    }
    pushIf(errors, !hasMeaningfulText(src.privacyHarm, MIN.privacyHarm), 'PRIVACY_HARM_REQUIRED');
  }

  function validateLikeness(src, errors) {
    pushIf(errors, !hasMeaningfulText(src.likenessWho, MIN.likenessWho), 'LIKENESS_WHO_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.likenessRelation, MIN.likenessRelation), 'LIKENESS_RELATION_REQUIRED');
    var selfOrAgent = upper(src.likenessSelfOrAgent);
    if (selfOrAgent !== 'SELF' && selfOrAgent !== 'AGENT') errors.push('LIKENESS_SELF_OR_AGENT_REQUIRED');
    var permitted = upper(src.likenessPermitted);
    if (permitted !== 'YES' && permitted !== 'NO' && permitted !== 'UNKNOWN') {
      errors.push('LIKENESS_PERMITTED_REQUIRED');
    }
    pushIf(errors, !hasMeaningfulText(src.likenessInfringement, MIN.likenessInfringement), 'LIKENESS_INFRINGEMENT_REQUIRED');
  }

  function validateCopyright(src, errors) {
    pushIf(errors, !hasMeaningfulText(src.copyrightWork, MIN.copyrightWork), 'COPYRIGHT_WORK_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.copyrightBasis, MIN.copyrightBasis), 'COPYRIGHT_BASIS_REQUIRED');
    var hasSource = hasMeaningfulText(src.copyrightSource, MIN.copyrightSource) ||
      hasMeaningfulText(src.evidenceUrl, 8) ||
      hasMeaningfulText(src.evidenceDescription, MIN.evidenceRequired);
    pushIf(errors, !hasSource, 'COPYRIGHT_SOURCE_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.copyrightPortion, MIN.copyrightPortion), 'COPYRIGHT_PORTION_REQUIRED');
    var licensed = upper(src.copyrightLicensed);
    if (licensed !== 'YES' && licensed !== 'NO' && licensed !== 'UNKNOWN') {
      errors.push('COPYRIGHT_LICENSED_REQUIRED');
    }
  }

  function validateSubmission(input) {
    var packed = validateCommon(input);
    var errors = packed.errors;
    var src = packed.src;
    var type = upper(src.claimType);
    if (type === CLAIM_TYPE.DEFAMATION) validateDefamation(src, errors);
    if (type === CLAIM_TYPE.PRIVACY) validatePrivacy(src, errors);
    if (type === CLAIM_TYPE.LIKENESS) validateLikeness(src, errors);
    if (type === CLAIM_TYPE.COPYRIGHT) validateCopyright(src, errors);
    return {
      ok: errors.length === 0,
      errors: errors,
    };
  }

  function isHighRiskPrivacy(src) {
    var raw = upper(src && (src.privacyInfoType || src.privacyRiskFlags || ''));
    for (var i = 0; i < HIGH_RISK_PRIVACY.length; i++) {
      if (raw.indexOf(HIGH_RISK_PRIVACY[i]) !== -1) return true;
    }
    var text = trimText(src && src.privacyInfoType).toLowerCase();
    return /주소|전화|휴대폰|핸드폰|학교|직장|가족|주민등록|계좌/.test(text);
  }

  function duplicateKey(input) {
    var src = input || {};
    var who = trimText(src.claimantUserId) || trimText(src.claimantEmail).toLowerCase();
    var target = upper(src.targetKind) === TARGET_KIND.COMMENT
      ? 'COMMENT:' + String(src.commentId || src.targetUrl || '')
      : upper(src.targetKind) === TARGET_KIND.DELETED_UNKNOWN
        ? 'DELETED:' + trimText(src.rememberedTitle) + '|' + trimText(src.rememberedAuthor)
        : 'POST:' + String(src.postId || src.targetUrl || '');
    return who + '|' + target + '|' + upper(src.claimType);
  }

  function canResubmitRejected(input) {
    var src = input || {};
    return hasMeaningfulText(src.newEvidenceDescription, MIN.evidenceRequired) ||
      hasMeaningfulText(src.infringementReason, MIN.infringementReason + 10);
  }

  function validateObjection(input) {
    var src = input || {};
    var errors = [];
    if (!enumHas(OBJECTION_GROUND, src.ground)) errors.push('OBJECTION_GROUND_REQUIRED');
    pushIf(errors, !hasMeaningfulText(src.explanation, MIN.objection), 'OBJECTION_TOO_SHORT');
    return { ok: errors.length === 0, errors: errors };
  }

  function allowedOperatorActions(status, isFormal) {
    var s = upper(status);
    var out = [];
    if (s === STATUS.RECEIVED || s === STATUS.NEEDS_SUPPLEMENT) {
      out.push(OPERATOR_ACTION.REQUEST_SUPPLEMENT, OPERATOR_ACTION.REJECT_INTAKE, OPERATOR_ACTION.CONVERT_FORMAL);
    }
    if (s === STATUS.FORMAL_CASE || s === STATUS.IN_REVIEW || s === STATUS.AUTHOR_OBJECTED) {
      out.push(OPERATOR_ACTION.TEMP_TAKEDOWN, OPERATOR_ACTION.COMPLETE, OPERATOR_ACTION.START_REVIEW);
    }
    if (s === STATUS.TEMP_TAKEDOWN) {
      out.push(OPERATOR_ACTION.LIFT_TAKEDOWN, OPERATOR_ACTION.COMPLETE);
    }
    if (isFormal || FORMAL_STATUSES.indexOf(s) !== -1) {
      out.push(OPERATOR_ACTION.LINK_EVIDENCE);
    }
    out.push(
      OPERATOR_ACTION.ABUSE_WARNING,
      OPERATOR_ACTION.RESTRICT_30D,
      OPERATOR_ACTION.RESTRICT_6M,
      OPERATOR_ACTION.SANCTION_REVIEW
    );
    return out;
  }

  function applyOperatorAction(current, action, nowIso) {
    var src = clone(current) || {};
    var act = upper(action);
    var now = nowIso || new Date().toISOString();
    var next = clone(src);
    var allowed = allowedOperatorActions(src.status, src.isFormal);
    if (allowed.indexOf(act) === -1 && act !== OPERATOR_ACTION.LINK_EVIDENCE) {
      return { ok: false, error: 'OPERATOR_ACTION_NOT_ALLOWED' };
    }
    if (act === OPERATOR_ACTION.REQUEST_SUPPLEMENT) {
      next.status = STATUS.NEEDS_SUPPLEMENT;
    } else if (act === OPERATOR_ACTION.REJECT_INTAKE) {
      next.status = STATUS.INTAKE_REJECTED;
      next.isFormal = false;
      next.finalizedAt = now;
      next.retentionUntil = retentionUntilFor(next.status, false, now);
    } else if (act === OPERATOR_ACTION.CONVERT_FORMAL) {
      next.status = STATUS.FORMAL_CASE;
      next.isFormal = true;
      next.formalizedAt = now;
    } else if (act === OPERATOR_ACTION.START_REVIEW) {
      next.status = STATUS.IN_REVIEW;
      next.isFormal = true;
    } else if (act === OPERATOR_ACTION.TEMP_TAKEDOWN) {
      next.status = STATUS.TEMP_TAKEDOWN;
      next.isFormal = true;
      next.tempTakedownAt = now;
      next.tempTakedownUntil = addUtcDays(now, TAKEDOWN_MAX_DAYS);
      next.authorObjectionDeadline = addUtcDays(now, TAKEDOWN_MAX_DAYS);
      next.authorNotifiedAt = now;
    } else if (act === OPERATOR_ACTION.LIFT_TAKEDOWN) {
      next.status = STATUS.IN_REVIEW;
      next.tempTakedownAt = null;
      next.tempTakedownUntil = null;
    } else if (act === OPERATOR_ACTION.COMPLETE) {
      next.status = STATUS.COMPLETED;
      next.finalizedAt = now;
      next.retentionUntil = retentionUntilFor(next.status, !!next.isFormal, now);
    } else if (act === OPERATOR_ACTION.LINK_EVIDENCE) {
      next.isFormal = true;
    } else if (
      act === OPERATOR_ACTION.ABUSE_WARNING ||
      act === OPERATOR_ACTION.RESTRICT_30D ||
      act === OPERATOR_ACTION.RESTRICT_6M ||
      act === OPERATOR_ACTION.SANCTION_REVIEW
    ) {
      next.lastAbuseAction = act;
      next.lastAbuseAt = now;
    } else {
      return { ok: false, error: 'OPERATOR_ACTION_INVALID' };
    }
    next.updatedAt = now;
    return { ok: true, row: next };
  }

  function nextAbuseRestriction(currentKind) {
    var k = upper(currentKind);
    if (!k || k === ABUSE_RESTRICTION.NONE) return ABUSE_RESTRICTION.DAYS_30;
    if (k === ABUSE_RESTRICTION.DAYS_30) return ABUSE_RESTRICTION.MONTHS_6;
    return ABUSE_RESTRICTION.MONTHS_6;
  }

  function restrictionUntil(kind, nowIso) {
    var k = upper(kind);
    if (k === ABUSE_RESTRICTION.DAYS_30) return addUtcDays(nowIso, 30);
    if (k === ABUSE_RESTRICTION.MONTHS_6) return addUtcDays(nowIso, 182);
    return null;
  }

  function isRestrictionActive(state, nowIso) {
    var src = state || {};
    if (upper(src.restrictionKind) === ABUSE_RESTRICTION.NONE || !src.restrictedUntil) return false;
    return new Date(src.restrictedUntil).getTime() > new Date(nowIso || Date.now()).getTime();
  }

  function mapPublicSubmit(row) {
    var src = row || {};
    return {
      caseNumber: src.caseNumber || null,
      status: src.status || null,
      statusLabel: STATUS_LABEL[upper(src.status)] || null,
      claimType: src.claimType || null,
      createdAt: src.createdAt || null,
    };
  }

  function mapAuthorNotice(row) {
    var src = row || {};
    return {
      id: src.id || null,
      caseNumber: src.caseNumber || null,
      claimType: src.claimType || null,
      claimTypeLabel: CLAIM_TYPE_LABEL[upper(src.claimType)] || null,
      targetKind: src.targetKind || null,
      targetLabel: src.targetKind === 'COMMENT' ? '댓글' : '게시글',
      tempTakedownAt: src.tempTakedownAt || null,
      objectionDeadline: src.authorObjectionDeadline || null,
      objectionMethod: '이 화면에서 30일 이내에 구체적인 복원 사유를 제출할 수 있습니다.',
      notice: TAKEDOWN_NOTICE,
    };
  }

  function mapAdminList(row) {
    var src = row || {};
    return {
      id: src.id,
      caseNumber: src.caseNumber,
      claimType: src.claimType,
      claimTypeLabel: CLAIM_TYPE_LABEL[upper(src.claimType)] || src.claimType,
      targetKind: src.targetKind,
      postId: src.postId || null,
      commentId: src.commentId || null,
      claimantKind: src.claimantKind,
      claimantIsMember: !!src.claimantUserId,
      createdAt: src.createdAt,
      status: src.status,
      statusLabel: STATUS_LABEL[upper(src.status)] || src.status,
      needsSupplement: upper(src.status) === STATUS.NEEDS_SUPPLEMENT,
      tempTakedown: upper(src.status) === STATUS.TEMP_TAKEDOWN || !!src.tempTakedownAt,
      authorObjected: upper(src.status) === STATUS.AUTHOR_OBJECTED || !!src.authorObjectedAt,
      isFormal: !!src.isFormal,
      highRiskPrivacy: !!src.highRiskPrivacy,
      rejectionCode: src.rejectionCode || null,
      publicRejectionNote: src.publicRejectionNote || null,
    };
  }

  function sanitizeSubmission(input) {
    var src = stripPolitical(input || {});
    function t(k) {
      return src[k] == null ? '' : trimText(src[k]);
    }
    return {
      claimType: upper(src.claimType),
      claimantKind: upper(src.claimantKind),
      claimantName: t('claimantName').slice(0, 120),
      claimantEmail: t('claimantEmail').toLowerCase().slice(0, 200),
      claimantUserId: isUuid(src.claimantUserId) ? src.claimantUserId : null,
      representativeOf: t('representativeOf').slice(0, 200),
      representativeRelation: t('representativeRelation').slice(0, 200),
      representativeAuthority: t('representativeAuthority').slice(0, 1000),
      targetKind: upper(src.targetKind),
      postId: isUuid(src.postId) ? src.postId : null,
      commentId: isUuid(src.commentId) ? src.commentId : null,
      targetUrl: t('targetUrl').slice(0, 500),
      problemExcerpt: t('problemExcerpt').slice(0, 2000),
      claimedRight: t('claimedRight').slice(0, 500),
      infringementReason: t('infringementReason').slice(0, 4000),
      caseNarrative: t('caseNarrative').slice(0, 4000),
      requestedAction: upper(src.requestedAction),
      requestedActionDetail: t('requestedActionDetail').slice(0, 1000),
      evidenceDescription: t('evidenceDescription').slice(0, 4000),
      evidenceUrl: t('evidenceUrl').slice(0, 500),
      truthConfirmed: true,
      abuseNoticeConfirmed: true,
      deletedPeriodApprox: t('deletedPeriodApprox').slice(0, 200),
      rememberedTitle: t('rememberedTitle').slice(0, 200),
      rememberedAuthor: t('rememberedAuthor').slice(0, 120),
      rememberedBody: t('rememberedBody').slice(0, 2000),
      rememberedPhrase: t('rememberedPhrase').slice(0, 500),
      discoveredAt: t('discoveredAt').slice(0, 200),
      defamationStatement: t('defamationStatement').slice(0, 2000),
      defamationRefersTo: t('defamationRefersTo').slice(0, 200),
      defamationNature: upper(src.defamationNature),
      defamationFalsehood: t('defamationFalsehood').slice(0, 2000),
      defamationHonorHarm: t('defamationHonorHarm').slice(0, 2000),
      privacyInfoType: t('privacyInfoType').slice(0, 500),
      privacyWhose: t('privacyWhose').slice(0, 200),
      privacyLocation: t('privacyLocation').slice(0, 500),
      privacyBasis: t('privacyBasis').slice(0, 2000),
      privacyConsent: upper(src.privacyConsent),
      privacyHarm: t('privacyHarm').slice(0, 2000),
      likenessWho: t('likenessWho').slice(0, 200),
      likenessRelation: t('likenessRelation').slice(0, 500),
      likenessSelfOrAgent: upper(src.likenessSelfOrAgent),
      likenessPermitted: upper(src.likenessPermitted),
      likenessInfringement: t('likenessInfringement').slice(0, 2000),
      copyrightWork: t('copyrightWork').slice(0, 2000),
      copyrightBasis: t('copyrightBasis').slice(0, 2000),
      copyrightSource: t('copyrightSource').slice(0, 500),
      copyrightPortion: t('copyrightPortion').slice(0, 2000),
      copyrightLicensed: upper(src.copyrightLicensed),
      newEvidenceDescription: t('newEvidenceDescription').slice(0, 4000),
    };
  }

  function shouldPurge(row, nowIso) {
    var src = row || {};
    if (src.legalHold === true || src.legal_hold === true) return false;
    if (!isFinalStatus(src.status)) return false;
    var until = src.retentionUntil || src.retention_until;
    if (!until) return false;
    var now = nowIso ? new Date(nowIso).getTime() : Date.now();
    var t = new Date(until).getTime();
    if (isNaN(t)) return false;
    return t <= now;
  }

  return {
    STATUS: STATUS,
    STATUS_LABEL: STATUS_LABEL,
    CLAIM_TYPE: CLAIM_TYPE,
    CLAIM_TYPE_LABEL: CLAIM_TYPE_LABEL,
    CLAIMANT_KIND: CLAIMANT_KIND,
    CLAIMANT_KIND_LABEL: CLAIMANT_KIND_LABEL,
    TARGET_KIND: TARGET_KIND,
    REQUESTED_ACTION: REQUESTED_ACTION,
    OPERATOR_ACTION: OPERATOR_ACTION,
    REJECTION_CODE: REJECTION_CODE,
    REJECTION_CODE_LABEL: REJECTION_CODE_LABEL,
    GUIDE_INTRO: GUIDE_INTRO,
    MASK_PII_NOTICE: MASK_PII_NOTICE,
    GUEST_VERIFY_UNAVAILABLE_NOTICE: GUEST_VERIFY_UNAVAILABLE_NOTICE,
    CONFIRM_TRUTH_TEXT: CONFIRM_TRUTH_TEXT,
    CONFIRM_NOT_MALICIOUS_TEXT: CONFIRM_NOT_MALICIOUS_TEXT,
    ABUSE_RESTRICTION: ABUSE_RESTRICTION,
    OBJECTION_GROUND: OBJECTION_GROUND,
    HIGH_RISK_PRIVACY: HIGH_RISK_PRIVACY,
    BLIND_REASON: BLIND_REASON,
    TAKEDOWN_NOTICE: TAKEDOWN_NOTICE,
    TAKEDOWN_MAX_DAYS: TAKEDOWN_MAX_DAYS,
    FORMAL_RETENTION_YEARS: FORMAL_RETENTION_YEARS,
    INTAKE_RETENTION_YEARS: INTAKE_RETENTION_YEARS,
    MIN: MIN,
    ABUSE_NOTICE_TITLE: ABUSE_NOTICE_TITLE,
    ABUSE_NOTICE_BODY: ABUSE_NOTICE_BODY,
    CONFIRM_TEXT: CONFIRM_TEXT,
    POLITICAL_PROTECTION: POLITICAL_PROTECTION,
    OPEN_STATUSES: OPEN_STATUSES,
    clone: clone,
    trimText: trimText,
    compactLength: compactLength,
    hasMeaningfulText: hasMeaningfulText,
    isTrivialClaimText: isTrivialClaimText,
    isEmail: isEmail,
    stripPolitical: stripPolitical,
    hasPoliticalInput: hasPoliticalInput,
    addUtcDays: addUtcDays,
    addUtcYears: addUtcYears,
    isUuid: isUuid,
    makeCaseNumber: makeCaseNumber,
    isOpenStatus: isOpenStatus,
    isFormalStatus: isFormalStatus,
    isFinalStatus: isFinalStatus,
    retentionUntilFor: retentionUntilFor,
    validateSubmission: validateSubmission,
    validateObjection: validateObjection,
    isHighRiskPrivacy: isHighRiskPrivacy,
    duplicateKey: duplicateKey,
    canResubmitRejected: canResubmitRejected,
    allowedOperatorActions: allowedOperatorActions,
    applyOperatorAction: applyOperatorAction,
    nextAbuseRestriction: nextAbuseRestriction,
    restrictionUntil: restrictionUntil,
    isRestrictionActive: isRestrictionActive,
    mapPublicSubmit: mapPublicSubmit,
    mapAuthorNotice: mapAuthorNotice,
    mapAdminList: mapAdminList,
    sanitizeSubmission: sanitizeSubmission,
    shouldPurge: shouldPurge,
  };
});
