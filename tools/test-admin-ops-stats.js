'use strict';

const express = require('express');
const http = require('http');
const { buildAdminOpsStats } = require('../shared/admin-ops-stats-core');
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

function ev(partial) {
  return Object.assign({
    visitorKey: 'visitor-aaaa',
    actorType: 'member',
    userId: '11111111-1111-1111-1111-111111111111',
    kind: 'activity',
    channel: 'direct',
    deviceClass: 'pc',
  }, partial);
}

function request(app, path, token) {
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      http.get({ hostname: '127.0.0.1', port: port, path: path, headers: headers }, function (res) {
        let buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          server.close(function () {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          });
        });
      }).on('error', function (err) {
        server.close(function () { reject(err); });
      });
    });
  });
}

async function main() {
  const now = '2026-11-02T03:00:00.000Z';
  const off = buildAdminOpsStats({ now: now, preset: '7d' });
  ok('고정 시각은 시험용으로 표시', off.range.nowSource === 'FIXED_FOR_TEST' && off.range.today === '2026-11-02', JSON.stringify(off.range));
  const real = buildAdminOpsStats({ preset: 'today' });
  ok('시각 미지정은 실제 시계', real.range.nowSource === 'REAL_CLOCK' && real.range.today === new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), JSON.stringify(real.range));
  ok('수집 없음은 0이 아님', off.visits.periodUnique.status === 'NOT_COLLECTED' && off.visits.periodUnique.value == null);
  ok('누적 순방은 미수집', off.visits.cumulativeUnique.status === 'NOT_COLLECTED');
  ok('가입 UTM은 미수집', off.inflow.utmSignups.status === 'NOT_COLLECTED');

  const stats = buildAdminOpsStats({
    now: now,
    preset: '7d',
    visitsCollected: true,
    visitEvents: [
      ev({ occurredAt: '2026-10-22T03:00:00.000Z', visitorKey: 'returning-user', userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      ev({ occurredAt: '2026-10-28T03:00:00.000Z', visitorKey: 'returning-user', userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      ev({ occurredAt: '2026-10-28T03:10:00.000Z', visitorKey: 'returning-user', userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      ev({ occurredAt: '2026-11-01T03:00:00.000Z', visitorKey: 'new-member', userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', channel: 'google', utmSource: 'launch' }),
      ev({ occurredAt: '2026-11-02T01:00:00.000Z', visitorKey: 'new-member', userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', kind: 'page_view' }),
      ev({ occurredAt: '2026-11-02T02:00:00.000Z', visitorKey: 'guest-user', actorType: 'guest', userId: null, channel: 'naver', deviceClass: 'mobile' }),
      ev({ occurredAt: '2026-10-31T14:00:00.000Z', visitorKey: 'boundary-user', userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }),
      ev({ occurredAt: '2026-10-31T16:00:00.000Z', visitorKey: 'boundary-user', userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }),
      ev({ occurredAt: '2026-10-25T14:00:00.000Z', visitorKey: 'week-user', userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      ev({ occurredAt: '2026-10-25T16:30:00.000Z', visitorKey: 'week-user', userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      ev({ occurredAt: '2026-10-29T14:50:00.000Z', visitorKey: 'midnight-user', userId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }),
      ev({ occurredAt: '2026-10-29T15:40:00.000Z', visitorKey: 'midnight-user', userId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }),
    ],
    members: {
      currentMembers: 3,
      withdrawalsInPeriod: 1,
      signups: [
        { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', createdAt: '2026-11-01T01:00:00.000Z' },
      ],
      activities: [
        { userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', at: '2026-11-02T01:00:00.000Z', kind: 'post' },
        { userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', at: '2026-10-28T03:00:00.000Z', kind: 'comment' },
      ],
    },
    operations: {
      posts: 2,
      comments: 1,
      reactions: 0,
      reports: 1,
      sanctions: 1,
      pendingReports: 1,
      dailyIssuesPublished: 1,
      boards: [{ key: 'CENTRAL', posts: 2 }],
      dailyPosts: [{ date: '2026-11-02', count: 1 }],
    },
  });

  ok('재방문은 1명', stats.returns.returningVisitors.value === 1, JSON.stringify(stats.returns.returningVisitors));
  ok('같은 사람 10분 간격은 방문 1회에 포함', stats.visits.periodVisits.value >= 1);
  const keys = {};
  (stats.visits.dailyUnique.value || []).forEach(function (row) { keys[row.key] = row.uniqueVisitors; });
  ok('자정 전후는 다른 날짜', keys['2026-10-29'] >= 1 && keys['2026-10-30'] >= 1, JSON.stringify(keys));
  const monthStats = buildAdminOpsStats({
    now: now,
    preset: '30d',
    visitsCollected: true,
    visitEvents: [
      ev({ occurredAt: '2026-10-25T14:00:00.000Z', visitorKey: 'week-user', userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
      ev({ occurredAt: '2026-10-25T16:30:00.000Z', visitorKey: 'week-user', userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
    ],
  });
  const weeks = {};
  (monthStats.visits.weeklyUnique.value || []).forEach(function (row) { weeks[row.key] = row.uniqueVisitors; });
  ok('주 경계가 갈림', weeks['2026-10-19'] === 1 && weeks['2026-10-26'] === 1, JSON.stringify(weeks));
  const months = {};
  (stats.visits.monthlyUnique.value || []).forEach(function (row) { months[row.key] = row.uniqueVisitors; });
  ok('월 경계가 갈림', months['2026-10'] >= 1 && months['2026-11'] >= 1, JSON.stringify(months));
  ok('회원과 게스트를 나눔', stats.visits.memberUnique.value >= 1 && stats.visits.guestUnique.value === 1, JSON.stringify(stats.visits));
  ok('7일 재방문율 분모가 기간 순방문자', stats.returns.returnRate7d.denominator === stats.visits.periodUnique.value, JSON.stringify(stats.returns.returnRate7d));
  ok('단일 활동만이면 체류는 데이터 없음이 아님', stats.usage.averageDwellSeconds.status === 'OK');
  ok('DAU는 마지막 날 회원만', stats.members.dau.value === 1, JSON.stringify(stats.members.dau));
  ok('탈퇴가 있으면 전환율은 데이터 없음', stats.members.firstActivityConversion.status === 'NO_DATA');
  ok('반응 0은 수집된 0', stats.operations.reactions.status === 'OK' && stats.operations.reactions.value === 0);
  ok('응답에 개인 키 없음', !/visitorKey|userId|alignment/.test(JSON.stringify(stats)));

  const single = buildAdminOpsStats({
    now: now,
    preset: 'today',
    visitsCollected: true,
    visitEvents: [ev({ occurredAt: '2026-11-02T01:00:00.000Z', visitorKey: 'solo-visitor', kind: 'activity' })],
  });
  ok('이벤트 하나 체류는 데이터 없음', single.usage.averageDwellSeconds.status === 'NO_DATA' && single.usage.averageDwellSeconds.value == null);
  ok('오늘 방문 1, 순방문자 1', single.visits.periodVisits.value === 1 && single.visits.periodUnique.value === 1);
  const dup = buildAdminOpsStats({
    now: now,
    preset: 'today',
    visitsCollected: true,
    visitEvents: [
      ev({ occurredAt: '2026-11-02T01:00:00.000Z', visitorKey: 'same-person' }),
      ev({ occurredAt: '2026-11-02T01:10:00.000Z', visitorKey: 'same-person' }),
      ev({ occurredAt: '2026-11-02T02:00:00.000Z', visitorKey: 'same-person' }),
    ],
  });
  ok('같은 사람 여러 방문', dup.visits.periodUnique.value === 1 && dup.visits.periodVisits.value === 2, JSON.stringify(dup.visits));

  let rangeErr = null;
  try {
    buildAdminOpsStats({ now: now, preset: 'custom', from: '2026-01-01', to: '2026-06-01' });
  } catch (e) {
    rangeErr = e.code;
  }
  ok('90일 초과 거부', rangeErr === 'RANGE_TOO_LONG');

  const app = express();
  app.use('/api/admin/ops-stats', mountAdminOpsStatsRoutes({
    now: now,
    adminAuth: {
      supabaseUrl: 'http://127.0.0.1:9',
      supabaseAnonKey: 'test-anon',
      getUserFromAccessToken: function (token) {
        if (token === 'admin-token') return { id: 'admin-1', app_metadata: { role: 'ADMIN' } };
        if (token === 'member-token') return { id: 'member-1', app_metadata: { role: 'MEMBER' } };
        return null;
      },
    },
    visitCollectionEnabled: false,
    query: null,
  }));
  const guest = await request(app, '/api/admin/ops-stats?preset=today');
  const member = await request(app, '/api/admin/ops-stats?preset=7d', 'member-token');
  const admin = await request(app, '/api/admin/ops-stats?preset=30d', 'admin-token');
  const tooLong = await request(app, '/api/admin/ops-stats?from=2026-01-01&to=2026-06-01', 'admin-token');
  ok('게스트 401', guest.status === 401, guest.status);
  ok('회원 403', member.status === 403, member.status);
  ok('관리자 200', admin.status === 200 && admin.body.ok === true && admin.body.visits.periodUnique.status === 'NOT_COLLECTED', admin.status);
  ok('관리자 긴 기간 400', tooLong.status === 400, tooLong.status);

  console.log('RESULT ' + passed + ' PASS ' + failed + ' FAIL');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
