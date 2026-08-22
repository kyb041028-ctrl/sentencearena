#!/usr/bin/env node
'use strict';

/**
 * 관리자 신고 검토 분리 · 확정 위반 행동 단위 계산
 * node tools/test-board-report-review.js
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const express = require('express');
const reviewCore = require('../shared/board-report-review-core');
const schema = require('../shared/board-schema-core');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardRouter } = require('../server/board-routes');
const alienRoutes = require('../server/alien-moderation-routes');
const alienService = require('../server/alien-moderation-service');
const { requestApp } = require('./daily-issue-api-http-helper');
const teardown = require('./test-process-teardown');

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('PASS', label);
  } else {
    fail += 1;
    console.log('FAIL', label + (detail ? ' — ' + detail : ''));
  }
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function countFor(reports, authorId) {
  return reviewCore.countConfirmedConductBehaviors(reports, { targetUserId: authorId }).count;
}

async function main() {
  const author = uid(1);
  const repo = createBoardMemoryRepository();
  const territories = { [author]: 'CENTRAL' };
  for (let i = 2; i <= 40; i++) territories[uid(i)] = 'PIONEER';
  const userContext = createMockUserContextAdapter({ territories: territories });
  const service = createBoardService({ repository: repo, userContext: userContext, operational: true });

  const postA = (await service.createPost({ userId: author }, { title: '게시글 A 제목입니다', content: '본문 A입니다' })).post;
  const postB = (await service.createPost({ userId: author }, { title: '게시글 B 제목입니다', content: '본문 B입니다' })).post;
  const postC = (await service.createPost({ userId: author }, { title: '게시글 C 제목입니다', content: '본문 C입니다' })).post;
  const postD = (await service.createPost({ userId: author }, { title: '게시글 D 제목입니다', content: '본문 D입니다' })).post;
  const commentPack = await service.createComment({ userId: author }, postB.id, { content: '댓글 B입니다' });
  const commentB = commentPack.comment || commentPack;

  for (let i = 0; i < 10; i++) {
    await service.createReport({ userId: uid(10 + i) }, {
      targetType: 'POST',
      targetId: postA.id,
      reasonCode: 'abuse',
    });
  }
  const groupedA = (await service.listReportBehaviors({ userId: 'admin' }, {})).filter(function (g) {
    return g.postId === postA.id;
  })[0];
  ok('A. 같은 글 10건은 행동 1개', groupedA && groupedA.reportCount === 10);
  ok('A. 접수만으로 확정 위반 0', countFor(await repo.listReportsByTargetAuthor(author), author) === 0);
  await service.reviewBehavior({ userId: uid(99) }, groupedA.behaviorKey, { status: 'ACCEPTED', resolutionNote: '욕설 확인' });
  ok('A. 위반 인정 후 확정 위반 1회', countFor(await repo.listReportsByTargetAuthor(author), author) === 1);

  for (let i = 0; i < 5; i++) {
    await service.createReport({ userId: uid(20 + i) }, {
      targetType: 'COMMENT',
      targetId: commentB.id,
      reasonCode: 'baiting',
    });
  }
  const groupedComment = (await service.listReportBehaviors({ userId: 'admin' }, {})).filter(function (g) {
    return g.commentId === commentB.id;
  })[0];
  ok('B. 같은 댓글 5건은 행동 1개', groupedComment && groupedComment.reportCount === 5);
  await service.reviewBehavior({ userId: uid(99) }, groupedComment.behaviorKey, { status: 'ACCEPTED' });
  ok('B. 댓글 위반 인정 후 확정 위반 2회', countFor(await repo.listReportsByTargetAuthor(author), author) === 2);

  await service.createReport({ userId: uid(30) }, { targetType: 'POST', targetId: postC.id, reasonCode: 'abuse' });
  const keyC = reviewCore.behaviorKeyFromParts('POST', postC.id);
  await service.reviewBehavior({ userId: uid(99) }, keyC, { status: 'ACCEPTED' });
  ok('C. 서로 다른 글 3개 확정 위반 3회', countFor(await repo.listReportsByTargetAuthor(author), author) === 3);

  await service.createReport({ userId: uid(31) }, { targetType: 'POST', targetId: postD.id, reasonCode: 'abuse' });
  ok('D. 접수 상태는 확정 위반 증가 없음', countFor(await repo.listReportsByTargetAuthor(author), author) === 3);
  const keyD = reviewCore.behaviorKeyFromParts('POST', postD.id);
  await service.reviewBehavior({ userId: uid(99) }, keyD, { status: 'REVIEWING' });
  ok('E. 검토 중은 확정 위반 증가 없음', countFor(await repo.listReportsByTargetAuthor(author), author) === 3);
  await service.reviewBehavior({ userId: uid(99) }, keyD, { status: 'REJECTED', resolutionNote: '위반 아님' });
  ok('F. 위반 아님은 확정 위반 0 추가', countFor(await repo.listReportsByTargetAuthor(author), author) === 3);

  ok('G. 욕설/분쟁유도는 CONDUCT', reviewCore.classifySanctionClass('abuse') === 'CONDUCT' && reviewCore.classifySanctionClass('baiting') === 'CONDUCT');

  const spamPost = (await service.createPost({ userId: author }, { title: '광고 글 제목입니다', content: '광고 본문입니다' })).post;
  await service.createReport({ userId: uid(32) }, { targetType: 'POST', targetId: spamPost.id, reasonCode: 'spam' });
  const spamGroup = await service.reviewBehavior({ userId: uid(99) }, reviewCore.behaviorKeyFromParts('POST', spamPost.id), { status: 'ACCEPTED' });
  ok('H. spam 확정은 서비스 훼손', spamGroup.behavior && spamGroup.behavior.sanctionClass === 'SERVICE_HARM');
  ok('H. spam은 외계행 누적 0', countFor(await repo.listReportsByTargetAuthor(author), author) === 3);

  async function acceptReason(code, n) {
    const p = (await service.createPost({ userId: author }, { title: '사유 ' + code + ' 글 제목', content: '본문입니다 ' + code })).post;
    await service.createReport({ userId: uid(n) }, {
      targetType: 'POST',
      targetId: p.id,
      reasonCode: code,
      reasonDetail: code === 'other' ? '기타 상세' : null,
      misinfoClaimKind: code === 'misinfo' ? 'FACT' : undefined,
      misinfoExcerpt: code === 'misinfo' ? '중앙선거관리위원회가 오늘 투표를 취소했다고 발표했다.' : undefined,
      misinfoFalsehoodReason: code === 'misinfo' ? '공식 발표와 달리 해당 날짜에 투표가 취소된 사실이 없으며 선거 일정은 그대로 유지되고 있습니다. 구체적인 사실 확인 결과입니다.' : undefined,
      misinfoEvidenceUrl: code === 'misinfo' ? 'https://www.nec.go.kr/notice/example-check' : undefined,
      misinfoExternalCheck: code === 'misinfo' ? 'NONE' : undefined,
    });
    return service.reviewBehavior({ userId: uid(99) }, reviewCore.behaviorKeyFromParts('POST', p.id), { status: 'ACCEPTED' });
  }
  const mis = await acceptReason('misinfo', 33);
  ok('I. 허위정보는 자동 제재 아님', mis.behavior.sanctionClass === 'MISINFO' && countFor(await repo.listReportsByTargetAuthor(author), author) === 3);
  const priv = await acceptReason('privacy', 34);
  ok('J. 개인정보는 자동 제재 아님', priv.behavior.sanctionClass === 'RIGHTS' && countFor(await repo.listReportsByTargetAuthor(author), author) === 3);
  const oth = await acceptReason('other', 35);
  ok('K. 기타는 자동 제재 아님', oth.behavior.sanctionClass === 'OTHER' && countFor(await repo.listReportsByTargetAuthor(author), author) === 3);

  alienService.setV1Enabled(false);
  const app = express();
  app.use(express.json());
  app.use(
    '/api/board',
    createBoardRouter({
      operational: true,
      useMemory: true,
      repository: repo,
      userContext: userContext,
      resolveActorFromRequest: async function (req) {
        if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
        return null;
      },
    }),
  );
  app.use(
    '/api/admin/moderation',
    alienRoutes.mountAdminRoutes({
      adminBypass: true,
      getBoardService: function () {
        return service;
      },
    }),
  );

  const adminList = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { 'x-user-id': uid(99) },
  });
  ok('L. Alien OFF여도 관리자 목록 200', adminList.status === 200 && adminList.body.ok === true && Array.isArray(adminList.body.behaviors));
  ok('L. 관리자 화면에 신고 수 포함', (adminList.body.behaviors || []).some(function (g) { return g.reportCount >= 10; }));
  ok('L. alienV1Enabled false', adminList.body.alienV1Enabled === false);
  ok('L. 관리자 현재 제재 필드', (adminList.body.behaviors || []).some(function (g) { return g.currentSanction && typeof g.currentSanction.sanctionType === 'string'; }));
  ok('L. 관리자 이의신청 배열', Array.isArray(adminList.body.appeals));
  ok('L. 관리자 활성 제재 배열', Array.isArray(adminList.body.activeSanctions));

  const reviewRes = await requestApp(app, 'POST', '/api/admin/moderation/behaviors/review', {
    headers: { 'x-user-id': uid(99) },
    body: { behaviorKey: keyD, status: 'RESOLVED', resolutionNote: '처리' },
  });
  ok('L. Alien OFF여도 검토 처리 가능', reviewRes.status === 200 && reviewRes.body.ok === true);

  const memberReportPost = (await service.createPost({ userId: author }, { title: '회원 응답 글 제목입니다', content: '본문입니다' })).post;
  const memberRes = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': uid(36) },
    body: { targetType: 'POST', targetId: memberReportPost.id, reasonCode: 'abuse' },
  });
  const memberJson = JSON.stringify(memberRes.body);
  ok('M. 회원 신고 성공', memberRes.status === 201 && memberRes.body.report && memberRes.body.report.id);
  ok(
    'M. 회원 응답에 내부 회원번호 없음',
    memberJson.indexOf('targetAuthorUserId') === -1
      && memberJson.indexOf('reporterUserId') === -1
      && memberJson.indexOf('reviewedBy') === -1
      && memberJson.indexOf(author) === -1,
  );
  ok('M. mapReportForMember 유지', typeof schema.mapReportForMember === 'function');

  let dup = null;
  try {
    await service.createReport({ userId: uid(10) }, { targetType: 'POST', targetId: postA.id, reasonCode: 'spam' });
  } catch (e) {
    dup = e;
  }
  ok('중복. 같은 사용자·같은 글 재신고 거부', dup && dup.code === 'BOARD_REPORT_DUPLICATE');

  console.log('---');
  console.log('passed:', pass, 'failed:', fail);
  return teardown.finishTest(fail);
}

main().catch(function (e) {
  console.error(e);
  fail += 1;
  return teardown.finishTest(fail);
});
