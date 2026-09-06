#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { mountAdminPostsRoutes } = require('../server/board-admin-posts-routes');
const { mountAdminAuditRoutes } = require('../server/admin-moderation-audit-routes');
const { requestApp } = require('./daily-issue-api-http-helper');
const auditService = require('../server/admin-moderation-audit-service');
const { createAdminModerationAuditMemoryRepository } = require('../server/admin-moderation-audit-memory-repository');
const reviewCore = require('../shared/board-report-review-core');
const modService = require('../server/alien-moderation-service');
const sanctionService = require('../server/user-sanction-service');
const memRepo = require('../server/alien-moderation-memory-repository');
const progressionService = require('../server/user-progression-service');
const achievementEvaluator = require('../server/achievement-evaluator-service');

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
  console.log('\n=== report → admin audit report_id link ===\n');

  const auditRepo = createAdminModerationAuditMemoryRepository();
  auditService.setRepository(auditRepo);
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
      [uid(11)]: 'CENTRAL',
      [uid(12)]: 'CENTRAL',
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
    onReportCreated: function (row) {
      return modService.onReportCreated(row);
    },
    onBehaviorReviewed: function (input) {
      return modService.onBehaviorReviewed(input);
    },
  });

  const post = (await board.createPost({ userId: uid(1) }, {
    title: '신고 연결 게시글 제목입니다',
    content: '본문은 audit에 복사되면 안 됩니다. 충분히 긴 내용.',
  })).post;

  const comment = (await board.createComment({ userId: uid(1) }, post.id, {
    content: '신고 대상 댓글 본문입니다. 충분히 길게 작성해서 검증합니다.',
  })).comment;

  const reportPost = await board.createReport({ userId: uid(11) }, {
    targetType: 'POST',
    targetId: post.id,
    reasonCode: 'abuse',
  });
  const reportIdPost = reportPost.report ? reportPost.report.id : reportPost.id;

  const reviewedAbuse = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', post.id),
    { status: 'ACCEPTED', resolutionNote: '욕설 확인', operatorSanction: 'WARNING' },
  );
  ok('5/7. 신고 기반 제재 audit 생성', (reviewedAbuse.audits || []).some(function (a) {
    return a && a.actionType === 'SANCTION_APPLIED' && a.reportId === reportIdPost;
  }), JSON.stringify(reviewedAbuse.audits));
  ok('5. target_type POST', (reviewedAbuse.audits || []).some(function (a) {
    return a && a.actionType === 'SANCTION_APPLIED' && a.targetType === 'POST' && a.targetId === post.id;
  }));
  ok('7. report_id 연결', reviewedAbuse.reportId === reportIdPost);

  const spamPost = (await board.createPost({ userId: uid(2) }, {
    title: '스팸 광고 게시글 제목입니다',
    content: '광고 본문입니다. 충분히 긴 내용으로 작성합니다.',
  })).post;
  const reportSpam = await board.createReport({ userId: uid(12) }, {
    targetType: 'POST',
    targetId: spamPost.id,
    reasonCode: 'spam',
  });
  const reportIdSpam = reportSpam.report ? reportSpam.report.id : reportSpam.id;
  const reviewedSpam = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', spamPost.id),
    { status: 'ACCEPTED', resolutionNote: '광고 확인' },
  );
  const spamHide = await repository.getPost(spamPost.id);
  ok('5. 신고 기반 게시글 숨김 상태', spamHide && spamHide.status === 'HIDDEN_BY_OPERATOR');
  ok('5. POST_SOFT_DELETE audit + report_id', (reviewedSpam.audits || []).some(function (a) {
    return a && a.actionType === 'POST_SOFT_DELETE' && a.reportId === reportIdSpam;
  }), JSON.stringify(reviewedSpam.audits));
  ok('9. 같은 신고 숨김+제재 두 건', (reviewedSpam.audits || []).filter(function (a) {
    return a && a.reportId === reportIdSpam;
  }).length >= 2);

  const reportComment = await board.createReport({ userId: uid(11) }, {
    targetType: 'COMMENT',
    targetId: comment.id,
    reasonCode: 'spam',
  });
  const reportIdComment = reportComment.report ? reportComment.report.id : reportComment.id;
  const reviewedComment = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('COMMENT', comment.id),
    { status: 'ACCEPTED', resolutionNote: '댓글 광고' },
  );
  const hiddenComment = await repository.getComment(comment.id);
  ok('6. 댓글 숨김 상태', hiddenComment && hiddenComment.status === 'HIDDEN_BY_OPERATOR');
  ok('6. COMMENT_SOFT_DELETE audit + report_id', (reviewedComment.audits || []).some(function (a) {
    return a && a.actionType === 'COMMENT_SOFT_DELETE' && a.reportId === reportIdComment && a.targetType === 'COMMENT';
  }), JSON.stringify(reviewedComment.audits));

  const rejectPost = (await board.createPost({ userId: uid(1) }, {
    title: '기각 대상 게시글 제목입니다',
    content: '기각 본문입니다. 충분히 긴 내용으로 작성합니다.',
  })).post;
  await board.createReport({ userId: uid(12) }, {
    targetType: 'POST',
    targetId: rejectPost.id,
    reasonCode: 'abuse',
  });
  const rejected = await board.reviewBehavior(
    { userId: uid(99) },
    reviewCore.behaviorKeyFromParts('POST', rejectPost.id),
    { status: 'REJECTED', resolutionNote: '위반 아님' },
  );
  ok('13. 기각은 조치 audit 없음', !(rejected.audits || []).length);
  ok('6. REPORT_REJECTED_AUDIT_NEEDED 표시', rejected.reportRejectedAudit === 'REPORT_REJECTED_AUDIT_NEEDED');

  const beforeCount = (await auditService.list({})).events.length;
  const adminAuth = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    getUserFromAccessToken: makeGetUser({
      'tok-admin': { id: uid(99), app_metadata: { role: 'ADMIN' } },
      'tok-member': { id: uid(1), app_metadata: { role: 'MEMBER' } },
      'tok-guest': null,
      'tok-um': { id: uid(2), user_metadata: { role: 'ADMIN' }, app_metadata: {} },
    }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin/audit', mountAdminAuditRoutes({ adminBypass: false, adminAuth: adminAuth }));
  app.use('/api/admin/posts', mountAdminPostsRoutes({
    adminBypass: false,
    adminAuth: adminAuth,
    applySanction: function (input) {
      return sanctionService.applyOperatorDirect(input);
    },
    getBoardService: function () { return board; },
  }));
  app.use('/api/admin/moderation', require('../server/alien-moderation-routes').mountAdminRoutes({
    adminBypass: false,
    adminAuth: adminAuth,
    getBoardService: function () { return board; },
  }));

  const g = await requestApp(app, 'GET', '/api/admin/moderation/reports');
  ok('1. Guest 401', g.status === 401);
  const m = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { Authorization: 'Bearer tok-member' },
  });
  ok('2. MEMBER 403', m.status === 403);
  const um = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { Authorization: 'Bearer tok-um' },
  });
  ok('3. user_metadata ADMIN 403', um.status === 403);
  const aok = await requestApp(app, 'GET', '/api/admin/moderation/reports', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('4. ADMIN 허용', aok.status === 200 && aok.body && aok.body.ok === true, JSON.stringify(aok.body));

  const byReport = await requestApp(app, 'GET', '/api/admin/audit?reportId=' + encodeURIComponent(reportIdSpam), {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('11. audit reportId 검색', byReport.status === 200 && (byReport.body.events || []).length >= 2, JSON.stringify(byReport.body));
  ok('12. 신고 상세 이력 조회', (byReport.body.events || []).every(function (ev) {
    return ev.reportId === reportIdSpam;
  }));

  const directPost = (await board.createPost({ userId: uid(1) }, {
    title: '직접 발견 게시글 제목입니다',
    content: '직접 조치 본문입니다. 충분히 긴 내용으로 작성합니다.',
  })).post;
  const direct = await requestApp(app, 'POST', '/api/admin/posts/' + directPost.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'abuse', operatorNote: '직접 발견' },
  });
  ok('8. 직접 조치 report_id NULL', direct.status === 200 && direct.body.audit && direct.body.audit.reportId == null, JSON.stringify(direct.body));

  const afterCount = (await auditService.list({})).events.length;
  ok('10. 신고 수를 위반 횟수로 쓰지 않음(코드 유지)', /신고 수와 확정 위반/.test(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'moderation', 'index.html'), 'utf8')
  ));
  ok('audit row 증가', afterCount > beforeCount);

  const modJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'moderation', 'admin-moderation.js'), 'utf8');
  ok('12. UI 신고별 이력 버튼', /이 신고의 처리 이력/.test(modJs) && /reportId=/.test(modJs));

  progressionService.applyPostCreatedXp = origXp;
  achievementEvaluator.evaluateAfterPostCreated = origAch;

  console.log('\nresult', { passed: passed, failed: failed });
  process.exit(failed ? 1 : 0);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
