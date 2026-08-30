#!/usr/bin/env node
'use strict';

/**
 * Guest rights-infringement email verification.
 * Uses an in-process mailer stub. Does not send real mail. Does not apply Production SQL.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const rightsCore = require('../shared/rights-infringement-core');
const emailCore = require('../shared/rights-email-verify-core');
const service = require('../server/rights-infringement-service');
const emailVerify = require('../server/rights-email-verify-service');
const { createRightsInfringementMemoryRepository } = require('../server/rights-infringement-memory-repository');
const { createRightsEmailVerifyMemoryRepository } = require('../server/rights-email-verify-memory-repository');
const { createRightsEmailMailer } = require('../server/rights-email-mailer');
const {
  mountRightsInfringementPublicRoutes,
  mountRightsInfringementAdminRoutes,
} = require('../server/rights-infringement-routes');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { requestApp } = require('./daily-issue-api-http-helper');

const root = path.join(__dirname, '..');
let passed = 0;
const TEST_PEPPER = 'test-rights-email-pepper-2026';
const KNOWN_CODE = '246801';

function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? ' — ' + detail : ''));
  passed += 1;
  console.log('PASS', name);
}

function uid(n) {
  const hex = String(n).padStart(8, '0');
  return hex + '-0000-4000-8000-000000000000';
}

function longText(prefix, min) {
  let s = String(prefix || '');
  while (s.length < min) s += ' 구체적인 설명입니다.';
  return s;
}

async function catchCode(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e && e.code ? e.code : String(e && e.message ? e.message : e);
  }
}

function containsSecret(value, secret) {
  return JSON.stringify(value).indexOf(secret) !== -1;
}

async function main() {
  let nowMs = Date.parse('2026-08-22T10:00:00.000Z');
  const nowFn = function () { return new Date(nowMs).toISOString(); };
  let lastMail = null;
  const mailer = createRightsEmailMailer({
    send: async function (msg) {
      lastMail = { to: msg.to, subject: msg.subject, text: msg.text };
    },
  });
  const rightsRepo = createRightsInfringementMemoryRepository();
  const emailRepo = createRightsEmailVerifyMemoryRepository();

  emailVerify.setRepository(emailRepo);
  emailVerify.setMailer(mailer);
  emailVerify.setPepper(TEST_PEPPER);
  emailVerify.setNow(nowFn);
  emailVerify.setRandomInt(function () { return Number(KNOWN_CODE); });

  service.setRepository(rightsRepo);
  service.setNow(nowFn);
  service.setEmailVerify(emailVerify);

  const boardRepo = createBoardMemoryRepository();
  const board = createBoardService({
    repository: boardRepo,
    userContext: createMockUserContextAdapter({
      defaultTerritory: 'CENTRAL',
      territories: {},
    }),
    operational: true,
  });
  const author = uid(1);
  const member = uid(2);
  const reporter = uid(3);
  const created = await board.createPost({ userId: author }, {
    title: '이메일 확인 검증용 게시글 제목입니다',
    content: '이 글은 권리침해 이메일 확인 회귀를 위한 본문입니다. 충분히 깁니다.',
  });
  const postId = created.post.id;

  service.setBoardAdapter({
    getPost: function (id) { return boardRepo.getPost(id); },
    getComment: function (id) { return boardRepo.getComment(id); },
    hidePost: function (id, reason) { return boardRepo.hidePostWithReason(id, reason); },
    hideComment: function (id, reason) { return boardRepo.hideCommentWithReason(id, reason); },
    restorePost: function (id, reason) { return boardRepo.restorePostIfReason(id, reason); },
    restoreComment: function (id, reason) { return boardRepo.restoreCommentIfReason(id, reason); },
  });
  const sanctionCalls = [];
  service.setSanctionAdapter({
    applyOperatorDirect: async function (input) {
      sanctionCalls.push(input);
      return { ok: true, queued: true, automaticPermanentBan: false };
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/rights-infringement', mountRightsInfringementPublicRoutes({
    guestLimitPerWindow: 20,
    emailStartLimitPerWindow: 20,
    windowMs: 10 * 60 * 1000,
    now: function () { return nowMs; },
    emailVerify: emailVerify,
  }));
  app.use('/api/admin/rights-infringement', mountRightsInfringementAdminRoutes({
    adminBypass: true,
  }));

  function baseBody(extra) {
    return Object.assign({
      claimType: 'DEFAMATION',
      claimantKind: 'SELF',
      claimantName: '김신청',
      claimantEmail: 'guest-a@example.com',
      targetKind: 'POST',
      postId: postId,
      problemExcerpt: '문제가 되는 정확한 문장 예시입니다',
      claimedRight: '명예에 관한 권리',
      infringementReason: longText('이 글은 제가 어제 뇌물을 받았다고 단정하여 사실과 다릅니다.', 50),
      caseNarrative: longText('게시 시각과 표현 위치를 특정할 수 있고 저는 당사자입니다.', 50),
      requestedAction: 'HIDE',
      evidenceDescription: longText('원본 화면과 권리관계를 확인할 수 있는 자료를 첨부합니다.', 20),
      attachments: [{
        filename: 'proof.png',
        contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      }],
      truthConfirmed: true,
      abuseNoticeConfirmed: true,
      defamationStatement: 'A정치인이 어제 5억원을 뇌물로 받았다.',
      defamationRefersTo: '신청자 본인',
      defamationNature: 'FACT',
      defamationFalsehood: longText('해당 금전 수수는 없었고 날짜와 금액이 사실과 다릅니다.', 30),
      defamationHonorHarm: longText('구체적 범죄 사실 주장으로 사회적 평가가 저하된다고 봅니다.', 30),
    }, extra || {});
  }

  const meta = await requestApp(app, 'GET', '/api/rights-infringement/meta');
  ok('메타 guestEmailVerify', meta.body && meta.body.guestEmailVerify === true);
  ok('메타 첨부 구현', meta.body.fileUpload && meta.body.fileUpload.implemented === true);
  ok('테스트 메일 어댑터 설정됨', emailVerify.isMailerConfigured() === true);

  const aNoProof = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: baseBody(),
  });
  ok('A. 비회원 미인증 제출 불가', aNoProof.status === 400 && aNoProof.body.error === 'EMAIL_NOT_VERIFIED');
  ok('A. 응답에 인증번호 없음', containsSecret(aNoProof.body, KNOWN_CODE) === false);

  const startA = await requestApp(app, 'POST', '/api/rights-infringement/email/start', {
    body: { email: 'guest-a@example.com' },
  });
  ok('인증번호 발송 HTTP', startA.status === 200 && startA.body.ok === true);
  ok('14. 발송 응답에 인증번호 원문 없음', containsSecret(startA.body, KNOWN_CODE) === false);
  ok('13. 메일 제목', lastMail && lastMail.subject === emailCore.MAIL_SUBJECT);
  ok('13. 메일 본문 최소 문구', lastMail && lastMail.text.indexOf('SentenceArena 권리침해 처리 요청을 위한 인증번호입니다.') !== -1);
  ok('13. 메일 유효시간 안내', lastMail && lastMail.text.indexOf('인증번호는 10분 동안 유효합니다.') !== -1);
  ok('13. 메일 무시 안내', lastMail && lastMail.text.indexOf('본인이 요청하지 않았다면 이 이메일을 무시해주세요.') !== -1);
  ok('13. 메일에 광고/성향/신고내용 없음', lastMail &&
    lastMail.text.indexOf('alignment') === -1 &&
    lastMail.text.indexOf('정치') === -1 &&
    lastMail.text.indexOf('문제 부분') === -1);

  const stored = await emailRepo.getByEmailHash(
    emailCore.hashEmail(require('../server/retention-identity').hmacIdentity, TEST_PEPPER, 'guest-a@example.com')
  );
  ok('6. 임시기록에 이메일 원문 없음', stored && !stored.email && stored.emailHash && stored.emailHash.indexOf('@') === -1);
  ok('4. 인증번호 원문 미저장', stored && stored.codeHash && stored.codeHash !== KNOWN_CODE);

  const bWrong = await requestApp(app, 'POST', '/api/rights-infringement/email/confirm', {
    body: { email: 'guest-a@example.com', code: '000000' },
  });
  ok('B. 잘못된 인증번호 실패', bWrong.status === 400 && bWrong.body.error === 'EMAIL_CODE_INVALID');
  ok('B. 실패 응답에 원문 없음', containsSecret(bWrong.body, KNOWN_CODE) === false);

  let locked = null;
  for (let i = 0; i < 4; i++) {
    locked = await requestApp(app, 'POST', '/api/rights-infringement/email/confirm', {
      body: { email: 'guest-a@example.com', code: '111111' },
    });
  }
  ok('C. 5회 실패 폐기', locked.status === 400 && locked.body.error === 'EMAIL_CODE_LOCKED');
  const afterLock = await requestApp(app, 'POST', '/api/rights-infringement/email/confirm', {
    body: { email: 'guest-a@example.com', code: KNOWN_CODE },
  });
  ok('C. 폐기 후 기존 번호 사용 불가', afterLock.status === 400 && afterLock.body.error === 'EMAIL_CODE_LOCKED');

  nowMs += emailCore.RESEND_MIN_MS + 1000;
  const startD = await requestApp(app, 'POST', '/api/rights-infringement/email/start', {
    body: { email: 'guest-d@example.com' },
  });
  ok('D. 재발송 준비', startD.status === 200);
  const tooSoon = await requestApp(app, 'POST', '/api/rights-infringement/email/start', {
    body: { email: 'guest-d@example.com' },
  });
  ok('H. 재발송 60초 제한', tooSoon.status === 429 && tooSoon.body.error === 'EMAIL_RESEND_TOO_SOON');

  const dOk = await requestApp(app, 'POST', '/api/rights-infringement/email/confirm', {
    body: { email: 'guest-d@example.com', code: KNOWN_CODE },
  });
  ok('D. 올바른 인증번호 성공', dOk.status === 200 && dOk.body.ok === true && dOk.body.proof);
  ok('D. 성공 안내', dOk.body.message === '이메일 확인이 완료되었습니다.');
  ok('D. 성공 응답에 인증번호 원문 없음', containsSecret(dOk.body, KNOWN_CODE) === false);

  const proofD = dOk.body.proof;
  const expireStart = await requestApp(app, 'POST', '/api/rights-infringement/email/start', {
    body: { email: 'guest-e@example.com' },
  });
  ok('E. 만료 검증용 발송', expireStart.status === 200);
  nowMs += emailCore.CODE_TTL_MS + 1000;
  const eExpired = await requestApp(app, 'POST', '/api/rights-infringement/email/confirm', {
    body: { email: 'guest-e@example.com', code: KNOWN_CODE },
  });
  ok('E. 10분 만료 인증 실패', eExpired.status === 400 && eExpired.body.error === 'EMAIL_CODE_EXPIRED');

  const mismatch = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: baseBody({
      claimantEmail: 'guest-b@example.com',
      emailProof: proofD,
      claimType: 'OTHER_RIGHTS',
    }),
  });
  ok('F. 인증 이메일과 제출 이메일 다름 거부', mismatch.status === 400 && mismatch.body.error === 'EMAIL_PROOF_MISMATCH');

  const changed = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: baseBody({
      claimantEmail: 'guest-changed@example.com',
      emailProof: proofD,
      claimType: 'OTHER_RIGHTS',
    }),
  });
  ok('G. 인증 후 이메일 변경 시 제출 거부', changed.status === 400 && changed.body.error === 'EMAIL_PROOF_MISMATCH');

  nowMs += emailCore.RESEND_MIN_MS + 1000;
  const resendOk = await requestApp(app, 'POST', '/api/rights-infringement/email/start', {
    body: { email: 'guest-d@example.com' },
  });
  ok('H. 60초 이후 재발송 가능', resendOk.status === 200 && resendOk.body.ok === true);

  const memberOk = await service.submitRequest(baseBody({
    claimantEmail: 'member@example.com',
    claimType: 'OTHER_RIGHTS',
  }), { userId: member });
  ok('I. 회원은 추가 이메일 인증 없음', memberOk.request.status === 'RECEIVED');

  const memberMissing = await catchCode(function () {
    return service.submitRequest(baseBody({
      claimantEmail: 'member@example.com',
      infringementReason: '짧음',
      claimType: 'OTHER_RIGHTS',
    }), { userId: member });
  });
  ok('I. 회원도 기존 신청서 필수항목 유지', memberMissing === 'INFRINGEMENT_REASON_TOO_SHORT');

  const jShort = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: {
      claimType: 'OTHER_RIGHTS',
      claimantKind: 'SELF',
      claimantName: '김신청',
      claimantEmail: 'guest-d@example.com',
      emailProof: proofD,
      targetKind: 'POST',
      postId: postId,
      problemExcerpt: '짧음',
      claimedRight: '권리',
      infringementReason: '짧음',
      caseNarrative: '짧음',
      requestedAction: 'HIDE',
      truthConfirmed: true,
      abuseNoticeConfirmed: true,
    },
  });
  ok('J. 인증만으로 필수 신청서 생략 불가', jShort.status === 400 && jShort.body.ok === false);

  const guestSubmit = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: baseBody({
      claimantEmail: 'guest-d@example.com',
      emailProof: proofD,
      claimType: 'OTHER_RIGHTS',
    }),
  });
  ok('J. 인증+필수항목 충족 시 제출', guestSubmit.status === 201 && guestSubmit.body.ok === true);
  ok('K. 인증 성공만으로 정식 사건 전환 없음', guestSubmit.body.request.status === 'RECEIVED');
  ok('K. 접수 공개 응답에 이메일 없음', guestSubmit.body.request.claimantEmail == null);
  const live = await boardRepo.getPost(postId);
  ok('L. 인증 성공만으로 자동 게시중단 없음', live.status === 'ACTIVE');
  ok('M. 인증 성공만으로 자동 계정제재 없음', guestSubmit.body.request.status === 'RECEIVED' && sanctionCalls.length === 0);

  const dup = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: baseBody({
      claimantEmail: 'guest-d@example.com',
      emailProof: proofD,
      claimType: 'OTHER_RIGHTS',
    }),
  });
  ok('N. 기존 중복 사건 방지 유지', dup.status === 409 && dup.body.error === 'RIGHTS_DUPLICATE_OPEN');

  const allRows = await rightsRepo.listRequests();
  const guestRow = allRows.filter(function (r) {
    return r.claimantEmail === 'guest-d@example.com';
  })[0];
  const warnGuest = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + guestRow.id + '/action', {
    body: { action: 'ABUSE_WARNING', note: '허위 내용 제출이 확인됨' },
  });
  ok('O. 비회원 인증만으로 악용 제재 자동적용 없음', warnGuest.status === 400 && warnGuest.body.error === 'ABUSE_ACTION_REQUIRES_MEMBER');
  const memberRow = allRows.filter(function (r) {
    return r.claimantUserId === member;
  })[0];
  const warnMember = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + memberRow.id + '/action', {
    body: { action: 'ABUSE_WARNING', note: '허위 내용 제출이 확인됨' },
  });
  ok('O. 기존 회원 악용 경고 유지', warnMember.status === 200);

  const extraPost = await board.createPost({ userId: author }, {
    title: '일반 신고 회귀 검증용 게시글 제목입니다',
    content: '이 글은 일반 신고 회귀를 확인하기 위한 본문입니다. 충분히 깁니다.',
  });
  const general = await board.createReport({ userId: reporter }, {
    targetType: 'POST',
    targetId: extraPost.post.id,
    reasonCode: 'abuse',
    reasonDetail: '욕설 신고 회귀',
  });
  ok('P. 일반 신고 회귀', general && general.id && general.status === 'SUBMITTED');

  const srcWithdraw = fs.readFileSync(path.join(root, 'shared/account-withdrawal-core.js'), 'utf8');
  ok('Q. 회원탈퇴 코어 유지', srcWithdraw.indexOf('탈퇴') !== -1 || /WITHDRAW/.test(srcWithdraw));
  const retention = require('../shared/retention-policy-core');
  ok('R. 삭제자료 6개월 보관 유지', String(retention.POLICY_COPY.DELETED_CONTENT || '').indexOf('6개월') !== -1 ||
    JSON.stringify(retention.POLICY_COPY).indexOf('6개월') !== -1);

  nowMs += emailCore.PROOF_TTL_MS + emailCore.PURGE_GRACE_MS;
  const purged = await emailVerify.purgeExpired(nowFn());
  ok('15. 만료 인증 자료 삭제 가능', purged && purged.ok === true);

  const sql = fs.readFileSync(path.join(root, 'supabase/migration_rights_email_verify_v1.sql'), 'utf8');
  ok('SQL에 이메일 해시만 저장', sql.indexOf('email_hash') !== -1 && sql.indexOf('code_hash') !== -1);
  ok('SQL에 IP 컬럼 없음', !/\bip_address\b/.test(sql));
  ok('SQL additive', !/\bDROP TABLE\b/.test(sql.replace(/--[^\n]*/g, '')));

  const srcUi = fs.readFileSync(path.join(root, 'public/rights-infringement/rights-infringement.js'), 'utf8');
  ok('UI 이메일 변경 시 인증 해제', srcUi.indexOf('이메일이 변경되어 다시 인증해야 합니다.') !== -1);
  ok('UI 성공 문구', srcUi.indexOf('이메일 확인이 완료되었습니다.') !== -1);

  const srcService = fs.readFileSync(path.join(root, 'server/rights-email-verify-service.js'), 'utf8');
  ok('서버 코드가 인증번호 console.log 하지 않음', srcService.indexOf('console.log') === -1);

  const unavailableMailer = createRightsEmailMailer();
  ok('발송수단 없으면 미설정', unavailableMailer.isConfigured() === false);

  console.log('PASS COUNT', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
