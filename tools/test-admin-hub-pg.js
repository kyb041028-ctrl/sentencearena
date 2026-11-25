'use strict';

const fs = require('fs');
const http = require('http');
const express = require('express');
const { Client } = require('../node_modules/pg');
const { mountAdminMembersRoutes } = require('../server/admin-members-routes');
const { mountAdminInquiriesRoutes } = require('../server/admin-inquiries-routes');
const { mountAdminSystemRoutes } = require('../server/admin-system-routes');
const { mountAdminOpsStatsRoutes } = require('../server/admin-ops-stats-routes');

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
          server.close(function () { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
        });
      });
      req.on('error', function (err) { server.close(function () { reject(err); }); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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
  await client.query(fs.readFileSync('supabase/migration_admin_inquiries_v1.sql', 'utf8'));
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.profiles (id uuid PRIMARY KEY, display_name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL, territory text NULL, email_hint text NULL);
    CREATE TABLE IF NOT EXISTS public.user_progression (user_id uuid PRIMARY KEY, level integer NOT NULL, reputation_score bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS public.user_sanction_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NULL, sanction_type text NOT NULL, starts_at timestamptz NULL, ends_at timestamptz NULL, permanent boolean NOT NULL DEFAULT false, reason_code text NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS public.board_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_user_id uuid NULL, territory text NULL, created_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS public.board_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_user_id uuid NULL, created_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS public.board_reactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NULL, cancelled_at timestamptz NULL, created_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS public.board_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, created_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS public.account_withdrawal_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), withdrawn_at timestamptz NOT NULL, result text NOT NULL);
    CREATE TABLE IF NOT EXISTS public.alignment_batches (batch_id text PRIMARY KEY, scheduled_at timestamptz NOT NULL, processed_at timestamptz NOT NULL, completed_at timestamptz NULL, status text NOT NULL);
  `);
  await client.query('TRUNCATE public.admin_inquiry_events, public.admin_inquiries');
  await client.query('DELETE FROM public.profiles; DELETE FROM public.user_progression; DELETE FROM public.user_sanction_records; DELETE FROM public.board_posts; DELETE FROM public.board_comments; DELETE FROM public.board_reactions; DELETE FROM public.account_withdrawal_audit; DELETE FROM public.alignment_batches;');
  await client.query("INSERT INTO public.profiles (id, display_name, created_at, territory, email_hint) VALUES ($1, 'Alpha Kim', '2026-10-27T01:00:00Z', 'CENTRAL', 'alpha@example.invalid'), ($2, 'Beta Lee', '2026-10-28T01:00:00Z', NULL, NULL), ($3, '100%_Gamma', '2026-09-01T01:00:00Z', 'GUARDIAN', NULL)", [A, B, C]);
  await client.query('INSERT INTO public.user_progression (user_id, level, reputation_score) VALUES ($1, 3, 10), ($2, 1, 0)', [A, C]);
  await client.query("INSERT INTO public.user_sanction_records (user_id, sanction_type, starts_at, ends_at, permanent, reason_code, created_at) VALUES ($1, 'TEMP_SUSPEND', now() - interval '1 day', now() + interval '3 days', false, 'ABUSE', now() - interval '1 day'), ($1, 'WARNING', NULL, NULL, false, 'SPAM', now() - interval '20 days'), ($2, 'WARNING', NULL, NULL, false, 'SPAM', now() - interval '40 days')", [A, C]);
  await client.query("INSERT INTO public.board_posts (author_user_id, territory, created_at) VALUES ($1, 'CENTRAL', '2026-10-28T03:00:00Z')", [A]);
  await client.query("INSERT INTO public.board_comments (author_user_id, created_at) VALUES ($1, '2026-10-28T05:00:00Z')", [A]);
  await client.query("INSERT INTO public.board_reactions (actor_user_id, cancelled_at, created_at) VALUES ($1, '2026-10-28T09:00:00Z', '2026-10-28T08:00:00Z')", [B]);
  await client.query("INSERT INTO public.account_withdrawal_audit (withdrawn_at, result) VALUES ('2026-10-28T08:00:00Z', 'COMPLETED'), ('2026-10-28T09:00:00Z', 'FAILED'), ('2026-08-01T08:00:00Z', 'COMPLETED')");
  await client.query("INSERT INTO public.alignment_batches (batch_id, scheduled_at, processed_at, completed_at, status) VALUES ('alignment-20261029-0500', '2026-10-28T20:00:00Z', '2026-10-28T20:00:05Z', '2026-10-28T20:00:09Z', 'COMPLETED')");

  async function query(sql, params) { return client.query(sql, params); }
  const adminAuth = {
    supabaseUrl: 'http://127.0.0.1:9',
    supabaseAnonKey: 'test-anon',
    getUserFromAccessToken: function (token) {
      if (token === 'admin-token') return { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', app_metadata: { role: 'ADMIN' } };
      if (token === 'owner-token') return { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', app_metadata: { role: 'OWNER' } };
      if (token === 'member-token') return { id: 'member-1', app_metadata: { role: 'MEMBER' } };
      return null;
    },
  };
  const NOW = '2026-10-29T03:00:00.000Z';
  const app = express();
  app.use(express.json());
  app.use('/api/admin/members', mountAdminMembersRoutes({ adminAuth: adminAuth, query: query, now: NOW }));
  app.use('/api/admin/inquiries', mountAdminInquiriesRoutes({ adminAuth: adminAuth, query: query }));
  app.use('/api/admin/system', mountAdminSystemRoutes({ adminAuth: adminAuth, query: query, now: NOW, visitCollectionEnabled: false }));
  app.use('/api/admin/ops-stats', mountAdminOpsStatsRoutes({ adminAuth: adminAuth, query: query, now: NOW, visitCollectionEnabled: false }));

  const all = await request(app, 'GET', '/api/admin/members?preset=30d', 'admin-token');
  ok('회원 목록 200, 3명', all.status === 200 && all.body.total === 3 && all.body.members.length === 3, JSON.stringify(all.body).slice(0, 300));
  ok('최근 가입순', all.body.members[0].displayName === 'Beta Lee');
  const alpha = all.body.members.find(function (m) { return m.id === A; });
  ok('레벨·명성·영토', alpha.level === 3 && alpha.reputation === 10 && alpha.territory === 'central');
  ok('진행 중 제재 1, 전체 2', alpha.activeSanctionCount === 1 && alpha.sanctionCount === 2 && alpha.status === 'SANCTIONED', JSON.stringify(alpha));
  ok('최근 활동은 기록이 있을 때만', alpha.lastActivityAt === '2026-10-28T05:00:00.000Z' && alpha.lastActivityStatus === 'OK');
  const beta = all.body.members.find(function (m) { return m.id === B; });
  ok('활동 없으면 기록 없음 (취소 반응 제외)', beta.lastActivityAt === null && beta.lastActivityStatus === 'NO_RECORD', JSON.stringify(beta));
  ok('진행 정보 없으면 데이터 없음, 0 아님', beta.level === null && beta.progressionStatus === 'NO_DATA' && beta.territoryStatus === 'NOT_SET' && beta.status === 'NORMAL');
  const gamma = all.body.members.find(function (m) { return m.id === C; });
  ok('끝난 경고는 진행 중 아님', gamma.activeSanctionCount === 0 && gamma.sanctionCount === 1 && gamma.status === 'NORMAL');
  ok('기간 가입 2, 탈퇴 1(실패 제외)', all.body.period.signups.value === 2 && all.body.period.withdrawals.value === 1, JSON.stringify(all.body.period));
  ok('회원 응답에 이메일·토큰·성향 없음', !/alpha@example|email|token|password|alignment/i.test(JSON.stringify(all.body)), JSON.stringify(all.body).slice(0, 200));

  const byName = await request(app, 'GET', '/api/admin/members?q=alp', 'admin-token');
  ok('활동명 검색', byName.body.total === 1 && byName.body.members[0].id === A);
  const byId = await request(app, 'GET', '/api/admin/members?q=' + B, 'admin-token');
  ok('ID 검색', byId.body.total === 1 && byId.body.members[0].id === B);
  const wild = await request(app, 'GET', '/api/admin/members?q=%25', 'admin-token');
  ok('% 는 문자 그대로 검색', wild.body.total === 1 && wild.body.members[0].id === C, JSON.stringify(wild.body.total));
  const inj = await request(app, 'GET', "/api/admin/members?q=" + encodeURIComponent("x'; DROP TABLE public.profiles; --"), 'admin-token');
  const stillThere = await client.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  ok('SQL 주입 문자열은 검색어일 뿐', inj.status === 200 && inj.body.total === 0 && stillThere.rows[0].n === 3);
  const p1 = await request(app, 'GET', '/api/admin/members?pageSize=2&page=1', 'admin-token');
  const p2 = await request(app, 'GET', '/api/admin/members?pageSize=2&page=2', 'admin-token');
  ok('페이지네이션', p1.body.members.length === 2 && p2.body.members.length === 1 && p1.body.total === 3 && p1.body.members[0].id !== p2.body.members[0].id);
  const ranged = await request(app, 'GET', '/api/admin/members?from=2026-10-28&to=2026-10-28', 'admin-token');
  ok('가입일 기간 필터', ranged.body.total === 1 && ranged.body.members[0].id === B, JSON.stringify(ranged.body.total));
  const tooLong = await request(app, 'GET', '/api/admin/members?from=2026-01-01&to=2026-10-01', 'admin-token');
  ok('90일 초과 400', tooLong.status === 400);
  const detail = await request(app, 'GET', '/api/admin/members/' + A, 'owner-token');
  ok('제재 이력 상세', detail.status === 200 && detail.body.sanctionHistory.length === 2 && detail.body.sanctionHistory[0].type === 'TEMP_SUSPEND', JSON.stringify(detail.body).slice(0, 300));
  const missing = await request(app, 'GET', '/api/admin/members/99999999-9999-9999-9999-999999999999', 'admin-token');
  ok('없는 회원 404', missing.status === 404);
  const guestMembers = await request(app, 'GET', '/api/admin/members');
  const memberMembers = await request(app, 'GET', '/api/admin/members', 'member-token');
  ok('DB 연결에서도 게스트 401, 회원 403', guestMembers.status === 401 && memberMembers.status === 403);

  const degraded = express();
  degraded.use('/api/admin/members', mountAdminMembersRoutes({
    adminAuth: adminAuth,
    now: NOW,
    query: async function (sql, params) {
      if (/user_progression/.test(sql)) throw Object.assign(new Error('missing'), { code: '42P01' });
      if (/user_sanction_records/.test(sql)) throw Object.assign(new Error('denied'), { code: '42501' });
      return client.query(sql, params);
    },
  }));
  const deg = await request(degraded, 'GET', '/api/admin/members', 'admin-token');
  const dAlpha = deg.body.members.find(function (m) { return m.id === A; });
  ok('표 없음·권한 없음은 미확인 (0 아님)', deg.status === 200 && dAlpha.progressionStatus === 'NOT_CONFIRMED' && dAlpha.sanctionStatus === 'NOT_CONFIRMED' && dAlpha.sanctionCount === null && dAlpha.status === 'NOT_CONFIRMED', JSON.stringify(dAlpha));

  const t0 = await client.query('SELECT (SELECT COUNT(*) FROM public.profiles)::int AS p, (SELECT COUNT(*) FROM public.user_sanction_records)::int AS s, (SELECT COUNT(*) FROM public.board_posts)::int AS b');
  await request(app, 'GET', '/api/admin/members', 'admin-token');
  await request(app, 'GET', '/api/admin/system/status', 'admin-token');
  const t1 = await client.query('SELECT (SELECT COUNT(*) FROM public.profiles)::int AS p, (SELECT COUNT(*) FROM public.user_sanction_records)::int AS s, (SELECT COUNT(*) FROM public.board_posts)::int AS b');
  ok('조회만으로 DB 행이 바뀌지 않음', JSON.stringify(t0.rows[0]) === JSON.stringify(t1.rows[0]));

  const empty = await request(app, 'GET', '/api/admin/inquiries', 'admin-token');
  ok('문의 0건 목록 + 접수 비활성', empty.status === 200 && empty.body.available === true && empty.body.total === 0 && empty.body.intake.enabled === false, JSON.stringify(empty.body));
  await client.query("INSERT INTO public.admin_inquiries (id, kind, title, body, status, created_at) VALUES ('11111111-1111-1111-1111-111111111111', 'BUG', '오류 1', '본문 1', 'RECEIVED', '2026-10-28T01:00:00Z'), ('22222222-2222-2222-2222-222222222222', 'IMPROVEMENT', '개선 1', '본문 2', 'IN_PROGRESS', '2026-10-28T02:00:00Z'), ('33333333-3333-3333-3333-333333333333', 'GENERAL', '일반 1', '본문 3', 'DONE', '2026-10-28T03:00:00Z')");
  const list = await request(app, 'GET', '/api/admin/inquiries', 'admin-token');
  ok('문의 목록 3건 최신순', list.body.total === 3 && list.body.items[0].title === '일반 1' && list.body.items[0].body === undefined, JSON.stringify(list.body).slice(0, 200));
  const fKind = await request(app, 'GET', '/api/admin/inquiries?kind=bug', 'admin-token');
  const fStatus = await request(app, 'GET', '/api/admin/inquiries?status=ON_HOLD', 'admin-token');
  const fPaged = await request(app, 'GET', '/api/admin/inquiries?pageSize=2&page=2', 'admin-token');
  ok('종류·상태 필터와 페이지', fKind.body.total === 1 && fStatus.body.total === 0 && fPaged.body.items.length === 1);
  const badFilter = await request(app, 'GET', '/api/admin/inquiries?status=NOPE', 'admin-token');
  ok('잘못된 필터 400', badFilter.status === 400);

  const patch1 = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'admin-token', { status: 'in_progress', internalNote: '내부 확인 필요' });
  ok('상태+메모 수정', patch1.status === 200 && patch1.body.inquiry.status === 'IN_PROGRESS' && patch1.body.inquiry.internalNote === '내부 확인 필요', JSON.stringify(patch1.body));
  const ev1 = await client.query("SELECT event_type, from_status, to_status, actor_user_id FROM public.admin_inquiry_events WHERE inquiry_id = '11111111-1111-1111-1111-111111111111' ORDER BY event_type");
  ok('감사 이벤트 2건과 처리자', ev1.rows.length === 2 && ev1.rows.some(function (r) { return r.event_type === 'STATUS_CHANGED' && r.from_status === 'RECEIVED' && r.to_status === 'IN_PROGRESS' && r.actor_user_id === 'dddddddd-dddd-dddd-dddd-dddddddddddd'; }) && ev1.rows.some(function (r) { return r.event_type === 'NOTE_UPDATED'; }), JSON.stringify(ev1.rows));
  ok('이벤트에 메모 원문 없음', !/내부 확인/.test(JSON.stringify((await client.query('SELECT * FROM public.admin_inquiry_events')).rows)));
  const patchSame = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'owner-token', { status: 'IN_PROGRESS', internalNote: '내부 확인 필요' });
  const evSame = await client.query("SELECT COUNT(*)::int AS n FROM public.admin_inquiry_events WHERE inquiry_id = '11111111-1111-1111-1111-111111111111'");
  ok('변화 없으면 이벤트 없음', patchSame.status === 200 && evSame.rows[0].n === 2);
  const patchDone = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'owner-token', { status: 'DONE' });
  ok('OWNER도 처리 완료로 변경', patchDone.status === 200 && patchDone.body.inquiry.status === 'DONE' && patchDone.body.inquiry.internalNote === '내부 확인 필요');
  const detailInq = await request(app, 'GET', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'admin-token');
  ok('문의 상세에 처리 기록 3건', detailInq.status === 200 && detailInq.body.events.length === 3 && detailInq.body.inquiry.body === '본문 1', JSON.stringify(detailInq.body.events));
  const tooLongNote = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'admin-token', { internalNote: 'x'.repeat(2001) });
  const nf = await request(app, 'PATCH', '/api/admin/inquiries/99999999-9999-9999-9999-999999999999', 'admin-token', { status: 'DONE' });
  ok('메모 2001자 400, 없는 문의 404', tooLongNote.status === 400 && nf.status === 404);
  const guestPatch = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', null, { status: 'ON_HOLD' });
  const memberPatch = await request(app, 'PATCH', '/api/admin/inquiries/11111111-1111-1111-1111-111111111111', 'member-token', { status: 'ON_HOLD' });
  const after = await client.query("SELECT status FROM public.admin_inquiries WHERE id = '11111111-1111-1111-1111-111111111111'");
  ok('게스트 401, 회원 403, 값 안 바뀜', guestPatch.status === 401 && memberPatch.status === 403 && after.rows[0].status === 'DONE');
  let updBlocked = false;
  let delBlocked = false;
  try { await client.query("UPDATE public.admin_inquiry_events SET to_status = 'X'"); } catch (e) { updBlocked = /APPEND_ONLY/.test(e.message); }
  try { await client.query('DELETE FROM public.admin_inquiry_events'); } catch (e) { delBlocked = /APPEND_ONLY/.test(e.message); }
  ok('처리 기록은 수정·삭제 불가', updBlocked && delBlocked);
  const rls = await client.query("SELECT relrowsecurity FROM pg_class WHERE oid IN ('public.admin_inquiries'::regclass, 'public.admin_inquiry_events'::regclass)");
  ok('RLS 켜짐', rls.rows.length === 2 && rls.rows.every(function (r) { return r.relrowsecurity === true; }));
  const grants = await client.query("SELECT has_table_privilege('anon', 'public.admin_inquiries', 'SELECT') AS a, has_table_privilege('authenticated', 'public.admin_inquiries', 'SELECT') AS u, has_table_privilege('service_role', 'public.admin_inquiries', 'UPDATE') AS s");
  ok('일반 사용자 권한 없음, 서버 역할만', grants.rows[0].a === false && grants.rows[0].u === false && grants.rows[0].s === true);

  const sys = await request(app, 'GET', '/api/admin/system/status', 'admin-token');
  ok('DB 연결 정상', sys.status === 200 && sys.body.database.status === 'OK');
  ok('마지막 성향 배치 기록', sys.body.schedulers.alignment.lastBatch.status === 'OK' && sys.body.schedulers.alignment.lastBatch.value.batchId === 'alignment-20261029-0500');
  await client.query('DELETE FROM public.alignment_batches');
  const sys2 = await request(app, 'GET', '/api/admin/system/status', 'admin-token');
  ok('배치 기록이 없으면 기록 없음', sys2.body.schedulers.alignment.lastBatch.status === 'NO_RECORD' && sys2.body.schedulers.alignment.lastBatch.value === null);
  ok('방문 수집 OFF 표시', sys2.body.visitCollection.enabled === false && sys2.body.viewer.role === 'ADMIN');

  const stats = await request(app, 'GET', '/api/admin/ops-stats?preset=30d', 'admin-token');
  ok('기존 통계가 같은 연결로 동작, 방문은 미수집', stats.status === 200 && stats.body.operations.posts.status === 'OK' && stats.body.visits.status === 'NOT_COLLECTED', JSON.stringify(stats.body.operations && stats.body.operations.posts));

  await client.end();
  console.log('RESULT ' + passed + ' PASS ' + failed + ' FAIL');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(String(e && e.stack ? e.stack : e).slice(0, 800));
  process.exit(1);
});
