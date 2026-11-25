'use strict';

const http = require('http');
const express = require('express');
const hub = require('../shared/admin-hub-core');
const shell = require('../public/admin/admin-shell');
const { mountAdminMembersRoutes } = require('../server/admin-members-routes');
const { mountAdminInquiriesRoutes } = require('../server/admin-inquiries-routes');
const { mountAdminSystemRoutes } = require('../server/admin-system-routes');
const { createApiErrorLog } = require('../server/admin-api-error-log');
const { createAdminOpsQuery } = require('../server/admin-ops-query');

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

function request(app, method, path, token, body) {
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function () {
      const headers = { Accept: 'application/json' };
      let payload = null;
      if (token) headers.Authorization = 'Bearer ' + token;
      if (body) {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: path, method: method, headers: headers }, function (res) {
        let buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          server.close(function () { let parsed = null; try { parsed = buf ? JSON.parse(buf) : null; } catch (_) { parsed = buf; } resolve({ status: res.statusCode, body: parsed }); });
        });
      });
      req.on('error', function (err) { server.close(function () { reject(err); }); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

const adminAuth = {
  supabaseUrl: 'http://127.0.0.1:9',
  supabaseAnonKey: 'test-anon',
  getUserFromAccessToken: function (token) {
    if (token === 'admin-token') return { id: 'admin-1', app_metadata: { role: 'ADMIN' } };
    if (token === 'owner-token') return { id: 'owner-1', app_metadata: { role: 'OWNER' } };
    if (token === 'member-token') return { id: 'member-1', app_metadata: { role: 'MEMBER' } };
    if (token === 'meta-token') return { id: 'meta-1', app_metadata: {}, user_metadata: { role: 'ADMIN' } };
    return null;
  },
};

async function main() {
  const labels = shell.MENU.map(function (g) { return g.label; });
  ok('최상위 메뉴 8개 순서', JSON.stringify(labels) === JSON.stringify([
    '운영 대시보드', '회원 관리', '콘텐츠 관리', '신고·제재', 'Daily Issue', '시스템 모니터링', '문의·피드백', '운영 설정·기록',
  ]), JSON.stringify(labels));
  const allHrefs = [];
  shell.MENU.forEach(function (g) { allHrefs.push(g.href); g.children.forEach(function (c) { allHrefs.push(c.href); }); });
  const existingUrls = ['/admin/posts/', '/admin/comments/', '/admin/official-posts/', '/admin/moderation/', '/admin/rights-infringement/', '/admin/daily-issues/', '/admin/audit/', '/admin/retention/', '/admin/ops-stats/'];
  ok('기존 URL이 메뉴에 그대로 연결', existingUrls.every(function (u) { return allHrefs.indexOf(u) >= 0; }));
  ok('새 URL 5개', ['/admin/members/', '/admin/content/', '/admin/system/', '/admin/inquiries/', '/admin/settings/'].every(function (u) { return allHrefs.indexOf(u) >= 0; }));
  ok('경로별 그룹', shell.groupForPath('/admin/audit/') === 'settings' && shell.groupForPath('/admin/posts/') === 'content' && shell.groupForPath('/admin/rights-infringement/') === 'moderation' && shell.groupForPath('/admin/ops-stats/') === 'dashboard');

  const p = hub.parsePaging({ page: '0', pageSize: '999' });
  ok('페이지 값 보정', p.page === 1 && p.pageSize === 50 && p.offset === 0);
  ok('페이지 오프셋', hub.parsePaging({ page: '3', pageSize: '10' }).offset === 20);
  ok('다음 배치 05:00 (KST 03:00 기준)', hub.nextAlignmentSlot('2026-10-28T18:00:00.000Z') === '2026-10-28T20:00:00.000Z', hub.nextAlignmentSlot('2026-10-28T18:00:00.000Z'));
  ok('다음 배치 17:00 (KST 12:00 기준)', hub.nextAlignmentSlot('2026-10-29T03:00:00.000Z') === '2026-10-29T08:00:00.000Z');
  ok('다음 배치 다음날 05:00 (KST 18:00 기준)', hub.nextAlignmentSlot('2026-10-29T09:00:00.000Z') === '2026-10-29T20:00:00.000Z');

  const sm = hub.serializeMember({ id: 'x', display_name: '가나', created_at: '2026-10-01T00:00:00Z', territory: 'CENTRAL', email: 'a@b.c', password: 'p', access_token: 't', alignment_score: 5 }, { level: 2, reputation: 3, sanctionCount: 1, activeSanctionCount: 0 });
  ok('회원 응답에 민감 필드 없음', !/email|password|token|alignment|a@b\.c/i.test(JSON.stringify(sm)), JSON.stringify(sm));
  ok('영토는 canonical 소문자', sm.territory === 'central');
  const unknown = hub.serializeMember({ id: 'x', display_name: 'n', created_at: '2026-10-01T00:00:00Z', territory: null }, { progressionKnown: false, sanctionKnown: false, activityKnown: false, territoryKnown: false });
  ok('모르는 값은 0이 아니라 미확인', unknown.level === null && unknown.sanctionCount === null && unknown.status === 'NOT_CONFIRMED' && unknown.lastActivityStatus === 'NOT_CONFIRMED' && unknown.territoryStatus === 'NOT_CONFIRMED', JSON.stringify(unknown));
  const noAct = hub.serializeMember({ id: 'x', display_name: 'n', created_at: '2026-10-01T00:00:00Z', territory: null }, {});
  ok('활동 기록이 없으면 기록 없음', noAct.lastActivityAt === null && noAct.lastActivityStatus === 'NO_RECORD');

  const log = createApiErrorLog({ max: 2 });
  const logApp = express();
  logApp.use(log.middleware);
  logApp.get('/api/boom/:id', function (req, res) { res.status(500).json({ ok: false }); });
  logApp.get('/api/fine', function (req, res) { res.json({ ok: true }); });
  logApp.get('/other', function (req, res) { res.status(500).end('x'); });
  await request(logApp, 'GET', '/api/boom/11111111-1111-1111-1111-111111111111?token=secret');
  await request(logApp, 'GET', '/api/fine');
  await request(logApp, 'GET', '/other');
  const snap = log.snapshot(10);
  ok('5xx /api 만 기록, 쿼리·ID 제거', snap.items.length === 1 && snap.items[0].path === '/api/boom/:id' && !/secret/.test(JSON.stringify(snap)), JSON.stringify(snap));

  ok('DB 저장소 아니면 SQL 실행기 없음', createAdminOpsQuery({ DAILY_ISSUE_REPOSITORY: 'json' }) === null);
  const q = createAdminOpsQuery({ DAILY_ISSUE_REPOSITORY: 'db' }, { createExecutor: function () { return { ok: false }; } });
  let code = null;
  try { await q('SELECT 1', []); } catch (e) { code = e.code; }
  ok('연결 불가면 DB_UNAVAILABLE', code === 'DB_UNAVAILABLE');

  const app = express();
  app.use(express.json());
  app.use('/api/admin/members', mountAdminMembersRoutes({ adminAuth: adminAuth, query: null }));
  app.use('/api/admin/inquiries', mountAdminInquiriesRoutes({ adminAuth: adminAuth, query: null }));
  app.use('/api/admin/system', mountAdminSystemRoutes({
    adminAuth: adminAuth, query: null, errorLog: log, visitCollectionEnabled: false, authConfigured: true, serviceClientConfigured: false,
    now: '2026-10-29T03:00:00.000Z', getSchedulerRuntime: function () { return { morning: false, alignment: false }; },
  }));
  const targets = [
    ['GET', '/api/admin/members'],
    ['GET', '/api/admin/members/11111111-1111-1111-1111-111111111111'],
    ['GET', '/api/admin/inquiries'],
    ['PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', { status: 'DONE' }],
    ['GET', '/api/admin/system/status'],
  ];
  for (const t of targets) {
    const guest = await request(app, t[0], t[1], null, t[2]);
    const member = await request(app, t[0], t[1], 'member-token', t[2]);
    const meta = await request(app, t[0], t[1], 'meta-token', t[2]);
    ok('게스트 401 ' + t[0] + ' ' + t[1].split('/').slice(3, 5).join('/'), guest.status === 401, guest.status);
    ok('일반 회원 403 ' + t[0] + ' ' + t[1].split('/').slice(3, 5).join('/'), member.status === 403, member.status);
    ok('user_metadata 역할은 거부 ' + t[0], meta.status === 403, meta.status);
  }
  const noDbMembers = await request(app, 'GET', '/api/admin/members', 'admin-token');
  ok('DB 없으면 미확인(0명 아님)', noDbMembers.status === 200 && noDbMembers.body.available === false && noDbMembers.body.members === undefined, JSON.stringify(noDbMembers.body));
  const noDbInq = await request(app, 'GET', '/api/admin/inquiries', 'owner-token');
  ok('문의 저장소 없으면 미확인 + 접수 비활성', noDbInq.status === 200 && noDbInq.body.available === false && noDbInq.body.intake.enabled === false && noDbInq.body.total === null, JSON.stringify(noDbInq.body));
  const patchNoDb = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'admin-token', { status: 'DONE' });
  ok('저장소 없으면 수정 503', patchNoDb.status === 503, patchNoDb.status);
  const badStatus = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'admin-token', { status: 'HACK' });
  ok('잘못된 상태 400', badStatus.status === 400, badStatus.status);
  const badId = await request(app, 'GET', '/api/admin/members/not-a-uuid', 'admin-token');
  ok('잘못된 회원 ID 400', badId.status === 400, badId.status);
  const sys = await request(app, 'GET', '/api/admin/system/status', 'owner-token');
  ok('시스템 상태 OWNER', sys.status === 200 && sys.body.viewer.role === 'OWNER' && sys.body.visitCollection.enabled === false && sys.body.visitCollection.toggle === 'NONE', JSON.stringify(sys.body.visitCollection));
  ok('DB 미연결은 미확인', sys.body.database.status === 'NOT_CONFIRMED' && sys.body.schedulers.alignment.lastBatch.status === 'NOT_CONFIRMED');
  ok('다음 성향 배치 17:00 KST', sys.body.schedulers.alignment.nextSlotAt === '2026-10-29T08:00:00.000Z', sys.body.schedulers.alignment.nextSlotAt);
  ok('로그인 제공자는 미확인, 비밀키 없음', sys.body.login.providers.status === 'NOT_CONFIRMED' && !/anon|secret|key"/i.test(JSON.stringify(sys.body.login).replace(/serverAuthConfigured|serviceClientConfigured/g, '')));

  console.log('RESULT ' + passed + ' PASS ' + failed + ' FAIL');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
