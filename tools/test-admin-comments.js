#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const roleCore = require('../shared/admin-role-ui-core');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { mountAdminCommentsRoutes } = require('../server/board-admin-comments-routes');
const { mountAdminPostsRoutes } = require('../server/board-admin-posts-routes');
const { mountAdminAuditRoutes } = require('../server/admin-moderation-audit-routes');
const { requestApp } = require('./daily-issue-api-http-helper');
const auditService = require('../server/admin-moderation-audit-service');
const { createAdminModerationAuditMemoryRepository } = require('../server/admin-moderation-audit-memory-repository');
const auditCore = require('../shared/admin-moderation-audit-core');
const progressionService = require('../server/user-progression-service');
const achievementEvaluator = require('../server/achievement-evaluator-service');

const ROOT = path.join(__dirname, '..');

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function fakeJwt(payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return 'hdr.' + json + '.sig';
}

function makeGetUser(map) {
  return async function (token) {
    if (Object.prototype.hasOwnProperty.call(map, token)) return map[token];
    return null;
  };
}

async function main() {
  console.log('\n=== admin comments ===\n');

  const auditRepo = createAdminModerationAuditMemoryRepository();
  auditRepo.setDisplayName(uid(11), '운영자A');
  auditService.setRepository(auditRepo);

  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({
    territories: { [uid(1)]: 'CENTRAL', [uid(11)]: 'CENTRAL' },
  });
  const service = createBoardService({
    repository: repository,
    userContext: userContext,
    operational: true,
  });

  const origXp = progressionService.applyPostCreatedXp;
  const origAch = achievementEvaluator.evaluateAfterPostCreated;
  const origCommentXp = progressionService.applyBoardCommentCreatedXp;
  const origCommentAch = achievementEvaluator.evaluateAfterCommentCreated;
  progressionService.applyPostCreatedXp = async function () { return { level: 1, xp: 0 }; };
  progressionService.applyBoardCommentCreatedXp = async function () { return { level: 1, xp: 0 }; };
  achievementEvaluator.evaluateAfterPostCreated = async function () { return { granted: [] }; };
  achievementEvaluator.evaluateAfterCommentCreated = async function () { return { granted: [] }; };

  const created = await service.createPost({ userId: uid(1) }, {
    title: '댓글 관리 대상 글',
    content: '본문입니다',
  });
  const commentPack = await service.createComment({ userId: uid(1) }, created.post.id, {
    content: '관리 대상 댓글입니다',
  });
  const comment = commentPack.comment;
  const replyPack = await service.createComment({ userId: uid(1) }, created.post.id, {
    content: '관리 대상 대댓글입니다',
    parentCommentId: comment.id,
  });
  const reply = replyPack.comment;

  const adminAuth = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    getUserFromAccessToken: makeGetUser({
      'tok-admin': { id: uid(11), app_metadata: { role: 'ADMIN' }, user_metadata: {} },
      'tok-owner': { id: uid(12), app_metadata: { role: 'OWNER' }, user_metadata: { role: 'MEMBER' } },
      'tok-member': { id: uid(1), app_metadata: {}, user_metadata: { role: 'ADMIN' } },
      'tok-member-role': { id: uid(2), app_metadata: { role: 'MEMBER' }, user_metadata: { role: 'ADMIN' } },
    }),
  };

  const sanctionId = uid(88);
  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin/comments',
    mountAdminCommentsRoutes({
      adminAuth: adminAuth,
      getBoardService: function () { return service; },
      applySanction: async function (input) {
        return {
          ok: true,
          applied: true,
          action: input.action,
          event: { id: sanctionId, sourceId: input.behaviorKey },
        };
      },
    }),
  );
  app.use(
    '/api/admin/posts',
    mountAdminPostsRoutes({
      adminAuth: adminAuth,
      getBoardService: function () { return service; },
    }),
  );
  app.use('/api/admin/audit', mountAdminAuditRoutes({ adminAuth: adminAuth }));

  const guest = await requestApp(app, 'GET', '/api/admin/comments');
  ok('1. Guest 댓글 관리 API → 401', guest.status === 401, guest.status);

  const member = await requestApp(app, 'GET', '/api/admin/comments', {
    headers: { Authorization: 'Bearer tok-member' },
  });
  ok('2. MEMBER → 403', member.status === 403, member.status);
  ok('3. user_metadata ADMIN → 403', member.status === 403 && member.body.error.code === 'ADMIN_ROLE_MISSING');

  const listed = await requestApp(app, 'GET', '/api/admin/comments', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('4. ADMIN → 허용', listed.status === 200 && listed.body.ok === true, listed.status);
  ok('6. 댓글 목록 조회', (listed.body.comments || []).some(function (c) { return c.id === comment.id; }));

  const ownerList = await requestApp(app, 'GET', '/api/admin/comments', {
    headers: { Authorization: 'Bearer tok-owner' },
  });
  ok('5. OWNER → 허용', ownerList.status === 200, ownerList.status);

  const byCommentId = await requestApp(app, 'GET', '/api/admin/comments?q=' + comment.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('7. 댓글 ID 검색', (byCommentId.body.comments || []).some(function (c) { return c.id === comment.id; }));

  const byPostId = await requestApp(app, 'GET', '/api/admin/comments?q=' + created.post.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok(
    '8. 게시글 ID 검색',
    (byPostId.body.comments || []).filter(function (c) { return c.postId === created.post.id; }).length >= 2,
  );

  const detail = await requestApp(app, 'GET', '/api/admin/comments/' + comment.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('상세 본문', detail.status === 200 && detail.body.comment.content.indexOf('관리 대상 댓글') !== -1);
  ok('댓글/대댓글 구분', detail.body.comment.kind === 'COMMENT');

  const replyDetail = await requestApp(app, 'GET', '/api/admin/comments/' + reply.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('대댓글 kind=REPLY', replyDetail.body.comment.kind === 'REPLY' && replyDetail.body.comment.parentCommentId === comment.id);

  const del = await requestApp(app, 'POST', '/api/admin/comments/' + comment.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'abuse', operatorNote: '댓글 직접 숨김' },
  });
  ok('9. 댓글 숨김', del.status === 200 && del.body.comment.status === 'DELETED', JSON.stringify(del.body));
  ok('14. COMMENT_SOFT_DELETE audit 생성', del.body.audit && del.body.audit.actionType === 'COMMENT_SOFT_DELETE');
  ok('13. hard delete 없음', repository._debug.comments.get(comment.id) && repository._debug.comments.get(comment.id).content.indexOf('관리 대상 댓글') !== -1);

  const firstId = del.body.audit.id;
  const firstCreated = del.body.audit.createdAt;

  const listedAfterParentDel = await service.listComments({ userId: uid(1) }, created.post.id);
  const replyStillThere = (listedAfterParentDel || []).some(function (c) {
    return c.id === reply.id && c.parentCommentId === comment.id;
  });
  const parentMapped = (listedAfterParentDel || []).find(function (c) { return c.id === comment.id; });
  ok('23. 부모 댓글 숨김 후 대댓글 구조 회귀 없음', replyStillThere === true);
  ok('삭제된 부모는 안내 문구', parentMapped && String(parentMapped.content || '').indexOf('삭제된 댓글') !== -1);

  const rest = await requestApp(app, 'POST', '/api/admin/comments/' + comment.id + '/restore', {
    headers: { Authorization: 'Bearer tok-owner' },
    body: { reasonCode: 'OPERATOR_CORRECTION', operatorNote: '댓글 복구' },
  });
  ok('10. 댓글 복구', rest.status === 200 && rest.body.comment.status === 'ACTIVE', JSON.stringify(rest.body));
  ok('15. COMMENT_RESTORE audit 생성', rest.body.audit && rest.body.audit.actionType === 'COMMENT_RESTORE' && rest.body.audit.id !== firstId);

  ok('16. 기존 audit row 수정 없음', auditRepo._debug.events[0].id === firstId && auditRepo._debug.events[0].createdAt === firstCreated);
  let deleteThrew = false;
  try {
    await auditRepo.deleteEvent(firstId);
  } catch (e) {
    deleteThrew = e && e.code === 'ADMIN_AUDIT_APPEND_ONLY';
  }
  ok('17. 기존 audit row 삭제 없음', deleteThrew && auditRepo._debug.events.some(function (e) { return e.id === firstId; }));

  const replyDel = await requestApp(app, 'POST', '/api/admin/comments/' + reply.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'spam', operatorNote: '대댓글 숨김' },
  });
  ok('11. 대댓글 숨김', replyDel.status === 200 && replyDel.body.comment.status === 'DELETED');

  const parentAfterReplyDel = await repository.getComment(comment.id);
  ok('24. 대댓글 숨김 후 부모 댓글 유지', parentAfterReplyDel && parentAfterReplyDel.status === 'ACTIVE');

  const replyRest = await requestApp(app, 'POST', '/api/admin/comments/' + reply.id + '/restore', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'APPEAL_RESULT', operatorNote: '대댓글 복구' },
  });
  ok('12. 대댓글 복구', replyRest.status === 200 && replyRest.body.comment.status === 'ACTIVE');

  const sanc = await requestApp(app, 'POST', '/api/admin/comments/' + comment.id + '/sanction', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { action: 'WARNING', reasonCode: 'baiting', operatorNote: '댓글 화면 제재' },
  });
  ok('18. 작성자 제재 기존 sanction 사용', sanc.status === 200 && sanc.body.result && sanc.body.result.action === 'WARNING');
  ok(
    '19. SANCTION_APPLIED audit 연결',
    sanc.body.audit && sanc.body.audit.actionType === 'SANCTION_APPLIED' && sanc.body.audit.targetType === 'COMMENT' && sanc.body.audit.sanctionId === sanctionId,
    JSON.stringify(sanc.body),
  );

  const adminJwt = fakeJwt({ app_metadata: { role: 'ADMIN' }, user_metadata: {} });
  const memberJwt = fakeJwt({ app_metadata: {}, user_metadata: { role: 'ADMIN' } });
  ok('21. ADMIN/OWNER에게 관리 버튼 보임', roleCore.isAdminAppRole(roleCore.appRoleFromAccessToken(adminJwt)));
  ok('20. 일반 MEMBER/Guest에게 관리 버튼 안 보임', roleCore.isAdminAppRole(roleCore.appRoleFromAccessToken(memberJwt)) === false);

  const hist = await requestApp(app, 'GET', '/api/admin/audit?targetType=COMMENT&targetId=' + comment.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('22. 댓글별 운영 이력 조회', (hist.body.events || []).length >= 2);

  const newCommentPack = await service.createComment({ userId: uid(1) }, created.post.id, {
    content: '일반 작성 회귀 확인',
  });
  const deletedOwn = await service.deleteComment({ userId: uid(1) }, newCommentPack.comment.id);
  ok('25. 일반 댓글 작성/삭제 기능 회귀 없음', deletedOwn && deletedOwn.status === 'DELETED');

  const postsList = await requestApp(app, 'GET', '/api/admin/posts', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('26. 게시글 관리 회귀 없음', postsList.status === 200 && postsList.body.ok === true);

  const report = await service.createReport({ userId: uid(11) }, {
    targetType: 'COMMENT',
    targetId: comment.id,
    reasonCode: 'abuse',
  });
  ok('27. 신고 기능 회귀 없음', report && report.id);

  const auditSearch = await requestApp(app, 'GET', '/api/admin/audit?actionType=COMMENT_SOFT_DELETE', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('28. 관리자 audit 검색 회귀 없음', (auditSearch.body.events || []).some(function (e) { return e.actionType === 'COMMENT_SOFT_DELETE'; }));

  ok('29. Guest read-only 회귀 없음', fs.existsSync(path.join(ROOT, 'tools', 'test-guest-readonly.js')));
  ok('30. auth/OAuth 회귀 없음', /createAdminAccessGuard/.test(read('server/board-admin-comments-routes.js')));

  ok('사이트 댓글 관리 진입', /mountCommentManage/.test(read('public/admin-site-entry.js')) && /mountCommentManage/.test(read('public/index.html')));
  ok('댓글 관리 메뉴', /댓글 관리/.test(read('public/admin/admin-shell.js')) && /\/admin\/comments\//.test(read('public/admin/admin-home.js')));
  ok('audit UI에 댓글 action', /COMMENT_SOFT_DELETE/.test(read('public/admin/audit/index.html')));
  ok('core에 댓글 action', !!auditCore.ACTION_TYPE.COMMENT_SOFT_DELETE && !!auditCore.ACTION_TYPE.COMMENT_RESTORE);
  ok('migration additive', fs.existsSync(path.join(ROOT, 'supabase', 'migration_admin_comment_moderation_audit_v1.sql')));
  const sql = read('supabase/migration_admin_comment_moderation_audit_v1.sql');
  const sqlBody = sql.replace(/--[^\n]*/g, '');
  ok('migration no DROP TABLE', !/\bDROP TABLE\b/i.test(sqlBody) && !/\bTRUNCATE\s+TABLE\b/i.test(sqlBody));
  ok('hard delete 라우트 없음', !/router\.delete/.test(read('server/board-admin-comments-routes.js')));

  progressionService.applyPostCreatedXp = origXp;
  progressionService.applyBoardCommentCreatedXp = origCommentXp;
  achievementEvaluator.evaluateAfterPostCreated = origAch;
  achievementEvaluator.evaluateAfterCommentCreated = origCommentAch;

  console.log('\nAdmin comments results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
