'use strict';
/**
 * 격리 Postgres에서 확정된 계급 저장과 임명 원자성만 확인한다.
 * 점수가 이미 있으면 그 점수로 정원만 채운다. 원천이 없으면 산식을 0으로 채우지 않고 막는다.
 * node tools/test-leader-rank-store.js
 */
const { fork } = require('child_process');
const adapter = require('../server/leader-election-store-adapter');
const store = require('../server/leader-election-pg-store');
const rank = require('../shared/dec023-rank-evaluation-core');
const login = require('../server/leader-election-login');
const auth = require('../server/auth/require-authenticated-user');

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK = { weekday: 'WEDNESDAY', hour: 0, minute: 0 };

if (process.argv[2] === '--worker') {
  const input = JSON.parse(process.argv[3]);
  const Client = require('pg').Client;
  const client = new Client({ connectionString: process.env.LEADER_ELECTION_PG_URL });
  client.connect().then(function () {
    return store[input.method](client, input.body);
  }).then(function (result) {
    return client.end().then(function () { return result; });
  }).then(function (result) {
    process.stdout.write(JSON.stringify(result));
  }).catch(function (err) {
    process.stdout.write(JSON.stringify({ ok: false, reason: 'WORKER_ERROR', detail: String(err && err.message || err) }));
  });
  return;
}

function worker(dbUrl, method, body) {
  return new Promise(function (resolve) {
    const child = fork(__filename, ['--worker', JSON.stringify({ method: method, body: body })], {
      env: Object.assign({}, process.env, {
        LEADER_ELECTION_BACKEND: 'postgres',
        LEADER_ELECTION_PG_ISOLATED: '1',
        LEADER_ELECTION_PG_URL: dbUrl,
      }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', function (chunk) { out += chunk; });
    child.stderr.on('data', function (chunk) { err += chunk; });
    child.on('exit', function () {
      try { resolve(JSON.parse(out)); }
      catch (parseErr) { resolve({ ok: false, reason: 'BAD_WORKER', detail: out + err }); }
    });
  });
}

function line(ok, name) {
  return (ok ? 'VERIFIED ' : 'FAIL ') + name;
}

async function main() {
  const requested = process.env.LEADER_ELECTION_PG_URL || 'postgres://127.0.0.1:5432/postgres';
  const allowed = adapter.postgresSelected({
    LEADER_ELECTION_BACKEND: 'postgres',
    LEADER_ELECTION_PG_ISOLATED: '1',
    LEADER_ELECTION_PG_URL: requested,
  });
  if (!allowed) {
    process.stdout.write('NOT RUN rank-store: isolated local url refused\n');
    process.exit(0);
  }
  const Client = require('pg').Client;
  const admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
  try {
    await admin.connect();
  } catch (err) {
    process.stdout.write('NOT RUN rank-store: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_rank_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  const lines = [];
  let client;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    await admin.end();
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    lines.push.apply(lines, await run(client, dbUrl));
    await client.end();
    const dropper = new Client({ connectionString: requested });
    await dropper.connect();
    await dropper.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [dbName]);
    await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
    await dropper.end();
    lines.forEach(function (text) { process.stdout.write(text + '\n'); });
    process.exit(lines.some(function (text) { return text.indexOf('FAIL ') === 0; }) ? 1 : 0);
  } catch (err) {
    try { if (client) await client.end(); } catch (endErr) { /* already closed */ }
    try {
      const dropper = new Client({ connectionString: requested });
      await dropper.connect();
      await dropper.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [dbName]);
      await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
      await dropper.end();
    } catch (dropErr) { /* reported below */ }
    process.stdout.write('FAIL rank-store: ' + String(err && err.stack || err) + '\n');
    process.exit(1);
  }
}

async function run(client, dbUrl) {
  const lines = [];
  const now = Date.now();
  const described = rank.describeScore({ fame: 45, uniquePositiveEvaluators: 30, evaluationReactions: 15, followers: 10 });
  lines.push(line(described.combinedScore == null && described.formulaStatus === 'FORMULA_UNCONFIRMED', 'formula-stays-unconfirmed'));

  const rejected = await store.storeMemberFacts(client, {
    activityRegion: 'KR', territory: 'PIONEER', personId: 'no-score', xp: 1, fame: 2, rank: 'representative', comparisonScore: 99,
  });
  lines.push(line(rejected.reason === 'CLIENT_RANK_IGNORED' && rejected.stored === false, 'client-rank-rejected'));

  const home = await store.storeMemberFacts(client, {
    homeCountry: 'US', activityRegion: 'KR', territory: 'central', personId: 'home-not-country', xp: 3, fame: 4, achievements: ['keep'], valid: true, lastPostAtMs: now,
  });
  const homeRow = await client.query('SELECT country, territory, rank, comparison_score FROM leader_rank_members WHERE person_id=$1', ['home-not-country']);
  lines.push(line(home.ok === true && homeRow.rows[0].country === 'KR' && homeRow.rows[0].territory === 'central' && homeRow.rows[0].rank === 'citizen' && homeRow.rows[0].comparison_score == null, 'activity-country-not-home-country'));

  const blocked = await store.refreshStoredRanks(client, { country: 'KR', territory: 'pioneer', clock: CLOCK, refreshComplete: true });
  lines.push(line(blocked.applied === false && blocked.reason === 'SOURCE_MISSING' && blocked.combinedScore == null, 'refresh-blocked-without-source'));

  await seedRatio(client, now);
  const clientPopulation = await store.refreshStoredRanks(client, { country: 'KR', territory: 'pioneer', clock: CLOCK, refreshComplete: true, territoryPopulation: 1 });
  lines.push(line(clientPopulation.reason === 'CLIENT_RANK_IGNORED' && clientPopulation.applied === false, 'client-population-rejected'));
  const early = await store.refreshStoredRanks(client, { country: 'KR', territory: 'pioneer', clock: { weekday: 'TUESDAY', hour: 0, minute: 0 }, refreshComplete: true });
  const still = await client.query("SELECT count(*)::int AS n FROM leader_rank_members WHERE country='KR' AND territory='pioneer' AND rank='citizen'");
  lines.push(line(early.applied === false && early.reason === 'NOT_REFRESH_MOMENT' && still.rows[0].n === 22, 'wednesday-clock-required'));

  const refreshed = await store.refreshStoredRanks(client, { country: 'KR', territory: 'pioneer', clock: CLOCK, refreshComplete: true });
  const counts = await client.query("SELECT rank, count(*)::int AS n FROM leader_rank_members WHERE country='KR' AND territory='pioneer' GROUP BY rank");
  const map = Object.create(null);
  counts.rows.forEach(function (row) { map[row.rank] = row.n; });
  const remainder = (map.debater || 0) + (map.citizen || 0);
  const ratioOk = refreshed.applied === true && map.leader === 1 && map.representative === 10 && (map.elder || 0) <= 50
    && remainder > 0 && (map.debater || 0) <= Math.floor(remainder * 0.3) && (map.citizen || 0) >= remainder - Math.floor(remainder * 0.3);
  lines.push(line(ratioOk, 'caps-and-citizen-debater-ratio'));

  const usBefore = await client.query("SELECT rank FROM leader_rank_members WHERE country='US' AND territory='pioneer' AND person_id='us-only'");
  lines.push(line(usBefore.rows[0] && usBefore.rows[0].rank === 'representative', 'kr-refresh-leaves-us-rank'));

  await seedTie(client);
  const tied = await store.refreshStoredRanks(client, { country: 'US', territory: 'guardian', clock: CLOCK, refreshComplete: true });
  const kept = await client.query("SELECT rank FROM leader_rank_members WHERE country='US' AND territory='guardian' AND person_id IN ('keep','tie-a','tie-b') ORDER BY person_id");
  const tieOk = tied.applied === true && kept.rows[0].rank === 'representative'
    && kept.rows[1].rank !== 'representative' && kept.rows[2].rank !== 'representative';
  lines.push(line(tieOk, 'tie-keeps-incumbent'));

  const recent = await store.storeMemberFacts(client, { activityRegion: 'US', territory: 'central', personId: 'recent', valid: true, lastPostAtMs: now });
  const stale = await store.storeMemberFacts(client, { activityRegion: 'US', territory: 'central', personId: 'stale', valid: true, lastPostAtMs: now - (31 * DAY_MS) });
  const activity = await client.query("SELECT person_id, valid, last_post_at_ms FROM leader_rank_members WHERE country='US' AND territory='central' AND person_id IN ('recent','stale')");
  const counted = rank.countValidPopulation({
    country: 'US', territory: 'central', asOfMs: now,
    records: activity.rows.map(function (row) { return { id: row.person_id, country: 'US', territory: 'central', valid: row.valid, lastPostAtMs: Number(row.last_post_at_ms) }; }),
  });
  const open999 = rank.leaderElectionOpen(999);
  const open1000 = rank.leaderElectionOpen(1000);
  lines.push(line(recent.ok && stale.ok && counted.count === 1 && open999.open === false && open1000.open === true, 'valid-population-30-day-and-1000'));

  await client.query(
    "INSERT INTO leader_representative_seats (country, territory, person_id) VALUES ('KR','pioneer','citizen-high-1')"
  );
  await store.ensureOffice(client, { id: 'office:KR:pioneer', country: 'KR', territory: 'pioneer', vacancyId: 'v-rank' });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-rank', 'office:KR:pioneer', 'KR', 'pioneer', 'v-rank', 'filing', $1, $2)`,
    [now, now + store.FILING_MS]
  );
  const citizenFile = await store.fileCandidacy(client, { country: 'KR', territory: 'pioneer', personId: 'citizen-high-1', nowMs: now });
  const repFile = await store.fileCandidacy(client, { country: 'KR', territory: 'pioneer', personId: 'rep-1', nowMs: now });
  const filed = await client.query('SELECT person_id FROM leader_candidacies');
  lines.push(line(citizenFile.reason === 'REPRESENTATIVE_STATUS_MISSING' && repFile.ok === true && filed.rows.length === 1 && filed.rows[0].person_id === 'rep-1', 'only-stored-representative-can-file'));

  const missingAuth = await auth.requireAuthenticatedUser({ headers: {} }, null, null);
  const proxy = login.bindActor({ ok: true, userId: 'real-user', liveSupabase: false }, { voterId: 'other-user', actor: { id: 'other-user' } });
  lines.push(line(missingAuth.ok !== true && proxy.reason === 'PROXY_VOTE_FORBIDDEN' && proxy.usedBodyId === false, 'identity-boundary'));

  await client.query(
    `INSERT INTO leader_ballots (id, round_id, country, territory, status, starts_at_ms, ends_at_ms)
     VALUES ('ballot-rank', 'round-rank', 'KR', 'pioneer', 'open', $1, $2)`,
    [now, now + store.VOTE_MS]
  );
  const noSession = await store.castVote(client, { ballotId: 'ballot-rank', voterId: 'real-user', choice: 'rep-1', nowMs: now + 5, sessionRequired: true });
  const proxyVote = await store.castVote(client, { ballotId: 'ballot-rank', voterId: 'other-user', choice: 'rep-1', nowMs: now + 5, sessionRequired: true, sessionUserId: 'real-user' });
  const firstVote = await store.castVote(client, { ballotId: 'ballot-rank', voterId: 'real-user', choice: 'rep-1', nowMs: now + 5, sessionRequired: true, sessionUserId: 'real-user' });
  const secondVote = await store.castVote(client, { ballotId: 'ballot-rank', voterId: 'real-user', choice: 'rep-2', nowMs: now + 6, sessionRequired: true, sessionUserId: 'real-user' });
  const votes = await client.query('SELECT choice FROM leader_casts');
  lines.push(line(noSession.reason === 'AUTH_NOT_CONNECTED' && proxyVote.reason === 'PROXY_VOTE_FORBIDDEN' && firstVote.ok === true && secondVote.reason === 'DUPLICATE_VOTE' && votes.rows.length === 1 && votes.rows[0].choice === 'rep-1', 'proxy-and-duplicate-vote'));

  await store.ensureOffice(client, { id: 'office:US:pioneer', country: 'US', territory: 'pioneer', vacancyId: 'v-us' });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-us', 'office:US:pioneer', 'US', 'pioneer', 'v-us', 'filing', $1, $2)`,
    [now, now + store.FILING_MS]
  );
  const usFile = await store.fileCandidacy(client, { country: 'US', territory: 'pioneer', personId: 'us-only', nowMs: now });
  const before = await client.query("SELECT xp, fame, achievements FROM leader_rank_members WHERE person_id='us-only'");
  const appointed = await store.resolveRound(client, { roundId: 'round-us', nowMs: now + store.FILING_MS });
  const leader = await client.query("SELECT rank, xp, fame, achievements FROM leader_rank_members WHERE person_id='us-only'");
  const office = await client.query("SELECT leader_id FROM leader_offices WHERE country='US' AND territory='pioneer'");
  const reps = await client.query("SELECT count(*)::int AS n FROM leader_rank_members WHERE country='US' AND territory='pioneer' AND rank='representative'");
  const removed = await store.removeOffice(client, { country: 'US', territory: 'pioneer', nowMs: now + store.FILING_MS + 10, reason: 'OFFICE_CLEARED' });
  const citizen = await client.query("SELECT rank, xp, fame, achievements FROM leader_rank_members WHERE person_id='us-only'");
  const vacant = await client.query("SELECT leader_id FROM leader_offices WHERE country='US' AND territory='pioneer'");
  const sameStats = JSON.stringify(before.rows[0].achievements) === JSON.stringify(leader.rows[0].achievements)
    && JSON.stringify(before.rows[0].achievements) === JSON.stringify(citizen.rows[0].achievements)
    && Number(before.rows[0].xp) === Number(leader.rows[0].xp) && Number(before.rows[0].xp) === Number(citizen.rows[0].xp)
    && Number(before.rows[0].fame) === Number(citizen.rows[0].fame);
  lines.push(line(usFile.ok === true && appointed.appointed === true && leader.rows[0].rank === 'leader' && office.rows[0].leader_id === 'us-only' && reps.rows[0].n === 0 && removed.ok === true && citizen.rows[0].rank === 'citizen' && vacant.rows[0].leader_id == null && sameStats, 'appointment-removal-same-transaction'));

  await store.ensureOffice(client, { id: 'office:KR:guardian', country: 'KR', territory: 'guardian', vacancyId: 'v-roll' });
  await client.query(
    `INSERT INTO leader_rank_members (country, territory, person_id, xp, fame, rank)
     VALUES ('KR','guardian','roll-person',7,8,'representative')`
  );
  const rolled = await store.failRankAndOffice(client, { country: 'KR', territory: 'guardian', personId: 'roll-person' });
  const rollOffice = await client.query("SELECT leader_id FROM leader_offices WHERE country='KR' AND territory='guardian'");
  const rollRank = await client.query("SELECT rank FROM leader_rank_members WHERE person_id='roll-person'");
  lines.push(line(rolled.ok === true && rolled.rolledBack === true && rollOffice.rows[0].leader_id == null && rollRank.rows[0].rank === 'representative', 'rank-and-office-rollback'));

  for (let i = 1; i <= 9; i += 1) {
    await client.query(
      `INSERT INTO leader_rank_members (country, territory, person_id, rank) VALUES ('KR','central',$1,'representative')`,
      ['cap-' + i]
    );
  }
  await client.query("INSERT INTO leader_rank_members (country, territory, person_id, rank) VALUES ('KR','central','cap-a','citizen'), ('KR','central','cap-b','citizen')");
  const pair = await Promise.all([
    worker(dbUrl, 'promoteRepresentative', { country: 'KR', territory: 'central', personId: 'cap-a' }),
    worker(dbUrl, 'promoteRepresentative', { country: 'KR', territory: 'central', personId: 'cap-b' }),
  ]);
  const cap = await client.query("SELECT count(*)::int AS n FROM leader_rank_members WHERE country='KR' AND territory='central' AND rank='representative'");
  lines.push(line(cap.rows[0].n === 10 && pair.filter(function (row) { return row.ok; }).length === 1 && pair.some(function (row) { return row.reason === 'REPRESENTATIVE_CAP'; }), 'concurrent-representative-cap'));

  await client.query("INSERT INTO leader_rank_members (country, territory, person_id, rank) VALUES ('US','central','lead-a','citizen'), ('US','central','lead-b','citizen')");
  const leaders = await Promise.all([
    worker(dbUrl, 'setStoredLeader', { country: 'US', territory: 'central', personId: 'lead-a' }),
    worker(dbUrl, 'setStoredLeader', { country: 'US', territory: 'central', personId: 'lead-b' }),
  ]);
  const leaderCount = await client.query("SELECT count(*)::int AS n FROM leader_rank_members WHERE country='US' AND territory='central' AND rank='leader'");
  lines.push(line(leaderCount.rows[0].n === 1 && leaders.filter(function (row) { return row.ok; }).length === 1, 'concurrent-one-leader'));
  return lines;
}

async function seedRatio(client, now) {
  await client.query("INSERT INTO leader_rank_scopes (country, territory, territory_population) VALUES ('KR','pioneer',1000)");
  await client.query(
    `INSERT INTO leader_rank_members
      (country, territory, person_id, xp, fame, achievements, rank, comparison_score, elected_leader, unique_positive_evaluators, valid, last_post_at_ms)
     VALUES ('KR','pioneer','leader-1',11,22,'["badge"]'::jsonb,'leader',1000,true,200,true,$1)`,
    [now]
  );
  for (let i = 1; i <= 12; i += 1) {
    await client.query(
      `INSERT INTO leader_rank_members
        (country, territory, person_id, xp, fame, achievements, rank, comparison_score, unique_positive_evaluators, valid, last_post_at_ms)
       VALUES ('KR','pioneer',$1,$2,$3,'["badge"]'::jsonb,'citizen',$4,200,true,$5)`,
      ['rep-' + i, 10 + i, 20 + i, 800 - i, now]
    );
  }
  for (let i = 1; i <= 10; i += 1) {
    await client.query(
      `INSERT INTO leader_rank_members
        (country, territory, person_id, xp, fame, rank, comparison_score, unique_positive_evaluators, valid, last_comment_at_ms)
       VALUES ('KR','pioneer',$1,1,1,'citizen',$2,30,true,$3)`,
      ['citizen-high-' + i, 100 - i, now]
    );
  }
  await client.query(
    `INSERT INTO leader_rank_members (country, territory, person_id, xp, fame, achievements, rank, comparison_score, unique_positive_evaluators)
     VALUES ('US','pioneer','us-only',15,25,'["badge"]'::jsonb,'representative',50,200)`
  );
}

async function seedTie(client) {
  await client.query("INSERT INTO leader_rank_scopes (country, territory, territory_population) VALUES ('US','guardian',1000)");
  for (let i = 1; i <= 9; i += 1) {
    await client.query(
      `INSERT INTO leader_rank_members (country, territory, person_id, rank, comparison_score, unique_positive_evaluators)
       VALUES ('US','guardian',$1,'representative',$2,200)`,
      ['seat-' + i, 500 - i]
    );
  }
  await client.query(
    `INSERT INTO leader_rank_members (country, territory, person_id, rank, comparison_score, unique_positive_evaluators) VALUES
      ('US','guardian','keep','representative',100,200),
      ('US','guardian','tie-a','citizen',100,200),
      ('US','guardian','tie-b','citizen',100,200)`
  );
}

main();
