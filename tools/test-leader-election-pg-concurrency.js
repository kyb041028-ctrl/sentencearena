'use strict';
/**
 * 고립된 로컬 Postgres에서만 동시성 시험을 한다.
 * PGlite와 운영 데이터베이스는 쓰지 않는다. 서버가 없으면 NOT RUN이다.
 * node tools/test-leader-election-pg-concurrency.js
 */
const { fork } = require('child_process');
const adapter = require('../server/leader-election-store-adapter');
const store = require('../server/leader-election-pg-store');

const CASES = [
  'two-process-filing',
  'two-process-voting',
  'duplicate-appointment',
  'two-rounds-one-office',
  'mid-transaction-rollback',
  'restart-matches-commit',
  'tie-and-zero-votes-refile',
  'office-cleared-normal-removal',
  'country-territory-separate',
  'repeated-tick-one-round',
  'missing-population-and-representative',
  'representative-cap-and-leader-outside',
];

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

function flagChecks() {
  const off = adapter.postgresSelected({});
  const remote = adapter.postgresSelected({
    LEADER_ELECTION_BACKEND: 'postgres',
    LEADER_ELECTION_PG_ISOLATED: '1',
    LEADER_ELECTION_PG_URL: 'postgres://db.supabase.co/production',
  });
  const local = adapter.postgresSelected({
    LEADER_ELECTION_BACKEND: 'postgres',
    LEADER_ELECTION_PG_ISOLATED: '1',
    LEADER_ELECTION_PG_URL: 'postgres://127.0.0.1:5432/leader_election_iso',
  });
  const lines = [];
  lines.push((off === false && remote === false && local === true)
    ? 'VERIFIED default-stays-json-and-remote-url-refused'
    : 'FAIL default-stays-json-and-remote-url-refused');
  return lines;
}

function notRun(reason) {
  const lines = flagChecks();
  CASES.forEach(function (name) { lines.push('NOT RUN ' + name + ': ' + reason); });
  return lines;
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

async function reset(client) {
  await client.query(`TRUNCATE
    leader_impeachment_votes, leader_impeachment_blocks, leader_impeachment_proposals,
    leader_casts, leader_ballots, leader_appointments, leader_candidacies,
    leader_filing_rounds, leader_runs, leader_schedules, leader_removals,
    leader_representative_seats, leader_population_records, leader_offices
    RESTART IDENTITY CASCADE`);
}

async function office(client, country, territory, vacancyId) {
  await store.ensureOffice(client, {
    id: 'office:' + country + ':' + territory,
    country: country,
    territory: territory,
    vacancyId: vacancyId,
  });
}

async function people(client, country, territory, count, nowMs) {
  const ids = [];
  for (let i = 1; i <= count; i += 1) ids.push('m' + i);
  await store.seedPopulation(client, { country: country, territory: territory, people: ids, nowMs: nowMs });
}

function finish(lines) {
  lines.forEach(function (line) { process.stdout.write(line + '\n'); });
  const failed = lines.some(function (line) { return line.indexOf('FAIL ') === 0; });
  process.exit(failed ? 1 : 0);
}

async function main() {
  const requested = process.env.LEADER_ELECTION_PG_URL || 'postgres://127.0.0.1:5432/postgres';
  const allowed = adapter.postgresSelected({
    LEADER_ELECTION_BACKEND: 'postgres',
    LEADER_ELECTION_PG_ISOLATED: '1',
    LEADER_ELECTION_PG_URL: requested,
  });
  if (!allowed) {
    finish(notRun('isolated local url refused'));
    return;
  }
  let admin;
  try {
    const Client = require('pg').Client;
    admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
    await admin.connect();
  } catch (err) {
    finish(notRun('no isolated postgres: ' + String(err && err.message || err)));
    return;
  }
  const dbName = 'leader_election_iso_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    await admin.end();
    const Client = require('pg').Client;
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    const lines = flagChecks();
    lines.push.apply(lines, await runCases(client, dbUrl));
    await client.end();
    const dropper = new Client({ connectionString: requested });
    await dropper.connect();
    await dropper.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [dbName]);
    await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
    await dropper.end();
    finish(lines);
  } catch (err) {
    try { await admin.end(); } catch (endErr) { /* already closed */ }
    try {
      const Client = require('pg').Client;
      const dropper = new Client({ connectionString: requested });
      await dropper.connect();
      await dropper.query('DROP DATABASE IF EXISTS ' + dbName);
      await dropper.end();
    } catch (dropErr) { /* disposable name only */ }
    finish(notRun('isolated database setup failed: ' + String(err && err.message || err)));
  }
}

async function runCases(client, dbUrl) {
  const lines = [];
  const now = 1_700_000_000_000;
  lines.push(await caseFiling(client, dbUrl, now));
  lines.push(await caseVoting(client, dbUrl, now));
  lines.push(await caseDuplicateAppointment(client, dbUrl, now));
  lines.push(await caseTwoRounds(client, dbUrl, now));
  lines.push(await caseRollback(client, now));
  lines.push(await caseRestart(dbUrl, now));
  lines.push(await caseTieZero(client, now));
  lines.push(await caseCleared(client, now));
  lines.push(await caseSeparate(client, dbUrl, now));
  lines.push(await caseTick(client, now));
  lines.push(await caseMissing(client, now));
  lines.push(await caseCap(client, now));
  return lines;
}

async function caseFiling(client, dbUrl, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'v1');
  await store.seedRepresentative(client, { country: 'KR', territory: 'pioneer', personId: 'rep-a' });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-file', 'office:KR:pioneer', 'KR', 'pioneer', 'v1', 'filing', $1, $2)`,
    [now, now + store.FILING_MS]
  );
  const pair = await Promise.all([
    worker(dbUrl, 'fileCandidacy', { country: 'KR', territory: 'pioneer', personId: 'rep-a', nowMs: now, isRepresentative: true }),
    worker(dbUrl, 'fileCandidacy', { country: 'KR', territory: 'pioneer', personId: 'rep-a', nowMs: now, isRepresentative: true }),
  ]);
  const rows = await client.query('SELECT person_id FROM leader_candidacies');
  const ok = rows.rows.length === 1 && pair.filter(function (row) { return row.ok; }).length === 1
    && pair.some(function (row) { return row.reason === 'DUPLICATE_CANDIDACY'; });
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'two-process-filing';
}

async function caseVoting(client, dbUrl, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'v1');
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-vote', 'office:KR:pioneer', 'KR', 'pioneer', 'v1', 'vote', $1, $1)`,
    [now]
  );
  await client.query(
    `INSERT INTO leader_ballots (id, round_id, country, territory, status, starts_at_ms, ends_at_ms)
     VALUES ('ballot-vote', 'round-vote', 'KR', 'pioneer', 'open', $1, $2)`,
    [now, now + store.VOTE_MS]
  );
  const pair = await Promise.all([
    worker(dbUrl, 'castVote', { ballotId: 'ballot-vote', voterId: 'voter-1', choice: 'rep-a', nowMs: now + 10 }),
    worker(dbUrl, 'castVote', { ballotId: 'ballot-vote', voterId: 'voter-1', choice: 'rep-b', nowMs: now + 10 }),
  ]);
  const rows = await client.query('SELECT choice FROM leader_casts WHERE voter_id=$1', ['voter-1']);
  const ok = rows.rows.length === 1 && pair.filter(function (row) { return row.ok; }).length === 1
    && pair.some(function (row) { return row.reason === 'DUPLICATE_VOTE'; })
    && rows.rows[0].choice === pair.filter(function (row) { return row.ok; })[0].choice;
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'two-process-voting';
}

async function caseDuplicateAppointment(client, dbUrl, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'v1');
  await store.seedRepresentative(client, { country: 'KR', territory: 'pioneer', personId: 'rep-a' });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms, result)
     VALUES ('round-sole', 'office:KR:pioneer', 'KR', 'pioneer', 'v1', 'filing', $1, $1, NULL)`,
    [now]
  );
  await client.query(
    `INSERT INTO leader_candidacies (id, round_id, person_id, country, territory, filed_at_ms)
     VALUES ('cand-a', 'round-sole', 'rep-a', 'KR', 'pioneer', $1)`,
    [now]
  );
  const ended = now + store.FILING_MS;
  const pair = await Promise.all([
    worker(dbUrl, 'resolveRound', { roundId: 'round-sole', nowMs: ended }),
    worker(dbUrl, 'resolveRound', { roundId: 'round-sole', nowMs: ended }),
  ]);
  const rows = await client.query('SELECT person_id FROM leader_appointments');
  const officeRow = await store.readOffice(client, 'KR', 'pioneer');
  const ok = rows.rows.length === 1 && rows.rows[0].person_id === 'rep-a' && officeRow.leader_id === 'rep-a'
    && pair.filter(function (row) { return row.appointed === true; }).length === 1;
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'duplicate-appointment';
}

async function caseTwoRounds(client, dbUrl, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'v2');
  await store.seedRepresentative(client, { country: 'KR', territory: 'pioneer', personId: 'rep-new' });
  await store.seedRepresentative(client, { country: 'KR', territory: 'pioneer', personId: 'rep-old' });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms, result)
     VALUES
      ('round-old', 'office:KR:pioneer', 'KR', 'pioneer', 'v1', 'closed', $1, $1, 'sole'),
      ('round-new', 'office:KR:pioneer', 'KR', 'pioneer', 'v2', 'filing', $1, $1, NULL)`,
    [now]
  );
  await client.query(
    `INSERT INTO leader_candidacies (id, round_id, person_id, country, territory, filed_at_ms) VALUES
      ('cand-old', 'round-old', 'rep-old', 'KR', 'pioneer', $1),
      ('cand-new', 'round-new', 'rep-new', 'KR', 'pioneer', $1)`,
    [now]
  );
  const ended = now + store.FILING_MS;
  const pair = await Promise.all([
    worker(dbUrl, 'resolveRound', { roundId: 'round-old', nowMs: ended }),
    worker(dbUrl, 'resolveRound', { roundId: 'round-new', nowMs: ended }),
  ]);
  const officeRow = await store.readOffice(client, 'KR', 'pioneer');
  const appointments = await client.query('SELECT filing_round_id FROM leader_appointments');
  const ok = officeRow.leader_id === 'rep-new'
    && appointments.rows.length === 1
    && appointments.rows[0].filing_round_id === 'round-new'
    && pair.some(function (row) { return row.reason === 'OLD_ROUND'; });
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'two-rounds-one-office';
}

async function caseRollback(client, now) {
  await reset(client);
  const result = await store.failMidTransaction(client, { runId: 'crash-1', nowMs: now });
  const left = await client.query("SELECT id FROM leader_runs WHERE id='crash-1'");
  const ok = result.rolledBack === true && left.rows.length === 0;
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'mid-transaction-rollback';
}

async function caseRestart(dbUrl, now) {
  const Client = require('pg').Client;
  const first = new Client({ connectionString: dbUrl });
  await first.connect();
  await reset(first);
  await office(first, 'US', 'guardian', 'v-restart');
  await store.seedRepresentative(first, { country: 'US', territory: 'guardian', personId: 'rep-r' });
  await first.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-restart', 'office:US:guardian', 'US', 'guardian', 'v-restart', 'filing', $1, $2)`,
    [now, now + store.FILING_MS]
  );
  const filed = await store.fileCandidacy(first, { country: 'US', territory: 'guardian', personId: 'rep-r', nowMs: now });
  await first.end();
  const second = new Client({ connectionString: dbUrl });
  await second.connect();
  const rows = await second.query("SELECT person_id FROM leader_candidacies WHERE round_id='round-restart'");
  await second.end();
  const ok = filed.ok === true && rows.rows.length === 1 && rows.rows[0].person_id === 'rep-r';
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'restart-matches-commit';
}

async function caseTieZero(client, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'v-tie');
  await office(client, 'KR', 'guardian', 'v-zero');
  await office(client, 'US', 'pioneer', 'v-halt');
  await office(client, 'US', 'guardian', 'v-error');
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES
      ('round-tie', 'office:KR:pioneer', 'KR', 'pioneer', 'v-tie', 'vote', $1, $1),
      ('round-zero', 'office:KR:guardian', 'KR', 'guardian', 'v-zero', 'vote', $1, $1),
      ('round-halt', 'office:US:pioneer', 'US', 'pioneer', 'v-halt', 'vote', $1, $1),
      ('round-error', 'office:US:guardian', 'US', 'guardian', 'v-error', 'vote', $1, $1)`,
    [now]
  );
  await client.query(
    `INSERT INTO leader_candidacies (id, round_id, person_id, country, territory, filed_at_ms) VALUES
      ('c-ta', 'round-tie', 'rep-a', 'KR', 'pioneer', $1),
      ('c-tb', 'round-tie', 'rep-b', 'KR', 'pioneer', $1),
      ('c-za', 'round-zero', 'rep-a', 'KR', 'guardian', $1),
      ('c-zb', 'round-zero', 'rep-b', 'KR', 'guardian', $1)`,
    [now]
  );
  await client.query(
    `INSERT INTO leader_ballots (id, round_id, country, territory, status, starts_at_ms, ends_at_ms) VALUES
      ('ballot-tie', 'round-tie', 'KR', 'pioneer', 'open', $1, $2),
      ('ballot-zero', 'round-zero', 'KR', 'guardian', 'open', $1, $2)`,
    [now, now + store.VOTE_MS]
  );
  await client.query(
    `INSERT INTO leader_casts (ballot_id, voter_id, choice, at_ms) VALUES
      ('ballot-tie', 'v1', 'rep-a', $1),
      ('ballot-tie', 'v2', 'rep-b', $1)`,
    [now + 1]
  );
  const ended = now + store.VOTE_MS;
  const tie = await store.resolveRound(client, { roundId: 'round-tie', nowMs: ended });
  const zero = await store.resolveRound(client, { roundId: 'round-zero', nowMs: ended });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-none', 'office:KR:pioneer', 'KR', 'pioneer', 'v-tie', 'filing', $1, $1)`,
    [ended]
  );
  const none = await store.resolveRound(client, { roundId: 'round-none', nowMs: ended });
  const halted = await store.resolveRound(client, { roundId: 'round-halt', nowMs: ended, outcome: 'halted' });
  const errored = await store.resolveRound(client, { roundId: 'round-error', nowMs: ended, outcome: 'error' });
  const tieRow = await store.readRound(client, 'round-tie');
  const zeroRow = await store.readRound(client, 'round-zero');
  const noneRow = await store.readRound(client, 'round-none');
  const haltRow = await store.readRound(client, 'round-halt');
  const errorRow = await store.readRound(client, 'round-error');
  const appointments = await client.query('SELECT id FROM leader_appointments');
  const ok = tie.result === 'TIE' && zero.result === 'ZERO_VOTES'
    && tie.result !== zero.result
    && Number(tieRow.next_refiling_at_ms) === ended + store.REFILE_MS
    && Number(zeroRow.next_refiling_at_ms) === ended + store.REFILE_MS
    && none.result === 'no_candidates'
    && Number(noneRow.next_refiling_at_ms) === ended + store.REFILE_MS
    && haltRow.next_refiling_at_ms == null
    && errorRow.next_refiling_at_ms == null
    && halted.appointed !== true
    && errored.appointed !== true
    && appointments.rows.length === 0;
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'tie-and-zero-votes-refile';
}

async function caseCleared(client, now) {
  await reset(client);
  await office(client, 'KR', 'guardian', 'v0');
  await client.query("UPDATE leader_offices SET leader_id='rep-old' WHERE country='KR' AND territory='guardian'");
  const removed = await store.removeOffice(client, {
    country: 'KR', territory: 'guardian', reason: 'OFFICE_CLEARED', nowMs: now,
  });
  const row = await client.query("SELECT reason, rank_after, keep_xp, keep_fame, keep_achievements FROM leader_removals");
  const officeRow = await store.readOffice(client, 'KR', 'guardian');
  const ok = removed.normalRemoval === true && row.rows[0].reason === 'OFFICE_CLEARED'
    && row.rows[0].rank_after === 'citizen'
    && row.rows[0].keep_xp === true && row.rows[0].keep_fame === true && row.rows[0].keep_achievements === true
    && officeRow.leader_id == null;
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'office-cleared-normal-removal';
}

async function caseSeparate(client, dbUrl, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'vk');
  await office(client, 'US', 'pioneer', 'vu');
  await office(client, 'KR', 'guardian', 'vg');
  await office(client, 'US', 'guardian', 'vug');
  await store.seedRepresentative(client, { country: 'KR', territory: 'pioneer', personId: 'rep-k' });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-kr', 'office:KR:pioneer', 'KR', 'pioneer', 'vk', 'filing', $1, $2)`,
    [now, now + store.FILING_MS]
  );
  await worker(dbUrl, 'fileCandidacy', { country: 'KR', territory: 'pioneer', personId: 'rep-k', nowMs: now });
  const rows = await client.query('SELECT country, territory FROM leader_candidacies');
  const offices = await client.query('SELECT country, territory, leader_id FROM leader_offices ORDER BY country, territory');
  const ok = rows.rows.length === 1 && rows.rows[0].country === 'KR' && rows.rows[0].territory === 'pioneer'
    && offices.rows.length === 4
    && offices.rows.every(function (row) { return row.leader_id == null; });
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'country-territory-separate';
}

async function caseTick(client, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'v-tick');
  await people(client, 'KR', 'pioneer', 1000, now);
  await client.query(
    `INSERT INTO leader_schedules
      (id, office_id, country, territory, vacancy_id, removed_at_ms, vacancy_ends_at_ms, filing_ends_at_ms)
     VALUES ('sched-tick', 'office:KR:pioneer', 'KR', 'pioneer', 'v-tick', $1, $1, $2)`,
    [now - store.VACANT_MS, now + store.FILING_MS]
  );
  const first = await store.tick(client, { nowMs: now });
  const second = await store.tick(client, { nowMs: now });
  const rounds = await client.query("SELECT id FROM leader_filing_rounds WHERE status='filing'");
  const opened = first.steps.filter(function (step) { return step.opened === true; }).length;
  const again = second.steps.filter(function (step) { return step.opened === true; }).length;
  const ok = opened === 1 && again === 0 && rounds.rows.length === 1;
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'repeated-tick-one-round';
}

async function caseMissing(client, now) {
  await reset(client);
  await office(client, 'KR', 'pioneer', 'v-miss');
  await client.query(
    `INSERT INTO leader_schedules
      (id, office_id, country, territory, vacancy_id, removed_at_ms, vacancy_ends_at_ms, filing_ends_at_ms)
     VALUES ('sched-miss', 'office:KR:pioneer', 'KR', 'pioneer', 'v-miss', $1, $1, $2)`,
    [now - store.VACANT_MS, now + store.FILING_MS]
  );
  const ticked = await store.tick(client, { nowMs: now, populationCount: 1000, population: { count: 1000 } });
  const invented = await store.seedPopulation(client, { country: 'KR', territory: 'pioneer', populationCount: 5000, people: [] });
  await client.query(
    `INSERT INTO leader_filing_rounds
      (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
     VALUES ('round-miss', 'office:KR:pioneer', 'KR', 'pioneer', 'v-miss', 'filing', $1, $2)`,
    [now, now + store.FILING_MS]
  );
  const filed = await store.fileCandidacy(client, {
    country: 'KR', territory: 'pioneer', personId: 'ghost', nowMs: now, isRepresentative: true,
  });
  const rounds = await client.query("SELECT id FROM leader_filing_rounds WHERE id LIKE 'tick:%'");
  const candidacies = await client.query('SELECT id FROM leader_candidacies');
  const population = await client.query('SELECT id FROM leader_population_records');
  const ok = ticked.steps[0].reason === 'POPULATION_NOT_STORED'
    && invented.reason === 'CLIENT_POPULATION_IGNORED'
    && filed.reason === 'REPRESENTATIVE_STATUS_MISSING'
    && rounds.rows.length === 0
    && candidacies.rows.length === 0
    && population.rows.length === 0;
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'missing-population-and-representative';
}

async function caseCap(client, now) {
  await reset(client);
  await office(client, 'US', 'guardian', 'v-cap');
  const reasons = [];
  for (let i = 1; i <= 11; i += 1) {
    const seeded = await store.seedRepresentative(client, { country: 'US', territory: 'guardian', personId: 'seat-' + i });
    reasons.push(seeded.reason || 'stored');
  }
  await client.query("UPDATE leader_offices SET leader_id='seat-1', vacancy_id=NULL WHERE country='US' AND territory='guardian'");
  await client.query("DELETE FROM leader_representative_seats WHERE person_id='seat-1'");
  const putBack = await store.seedRepresentative(client, { country: 'US', territory: 'guardian', personId: 'seat-1' });
  const seats = await client.query("SELECT person_id FROM leader_representative_seats WHERE country='US' AND territory='guardian'");
  const officeRow = await store.readOffice(client, 'US', 'guardian');
  const ok = reasons.slice(0, 10).every(function (reason) { return reason === 'stored'; })
    && reasons[10] === 'REPRESENTATIVE_CAP'
    && putBack.reason === 'LEADER_OUTSIDE_CAP'
    && seats.rows.length === 9
    && officeRow.leader_id === 'seat-1'
    && !seats.rows.some(function (row) { return row.person_id === 'seat-1'; });
  return (ok ? 'VERIFIED ' : 'FAIL ') + 'representative-cap-and-leader-outside';
}

main();
