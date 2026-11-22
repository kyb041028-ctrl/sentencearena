'use strict';
/**
 * 격리 Postgres에서 계급 산식 20항목만 확인한다.
 * 운영 데이터베이스와 원격 회원은 쓰지 않는다.
 * node tools/test-rank-formula.js
 */
const formula = require('../shared/rank-formula-core');
const store = require('../server/leader-election-pg-store');

const DAY = formula.DAY_MS;

function line(ok, name) {
  return (ok ? 'VERIFIED ' : 'FAIL ') + name;
}

async function wednesdayMs() {
  var ms = Date.UTC(2026, 10, 10, 15, 0, 0);
  var i;
  for (i = 0; i < 14; i += 1) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
    ms += DAY;
  }
  throw new Error('wednesday not found');
}

async function main() {
  const requested = 'postgres://127.0.0.1:5432/postgres';
  let Client;
  try { Client = require('pg').Client; }
  catch (err) {
    process.stdout.write('NOT RUN rank-formula: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN rank-formula: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_formula_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  const lines = [];
  let client;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    const asOf = await wednesdayMs();
    const old = asOf - (90 * DAY) - 1;
    const inside = asOf - (90 * DAY);

    async function member(country, territory, id, fame, rankName, elected, evaluators) {
      await client.query(
        `INSERT INTO leader_rank_members
          (country, territory, person_id, fame, rank, elected_leader, valid, unique_positive_evaluators)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
        [country, territory, id, fame, rankName, elected === true, evaluators]
      );
    }

    lines.push(line((await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
    })).reason === 'SOURCE_MISSING', '1-reaction-source-missing'));

    await client.query(
      `INSERT INTO leader_rank_source_flags (country, territory, reactions_connected, follows_connected)
       VALUES ('KR','pioneer',true,false)`
    );
    lines.push(line((await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
    })).reason === 'SOURCE_MISSING', '2-follow-source-missing'));

    await client.query(
      `UPDATE leader_rank_source_flags SET follows_connected=true WHERE country='KR' AND territory='pioneer'`
    );
    lines.push(line((await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
    })).reason === 'QUALIFICATION_SOURCE_MISSING', '3-population-source-missing'));

    await client.query(
      `INSERT INTO leader_rank_scopes (country, territory, territory_population) VALUES ('KR','pioneer',100)`
    );
    lines.push(line((await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf, comparisonScore: 99,
    })).reason === 'CLIENT_RANK_IGNORED', '4-client-score-rejected'));
    lines.push(line((await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf, clientWeekday: 'WEDNESDAY',
    })).reason === 'CLIENT_RANK_IGNORED', '5-client-clock-rejected'));
    lines.push(line((await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf + 60 * 60 * 1000,
    })).reason === 'NOT_REFRESH_MOMENT', '6-not-seoul-wednesday'));
    lines.push(line((await store.applyRankFormula(client, {
      country: 'US', territory: 'pioneer', asOfMs: asOf, auto: true,
    })).reason === 'NOT_REFRESH_MOMENT', '7-us-seoul-midnight-is-not-new-york'));

    await member('KR', 'pioneer', 'low', -8, 'citizen', false, 0);
    await member('KR', 'pioneer', 'mid', 10, 'citizen', false, 0);
    await member('KR', 'pioneer', 'high', 100, 'citizen', false, 0);
    await member('KR', 'pioneer', 'zero', 0, 'citizen', false, 0);
    await member('KR', 'pioneer', 'boss', 1, 'leader', true, 0);
    await member('US', 'pioneer', 'us-person', 999, 'citizen', false, 0);
    await client.query(
      `INSERT INTO leader_rank_reactions (id, country, territory, actor_id, target_id, polarity, at_ms)
       VALUES
        ('r1','KR','pioneer','eva','mid',1,$1),
        ('r2','KR','pioneer','eva','mid',-1,$2),
        ('r3','KR','pioneer','mid','mid',1,$1),
        ('r4','KR','pioneer','old','mid',1,$3),
        ('r5','KR','pioneer','gone','high',1,$1)`,
      [inside, asOf - 1000, old]
    );
    await client.query(`UPDATE leader_rank_reactions SET cancelled_at_ms=$1 WHERE id='r5'`, [asOf]);
    await client.query(
      `INSERT INTO leader_rank_reactions (id, country, territory, actor_id, target_id, polarity, at_ms, invalid)
       VALUES ('r6','KR','pioneer','bad','high',1,$1,true)`,
      [inside]
    );
    await client.query(
      `INSERT INTO leader_rank_follows (id, country, territory, follower_id, target_id, at_ms)
       VALUES
        ('f1','KR','pioneer','fan','high',$1),
        ('f2','KR','pioneer','fan','high',$1),
        ('f3','KR','pioneer','high','high',$1),
        ('f4','KR','pioneer','oldfan','high',$2)`,
      [inside, old]
    );
    await client.query(
      `INSERT INTO leader_rank_follows (id, country, territory, follower_id, target_id, at_ms, cancelled_at_ms)
       VALUES ('f5','KR','pioneer','quit','high',$1,$1)`,
      [inside]
    );
    await client.query(
      `INSERT INTO leader_offices (id, country, territory, leader_id) VALUES ('office-kr-pioneer','KR','pioneer',NULL)
       ON CONFLICT (country, territory) DO NOTHING`
    );

    const blocked = await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
    });
    const fameBefore = await client.query(
      `SELECT person_id, fame, rank FROM leader_rank_members WHERE country='KR' AND territory='pioneer' AND person_id='mid'`
    );
    const roundBefore = await client.query(
      `SELECT count(*)::int AS n FROM leader_rank_rounds WHERE country='KR' AND territory='pioneer'`
    );
    lines.push(line(
      blocked.applied === false && blocked.reason === 'FAME_OVERLAP_UNCONFIRMED' &&
      Number(fameBefore.rows[0].fame) === 10 && fameBefore.rows[0].rank === 'citizen' && roundBefore.rows[0].n === 0,
      '8a-missing-fame-overlap-does-not-promote'
    ));
    await client.query(`UPDATE leader_rank_reactions SET fame_delta=0 WHERE country='KR' AND territory='pioneer'`);

    const applied = await store.applyRankFormula(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
    });
    const rows = await client.query(
      `SELECT person_id, fame, rank, comparison_score, elected_leader FROM leader_rank_members
       WHERE country='KR' AND territory='pioneer' ORDER BY person_id`
    );
    const byId = Object.create(null);
    rows.rows.forEach(function (row) { byId[row.person_id] = row; });
    const expected = formula.scoreCohort({
      country: 'KR',
      territory: 'pioneer',
      asOfMs: asOf,
      members: rows.rows.map(function (row) {
        return { id: row.person_id, fame: row.fame, country: 'KR', territory: 'pioneer' };
      }),
      reactions: (await client.query(`SELECT * FROM leader_rank_reactions WHERE country='KR' AND territory='pioneer'`)).rows,
      follows: (await client.query(`SELECT * FROM leader_rank_follows WHERE country='KR' AND territory='pioneer'`)).rows,
    });
    const mid = expected.members.filter(function (row) { return row.id === 'mid'; })[0];
    const high = expected.members.filter(function (row) { return row.id === 'high'; })[0];
    const low = expected.members.filter(function (row) { return row.id === 'low'; })[0];
    lines.push(line(applied.applied === true && applied.formulaStatus === 'FORMULA_CONFIRMED' && mid && mid.d === 1 && mid.e === 0 && mid.r === 10, '8-evaluator-once-self-cancel-old-excluded'));
    lines.push(line(low && low.r === 0 && low.e === 0 && high && high.f === 2 && high.r === 100 && Number(byId.high.fame) === 100, '9-negative-fame-zero-and-follow-at-evaluation'));
    const us = await client.query(`SELECT comparison_score FROM leader_rank_members WHERE person_id='us-person'`);
    lines.push(line(us.rows[0].comparison_score == null, '10-kr-refresh-does-not-touch-us'));
    const zero = expected.members.filter(function (row) { return row.id === 'zero'; })[0];
    lines.push(line(low && zero && low.nr === zero.nr && high.nr === 100 && mid.nd === 100 && low.nr !== high.nr, '11-same-value-same-percentile'));
    const storedMatch = expected.members.every(function (row) {
      return Number(byId[row.id].comparison_score).toFixed(4) === row.storedScore.toFixed(4);
    });
    lines.push(line(storedMatch && high.combined === high.nr * 0.45 + high.nd * 0.3 + high.ne * 0.15 + high.nf * 0.1, '12-stored-four-decimals-no-fame-bonus'));
    lines.push(line(byId.boss.rank === 'leader' && byId.boss.elected_leader === true && byId.high.rank === 'citizen', '13-leader-kept-score-does-not-appoint'));
    const office = await client.query(`SELECT leader_id FROM leader_offices WHERE country='KR' AND territory='pioneer'`);
    const seats = await client.query(`SELECT count(*)::int AS n FROM leader_representative_seats WHERE country='KR' AND territory='pioneer'`);
    lines.push(line((!office.rows[0] || office.leader_id == null) && seats.rows[0].n === 0, '14-office-and-seats-unchanged'));
    const again = await store.applyRankFormula(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    lines.push(line(again.reason === 'ROUND_ALREADY_APPLIED', '15-same-round-once'));

    await client.query(
      `INSERT INTO leader_rank_scopes (country, territory, territory_population) VALUES ('KR','central',100)`
    );
    await client.query(
      `INSERT INTO leader_rank_source_flags (country, territory, reactions_connected, follows_connected)
       VALUES ('KR','central',true,true)`
    );
    await member('KR', 'central', 'keep', 20, 'debater', false, 10);
    await member('KR', 'central', 'same-b', 20, 'citizen', false, 10);
    await member('KR', 'central', 'same-c', 20, 'citizen', false, 10);
    await member('KR', 'central', 'same-d', 20, 'citizen', false, 10);
    const tied = await store.applyRankFormula(client, { country: 'KR', territory: 'central', asOfMs: asOf });
    const tieRows = await client.query(
      `SELECT person_id, rank, comparison_score FROM leader_rank_members WHERE country='KR' AND territory='central' ORDER BY person_id`
    );
    const debaters = tieRows.rows.filter(function (row) { return row.rank === 'debater'; });
    const scores = tieRows.rows.map(function (row) { return Number(row.comparison_score); });
    lines.push(line(tied.applied === true && scores.every(function (score) { return score === scores[0]; }) && debaters.length === 1 && debaters[0].person_id === 'keep', '16-tie-keeps-existing-rank'));

    await client.query(
      `INSERT INTO leader_rank_scopes (country, territory, territory_population) VALUES ('KR','guardian',100)`
    );
    await client.query(
      `INSERT INTO leader_rank_source_flags (country, territory, reactions_connected, follows_connected)
       VALUES ('KR','guardian',true,true)`
    );
    await member('KR', 'guardian', 'g1', 5, 'citizen', false, 0);
    const rolled = await store.applyRankFormula(client, {
      country: 'KR', territory: 'guardian', asOfMs: asOf, failAfterScore: true,
    });
    const afterRoll = await client.query(
      `SELECT comparison_score, rank FROM leader_rank_members WHERE person_id='g1'`
    );
    const roundLeft = await client.query(
      `SELECT count(*)::int AS n FROM leader_rank_rounds WHERE country='KR' AND territory='guardian'`
    );
    lines.push(line(rolled.applied === false && afterRoll.rows[0].comparison_score == null && afterRoll.rows[0].rank === 'citizen' && roundLeft.rows[0].n === 0, '17-rollback-score-rank-round'));

    const other = new Client({ connectionString: dbUrl });
    await other.connect();
    const pair = await Promise.all([
      store.applyRankFormula(client, { country: 'KR', territory: 'guardian', asOfMs: asOf }),
      store.applyRankFormula(other, { country: 'KR', territory: 'guardian', asOfMs: asOf }),
    ]);
    await other.end();
    const wins = pair.filter(function (row) { return row.applied === true; }).length;
    const blocks = pair.filter(function (row) { return row.reason === 'ROUND_ALREADY_APPLIED'; }).length;
    const roundCount = await client.query(
      `SELECT count(*)::int AS n FROM leader_rank_rounds WHERE country='KR' AND territory='guardian'`
    );
    lines.push(line(wins === 1 && blocks === 1 && roundCount.rows[0].n === 1, '18-concurrent-refresh-once'));

    const noPositive = formula.scoreCohort({
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
      members: [{ id: 'a', fame: 0, country: 'KR', territory: 'pioneer' }],
      reactions: [], follows: [],
    });
    lines.push(line(noPositive.ok === true && noPositive.members[0].nr === 100 && noPositive.members[0].storedScore === 100, '19-single-member-percentile'));
    const missing = formula.scoreCohort({
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
      members: [{ id: 'a', fame: 0, country: 'KR', territory: 'pioneer' }],
      follows: [],
    });
    lines.push(line(missing.ok === false && missing.reason === 'REACTION_SOURCE_MISSING', '20-missing-source-is-not-zero'));
    const overlap = formula.scoreCohort({
      country: 'KR', territory: 'guardian', asOfMs: asOf,
      members: [
        { id: 'rich', fame: 80, country: 'KR', territory: 'guardian' },
        { id: 'plain', fame: 80, country: 'KR', territory: 'guardian' },
      ],
      reactions: [
        { actor_id: 'eva', target_id: 'rich', polarity: 1, at_ms: inside, fame_delta: 30 },
        { actor_id: 'eva', target_id: 'rich', polarity: 1, at_ms: asOf - 1000, fame_delta: 5 },
        { actor_id: 'other', target_id: 'plain', polarity: 1, at_ms: inside, fame_delta: 0 },
        { actor_id: 'foreign', target_id: 'rich', polarity: 1, at_ms: inside, fame_delta: 99, country: 'US', territory: 'pioneer' },
        { actor_id: 'stale', target_id: 'rich', polarity: 1, at_ms: old, fame_delta: 40 },
      ],
      follows: [
        { follower_id: 'fan', target_id: 'rich', at_ms: old },
      ],
    });
    const rich = overlap.members.filter(function (row) { return row.id === 'rich'; })[0];
    const plain = overlap.members.filter(function (row) { return row.id === 'plain'; })[0];
    lines.push(line(
      overlap.ok === true && rich.storedFame === 80 && rich.r === 45 && rich.d === 1 && rich.e === 2 && rich.f === 1 && plain.r === 80 && plain.nr !== rich.nr,
      '21-deduct-confirmed-fame-overlap-keep-stored-fame'
    ));
    const unknown = formula.scoreCohort({
      country: 'KR', territory: 'guardian', asOfMs: asOf,
      members: [{ id: 'rich', fame: 80, country: 'KR', territory: 'guardian' }],
      reactions: [{ actor_id: 'eva', target_id: 'rich', polarity: 1, at_ms: inside }],
      follows: [],
    });
    lines.push(line(unknown.ok === false && unknown.applied === false && unknown.reason === 'FAME_OVERLAP_UNCONFIRMED', '22-unknown-overlap-is-not-zero'));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (client) {
      try { await client.end(); } catch (_e) { /* 닫기 */ }
    }
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
      await admin.query('DROP DATABASE IF EXISTS ' + dbName);
    } catch (_drop) { /* 격리 DB만 지우려다 실패한 경우 */ }
    try { await admin.end(); } catch (_e) { /* 닫기 */ }
  }
  const failed = lines.some(function (row) { return row.indexOf('FAIL') === 0; });
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write(failed ? 'RESULT FAIL\n' : 'RESULT PASS\n');
  process.exit(failed ? 1 : 0);
}

main();
