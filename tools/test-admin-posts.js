#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const roleCore = require('../shared/admin-role-ui-core');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { mountAdminPostsRoutes } = require('../server/board-admin-posts-routes');
const { requestApp } = require('./daily-issue-api-http-helper');
const { resolveAlienModerationV1Enabled } = require('../server/alien-moderation-v1-flag');
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
  console.log('\n=== admin posts + shell ===\n');

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
    title: '검색될 제목입니다',
    content: '관리자 확인용 본문입니다',
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

  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin/posts',
    mountAdminPostsRoutes({
      adminAuth: adminAuth,
      getBoardService: function () {
        return service;
      },
    }),
  );

  const guest = await requestApp(app, 'GET', '/api/admin/posts');
  ok('Guest admin posts API → 401', guest.status === 401, guest.status);

  const member = await requestApp(app, 'GET', '/api/admin/posts', {
    headers: { Authorization: 'Bearer tok-member' },
  });
  ok('MEMBER → 403', member.status === 403, member.status);
  ok('user_metadata ADMIN → 403', member.status === 403 && member.body.error.code === 'ADMIN_ROLE_MISSING');

  const listed = await requestApp(app, 'GET', '/api/admin/posts', {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('app_metadata ADMIN → 허용', listed.status === 200 && listed.body.ok === true, listed.status);
  ok('목록에 글 있음', (listed.body.posts || []).some(function (p) { return p.id === created.post.id; }));

  const ownerList = await requestApp(app, 'GET', '/api/admin/posts?q=' + encodeURIComponent('검색될'), {
    headers: { Authorization: 'Bearer tok-owner' },
  });
  ok('OWNER → 허용', ownerList.status === 200, ownerList.status);
  ok('제목 검색', (ownerList.body.posts || []).some(function (p) { return p.id === created.post.id; }));

  const byId = await requestApp(app, 'GET', '/api/admin/posts?q=' + created.post.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('ID 검색', (byId.body.posts || []).length === 1 && byId.body.posts[0].id === created.post.id);

  const detail = await requestApp(app, 'GET', '/api/admin/posts/' + created.post.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('상세 본문 확인', detail.status === 200 && detail.body.post.content.indexOf('관리자 확인용') !== -1);
  ok('공개 payload 최소', JSON.stringify(detail.body).indexOf('email') === -1 && JSON.stringify(detail.body).indexOf('decidedBy') === -1);

  const del = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-admin' },
    body: {},
  });
  ok('soft delete', del.status === 200 && del.body.post.status === 'DELETED', JSON.stringify(del.body));
  ok('hard delete 없음', del.body.post.id === created.post.id && repository._debug.posts.get(created.post.id));
  ok('audit schema 필요 표시', del.body.audit === 'ADMIN_DIRECT_ACTION_AUDIT_SCHEMA_REQUIRED');

  const stored = await repository.getPost(created.post.id);
  ok('row 유지', stored && stored.status === 'DELETED' && stored.content.indexOf('관리자 확인용') !== -1);

  const publicHidden = await service.getPost({ userId: uid(1) }, created.post.id);
  ok('일반 조회는 삭제 본문 숨김', publicHidden && publicHidden.status === 'DELETED' && publicHidden.content == null);

  const adminAfterDel = await requestApp(app, 'GET', '/api/admin/posts/' + created.post.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('관리자 상세는 삭제 후에도 본문 유지', adminAfterDel.status === 200 && adminAfterDel.body.post.content.indexOf('관리자 확인용') !== -1);

  const memberDel = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/soft-delete', {
    headers: { Authorization: 'Bearer tok-member' },
    body: {},
  });
  ok('MEMBER soft-delete → 403', memberDel.status === 403, memberDel.status);

  const hard = await requestApp(app, 'DELETE', '/api/admin/posts/' + created.post.id, {
    headers: { Authorization: 'Bearer tok-admin' },
  });
  ok('hard delete 라우트 없음', hard.status === 404, hard.status);

  const rest = await requestApp(app, 'POST', '/api/admin/posts/' + created.post.id + '/restore', {
    headers: { Authorization: 'Bearer tok-owner' },
    body: {},
  });
  ok('restore', rest.status === 200 && rest.body.post.status === 'ACTIVE', JSON.stringify(rest.body));
  ok('restore audit schema 필요 표시', rest.body.audit === 'ADMIN_DIRECT_ACTION_AUDIT_SCHEMA_REQUIRED');

  const memberPatch = await service.updatePost({ userId: uid(1) }, created.post.id, {
    title: '일반 수정',
    content: '일반 본문 수정입니다',
  });
  ok('일반 board CRUD 회귀 없음', memberPatch && memberPatch.isOfficial === false && memberPatch.title === '일반 수정');

  const adminJwt = fakeJwt({ app_metadata: { role: 'ADMIN' }, user_metadata: { role: 'MEMBER' } });
  const ownerJwt = fakeJwt({ app_metadata: { role: 'OWNER' }, user_metadata: {} });
  const memberJwt = fakeJwt({ app_metadata: {}, user_metadata: { role: 'ADMIN' } });
  ok('ADMIN/OWNER에게만 관리 버튼 보임', roleCore.isAdminAppRole(roleCore.appRoleFromAccessToken(adminJwt)) && roleCore.isAdminAppRole(roleCore.appRoleFromAccessToken(ownerJwt)));
  ok('일반 회원에게 관리 버튼 안 보임', roleCore.isAdminAppRole(roleCore.appRoleFromAccessToken(memberJwt)) === false);
  ok('user_metadata ADMIN 무시', roleCore.appRoleFromAccessToken(memberJwt) === '');

  const index = read('public/index.html');
  const entry = read('public/admin-site-entry.js');
  const routes = read('server/board-admin-posts-routes.js');
  const repo = read('server/board-supabase-repository.js');
  ok('사이트 관리 진입은 스크립트 훅', /ScAdminSiteEntry\.mountPostManage/.test(index) && entry.indexOf('관리') !== -1);
  ok('일반 사이트에 삭제 UI 없음', index.indexOf('/api/admin/posts/') === -1 && index.indexOf('/admin/official-posts') === -1);
  ok('공통 메뉴 파일', /게시물 관리/.test(read('public/admin/admin-shell.js')) && /관리자 홈/.test(read('public/admin/index.html')));
  ok('기존 admin 페이지 유지', /신고 검토/.test(read('public/admin/moderation/index.html')) && /공식글 관리/.test(read('public/admin/official-posts/index.html')));
  ok('Alien OFF 표시', /Alien 관리 \(OFF\)/.test(read('public/admin/admin-shell.js')));
  ok('Alien OFF 유지', resolveAlienModerationV1Enabled({ NODE_ENV: 'production', ALIEN_MODERATION_V1: 'false' }) === false);
  ok('제재는 기존 API 연결', /\/api\/admin\/moderation\/users\//.test(read('public/admin/posts/admin-posts.js')));
  ok('createAdminAccessGuard 재사용', /createAdminAccessGuard/.test(routes));
  const opDelStart = repo.indexOf('async function operatorSoftDeletePost');
  const opDelNext = repo.indexOf('async function ', opDelStart + 10);
  const opDelFn = opDelStart >= 0 ? repo.slice(opDelStart, opDelNext > opDelStart ? opDelNext : undefined) : '';
  ok('admin 경로에 hard delete 없음', /router\.delete/.test(routes) === false && /\.delete\(\)/.test(opDelFn) === false);
  ok('운영자 삭제는 작성자 조건 없음', opDelFn.indexOf('author_user_id') === -1);
  ok('새 migration 파일 없음', fs.existsSync(path.join(ROOT, 'supabase', 'migration_admin_direct_action_audit_v1.sql')) === false);

  progressionService.applyPostCreatedXp = origXp;
  achievementEvaluator.evaluateAfterPostCreated = origAch;

  console.log('\nAdmin posts results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
