#!/usr/bin/env node
'use strict';

/**
 * Rights-infringement request v1 — separate from board_reports.
 * Does not call Production Auth delete. Does not enable Alien V1.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const core = require('../shared/rights-infringement-core');
const attachmentCore = require('../shared/rights-attachment-core');
const service = require('../server/rights-infringement-service');
const { createRightsInfringementMemoryRepository } = require('../server/rights-infringement-memory-repository');
const {
  mountRightsInfringementPublicRoutes,
  mountRightsInfringementAdminRoutes,
} = require('../server/rights-infringement-routes');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardDataMapper } = require('../server/board-data-mapper');
const { requestApp } = require('./daily-issue-api-http-helper');

const SAMPLE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SAMPLE_PNG = { filename: 'proof.png', contentBase64: SAMPLE_PNG_B64 };

const root = path.join(__dirname, '..');
let passed = 0;

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

async function main() {
  const now = '2026-08-22T09:00:00.000Z';
  const repo = createRightsInfringementMemoryRepository();
  service.setRepository(repo);
  service.setNow(function () { return now; });

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
  const claimant = uid(2);
  const reporter = uid(3);
  const created = await board.createPost({ userId: author }, {
    title: '권리침해 검증용 게시글 제목입니다',
    content: 'A정치인은 무능하다고 생각한다. 이 문장은 정치적 평가입니다. 전화번호는 없습니다.',
  });
  const postId = created.post.id;
  const originalBody = created.post.content;

  let hiddenPosts = {};
  service.setBoardAdapter({
    getPost: function (id) { return boardRepo.getPost(id); },
    getComment: function (id) { return boardRepo.getComment(id); },
    hidePost: function (id, reason) {
      hiddenPosts[id] = reason;
      return boardRepo.hidePostWithReason(id, reason);
    },
    hideComment: function (id, reason) { return boardRepo.hideCommentWithReason(id, reason); },
    restorePost: function (id, reason) {
      delete hiddenPosts[id];
      return boardRepo.restorePostIfReason(id, reason);
    },
    restoreComment: function (id, reason) { return boardRepo.restoreCommentIfReason(id, reason); },
  });

  let evidenceLinked = null;
  service.setRetentionAdapter({
    getEvidence: async function (id) {
      return { id: id, contentKind: 'POST', sourceContentId: postId };
    },
    getEvidenceBySource: async function () {
      return { id: 'ev-deleted-1', contentKind: 'POST', sourceContentId: postId };
    },
    extendEvidenceRetention: async function (id, until) {
      evidenceLinked = { id: id, until: until };
      return { ok: true };
    },
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
    guestLimitPerWindow: 5,
    windowMs: 10 * 60 * 1000,
  }));
  app.use('/api/admin/rights-infringement', mountRightsInfringementAdminRoutes({
    adminBypass: true,
  }));

  function baseBody(extra) {
    return Object.assign({
      claimType: 'DEFAMATION',
      claimantKind: 'SELF',
      claimantName: '김신청',
      claimantEmail: 'rights-claimant@example.com',
      targetKind: 'POST',
      postId: postId,
      problemExcerpt: '문제가 되는 정확한 문장 예시입니다',
      claimedRight: '명예에 관한 권리',
      infringementReason: longText('이 글은 제가 어제 뇌물을 받았다고 단정하여 사실과 다릅니다.', 50),
      caseNarrative: longText('게시 시각과 표현 위치를 특정할 수 있고 저는 당사자입니다.', 50),
      requestedAction: 'HIDE',
      evidenceDescription: longText('원본 화면과 권리관계를 확인할 수 있는 자료를 첨부합니다.', 20),
      attachments: [SAMPLE_PNG],
      truthConfirmed: true,
      abuseNoticeConfirmed: true,
      defamationStatement: 'A정치인이 어제 5억원을 뇌물로 받았다.',
      defamationRefersTo: '신청자 본인',
      defamationNature: 'FACT',
      defamationFalsehood: longText('해당 금전 수수는 없었고 날짜와 금액이 사실과 다릅니다.', 30),
      defamationHonorHarm: longText('구체적 범죄 사실 주장으로 사회적 평가가 저하된다고 봅니다.', 30),
    }, extra || {});
  }

  ok('A. 빈 종류 제출 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ claimType: '' }));
  })) === 'CLAIM_TYPE_REQUIRED');
  ok('A. 빈 이름 제출 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ claimantName: '' }));
  })) === 'CLAIMANT_NAME_REQUIRED');

  ok('B. 공백만 이름 제출 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ claimantName: '   \n  ' }));
  })) === 'CLAIMANT_NAME_REQUIRED');
  ok('B. 줄바꿈만 이유 제출 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ infringementReason: '\n\n\n' }));
  })) === 'INFRINGEMENT_REASON_TOO_SHORT');

  ok('C. 짧은 침해 이유 제출 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ infringementReason: '기분 나쁨' }));
  })) === 'INFRINGEMENT_REASON_TOO_SHORT');
  ok('C. 기분나쁨 반복은 권리침해 아님', (await catchCode(function () {
    return service.submitRequest(baseBody({
      infringementReason: '기분 나쁨 기분 나쁨 기분 나쁨 기분 나쁨 기분 나쁨 기분 나쁨 기분 나쁨 기분 나쁨 기분 나쁨 기분 나쁨',
      caseNarrative: '처벌해 주세요 처벌해 주세요 처벌해 주세요 처벌해 주세요 처벌해 주세요 처벌해 주세요 처벌해 주세요 처벌해 주세요',
    }));
  })) === 'TRIVIAL_CLAIM_NOT_ALLOWED');
  ok('C. 증빙 파일 없이 회원 접수 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ attachments: [], stagingIds: [], attachmentCount: 0 }), { userId: claimant });
  })) === 'EVIDENCE_FILE_REQUIRED');
  ok('C. 대상 없이 접수 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ postId: null, targetUrl: '', targetKind: 'POST' }), { userId: claimant });
  })) === 'TARGET_POST_REQUIRED');
  ok('C. 삭제해주세요 만으로 제출 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({
      problemExcerpt: '삭제해주세요',
      infringementReason: '신고합니다',
      caseNarrative: '기분 나쁨',
    }));
  })) !== null);

  ok('D. 확인 미체크 제출 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ abuseNoticeConfirmed: false, truthConfirmed: false }));
  })) === 'TRUTH_CONFIRMATION_REQUIRED');

  ok('E. 명예훼손 문제 문장 필수', (await catchCode(function () {
    return service.submitRequest(baseBody({ defamationStatement: '' }));
  })) === 'DEFAMATION_STATEMENT_REQUIRED');
  ok('E. 거짓입니다 한마디 불가', (await catchCode(function () {
    return service.submitRequest(baseBody({ defamationFalsehood: '거짓입니다' }));
  })) === 'DEFAMATION_FALSEHOOD_TOO_SHORT');

  ok('F. 개인정보 공개정보 필수', (await catchCode(function () {
    return service.submitRequest(baseBody({
      claimType: 'PRIVACY',
      privacyInfoType: '',
      privacyWhose: '본인',
      privacyLocation: '본문 첫 문단',
      privacyBasis: '제 전화번호와 일치합니다',
      privacyConsent: 'NO',
      privacyHarm: '직장에 연락이 오고 있습니다',
    }));
  })) === 'PRIVACY_INFO_TYPE_REQUIRED');
  ok('F. 개인정보 피해 설명 필수', (await catchCode(function () {
    return service.submitRequest(baseBody({
      claimType: 'PRIVACY',
      privacyInfoType: '휴대전화번호와 집주소',
      privacyWhose: '본인',
      privacyLocation: '본문 첫 문단 전화번호 위치',
      privacyBasis: '제 휴대전화번호와 일치하며 본인 명의입니다',
      privacyConsent: 'NO',
      privacyHarm: '',
    }));
  })) === 'PRIVACY_HARM_REQUIRED');

  ok('G. 저작권 권리 근거 필수', (await catchCode(function () {
    return service.submitRequest(baseBody({
      claimType: 'COPYRIGHT',
      copyrightWork: '제가 촬영하고 편집한 원본 사진 저작물입니다',
      copyrightBasis: '',
      copyrightSource: 'https://example.com/original',
      copyrightPortion: '게시글에 첨부된 이미지 전체',
      copyrightLicensed: 'NO',
      evidenceDescription: longText('원본 촬영 파일과 게시 일시를 설명할 수 있습니다.', 20),
    }));
  })) === 'COPYRIGHT_BASIS_REQUIRED');

  const httpEmpty = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: { claimType: 'DEFAMATION' },
  });
  ok('A/D HTTP 빈칸 400', httpEmpty.status === 400 && httpEmpty.body && httpEmpty.body.ok === false);

  const submitted = await service.submitRequest(baseBody(), { userId: claimant });
  ok('I. 접수 상태 RECEIVED', submitted.request.status === 'RECEIVED');
  ok('I. 공개 응답에 회원번호/이메일 없음',
    submitted.request.claimantUserId == null &&
    submitted.request.claimantEmail == null &&
    submitted.request.caseNumber &&
    Object.keys(submitted.request).join(',').indexOf('email') === -1);
  ok('I. 접수만으로 자동 삭제 없음', submitted.autoDeleted === false);
  ok('I. 접수만으로 자동 제재 없음', submitted.autoSanctioned === false);
  const liveAfterSubmit = await boardRepo.getPost(postId);
  ok('I. 게시글 상태 유지 ACTIVE', liveAfterSubmit.status === 'ACTIVE' && liveAfterSubmit.content === originalBody);
  ok('N. 정치적 비판 자동 판정/삭제 없음', liveAfterSubmit.status === 'ACTIVE');

  const dup = await catchCode(function () {
    return service.submitRequest(baseBody(), { userId: claimant });
  });
  ok('H. 동일 사건 진행 중 반복 제출 차단', dup === 'RIGHTS_DUPLICATE_OPEN');
  const afterDup = await repo.listRequests();
  ok('H. 새 사건 무한생성 안 됨', afterDup.length === 1);

  const listed = await requestApp(app, 'GET', '/api/admin/rights-infringement/requests');
  ok('J. 관리자 목록 접수 확인', listed.status === 200 && listed.body.ok === true && listed.body.requests.length === 1);
  const reqId = listed.body.requests[0].id;
  ok('진입 사건번호', !!listed.body.requests[0].caseNumber);

  const tooEarlyHide = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'TEMP_TAKEDOWN' },
  });
  ok('I. 접수 단계에서 임시중단 불가', tooEarlyHide.status === 400);

  const convert = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'CONVERT_FORMAL', note: '당사자·대상·문제부분·이유가 구체적이다.' },
  });
  ok('J. 정식 사건 전환', convert.status === 200 && convert.body.ok === true && convert.body.request.status === 'FORMAL_CASE');
  ok('J. 전환 후에도 자동 제재 없음', convert.body.autoSanctioned === false);
  const stillLive = await boardRepo.getPost(postId);
  ok('J. 정식 전환만으로 원문 삭제 없음', stillLive.status === 'ACTIVE');

  const takedown = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'TEMP_TAKEDOWN' },
  });
  ok('K. 임시 게시중단', takedown.status === 200 && takedown.body.request.status === 'TEMP_TAKEDOWN');
  const hiddenRow = await boardRepo.getPost(postId);
  ok('K. 원문 상태 숨김', hiddenRow.status === 'HIDDEN_BY_OPERATOR' && hiddenRow.blindReason === 'RIGHTS_TEMP_TAKEDOWN');
  const mapped = createBoardDataMapper().mapPostForViewer(hiddenRow, reporter);
  ok('K. 일반 사용자 원문 숨김', mapped.content === core.TAKEDOWN_NOTICE && mapped.content !== originalBody);
  ok('K. 최대 30일', core.TAKEDOWN_MAX_DAYS === 30 && !!takedown.body.request.tempTakedown);

  const notices = await service.listAuthorNotices(author);
  ok('작성자 통지 존재', notices.length === 1 && notices[0].id === reqId);
  ok('M. 작성자 통지에 신청자 이메일 없음', !notices[0].claimantEmail && JSON.stringify(notices[0]).indexOf('rights-claimant@example.com') === -1);
  ok('M. 작성자 통지에 내부 회원번호 없음', JSON.stringify(notices[0]).indexOf(claimant) === -1);
  ok('작성자 통지에 증빙/운영메모 없음', !notices[0].evidenceDescription && !notices[0].operatorNotes);

  ok('L. 빈 이의제기 불가', (await catchCode(function () {
    return service.submitObjection(author, reqId, { ground: 'POLITICAL_OPINION', explanation: '  ' });
  })) === 'OBJECTION_TOO_SHORT');
  ok('L. 한두 글자 이의제기 불가', (await catchCode(function () {
    return service.submitObjection(author, reqId, { ground: 'POLITICAL_OPINION', explanation: '아니요' });
  })) === 'OBJECTION_TOO_SHORT');
  const objection = await service.submitObjection(author, reqId, {
    ground: 'POLITICAL_OPINION',
    explanation: longText('해당 문장은 정치인에 대한 평가이며 구체적 범죄 사실 주장이 아닙니다.', 50),
  });
  ok('L. 30일 이의제기 제출', objection.ok === true);
  const afterObj = await repo.getRequest(reqId);
  ok('L. 상태 AUTHOR_OBJECTED', afterObj.status === 'AUTHOR_OBJECTED');

  const otherUser = await catchCode(function () {
    return service.submitObjection(reporter, reqId, {
      ground: 'OTHER',
      explanation: longText('다른 사람이 이의제기하면 안 됩니다.', 50),
    });
  });
  ok('L. 작성자만 이의제기', otherUser === 'RIGHTS_OBJECTION_FORBIDDEN');

  const complete = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'COMPLETE', note: '양측 자료를 확인했고 운영자가 법적 진실을 확정하지는 않는다.' },
  });
  ok('처리 완료', complete.status === 200 && complete.body.request.status === 'COMPLETED');
  ok('S. 정식 사건 5년 보관', core.FORMAL_RETENTION_YEARS === 5);
  const completedRow = await repo.getRequest(reqId);
  ok('S. 정식 완료 retention 5년', completedRow.isFormal === true && String(completedRow.retentionUntil).indexOf('2031-') === 0);

  const adminDetail = await requestApp(app, 'GET', '/api/admin/rights-infringement/requests/' + reqId);
  ok('신청자 이메일은 관리자만', adminDetail.body.request.claimantEmail === 'rights-claimant@example.com');
  ok('정치성향 미저장', adminDetail.body.request.alignmentScore == null && JSON.stringify(adminDetail.body.request).indexOf('alignmentScore') === -1);
  ok('정치적 비판 보호 문구', String(adminDetail.body.request.politicalProtection).indexOf('권리침해 사유가 아니다') !== -1);

  const rejectedBody = baseBody({
    claimantEmail: 'second@example.com',
    postId: postId,
    infringementReason: longText('두 번째 접수 후 반려 검증용 구체적인 침해 이유입니다.', 50),
  });
  const second = await service.submitRequest(rejectedBody, { userId: uid(4) });
  const secondId = (await repo.listRequests()).filter(function (r) { return r.caseNumber === second.request.caseNumber; })[0].id;
  const reject = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + secondId + '/action', {
    body: {
      action: 'REJECT_INTAKE',
      rejectionCode: 'POLITICAL_DISAGREEMENT',
      note: '대상이 권리침해 요청 요건에 명백히 해당하지 않는다.',
    },
  });
  ok('O. 반려 가능', reject.status === 200 && reject.body.request.status === 'INTAKE_REJECTED');
  const rejectedDetail = await requestApp(app, 'GET', '/api/admin/rights-infringement/requests/' + secondId);
  ok('O. 반려 사유 코드 기록', rejectedDetail.body.request.rejectionCode === 'POLITICAL_DISAGREEMENT');
  ok('O. 신청자에게 보이는 안내와 내부 메모 분리',
    rejectedDetail.body.request.publicRejectionNote &&
    String(rejectedDetail.body.request.operatorNotes).indexOf('명백히') !== -1);
  const abuseAfterReject = await repo.getAbuseState(uid(4));
  ok('O. 반려만으로 자동 악용 제재 없음', (abuseAfterReject.warningCount || 0) === 0 && abuseAfterReject.restrictionKind === 'NONE');
  ok('비정식 접수 1년 보관', core.INTAKE_RETENTION_YEARS === 1);
  const rejectedRow = await repo.getRequest(secondId);
  ok('비정식 최종 처리 1년', String(rejectedRow.retentionUntil).indexOf('2027-') === 0);

  const repeatRejected = await catchCode(function () {
    return service.submitRequest(rejectedBody, { userId: uid(4) });
  });
  ok('H. 반려 후 새 근거 없이 재신청 차단', repeatRejected === 'RIGHTS_DUPLICATE_REJECTED');
  const resubmit = await service.submitRequest(Object.assign({}, rejectedBody, {
    newEvidenceDescription: longText('새로운 원본 자료와 촬영 일시를 추가로 제출합니다.', 20),
    infringementReason: longText('새로운 사유로 해당 표현의 사실 관계를 더 구체적으로 특정합니다.', 60),
  }), { userId: uid(4) });
  ok('H. 새 자료가 있으면 재신청 가능', resubmit.request.status === 'RECEIVED');

  const warn = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'ABUSE_WARNING', note: '허위 내용 제출이 확인됨' },
  });
  ok('P. 운영자 확인 후 악용 경고', warn.status === 200);
  const abuse1 = await repo.getAbuseState(claimant);
  ok('P. 1회 경고 기록', abuse1.warningCount === 1);

  const r30 = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'RESTRICT_30D' },
  });
  ok('P. 반복 시 30일 제한', r30.status === 200);
  const abuse30 = await repo.getAbuseState(claimant);
  ok('P. 30일 제한 활성', core.isRestrictionActive(abuse30, now) === true && abuse30.restrictionKind === 'DAYS_30');

  const r6 = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'RESTRICT_6M' },
  });
  ok('P. 재반복 시 6개월 제한', r6.status === 200);
  const abuse6 = await repo.getAbuseState(claimant);
  ok('P. 6개월 제한', abuse6.restrictionKind === 'MONTHS_6');

  const blocked = await catchCode(function () {
    return service.submitRequest(baseBody({
      claimantEmail: 'restricted@example.com',
      claimType: 'OTHER_RIGHTS',
    }), { userId: claimant });
  });
  ok('P. 제한 중 권리침해 요청 거부', blocked === 'RIGHTS_REQUEST_RESTRICTED');

  const noAutoBan = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'SANCTION_REVIEW', sanctionAction: 'PERMANENT_BAN' },
  });
  ok('Q. 자동 영구정지 없음', noAutoBan.status === 400 && noAutoBan.body.error === 'PERMANENT_BAN_NOT_AUTOMATIC');
  const handoff = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'SANCTION_REVIEW', sanctionAction: 'TEMP_SUSPEND', confirmPermanent: false },
  });
  ok('Q. 중대한 악용은 기존 제재 검토 가능', handoff.status === 200 && handoff.body.automaticPermanentBan === false);
  ok('Q. 영구정지 자동 호출 없음', sanctionCalls.every(function (c) { return c.action !== 'PERMANENT_BAN'; }));

  const link = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + reqId + '/action', {
    body: { action: 'LINK_EVIDENCE', evidenceId: 'ev-deleted-1' },
  });
  ok('R. 삭제 콘텐츠 증거 운영자 연결', link.status === 200 && evidenceLinked && evidenceLinked.id === 'ev-deleted-1');

  const guestBlocked = await requestApp(app, 'POST', '/api/rights-infringement/requests', {
    body: baseBody({
      claimantEmail: 'guest@example.com',
      claimantName: '비회원신청',
      claimType: 'OTHER_RIGHTS',
      targetUrl: 'https://sentencearena.example/p/' + postId,
      postId: postId,
    }),
  });
  ok('비회원 발송수단 없으면 접수 완료 안 함', guestBlocked.status === 503 && guestBlocked.body.error === 'GUEST_VERIFICATION_UNAVAILABLE');

  const suppMember = await service.submitRequest(baseBody({
    claimantEmail: 'supplement@example.com',
    claimType: 'OTHER_RIGHTS',
    targetUrl: 'https://sentencearena.example/p/' + postId,
    postId: postId,
  }), { userId: uid(9) });
  const supplementId = (await repo.listRequests()).filter(function (r) {
    return r.caseNumber === suppMember.request.caseNumber;
  })[0].id;
  const supp = await requestApp(app, 'POST', '/api/admin/rights-infringement/requests/' + supplementId + '/action', {
    body: { action: 'REQUEST_SUPPLEMENT', note: '문제가 되는 부분을 문장 단위로 보완하세요.' },
  });
  ok('보완 요청', supp.status === 200 && supp.body.request.status === 'NEEDS_SUPPLEMENT');

  const highRisk = core.isHighRiskPrivacy({ privacyInfoType: '집주소와 전화번호' });
  ok('고위험 개인정보 표시 기준', highRisk === true);

  const privacySubmit = await service.submitRequest(baseBody({
    claimantEmail: 'privacy@example.com',
    claimType: 'PRIVACY',
    privacyInfoType: '휴대전화번호와 집주소',
    privacyWhose: '본인',
    privacyLocation: '게시글 본문 두 번째 문단',
    privacyBasis: '제 휴대전화번호와 일치하고 본인 명의입니다',
    privacyConsent: 'NO',
    privacyHarm: '모르는 사람에게 전화가 걸려 오고 있습니다',
  }), { userId: uid(8) });
  const privacyRow = (await repo.listRequests()).filter(function (r) {
    return r.caseNumber === privacySubmit.request.caseNumber;
  })[0];
  ok('F. 개인정보 정상 제출', privacySubmit.request.status === 'RECEIVED' && privacyRow.highRiskPrivacy === true);

  const legalHoldRow = Object.assign({}, rejectedRow, { legalHold: true, status: 'INTAKE_REJECTED', retentionUntil: '2020-01-01T00:00:00.000Z' });
  ok('법적 보전 시 자동삭제 제외', core.shouldPurge(legalHoldRow, now) === false);

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
  ok('T. 일반 신고 기존 동작', general && general.id && general.status === 'SUBMITTED' && general.reasonCode === 'abuse');
  const reports = await boardRepo.listReports({});
  ok('T. 권리침해는 board_reports에 넣지 않음', reports.length === 1 && reports[0].id === general.id);

  const srcCore = fs.readFileSync(path.join(root, 'shared/rights-infringement-core.js'), 'utf8');
  const srcIndex = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const srcGuide = fs.readFileSync(path.join(root, 'public/permissions-guide.js'), 'utf8');
  const srcSql = fs.readFileSync(path.join(root, 'supabase/migration_rights_infringement_v1.sql'), 'utf8');
  const srcWithdraw = fs.readFileSync(path.join(root, 'shared/account-withdrawal-core.js'), 'utf8');
  const srcLegal = fs.readFileSync(path.join(root, 'shared/legal-gate-core.js'), 'utf8');
  const srcAlien = fs.readFileSync(path.join(root, 'server/alien-moderation-v1-flag.js'), 'utf8');
  ok('악용 안내에 무고죄 없음', srcCore.indexOf('무고죄') === -1 && core.ABUSE_NOTICE_BODY.indexOf('무고죄') === -1);
  ok('최종 확인 문구', core.CONFIRM_TEXT.indexOf('권리침해 처리 목적으로 신청') !== -1);
  ok('일반 신고 분리 UI', srcIndex.indexOf('sc-report-modal-path-general') !== -1 && srcIndex.indexOf('sc-report-modal-path-rights') !== -1);
  ok('별도 권리침해 메뉴', srcGuide.indexOf('/rights-infringement/') !== -1);
  const sqlBody = srcSql.replace(/--[^\n]*/g, '');
  ok('권리침해 SQL additive', !/\bDROP TABLE\b/.test(sqlBody) && !/\bTRUNCATE\b/.test(sqlBody) && !/^\s*DELETE FROM\b/m.test(sqlBody));
  ok('권리침해 SQL에 IP/성향 컬럼 없음', !/\bip_address\b/.test(srcSql) && !/\balignment_score\b/.test(srcSql));
  ok('U. 회원탈퇴 코어 유지', /withdraw_account_anonymize|WITHDRAW/.test(srcWithdraw) || srcWithdraw.indexOf('탈퇴') !== -1);
  ok('W. 법적 가입 게이트 유지', /LEGAL_GATE|age-policy|sensitive-political/.test(srcLegal));
  ok('V. 정치성향 키 strip', core.stripPolitical({ alignmentScore: 12, claimantName: 'x' }).alignmentScore === undefined);
  ok('보관정책 일반 신고 1년 유지', require('../shared/retention-policy-core').POLICY_COPY.REPORTS.indexOf('1년') !== -1);
  ok('ALIEN_MODERATION_V1 파일 유지', /ALIEN_MODERATION/.test(srcAlien) || srcAlien.indexOf('V1') !== -1);

  const publicMeta = await requestApp(app, 'GET', '/api/rights-infringement/meta');
  ok('공개 메타 첨부 구현', publicMeta.body.fileUpload && publicMeta.body.fileUpload.implemented === true);
  ok('공개 메타 비회원 인증 미연결', publicMeta.body.guestEmailVerify === false && publicMeta.body.guestVerificationStatus === 'UNAVAILABLE');
  ok('공개 메타에 악용 안내', publicMeta.body.abuseNoticeTitle === core.ABUSE_NOTICE_TITLE);

  const exeBlocked = attachmentCore.validateOne({
    filename: 'malware.exe',
    bytes: Buffer.from('MZ' + 'A'.repeat(32)),
  });
  ok('실행파일 차단', exeBlocked.ok === false && exeBlocked.error === 'ATTACHMENT_TYPE_BLOCKED');
  ok('첨부는 공개 필드 아님', typeof attachmentCore.mapPublicMeta({ id: 'a', filename: 'x.png', bytes: Buffer.from('x') }).bytes === 'undefined');

  const publicAtt = await requestApp(app, 'GET', '/api/rights-infringement/me/requests/' + reqId + '/attachments/none');
  ok('첨부 일반 사용자 인증 없이 차단', publicAtt.status === 401 || publicAtt.status === 400 || publicAtt.status === 403);

  const adminAttList = await requestApp(app, 'GET', '/api/admin/rights-infringement/requests/' + reqId);
  ok('관리자 상세에 증빙 메타', Array.isArray(adminAttList.body.request.attachments) && adminAttList.body.request.attachments.length >= 1);
  ok('관리자 상세에 파일 원문 없음', JSON.stringify(adminAttList.body.request.attachments).indexOf(SAMPLE_PNG_B64) === -1);
  ok('허위확정과 단순 접수횟수 구분',
    adminAttList.body.request.confirmedAbuseCount >= 1 &&
    adminAttList.body.request.claimantRequestCount >= adminAttList.body.request.confirmedAbuseCount);

  const srcAuth = fs.readFileSync(path.join(root, 'public/auth.js'), 'utf8');
  ok('18. auth.js 미변경 확인용 파일 존재', srcAuth.indexOf('signInWithOAuth') !== -1);

  console.log('PASS COUNT', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
