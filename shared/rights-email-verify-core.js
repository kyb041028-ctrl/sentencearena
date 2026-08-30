/**
 * 비회원 권리침해 요청 이메일 확인 코어.
 * 인증번호 원문/이메일 원문을 저장하지 않는다. 정치성향 미저장.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RightsEmailVerifyCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function rightsEmailVerifyCoreFactory() {
  'use strict';

  var CODE_TTL_MS = 10 * 60 * 1000;
  var PROOF_TTL_MS = 30 * 60 * 1000;
  var RESEND_MIN_MS = 60 * 1000;
  var MAX_FAILURES = 5;
  var CODE_DIGITS = 6;
  var PURGE_GRACE_MS = 60 * 60 * 1000;
  var VERIFIED_KEEP_MS = 2 * 60 * 60 * 1000;

  var MAIL_SUBJECT = 'SentenceArena 권리침해 요청 이메일 인증';
  var MAIL_BODY_PREFIX = 'SentenceArena 권리침해 처리 요청을 위한 인증번호입니다.';
  var MAIL_BODY_TTL = '인증번호는 10분 동안 유효합니다.';
  var MAIL_BODY_IGNORE = '본인이 요청하지 않았다면 이 이메일을 무시해주세요.';

  function normalizeEmail(v) {
    return String(v == null ? '' : v).replace(/^\s+|\s+$/g, '').toLowerCase();
  }

  function isEmail(v) {
    var s = normalizeEmail(v);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
  }

  function timingEqual(a, b) {
    var left = Buffer.from(String(a || ''), 'utf8');
    var right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    var crypto;
    try { crypto = require('crypto'); } catch (_) { return String(a) === String(b); }
    return crypto.timingSafeEqual(left, right);
  }

  function hashEmail(hmacIdentity, pepper, email) {
    var fn = hmacIdentity;
    if (!fn) return null;
    return fn(pepper, 'RIGHTS_EMAIL', normalizeEmail(email));
  }

  function hashCode(hmacIdentity, pepper, email, code) {
    var fn = hmacIdentity;
    if (!fn) return null;
    return fn(pepper, 'RIGHTS_CODE', normalizeEmail(email) + ':' + String(code || ''));
  }

  function generateCode(randomInt) {
    var n = typeof randomInt === 'function' ? randomInt(0, 1000000) : 0;
    return String(n).padStart(CODE_DIGITS, '0').slice(-CODE_DIGITS);
  }

  function buildMailText(code) {
    return MAIL_BODY_PREFIX + '\n\n' + String(code || '') + '\n\n' + MAIL_BODY_TTL + '\n' + MAIL_BODY_IGNORE;
  }

  function createProof(hmacIdentity, pepper, email, nowMs, ttlMs) {
    var exp = Number(nowMs) + (Number(ttlMs) || PROOF_TTL_MS);
    var emailHash = hashEmail(hmacIdentity, pepper, email);
    var sig = hmacIdentity(pepper, 'RIGHTS_PROOF', emailHash + ':' + String(exp));
    if (!emailHash || !sig) return null;
    return emailHash + '.' + String(exp) + '.' + sig;
  }

  function readProof(proof) {
    var parts = String(proof || '').split('.');
    if (parts.length !== 3) return null;
    return { emailHash: parts[0], exp: Number(parts[1]), sig: parts[2] };
  }

  function verifyProof(hmacIdentity, pepper, email, proof, nowMs) {
    var parsed = readProof(proof);
    if (!parsed || !parsed.emailHash || !parsed.sig || !parsed.exp) {
      return { ok: false, error: 'EMAIL_NOT_VERIFIED' };
    }
    if (Number(nowMs) > parsed.exp) return { ok: false, error: 'EMAIL_PROOF_EXPIRED' };
    var emailHash = hashEmail(hmacIdentity, pepper, email);
    if (!emailHash || !timingEqual(emailHash, parsed.emailHash)) {
      return { ok: false, error: 'EMAIL_PROOF_MISMATCH' };
    }
    var sig = hmacIdentity(pepper, 'RIGHTS_PROOF', parsed.emailHash + ':' + String(parsed.exp));
    if (!sig || !timingEqual(sig, parsed.sig)) return { ok: false, error: 'EMAIL_NOT_VERIFIED' };
    return { ok: true };
  }

  function canResend(lastSentAt, nowMs) {
    if (!lastSentAt) return true;
    var t = new Date(lastSentAt).getTime();
    if (isNaN(t)) return true;
    return Number(nowMs) - t >= RESEND_MIN_MS;
  }

  function isExpired(expiresAt, nowMs) {
    var t = new Date(expiresAt).getTime();
    if (isNaN(t)) return true;
    return t <= Number(nowMs);
  }

  function shouldPurge(row, nowMs) {
    var src = row || {};
    var now = Number(nowMs);
    if (src.consumedAt) {
      var c = new Date(src.consumedAt).getTime();
      if (!isNaN(c) && now - c >= PURGE_GRACE_MS) return true;
    }
    if (src.verifiedAt) {
      var v = new Date(src.verifiedAt).getTime();
      if (!isNaN(v) && now - v >= VERIFIED_KEEP_MS) return true;
    }
    if (src.expiresAt) {
      var e = new Date(src.expiresAt).getTime();
      if (!isNaN(e) && now - e >= PURGE_GRACE_MS) return true;
    }
    return false;
  }

  return {
    CODE_TTL_MS: CODE_TTL_MS,
    PROOF_TTL_MS: PROOF_TTL_MS,
    RESEND_MIN_MS: RESEND_MIN_MS,
    MAX_FAILURES: MAX_FAILURES,
    CODE_DIGITS: CODE_DIGITS,
    MAIL_SUBJECT: MAIL_SUBJECT,
    normalizeEmail: normalizeEmail,
    isEmail: isEmail,
    timingEqual: timingEqual,
    hashEmail: hashEmail,
    hashCode: hashCode,
    generateCode: generateCode,
    buildMailText: buildMailText,
    createProof: createProof,
    verifyProof: verifyProof,
    canResend: canResend,
    isExpired: isExpired,
    shouldPurge: shouldPurge,
    PURGE_GRACE_MS: PURGE_GRACE_MS,
    VERIFIED_KEEP_MS: VERIFIED_KEEP_MS,
  };
});
