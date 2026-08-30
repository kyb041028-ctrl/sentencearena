'use strict';

/**
 * 권리침해 비회원 이메일 발송 어댑터.
 * 기존 SMTP/메일 업체가 없으면 발송하지 않는다. 인증번호 원문을 로그에 남기지 않는다.
 */

const core = require('../shared/rights-email-verify-core');

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

function configuredFromEnv() {
  const from = readEnv('RIGHTS_MAIL_FROM') || readEnv('MAIL_FROM') || readEnv('SMTP_FROM');
  const host = readEnv('SMTP_HOST') || readEnv('MAIL_HOST');
  return !!(from && host);
}

function createRightsEmailMailer(options) {
  const opts = options || {};
  let sendFn = typeof opts.send === 'function' ? opts.send : null;

  function setSend(fn) {
    sendFn = typeof fn === 'function' ? fn : null;
  }

  function isConfigured() {
    if (sendFn) return true;
    if (opts.configured === true) return true;
    return false;
  }

  async function sendVerification(input) {
    const src = input || {};
    if (!core.isEmail(src.to)) {
      const err = new Error('CLAIMANT_EMAIL_REQUIRED');
      err.code = 'CLAIMANT_EMAIL_REQUIRED';
      err.status = 400;
      throw err;
    }
    if (!sendFn) {
      const err = new Error('EMAIL_SENDER_UNAVAILABLE');
      err.code = 'EMAIL_SENDER_UNAVAILABLE';
      err.status = 503;
      throw err;
    }
    await sendFn({
      to: core.normalizeEmail(src.to),
      subject: core.MAIL_SUBJECT,
      text: core.buildMailText(src.code),
    });
    return { ok: true };
  }

  return {
    isConfigured: isConfigured,
    setSend: setSend,
    sendVerification: sendVerification,
    configuredFromEnv: configuredFromEnv,
  };
}

module.exports = {
  createRightsEmailMailer: createRightsEmailMailer,
  configuredFromEnv: configuredFromEnv,
};
