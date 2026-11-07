'use strict';

const fs = require('fs');
const { Client } = require('../node_modules/pg');
const { summarizeAdminOps } = require('../server/admin-ops-stats-service');

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

async function main() {
  const pwFile = process.env.CONSENT_ISOLATED_PW_FILE;
  if (!pwFile) {
    console.log('SKIPPED isolated DB test: CONSENT_ISOLATED_PW_FILE not set');
    return;
  }
  const pw = fs.readFileSync(pwFile, 'utf8').trim();
  const client = new Client({
    host: '127.0.0.1',
    port: 55432,
    user: 'consent_tester',
    password: pw,
    database: 'consent_isolated',
  });
  await client.connect();
  const meta = await client.query("SELECT current_database() AS d, inet_server_addr()::text AS addr, inet_server_port() AS port");
  if (meta.rows[0].d !== 'consent_isolated' || String(meta.rows[0].addr).indexOf('127.0.0.1') !== 0 || Number(meta.rows[0].port) !== 55432) {
    throw new Error('REFUSED_TARGET');
  }
  await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;");
  const sql = fs.readFileSync('supabase/migration_admin_ops_stats_v1.sql', 'utf8');
  await client.query(sql);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public.board_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_user_id uuid NULL,
      territory text NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public.board_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_user_id uuid NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public.board_reactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id uuid NULL,
      cancelled_at timestamptz NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public.board_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      status text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public.user_sanction_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public.account_withdrawal_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      withdrawn_at timestamptz NOT NULL,
      result text NOT NULL
    );
  `);
  const member = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const newbie = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const gone = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  await client.query('INSERT INTO public.profiles (id, created_at) VALUES ($1, $2), ($3, $4)', [
    member, '2026-10-01T00:00:00.000Z', newbie, '2026-11-01T01:00:00.000Z',
  ]);
  await client.query('INSERT INTO public.board_posts (author_user_id, territory, created_at) VALUES ($1, $2, $3), ($4, $5, $6), (NULL, $7, $8)', [
    newbie, 'CENTRAL', '2026-11-02T01:00:00.000Z',
    member, 'CENTRAL', '2026-10-28T03:00:00.000Z',
    'CENTRAL', '2026-10-28T04:00:00.000Z',
  ]);
  await client.query('INSERT INTO public.board_comments (author_user_id, created_at) VALUES ($1, $2)', [member, '2026-10-28T05:00:00.000Z']);
  await client.query('INSERT INTO public.board_reactions (actor_user_id, cancelled_at, created_at) VALUES ($1, NULL, $2), ($3, $4, $5)', [
    newbie, '2026-11-02T02:00:00.000Z', member, '2026-10-28T06:00:00.000Z', '2026-10-28T06:00:00.000Z',
  ]);
  await client.query("INSERT INTO public.board_reports (status, created_at) VALUES ('SUBMITTED', $1), ('RESOLVED', $2)", [
    '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z',
  ]);
  await client.query('INSERT INTO public.user_sanction_records (created_at) VALUES ($1)', ['2026-10-28T07:00:00.000Z']);
  await client.query("INSERT INTO public.account_withdrawal_audit (withdrawn_at, result) VALUES ($1, 'COMPLETED')", ['2026-10-28T08:00:00.000Z']);
  await client.query(
    "UPDATE public.daily_issue_review_items SET status = 'PUBLISHED', published_at = $1 WHERE candidate_id = 'cand_savepoint_1'",
    ['2026-11-01T02:00:00.000Z'],
  );
  await client.query(
    `INSERT INTO public.admin_ops_visit_events
      (occurred_at, visitor_key, actor_type, user_id, kind, channel, utm_source, device_class)
     VALUES
      ($1, 'returning-user', 'member', $2, 'activity', 'direct', NULL, 'pc'),
      ($3, 'returning-user', 'member', $2, 'activity', 'direct', NULL, 'pc'),
      ($4, 'returning-user', 'member', $2, 'activity', 'direct', NULL, 'pc'),
      ($5, 'new-member', 'member', $6, 'page_view', 'google', 'launch', 'pc'),
      ($7, 'guest-userxx', 'guest', NULL, 'activity', 'naver', NULL, 'mobile'),
      ($8, 'midnight-user', 'member', $2, 'activity', 'direct', NULL, 'pc'),
      ($9, 'midnight-user', 'member', $2, 'activity', 'direct', NULL, 'pc')`,
    [
      '2026-10-22T03:00:00.000Z', member,
      '2026-10-28T03:00:00.000Z',
      '2026-10-28T03:10:00.000Z',
      '2026-11-02T01:00:00.000Z', newbie,
      '2026-11-02T02:00:00.000Z',
      '2026-10-29T14:50:00.000Z',
      '2026-10-29T15:40:00.000Z',
    ],
  );
  await client.query('DELETE FROM public.admin_ops_visit_events WHERE user_id = $1 AND visitor_key = $2', [gone, 'gone-user']);

  async function query(sql, params) {
    return client.query(sql, params);
  }
  const off = await summarizeAdminOps({
    now: '2026-11-02T03:00:00.000Z',
    preset: '7d',
    query: query,
    visitCollectionEnabled: false,
  });
  ok('수집 끄면 방문은 미수집', off.visits.status === 'NOT_COLLECTED' && off.visits.periodUnique.value == null);
  ok('DB 글 수는 수집된 값', off.operations.posts.status === 'OK' && off.operations.posts.value === 3, JSON.stringify(off.operations.posts));
  ok('취소 반응은 제외', off.operations.reactions.value === 1, JSON.stringify(off.operations));
  ok('미처리 신고는 현재 건수', off.operations.pendingReports.value === 1);
  ok('탈퇴 기록', off.members.withdrawals.value === 1, JSON.stringify(off.members.withdrawals));
  ok('작성자 없는 글은 DAU에 없음', off.members.dau.value === 1, JSON.stringify(off.members));
  ok('Daily Issue 발행', off.operations.dailyIssuesPublished.value === 1);

  const on = await summarizeAdminOps({
    now: '2026-11-02T03:00:00.000Z',
    preset: '30d',
    query: query,
    visitCollectionEnabled: true,
  });
  ok('DB 순방문자와 방문 횟수가 다름', on.visits.periodUnique.value === 4 && on.visits.periodVisits.value === 6, JSON.stringify({
    unique: on.visits.periodUnique,
    visits: on.visits.periodVisits,
    days: on.visits.dailyUnique,
  }));
  ok('게스트 1', on.visits.guestUnique.value === 1);
  ok('자정 날짜가 둘', (on.visits.dailyUnique.value || []).some(function (row) { return row.key === '2026-10-29'; }) && (on.visits.dailyUnique.value || []).some(function (row) { return row.key === '2026-10-30'; }));
  ok('응답에 방문 키 없음', !/returning-user|visitor_key|alignment/.test(JSON.stringify(on)));

  await client.end();
  console.log('RESULT ' + passed + ' PASS ' + failed + ' FAIL');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(String(e && e.message ? e.message : e).slice(0, 400));
  process.exit(1);
});
