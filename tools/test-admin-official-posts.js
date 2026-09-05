#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createBoardRouter } = require('../server/board-routes');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { mountOfficialBoardAdminRoutes } = require('../server/board-official-admin-routes');
const schema = require('../shared/board-schema-core');
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

function request(app, method, pathName, headers, bodyObj) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      const payload = bodyObj != null ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
      const hdrs = Object.assign({}, headers || {});
      if (payload) {
        hdrs['Content-Type'] = 'application/json';
        hdrs['Content-Length'] = String(payload.length);
      }
      const req = require('http').request(
        {
          hostname: '127.0.0.1',
          port: port,
          path: pathName,
          method: method,
          headers: hdrs,
        },
        function (res) {
          let raw = '';
          res.on('data', function (c) {
            raw += c;
          });
          res.on('end', function () {
            server.close();
            let body = null;
            try {
              body = JSON.parse(raw);
            } catch (_) {
              body = raw;
            }
            resolve({ status: res.statusCode, body: body });
          });
        }
      );
      req.on('error', function (e) {
        server.close();
        resolve({ status: 0, body: String(e && e.message) });
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function makeGetUser(map) {
  return async function (token) {
    if (Object.prototype.hasOwnProperty.call(map, token)) return map[token];
    return null;
  };
}

function forbiddenPii(obj) {
  const raw = JSON.stringify(obj || {});
  const hits = [];
  [
    'email',
    'app_metadata',
    'user_metadata',
    'reputation_score',
    'reputationScore',
    'alignmentScore',
    'oauth',
    'access_token',
  ].forEach(function (key) {
    if (raw.indexOf(key) !== -1) hits.push(key);
  });
  return hits;
}

function extractFn(src, name) {
  const start = src.indexOf('async function ' + name);
  if (start < 0) return '';
  const next = src.indexOf('\n  async function ', start + 10);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

async function main() {
  console.log('\n=== admin official posts ===\n');

  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({
    territories: {
      [uid(1)]: 'CENTRAL',
      admin: 'CENTRAL',
      owner: 'CENTRAL',
    },
  });
  const service = createBoardService({
    repository: repository,
    userContext: userContext,
    operational: true,
  });

  const adminAuth = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    getUserFromAccessToken: makeGetUser({
      'tok-admin': { id: uid(11), email: 'admin@example.com', app_metadata: { role: 'ADMIN' }, user_metadata: {} },
      'tok-owner': { id: uid(12), email: 'owner@example.com', app_metadata: { role: 'OWNER' }, user_metadata: { role: 'MEMBER' } },
      'tok-member': { id: uid(1), email: 'member@example.com', app_metadata: {}, user_metadata: { role: 'ADMIN' } },
      'tok-member-role': { id: uid(2), app_metadata: { role: 'MEMBER' }, user_metadata: { role: 'ADMIN' } },
    }),
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/api/board',
    createBoardRouter({
      operational: true,
      useMemory: true,
      repository: repository,
      userContext: userContext,
      resolveActorFromRequest: async function (req) {
        if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
        return null;
      },
    }),
  );
  app.use(
    '/api/admin/board',
    mountOfficialBoardAdminRoutes({
      adminAuth: adminAuth,
      getBoardService: function () {
        return service;
      },
    }),
  );

  const guestCreate = await request(app, 'POST', '/api/admin/board/official-posts', {}, {
    title: '게스트 공식',
    content: '본문입니다',
  });
  ok('1. Guest 공식글 생성 → 401', guestCreate.status === 401 && guestCreate.body.error && guestCreate.body.error.code === 'ADMIN_TOKEN_MISSING', guestCreate.status);

  const memberCreate = await request(app, 'POST', '/api/admin/board/official-posts', {
    Authorization: 'Bearer tok-member',
  }, { title: '회원 공식', content: '본문입니다' });
  ok('2. 일반 MEMBER → 403', memberCreate.status === 403 && memberCreate.body.error.code === 'ADMIN_ROLE_MISSING', memberCreate.status);

  const userMetaAdmin = await request(app, 'POST', '/api/admin/board/official-posts', {
    Authorization: 'Bearer tok-member',
  }, { title: '위조 ADMIN', content: '본문입니다' });
  ok('3. user_metadata.role=ADMIN → 403', userMetaAdmin.status === 403, userMetaAdmin.status);

  const appMemberRole = await request(app, 'POST', '/api/admin/board/official-posts', {
    Authorization: 'Bearer tok-member-role',
  }, { title: 'app MEMBER', content: '본문입니다' });
  ok('3b. app_metadata MEMBER → 403', appMemberRole.status === 403 && appMemberRole.body.error.code === 'ADMIN_ROLE_FORBIDDEN', appMemberRole.status);

  let xpCalls = 0;
  let achCalls = 0;
  const origXp = progressionService.applyPostCreatedXp;
  const origAch = achievementEvaluator.evaluateAfterPostCreated;
  progressionService.applyPostCreatedXp = async function () {
    xpCalls += 1;
    return { level: 1, xp: 0 };
  };
  achievementEvaluator.evaluateAfterPostCreated = async function () {
    achCalls += 1;
    return { granted: [] };
  };

  const adminCreate = await request(app, 'POST', '/api/admin/board/official-posts', {
    Authorization: 'Bearer tok-admin',
  }, { title: '[공식] 운영 안내', content: '관리자 본문입니다', isOfficial: false });
  ok('4. app_metadata ADMIN → 허용', adminCreate.status === 201 && adminCreate.body.ok === true, adminCreate.status + ' ' + JSON.stringify(adminCreate.body));
  ok('6. 공식글 생성 시 is_official=true', adminCreate.body.post && adminCreate.body.post.isOfficial === true, JSON.stringify(adminCreate.body.post));
  ok('4b. 작성자는 관리자 계정', adminCreate.body.post && adminCreate.body.post.author && adminCreate.body.post.author.userId === uid(11), JSON.stringify(adminCreate.body.post && adminCreate.body.post.author));
  ok('17. 운영 공식글 XP skip', xpCalls === 0 && adminCreate.body.progression === null, 'xpCalls=' + xpCalls);
  ok('17b. 운영 공식글 업적 skip', achCalls === 0 && Array.isArray(adminCreate.body.newlyGrantedAchievements) && adminCreate.body.newlyGrantedAchievements.length === 0, 'achCalls=' + achCalls);

  const ownerCreate = await request(app, 'POST', '/api/admin/board/official-posts', {
    Authorization: 'Bearer tok-owner',
  }, { title: 'OWNER 공식글', content: '오너 본문입니다' });
  ok('5. app_metadata OWNER → 허용', ownerCreate.status === 201 && ownerCreate.body.post && ownerCreate.body.post.isOfficial === true, ownerCreate.status);
  ok('5b. OWNER 작성자 정본', ownerCreate.body.post.author.userId === uid(12), JSON.stringify(ownerCreate.body.post.author));

  const memberPost = await request(app, 'POST', '/api/board/posts', {
    'x-user-id': uid(1),
  }, { title: '일반 회원 글', content: '일반 본문입니다', isOfficial: true, is_official: true });
  ok('7. 일반 게시글 API는 is_official=false', memberPost.status === 201 && memberPost.body.post && memberPost.body.post.isOfficial === false, memberPost.status + ' ' + JSON.stringify(memberPost.body));
  ok('8. 일반 회원 isOfficial=true 위조 불가', memberPost.body.post.isOfficial === false, JSON.stringify(memberPost.body.post));

  const officialId = adminCreate.body.post.id;
  const memberPatchOfficial = await request(app, 'PATCH', '/api/board/posts/' + officialId, {
    'x-user-id': uid(1),
  }, { title: '회원 수정 시도', content: '바꾸기' });
  ok('9. 공식글 수정 일반 회원 불가', memberPatchOfficial.status === 403 && memberPatchOfficial.body.error === 'BOARD_OFFICIAL_OPERATOR_ONLY', memberPatchOfficial.status + ' ' + JSON.stringify(memberPatchOfficial.body));

  const memberDeleteOfficial = await request(app, 'DELETE', '/api/board/posts/' + officialId, {
    'x-user-id': uid(1),
  });
  ok('10. 공식글 삭제 일반 회원 불가', memberDeleteOfficial.status === 403 && memberDeleteOfficial.body.error === 'BOARD_OFFICIAL_OPERATOR_ONLY', memberDeleteOfficial.status + ' ' + JSON.stringify(memberDeleteOfficial.body));

  const memberAdminPatch = await request(app, 'PATCH', '/api/admin/board/official-posts/' + officialId, {
    Authorization: 'Bearer tok-member',
  }, { title: '회원 관리자 API 수정', content: '불가' });
  ok('9b. 공식글 수정 MEMBER 관리자 API 403', memberAdminPatch.status === 403, memberAdminPatch.status);

  const adminPatch = await request(app, 'PATCH', '/api/admin/board/official-posts/' + officialId, {
    Authorization: 'Bearer tok-admin',
  }, { title: '[공식] 운영 안내 수정', content: '수정된 본문입니다', isOfficial: false });
  ok('9c. ADMIN 공식글 수정 가능', adminPatch.status === 200 && adminPatch.body.post && adminPatch.body.post.isOfficial === true, adminPatch.status + ' ' + JSON.stringify(adminPatch.body));
  ok('9d. 수정 후에도 공식 유지', adminPatch.body.post.title.indexOf('수정') !== -1 && adminPatch.body.post.isOfficial === true);

  const convertMember = await request(app, 'PATCH', '/api/admin/board/official-posts/' + memberPost.body.post.id, {
    Authorization: 'Bearer tok-admin',
  }, { title: '공식 변환 시도', content: '변환' });
  ok('변환 기능 없음(일반글 404)', convertMember.status === 404, convertMember.status);

  const listed = await request(app, 'GET', '/api/admin/board/official-posts', {
    Authorization: 'Bearer tok-owner',
  });
  ok('공식글 목록 ADMIN/OWNER', listed.status === 200 && (listed.body.posts || []).some(function (p) { return p.id === officialId && p.isOfficial === true; }), listed.status);

  const guestBoard = await request(app, 'GET', '/api/board/posts/' + officialId, {});
  ok('15. Guest read-only 공식글 읽기', guestBoard.status === 200 && guestBoard.body.post && guestBoard.body.post.isOfficial === true, guestBoard.status + ' ' + JSON.stringify(guestBoard.body));
  ok('12. 목록/상세 배지 contract', schema.shouldShowOfficialBadge(guestBoard.body.post.isOfficial) === true);

  const guestWrite = await request(app, 'POST', '/api/board/posts', {}, { title: '게스트 글', content: '본문' });
  ok('15b. Guest 일반 작성 불가', guestWrite.status === 401, guestWrite.status);

  const piiHits = forbiddenPii(adminCreate.body.post).concat(forbiddenPii(guestBoard.body.post)).concat(forbiddenPii(listed.body.posts));
  ok('16. 공개 payload 개인정보 증가 없음', piiHits.length === 0, piiHits.join(','));

  const ownerDelete = await request(app, 'DELETE', '/api/admin/board/official-posts/' + officialId, {
    Authorization: 'Bearer tok-owner',
  });
  ok('10b. OWNER 공식글 종료 가능', ownerDelete.status === 200 && ownerDelete.body.post && ownerDelete.body.post.status === schema.STATUS.DELETED, ownerDelete.status + ' ' + JSON.stringify(ownerDelete.body));
  ok('11. soft delete 유지', ownerDelete.body.post.status === 'DELETED' && ownerDelete.body.post.id === officialId, JSON.stringify(ownerDelete.body.post));

  const stored = await repository.getPost(officialId);
  ok('11b. row 유지(hard delete 아님)', stored && stored.id === officialId && stored.status === 'DELETED' && stored.isOfficial === true, JSON.stringify(stored));

  const afterDeleteList = await request(app, 'GET', '/api/admin/board/official-posts', {
    Authorization: 'Bearer tok-admin',
  });
  ok('11c. 종료된 공식글은 운영 목록에서 제외', (afterDeleteList.body.posts || []).every(function (p) { return p.id !== officialId; }), JSON.stringify(afterDeleteList.body.posts));

  const memberCrud = await request(app, 'PATCH', '/api/board/posts/' + memberPost.body.post.id, {
    'x-user-id': uid(1),
  }, { title: '일반 글 수정', content: '일반 본문 수정입니다' });
  ok('13. 일반 게시판 CRUD 회귀 없음', memberCrud.status === 200 && memberCrud.body.post && memberCrud.body.post.isOfficial === false && memberCrud.body.post.title === '일반 글 수정', memberCrud.status + ' ' + JSON.stringify(memberCrud.body));

  const src = read('server/board-service.js');
  const officialFn = extractFn(src, 'createOfficialPost');
  const memberFn = extractFn(src, 'createPost');
  ok('17c. official create는 POST_CREATED XP 미호출', officialFn.indexOf('applyPostCreatedXp') === -1, officialFn.slice(0, 80));
  ok('17d. official create는 업적 evaluator 미호출', officialFn.indexOf('evaluateAfterPostCreated') === -1);
  ok('17e. 일반 createPost XP 로직 유지', memberFn.indexOf('applyPostCreatedXp') !== -1 && memberFn.indexOf('evaluateAfterPostCreated') !== -1);

  const html = read('public/admin/official-posts/index.html');
  const js = read('public/admin/official-posts/admin-official-posts.js');
  const indexHtml = read('public/index.html');
  ok('UI 최소 작성/목록/수정/삭제', /공식글 작성/.test(html) && /현재 공식글/.test(html) && /종료\/삭제/.test(js));
  ok('UI는 title/content만 전송', /JSON\.stringify\(\{ title: title, content: content \}\)/.test(js));
  ok('UI 클라이언트 isOfficial 지정 없음', js.indexOf('isOfficial') === -1 || /post\.isOfficial === true/.test(js));
  ok('사용자 index에 공식글 관리 링크 없음', indexHtml.indexOf('/admin/official-posts') === -1);
  ok('UI sessionStorage만', js.indexOf('sessionStorage') !== -1 && !/\blocalStorage\b/.test(js));
  ok('UI query token 없음', js.indexOf('token=') === -1);
  ok('배지 helper 유지', /appendOfficialBoardTitle\(h, p\.title/.test(indexHtml) && /p\.isOfficial === true/.test(indexHtml));
  ok('DB trigger 유지', /protect_board_posts_is_official/.test(read('supabase/migration_board_posts_is_official_v1.sql')));

  progressionService.applyPostCreatedXp = origXp;
  achievementEvaluator.evaluateAfterPostCreated = origAch;

  console.log('\nAdmin official posts results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
