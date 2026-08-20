#!/usr/bin/env node
'use strict';

/**
 * Member POST /api/board/reports must not return internal user ids.
 * Admin listReports keeps them. DB row shape unchanged.
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const express = require('express');
const { createBoardRouter } = require('../server/board-routes');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const schema = require('../shared/board-schema-core');
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

function jsonHasAny(obj, needles) {
  const raw = JSON.stringify(obj);
  for (let i = 0; i < needles.length; i++) {
    if (raw.indexOf(needles[i]) !== -1) return needles[i];
  }
  return null;
}

function forbiddenKeysPresent(obj) {
  const raw = JSON.stringify(obj);
  const keys = [
    'targetAuthorUserId',
    'reporterUserId',
    'reviewedBy',
    'target_author_user_id',
    'reporter_user_id',
    'reviewed_by',
  ];
  for (let i = 0; i < keys.length; i++) {
    if (raw.indexOf('"' + keys[i] + '"') !== -1) return keys[i];
  }
  return null;
}

async function main() {
  const author = uid(1);
  const reporter = uid(2);
  const repo = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({
    territories: { [author]: 'CENTRAL', [reporter]: 'PIONEER' },
  });
  const service = createBoardService({ repository: repo, userContext, operational: true });

  const mapped = schema.mapReportForMember({
    id: 'rep-1',
    status: 'SUBMITTED',
    createdAt: '2026-08-20T00:00:00.000Z',
    reasonCode: 'spam',
    targetAuthorUserId: author,
    reporterUserId: reporter,
    reviewedBy: uid(9),
    moderation: { action: 'WARN', state: { userId: author } },
  });
  ok('mapper keeps receipt fields', mapped.id === 'rep-1' && mapped.status === 'SUBMITTED' && mapped.reasonCode === 'spam' && mapped.createdAt);
  ok('mapper strips member ids', !forbiddenKeysPresent(mapped) && jsonHasAny(mapped, [author, reporter, uid(9)]) == null);
  ok('mapper strips moderation', mapped.moderation == null);

  const anonPost = await service.createPost(
    { userId: author },
    { title: '익명 글 제목입니다', content: '익명 본문입니다', isAnonymous: true },
  );
  const publicPost = await service.createPost(
    { userId: author },
    { title: '실명 글 제목입니다', content: '실명 본문입니다', isAnonymous: false },
  );
  const commentPack = await service.createComment(
    { userId: author },
    publicPost.post.id,
    { content: '작성자 댓글입니다' },
  );
  const comment = commentPack.comment || commentPack;

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

  const anonView = await requestApp(app, 'GET', '/api/board/posts/' + anonPost.post.id, {
    headers: { 'x-user-id': reporter },
  });
  ok('익명 글 화면 author userId 없음', anonView.status === 200 && anonView.body.post && anonView.body.post.author && anonView.body.post.author.userId == null);
  ok('익명 글 JSON에 작성자 uuid 없음', jsonHasAny(anonView.body, [author]) == null);

  const anonReport = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': reporter },
    body: { targetType: 'POST', targetId: anonPost.post.id, reasonCode: 'abuse' },
  });
  ok('A. 익명 글 신고 성공', anonReport.status === 201 && anonReport.body.ok === true && anonReport.body.report && anonReport.body.report.status === 'SUBMITTED');
  ok('A. 익명 글 응답 targetAuthorUserId 없음', forbiddenKeysPresent(anonReport.body) == null);
  ok('A. 익명 글 응답에 작성자 uuid 없음', jsonHasAny(anonReport.body, [author, reporter]) == null);

  const storedAnon = await repo.getReport(anonReport.body.report.id);
  ok('A. DB row는 작성자 연결 유지', storedAnon && storedAnon.targetAuthorUserId === author && storedAnon.reporterUserId === reporter);

  const publicReport = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': reporter },
    body: { targetType: 'POST', targetId: publicPost.post.id, reasonCode: 'spam' },
  });
  ok('B. 일반 글 신고 성공', publicReport.status === 201 && publicReport.body.report && publicReport.body.report.id);
  ok('B. 일반 글 응답 targetAuthorUserId 없음', forbiddenKeysPresent(publicReport.body) == null);
  ok('B. 일반 글 응답에 작성자 uuid 없음', jsonHasAny(publicReport.body, [author, reporter]) == null);

  const commentReport = await requestApp(app, 'POST', '/api/board/reports', {
    headers: { 'x-user-id': reporter },
    body: { targetType: 'COMMENT', targetId: comment.id, reasonCode: 'baiting' },
  });
  ok('C. 댓글 신고 성공', commentReport.status === 201 && commentReport.body.report && commentReport.body.report.status === 'SUBMITTED');
  ok('C. 댓글 응답 targetAuthorUserId 없음', forbiddenKeysPresent(commentReport.body) == null);
  ok('C. 댓글 응답에 작성자 uuid 없음', jsonHasAny(commentReport.body, [author, reporter]) == null);

  const bodies = [anonReport.body.report, publicReport.body.report, commentReport.body.report];
  ok(
    'D. 회원 응답에 reporterUserId/reviewedBy 없음',
    bodies.every(function (r) {
      return r && !forbiddenKeysPresent(r) && r.reporterUserId == null && r.reviewedBy == null;
    }),
  );
  ok(
    'D. 회원 응답은 접수 필드만',
    bodies.every(function (r) {
      return r && r.id && r.status === 'SUBMITTED' && r.createdAt && r.reasonCode;
    }),
  );

  const adminRows = await service.listReports({ userId: 'admin' }, {});
  ok('E. 관리자 listReports에 대상 uuid 유지', adminRows.some(function (r) { return r.targetAuthorUserId === author; }));
  ok('E. 관리자 listReports에 신고자 uuid 유지', adminRows.some(function (r) { return r.reporterUserId === reporter; }));
  ok('E. 관리자 조회 건수 3', adminRows.length === 3);

  const storedPublic = await repo.getReport(publicReport.body.report.id);
  const storedComment = await repo.getReport(commentReport.body.report.id);
  ok('F. 저장 컬럼 유지', storedPublic && storedPublic.targetType === 'POST' && storedPublic.reasonCode === 'spam');
  ok('F. 댓글 신고 commentId 저장', storedComment && storedComment.targetType === 'COMMENT' && storedComment.commentId === comment.id && storedComment.targetAuthorUserId === author);

  console.log('---');
  console.log('passed:', pass, 'failed:', fail);
  return teardown.finishTest(fail);
}

main().catch(function (e) {
  console.error(e);
  fail += 1;
  return teardown.finishTest(fail);
});
