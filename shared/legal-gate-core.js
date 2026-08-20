/**
 * SentenceArena legal signup gate — age (만 14) + sensitive political consent.
 * Does not store DOB. Does not change alignment formulas or territory keys.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LegalGateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function legalGateCoreFactory() {
  'use strict';

  var AGE_POLICY_VERSION = 'age-policy-v1';
  var SENSITIVE_POLICY_VERSION = 'sensitive-political-v1';
  var AGE_GATE_METHOD = 'dob-input';
  var MIN_AGE = 14;
  var VISIBILITY_PRIVATE = 'private';
  var VISIBILITY_PUBLIC = 'public';

  var AGE_NOTICE = 'SentenceArena는 만 14세 이상만 가입할 수 있습니다.';

  var SENSITIVE_TITLE = '[필수] 정치성향 분석을 위한 민감정보 수집·이용 동의';

  var SENSITIVE_ITEMS = [
    '게시글 및 Daily Issue에 대한 추천/비추천(좋아요/싫어요) 반응',
    '반응 당시 기록되는 영토·성향 점수 스냅샷',
    '위 활동을 기반으로 SentenceArena가 분석·추론하는 정치성향 점수 및 변화 기록',
    '정치성향에 따른 소속(영토) 및 관련 변화 기록',
  ];

  var SENSITIVE_PURPOSES = [
    '이용자의 정치성향 분석',
    '정치성향 변화 계산',
    '영토/소속 시스템 제공',
    '정치성향 기반 프로필 기능 제공',
    'SentenceArena 핵심 정치 커뮤니티 기능 제공',
  ];

  var SENSITIVE_RETENTION = '민감정보 동의 철회 또는 회원탈퇴 시까지';

  var SENSITIVE_REFUSAL =
    '귀하는 민감정보 처리에 동의하지 않을 수 있습니다.\n' +
    '다만 정치성향 분석은 SentenceArena의 핵심 기능이므로\n' +
    '동의하지 않을 경우 회원 가입 및 회원용 서비스 이용이 제한됩니다.';

  var SENSITIVE_CHECK_LABEL = '위 민감정보 수집·이용에 동의합니다.';

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function seoulToday(nowMs) {
    var d = nowMs != null ? new Date(nowMs) : new Date();
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    var y = 0;
    var m = 0;
    var day = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'year') y = Number(parts[i].value);
      if (parts[i].type === 'month') m = Number(parts[i].value);
      if (parts[i].type === 'day') day = Number(parts[i].value);
    }
    return { year: y, month: m, day: day };
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function parseDob(input) {
    var src = input || {};
    var year;
    var month;
    var day;
    if (src.birthDate != null && String(src.birthDate).trim()) {
      var m = String(src.birthDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return { ok: false, error: 'AGE_INVALID_DATE' };
      year = Number(m[1]);
      month = Number(m[2]);
      day = Number(m[3]);
    } else {
      year = Number(src.year);
      month = Number(src.month);
      day = Number(src.day);
    }
    if (!isFinite(year) || !isFinite(month) || !isFinite(day)) {
      return { ok: false, error: 'AGE_INVALID_DATE' };
    }
    year = Math.floor(year);
    month = Math.floor(month);
    day = Math.floor(day);
    if (year < 1900 || month < 1 || month > 12 || day < 1) {
      return { ok: false, error: 'AGE_INVALID_DATE' };
    }
    if (day > daysInMonth(year, month)) return { ok: false, error: 'AGE_INVALID_DATE' };
    return { ok: true, year: year, month: month, day: day };
  }

  function manAgeOn(dob, today) {
    var age = today.year - dob.year;
    if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) {
      age -= 1;
    }
    return age;
  }

  function evaluateAge(input, nowMs) {
    var parsed = parseDob(input);
    if (!parsed.ok) return parsed;
    var today = seoulToday(nowMs);
    if (
      parsed.year > today.year ||
      (parsed.year === today.year && parsed.month > today.month) ||
      (parsed.year === today.year && parsed.month === today.month && parsed.day > today.day)
    ) {
      return { ok: false, error: 'AGE_FUTURE' };
    }
    var age = manAgeOn(parsed, today);
    if (age < MIN_AGE) return { ok: false, error: 'AGE_UNDER_14', age: age };
    return {
      ok: true,
      age: age,
      policyVersion: AGE_POLICY_VERSION,
      method: AGE_GATE_METHOD,
    };
  }

  function parseAgeConfirmBody(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    if (src.userId != null || src.user_id != null) {
      return { ok: false, error: 'LEGAL_USER_ID_NOT_ALLOWED', status: 400 };
    }
    var version = src.policyVersion != null ? String(src.policyVersion).trim() : AGE_POLICY_VERSION;
    if (version !== AGE_POLICY_VERSION) {
      return { ok: false, error: 'AGE_POLICY_VERSION_MISMATCH', status: 409 };
    }
    var age = evaluateAge(src);
    if (!age.ok) {
      return { ok: false, error: age.error, status: age.error === 'AGE_UNDER_14' ? 403 : 400 };
    }
    return {
      ok: true,
      policyVersion: AGE_POLICY_VERSION,
      method: AGE_GATE_METHOD,
    };
  }

  function parseSensitiveConsentBody(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    if (src.userId != null || src.user_id != null) {
      return { ok: false, error: 'LEGAL_USER_ID_NOT_ALLOWED', status: 400 };
    }
    if (src.consented !== true && src.acknowledged !== true) {
      return { ok: false, error: 'SENSITIVE_CONSENT_REQUIRED', status: 400 };
    }
    var version = src.policyVersion != null ? String(src.policyVersion).trim() : '';
    if (!version) return { ok: false, error: 'SENSITIVE_POLICY_VERSION_REQUIRED', status: 400 };
    if (version !== SENSITIVE_POLICY_VERSION) {
      return { ok: false, error: 'SENSITIVE_POLICY_VERSION_MISMATCH', status: 409 };
    }
    var vis = normalizeVisibility(src.politicalProfileVisibility);
    return {
      ok: true,
      policyVersion: SENSITIVE_POLICY_VERSION,
      politicalProfileVisibility: vis,
    };
  }

  function normalizeVisibility(v) {
    var s = String(v || '').trim().toLowerCase();
    if (s === VISIBILITY_PUBLIC || s === 'public') return VISIBILITY_PUBLIC;
    return VISIBILITY_PRIVATE;
  }

  function isAgeConfirmed(row) {
    return !!(row && row.age_requirement_confirmed_at && row.age_policy_version === AGE_POLICY_VERSION);
  }

  function isSensitiveConsented(row) {
    return !!(
      row &&
      row.sensitive_political_consented_at &&
      row.sensitive_political_policy_version === SENSITIVE_POLICY_VERSION
    );
  }

  function isComplete(row) {
    return isAgeConfirmed(row) && isSensitiveConsented(row);
  }

  function toPublicStatus(row) {
    var vis = normalizeVisibility(row && row.political_profile_visibility);
    return {
      complete: isComplete(row),
      ageConfirmed: isAgeConfirmed(row),
      sensitiveConsented: isSensitiveConsented(row),
      agePolicyVersion: AGE_POLICY_VERSION,
      sensitivePolicyVersion: SENSITIVE_POLICY_VERSION,
      politicalProfileVisibility: vis,
    };
  }

  function containsDob(obj) {
    var raw = JSON.stringify(obj || {});
    return /birthDate|birth_date|"year"\s*:\s*\d{4}/.test(raw) && /"month"\s*:/.test(raw);
  }

  return {
    AGE_POLICY_VERSION: AGE_POLICY_VERSION,
    SENSITIVE_POLICY_VERSION: SENSITIVE_POLICY_VERSION,
    AGE_GATE_METHOD: AGE_GATE_METHOD,
    MIN_AGE: MIN_AGE,
    VISIBILITY_PRIVATE: VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC: VISIBILITY_PUBLIC,
    AGE_NOTICE: AGE_NOTICE,
    SENSITIVE_TITLE: SENSITIVE_TITLE,
    SENSITIVE_ITEMS: SENSITIVE_ITEMS,
    SENSITIVE_PURPOSES: SENSITIVE_PURPOSES,
    SENSITIVE_RETENTION: SENSITIVE_RETENTION,
    SENSITIVE_REFUSAL: SENSITIVE_REFUSAL,
    SENSITIVE_CHECK_LABEL: SENSITIVE_CHECK_LABEL,
    seoulToday: seoulToday,
    parseDob: parseDob,
    evaluateAge: evaluateAge,
    parseAgeConfirmBody: parseAgeConfirmBody,
    parseSensitiveConsentBody: parseSensitiveConsentBody,
    normalizeVisibility: normalizeVisibility,
    isAgeConfirmed: isAgeConfirmed,
    isSensitiveConsented: isSensitiveConsented,
    isComplete: isComplete,
    toPublicStatus: toPublicStatus,
    containsDob: containsDob,
    pad2: pad2,
  };
});
