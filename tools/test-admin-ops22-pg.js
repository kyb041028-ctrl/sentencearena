'use strict';

const fs = require('fs');
const http = require('http');
const express = require('express');
const { Client } = require('../node_modules/pg');
const { mountAdminInquiriesRoutes } = require('../server/admin-inquiries-routes');
const { mountMemberInquiryRoutes } = require('../server/member-inquiry-routes');
const { mountAdminNoticesRoutes, mountPublicNoticesRoutes } = require('../server/admin-notices-routes');
const { mountAdminOpsEventsRoutes } = require('../server/admin-ops-events-routes');
const { mountAdminSystemRoutes } = require('../server/admin-system-routes');
const { createApiErrorLog } = require('../server/admin-api-error-log');
const { createApiErrorStore, ROW_CAP } = require('../server/admin-api-error-store');

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
          let parsed = null;
          try { parsed = buf ? JSON.parse(buf) : null; } catch (_) { parsed = null; }
          server.close(function () { resolve({ status: res.statusCode, body: parsed, raw: buf }); });
        });
      });
      req.on('error', function (err) { server.close(function () { reject(err); }); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

const M1 = '11111111-1111-1111-1111-111111111111';
const M2 = '22222222-2222-2222-2222-222222222222';
const M3 = '33333333-3333-3333-3333-333333333333';
const ADMIN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OWNER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

async function main() {
  const pwFile = process.env.CONSENT_ISOLATED_PW_FILE;
  if (!pwFile) {
    console.log('SKIPPED isolated DB test: CONSENT_ISOLATED_PW_FILE not set');
    return;
  }
  const client = new Client({
    host: '127.0.0.1', port: 55432, user: 'consent_tester', password: fs.readFileSync(pwFile, 'utf8').trim(), database: 'consent_isolated',
  });
  await client.connect();
  const meta = await client.query('SELECT current_database() AS d, inet_server_addr()::text AS addr, inet_server_port() AS port');
  if (meta.rows[0].d !== 'consent_isolated' || String(meta.rows[0].addr).indexOf('127.0.0.1') !== 0 || Number(meta.rows[0].port) !== 55432) {
    throw new Error('REFUSED_TARGET');
  }
  await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;");
  for (const f of ['migration_admin_inquiries_v1.sql', 'migration_admin_notices_v1.sql', 'migration_admin_api_error_records_v1.sql', 'migration_admin_ops_events_view_candidate_v1.sql']) {
    await client.query(fs.readFileSync('supabase/' + f, 'utf8'));
  }
  await client.query('TRUNCATE public.admin_inquiry_events, public.admin_inquiries, public.admin_notice_events, public.admin_notices, public.admin_api_error_records CASCADE');

  async function query(sql, params) { return client.query(sql, params); }
  const getUser = function (token) {
    if (token === 'admin-token') return { id: ADMIN, app_metadata: { role: 'ADMIN' } };
    if (token === 'owner-token') return { id: OWNER, app_metadata: { role: 'OWNER' } };
    if (token === 'm1') return { id: M1, app_metadata: {} };
    if (token === 'm2') return { id: M2, app_metadata: {} };
    if (token === 'm3') return { id: M3, app_metadata: {} };
    if (token === 'meta-admin') return { id: M1, app_metadata: {}, user_metadata: { role: 'ADMIN' } };
    return null;
  };
  const adminAuth = { supabaseUrl: 'http://127.0.0.1:9', supabaseAnonKey: 'test-anon', getUserFromAccessToken: getUser };
  const memberAuth = { getUserFromAccessToken: getUser };

  function buildApp(opts) {
    const app = express();
    app.use(express.json());
    app.use('/api/inquiries', mountMemberInquiryRoutes({ auth: memberAuth, query: query, intakeEnabled: opts.intake }));
    app.use('/api/admin/inquiries', mountAdminInquiriesRoutes({ adminAuth: adminAuth, query: query, intakeEnabled: opts.intake }));
    app.use('/api/admin/ops-events', mountAdminOpsEventsRoutes({ adminAuth: adminAuth, query: opts.noQuery ? null : query }));
    app.use('/api/admin/notices', mountAdminNoticesRoutes({ adminAuth: adminAuth, query: query }));
    app.use('/api/notices', mountPublicNoticesRoutes({ enabled: opts.noticesPublic, query: query }));
    app.use('/api/admin/system', mountAdminSystemRoutes({ adminAuth: adminAuth, query: query, errorStore: opts.errorStore, visitCollectionEnabled: false }));
    return app;
  }
  const off = buildApp({ intake: false, noticesPublic: false });
  const on = buildApp({ intake: true, noticesPublic: true });

  // ---- A. 문의 접수 ----
  ok('A1 회원 접수 꺼짐 상태 확인', (await request(off, 'GET', '/api/inquiries/status', 'm1')).body.intakeEnabled === false);
  const disabledPost = await request(off, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: 't', body: 'b' });
  ok('A2 접수 꺼짐이면 503, 저장 0건', disabledPost.status === 503 && disabledPost.body.error.code === 'INQUIRY_INTAKE_DISABLED' && (await client.query('SELECT COUNT(*)::int n FROM public.admin_inquiries')).rows[0].n === 0);
  ok('A3 비회원 접수 401', (await request(on, 'POST', '/api/inquiries', null, { kind: 'BUG', title: 't', body: 'b' })).status === 401);
  ok('A4 잘못된 토큰 401', (await request(on, 'POST', '/api/inquiries', 'bogus', { kind: 'BUG', title: 't', body: 'b' })).status === 401);
  ok('A5 쿼리 토큰 거부', (await request(on, 'GET', '/api/inquiries/mine?token=m1', 'm1')).status === 403);
  ok('A6 종류 검증', (await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'REPORT', title: 't', body: 'b' })).status === 400);
  ok('A7 빈 제목/본문 거부', (await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: '  ', body: 'b' })).status === 400 && (await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: 't', body: '' })).status === 400);
  ok('A8 길이 초과 거부', (await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: 'x'.repeat(201), body: 'b' })).status === 400 && (await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: 't', body: 'y'.repeat(4001) })).status === 400);

  const first = await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: '로그인 오류 제보', body: '버튼이 안 눌립니다 SECRETWORD' });
  ok('A9 회원 접수 201, 접수 결과 반환', first.status === 201 && first.body.inquiry.status === 'RECEIVED' && first.body.inquiry.kind === 'BUG', first.raw);
  ok('A10 접수 응답에 내부 메모 없음', first.raw.indexOf('internal') < 0);
  const stored = await client.query('SELECT author_user_id, content_hash, internal_note FROM public.admin_inquiries WHERE id = $1', [first.body.inquiry.id]);
  ok('A11 작성자·해시 저장, 메모는 비어 있음', stored.rows[0].author_user_id === M1 && stored.rows[0].content_hash.length === 64 && stored.rows[0].internal_note === null);
  const dup = await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: ' 로그인  오류 제보 ', body: '버튼이  안 눌립니다 SECRETWORD' });
  ok('A12 같은 내용 중복 409 (공백 차이 무시)', dup.status === 409 && dup.body.error.code === 'INQUIRY_DUPLICATE');
  const other = await request(on, 'POST', '/api/inquiries', 'm2', { kind: 'BUG', title: '로그인 오류 제보', body: '버튼이 안 눌립니다 SECRETWORD' });
  ok('A13 다른 회원은 같은 내용도 접수 가능', other.status === 201);
  const race = await Promise.all([1, 2, 3, 4].map(function () { return request(on, 'POST', '/api/inquiries', 'm3', { kind: 'GENERAL', title: '동시 접수', body: '동시에 눌렀습니다' }); }));
  const created = race.filter(function (r) { return r.status === 201; }).length;
  ok('A14 동시 중복 접수는 1건만 저장', created === 1 && race.filter(function (r) { return r.status === 409; }).length === 3, race.map(function (r) { return r.status; }).join(','));
  for (let i = 0; i < 4; i += 1) await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'IMPROVEMENT', title: '개선 ' + i, body: '내용 ' + i });
  ok('A15 회원당 시간당 5건 제한', (await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'IMPROVEMENT', title: '개선 초과', body: '내용 초과' })).status === 429);
  ok('A16 종류 3개 모두 저장 가능', (await request(on, 'POST', '/api/inquiries', 'm2', { kind: 'IMPROVEMENT', title: '기능 개선 제안', body: '내용' })).status === 201 && (await request(on, 'POST', '/api/inquiries', 'm2', { kind: 'GENERAL', title: '일반 문의', body: '내용' })).status === 201);

  // ---- B. 본인 조회 ----
  const mine1 = await request(on, 'GET', '/api/inquiries/mine', 'm1');
  ok('B1 본인 문의만 조회 (5건)', mine1.status === 200 && mine1.body.items.length === 5 && mine1.body.items.every(function (i) { return i.id !== other.body.inquiry.id; }), mine1.raw);
  ok('B2 비회원 조회 401', (await request(on, 'GET', '/api/inquiries/mine', null)).status === 401);
  ok('B3 타인 문의 상세 404', (await request(on, 'GET', '/api/inquiries/mine/' + first.body.inquiry.id, 'm2')).status === 404);
  ok('B4 본인 상세 200, 본문 포함', (await request(on, 'GET', '/api/inquiries/mine/' + first.body.inquiry.id, 'm1')).body.inquiry.body.indexOf('SECRETWORD') > 0);

  // ---- C. 관리자 처리·검색·메모 차단 ----
  ok('C1 일반 회원 관리자 문의 API 403', (await request(on, 'GET', '/api/admin/inquiries', 'm1')).status === 403);
  ok('C2 user_metadata 관리자 주장 403', (await request(on, 'GET', '/api/admin/inquiries', 'meta-admin')).status === 403);
  ok('C3 비회원 관리자 문의 API 401', (await request(on, 'GET', '/api/admin/inquiries', null)).status === 401);
  const list = await request(on, 'GET', '/api/admin/inquiries', 'admin-token');
  ok('C4 관리자 목록 전체 보임 (9건) + 접수 켜짐 표시', list.status === 200 && list.body.total === 9 && list.body.intake.enabled === true, list.raw.slice(0, 200));
  const q1 = await request(on, 'GET', '/api/admin/inquiries?q=' + encodeURIComponent('SECRETWORD'), 'admin-token');
  ok('C5 본문 검색', q1.body.total === 2);
  const q2 = await request(on, 'GET', '/api/admin/inquiries?q=' + encodeURIComponent('제안'), 'owner-token');
  ok('C6 제목 검색 (OWNER)', q2.body.total === 1);
  ok('C7 검색 와일드카드 문자 이스케이프', (await request(on, 'GET', '/api/admin/inquiries?q=' + encodeURIComponent('%'), 'admin-token')).body.total === 0);
  ok('C8 종류+상태 필터', (await request(on, 'GET', '/api/admin/inquiries?kind=BUG&status=RECEIVED', 'admin-token')).body.total === 2);
  const patched = await request(on, 'PATCH', '/api/admin/inquiries/' + first.body.inquiry.id, 'admin-token', { status: 'IN_PROGRESS', internalNote: 'INTERNALMEMO-확인함' });
  ok('C9 상태 변경+내부 메모', patched.status === 200 && patched.body.inquiry.status === 'IN_PROGRESS' && patched.body.inquiry.internalNote === 'INTERNALMEMO-확인함', patched.raw);
  const mineAfter = await request(on, 'GET', '/api/inquiries/mine/' + first.body.inquiry.id, 'm1');
  ok('C10 회원 화면에 처리 상태 반영', mineAfter.body.inquiry.status === 'IN_PROGRESS');
  ok('C11 회원 응답에 내부 메모 없음', mineAfter.raw.indexOf('INTERNALMEMO') < 0 && mineAfter.raw.toLowerCase().indexOf('internal') < 0, mineAfter.raw);
  ok('C12 회원 목록 응답에도 내부 메모 없음', (await request(on, 'GET', '/api/inquiries/mine', 'm1')).raw.indexOf('INTERNALMEMO') < 0);
  ok('C13 일반 회원 PATCH 403', (await request(on, 'PATCH', '/api/admin/inquiries/' + first.body.inquiry.id, 'm1', { status: 'DONE' })).status === 403);
  const done = await request(on, 'PATCH', '/api/admin/inquiries/' + first.body.inquiry.id, 'admin-token', { status: 'DONE' });
  ok('C14 처리 완료', done.status === 200 && done.body.inquiry.status === 'DONE');
  const reopen = await request(on, 'POST', '/api/inquiries', 'm1', { kind: 'BUG', title: '로그인 오류 제보', body: '버튼이 안 눌립니다 SECRETWORD' });
  ok('C15 완료된 문의와 같은 내용은 다시 접수 가능 (한도 안이면)', reopen.status === 201 || reopen.status === 429);
  const ev = await client.query("SELECT event_type, actor_user_id FROM public.admin_inquiry_events WHERE inquiry_id = $1 ORDER BY created_at, id", [first.body.inquiry.id]);
  ok('C16 처리 기록 3건 (상태 2, 메모 1), 처리자 기록', ev.rows.length === 3 && ev.rows.every(function (r) { return r.actor_user_id === ADMIN; }), JSON.stringify(ev.rows));
  let appendOnly = false;
  try { await client.query('DELETE FROM public.admin_inquiry_events'); } catch (e) { appendOnly = /APPEND_ONLY/.test(e.message); }
  ok('C17 문의 처리 기록 삭제 차단', appendOnly);

  // ---- D. 공지 ----
  const boardCount = async function () {
    const r = await client.query("SELECT to_regclass('public.board_posts') AS t");
    return r.rows[0].t === null ? -1 : (await client.query('SELECT COUNT(*)::int n FROM public.board_posts')).rows[0].n;
  };
  const boardBefore = await boardCount();
  ok('D1 비회원 공지 관리 401', (await request(on, 'GET', '/api/admin/notices', null)).status === 401);
  ok('D2 일반 회원 공지 관리 403', (await request(on, 'POST', '/api/admin/notices', 'm1', { title: 'x' })).status === 403);
  ok('D3 잘못된 유형 400', (await request(on, 'POST', '/api/admin/notices', 'admin-token', { title: 'x', type: 'AD' })).status === 400);
  ok('D4 종료가 시작보다 빠르면 400', (await request(on, 'POST', '/api/admin/notices', 'admin-token', { title: 'x', startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' })).status === 400);
  const hour = 3600000;
  const iso = function (d) { return new Date(Date.now() + d).toISOString(); };
  const nPrivate = await request(on, 'POST', '/api/admin/notices', 'admin-token', { title: '비공개 점검', type: 'MAINTENANCE', body: '내부', isPublic: false });
  const nLive = await request(on, 'POST', '/api/admin/notices', 'owner-token', { title: '공개 장애', type: 'INCIDENT', body: '장애 안내', isPublic: true, startsAt: iso(-hour) });
  const nSched = await request(on, 'POST', '/api/admin/notices', 'admin-token', { title: '예약 업데이트', type: 'UPDATE', body: '예정', isPublic: true, startsAt: iso(2 * hour) });
  const nEnded = await request(on, 'POST', '/api/admin/notices', 'admin-token', { title: '지난 공지', type: 'GENERAL', body: '끝', isPublic: true, startsAt: iso(-48 * hour), endsAt: iso(-24 * hour) });
  ok('D5 4가지 유형 중 3개 등록 + 상태 계산', nPrivate.body.notice.state === 'PRIVATE' && nLive.body.notice.state === 'LIVE' && nSched.body.notice.state === 'SCHEDULED' && nEnded.body.notice.state === 'ENDED', [nPrivate, nLive, nSched, nEnded].map(function (r) { return r.raw; }).join(' | '));
  ok('D6 4번째 유형(일반) 등록', nEnded.body.notice.type === 'GENERAL');
  const cur = await request(on, 'GET', '/api/notices/current', null);
  ok('D7 현재 공개 조회는 공개 중인 1건만, 비회원도 가능', cur.status === 200 && cur.body.items.length === 1 && cur.body.items[0].title === '공개 장애', cur.raw);
  ok('D8 공개 응답에 내부 필드 없음', cur.raw.indexOf('created') < 0 && cur.raw.indexOf('"id"') < 0 && cur.raw.indexOf('isPublic') < 0);
  ok('D9 공개 조회 설정이 꺼지면 빈 목록', (await request(off, 'GET', '/api/notices/current', null)).body.items.length === 0 && (await request(off, 'GET', '/api/notices/current', null)).body.enabled === false);
  const sched2 = await request(on, 'POST', '/api/admin/notices', 'admin-token', { title: '곧 시작', type: 'MAINTENANCE', body: '2초 뒤', isPublic: true, startsAt: iso(2500) });
  const before = (await request(on, 'GET', '/api/notices/current', null)).body.items.map(function (i) { return i.title; });
  await sleep(3000);
  const after = (await request(on, 'GET', '/api/notices/current', null)).body.items.map(function (i) { return i.title; });
  ok('D10 예약 시각이 지나면 서버 시각 기준으로 자동 노출', before.indexOf('곧 시작') < 0 && after.indexOf('곧 시작') >= 0, JSON.stringify([before, after]));
  const endedNow = await request(on, 'PATCH', '/api/admin/notices/' + sched2.body.notice.id, 'admin-token', { endNow: true });
  ok('D11 지금 종료 → ENDED, 공개 목록에서 빠짐', endedNow.body.notice.state === 'ENDED' && (await request(on, 'GET', '/api/notices/current', null)).body.items.every(function (i) { return i.title !== '곧 시작'; }));
  ok('D12 종료와 다른 수정 동시 요청 400', (await request(on, 'PATCH', '/api/admin/notices/' + nLive.body.notice.id, 'admin-token', { endNow: true, title: 'y' })).status === 400);
  const toggled = await request(on, 'PATCH', '/api/admin/notices/' + nPrivate.body.notice.id, 'admin-token', { isPublic: true });
  ok('D13 비공개 → 공개 전환', toggled.body.notice.state === 'LIVE' && (await request(on, 'GET', '/api/notices/current', null)).body.items.some(function (i) { return i.title === '비공개 점검'; }));
  const edited = await request(on, 'PATCH', '/api/admin/notices/' + nPrivate.body.notice.id, 'admin-token', { title: '수정된 점검', type: 'MAINTENANCE', endsAt: iso(5 * hour) });
  ok('D14 제목·종료 시각 수정', edited.body.notice.title === '수정된 점검' && edited.body.notice.endsAt !== null);
  ok('D15 시작을 종료보다 늦게 수정하면 400 (DB 제약)', (await request(on, 'PATCH', '/api/admin/notices/' + nPrivate.body.notice.id, 'admin-token', { startsAt: iso(10 * hour) })).status === 400);
  ok('D16 변경 없는 PATCH 400', (await request(on, 'PATCH', '/api/admin/notices/' + nPrivate.body.notice.id, 'admin-token', {})).status === 400);
  const detail = await request(on, 'GET', '/api/admin/notices/' + nPrivate.body.notice.id, 'admin-token');
  const types = detail.body.events.map(function (e) { return e.type; }).sort();
  ok('D17 공지 변경 기록 (생성·수정·공개 전환)', JSON.stringify(types) === JSON.stringify(['CREATED', 'UPDATED', 'VISIBILITY_CHANGED']), JSON.stringify(types));
  const endEv = await client.query("SELECT actor_user_id FROM public.admin_notice_events WHERE notice_id = $1 AND event_type = 'ENDED'", [sched2.body.notice.id]);
  ok('D18 종료 기록과 처리자', endEv.rows.length === 1 && endEv.rows[0].actor_user_id === ADMIN);
  ok('D19 상태 필터', (await request(on, 'GET', '/api/admin/notices?state=ENDED', 'admin-token')).body.items.length === 2);
  let noticeDel = false;
  try { await client.query('UPDATE public.admin_notice_events SET event_type = $1', ['CREATED']); } catch (e) { noticeDel = /APPEND_ONLY/.test(e.message); }
  ok('D20 공지 기록 수정 차단', noticeDel);
  ok('D21 공지 등록·수정이 게시판(board_posts)에 글을 만들지 않음', (await boardCount()) === boardBefore);

  // ---- E. 오류 기록 ----
  const store = createApiErrorStore({ enabled: true, query: query });
  const errApp = express();
  errApp.use(express.json());
  const log = createApiErrorLog({ max: 10, store: store });
  errApp.use(log.middleware);
  errApp.get('/api/boom/:id', function (req, res) { res.status(500).json({ ok: false }); });
  errApp.get('/api/fine', function (req, res) { res.json({ ok: true }); });
  errApp.get('/api/bad', function (req, res) { res.status(400).json({ ok: false }); });
  const boom = await request(errApp, 'GET', '/api/boom/2c5a9a33-4a7e-4f0e-9a0c-111111111111?token=SECRETTOKEN&password=PW1', 'Bearer-secret');
  await request(errApp, 'GET', '/api/boom/aaaaaaaa-4a7e-4f0e-9a0c-111111111111?access_token=SECRETTOKEN', null);
  await request(errApp, 'GET', '/api/fine', null);
  await request(errApp, 'GET', '/api/bad', null);
  await sleep(500);
  const rows = await client.query('SELECT * FROM public.admin_api_error_records');
  ok('E1 5xx만 저장 (200/400은 저장 안 함)', rows.rows.length === 1 && rows.rows[0].status === 500, JSON.stringify(rows.rows));
  ok('E2 같은 경로는 횟수로 합산', rows.rows[0].occurrence_count === 2 && rows.rows[0].path === '/api/boom/:id');
  const dump = JSON.stringify(rows.rows);
  ok('E3 쿼리·토큰·비밀번호 저장 안 함', dump.indexOf('SECRET') < 0 && dump.indexOf('PW1') < 0 && dump.indexOf('Bearer') < 0 && dump.indexOf('?') < 0);
  ok('E4 저장 컬럼은 시각·유형·상태·경로·횟수·처리상태뿐', JSON.stringify(Object.keys(rows.rows[0]).sort()) === JSON.stringify(['day', 'first_at', 'handling_status', 'id', 'last_at', 'method', 'occurrence_count', 'path', 'status']));
  ok('E5 오류 요청의 응답은 그대로 500', boom.status === 500);
  const brokenStore = createApiErrorStore({ enabled: true, query: function () { return Promise.reject(new Error('DB_DOWN')); } });
  const brokenApp = express();
  brokenApp.use(createApiErrorLog({ max: 5, store: brokenStore }).middleware);
  brokenApp.get('/api/boom', function (req, res) { res.status(503).json({ ok: false }); });
  brokenApp.get('/api/fine', function (req, res) { res.json({ ok: true }); });
  const brokenBoom = await request(brokenApp, 'GET', '/api/boom', null);
  const brokenFine = await request(brokenApp, 'GET', '/api/fine', null);
  ok('E6 저장소 장애여도 요청은 정상 처리', brokenBoom.status === 503 && brokenFine.status === 200);
  const throwing = createApiErrorStore({ enabled: true, query: function () { throw new Error('SYNC_THROW'); } });
  let threw = false;
  try { throwing.record({ method: 'GET', path: '/api/x', status: 500 }); } catch (_) { threw = true; }
  ok('E7 저장 중 동기 예외도 밖으로 새지 않음', threw === false);
  const offStore = createApiErrorStore({ enabled: false, query: query });
  offStore.record({ method: 'GET', path: '/api/off', status: 500 });
  await sleep(200);
  ok('E8 설정이 꺼지면 아무것도 저장하지 않음', (await client.query("SELECT COUNT(*)::int n FROM public.admin_api_error_records WHERE path = '/api/off'")).rows[0].n === 0 && (await offStore.list(5)).status === 'NOT_COLLECTED');
  await client.query("INSERT INTO public.admin_api_error_records (day, method, path, status) SELECT (now() AT TIME ZONE 'Asia/Seoul')::date, 'GET', '/api/fill/' || g, 500 FROM generate_series(1, $1::int) g", [ROW_CAP]);
  store.record({ method: 'GET', path: '/api/new-over-cap', status: 500 });
  store.record({ method: 'GET', path: '/api/fill/1', status: 500 });
  await sleep(500);
  const cnt = await client.query('SELECT COUNT(*)::int n FROM public.admin_api_error_records');
  const fill1 = await client.query("SELECT occurrence_count FROM public.admin_api_error_records WHERE path = '/api/fill/1'");
  ok('E9 행 수 상한 초과 시 새 경로는 버리고 기존 경로는 계속 집계', cnt.rows[0].n === ROW_CAP + 1 && fill1.rows[0].occurrence_count === 2, JSON.stringify([cnt.rows[0], fill1.rows[0]]));
  await client.query("DELETE FROM public.admin_api_error_records WHERE path LIKE '/api/fill/%'");
  const sysApp = buildApp({ intake: true, noticesPublic: true, errorStore: store });
  const status = await request(sysApp, 'GET', '/api/admin/system/status', 'admin-token');
  ok('E10 관리자 시스템 화면에 저장된 오류 집계 포함', status.status === 200 && status.body.apiErrorsPersisted.status === 'OK' && status.body.apiErrorsPersisted.items.length >= 1, status.raw.slice(0, 300));
  const rec = status.body.apiErrorsPersisted.items.find(function (i) { return i.path === '/api/boom/:id'; });
  const setH = await request(sysApp, 'PATCH', '/api/admin/system/errors/' + rec.id, 'admin-token', { handling: 'checked' });
  ok('E11 처리 상태 변경', setH.status === 200 && (await client.query('SELECT handling_status FROM public.admin_api_error_records WHERE id = $1', [rec.id])).rows[0].handling_status === 'CHECKED');
  ok('E12 잘못된 처리 상태 400, 일반 회원 403, 비회원 401', (await request(sysApp, 'PATCH', '/api/admin/system/errors/' + rec.id, 'admin-token', { handling: 'x' })).status === 400 && (await request(sysApp, 'PATCH', '/api/admin/system/errors/' + rec.id, 'm1', { handling: 'NEW' })).status === 403 && (await request(sysApp, 'PATCH', '/api/admin/system/errors/' + rec.id, null, { handling: 'NEW' })).status === 401);
  const offStatus = await request(buildApp({ intake: false, noticesPublic: false }), 'GET', '/api/admin/system/status', 'admin-token');
  ok('E13 저장소 연결이 없으면 미수집으로 표시', offStatus.body.apiErrorsPersisted.status === 'NOT_COLLECTED');

  // ---- F. 권한·감사 뷰 ----
  const priv = await client.query(
    "SELECT t.name, r.role, has_table_privilege(r.role, 'public.' || t.name, 'SELECT') AS s, has_table_privilege(r.role, 'public.' || t.name, 'DELETE') AS d " +
      "FROM (VALUES ('admin_inquiries'), ('admin_inquiry_events'), ('admin_notices'), ('admin_notice_events'), ('admin_api_error_records'), ('admin_ops_events_v')) t(name), (VALUES ('anon'), ('authenticated'), ('service_role')) r(role)",
  );
  const pub = priv.rows.filter(function (r) { return r.role !== 'service_role'; });
  ok('F1 anon·authenticated 는 새 표를 읽을 수 없음', pub.every(function (r) { return r.s === false && r.d === false; }));
  const svc = priv.rows.filter(function (r) { return r.role === 'service_role'; });
  ok('F2 service_role 은 새 표를 지울 수 없음', svc.every(function (r) { return r.d === false; }));
  const view = await client.query('SELECT target_type, COUNT(*)::int n FROM public.admin_ops_events_v GROUP BY target_type ORDER BY target_type');
  const evCounts = await client.query('SELECT (SELECT COUNT(*) FROM public.admin_inquiry_events)::int a, (SELECT COUNT(*) FROM public.admin_notice_events)::int b');
  ok('F3 통합 조회 뷰가 문의·공지 기록을 모두 보여줌', view.rows.length === 2 && view.rows[0].n === evCounts.rows[0].a && view.rows[1].n === evCounts.rows[0].b, JSON.stringify(view.rows));
  const mod = await client.query("SELECT to_regclass('public.admin_moderation_audit_events') AS t");
  ok('F4 기존 moderation 감사 표는 이 SQL 로 만들거나 바꾸지 않음 (이 DB에는 없음)', mod.rows[0].t === null);

  // ---- G. 운영 기록 읽기 전용 연결 / 독립 설정 ----
  ok('G1 운영 기록 API: 비회원 401, 일반 회원 403', (await request(on, 'GET', '/api/admin/ops-events', null)).status === 401 && (await request(on, 'GET', '/api/admin/ops-events', 'm1')).status === 403);
  const oe = await request(on, 'GET', '/api/admin/ops-events', 'admin-token');
  const oeTypes = Array.from(new Set(oe.body.items.map(function (i) { return i.targetType; }))).sort();
  ok('G2 문의·공지 기록이 출처별로 보임', oe.status === 200 && JSON.stringify(oeTypes) === JSON.stringify(['INQUIRY', 'NOTICE']), oe.raw.slice(0, 200));
  ok('G3 출처 표시에 legal hold 미연결 명시', oe.body.source.legalHold === 'NOT_LINKED' && oe.body.source.key === 'ADMIN_OPS_EVENTS');
  ok('G4 유형 필터와 잘못된 유형 400', (await request(on, 'GET', '/api/admin/ops-events?targetType=NOTICE', 'admin-token')).body.items.every(function (i) { return i.targetType === 'NOTICE'; }) && (await request(on, 'GET', '/api/admin/ops-events?targetType=POST', 'admin-token')).status === 400);
  ok('G5 읽기 전용 (POST/PATCH 경로 없음)', (await request(on, 'POST', '/api/admin/ops-events', 'admin-token', { x: 1 })).status === 404);
  ok('G6 저장소 연결 없으면 미확인', (await request(buildApp({ intake: true, noticesPublic: true, noQuery: true }), 'GET', '/api/admin/ops-events', 'admin-token')).body.status === 'NOT_CONFIRMED');
  const modBefore = await client.query("SELECT to_regclass('public.admin_moderation_audit_events') AS t");
  ok('G7 기존 감사 표는 만들거나 바꾸지 않음 (이 DB에는 없음)', modBefore.rows[0].t === null);
  const mixed = buildApp({ intake: false, noticesPublic: true });
  ok('G8 설정은 독립: 접수 OFF여도 공지 공개 ON은 별도로 동작', (await request(mixed, 'POST', '/api/inquiries', 'm2', { kind: 'BUG', title: '독립 확인', body: 'x' })).status === 503 && (await request(mixed, 'GET', '/api/notices/current', null)).body.enabled === true);
  const mixed2 = buildApp({ intake: true, noticesPublic: false });
  const offNotices = await request(mixed2, 'GET', '/api/notices/current', null);
  ok('G9 공지 OFF면 공개 API에 공지가 한 건도 없음 (DB에 공개 중인 공지가 있어도)', offNotices.body.enabled === false && offNotices.body.items.length === 0 && (await client.query('SELECT COUNT(*)::int n FROM public.admin_notices WHERE is_public')).rows[0].n > 0);

  await client.end();
  console.log('\nPASS ' + passed + ' / FAIL ' + failed);
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL', e);
  process.exitCode = 1;
});
