'use strict';
/**
 * 개발용 계급 명단으로 선거 자격을 확인한다.
 * 운영 데이터베이스와 운영 인증은 열지 않는다.
 * node tools/test-leader-election-member-link.js
 */
const link = require('../server/leader-election-member-link');
const adapter = require('../server/leader-election-store-adapter');
const store = require('../server/leader-election-pg-store');

const now = 1700000000000;
const lines = [];

function check(name, ok) {
  lines.push((ok ? 'PASS ' : 'FAIL ') + name);
}

function member(id, extra) {
  return Object.assign({
    id: id,
    country: 'KR',
    territory: 'pioneer',
    rank: 'citizen',
    valid: true,
    lastPostAtMs: now,
    xp: 11,
    fame: 6,
    achievements: ['kept'],
  }, extra || {});
}

function directory(members) {
  return { source: 'rank-store', members: members };
}

function pureTests() {
  const rep = member('rep-1', { rank: 'representative' });
  const other = member('us-1', { country: 'US', territory: 'guardian', rank: 'representative' });
  const dir = directory([rep, other, member('citizen-1')]);
  const filed = link.representativeStatus(dir, {
    country: 'KR', territory: 'pioneer', personId: 'rep-1', isRepresentative: false,
  });
  check('representative-from-rank-store', filed.ok === true);
  const flagged = link.representativeStatus(dir, {
    country: 'KR', territory: 'pioneer', personId: 'citizen-1', isRepresentative: true,
  });
  check('client-representative-flag-ignored', flagged.reason === 'NOT_REPRESENTATIVE');
  const missing = link.representativeStatus(dir, { country: 'KR', territory: 'pioneer', personId: 'nobody' });
  check('missing-representative-not-invented', missing.reason === 'REPRESENTATIVE_STATUS_MISSING');
  const crossed = link.representativeStatus(dir, { country: 'KR', territory: 'pioneer', personId: 'us-1' });
  check('other-country-cannot-file', crossed.reason === 'REPRESENTATIVE_STATUS_MISSING');
  const mock = link.project({ source: 'legacy-mock', members: [rep], populationCount: 1000 }, 'KR', 'pioneer');
  check('mock-population-not-connected', mock.reason === 'MEMBER_SOURCE_NOT_CONNECTED');
  const profiles = link.project({ source: 'profiles.territory', members: [rep] }, 'KR', 'pioneer');
  check('profile-territory-count-not-connected', profiles.reason === 'MEMBER_SOURCE_NOT_CONNECTED');
  const people = [];
  for (let i = 1; i <= 999; i += 1) people.push(member('p' + i, { rank: i <= 10 ? 'representative' : 'citizen' }));
  const under = link.populationGate(link.project(directory(people), 'KR', 'pioneer'), now);
  check('population-999-closed', under.reason === 'POPULATION_BELOW_1000' && under.count === 999);
  people.push(member('p1000'));
  const open = link.populationGate(link.project(directory(people), 'KR', 'pioneer'), now);
  check('population-1000-open', open.ok === true && open.count === 1000);
  const voter = link.voterStatus(dir, { country: 'KR', territory: 'pioneer', personId: 'rep-1', nowMs: now });
  const outsider = link.voterStatus(dir, { country: 'KR', territory: 'pioneer', personId: 'us-1', nowMs: now });
  check('voter-same-territory', voter.ok === true);
  check('voter-other-territory-rejected', outsider.reason === 'VOTER_NOT_ELIGIBLE');
  const proxy = link.sessionVoter({ sessionRequired: true, sessionUserId: '', voterId: 'someone-else' });
  check('body-voter-id-not-used', proxy.reason === 'AUTH_NOT_CONNECTED' && proxy.usedBodyId === false);
  const mismatch = link.sessionVoter({ sessionRequired: true, sessionUserId: 'real-user', voterId: 'someone-else' });
  check('proxy-vote-forbidden', mismatch.reason === 'PROXY_VOTE_FORBIDDEN');
  const same = link.sessionVoter({ sessionRequired: true, sessionUserId: 'real-user', voterId: 'real-user' });
  check('session-id-is-voter', same.ok === true && same.voterId === 'real-user');
  const appointed = link.syncRankMember(member('rep-1', { rank: 'representative' }), 'appoint');
  check('appoint-moves-rank-keeps-stats', appointed.ok === true && appointed.member.rank === 'leader' && appointed.member.xp === 11 && appointed.member.fame === 6 && appointed.member.achievements[0] === 'kept' && appointed.member.excludedFromRepresentativeQuota === true && appointed.member.citizenRankColumnWritten === false);
  const removed = link.syncRankMember(appointed.member, 'remove');
  check('removal-sets-citizen-keeps-stats', removed.member.rank === 'citizen' && removed.member.xp === 11 && removed.member.autoReturnRepresentative === false);
  const cap = link.project(directory([
    member('a', { rank: 'representative' }), member('b', { rank: 'representative' }),
    member('c', { rank: 'representative' }), member('d', { rank: 'representative' }),
    member('e', { rank: 'representative' }), member('f', { rank: 'representative' }),
    member('g', { rank: 'representative' }), member('h', { rank: 'representative' }),
    member('i', { rank: 'representative' }), member('j', { rank: 'representative' }),
    member('k', { rank: 'representative' }),
  ]), 'KR', 'pioneer');
  check('representative-cap-11', cap.reason === 'REPRESENTATIVE_CAP');
  const report = link.connectionReport();
  check('production-auth-reported-unconnected', report.supabaseAuth === 'NOT_CONNECTED' && report.productionDatabase === 'NOT_CONNECTED');
  check('postgres-not-default', adapter.postgresSelected({}) === false);
}

async function databaseTests() {
  const url = process.env.LEADER_ELECTION_PG_URL || 'postgres://127.0.0.1:5432/postgres';
  if (!adapter.postgresSelected({
    LEADER_ELECTION_BACKEND: 'postgres',
    LEADER_ELECTION_PG_ISOLATED: '1',
    LEADER_ELECTION_PG_URL: url,
  })) {
    lines.push('NOT RUN member-link-database: isolated local url refused');
    return;
  }
  let admin;
  try {
    const Client = require('pg').Client;
    admin = new Client({ connectionString: url, connectionTimeoutMillis: 1500 });
    await admin.connect();
  } catch (err) {
    lines.push('NOT RUN member-link-database: ' + String(err && err.message || err));
    return;
  }
  const dbName = 'leader_election_iso_member_' + process.pid;
  const dbUrl = url.replace(/\/[^/]*$/, '/' + dbName);
  const Client = require('pg').Client;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    await admin.end();
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    await store.ensureOffice(client, { id: 'office:KR:pioneer', country: 'KR', territory: 'pioneer', vacancyId: 'v1' });
    await client.query(
      `INSERT INTO leader_representative_seats (country, territory, person_id) VALUES ('KR', 'pioneer', 'ghost')`
    );
    await client.query(
      `INSERT INTO leader_filing_rounds
        (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
       VALUES ('round-link', 'office:KR:pioneer', 'KR', 'pioneer', 'v1', 'filing', $1, $2)`,
      [now, now + store.FILING_MS]
    );
    const dir = directory([
      member('rep-1', { rank: 'representative' }),
      member('citizen-1'),
    ]);
    const ghost = await store.fileCandidacy(client, {
      country: 'KR', territory: 'pioneer', personId: 'ghost', nowMs: now,
      isRepresentative: true, memberDirectory: dir,
    });
    const real = await store.fileCandidacy(client, {
      country: 'KR', territory: 'pioneer', personId: 'rep-1', nowMs: now, memberDirectory: dir,
    });
    const seats = await client.query("SELECT person_id FROM leader_representative_seats WHERE country='KR' AND territory='pioneer'");
    const candidacies = await client.query('SELECT person_id FROM leader_candidacies');
    check('database-ghost-seat-cannot-file', ghost.reason === 'REPRESENTATIVE_STATUS_MISSING' && real.ok === true && candidacies.rows.length === 1 && seats.rows.length === 1 && seats.rows[0].person_id === 'rep-1');
    await client.query(
      `INSERT INTO leader_ballots (id, round_id, country, territory, status, starts_at_ms, ends_at_ms)
       VALUES ('ballot-link', 'round-link', 'KR', 'pioneer', 'open', $1, $2)`,
      [now, now + store.VOTE_MS]
    );
    const badVote = await store.castVote(client, {
      ballotId: 'ballot-link', voterId: 'us-1', choice: 'rep-1', nowMs: now + 5,
      memberDirectory: directory([member('us-1', { country: 'US', territory: 'guardian' })]),
    });
    const goodVote = await store.castVote(client, {
      ballotId: 'ballot-link', voterId: 'rep-1', choice: 'rep-1', nowMs: now + 5, memberDirectory: dir,
    });
    const again = await store.castVote(client, {
      ballotId: 'ballot-link', voterId: 'rep-1', choice: 'citizen-1', nowMs: now + 6, memberDirectory: dir,
    });
    const casts = await client.query('SELECT choice FROM leader_casts');
    check('database-voter-scope-and-duplicate', badVote.reason === 'VOTER_NOT_ELIGIBLE' && goodVote.ok === true && again.reason === 'DUPLICATE_VOTE' && casts.rows.length === 1 && casts.rows[0].choice === 'rep-1');
    const proxy = await store.castVote(client, {
      ballotId: 'ballot-link', voterId: 'rep-1', choice: 'rep-1', nowMs: now + 7,
      sessionRequired: true, sessionUserId: null,
    });
    const afterProxy = await client.query('SELECT count(*)::int AS n FROM leader_casts');
    check('database-missing-session-does-not-vote', proxy.reason === 'AUTH_NOT_CONNECTED' && afterProxy.rows[0].n === 1);
    await client.end();
    const dropper = new Client({ connectionString: url });
    await dropper.connect();
    await dropper.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [dbName]);
    await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
    await dropper.end();
  } catch (err) {
    lines.push('FAIL member-link-database: ' + String(err && err.message || err));
    try {
      const dropper = new Client({ connectionString: url });
      await dropper.connect();
      await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
      await dropper.end();
    } catch (dropErr) { /* isolated name only */ }
  }
}

pureTests();
databaseTests().then(function () {
  lines.forEach(function (line) { process.stdout.write(line + '\n'); });
  const failed = lines.some(function (line) { return line.indexOf('FAIL ') === 0; });
  process.exit(failed ? 1 : 0);
});
