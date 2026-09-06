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
const { requestApp } = require('./daily-issue-api-http-helper');
const auditService = require('../server/admin-moderation-audit-service');
const { createAdminModerationAuditMemoryRepository } = require('../server/admin-moderation-audit-memory-repository');
const reviewCore = require('../shared/board-report-review-core');
const reportResultCore = require('../shared/report-result-notification-core');
const modService = require('../server/alien-moderation-service');
const sanctionService = require('../server/user-sanction-service');
const memRepo = require('../server/alien-moderation-memory-repository');
const progressionService = require('../server/user-progression-service');
const achievementEvaluator = require('../server/achievement-evaluator-service');
const alienRoutes = require('../server/alien-moderation-routes');

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
  console.log('\n=== report UX + reporter result notification ===\n');

  auditService.setRepository(createAdminModerationAuditMemoryRepository());
  memRepo._reset();
  modService.setRepository(memRepo);
  sanctionService.setRepository(memRepo);
  modService.setV1Enabled(false);

  const repository = createBoardMemoryRepository();
  modService.setBoardReportReader(repository);
  const userContext = createMockUserContextAdapter({
    territories: {
      [uid(1)]: 'CENTRAL',
      [uid(2)]: 'CENTRAL',
      [uid(3)]: 'CENTRAL',
      [uid(99)]: 'CENTRAL',
    },
  });
  const origXp = progressionService.applyPostCreatedXp;
  const origAch = achievementEvaluator.evaluateAfterPostCreated;
  progressionService.applyPostCreatedXp = async function () { return { level: 1, xp: 0 }; };
  achievementEvaluator.evaluateAfterPostCreated = async function () { return { granted: [] }; };

  const board = createBoardService({
    repository: repository,
    userContext: userContext,
    operational: true,
    onReportCreated: function (row) { return modService.onReportCreated(row); },
    onBehaviorReviewed: function (input) { return modService.onBehaviorReviewed(input); },
  });

  const post = (await board.createPost({ userId: uid(1) }, {
    title: '신고 UX 대상 게시글 제목입니다',
    content: '충분히 긴 본문입니다. 미리보기와 알림에 제재 상세가 들어가면 안 됩니다.',
  })).post;
  const comment = (await board.createComment({ userId: uid(1) }, post.id, {
    content: '신고 UX 대상 댓글 본문입니다. 충분히 길게 작성합니다.',
  })).comment;
  const reply = (await board.createComment({ userId: uid(2) }, post.id, {
    content: '신고 UX 대상 대댓글 본문입니다. 충분히 길게 작성합니다.',
    parentCommentId: comment.id,
  })).comment;

  const repA = await board.createReport({ userId: uid(2) }, {
    targetType: 'POST', targetId: post.id, reasonCode: 'abuse',
  });
  const repB = await board.createReport({ userId: uid(3) }, {
    targetType: 'POST', targetId: post.id, reasonCode: 'abuse',
  });

  const adminAuth = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    getUserFromAccessToken: makeGetUser({
      'tok-admin': { id: uid(99), app_metadata: { role: 'ADMIN' }, user_metadata: {} },
    }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin/posts', mountAdminPostsRoutes({
    adminAuth: adminAuth,
    getBoardService: function () { return board; },
  }));
  app.use('/api/admin/comments', mountAdminCommentsRoutes({
    adminAuth: adminAuth,
    getBoardService: function () { return board; },
  }));
  app.use('/api/admin/moderation', alienRoutes.mountAdminRoutes({
    adminAuth: adminAuth,
    getBoardService: function () { return board; },
  }));
  app.use('/api', alienRoutes);

  const listed = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  const behavior = (listed.body.behaviors || []).find(function (b) {
    return b.behaviorKey === reviewCore.behaviorKeyFromParts('POST', post.id);
  });
  ok('1. 게시글 신고 대상 ID', behavior && behavior.targetPreview && behavior.targetPreview.targetId === post.id);
  ok('2. 게시글 미리보기', behavior && behavior.targetPreview && /신고 UX 대상 게시글/.test(behavior.targetPreview.preview || ''));
  ok('7. 게시글 관리 바로가기', behavior && /\/admin\/posts\/#post=/.test(behavior.targetPreview.manageHref || ''));

  await board.createReport({ userId: uid(3) }, {
    targetType: 'COMMENT', targetId: comment.id, reasonCode: 'spam',
  });
  await board.createReport({ userId: uid(3) }, {
    targetType: 'COMMENT', targetId: reply.id, reasonCode: 'spam',
  });
  const listed2 = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  const cBeh = (listed2.body.behaviors || []).find(function (b) {
    return b.behaviorKey === reviewCore.behaviorKeyFromParts('COMMENT', comment.id);
  });
  const rBeh = (listed2.body.behaviors || []).find(function (b) {
    return b.behaviorKey === reviewCore.behaviorKeyFromParts('COMMENT', reply.id);
  });
  ok('3. 댓글 ID', cBeh && cBeh.targetPreview && cBeh.targetPreview.targetId === comment.id);
  ok('4. 댓글 미리보기', cBeh && /신고 UX 대상 댓글/.test((cBeh.targetPreview && cBeh.targetPreview.preview) || ''));
  ok('5. 대댓글 표시', rBeh && rBeh.targetPreview && rBeh.targetPreview.kindLabel === '대댓글');
  ok('8. 댓글 관리 바로가기', cBeh && /\/admin\/comments\/#comment=/.test(cBeh.targetPreview.manageHref || ''));

  const missing = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('6. 없는 콘텐츠 안전 필드', missing.body.behaviors.every(function (b) {
    return b.targetPreview && typeof b.targetPreview.preview === 'string';
  }));

  const modJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'moderation', 'admin-moderation.js'), 'utf8');
  ok('9. 처리이력 audit 링크', /\/admin\/audit\/#reportId=/.test(modJs));

  const hide = await requestApp(app, 'POST', '/api/admin/posts/' + post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'abuse', operatorNote: '숨김' },
  });
  ok('10. ACTIVE → 숨김', hide.status === 200 && hide.body.post.status === 'HIDDEN_BY_OPERATOR');
  const hideAgain = await requestApp(app, 'POST', '/api/admin/posts/' + post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'abuse', operatorNote: '중복' },
  });
  void hideAgain;
  const postsJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'posts', 'admin-posts.js'), 'utf8');
  const commentsJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'comments', 'admin-comments.js'), 'utf8');
  ok('11. HIDDEN 시 숨김 비활성 코드', /status !== 'ACTIVE'/.test(postsJs) && /HIDDEN_BY_OPERATOR/.test(postsJs));
  ok('12/13. 댓글 숨김 버튼 상태 코드', /status !== 'ACTIVE'/.test(commentsJs) && /HIDDEN_BY_OPERATOR/.test(commentsJs));
  ok('14. soft delete 문구 제거', postsJs.indexOf("textContent = 'soft delete'") === -1 && commentsJs.indexOf("textContent = 'soft delete'") === -1);
  ok('14b. 숨김 버튼 문구', /textContent = '숨김'/.test(postsJs) && /textContent = '숨김'/.test(commentsJs));

  const own = (await board.createPost({ userId: uid(1) }, {
    title: '본인 삭제 회귀 게시글 제목입니다',
    content: '본인 삭제 본문입니다. 충분히 긴 내용으로 작성합니다.',
  })).post;
  const ownDel = await board.deletePost({ userId: uid(1) }, own.id);
  ok('15. 회원 DELETED 회귀', ownDel && ownDel.status === 'DELETED');

  const accept = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', post.id),
    { status: 'ACCEPTED', resolutionNote: '위반 확인', operatorSanction: 'WARNING' },
  );
  const notiA = await modService.listInbox(uid(2));
  const notiB = await modService.listInbox(uid(3));
  ok('16. 조치 결과 알림', (notiA || []).some(function (n) {
    return n.type === 'report_result_action' && /운영정책 위반이 확인/.test(n.message || '');
  }));
  ok('16b. 같은 행동 여러 신고자 각각 알림', (notiB || []).some(function (n) {
    return n.type === 'report_result_action';
  }));
  ok('18. 제재 상세 미노출', !(notiA || []).some(function (n) {
    return /WARNING|정지|Alien|제재 종류|sanction/i.test(JSON.stringify(n));
  }));
  ok('19. 관리자 정보 미노출', !(notiA || []).some(function (n) {
    return String(n.message || '').indexOf(uid(99)) !== -1;
  }));
  ok('20. 다른 신고자 미노출', !(notiA || []).some(function (n) {
    return String(n.message || '').indexOf(uid(3)) !== -1;
  }));

  const packedDup = reportResultCore.buildPublicNotification({
    reportId: repA.id,
    reporterUserId: uid(2),
    outcome: 'ACTION_TAKEN',
  });
  const dupIssue = await modService.issueNotification(packedDup.notification);
  const notiA2 = await modService.listInbox(uid(2));
  const actionCount = (notiA2 || []).filter(function (n) { return n.type === 'report_result_action'; }).length;
  ok('21. 결과 알림 중복 방지', actionCount === 1 && dupIssue && dupIssue.duplicate === true, 'count=' + actionCount);
  ok('core dedupe', reportResultCore.dedupeKey(repA.id, 'ACTION_TAKEN').indexOf('REPORT_RESULT:') === 0);
  const boardSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'board-service.js'), 'utf8');
  const notifyIdx = boardSrc.indexOf('notifyReportersOfReviewResult(updated, nextStatus, prevStatus)');
  const updateLoopIdx = boardSrc.indexOf('updated.push(await reviewReport(');
  const rejectAuditIdx = boardSrc.indexOf("actionType: auditCore.ACTION_TYPE.REPORT_REJECTED");
  ok('22. 처리 성공 후 알림 순서', notifyIdx > updateLoopIdx && notifyIdx > rejectAuditIdx);

  const rejectPost = (await board.createPost({ userId: uid(1) }, {
    title: '기각 알림 게시글 제목입니다',
    content: '기각 알림 본문입니다. 충분히 긴 내용으로 작성합니다.',
  })).post;
  await board.createReport({ userId: uid(2) }, {
    targetType: 'POST', targetId: rejectPost.id, reasonCode: 'abuse',
  });
  const rejected = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', rejectPost.id),
    { status: 'REJECTED', resolutionNote: '위반 아님' },
  );
  const rejectNoti = await modService.listInbox(uid(2));
  ok('17. 기각 알림', (rejectNoti || []).some(function (n) {
    return n.type === 'report_result_rejected' && /위반으로 판단되지 않았습니다/.test(n.message || '');
  }));
  ok('알림 결과 포함', accept.reportResultNotifications && accept.reportResultNotifications.sent >= 1);
  ok('기각 알림 포함', rejected.reportResultNotifications && rejected.reportResultNotifications.sent >= 1);

  const inbox = await requestApp(app, 'GET', '/api/alien/moderation/inbox', {
    headers: { Authorization: 'Bearer user:' + uid(2) },
  });
  ok('Alien OFF 에서도 알림 inbox', inbox.status === 200 && Array.isArray(inbox.body.notifications));

  const auditJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'audit', 'admin-audit.js'), 'utf8');
  ok('audit reportId hash', /reportId: 'aa-report'/.test(auditJs));

  progressionService.applyPostCreatedXp = origXp;
  achievementEvaluator.evaluateAfterPostCreated = origAch;
  console.log('\nresult', { passed: passed, failed: failed });
  process.exit(failed ? 1 : 0);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
