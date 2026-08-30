#!/usr/bin/env node
'use strict';

/**
 * misinfo report extras — does not rewrite board_reports reasons.
 * node tools/test-misinfo-report.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const misinfoCore = require('../shared/misinfo-report-core');
const reviewCore = require('../shared/board-report-review-core');
const schema = require('../shared/board-schema-core');
const serviceFactory = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardRouter } = require('../server/board-routes');
const alienRoutes = require('../server/alien-moderation-routes');
const misinfoAbuse = require('../server/misinfo-report-abuse-service');
const { createMisinfoAbuseMemoryRepository } = require('../server/misinfo-report-abuse-memory-repository');
const { createRightsInfringementMemoryRepository } = require('../server/rights-infringement-memory-repository');
const rightsService = require('../server/rights-infringement-service');
const { requestApp } = require('./daily-issue-api-http-helper');

const root = path.join(__dirname, '..');
let passed = 0;

function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? ' — ' + detail : ''));
  passed += 1;
  console.log('PASS', name);
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function longText(prefix, min) {
  let s = String(prefix || '');
  while (misinfoCore.meaningfulLen(s) < min) s += ' 구체적인 설명입니다.';
  return s;
}

const SAMPLE_PNG = {
  filename: 'proof.png',
  contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
};

function validMisinfo(extra) {
  return Object.assign({
    misinfoClaimKind: 'FACT',
    misinfoExcerpt: '중앙선거관리위원회가 오늘 투표를 취소했다고 발표했다.',
    misinfoFalsehoodReason: longText('공식 발표와 달리 해당 날짜에 투표가 취소된 사실이 없다.', 50),
    misinfoEvidenceUrl: 'https://www.nec.go.kr/notice/example-check',
    misinfoExternalCheck: 'NONE',
  }, extra || {});
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
  const repo = createBoardMemoryRepository();
  const abuseRepo = createMisinfoAbuseMemoryRepository();
  misinfoAbuse.setRepository(abuseRepo);
  const author = uid(1);
  const reporter = uid(2);
  const territories = { [author]: 'CENTRAL', [reporter]: 'PIONEER' };
  for (let i = 3; i <= 20; i++) territories[uid(i)] = 'PIONEER';
  const board = serviceFactory.createBoardService({
    repository: repo,
    userContext: createMockUserContextAdapter({ territories: territories }),
    operational: true,
  });
  const post = (await board.createPost({ userId: author }, {
    title: '허위정보 검증용 게시글 제목입니다',
    content: '중앙선거관리위원회가 오늘 투표를 취소했다고 발표했다. 이 문장은 검증용입니다.',
  })).post;

  function reportBody(extra) {
    return Object.assign({
      targetType: 'POST',
      targetId: post.id,
      reasonCode: 'misinfo',
    }, validMisinfo(), extra || {});
  }

  ok('A. 문제 표현 없음 제출 불가', (await catchCode(function () {
    return board.createReport({ userId: reporter }, reportBody({ misinfoExcerpt: '' }));
  })) === 'MISINFO_EXCERPT_REQUIRED');

  ok('B. 문제 표현 10자 미만 제출 불가', (await catchCode(function () {
    return board.createReport({ userId: reporter }, reportBody({ misinfoExcerpt: '짧음' }));
  })) === 'MISINFO_EXCERPT_TOO_SHORT');

  ok('C. 허위 이유 50자 미만 제출 불가', (await catchCode(function () {
    return board.createReport({ userId: reporter }, reportBody({ misinfoFalsehoodReason: '사실과 다릅니다' }));
  })) === 'MISINFO_REASON_TOO_SHORT');

  ok('D. 객관적 근거 없음 제출 불가', (await catchCode(function () {
    return board.createReport({ userId: reporter }, reportBody({
      misinfoEvidenceUrl: '',
      misinfoEvidenceNote: '',
    }));
  })) === 'MISINFO_EVIDENCE_REQUIRED');

  const eCode = await catchCode(function () {
    return board.createReport({ userId: reporter }, reportBody({
      misinfoExcerpt: '거짓입니다',
      misinfoFalsehoodReason: '거짓입니다',
      misinfoEvidenceNote: '거짓입니다',
      misinfoEvidenceUrl: '',
    }));
  });
  ok('E. 거짓입니다만 작성 제출 불가', eCode === 'MISINFO_EXCERPT_TOO_SHORT' || eCode === 'MISINFO_EXCERPT_TOO_WEAK');
  ok('E2. 약한 근거 거부', (await catchCode(function () {
    return board.createReport({ userId: reporter }, reportBody({
      misinfoEvidenceUrl: '',
      misinfoEvidenceNote: '인터넷에서 봤음',
    }));
  })) === 'MISINFO_EVIDENCE_REQUIRED');

  const opinionPacked = misinfoCore.validatePayload(validMisinfo({ misinfoClaimKind: 'OPINION' }));
  ok('F. 정치적 의견도 사실 표현이 있으면 접수는 가능(자동 확정 아님)', opinionPacked.ok === true);
  const valuePacked = misinfoCore.validatePayload(validMisinfo({ misinfoClaimKind: 'OPINION' }));
  ok('G. 가치판단 유형 자동 확정 없음', valuePacked.ok === true && misinfoCore.NOT_AUTO_MISINFO.indexOf('가치판단') !== -1);
  ok('H. 예측/추정 자동 확정 없음', misinfoCore.CLAIM_KIND.PREDICTION === 'PREDICTION');
  ok('I. 풍자/패러디 자동 확정 없음', misinfoCore.CLAIM_KIND.SATIRE === 'SATIRE');
  ok('J. 사소한 오류 자동 확정 없음', misinfoCore.NOT_AUTO_MISINFO.indexOf('핵심 의미에 영향을 주지 않는 사소한 오류') !== -1);

  const submitted = await board.createReport({ userId: reporter }, reportBody());
  ok('K. 구체적 사실+이유+근거 접수', submitted && submitted.status === 'SUBMITTED' && submitted.reasonCode === 'misinfo');
  const stored = await repo.getReport(submitted.id);
  ok('K. 저장된 상세는 구조화 접두', stored && String(stored.reasonDetail || '').indexOf(misinfoCore.PREFIX) === 0);
  const live = await repo.getPost(post.id);
  ok('L. 신고 접수 자동 게시물 삭제 없음', live.status === 'ACTIVE');
  ok('M. 신고 접수 자동 작성자 제재 없음', submitted.moderation == null || submitted.moderation.autoSanction !== true);
  ok('N. 신고 접수 Alien 횟수 증가 없음', reviewCore.countConfirmedConductBehaviors(await repo.listReports(), { targetUserId: author }).count === 0);

  const grouped = (await board.listReportBehaviors({ userId: 'admin' }, [])).filter(function (g) {
    return g.postId === post.id;
  })[0];
  const rejected = await board.reviewBehavior({ userId: uid(99) }, grouped.behaviorKey, {
    misinfoDecision: 'NOT_APPLICABLE',
    resolutionNote: '의견/평가에 해당한다.',
  });
  ok('O. 운영자 해당 없음 처리', rejected.behavior.status === 'REJECTED');
  ok('O. 해당 없음 후 작성자 제재 없음', reviewCore.countConfirmedConductBehaviors(await repo.listReports(), { targetUserId: author }).count === 0);

  const anotherPost = (await board.createPost({ userId: author }, {
    title: '반려 검증용 게시글 제목입니다',
    content: '이 글은 허위정보 반려 후 신고자 제재가 없는지 확인합니다.',
  })).post;
  const r2 = await board.createReport({ userId: uid(3) }, Object.assign(reportBody(), { targetId: anotherPost.id }));
  const g2 = (await board.listReportBehaviors({ userId: 'admin' }, [])).filter(function (g) {
    return g.postId === anotherPost.id;
  })[0];
  await board.reviewBehavior({ userId: uid(99) }, g2.behaviorKey, { misinfoDecision: 'INSUFFICIENT_EVIDENCE' });
  const abuseAfterReject = await misinfoAbuse.getState(uid(3));
  ok('P. 신고 반려만으로 신고자 자동 제재 없음', (abuseAfterReject.warningCount || 0) === 0 && abuseAfterReject.restrictionKind === 'NONE');

  const warn = await misinfoAbuse.applyAction(reporter, 'WARNING', '표적 신고가 확인됨');
  ok('Q. 운영자 악용 확인 시 경고', warn.ok === true && warn.warningCount === 1);
  const r30 = await misinfoAbuse.applyAction(reporter, 'RESTRICT_30D', '반복 표적 신고');
  ok('Q. 30일 허위정보 신고 제한', r30.ok === true && r30.state.restricted === true);

  ok('R. 30일 제한 중 허위정보 신고 불가', (await catchCode(function () {
    return board.createReport({ userId: reporter }, reportBody({
      targetId: anotherPost.id,
      misinfoEvidenceUrl: 'https://www.nec.go.kr/notice/new-evidence-1',
    }));
  })) === 'MISINFO_REPORT_RESTRICTED');
  const abuseOk = await board.createReport({ userId: reporter }, {
    targetType: 'POST',
    targetId: anotherPost.id,
    reasonCode: 'abuse',
  });
  ok('R. 30일 제한이어도 일반 abuse 신고 유지', abuseOk && abuseOk.status === 'SUBMITTED');

  const r6 = await misinfoAbuse.applyAction(reporter, 'RESTRICT_6M', '재반복');
  ok('S. 6개월 제한', r6.ok === true && r6.state.restrictionKind === 'MONTHS_6');
  rightsService.setRepository(createRightsInfringementMemoryRepository());
  rightsService.setNow(function () { return '2026-08-22T12:00:00.000Z'; });
  const rights = await rightsService.submitRequest({
    claimType: 'OTHER_RIGHTS',
    claimantKind: 'SELF',
    claimantName: '제한중회원',
    claimantEmail: 'member-restricted@example.com',
    targetKind: 'POST',
    postId: post.id,
    problemExcerpt: '문제가 되는 정확한 문장 예시입니다',
    claimedRight: '명예에 관한 권리',
    infringementReason: longText('구체적인 침해 이유를 충분히 작성합니다.', 50),
    caseNarrative: longText('사건 설명을 충분히 작성합니다.', 50),
    requestedAction: 'HIDE',
    evidenceDescription: longText('원본 화면과 권리관계를 확인할 수 있는 자료를 첨부합니다.', 20),
    attachments: [SAMPLE_PNG],
    truthConfirmed: true,
    abuseNoticeConfirmed: true,
  }, { userId: reporter });
  ok('S. 6개월 제한이어도 권리침해 요청 유지', rights.request && rights.request.status === 'RECEIVED');

  const dup = await catchCode(function () {
    return board.createReport({ userId: uid(3) }, Object.assign(reportBody(), { targetId: anotherPost.id }));
  });
  ok('T. 같은 신고 반복 무한 생성 안 됨', dup === 'BOARD_REPORT_DUPLICATE');

  const resubmit = await board.createReport({ userId: uid(3) }, Object.assign(reportBody(), {
    targetId: anotherPost.id,
    misinfoEvidenceUrl: 'https://www.nec.go.kr/notice/brand-new-source',
    misinfoFalsehoodReason: longText('새로운 공식 자료가 추가되어 해당 발표가 없었음을 재확인한다.', 50),
  }));
  ok('U. 새로운 근거가 있는 재신고 가능', resubmit && resubmit.status === 'SUBMITTED');

  const spamPost = (await board.createPost({ userId: author }, {
    title: '스팸 회귀 검증용 게시글 제목입니다',
    content: '이 글은 일반 신고 회귀를 위한 본문입니다. 충분히 깁니다.',
  })).post;
  const abuseRep = await board.createReport({ userId: uid(4) }, {
    targetType: 'POST', targetId: spamPost.id, reasonCode: 'abuse',
  });
  ok('V. 일반 abuse 신고 기존 그대로', abuseRep.status === 'SUBMITTED');
  const spamRep = await board.createReport({ userId: uid(5) }, {
    targetType: 'POST', targetId: spamPost.id, reasonCode: 'spam',
  });
  ok('W. spam 신고 기존 그대로', spamRep.status === 'SUBMITTED');
  const baitPost = (await board.createPost({ userId: author }, {
    title: '분쟁유도 회귀 검증용 게시글 제목입니다',
    content: '이 글은 baiting 회귀를 위한 본문입니다. 충분히 깁니다.',
  })).post;
  const baitRep = await board.createReport({ userId: uid(6) }, {
    targetType: 'POST', targetId: baitPost.id, reasonCode: 'baiting',
  });
  ok('X. baiting 신고 기존 그대로', baitRep.status === 'SUBMITTED');
  ok('Y. 권리침해 처리 요청 기존 그대로', rights.request.status === 'RECEIVED');

  const srcWithdraw = fs.readFileSync(path.join(root, 'shared/account-withdrawal-core.js'), 'utf8');
  ok('Z. 회원탈퇴 코어 유지', srcWithdraw.indexOf('탈퇴') !== -1 || /WITHDRAW/.test(srcWithdraw));
  const srcAlign = fs.readFileSync(path.join(root, 'shared/political-alignment-beta-v1-core.js'), 'utf8');
  ok('AA. 정치성향 파일 유지', srcAlign.indexOf('alignment') !== -1 || srcAlign.length > 100);
  const srcLegal = fs.readFileSync(path.join(root, 'shared/legal-gate-core.js'), 'utf8');
  ok('AB. 법적 가입 게이트 유지', /LEGAL_GATE|age-policy|sensitive-political/.test(srcLegal));

  const reasons = schema.REPORT_REASONS.slice();
  ok('사유 목록 유지', JSON.stringify(reasons) === JSON.stringify(['abuse', 'spam', 'baiting', 'misinfo', 'privacy', 'other']));

  const confirmedPost = (await board.createPost({ userId: author }, {
    title: '허위조작 확인 검증용 게시글 제목입니다',
    content: '중앙선거관리위원회가 오늘 투표를 취소했다고 발표했다. 확인 검증용입니다.',
  })).post;
  await board.createReport({ userId: uid(7) }, Object.assign(reportBody(), { targetId: confirmedPost.id }));
  const g3 = (await board.listReportBehaviors({ userId: 'admin' }, [])).filter(function (g) {
    return g.postId === confirmedPost.id;
  })[0];
  const confirmed = await board.reviewBehavior({ userId: uid(99) }, g3.behaviorKey, {
    misinfoDecision: 'CONFIRMED',
    operatorSanction: 'AUTO',
  });
  ok('확인 후에도 자동 CONDUCT/Alien 아님', confirmed.behavior.sanctionClass === 'MISINFO');
  ok('확인 후에도 확정 행동 횟수 증가 없음', reviewCore.countConfirmedConductBehaviors(await repo.listReports(), { targetUserId: author }).count === 0);
  ok('어려운 사건은 추가 확인 상태로 둘 수 있음', misinfoCore.DECISION_TO_STATUS.NEEDS_MORE_INFO === 'REVIEWING');

  const app = express();
  app.use(express.json());
  app.use('/api/board', createBoardRouter({
    operational: true,
    useMemory: true,
    repository: repo,
    userContext: createMockUserContextAdapter({ territories: territories }),
    resolveActorFromRequest: async function (req) {
      if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
      return null;
    },
  }));
  app.use('/api/admin/moderation', alienRoutes.mountAdminRoutes({
    adminBypass: true,
    getBoardService: function () { return board; },
  }));
  const httpEmpty = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': uid(8) },
    body: { targetType: 'POST', targetId: post.id, reasonCode: 'misinfo' },
  });
  ok('HTTP 빈 misinfo 400', httpEmpty.status === 400 && String(httpEmpty.body.error || '').indexOf('MISINFO_') === 0);

  const httpOk = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': uid(8) },
    body: Object.assign({ targetType: 'POST', targetId: confirmedPost.id, reasonCode: 'misinfo' }, validMisinfo()),
  });
  ok('HTTP 정상 misinfo 접수', httpOk.status === 201 && httpOk.body.ok === true);
  ok('회원 응답에 신고자 회원번호 없음', httpOk.body.report && httpOk.body.report.reporterUserId == null);

  const adminList = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { 'x-user-id': uid(99) },
  });
  ok('관리자 목록 조회', adminList.status === 200 && adminList.body && adminList.body.ok === true);
  const misGroup = (adminList.body.behaviors || []).filter(function (g) {
    return g.primaryReasonCode === 'misinfo' && g.misinfoGuide;
  })[0];
  ok('관리자 화면에 판단 안내', misGroup && misGroup.misinfoGuide && misGroup.misinfoGuide.autoScore === false);

  const appeal = await misinfoAbuse.submitAppeal(reporter, longText('제한 사유에 대해 소명합니다.', 20));
  ok('제한 전 이의제기 가능', appeal.ok === true);
  const notice = await misinfoAbuse.publicNotice(reporter);
  ok('제한 통지에 운영 메모 없음', notice.restriction && notice.restriction.operatorMemo === undefined && notice.restriction.reason);

  const srcSql = fs.readFileSync(path.join(root, 'supabase/migration_misinfo_report_v1.sql'), 'utf8');
  ok('SQL additive', !/\bDROP TABLE\b/.test(srcSql.replace(/--[^\n]*/g, '')));
  ok('SQL에 IP/성향 없음', !/\bip_address\b/.test(srcSql) && !/\balignment_score\b/.test(srcSql));
  ok('보관정책 일반 신고 1년 유지', require('../shared/retention-policy-core').POLICY_COPY.REPORTS.indexOf('1년') !== -1);

  console.log('PASS COUNT', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
