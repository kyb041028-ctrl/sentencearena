#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { mountAdminPostsRoutes } = require('../server/board-admin-posts-routes');
const { mountAdminCommentsRoutes } = require('../server/board-admin-comments-routes');
const { mountAdminAuditRoutes } = require('../server/admin-moderation-audit-routes');
const { requestApp } = require('./daily-issue-api-http-helper');
const auditService = require('../server/admin-moderation-audit-service');
const { createAdminModerationAuditMemoryRepository } = require('../server/admin-moderation-audit-memory-repository');
const auditCore = require('../shared/admin-moderation-audit-core');
const reviewCore = require('../shared/board-report-review-core');
const progressionService = require('../server/user-progression-service');
const achievementEvaluator = require('../server/achievement-evaluator-service');
const mapperFactory = require('../server/board-data-mapper');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function makeGetUser(map) {
  return async function (token) {
    if (Object.prototype.hasOwnProperty.call(map, token)) return map[token];
    return null;
  };
}

async function main() {
  console.log('\n=== report reject + hide unify ===\n');

  const auditRepo = createAdminModerationAuditMemoryRepository();
  auditService.setRepository(auditRepo);
  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({
    territories: { [uid(1)]: 'CENTRAL', [uid(2)]: 'CENTRAL', [uid(99)]: 'CENTRAL' },
  });
  const origXp = progressionService.applyPostCreatedXp;
  const origAch = achievementEvaluator.evaluateAfterPostCreated;
  progressionService.applyPostCreatedXp = async function () { return { level: 1, xp: 0 }; };
  achievementEvaluator.evaluateAfterPostCreated = async function () { return { granted: [] }; };

  const board = createBoardService({
    repository: repository,
    userContext: userContext,
    operational: true,
  });

  const post = (await board.createPost({ userId: uid(1) }, {
    title: '기각 통일 게시글 제목입니다',
    content: '본문은 audit와 일반 화면에 노출되면 안 됩니다.',
  })).post;
  const comment = (await board.createComment({ userId: uid(1) }, post.id, {
    content: '기각 대상 댓글 본문입니다. 충분히 길게 작성합니다.',
  })).comment;
  const reply = (await board.createComment({ userId: uid(2) }, post.id, {
    content: '기각 대상 대댓글 본문입니다. 충분히 길게 작성합니다.',
    parentCommentId: comment.id,
  })).comment;

  const repPost = await board.createReport({ userId: uid(2) }, {
    targetType: 'POST', targetId: post.id, reasonCode: 'abuse',
  });
  const rejected = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', post.id),
    { status: 'REJECTED', resolutionNote: '문제 없음' },
  );
  ok('1. 신고 기각 → REPORT_REJECTED', (rejected.audits || []).some(function (a) {
    return a && a.actionType === 'REPORT_REJECTED' && a.reportId === repPost.id;
  }), JSON.stringify(rejected.audits));
  ok('2. report_id 연결', (rejected.audits || [])[0] && rejected.audits[0].reportId === repPost.id);
  ok('3. target_type POST', (rejected.audits || [])[0] && rejected.audits[0].targetType === 'POST');

  const dup = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', post.id),
    { status: 'REJECTED', resolutionNote: '다시' },
  );
  ok('5. 중복 기각 audit 방지', !(dup.audits || []).some(function (a) { return a && a.actionType === 'REPORT_REJECTED'; }));

  const repComment = await board.createReport({ userId: uid(2) }, {
    targetType: 'COMMENT', targetId: comment.id, reasonCode: 'spam',
  });
  const rejectedC = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('COMMENT', comment.id),
    { status: 'REJECTED', resolutionNote: '댓글 문제 없음' },
  );
  ok('4. COMMENT 기각 target_type', (rejectedC.audits || []).some(function (a) {
    return a && a.actionType === 'REPORT_REJECTED' && a.targetType === 'COMMENT' && a.reportId === repComment.id;
  }));

  const adminAuth = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    getUserFromAccessToken: makeGetUser({
      'tok-admin': { id: uid(99), app_metadata: { role: 'ADMIN' }, user_metadata: {} },
    }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin/audit', mountAdminAuditRoutes({ adminAuth: adminAuth }));
  app.use('/api/admin/posts', mountAdminPostsRoutes({
    adminAuth: adminAuth,
    getBoardService: function () { return board; },
  }));
  app.use('/api/admin/comments', mountAdminCommentsRoutes({
    adminAuth: adminAuth,
    getBoardService: function () { return board; },
  }));

  const hidePost = (await board.createPost({ userId: uid(1) }, {
    title: '직접 숨김 게시글 제목입니다',
    content: '직접 숨김 본문입니다. 충분히 긴 내용으로 작성합니다.',
  })).post;
  const del = await requestApp(app, 'POST', '/api/admin/posts/' + hidePost.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'abuse', operatorNote: '직접 숨김' },
  });
  ok('8. 관리자 직접 게시글 숨김 HIDDEN', del.status === 200 && del.body.post.status === 'HIDDEN_BY_OPERATOR');

  const own = (await board.createPost({ userId: uid(1) }, {
    title: '본인 삭제 게시글 제목입니다',
    content: '본인 삭제 본문입니다. 충분히 긴 내용으로 작성합니다.',
  })).post;
  const memberDel = await board.deletePost({ userId: uid(1) }, own.id);
  ok('9. 회원 본인 삭제는 DELETED', memberDel && memberDel.status === 'DELETED');

  const rest = await requestApp(app, 'POST', '/api/admin/posts/' + hidePost.id + '/restore', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'OPERATOR_CORRECTION', operatorNote: '복구' },
  });
  ok('10. 관리자 게시글 복구 ACTIVE', rest.status === 200 && rest.body.post.status === 'ACTIVE');

  const hideComment = await requestApp(app, 'POST', '/api/admin/comments/' + comment.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'spam', operatorNote: '댓글 숨김' },
  });
  ok('12. 관리자 직접 댓글 숨김 HIDDEN', hideComment.status === 200 && hideComment.body.comment.status === 'HIDDEN_BY_OPERATOR');
  const hideReply = await requestApp(app, 'POST', '/api/admin/comments/' + reply.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'spam', operatorNote: '대댓글 숨김' },
  });
  ok('12b. 관리자 대댓글 숨김 HIDDEN', hideReply.status === 200 && hideReply.body.comment.status === 'HIDDEN_BY_OPERATOR');

  const ownComment = (await board.createComment({ userId: uid(1) }, post.id, {
    content: '본인 삭제 댓글 본문입니다. 충분히 길게 작성합니다.',
  })).comment;
  const ownDel = await board.deleteComment({ userId: uid(1) }, ownComment.id);
  ok('13. 회원 본인 댓글 삭제는 DELETED', ownDel && ownDel.status === 'DELETED');

  const restoreComment = await requestApp(app, 'POST', '/api/admin/comments/' + comment.id + '/restore', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'OPERATOR_CORRECTION', operatorNote: '댓글 복구' },
  });
  ok('14. 관리자 댓글 복구 ACTIVE', restoreComment.status === 200 && restoreComment.body.comment.status === 'ACTIVE');

  const mapped = mapperFactory.createBoardDataMapper().mapPostForViewer({
    id: hidePost.id,
    title: '숨김 제목',
    content: '숨김 본문 노출되면 안됨',
    status: 'HIDDEN_BY_OPERATOR',
    blindReason: 'OPERATOR_SANCTION',
    authorUserId: uid(1),
    authorDisplayName: '작성자',
    territory: 'CENTRAL',
  }, uid(2));
  ok('15. HIDDEN 본문 노출 없음', mapped && mapped.content == null);

  const byReject = await requestApp(app, 'GET', '/api/admin/audit?actionType=REPORT_REJECTED', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('17. REPORT_REJECTED 검색', byReject.status === 200 && (byReject.body.events || []).length >= 1);

  const byReport = await requestApp(app, 'GET', '/api/admin/audit?reportId=' + encodeURIComponent(repPost.id), {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('18. 신고별 이력에서 기각 확인', (byReport.body.events || []).some(function (e) {
    return e.actionType === 'REPORT_REJECTED';
  }));

  ok('core REPORT_REJECTED', !!auditCore.ACTION_TYPE.REPORT_REJECTED);
  ok('migration additive', /REPORT_REJECTED/.test(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migration_admin_report_reject_and_hide_unify_v1.sql'), 'utf8')));
  ok('audit UI 옵션', /REPORT_REJECTED/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'audit', 'index.html'), 'utf8')));

  progressionService.applyPostCreatedXp = origXp;
  achievementEvaluator.evaluateAfterPostCreated = origAch;
  console.log('\nresult', { passed: passed, failed: failed });
  process.exit(failed ? 1 : 0);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
