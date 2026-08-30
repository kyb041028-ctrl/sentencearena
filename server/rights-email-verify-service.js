'use strict';

const crypto = require('crypto');
const core = require('../shared/rights-email-verify-core');
const { hmacIdentity, readPepper } = require('./retention-identity');

let _repo = null;
let _mailer = null;
let _now = function () { return new Date().toISOString(); };
let _pepper = null;
let _randomInt = function (min, max) { return crypto.randomInt(min, max); };

function setRepository(repo) {
  _repo = repo;
}

function setMailer(mailer) {
  _mailer = mailer || null;
}

function setNow(fn) {
  _now = fn || _now;
}

function setPepper(value) {
  _pepper = value == null ? null : String(value);
}

function setRandomInt(fn) {
  _randomInt = typeof fn === 'function' ? fn : _randomInt;
}

function nowIso() {
  return _now();
}

function nowMs() {
  const t = new Date(nowIso()).getTime();
  return isNaN(t) ? Date.now() : t;
}

function fail(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 400;
  return err;
}

function requireRepo() {
  if (!_repo) throw fail('EMAIL_VERIFY_UNAVAILABLE', 503);
  return _repo;
}

function pepper() {
  return readPepper(_pepper);
}

function requirePepper() {
  const p = pepper();
  if (!p) throw fail('EMAIL_VERIFY_UNAVAILABLE', 503);
  return p;
}

function isMailerConfigured() {
  return !!(!_mailer ? false : typeof _mailer.isConfigured === 'function' && _mailer.isConfigured());
}

async function startChallenge(input) {
  const src = input || {};
  if (!core.isEmail(src.email)) throw fail('CLAIMANT_EMAIL_REQUIRED', 400);
  if (!isMailerConfigured()) throw fail('EMAIL_SENDER_UNAVAILABLE', 503);
  const p = requirePepper();
  const repo = requireRepo();
  const email = core.normalizeEmail(src.email);
  const emailHash = core.hashEmail(hmacIdentity, p, email);
  if (!emailHash) throw fail('EMAIL_VERIFY_UNAVAILABLE', 503);

  const existing = await repo.getByEmailHash(emailHash);
  const ms = nowMs();
  if (existing && !core.canResend(existing.lastSentAt, ms)) {
    throw fail('EMAIL_RESEND_TOO_SOON', 429);
  }

  const code = core.generateCode(_randomInt);
  const now = nowIso();
  const expiresAt = new Date(ms + core.CODE_TTL_MS).toISOString();

  await _mailer.sendVerification({ to: email, code: code });

  await repo.upsertByEmailHash({
    emailHash: emailHash,
    codeHash: core.hashCode(hmacIdentity, p, email, code),
    createdAt: now,
    expiresAt: expiresAt,
    lastSentAt: now,
    failCount: 0,
    verifiedAt: null,
    consumedAt: null,
  });

  return {
    ok: true,
    expiresAt: expiresAt,
    ttlSec: Math.floor(core.CODE_TTL_MS / 1000),
  };
}

async function confirmChallenge(input) {
  const src = input || {};
  if (!core.isEmail(src.email)) throw fail('CLAIMANT_EMAIL_REQUIRED', 400);
  const code = String(src.code == null ? '' : src.code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) throw fail('EMAIL_CODE_INVALID', 400);

  const p = requirePepper();
  const repo = requireRepo();
  const email = core.normalizeEmail(src.email);
  const emailHash = core.hashEmail(hmacIdentity, p, email);
  if (!emailHash) throw fail('EMAIL_VERIFY_UNAVAILABLE', 503);

  const existing = await repo.getByEmailHash(emailHash);
  if (!existing || !existing.codeHash) throw fail('EMAIL_CODE_INVALID', 400);
  if (existing.consumedAt && !existing.verifiedAt) throw fail('EMAIL_CODE_LOCKED', 400);

  const ms = nowMs();
  if (core.isExpired(existing.expiresAt, ms)) throw fail('EMAIL_CODE_EXPIRED', 400);

  const expected = core.hashCode(hmacIdentity, p, email, code);
  if (!expected || !core.timingEqual(expected, existing.codeHash)) {
    const fails = Number(existing.failCount || 0) + 1;
    const now = nowIso();
    if (fails >= core.MAX_FAILURES) {
      await repo.upsertByEmailHash(Object.assign({}, existing, {
        failCount: fails,
        consumedAt: now,
        codeHash: core.hashCode(hmacIdentity, p, email, 'INVALIDATED'),
      }));
      throw fail('EMAIL_CODE_LOCKED', 400);
    }
    await repo.upsertByEmailHash(Object.assign({}, existing, { failCount: fails }));
    throw fail('EMAIL_CODE_INVALID', 400);
  }

  const now = nowIso();
  await repo.upsertByEmailHash(Object.assign({}, existing, {
    verifiedAt: now,
    failCount: existing.failCount || 0,
  }));
  const proof = core.createProof(hmacIdentity, p, email, ms, core.PROOF_TTL_MS);
  if (!proof) throw fail('EMAIL_VERIFY_UNAVAILABLE', 503);
  return {
    ok: true,
    proof: proof,
    message: '이메일 확인이 완료되었습니다.',
  };
}

function assertVerified(input) {
  const src = input || {};
  if (!core.isEmail(src.email)) throw fail('CLAIMANT_EMAIL_REQUIRED', 400);
  if (!src.proof) throw fail('EMAIL_NOT_VERIFIED', 400);
  const p = pepper();
  if (!p) throw fail('EMAIL_NOT_VERIFIED', 400);
  const result = core.verifyProof(hmacIdentity, p, src.email, src.proof, nowMs());
  if (!result.ok) throw fail(result.error || 'EMAIL_NOT_VERIFIED', 400);
  return true;
}

async function purgeExpired(now) {
  if (!_repo || typeof _repo.deleteExpired !== 'function') return { ok: true, deleted: 0 };
  const n = await _repo.deleteExpired(now || nowIso());
  return { ok: true, deleted: n };
}

module.exports = {
  setRepository: setRepository,
  setMailer: setMailer,
  setNow: setNow,
  setPepper: setPepper,
  setRandomInt: setRandomInt,
  isMailerConfigured: isMailerConfigured,
  startChallenge: startChallenge,
  confirmChallenge: confirmChallenge,
  assertVerified: assertVerified,
  purgeExpired: purgeExpired,
  core: core,
};
