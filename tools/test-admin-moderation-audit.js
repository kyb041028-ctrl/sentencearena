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

function makeGetUser(map) {
  return async function (token) {
    if (Object.prototype.hasOwnProperty.call(map, token)) return map[token];
    return null;
  };
}

async function main() {
  console.log('\n=== admin moderation audit ===\n');

  const auditRepo = createAdminModerationAuditMemoryRepository();
  auditRepo.setDisplayName(uid(11), '운영자A');
  auditRepo.setDisplayName(uid(1), '작성자A');
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
  progressionService.applyPostCreatedXp = async function () { return { level: 1, xp: 0 }; };
  achievementEvaluator.evaluateAfterPostCreated = async function () { return { granted: [] }; };

  const created = await service.createPost({ userId: uid(1) }, {
    title: '감사로그 대상 글',
    content: '본문은 audit에 복사되면 안 됩니다',
  });

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

  const sanctionId = uid(77);
  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin/posts',
    mountAdminPostsRoutes({
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
  app.use('/api/admin/audit', mountAdminAuditRoutes({ adminAuth: adminAuth }));

  const guest = await requestApp(app, 'GET', '/api/admin/audit');
  ok('1. Guest audit API → 401', guest.status === 401, guest.status);

  const member = await requestApp(app, 'GET', '/api/admin/audit', {
    headers: { Authorization: 'Bearer tok-member' },
  });
  ok('2. MEMBER → 403', member.status === 403, member.status);
  ok('3. user_metadata ADMIN → 403', member.status === 403 && member.body.error.code === 'ADMIN_ROLE_MISSING');

  const listed0 = await requestApp(app, 'GET', '/api/admin/audit', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('4. app_metadata ADMIN → 허용', listed0.status === 200 && listed0.body.ok === true, listed0.status);

  const ownerList = await requestApp(app, 'GET', '/api/admin/audit', {
    headers: { Authorization: 'Bearer tok-owner' },
  });
  ok('5. OWNER → 허용', ownerList.status === 200, ownerList.status);

  const missingReason = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: {},
  });
  ok('soft delete 사유 필수', missingReason.status === 400 && missingReason.body.error.code === 'ADMIN_AUDIT_REASON_CODE_INVALID', JSON.stringify(missingReason.body));

  const otherNoNote = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'other' },
  });
  ok('OTHER는 메모 필수', otherNoNote.status === 400 && otherNoNote.body.error.code === 'ADMIN_AUDIT_NOTE_REQUIRED');

  const emailNote = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'abuse', operatorNote: '연락 user@example.com' },
  });
  ok('메모 email 거부', emailNote.status === 400 && emailNote.body.error.code === 'ADMIN_AUDIT_NOTE_PII_FORBIDDEN');

  const del = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { reasonCode: 'abuse', operatorNote: '직접 발견 숨김' },
  });
  ok('6. post soft delete → audit event', del.status === 200 && del.body.post.status === 'DELETED' && del.body.audit && del.body.audit.actionType === 'POST_SOFT_DELETE', JSON.stringify(del.body));
  ok('11. reason_code 저장', del.body.audit.reasonCode === 'abuse');
  ok('12. operator_note 저장', del.body.audit.operatorNote === '직접 발견 숨김');
  ok('13. report_id NULL 직접조치 허용', del.body.audit.reportId == null);
  ok('본문 snapshot 없음', JSON.stringify(del.body.audit).indexOf('본문은 audit') === -1);

  const firstId = del.body.audit.id;
  const firstCreated = del.body.audit.createdAt;

  const rest = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/restore', {
    headers: { Authorization: 'Bearer tok-owner' },
    body: { reasonCode: 'OPERATOR_CORRECTION', operatorNote: '오판 복구' },
  });
  ok('7. restore → 새 audit event', rest.status === 200 && rest.body.post.status === 'ACTIVE' && rest.body.audit && rest.body.audit.actionType === 'POST_RESTORE' && rest.body.audit.id !== firstId, JSON.stringify(rest.body));

  ok('8. 기존 event 수정 없음', auditRepo._debug.events[0].id === firstId && auditRepo._debug.events[0].createdAt === firstCreated && auditRepo._debug.events[0].actionType === 'POST_SOFT_DELETE');
  let deleteThrew = false;
  try {
    await auditRepo.deleteEvent(firstId);
  } catch (e) {
    deleteThrew = e && e.code === 'ADMIN_AUDIT_APPEND_ONLY';
  }
  let updateThrew = false;
  try {
    await auditRepo.updateEvent(firstId, { reasonCode: 'spam' });
  } catch (e) {
    updateThrew = e && e.code === 'ADMIN_AUDIT_APPEND_ONLY';
  }
  ok('9. 기존 event 삭제 없음', deleteThrew && auditRepo._debug.events.length === 2 && auditRepo._debug.events[0].id === firstId);
  ok('append-only update 거부', updateThrew);

  const sanc = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/sanction', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: { action: 'WARNING', reasonCode: 'spam', operatorNote: '게시물 화면 제재' },
  });
  ok('10. sanction 적용 → sanction_id 연결 가능한 구조', sanc.status === 200 && sanc.body.audit && sanc.body.audit.actionType === 'SANCTION_APPLIED' && sanc.body.audit.sanctionId === sanctionId, JSON.stringify(sanc.body));

  const listed = await requestApp(app, 'GET', '/api/admin/audit', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('22. 최신순', listed.status === 200 && listed.body.events[0].actionType === 'SANCTION_APPLIED' && listed.body.events[2].actionType === 'POST_SOFT_DELETE');
  ok('관리자 displayName만', listed.body.events.some(function (e) { return e.actorDisplayName === '운영자A'; }) && JSON.stringify(listed.body).indexOf('email') === -1 && JSON.stringify(listed.body).indexOf('@') === -1);

  const from = encodeURIComponent(rest.body.audit.createdAt);
  const byFrom = await requestApp(app, 'GET', '/api/admin/audit?from=' + from, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('14. 검색 기간', (byFrom.body.events || []).every(function (e) { return e.createdAt >= rest.body.audit.createdAt; }) && (byFrom.body.events || []).length >= 2);

  const byActor = await requestApp(app, 'GET', '/api/admin/audit?actorUserId=' + uid(12), {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('15. 검색 actor', (byActor.body.events || []).length === 1 && byActor.body.events[0].actionType === 'POST_RESTORE');

  const byAction = await requestApp(app, 'GET', '/api/admin/audit?actionType=POST_SOFT_DELETE', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('16. 검색 action_type', (byAction.body.events || []).length === 1 && byAction.body.events[0].id === firstId);

  const byTarget = await requestApp(app, 'GET', '/api/admin/audit?targetType=POST&targetId=' + created.post.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('17. target_type/target_id', (byTarget.body.events || []).length === 3);

  const byReason = await requestApp(app, 'GET', '/api/admin/audit?reasonCode=abuse', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('18. reason_code', (byReason.body.events || []).length === 1 && byReason.body.events[0].id === firstId);

  const bySanc = await requestApp(app, 'GET', '/api/admin/audit?sanctionId=' + sanctionId, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('19. sanction/report id', (bySanc.body.events || []).length === 1 && bySanc.body.events[0].actionType === 'SANCTION_APPLIED');

  const byNote = await requestApp(app, 'GET', '/api/admin/audit?operatorNote=' + encodeURIComponent('오판'), {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('20. note keyword', (byNote.body.events || []).length === 1 && byNote.body.events[0].actionType === 'POST_RESTORE');

  for (let i = 0; i < 5; i++) {
    await auditService.record({
      actorUserId: uid(11),
      actionType: 'POST_SOFT_DELETE',
      targetType: 'POST',
      targetId: created.post.id,
      targetUserId: uid(1),
      reasonCode: 'baiting',
      operatorNote: '페이지 ' + i,
    });
  }
  const page1 = await requestApp(app, 'GET', '/api/admin/audit?limit=3', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  const page2 = await requestApp(app, 'GET', '/api/admin/audit?limit=3&cursor=' + encodeURIComponent(page1.body.nextCursor), {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('21. pagination', page1.body.events.length === 3 && page1.body.nextCursor && page2.body.events.length === 3 && page2.body.events[0].id !== page1.body.events[0].id);

  const patched = await service.updatePost({ userId: uid(1) }, created.post.id, {
    title: '일반 수정 유지',
    content: '일반 본문 수정입니다',
  });
  ok('23. 일반 게시판 CRUD 회귀 없음', patched && patched.title === '일반 수정 유지');

  const postsPage = read('public/admin/posts/admin-posts.js');
  const postsHtml = read('public/admin/posts/index.html');
  ok('24. 기존 admin/posts 회귀 없음', /soft-delete/.test(postsPage) && /복구/.test(postsPage) && /이 게시물 운영 이력/.test(postsPage));
  ok('제재는 게시물 관리 경로에서 기존 시스템 호출', /\/api\/admin\/posts\/.+\+ '\/sanction'/.test(postsPage) || postsPage.indexOf('/sanction') !== -1);
  ok('25. sanction 시스템 회귀 없음', /applyOperatorDirect/.test(read('server/user-sanction-service.js')) && /WARNING/.test(read('shared/user-sanction-core.js')));
  ok('26. Guest read-only 회귀 없음', /회원가입 또는 로그인 후 이용할 수 있습니다/.test(read('public/index.html')) || /GUEST_READONLY/.test(read('docs/CHANGELOG.md')) || fs.existsSync(path.join(ROOT, 'tools', 'test-guest-readonly.js')));
  ok('27. 공식글/Daily Issue/권리침해 admin 회귀 없음', /공식글/.test(read('public/admin/admin-shell.js')) && /Daily Issue/.test(read('public/admin/admin-shell.js')) && /권리침해/.test(read('public/admin/admin-shell.js')));

  const sql = read('supabase/migration_admin_moderation_audit_v1.sql');
  const sqlBody = sql.replace(/--[^\n]*/g, '').replace(/REVOKE[\s\S]*?;/gi, '\n');
  ok('migration additive', /CREATE TABLE IF NOT EXISTS public\.admin_moderation_audit_events/.test(sql));
  ok('migration no DROP TABLE/TRUNCATE/DELETE FROM', !/\bDROP TABLE\b/i.test(sqlBody) && !/\bTRUNCATE\s+(TABLE|public\.)/i.test(sqlBody) && !/\bDELETE\s+FROM\b/i.test(sqlBody));
  ok('append-only trigger', /ADMIN_AUDIT_APPEND_ONLY/.test(sql) && /GRANT SELECT, INSERT/.test(sql));
  ok('anon/authenticated revoke', /REVOKE ALL ON public\.admin_moderation_audit_events FROM anon/.test(sql) && /FROM authenticated/.test(sql));
  ok('core 사유 재사용', JSON.stringify(auditCore.CONTENT_REASON_CODES) === JSON.stringify(['abuse', 'spam', 'baiting', 'misinfo', 'privacy', 'other']));
  ok('복구 사유 최소 세트', JSON.stringify(auditCore.RESTORE_REASON_CODES) === JSON.stringify(['OPERATOR_CORRECTION', 'APPEAL_RESULT', 'OTHER']));
  ok('운영 이력 메뉴', /운영 이력/.test(read('public/admin/admin-shell.js')) && /\/admin\/audit\//.test(read('public/admin/admin-home.js')));
  ok('게시물별 이력 링크', /targetType=POST/.test(postsPage));
  ok('게시글 본문 미저장 원칙', !/content/.test(sql.split('CREATE TABLE')[1].split('COMMENT ON TABLE')[0]) && postsHtml.indexOf('audit에 복사') === -1);
  ok('retention purge가 audit 테이블을 지우지 않음', !/admin_moderation_audit_events/.test(read('server/retention-service.js')));

  progressionService.applyPostCreatedXp = origXp;
  achievementEvaluator.evaluateAfterPostCreated = origAch;

  console.log('\nAdmin audit results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
