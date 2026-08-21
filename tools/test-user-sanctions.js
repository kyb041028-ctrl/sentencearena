#!/usr/bin/env node
'use strict';

/**
 * SentenceArena 제재 사다리 A–U
 * node tools/test-user-sanctions.js
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const fs = require('fs');
const path = require('path');
const express = require('express');
const core = require('../shared/user-sanction-core');
const reviewCore = require('../shared/board-report-review-core');
const schema = require('../shared/board-schema-core');
const memRepo = require('../server/alien-moderation-memory-repository');
const modService = require('../server/alien-moderation-service');
const sanctionService = require('../server/user-sanction-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardRouter } = require('../server/board-routes');
const alienRoutes = require('../server/alien-moderation-routes');
const { createUserSanctionRouter } = require('../server/user-sanction-routes');
const { createAccountWithdrawalRouter } = require('../server/account-withdrawal-routes');
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

function yesterday() {
  return new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
}

async function makeBoard(options) {
  const opts = options || {};
  memRepo._reset();
  modService.setRepository(memRepo);
  sanctionService.setRepository(memRepo);
  modService.setV1Enabled(opts.v1 === true);
  const boardRepo = createBoardMemoryRepository();
  modService.setBoardReportReader(boardRepo);
  const territories = opts.territories || {};
  const board = createBoardService({
    repository: boardRepo,
    userContext: createMockUserContextAdapter({
      defaultTerritory: 'CENTRAL',
      territories: territories,
    }),
    operational: true,
    onReportCreated: function (row) {
      return modService.onReportCreated(row);
    },
    onBehaviorReviewed: function (input) {
      return modService.onBehaviorReviewed(input);
    },
  });
  return { board: board, boardRepo: boardRepo };
}

async function seedPost(board, authorId, title) {
  const created = await board.createPost({ userId: authorId }, {
    title: title || '신고 대상 글 제목입니다',
    content: '본문입니다. 충분히 긴 내용으로 작성합니다.',
  });
  return created.post;
}

async function acceptPost(board, authorId, reporterId, reason, title) {
  const post = await seedPost(board, authorId, title);
  const row = await board.createReport({ userId: reporterId }, {
    targetType: 'POST',
    targetId: post.id,
    reasonCode: reason,
    reasonDetail: reason === 'other' ? '기타 상세' : null,
  });
  const packed = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', post.id),
    { status: 'ACCEPTED', resolutionNote: '확인' },
  );
  return { post: post, report: row, packed: packed };
}

async function main() {
  ok('0. 정치키는 제재 기록에 쓰지 않음', core.POLITICAL_KEYS.indexOf('alignmentScore') !== -1);
  ok('0. 1회=경고', core.recommendEarthConduct(1).type === 'WARNING');
  ok('0. 2회=최종경고', core.recommendEarthConduct(2).type === 'FINAL_WARNING');
  ok('0. 3회=외계행성', core.recommendEarthConduct(3).type === 'ALIEN_TRANSFER');

  const author = uid(1);
  const h = await makeBoard({ v1: false, territories: { [author]: 'CENTRAL' } });

  const a = await acceptPost(h.board, author, uid(11), 'abuse', '일반위반 1 제목입니다');
  ok('A. 일반 위반 1회 경고', a.packed.sanction && a.packed.sanction.sanctionType === 'WARNING');
  ok('A. 알림 문구', a.packed.sanction.publicNotice && a.packed.sanction.publicNotice.userMessage.indexOf('운영정책 위반이 확인되었습니다') !== -1);

  const b = await acceptPost(h.board, author, uid(12), 'baiting', '일반위반 2 제목입니다');
  ok('B. 서로 다른 일반 위반 2회 최종 경고', b.packed.sanction && b.packed.sanction.sanctionType === 'FINAL_WARNING');

  const c = await acceptPost(h.board, author, uid(13), 'abuse', '일반위반 3 제목입니다');
  const stC = await memRepo.getModerationState(author);
  ok('C. 서로 다른 일반 위반 3회 외계행성 조건', c.packed.sanction && c.packed.sanction.sanctionType === 'ALIEN_TRANSFER');
  ok('C. V1 OFF면 실제 이동 persist 없음', stC.citizenshipStatus !== 'KANTAPBIYA_RESIDENT');
  const cMsg = (c.packed.sanction && c.packed.sanction.publicNotice && c.packed.sanction.publicNotice.userMessage) || '';
  const cNoti = (c.packed.sanction && c.packed.sanction.notification && c.packed.sanction.notification.message) || '';
  ok('C. V1 OFF 이동 완료 문구 없음', cMsg.indexOf('외계행성으로 이동되었습니다') === -1 && cNoti.indexOf('외계행성으로 이동되었습니다') === -1);
  ok('C. V1 OFF는 조건 안내', cMsg.indexOf('반복 확인되었습니다') !== -1);

  const v1Author = uid(3);
  const hV1 = await makeBoard({ v1: true, territories: { [v1Author]: 'CENTRAL' } });
  await acceptPost(hV1.board, v1Author, uid(31), 'abuse', 'V1이동 1 제목입니다');
  await acceptPost(hV1.board, v1Author, uid(32), 'baiting', 'V1이동 2 제목입니다');
  const cV1 = await acceptPost(hV1.board, v1Author, uid(33), 'abuse', 'V1이동 3 제목입니다');
  const stV1 = await memRepo.getModerationState(v1Author);
  const v1Msg = (cV1.packed.sanction && cV1.packed.sanction.publicNotice && cV1.packed.sanction.publicNotice.userMessage) || '';
  ok('C2. V1 ON 실제 이동', stV1.citizenshipStatus === 'KANTAPBIYA_RESIDENT');
  ok('C2. V1 ON 이동 성공 안내', v1Msg.indexOf('외계행성으로 이동되었습니다') !== -1);
  const condNotice = core.toPublicNotice({
    currentSanctionType: 'ALIEN_TRANSFER',
    citizenshipStatus: 'CITIZEN',
    status: 'EARTH',
  });
  const doneNotice = core.toPublicNotice({
    currentSanctionType: 'ALIEN_TRANSFER',
    citizenshipStatus: 'KANTAPBIYA_RESIDENT',
    status: 'ALIEN_ACTIVE',
  });
  ok('C2. 조건만 충족하면 이동 완료 문구 없음', condNotice.userMessage.indexOf('외계행성으로 이동되었습니다') === -1);
  ok('C2. 실제 이동 상태면 이동 완료 안내', doneNotice.userMessage.indexOf('외계행성으로 이동되었습니다') !== -1);

  const samePost = await seedPost(h.board, author, '같은글 30건 제목입니다');
  for (let i = 0; i < 30; i++) {
    await h.board.createReport({ userId: uid(100 + i) }, {
      targetType: 'POST',
      targetId: samePost.id,
      reasonCode: 'abuse',
    });
  }
  const groupedSame = (await h.board.listReportBehaviors({ userId: 'admin' }, {})).filter(function (g) {
    return g.postId === samePost.id;
  })[0];
  ok('D. 같은 글 신고 30건은 행동 1개', groupedSame && groupedSame.reportCount === 30);
  const beforeD = reviewCore.countConfirmedConductBehaviors(await h.boardRepo.listReportsByTargetAuthor(author), { targetUserId: author }).count;
  await h.board.reviewBehavior({ userId: uid(99) }, groupedSame.behaviorKey, { status: 'ACCEPTED' });
  const afterD = reviewCore.countConfirmedConductBehaviors(await h.boardRepo.listReportsByTargetAuthor(author), { targetUserId: author }).count;
  ok('D. 확정 위반은 1회만 증가', afterD === beforeD + 1);

  const alienUser = uid(2);
  const h2 = await makeBoard({ v1: false, territories: { [alienUser]: 'CENTRAL' } });
  memRepo._seedState(alienUser, {
    citizenshipStatus: 'KANTAPBIYA_RESIDENT',
    status: 'ALIEN_ACTIVE',
    enteredAt: yesterday(),
    cycleStartAt: yesterday(),
  });
  const alienPosts = [];
  for (let i = 0; i < 4; i++) {
    alienPosts.push(await seedPost(h2.board, alienUser, '외계체류 ' + (i + 1) + ' 제목입니다'));
  }
  async function acceptExisting(board, post, reporterId, reason) {
    await board.createReport({ userId: reporterId }, {
      targetType: 'POST',
      targetId: post.id,
      reasonCode: reason,
    });
    return board.reviewBehavior(
      { userId: uid(99) },
      reviewCore.behaviorKeyFromParts('POST', post.id),
      { status: 'ACCEPTED', resolutionNote: '확인' },
    );
  }
  const e = { packed: await acceptExisting(h2.board, alienPosts[0], uid(21), 'abuse') };
  ok('E. 외계 체류 중 위반 1회 24시간 작성 제한', e.packed.sanction && e.packed.sanction.sanctionType === 'WRITE_RESTRICT_24H');
  let writeBlocked = null;
  try {
    await h2.board.createPost({ userId: alienUser }, { title: '차단되어야 하는 글 제목', content: '본문입니다 작성제한' });
  } catch (err) {
    writeBlocked = err;
  }
  ok('E. 서버가 게시글 작성을 차단', writeBlocked && writeBlocked.code === 'SANCTION_WRITE_RESTRICTED');
  const commentHost = await seedPost(h2.board, uid(22), '읽기용 글 제목입니다');
  let commentBlocked = null;
  try {
    await h2.board.createComment({ userId: alienUser }, commentHost.id, { content: '댓글도 막혀야 합니다' });
  } catch (err) {
    commentBlocked = err;
  }
  ok('E. 서버가 댓글 작성을 차단', commentBlocked && commentBlocked.code === 'SANCTION_WRITE_RESTRICTED');
  const reaction = await h2.board.toggleReaction({ userId: alienUser }, {
    targetType: 'POST',
    targetId: commentHost.id,
    reactionType: 'LIKE',
  });
  ok('E. 24시간 제한은 읽기/반응 가능', reaction && reaction.ok !== false);

  const f = { packed: await acceptExisting(h2.board, alienPosts[1], uid(23), 'baiting') };
  ok('F. 외계 체류 중 위반 2회 7일 계정 제한', f.packed.sanction && f.packed.sanction.sanctionType === 'ACCOUNT_RESTRICT_7D');
  let reactBlocked = null;
  try {
    await h2.board.toggleReaction({ userId: alienUser }, {
      targetType: 'POST',
      targetId: commentHost.id,
      reactionType: 'DISLIKE',
    });
  } catch (err) {
    reactBlocked = err;
  }
  ok('F. 계정 제한은 추천/비추천 차단', reactBlocked && reactBlocked.code === 'SANCTION_ACCOUNT_RESTRICTED');

  const g = { packed: await acceptExisting(h2.board, alienPosts[2], uid(24), 'abuse') };
  ok('G. 외계 체류 중 위반 3회 30일 계정 제한', g.packed.sanction && g.packed.sanction.sanctionType === 'ACCOUNT_RESTRICT_30D');

  const h3 = { packed: await acceptExisting(h2.board, alienPosts[3], uid(25), 'baiting') };
  ok('H. 30일 이후 재위반은 영구정지 검토', h3.packed.sanction && h3.packed.sanction.sanctionType === 'PERMANENT_REVIEW');
  ok('H. 자동 영구정지 없음', h3.packed.sanction.autoPermanentBan === false);

  const spamAuthor = uid(3);
  const hSpam = await makeBoard({ v1: false, territories: { [spamAuthor]: 'CENTRAL' } });
  const spamPosts = [];
  for (let i = 0; i < 3; i++) {
    spamPosts.push(await seedPost(hSpam.board, spamAuthor, '광고 ' + (i + 1) + ' 제목입니다'));
  }
  await hSpam.board.createReport({ userId: uid(31) }, { targetType: 'POST', targetId: spamPosts[0].id, reasonCode: 'spam' });
  const spam1 = {
    post: spamPosts[0],
    packed: await hSpam.board.reviewBehavior(
      { userId: uid(99) },
      reviewCore.behaviorKeyFromParts('POST', spamPosts[0].id),
      { status: 'ACCEPTED' },
    ),
  };
  const stSpam = await memRepo.getModerationState(spamAuthor);
  ok('I. spam 1회 외계행성 횟수 0', spam1.packed.alien && spam1.packed.alien.action === 'NONE' && stSpam.citizenshipStatus !== 'KANTAPBIYA_RESIDENT');
  ok('I. spam 1회는 경고', spam1.packed.sanction && spam1.packed.sanction.sanctionType === 'WARNING');
  const hidden = await hSpam.boardRepo.getPost(spam1.post.id);
  ok('I. 1회성 광고는 숨김 가능', hidden && hidden.status === 'HIDDEN_BY_OPERATOR');

  await hSpam.board.createReport({ userId: uid(32) }, { targetType: 'POST', targetId: spamPosts[1].id, reasonCode: 'spam' });
  const spam2 = {
    packed: await hSpam.board.reviewBehavior(
      { userId: uid(99) },
      reviewCore.behaviorKeyFromParts('POST', spamPosts[1].id),
      { status: 'ACCEPTED' },
    ),
  };
  ok('J. 반복 spam은 작성 제한', spam2.packed.sanction && spam2.packed.sanction.sanctionType === 'WRITE_RESTRICT_24H');

  await hSpam.board.createReport({ userId: uid(33) }, { targetType: 'POST', targetId: spamPosts[2].id, reasonCode: 'spam' });
  const massPacked = await hSpam.board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', spamPosts[2].id),
    { status: 'ACCEPTED', massHarm: true, operatorSanction: 'TEMP_SUSPEND' },
  );
  ok('K. 대량/자동 도배는 외계행성 없음', !core.canSelectAlien('SERVICE_HARM', 'MASS_HARM', 'MASS_SPAM', true));
  ok('K. 임시 활동중지 가능', massPacked.sanction && massPacked.sanction.sanctionType === 'TEMP_SUSPEND');

  const severeAuthor = uid(4);
  const hSev = await makeBoard({ v1: false, territories: { [severeAuthor]: 'CENTRAL' } });
  const sevPost = await seedPost(hSev.board, severeAuthor, '중대한 위반 글 제목입니다');
  const submitOnlyPost = await seedPost(hSev.board, severeAuthor, '접수만 하는 글 제목입니다');
  await hSev.board.createReport({ userId: uid(41) }, { targetType: 'POST', targetId: sevPost.id, reasonCode: 'abuse' });
  const sevPacked = await hSev.board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', sevPost.id),
    { status: 'ACCEPTED', severeCode: 'CSAM', operatorSanction: 'TEMP_SUSPEND' },
  );
  ok('L. 중대한 위반은 외계행성 없음', !core.canSelectAlien('CONDUCT', 'SEVERE', 'CSAM', false));
  ok('L. 임시 활동중지', sevPacked.sanction && sevPacked.sanction.sanctionType === 'TEMP_SUSPEND');

  const submitted = await hSev.board.createReport({ userId: uid(42) }, {
    targetType: 'POST',
    targetId: submitOnlyPost.id,
    reasonCode: 'abuse',
  });
  ok('M. 중대한 위반 신고 접수만으로 자동 영구정지 없음', submitted.moderation && submitted.moderation.autoSanction === false && submitted.moderation.action === 'ADMIN_REVIEW');

  const banUser = uid(5);
  const hBan = await makeBoard({ v1: false, territories: { [banUser]: 'CENTRAL' } });
  const banPost = await seedPost(hBan.board, banUser, '영구정지 대상 글 제목입니다');
  await hBan.board.createReport({ userId: uid(51) }, { targetType: 'POST', targetId: banPost.id, reasonCode: 'abuse' });
  await hBan.board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', banPost.id),
    { status: 'ACCEPTED', operatorSanction: 'PERMANENT_BAN', severeCode: 'FRAUD_PHISHING' },
  );
  let banWrite = null;
  try {
    await hBan.board.createPost({ userId: banUser }, { title: '정지 후 글 제목입니다', content: '본문입니다 정지' });
  } catch (err) {
    banWrite = err;
  }
  ok('N. 운영자 영구정지는 회원 활동 차단', banWrite && banWrite.code === 'SANCTION_PERMANENT_BAN');
  const withdrawOk = await sanctionService.assertAllows(banUser, 'WITHDRAW');
  ok('O. 영구정지 상태에서도 회원탈퇴 허용', withdrawOk && withdrawOk.allowed === true);
  const withdrawSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'account-withdrawal-routes.js'), 'utf8');
  ok('O. 탈퇴 라우트는 제재 검사와 분리', withdrawSrc.indexOf('user-sanction-service') === -1);

  const appealUser = uid(6);
  const hAp = await makeBoard({ v1: false, territories: { [appealUser]: 'CENTRAL' } });
  memRepo._seedState(appealUser, {
    citizenshipStatus: 'KANTAPBIYA_RESIDENT',
    status: 'ALIEN_ACTIVE',
    enteredAt: yesterday(),
  });
  const appealPosts = [
    await seedPost(hAp.board, appealUser, '이의 7일 글 제목입니다'),
    await seedPost(hAp.board, appealUser, '이의 7일-2 글 제목입니다'),
  ];
  await hAp.board.createReport({ userId: uid(61) }, { targetType: 'POST', targetId: appealPosts[0].id, reasonCode: 'abuse' });
  await hAp.board.reviewBehavior({ userId: uid(99) }, reviewCore.behaviorKeyFromParts('POST', appealPosts[0].id), { status: 'ACCEPTED' });
  await hAp.board.createReport({ userId: uid(62) }, { targetType: 'POST', targetId: appealPosts[1].id, reasonCode: 'baiting' });
  await hAp.board.reviewBehavior({ userId: uid(99) }, reviewCore.behaviorKeyFromParts('POST', appealPosts[1].id), { status: 'ACCEPTED' });
  const appeal = await sanctionService.submitAppeal({ userId: appealUser, body: '소명합니다' });
  ok('P. 7일 제한 이의신청 가능', appeal && appeal.ok && appeal.appeal && appeal.appeal.status === 'SUBMITTED');
  const notice = await sanctionService.getPublicNotice(appealUser);
  ok('P. 공개 안내에 운영 메모 없음', notice && notice.operatorMemo === undefined && notice.appealAvailable === true);

  const permUser = uid(7);
  await sanctionService.applyRecord(permUser, { type: 'PERMANENT_BAN', ladder: 'SEVERE' }, { reasonCode: 'abuse' });
  const permAppeal = await sanctionService.submitAppeal({ userId: permUser, body: '영구정지 소명' });
  ok('P. 영구정지 이의신청 가능', permAppeal && permAppeal.ok);
  await sanctionService.applyRecord(uid(8), { type: 'WRITE_RESTRICT_24H', ladder: 'CONDUCT_ALIEN' }, {});
  let writeAppeal = null;
  try {
    await sanctionService.submitAppeal({ userId: uid(8), body: '24시간은 별도' });
  } catch (err) {
    writeAppeal = err;
  }
  ok('P. 24시간 작성 제한은 이의신청 대상 아님', writeAppeal && writeAppeal.code === 'SANCTION_APPEAL_NOT_ALLOWED');

  const pol = await acceptPost(hBan.board, uid(9), uid(91), 'abuse', '정치점수 무시 글 제목입니다').catch(function () { return null; });
  void pol;
  const polBoard = await makeBoard({ v1: false, territories: { [uid(9)]: 'CENTRAL' } });
  const polPost = await seedPost(polBoard.board, uid(9), '정치점수 필드 글 제목입니다');
  await polBoard.board.createReport({ userId: uid(92) }, {
    targetType: 'POST',
    targetId: polPost.id,
    reasonCode: 'abuse',
    alignmentScore: 9999,
    politicalScore: -1,
  });
  const polPacked = await polBoard.board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', polPost.id),
    { status: 'ACCEPTED', alignmentScore: 9999 },
  );
  const polJson = JSON.stringify(polPacked.sanction && polPacked.sanction.publicNotice);
  ok('Q. 정치성향은 제재 계산/안내에 사용되지 않음', polPacked.sanction && polPacked.sanction.sanctionType === 'WARNING' && polJson.indexOf('9999') === -1);

  const app = express();
  app.use(express.json());
  const httpBoard = await makeBoard({ v1: false, territories: { [uid(10)]: 'CENTRAL' } });
  app.use('/api/board', createBoardRouter({
    operational: true,
    useMemory: true,
    repository: httpBoard.boardRepo,
    userContext: createMockUserContextAdapter({ territories: { [uid(10)]: 'CENTRAL' } }),
    onReportCreated: function (row) { return modService.onReportCreated(row); },
    onBehaviorReviewed: function (input) { return modService.onBehaviorReviewed(input); },
    resolveActorFromRequest: async function (req) {
      if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
      return null;
    },
  }));
  app.use('/api/admin/moderation', alienRoutes.mountAdminRoutes({
    adminBypass: true,
    getBoardService: function () { return httpBoard.board; },
  }));
  app.use('/api', createUserSanctionRouter({
    resolveActor: async function (req) {
      if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
      return null;
    },
  }));
  app.use('/api', createAccountWithdrawalRouter({
    resolveActor: async function (req) {
      if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
      return null;
    },
    service: {
      withdraw: async function () {
        return { withdrawn: true };
      },
    },
  }));

  const memberPost = await seedPost(httpBoard.board, uid(10), '회원응답 글 제목입니다');
  const memberRes = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': uid(110) },
    body: { targetType: 'POST', targetId: memberPost.id, reasonCode: 'abuse' },
  });
  const memberJson = JSON.stringify(memberRes.body);
  ok('R. 기존 신고 응답 내부 회원번호 없음', memberRes.status === 201 && memberJson.indexOf('targetAuthorUserId') === -1 && memberJson.indexOf(uid(10)) === -1);
  ok('R. mapReportForMember 유지', typeof schema.mapReportForMember === 'function');

  const alienPost = await seedPost(httpBoard.board, uid(10), '외계 게시글 제목입니다');
  const alienCmtPack = await httpBoard.board.createComment({ userId: uid(10) }, alienPost.id, { content: '외계 댓글입니다 충분히' });
  const alienCmt = alienCmtPack.comment || alienCmtPack;
  const alienPostReport = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': uid(111) },
    body: { targetType: 'POST', targetId: alienPost.id, reasonCode: 'abuse' },
  });
  const alienCmtReport = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': uid(112) },
    body: { targetType: 'COMMENT', targetId: alienCmt.id, reasonCode: 'baiting' },
  });
  ok('외계 신고. 게시글', alienPostReport.status === 201);
  ok('외계 신고. 댓글', alienCmtReport.status === 201);

  const groupedHttp = await httpBoard.board.listReportBehaviors({ userId: 'admin' }, {});
  ok('S. 기존 신고 행동 묶기 회귀 없음', Array.isArray(groupedHttp) && groupedHttp.every(function (g) { return g.behaviorKey && g.reportCount >= 1; }));

  const legalSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'legal-gate-service.js'), 'utf8');
  ok('T. 법적 가입 게이트는 제재와 독립', legalSrc.indexOf('user-sanction-service') === -1 && legalSrc.indexOf('assertCompleteForUser') !== -1);

  const withdrawCore = fs.readFileSync(path.join(__dirname, '..', 'shared', 'account-withdrawal-core.js'), 'utf8');
  ok('U. 회원탈퇴 코어 미변경 확인', withdrawCore.indexOf('SANCTION') === -1);

  await sanctionService.applyRecord(uid(10), { type: 'PERMANENT_BAN', ladder: 'SEVERE' }, {});
  const bannedWithdraw = await requestApp(app, 'POST', '/api/me/withdraw', {
    headers: { 'x-user-id': uid(10) },
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  ok('O2. 영구정지 사용자 탈퇴 API 접근 가능', bannedWithdraw.status === 200 && bannedWithdraw.body.ok === true);

  const adminList = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { 'x-user-id': uid(99) },
  });
  ok('W. 관리자 목록에 현재 제재', adminList.status === 200 && Array.isArray(adminList.body.behaviors) && adminList.body.behaviors.some(function (g) {
    return g.currentSanction && typeof g.currentSanction.sanctionType === 'string';
  }));
  ok('W. 관리자 이의신청 목록', adminList.status === 200 && Array.isArray(adminList.body.appeals));
  ok('W. 관리자 활성 제재 목록', adminList.status === 200 && Array.isArray(adminList.body.activeSanctions));

  const appealBody = await requestApp(app, 'POST', '/api/me/sanctions/appeals', {
    headers: { 'x-user-id': uid(10) },
    body: { body: '영구정지 소명합니다' },
  });
  ok('P2. 사용자 이의신청 제출', appealBody.status === 201 && appealBody.body.ok === true);
  const appealList = await requestApp(app, 'GET', '/api/me/sanctions/appeals', {
    headers: { 'x-user-id': uid(10) },
  });
  const appealJson = JSON.stringify(appealList.body);
  ok('P2. 사용자 이의신청에 decidedBy 없음', appealList.status === 200 && appealJson.indexOf('decidedBy') === -1 && appealJson.indexOf('operatorMemo') === -1);

  const noticeRes = await requestApp(app, 'GET', '/api/me/sanction', {
    headers: { 'x-user-id': uid(10) },
  });
  ok('N2. 영구정지 안내 확인', noticeRes.status === 200 && noticeRes.body.sanction && noticeRes.body.sanction.sanctionType === 'PERMANENT_BAN');

  const tempUser = uid(20);
  await sanctionService.applyOperatorDirect({ userId: tempUser, action: 'TEMP_SUSPEND' });
  const released = await sanctionService.applyOperatorDirect({ userId: tempUser, action: 'RELEASE' });
  ok('L2. 임시중지 관리자 해제', released && released.sanctionType === 'NONE');
  await sanctionService.applyOperatorDirect({ userId: tempUser, action: 'TEMP_SUSPEND' });
  const toBan = await sanctionService.applyOperatorDirect({ userId: tempUser, action: 'PERMANENT_BAN' });
  ok('L2. 임시중지 영구정지 전환', toBan && toBan.sanctionType === 'PERMANENT_BAN');

  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok('V. V1 OFF여도 supabase 제재 persist', serverSrc.indexOf('ALIEN_MODERATION_V1=false, no auto transfer') !== -1);
  ok('V. citizenship writer는 V1에서만', /if \(alienModerationV1\) \{[\s\S]*setCitizenshipWriter/.test(serverSrc));
  const persistSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'alien-moderation-supabase-repository.js'), 'utf8');
  ok('V. 실제 외계 이동 persist는 persistEnabled 게이트', persistSrc.indexOf('ALIEN_PERSIST_DISABLED') !== -1);
  const adminUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'moderation', 'admin-moderation.js'), 'utf8');
  ok('W. 관리자 화면 제재 구분', adminUi.indexOf('경고') !== -1 && adminUi.indexOf('최종 경고') !== -1 && adminUi.indexOf('외계행성 이동') !== -1 && adminUi.indexOf('24시간 작성 제한') !== -1 && adminUi.indexOf('7일 계정 제한') !== -1 && adminUi.indexOf('30일 계정 제한') !== -1 && adminUi.indexOf('임시 활동중지') !== -1 && adminUi.indexOf('영구정지') !== -1);
  ok('W. 관리자 이의 유지/단축/해제', adminUi.indexOf('UPHELD') !== -1 && adminUi.indexOf('SHORTENED') !== -1 && adminUi.indexOf('RELEASED') !== -1);

  const dailySrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'daily-issue-routes.js'), 'utf8');
  ok('회귀. Daily Issue 쓰기에 제재 독립 검사', dailySrc.indexOf("assertAllows(actor.userId, 'WRITE')") !== -1 && dailySrc.indexOf("assertAllows(actor.userId, 'PARTICIPATE')") !== -1);

  const guestOk = core.assertAllows({}, 'WRITE').allowed === true;
  ok('회귀. Guest/무상태 쓰기는 제재 대상 아님', guestOk);

  const spamAlien = core.canSelectAlien('SERVICE_HARM', 'SERVICE_HARM', null, false);
  ok('광고. 외계행성 사용 금지', spamAlien === false);

  console.log('---');
  console.log('passed:', pass, 'failed:', fail);
  return teardown.finishTest(fail);
}

main().catch(function (e) {
  console.error(e);
  fail += 1;
  return teardown.finishTest(fail);
});
