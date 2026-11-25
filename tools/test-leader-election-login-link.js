'use strict';
/**
 * 주입한 검증기와 회원 읽기로 선거 신원을 확인한다.
 * 이 통과는 실제 Supabase 로그인 검증이 아니다.
 * node tools/test-leader-election-login-link.js
 */
const auth = require('../server/auth/require-authenticated-user');
const login = require('../server/leader-election-login');
const link = require('../server/leader-election-member-link');
const adapter = require('../server/leader-election-store-adapter');
const store = require('../server/leader-election-pg-store');

const now = 1700000000000;
const lines = [];

function check(name, ok) {
  lines.push((ok ? 'PASS ' : 'FAIL ') + name);
}

function finish(code) {
  login.clearVerifierForTests();
  login.clearMembershipReaderForTests();
  lines.forEach(function (line) { process.stdout.write(line + '\n'); });
  process.exit(code);
}

async function pureTests() {
  const missing = await auth.requireAuthenticatedUser({ headers: {} }, null, null);
  const noConfig = await auth.requireAuthenticatedUser({ headers: { authorization: 'Bearer test-token' } }, null, null);
  const resolved = await login.resolveElectionActor({ headers: {} });
  check('모의 아님: 토큰 없으면 기존 인증 함수가 거부', missing.error === 'UNAUTHORIZED' && missing.ok !== true);
  check('모의 아님: 설정 없으면 기존 인증 함수가 원격 호출 없이 거부', noConfig.error === 'SUPABASE_NOT_CONFIGURED');
  check('모의 아님: 기본 선거 경로는 주입 검증기가 아님', resolved.verifier === 'requireAuthenticatedUser' && resolved.liveSupabase === false && resolved.ok !== true);

  login.setVerifierForTests(function () {
    return { ok: true, user: { id: 'user-a' } };
  });
  const injected = await login.resolveElectionActor({ headers: { authorization: 'Bearer ignored' } });
  const proxy = login.bindActor(injected, { voterId: 'user-b' });
  const same = login.bindActor(injected, { voterId: 'user-a' });
  check('모의 주입: 검증된 사용자만 행위자', injected.ok === true && injected.userId === 'user-a' && injected.verifier === 'injected-test' && injected.liveSupabase === false);
  check('모의 주입: 다른 사용자 ID 거부', proxy.reason === 'PROXY_VOTE_FORBIDDEN' && proxy.stored === false);
  check('모의 주입: 같은 사용자 ID만 허용', same.ok === true && same.userId === 'user-a');
  login.clearVerifierForTests();

  login.setMembershipReaderForTests(function () {
    return {
      rows: [
        { id: 'home-only', home_country: 'KR', territory: 'PIONEER', valid: true, lastPostAtMs: now },
        { id: 'profile-citizen', activity_region: 'KR', territory: 'PIONEER', valid: true, lastPostAtMs: now, rank: 'representative', rankSource: 'citizen_rank' },
      ],
    };
  });
  const unranked = await login.loadMembership();
  const projected = unranked.directory ? link.project(unranked.directory, 'KR', 'pioneer') : null;
  check('미완료: 계급 정책 미확정이면 대표를 만들지 않음', unranked.reason === 'CITIZEN_RANK_POLICY_NOT_FINALIZED' && unranked.representativesReady === false && projected && projected.representativeIds.length === 0);
  check('미완료: 국적은 활동 국가가 아님', projected && projected.populationRecords.every(function (row) { return row.id !== 'home-only'; }));
  login.clearMembershipReaderForTests();

  const people = [];
  for (let i = 1; i <= 999; i += 1) {
    people.push({ id: 'p' + i, country: 'KR', territory: 'pioneer', rank: 'citizen', valid: true, lastPostAtMs: now });
  }
  const under = link.populationGate(link.project({ source: 'server-profile-read', members: people }, 'KR', 'pioneer'), now);
  people.push({ id: 'p1000', country: 'KR', territory: 'pioneer', rank: 'citizen', valid: true, lastPostAtMs: now });
  const open = link.populationGate(link.project({ source: 'server-profile-read', members: people }, 'KR', 'pioneer'), now);
  check('모의 주입: 유효 인구 999는 닫힘', under.reason === 'POPULATION_BELOW_1000' && under.count === 999);
  check('모의 주입: 유효 인구 1000은 열림', open.ok === true && open.count === 1000);

  const kept = link.syncRankMember({ id: 'rep-1', rank: 'representative', xp: 11, fame: 6, achievements: ['kept'], citizen_rank: 'must-stay' }, 'appoint');
  const appointedRank = kept.member.rank;
  const removed = link.syncRankMember(kept.member, 'remove');
  check('모의 주입: 임명과 해임 뒤 경험치 명성 업적 유지', appointedRank === 'leader' && removed.member.rank === 'citizen' && removed.member.xp === 11 && removed.member.fame === 6 && removed.member.achievements[0] === 'kept' && removed.member.citizen_rank === 'must-stay' && removed.member.citizenRankColumnWritten === false);
}

async function databaseTests() {
  const url = 'postgres://127.0.0.1:5432/postgres';
  process.env.LEADER_ELECTION_BACKEND = 'postgres';
  process.env.LEADER_ELECTION_PG_ISOLATED = '1';
  process.env.LEADER_ELECTION_PG_URL = url;
  let admin;
  try {
    const Client = require('pg').Client;
    admin = new Client({ connectionString: url, connectionTimeoutMillis: 1500 });
    await admin.connect();
  } catch (err) {
    lines.push('NOT RUN login-link-database: ' + String(err && err.message || err));
    return;
  }
  const dbName = 'leader_election_iso_login_' + process.pid;
  const dbUrl = url.replace(/\/[^/]*$/, '/' + dbName);
  const Client = require('pg').Client;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    await admin.end();
    process.env.LEADER_ELECTION_PG_URL = dbUrl;
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    await store.ensureOffice(client, { id: 'office:KR:pioneer', country: 'KR', territory: 'pioneer', vacancyId: 'v1' });
    await client.query("INSERT INTO leader_representative_seats (country, territory, person_id) VALUES ('KR', 'pioneer', 'ghost')");
    await client.query(
      `INSERT INTO leader_filing_rounds
        (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
       VALUES ('round-login', 'office:KR:pioneer', 'KR', 'pioneer', 'v1', 'filing', $1, $2)`,
      [now, now + store.FILING_MS]
    );
    await client.query(
      `INSERT INTO leader_ballots (id, round_id, country, territory, status, starts_at_ms, ends_at_ms)
       VALUES ('ballot-login', 'round-login', 'KR', 'pioneer', 'open', $1, $2)`,
      [now, now + store.VOTE_MS]
    );
    const rows = [
      { id: 'user-a', activity_region: 'KR', territory: 'PIONEER', valid: true, lastPostAtMs: now, rank: 'representative', rankSource: 'rank-store', xp: 11, fame: 6, achievements: ['kept'] },
      { id: 'user-c', activity_region: 'KR', territory: 'PIONEER', valid: true, lastPostAtMs: now, rank: 'citizen', rankSource: 'rank-store', xp: 2, fame: 1, achievements: [] },
      { id: 'user-us', activity_region: 'US', territory: 'GUARDIAN', valid: true, lastPostAtMs: now, rank: 'representative', rankSource: 'rank-store' },
    ];
    login.setMembershipReaderForTests(function () { return { rows: rows }; });

    const anonymous = await adapter.routeElection('/dev/leader-election/ballots/ballot-login/votes', {
      voterId: 'user-a', choice: 'user-a', nowMs: now + 5,
    }, { headers: {} });
    const none = await client.query('SELECT count(*)::int AS n FROM leader_casts');
    check('모의 주입 전: 미인증 투표는 저장하지 않음', anonymous.ok !== true && anonymous.liveSupabase === false && none.rows[0].n === 0);

    login.setVerifierForTests(function () { return { ok: true, user: { id: 'user-a' } }; });
    const voted = await adapter.routeElection('/dev/leader-election/ballots/ballot-login/votes', {
      voterId: 'user-b', choice: 'user-a', nowMs: now + 5,
    }, { headers: { authorization: 'Bearer injected' } });
    const stillNone = await client.query('SELECT count(*)::int AS n FROM leader_casts');
    check('모의 주입: 다른 ID 대리 투표는 저장하지 않음', voted.reason === 'PROXY_VOTE_FORBIDDEN' && stillNone.rows[0].n === 0);

    const cast = await adapter.routeElection('/dev/leader-election/ballots/ballot-login/votes', {
      choice: 'user-a', nowMs: now + 5,
    }, { headers: { authorization: 'Bearer injected' } });
    const saved = await client.query('SELECT voter_id, choice FROM leader_casts');
    check('모의 주입: 검증된 사용자 투표 저장', cast.ok === true && saved.rows.length === 1 && saved.rows[0].voter_id === 'user-a' && saved.rows[0].choice === 'user-a');

    login.setVerifierForTests(function () { return { ok: true, user: { id: 'user-us' } }; });
    const cross = await adapter.routeElection('/dev/leader-election/ballots/ballot-login/votes', {
      choice: 'user-a', nowMs: now + 6,
    }, { headers: { authorization: 'Bearer injected' } });
    check('모의 주입: 다른 활동 국가와 영토 거부', cross.reason === 'VOTER_NOT_ELIGIBLE');

    login.setVerifierForTests(function () { return { ok: true, user: { id: 'user-c' } }; });
    const notRep = await adapter.routeFiling('/dev/leader-filing/candidacies', {
      country: 'KR', territory: 'pioneer', personId: 'ghost', isRepresentative: true, nowMs: now,
    }, { headers: { authorization: 'Bearer injected' } });
    const filed = await client.query('SELECT person_id FROM leader_candidacies');
    check('모의 주입: 현직 대표가 아니면 접수하지 않음', notRep.ok !== true && filed.rows.length === 0);

    login.setVerifierForTests(function () { return { ok: true, user: { id: 'user-a' } }; });
    const repFile = await adapter.routeFiling('/dev/leader-filing/candidacies', {
      country: 'KR', territory: 'pioneer', nowMs: now,
    }, { headers: { authorization: 'Bearer injected' } });
    const reps = await client.query('SELECT person_id FROM leader_candidacies');
    const seats = await client.query("SELECT person_id FROM leader_representative_seats WHERE country='KR' AND territory='pioneer'");
    check('모의 주입: 기록된 현직 대표만 접수', repFile.ok === true && reps.rows.length === 1 && reps.rows[0].person_id === 'user-a' && seats.rows.length === 1 && seats.rows[0].person_id === 'user-a');

    const ended = now + store.FILING_MS;
    const appointed = await store.resolveRound(client, { roundId: 'round-login', nowMs: ended, memberDirectory: (await login.loadMembership()).directory });
    const member = rows.filter(function (row) { return row.id === 'user-a'; })[0];
    const synced = link.syncRankMember(member, 'appoint');
    const office = await store.readOffice(client, 'KR', 'pioneer');
    const rankColumn = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='leader_offices' AND column_name='citizen_rank'");
    check('모의 주입: 임명 후 지도자이고 계급 칸은 쓰지 않음', appointed.appointed === true && office.leader_id === 'user-a' && synced.member.rank === 'leader' && synced.member.xp === 11 && rankColumn.rows.length === 0 && synced.member.citizenRankColumnWritten === false);
    await client.query(
      `INSERT INTO leader_filing_rounds
        (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
       VALUES ('round-race', 'office:KR:pioneer', 'KR', 'pioneer', 'v1', 'vote', $1, $1)`,
      [now]
    );
    await client.query(
      `INSERT INTO leader_ballots (id, round_id, country, territory, status, starts_at_ms, ends_at_ms)
       VALUES ('ballot-race', 'round-race', 'KR', 'pioneer', 'open', $1, $2)`,
      [now, now + store.VOTE_MS]
    );
    const other = new Client({ connectionString: dbUrl });
    await other.connect();
    const directory = (await login.loadMembership()).directory;
    const pair = await Promise.all([
      store.castVote(client, { ballotId: 'ballot-race', voterId: 'user-a', choice: 'user-a', nowMs: now + 7, sessionRequired: true, sessionUserId: 'user-a', memberDirectory: directory }),
      store.castVote(other, { ballotId: 'ballot-race', voterId: 'user-a', choice: 'user-c', nowMs: now + 7, sessionRequired: true, sessionUserId: 'user-a', memberDirectory: directory }),
    ]);
    await other.end();
    const race = await client.query("SELECT voter_id, choice FROM leader_casts WHERE ballot_id='ballot-race'");
    const winner = pair.filter(function (row) { return row.ok; })[0];
    check('모의 주입: 같은 사용자 중복·동시 투표는 한 표', !!winner && pair.filter(function (row) { return row.ok; }).length === 1 && pair.some(function (row) { return row.reason === 'DUPLICATE_VOTE'; }) && race.rows.length === 1 && race.rows[0].voter_id === 'user-a' && race.rows[0].choice === winner.choice);
    lines.push('미완료: 운영 user_progression 과 선거 임명은 한 트랜잭션이 아님');
    lines.push('미완료: 실제 Supabase 로그인 회원의 투표 저장은 검증하지 않음');
    await client.end();
    const dropper = new Client({ connectionString: url });
    await dropper.connect();
    await dropper.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [dbName]);
    await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
    await dropper.end();
  } catch (err) {
    lines.push('FAIL login-link-database: ' + String(err && err.stack || err.message || err));
    try {
      const dropper = new Client({ connectionString: url });
      await dropper.connect();
      await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
      await dropper.end();
    } catch (dropErr) { /* isolated name only */ }
  } finally {
    delete process.env.LEADER_ELECTION_BACKEND;
    delete process.env.LEADER_ELECTION_PG_ISOLATED;
    delete process.env.LEADER_ELECTION_PG_URL;
    login.clearVerifierForTests();
    login.clearMembershipReaderForTests();
  }
}

pureTests().then(databaseTests).then(function () {
  const failed = lines.some(function (line) { return line.indexOf('FAIL ') === 0; });
  finish(failed ? 1 : 0);
}).catch(function (err) {
  lines.push('FAIL login-link: ' + String(err && err.stack || err));
  finish(1);
});
