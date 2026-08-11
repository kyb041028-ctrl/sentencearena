/**
 * SentenceArena — 활동명(display_name) 규칙 · 주사위 후보 생성
 * 서버/브라우저 공용. 식별자는 auth.users.id 이며 활동명은 표시명일 뿐이다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ActivityNameCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function activityNameCoreFactory() {
  'use strict';

  var MIN_LEN = 2;
  var MAX_LEN = 16;
  var ALLOWED_RE = /^[가-힣A-Za-z0-9_-]+$/;
  var HAS_SPACE_RE = /[\s\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/;

  var ADJECTIVES = [
    '고요한',
    '푸른',
    '은빛',
    '새벽',
    '깊은',
    '맑은',
    '조용한',
    '단단한',
    '느린',
    '빠른',
    '별빛',
    '붉은',
    '흰',
    '검은',
    '따뜻한',
    '차가운',
    '담백한',
    '성실한',
    '차분한',
    '자유로운',
    '신중한',
    '담대한',
    '꾸준한',
    '밝은',
    '고요한',
    '단단한',
  ];

  var NOUNS = [
    '개척자',
    '논객',
    '관찰자',
    '방랑자',
    '수호자',
    '기록자',
    '사색가',
    '탐구자',
    '항해자',
    '시민',
    '문장가',
    '토론가',
    '중재자',
    '여행자',
    '파수꾼',
    '작가',
    '독서가',
    '항해인',
    '등대지기',
    '지도제작자',
    '이야기꾼',
    '기록보관인',
    '광장지기',
    '경계인',
  ];

  var ERRORS = {
    EMPTY: 'ACTIVITY_NAME_EMPTY',
    TOO_SHORT: 'ACTIVITY_NAME_TOO_SHORT',
    TOO_LONG: 'ACTIVITY_NAME_TOO_LONG',
    HAS_SPACE: 'ACTIVITY_NAME_HAS_SPACE',
    INVALID_CHARS: 'ACTIVITY_NAME_INVALID_CHARS',
    DUPLICATE: 'ACTIVITY_NAME_DUPLICATE',
  };

  var MESSAGES = {};
  MESSAGES[ERRORS.EMPTY] = '활동명을 입력해 주세요.';
  MESSAGES[ERRORS.TOO_SHORT] = '활동명은 2자 이상이어야 합니다.';
  MESSAGES[ERRORS.TOO_LONG] = '활동명은 16자 이하여야 합니다.';
  MESSAGES[ERRORS.HAS_SPACE] = '활동명에는 띄어쓰기를 사용할 수 없습니다.';
  MESSAGES[ERRORS.INVALID_CHARS] =
    '활동명은 한글, 영문, 숫자, 하이픈(-), 언더바(_)만 사용할 수 있습니다.';
  MESSAGES[ERRORS.DUPLICATE] = '이미 사용 중인 활동명입니다.';

  function normalizeInput(raw) {
    return raw == null ? '' : String(raw);
  }

  function validateActivityName(raw) {
    var value = normalizeInput(raw);
    if (!value) {
      return { ok: false, error: ERRORS.EMPTY, message: MESSAGES[ERRORS.EMPTY], value: '' };
    }
    if (HAS_SPACE_RE.test(value)) {
      return {
        ok: false,
        error: ERRORS.HAS_SPACE,
        message: MESSAGES[ERRORS.HAS_SPACE],
        value: value,
      };
    }
    if (value.length < MIN_LEN) {
      return {
        ok: false,
        error: ERRORS.TOO_SHORT,
        message: MESSAGES[ERRORS.TOO_SHORT],
        value: value,
      };
    }
    if (value.length > MAX_LEN) {
      return {
        ok: false,
        error: ERRORS.TOO_LONG,
        message: MESSAGES[ERRORS.TOO_LONG],
        value: value,
      };
    }
    if (!ALLOWED_RE.test(value)) {
      return {
        ok: false,
        error: ERRORS.INVALID_CHARS,
        message: MESSAGES[ERRORS.INVALID_CHARS],
        value: value,
      };
    }
    return { ok: true, error: null, message: '사용 가능한 활동명입니다.', value: value };
  }

  function isCompleteActivityName(raw) {
    return validateActivityName(raw).ok === true;
  }

  function messageForError(code) {
    return MESSAGES[code] || '활동명을 확인해 주세요.';
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function withNumericSuffix(base, n) {
    var suffix = String(n);
    var maxBase = MAX_LEN - suffix.length;
    if (maxBase < MIN_LEN) return null;
    var trimmed = base.slice(0, maxBase);
    if (!ALLOWED_RE.test(trimmed) || trimmed.length < MIN_LEN) return null;
    var out = trimmed + suffix;
    if (!validateActivityName(out).ok) return null;
    return out;
  }

  /**
   * 주사위 후보 1개 생성 (DB 저장 없음).
   * @param {{ avoid?: string[], attempt?: number }} [opts]
   */
  function generateActivityNameCandidate(opts) {
    var options = opts || {};
    var avoid = {};
    (options.avoid || []).forEach(function (v) {
      var s = String(v || '').toLowerCase();
      if (s) avoid[s] = true;
    });
    var maxAttempts = Math.max(1, Number(options.maxAttempts) || 10);
    var i;
    for (i = 0; i < maxAttempts; i++) {
      var adj = pick(ADJECTIVES);
      var noun = pick(NOUNS);
      var joiner = i % 7 === 0 ? '_' : i % 11 === 0 ? '-' : '';
      var candidate = adj + joiner + noun;
      if (candidate.length > MAX_LEN) {
        candidate = (adj + noun).slice(0, MAX_LEN);
      }
      var v = validateActivityName(candidate);
      if (!v.ok) continue;
      if (avoid[candidate.toLowerCase()]) continue;
      return v.value;
    }
    var fallbackBase = pick(ADJECTIVES) + pick(NOUNS);
    var n = 10 + Math.floor(Math.random() * 90);
    var withNum = withNumericSuffix(fallbackBase.replace(/[^가-힣A-Za-z0-9_-]/g, ''), n);
    if (withNum) return withNum;
    return '시민' + String(10 + Math.floor(Math.random() * 90));
  }

  return {
    MIN_LEN: MIN_LEN,
    MAX_LEN: MAX_LEN,
    ALLOWED_RE: ALLOWED_RE,
    ERRORS: ERRORS,
    MESSAGES: MESSAGES,
    validateActivityName: validateActivityName,
    isCompleteActivityName: isCompleteActivityName,
    messageForError: messageForError,
    generateActivityNameCandidate: generateActivityNameCandidate,
    withNumericSuffix: withNumericSuffix,
    ADJECTIVES: ADJECTIVES,
    NOUNS: NOUNS,
  };
});
