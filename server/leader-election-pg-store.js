/**
 * 개발용 지도자 선거 Postgres 저장.
 * 운영 데이터베이스에 붙지 않는다. 호출자가 고립된 연결을 넘긴다.
 * 대표 여부와 인구는 이 저장의 서버 표만 본다. 요청 본문의 깃발과 인원수는 쓰지 않는다.
 * JSON 회귀 테스트의 파일 저장은 이 모듈을 거치지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const rank = require('../shared/dec023-rank-evaluation-core');
const formula = require('../shared/rank-formula-core');
const memberLink = require('./leader-election-member-link');
const filing = require('./leader-filing-service');
const runService = require('./by-election-run-service');
const vote = require('../shared/vote-engine-core');

const DAY_MS = runService.DAY_MS;
const VACANT_MS = filing.POST_IMPEACHMENT_SCHEDULE.vacantDays * DAY_MS;
const FILING_MS = filing.POST_IMPEACHMENT_SCHEDULE.filingDays * DAY_MS;
const VOTE_MS = vote.KINDS.leader_election_48h.durationMs;
const REFILE_MS = runService.REFILING_MS;
const REP_MS = vote.KINDS.representative_impeachment_24h.durationMs;
const CITIZEN_MS = 48 * vote.HOUR_MS;
const BLOCK_MS = filing.REPROPOSAL_BLOCK_MS;
const SQL_PATH = path.join(__dirname, '..', 'supabase', 'migration_leader_election_store_candidate_v1.sql');

function reasonFrom(err) {
  const constraint = String((err && err.constraint) || '');
  const message = String((err && err.message) || '');
  if (err && err.code === '23505') {
    if (constraint.indexOf('leader_candidacies') === 0) return 'DUPLICATE_CANDIDACY';
    if (constraint.indexOf('leader_appointments') === 0) return 'APPOINTMENT_EXISTS';
    if (constraint.indexOf('leader_casts') === 0 || constraint.indexOf('leader_impeachment_votes') === 0) return 'DUPLICATE_VOTE';
    if (constraint === 'leader_one_open_round') return 'FILING_ROUND_OPEN';
    if (constraint.indexOf('leader_runs') === 0) return 'TICK_ALREADY_APPLIED';
    if (constraint.indexOf('leader_rank_one_leader') >= 0) return 'LEADER_EXISTS';
    return 'UNIQUE_CONFLICT';
  }
  if (message.indexOf('OLD_ROUND') >= 0) return 'OLD_ROUND';
  if (message.indexOf('LEADER_EXISTS') >= 0) return 'LEADER_EXISTS';
  if (message.indexOf('REPRESENTATIVE_CAP') >= 0) return 'REPRESENTATIVE_CAP';
  if (message.indexOf('LEADER_OUTSIDE_CAP') >= 0) return 'LEADER_OUTSIDE_CAP';
  if (message.indexOf('NOT_REPRESENTATIVE') >= 0) return 'NOT_REPRESENTATIVE';
  if (message.indexOf('NOT_APPOINTABLE') >= 0) return 'NOT_APPOINTABLE';
  if (message.indexOf('OFFICE_MISSING') >= 0) return 'OFFICE_MISSING';
  return 'STORE_ERROR';
}

async function rollback(client) {
  try { await client.query('ROLLBACK'); } catch (err) { /* already ended */ }
}

async function applyMigration(client) {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  await client.query(sql);
  return { ok: true, applied: true, production: false };
}

async function ensureOffice(client, input) {
  const src = input || {};
  await client.query(
    `INSERT INTO leader_offices (id, country, territory, leader_id, vacancy_id)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT (country, territory) DO NOTHING`,
    [src.id, src.country, src.territory, src.vacancyId || null]
  );
  return readOffice(client, src.country, src.territory);
}

async function readOffice(client, country, territory) {
  const found = await client.query(
    'SELECT id, country, territory, leader_id, vacancy_id FROM leader_offices WHERE country=$1 AND territory=$2',
    [country, territory]
  );
  return found.rows[0] || null;
}

async function seedRepresentative(client, input) {
  const src = input || {};
  if (src.isRepresentative === true || src.isRepresentative === false) {
    return { ok: false, reason: 'CLIENT_REPRESENTATIVE_IGNORED', stored: false };
  }
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO leader_representative_seats (country, territory, person_id) VALUES ($1, $2, $3)`,
      [src.country, src.territory, src.personId]
    );
    await client.query('COMMIT');
    return { ok: true, stored: true };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err), stored: false };
  }
}

async function seedPopulation(client, input) {
  const src = input || {};
  if (src.populationCount != null || src.population != null) {
    return { ok: false, reason: 'CLIENT_POPULATION_IGNORED', stored: false };
  }
  const people = Array.isArray(src.people) ? src.people : [];
  if (!people.length) return { ok: false, reason: 'POPULATION_NOT_STORED', stored: false };
  await client.query('BEGIN');
  for (let i = 0; i < people.length; i += 1) {
    const person = people[i];
    await client.query(
      `INSERT INTO leader_population_records
        (id, country, territory, person_id, valid, last_post_at_ms, last_comment_at_ms, source)
       VALUES ($1, $2, $3, $4, true, $5, NULL, 'server-table')
       ON CONFLICT (country, territory, person_id) DO NOTHING`,
      [src.country + ':' + src.territory + ':' + person, src.country, src.territory, person, src.nowMs]
    );
  }
  await client.query('COMMIT');
  return { ok: true, stored: people.length };
}

async function storedPopulation(client, country, territory, nowMs) {
  const found = await client.query(
    `SELECT person_id AS id, country, territory, valid,
            last_post_at_ms AS "lastPostAtMs", last_comment_at_ms AS "lastCommentAtMs"
     FROM leader_population_records
     WHERE country=$1 AND territory=$2 AND source='server-table'`,
    [country, territory]
  );
  if (!found.rows.length) return { ok: false, reason: 'POPULATION_NOT_STORED' };
  const counted = rank.countValidPopulation({
    country: country,
    territory: territory,
    asOfMs: nowMs,
    records: found.rows,
  });
  if (!counted.ok) return { ok: false, reason: counted.reason };
  const gate = rank.leaderElectionOpen(counted.count);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  if (!gate.open) return { ok: false, reason: 'POPULATION_BELOW_1000', count: counted.count };
  return { ok: true, count: counted.count };
}

async function fileCandidacy(client, input) {
  const src = input || {};
  const personId = String(src.personId || '').trim();
  if (!personId) return { ok: false, reason: 'PERSON_REQUIRED', stored: false };
  if (src.country !== 'KR' && src.country !== 'US') return { ok: false, reason: 'COUNTRY_REQUIRED', stored: false };
  if (src.territory !== 'pioneer' && src.territory !== 'guardian') {
    return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE', stored: false };
  }
  try {
    await client.query('BEGIN');
    const office = await client.query(
      'SELECT id, leader_id, vacancy_id FROM leader_offices WHERE country=$1 AND territory=$2 FOR UPDATE',
      [src.country, src.territory]
    );
    if (!office.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'OFFICE_MISSING', stored: false };
    }
    if (src.memberDirectory) {
      const projected = await projectDirectory(client, src.memberDirectory, src.country, src.territory);
      if (!projected.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: projected.reason, stored: false, productionAuth: false };
      }
    } else {
      await applyStoredRankAuthority(client, src.country, src.territory);
    }
    const seat = await client.query(
      'SELECT person_id FROM leader_representative_seats WHERE country=$1 AND territory=$2 AND person_id=$3',
      [src.country, src.territory, personId]
    );
    if (!seat.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'REPRESENTATIVE_STATUS_MISSING', stored: false };
    }
    const round = await client.query(
      `SELECT id, vacancy_id FROM leader_filing_rounds
       WHERE country=$1 AND territory=$2 AND status='filing' FOR UPDATE`,
      [src.country, src.territory]
    );
    if (!round.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'FILING_NOT_OPEN', stored: false };
    }
    if (round.rows[0].vacancy_id !== office.rows[0].vacancy_id) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'OLD_ROUND', stored: false };
    }
    await client.query(
      `INSERT INTO leader_candidacies (id, round_id, person_id, country, territory, filed_at_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [src.candidacyId || (round.rows[0].id + ':' + personId), round.rows[0].id, personId, src.country, src.territory, Number(src.nowMs)]
    );
    await client.query('COMMIT');
    return { ok: true, stored: true, roundId: round.rows[0].id, productionAuth: false };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err), stored: false, productionAuth: false };
  }
}

async function projectDirectory(client, directory, country, territory) {
  const projected = memberLink.project(directory, country, territory);
  if (!projected.ok) return projected;
  await client.query(
    'DELETE FROM leader_representative_seats WHERE country=$1 AND territory=$2',
    [country, territory]
  );
  for (let i = 0; i < projected.representativeIds.length; i += 1) {
    await client.query(
      'INSERT INTO leader_representative_seats (country, territory, person_id) VALUES ($1, $2, $3)',
      [country, territory, projected.representativeIds[i]]
    );
  }
  await client.query(
    'DELETE FROM leader_population_records WHERE country=$1 AND territory=$2',
    [country, territory]
  );
  for (let i = 0; i < projected.populationRecords.length; i += 1) {
    const person = projected.populationRecords[i];
    await client.query(
      `INSERT INTO leader_population_records
        (id, country, territory, person_id, valid, last_post_at_ms, last_comment_at_ms, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'server-table')`,
      [
        country + ':' + territory + ':' + person.id,
        country,
        territory,
        person.id,
        person.valid === true,
        person.lastPostAtMs,
        person.lastCommentAtMs,
      ]
    );
  }
  return projected;
}

async function castVote(client, input) {
  const src = input || {};
  const session = memberLink.sessionVoter(src);
  if (!session.ok) return session;
  const voterId = session.voterId;
  const choice = String(src.choice || '').trim();
  if (!voterId || !choice) return { ok: false, reason: 'VOTE_REQUIRED', stored: false };
  try {
    await client.query('BEGIN');
    const ballot = await client.query(
      'SELECT id, country, territory, status, starts_at_ms, ends_at_ms FROM leader_ballots WHERE id=$1 FOR UPDATE',
      [src.ballotId]
    );
    const row = ballot.rows[0];
    if (!row || row.status !== 'open') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'BALLOT_NOT_OPEN', stored: false };
    }
    const nowMs = Number(src.nowMs);
    if (!(nowMs >= Number(row.starts_at_ms) && nowMs < Number(row.ends_at_ms))) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'VOTE_WINDOW', stored: false };
    }
    if (Number(row.ends_at_ms) - Number(row.starts_at_ms) !== VOTE_MS) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'VOTE_KIND_MISMATCH', stored: false };
    }
    if (src.memberDirectory) {
      const allowed = memberLink.voterStatus(src.memberDirectory, {
        country: row.country,
        territory: row.territory,
        personId: voterId,
        nowMs: nowMs,
      });
      if (!allowed.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: allowed.reason, stored: false, productionAuth: false };
      }
    }
    await client.query(
      'INSERT INTO leader_casts (ballot_id, voter_id, choice, at_ms) VALUES ($1, $2, $3, $4)',
      [row.id, voterId, choice, nowMs]
    );
    await client.query('COMMIT');
    return { ok: true, stored: true, choice: choice };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err), stored: false };
  }
}

function tally(rows) {
  const counts = Object.create(null);
  rows.forEach(function (row) {
    counts[row.choice] = (counts[row.choice] || 0) + 1;
  });
  const names = Object.keys(counts);
  if (!names.length) return { result: 'ZERO_VOTES', winner: null };
  names.sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  if (names.length >= 2 && counts[names[0]] === counts[names[1]]) return { result: 'TIE', winner: null };
  return { result: 'plurality', winner: names[0] };
}

async function finishWithoutAppointment(client, round, result, endedAtMs) {
  const refile = result === 'TIE' || result === 'ZERO_VOTES' || result === 'no_candidates';
  const next = refile ? Number(endedAtMs) + REFILE_MS : null;
  await client.query(
    `UPDATE leader_filing_rounds
     SET status='closed', result=$2, ended_at_ms=$3, next_refiling_at_ms=$4
     WHERE id=$1`,
    [round.id, result, endedAtMs, next]
  );
  if (result === 'halted' || result === 'error') {
    await client.query(
      `UPDATE leader_ballots SET status=$2, result=$2 WHERE round_id=$1`,
      [round.id, result]
    );
  } else if (result === 'TIE' || result === 'ZERO_VOTES') {
    await client.query(
      `UPDATE leader_ballots SET status='closed', result=$2 WHERE round_id=$1`,
      [round.id, result]
    );
  }
  return { ok: true, appointed: false, result: result, nextRefilingAtMs: next };
}

async function writeAppointment(client, round, personId, atMs) {
  await client.query(
    `INSERT INTO leader_appointments (id, filing_round_id, office_id, vacancy_id, person_id, at_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['appt:' + round.id, round.id, round.office_id, round.vacancy_id, personId, atMs]
  );
  await client.query(
    'DELETE FROM leader_representative_seats WHERE country=$1 AND territory=$2 AND person_id=$3',
    [round.country, round.territory, personId]
  );
  await client.query(
    `UPDATE leader_offices SET leader_id=$2, vacancy_id=NULL WHERE id=$1`,
    [round.office_id, personId]
  );
  await syncStoredRank(client, round.country, round.territory, personId, 'leader');
  await client.query(
    `UPDATE leader_filing_rounds SET status='closed', ended_at_ms=$2 WHERE id=$1`,
    [round.id, atMs]
  );
}

async function resolveRound(client, input) {
  const src = input || {};
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, office_id, country, territory, vacancy_id, status, filing_ends_at_ms, result
       FROM leader_filing_rounds WHERE id=$1 FOR UPDATE`,
      [src.roundId]
    );
    const round = found.rows[0];
    if (!round) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'ROUND_NOT_FOUND', appointed: false };
    }
    const office = await client.query(
      'SELECT id, leader_id, vacancy_id FROM leader_offices WHERE id=$1 FOR UPDATE',
      [round.office_id]
    );
    if (!office.rows[0] || office.rows[0].vacancy_id !== round.vacancy_id) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'OLD_ROUND', appointed: false };
    }
    if (office.rows[0].leader_id) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'LEADER_EXISTS', appointed: false };
    }
    if (src.memberDirectory) {
      const projected = await projectDirectory(client, src.memberDirectory, round.country, round.territory);
      if (!projected.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: projected.reason, appointed: false, productionAuth: false };
      }
    }
    const nowMs = Number(src.nowMs);
    if (src.outcome === 'halted' || src.outcome === 'error') {
      const done = await finishWithoutAppointment(client, round, src.outcome, nowMs);
      await client.query('COMMIT');
      return done;
    }
    const candidates = await client.query(
      'SELECT person_id FROM leader_candidacies WHERE round_id=$1 ORDER BY person_id',
      [round.id]
    );
    if (candidates.rows.length === 0) {
      const done = await finishWithoutAppointment(client, round, 'no_candidates', nowMs);
      await client.query('COMMIT');
      return done;
    }
    if (candidates.rows.length === 1) {
      if (!(nowMs >= Number(round.filing_ends_at_ms))) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'FILING_STILL_OPEN', appointed: false };
      }
      const personId = candidates.rows[0].person_id;
      await client.query(
        `UPDATE leader_filing_rounds SET result='sole' WHERE id=$1`,
        [round.id]
      );
      round.result = 'sole';
      await writeAppointment(client, round, personId, nowMs);
      await client.query('COMMIT');
      return { ok: true, appointed: true, result: 'sole', personId: personId };
    }
    const ballot = await client.query(
      'SELECT id, status, starts_at_ms, ends_at_ms, result FROM leader_ballots WHERE round_id=$1 FOR UPDATE',
      [round.id]
    );
    const box = ballot.rows[0];
    if (!box) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'BALLOT_MISSING', appointed: false };
    }
    if (Number(box.ends_at_ms) - Number(box.starts_at_ms) !== VOTE_MS) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'VOTE_KIND_MISMATCH', appointed: false };
    }
    if (nowMs < Number(box.ends_at_ms)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'VOTE_NOT_ENDED', appointed: false };
    }
    const casts = await client.query('SELECT choice FROM leader_casts WHERE ballot_id=$1', [box.id]);
    const scored = tally(casts.rows);
    if (scored.result !== 'plurality') {
      const done = await finishWithoutAppointment(client, round, scored.result, nowMs);
      await client.query('COMMIT');
      return done;
    }
    await client.query(`UPDATE leader_filing_rounds SET result='plurality' WHERE id=$1`, [round.id]);
    await client.query(`UPDATE leader_ballots SET status='closed', result='plurality' WHERE id=$1`, [box.id]);
    round.result = 'plurality';
    await writeAppointment(client, round, scored.winner, nowMs);
    await client.query('COMMIT');
    return { ok: true, appointed: true, result: 'plurality', personId: scored.winner };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err), appointed: false, detail: String(err && err.message || err) };
  }
}

async function openBallot(client, input) {
  const src = input || {};
  const starts = Number(src.nowMs);
  try {
    await client.query('BEGIN');
    const round = await client.query(
      `SELECT id, country, territory FROM leader_filing_rounds WHERE id=$1 AND status='filing' FOR UPDATE`,
      [src.roundId]
    );
    if (!round.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'FILING_NOT_OPEN' };
    }
    const count = await client.query('SELECT count(*)::int AS n FROM leader_candidacies WHERE round_id=$1', [src.roundId]);
    if (Number(count.rows[0].n) < 2) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NOT_A_VOTE' };
    }
    await client.query(
      `UPDATE leader_filing_rounds SET status='vote' WHERE id=$1`,
      [src.roundId]
    );
    await client.query(
      `INSERT INTO leader_ballots (id, round_id, country, territory, status, starts_at_ms, ends_at_ms)
       VALUES ($1, $2, $3, $4, 'open', $5, $6)`,
      [src.ballotId || ('ballot:' + src.roundId), src.roundId, round.rows[0].country, round.rows[0].territory, starts, starts + VOTE_MS]
    );
    await client.query('COMMIT');
    return { ok: true, ballotId: src.ballotId || ('ballot:' + src.roundId), endsAtMs: starts + VOTE_MS };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err) };
  }
}

async function openFilingRound(client, input) {
  const src = input || {};
  try {
    await client.query('BEGIN');
    const office = await client.query(
      'SELECT id, country, territory, vacancy_id, leader_id FROM leader_offices WHERE country=$1 AND territory=$2 FOR UPDATE',
      [src.country, src.territory]
    );
    const row = office.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'OFFICE_MISSING', stored: false };
    }
    if (row.leader_id) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'LEADER_EXISTS', stored: false };
    }
    const open = await client.query(
      `SELECT id FROM leader_filing_rounds WHERE country=$1 AND territory=$2 AND status IN ('filing','vote')`,
      [src.country, src.territory]
    );
    if (open.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: true, stored: false, reason: 'FILING_ROUND_OPEN', roundId: open.rows[0].id };
    }
    if (src.memberDirectory) {
      const projected = await projectDirectory(client, src.memberDirectory, src.country, src.territory);
      if (!projected.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: projected.reason, stored: false, productionAuth: false };
      }
    }
    const population = await storedPopulation(client, src.country, src.territory, src.nowMs);
    if (!population.ok) {
      await client.query('ROLLBACK');
      return { ok: false, reason: population.reason, stored: false };
    }
    const id = src.roundId || ('round:' + src.country + ':' + src.territory + ':' + src.nowMs);
    await client.query(
      `INSERT INTO leader_filing_rounds
        (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
       VALUES ($1, $2, $3, $4, $5, 'filing', $6, $7)`,
      [id, row.id, row.country, row.territory, row.vacancy_id, Number(src.nowMs), Number(src.nowMs) + FILING_MS]
    );
    await client.query('COMMIT');
    return { ok: true, stored: true, roundId: id };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err), stored: false };
  }
}

async function removeOffice(client, input) {
  const src = input || {};
  const reason = src.reason || 'OFFICE_CLEARED';
  try {
    await client.query('BEGIN');
    const office = await client.query(
      'SELECT id, country, territory, leader_id FROM leader_offices WHERE country=$1 AND territory=$2 FOR UPDATE',
      [src.country, src.territory]
    );
    const row = office.rows[0];
    if (!row || !row.leader_id) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'OFFICE_NOT_HELD' };
    }
    const removedAt = Number(src.nowMs);
    const vacancyId = src.vacancyId || ('vacancy:' + row.id + ':' + removedAt);
    await client.query(
      `INSERT INTO leader_removals
        (id, office_id, person_id, reason, rank_after, keep_xp, keep_fame, keep_achievements, removed_at_ms, vacancy_id)
       VALUES ($1, $2, $3, $4, 'citizen', true, true, true, $5, $6)`,
      [src.removalId || ('removal:' + vacancyId), row.id, row.leader_id, reason, removedAt, vacancyId]
    );
    await client.query(
      `INSERT INTO leader_schedules
        (id, office_id, country, territory, vacancy_id, removed_at_ms, vacancy_ends_at_ms, filing_ends_at_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        src.scheduleId || ('schedule:' + vacancyId),
        row.id,
        row.country,
        row.territory,
        vacancyId,
        removedAt,
        removedAt + VACANT_MS,
        removedAt + VACANT_MS + FILING_MS,
      ]
    );
    await client.query(
      'UPDATE leader_offices SET leader_id=NULL, vacancy_id=$2 WHERE id=$1',
      [row.id, vacancyId]
    );
    await syncStoredRank(client, row.country, row.territory, row.leader_id, 'citizen');
    await client.query('COMMIT');
    return {
      ok: true,
      reason: reason,
      rankAfter: 'citizen',
      keepXp: true,
      keepFame: true,
      keepAchievements: true,
      vacancyId: vacancyId,
      normalRemoval: reason === 'OFFICE_CLEARED',
    };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err) };
  }
}

async function tick(client, input) {
  const src = input || {};
  const nowMs = Number(src.nowMs);
  const offices = await client.query('SELECT country, territory FROM leader_offices ORDER BY country, territory');
  const steps = [];
  for (let i = 0; i < offices.rows.length; i += 1) {
    steps.push(await tickOne(client, offices.rows[i].country, offices.rows[i].territory, nowMs, src.memberDirectory));
  }
  return { ok: true, steps: steps, productionScheduler: false };
}

async function tickOne(client, country, territory, nowMs, memberDirectory) {
  try {
    await client.query('BEGIN');
    const office = await client.query(
      'SELECT id, leader_id, vacancy_id FROM leader_offices WHERE country=$1 AND territory=$2 FOR UPDATE',
      [country, territory]
    );
    const row = office.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { country: country, territory: territory, reason: 'OFFICE_MISSING' };
    }
    const open = await client.query(
      `SELECT id FROM leader_filing_rounds WHERE country=$1 AND territory=$2 AND status IN ('filing','vote')`,
      [country, territory]
    );
    if (open.rows[0]) {
      await client.query('ROLLBACK');
      return { country: country, territory: territory, reason: 'FILING_ROUND_OPEN', roundId: open.rows[0].id, opened: false };
    }
    if (row.leader_id) {
      await client.query('ROLLBACK');
      return { country: country, territory: territory, reason: 'LEADER_EXISTS', opened: false };
    }
    const schedule = await client.query(
      `SELECT vacancy_id, vacancy_ends_at_ms, filing_ends_at_ms
       FROM leader_schedules WHERE office_id=$1 AND vacancy_id=$2
       ORDER BY removed_at_ms DESC LIMIT 1`,
      [row.id, row.vacancy_id]
    );
    if (!schedule.rows[0]) {
      await client.query('ROLLBACK');
      return { country: country, territory: territory, reason: 'MISSING_SCHEDULE', opened: false };
    }
    const window = schedule.rows[0];
    if (nowMs < Number(window.vacancy_ends_at_ms)) {
      await client.query('ROLLBACK');
      return { country: country, territory: territory, reason: 'VACANCY_WINDOW', opened: false };
    }
    const previous = await client.query(
      `SELECT next_refiling_at_ms FROM leader_filing_rounds
       WHERE country=$1 AND territory=$2 AND vacancy_id=$3 AND next_refiling_at_ms IS NOT NULL
       ORDER BY ended_at_ms DESC LIMIT 1`,
      [country, territory, row.vacancy_id]
    );
    if (previous.rows[0] && nowMs < Number(previous.rows[0].next_refiling_at_ms)) {
      await client.query('ROLLBACK');
      return { country: country, territory: territory, reason: 'REFILING_TOO_EARLY', opened: false };
    }
    if (memberDirectory) {
      const projected = await projectDirectory(client, memberDirectory, country, territory);
      if (!projected.ok) {
        await client.query('ROLLBACK');
        return { country: country, territory: territory, reason: projected.reason, opened: false, productionAuth: false };
      }
    }
    const population = await storedPopulation(client, country, territory, nowMs);
    if (!population.ok) {
      await client.query('ROLLBACK');
      return { country: country, territory: territory, reason: population.reason, opened: false };
    }
    const roundId = 'tick:' + country + ':' + territory + ':' + row.vacancy_id + ':' + nowMs;
    const tickKey = country + '|' + territory + '|' + row.vacancy_id + '|' + nowMs;
    await client.query(
      `INSERT INTO leader_runs (id, country, territory, tick_key, opened_round_id, at_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['run:' + tickKey, country, territory, tickKey, roundId, nowMs]
    );
    await client.query(
      `INSERT INTO leader_filing_rounds
        (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
       VALUES ($1, $2, $3, $4, $5, 'filing', $6, $7)`,
      [roundId, row.id, country, territory, row.vacancy_id, nowMs, Number(window.filing_ends_at_ms)]
    );
    await client.query('COMMIT');
    return { country: country, territory: territory, reason: 'OPENED', opened: true, roundId: roundId };
  } catch (err) {
    await rollback(client);
    const reason = reasonFrom(err);
    if (reason === 'FILING_ROUND_OPEN' || reason === 'TICK_ALREADY_APPLIED') {
      return { country: country, territory: territory, reason: 'FILING_ROUND_OPEN', opened: false };
    }
    return { country: country, territory: territory, reason: reason, opened: false };
  }
}

async function failMidTransaction(client, input) {
  const src = input || {};
  const id = src.runId || ('crash:' + Date.now());
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO leader_runs (id, country, territory, tick_key, opened_round_id, at_ms)
       VALUES ($1, 'KR', 'pioneer', $2, NULL, $3)`,
      [id, 'crash|' + id, Number(src.nowMs) || 1]
    );
    throw new Error('MID_TRANSACTION');
  } catch (err) {
    await rollback(client);
    const left = await client.query('SELECT id FROM leader_runs WHERE id=$1', [id]);
    return { ok: left.rows.length === 0, rolledBack: left.rows.length === 0, runId: id };
  }
}

async function scheduleRefiling(client, country, territory) {
  const found = await client.query(
    `INSERT INTO leader_schedules
      (id, office_id, country, territory, vacancy_id, removed_at_ms, vacancy_ends_at_ms, filing_ends_at_ms)
     SELECT $1, id, country, territory, vacancy_id, $2, $2, $3
     FROM leader_offices WHERE country=$4 AND territory=$5
     ON CONFLICT (id) DO NOTHING`,
    ['schedule:seed:' + country + ':' + territory, 0, FILING_MS, country, territory]
  );
  return found.rowCount;
}

async function readRound(client, roundId) {
  const found = await client.query(
    `SELECT id, country, territory, status, result, next_refiling_at_ms, vacancy_id, ended_at_ms
     FROM leader_filing_rounds WHERE id=$1`,
    [roundId]
  );
  return found.rows[0] || null;
}

async function counts(client) {
  const tables = [
    'leader_offices', 'leader_removals', 'leader_filing_rounds', 'leader_candidacies',
    'leader_ballots', 'leader_casts', 'leader_appointments', 'leader_runs',
    'leader_representative_seats',
  ];
  const out = {};
  for (let i = 0; i < tables.length; i += 1) {
    const found = await client.query('SELECT count(*)::int AS n FROM ' + tables[i]);
    out[tables[i]] = found.rows[0].n;
  }
  return out;
}

async function proposeImpeachment(client, input) {
  const src = input || {};
  const personId = String(src.personId || '').trim();
  try {
    await client.query('BEGIN');
    const office = await client.query(
      'SELECT id, leader_id FROM leader_offices WHERE country=$1 AND territory=$2 FOR UPDATE',
      [src.country, src.territory]
    );
    if (!office.rows[0] || !office.rows[0].leader_id) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'OFFICE_NOT_HELD' };
    }
    const seat = await client.query(
      'SELECT person_id FROM leader_representative_seats WHERE country=$1 AND territory=$2 AND person_id=$3',
      [src.country, src.territory, personId]
    );
    if (!seat.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'REPRESENTATIVE_STATUS_MISSING' };
    }
    const blocked = await client.query(
      `SELECT id FROM leader_impeachment_blocks
       WHERE country=$1 AND territory=$2 AND leader_id=$3 AND blocked_until_ms > $4`,
      [src.country, src.territory, office.rows[0].leader_id, Number(src.nowMs)]
    );
    if (blocked.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'REPROPOSAL_BLOCKED' };
    }
    const id = src.proposalId || ('impeach:' + office.rows[0].id + ':' + src.nowMs);
    await client.query(
      `INSERT INTO leader_impeachment_proposals
        (id, office_id, country, territory, kind, status, opened_at_ms, ends_at_ms)
       VALUES ($1, $2, $3, $4, 'representative', 'open', $5, $6)`,
      [id, office.rows[0].id, src.country, src.territory, Number(src.nowMs), Number(src.nowMs) + REP_MS]
    );
    await client.query('COMMIT');
    return { ok: true, proposalId: id, endsAtMs: Number(src.nowMs) + REP_MS };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err) };
  }
}

async function castImpeachmentVote(client, input) {
  const src = input || {};
  const session = memberLink.sessionVoter(src);
  if (!session.ok) return session;
  src.voterId = session.voterId;
  try {
    await client.query('BEGIN');
    const proposal = await client.query(
      'SELECT id, country, territory, kind, status, ends_at_ms FROM leader_impeachment_proposals WHERE id=$1 FOR UPDATE',
      [src.proposalId]
    );
    const row = proposal.rows[0];
    if (!row || row.status !== 'open' || Number(src.nowMs) >= Number(row.ends_at_ms)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'VOTE_WINDOW' };
    }
    if (src.memberDirectory && row.kind === 'representative') {
      const rep = memberLink.representativeStatus(src.memberDirectory, {
        country: row.country, territory: row.territory, personId: src.voterId,
      });
      if (!rep.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: rep.reason, productionAuth: false };
      }
    } else if (src.memberDirectory && row.kind === 'citizen') {
      const voter = memberLink.voterStatus(src.memberDirectory, {
        country: row.country, territory: row.territory, personId: src.voterId, nowMs: src.nowMs,
      });
      if (!voter.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: voter.reason, productionAuth: false };
      }
    } else if (row.kind === 'representative') {
      const seat = await client.query(
        'SELECT person_id FROM leader_representative_seats WHERE country=$1 AND territory=$2 AND person_id=$3',
        [row.country, row.territory, src.voterId]
      );
      if (!seat.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'REPRESENTATIVE_STATUS_MISSING' };
      }
    }
    await client.query(
      `INSERT INTO leader_impeachment_votes (proposal_id, voter_id, choice, at_ms) VALUES ($1, $2, $3, $4)`,
      [row.id, src.voterId, src.choice, Number(src.nowMs)]
    );
    await client.query('COMMIT');
    return { ok: true, stored: true };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err) };
  }
}

async function closeImpeachment(client, input) {
  const src = input || {};
  try {
    await client.query('BEGIN');
    const proposal = await client.query(
      'SELECT * FROM leader_impeachment_proposals WHERE id=$1 FOR UPDATE',
      [src.proposalId]
    );
    const row = proposal.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'PROPOSAL_MISSING' };
    }
    if (src.memberDirectory) {
      const projected = await projectDirectory(client, src.memberDirectory, row.country, row.territory);
      if (!projected.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: projected.reason, passed: false, productionAuth: false };
      }
    }
    if (src.outcome === 'halted' || src.outcome === 'error') {
      await client.query(
        `UPDATE leader_impeachment_proposals SET status=$2, result=$2 WHERE id=$1`,
        [row.id, src.outcome]
      );
      await client.query('COMMIT');
      return { ok: true, passed: false, appointed: false, refile: false, result: src.outcome };
    }
    const votes = await client.query(
      'SELECT choice FROM leader_impeachment_votes WHERE proposal_id=$1',
      [row.id]
    );
    const yes = votes.rows.filter(function (voteRow) { return voteRow.choice === 'yes'; }).length;
    const no = votes.rows.filter(function (voteRow) { return voteRow.choice === 'no'; }).length;
    const participants = yes + no;
    let passed = false;
    if (row.kind === 'representative') {
      passed = participants >= vote.KINDS.representative_impeachment_24h.quorum && yes > participants / 2;
      if (passed) {
        const office = await client.query('SELECT leader_id FROM leader_offices WHERE id=$1', [row.office_id]);
        let rosterSize = null;
        if (src.memberDirectory) {
          const counted = memberLink.validPopulationCount(src.memberDirectory, row.country, row.territory, src.nowMs);
          if (!counted.ok) {
            await client.query('ROLLBACK');
            return { ok: false, reason: counted.reason, passed: false, productionAuth: false };
          }
          rosterSize = counted.count;
        } else {
          const roster = await client.query(
            'SELECT count(*)::int AS n FROM leader_population_records WHERE country=$1 AND territory=$2 AND source=$3',
            [row.country, row.territory, 'server-table']
          );
          rosterSize = roster.rows[0] ? roster.rows[0].n : 0;
        }
        if (!rosterSize) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'POPULATION_NOT_STORED', passed: false };
        }
        await client.query(
          `INSERT INTO leader_impeachment_proposals
            (id, office_id, country, territory, kind, status, opened_at_ms, ends_at_ms, frozen_roster_size)
           VALUES ($1, $2, $3, $4, 'citizen', 'open', $5, $6, $7)`,
          [
            row.id + ':citizen',
            row.office_id,
            row.country,
            row.territory,
            Number(src.nowMs),
            Number(src.nowMs) + CITIZEN_MS,
            rosterSize,
          ]
        );
        void office;
      }
    } else {
      const rosterSize = Number(row.frozen_roster_size);
      if (!isFinite(rosterSize) || rosterSize <= 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'POPULATION_NOT_STORED', passed: false };
      }
      const valid = participants;
      passed = valid >= rosterSize * 0.2 && yes > valid / 2;
      if (!passed) {
        const office = await client.query('SELECT leader_id FROM leader_offices WHERE id=$1', [row.office_id]);
        await client.query(
          `INSERT INTO leader_impeachment_blocks (id, country, territory, leader_id, blocked_until_ms, reason)
           VALUES ($1, $2, $3, $4, $5, 'citizen_vote_failed')`,
          [row.id + ':block', row.country, row.territory, office.rows[0].leader_id, Number(src.nowMs) + BLOCK_MS]
        );
      }
    }
    await client.query(
      `UPDATE leader_impeachment_proposals
       SET status=$2, result=$3, yes_count=$4, participant_count=$5, valid_votes=$5
       WHERE id=$1`,
      [row.id, passed ? 'passed' : 'failed', passed ? 'passed' : 'failed', yes, participants]
    );
    await client.query('COMMIT');
    return { ok: true, passed: passed, appointed: false, refile: false };
  } catch (err) {
    await rollback(client);
    return { ok: false, reason: reasonFrom(err), passed: false };
  }
}

async function applyStoredRankAuthority(client, country, territory) {
  const found = await client.query(
    'SELECT person_id, rank FROM leader_rank_members WHERE country=$1 AND territory=$2',
    [country, territory]
  );
  if (!found.rows.length) return { applied: false };
  await client.query(
    'DELETE FROM leader_representative_seats WHERE country=$1 AND territory=$2',
    [country, territory]
  );
  for (let i = 0; i < found.rows.length; i += 1) {
    if (found.rows[i].rank !== 'representative') continue;
    await client.query(
      'INSERT INTO leader_representative_seats (country, territory, person_id) VALUES ($1, $2, $3)',
      [country, territory, found.rows[i].person_id]
    );
  }
  return { applied: true };
}

async function syncStoredRank(client, country, territory, personId, nextRank) {
  const found = await client.query(
    `SELECT rank, xp, fame, achievements FROM leader_rank_members
     WHERE country=$1 AND territory=$2 AND person_id=$3 FOR UPDATE`,
    [country, territory, personId]
  );
  if (!found.rows[0]) return { present: false };
  if (nextRank === 'leader' && found.rows[0].rank !== 'representative') {
    throw new Error('NOT_REPRESENTATIVE');
  }
  await client.query(
    `UPDATE leader_rank_members
     SET rank=$4, elected_leader=$5
     WHERE country=$1 AND territory=$2 AND person_id=$3`,
    [country, territory, personId, nextRank, nextRank === 'leader']
  );
  return {
    present: true,
    xp: found.rows[0].xp,
    fame: found.rows[0].fame,
    achievements: found.rows[0].achievements,
  };
}

async function storeMemberFacts(client, input) {
  const src = input || {};
  if (src.rank != null || src.clientRank != null || src.comparisonScore != null || src.populationCount != null) {
    return { ok: false, reason: 'CLIENT_RANK_IGNORED', stored: false };
  }
  const country = String(src.activityRegion || '');
  if (country !== 'KR' && country !== 'US') return { ok: false, reason: 'ACTIVITY_REGION_REQUIRED', stored: false };
  if (src.homeCountry && !src.activityRegion) return { ok: false, reason: 'ACTIVITY_REGION_REQUIRED', stored: false };
  const territory = memberLink.normalizeTerritory(src.territory);
  if (territory !== 'pioneer' && territory !== 'central' && territory !== 'guardian') {
    return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE', stored: false };
  }
  const personId = String(src.personId || '').trim();
  if (!personId) return { ok: false, reason: 'PERSON_REQUIRED', stored: false };
  await client.query(
    `INSERT INTO leader_rank_members
      (country, territory, person_id, xp, fame, achievements, rank, comparison_score, valid, last_post_at_ms, last_comment_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'citizen', NULL, $7, $8, $9)
     ON CONFLICT (country, territory, person_id) DO UPDATE
     SET xp = EXCLUDED.xp, fame = EXCLUDED.fame, achievements = EXCLUDED.achievements,
         valid = EXCLUDED.valid, last_post_at_ms = EXCLUDED.last_post_at_ms, last_comment_at_ms = EXCLUDED.last_comment_at_ms`,
    [
      country,
      territory,
      personId,
      Number(src.xp) || 0,
      Number(src.fame) || 0,
      JSON.stringify(src.achievements || []),
      src.valid === true,
      src.lastPostAtMs != null ? Number(src.lastPostAtMs) : null,
      src.lastCommentAtMs != null ? Number(src.lastCommentAtMs) : null,
    ]
  );
  return { ok: true, stored: true, rank: 'citizen', comparisonScore: null, formulaStatus: rank.FORMULA_STATUS };
}

async function refreshStoredRanks(client, input) {
  const src = input || {};
  if (src.comparisonScore != null || src.rank != null || src.clientRank != null || src.territoryPopulation != null || src.populationCount != null) {
    return { ok: false, applied: false, reason: 'CLIENT_RANK_IGNORED', formulaStatus: rank.FORMULA_STATUS };
  }
  const country = String(src.country || '');
  const territory = memberLink.normalizeTerritory(src.territory);
  try {
    await client.query('BEGIN');
    const scope = await client.query(
      'SELECT territory_population FROM leader_rank_scopes WHERE country=$1 AND territory=$2 FOR UPDATE',
      [country, territory]
    );
    const members = await client.query(
      `SELECT person_id, rank, comparison_score, elected_leader, unique_positive_evaluators, first_qualification_used, xp, fame
       FROM leader_rank_members WHERE country=$1 AND territory=$2 FOR UPDATE`,
      [country, territory]
    );
    const described = rank.describeScore({});
    const flag = await client.query(
      'SELECT reactions_connected, follows_connected FROM leader_rank_source_flags WHERE country = $1 AND territory = $2',
      [country, territory]
    );
    const sourcesConnected = !!(flag.rows[0] && flag.rows[0].reactions_connected === true && flag.rows[0].follows_connected === true);
    if (!members.rows.length || members.rows.some(function (row) { return row.comparison_score == null; }) || !scope.rows[0] || scope.rows[0].territory_population == null) {
      await client.query('ROLLBACK');
      const reason = !sourcesConnected
        ? 'SOURCE_MISSING'
        : (!scope.rows[0] || scope.rows[0].territory_population == null)
          ? 'QUALIFICATION_SOURCE_MISSING'
          : 'FORMULA_UNCONFIRMED';
      return {
        ok: false,
        applied: false,
        reason: reason,
        formulaStatus: sourcesConnected ? described.formulaStatus : 'SOURCE_MISSING',
        combinedScore: described.combinedScore,
      };
    }
    const evaluated = rank.applyWeeklyRanks({
      country: country,
      territory: territory,
      clock: src.clock || {},
      refreshComplete: src.refreshComplete === true,
      territoryPopulation: scope.rows[0].territory_population,
      members: members.rows.map(function (row) {
        return {
          id: row.person_id,
          country: country,
          territory: territory,
          currentRank: row.rank,
          uniquePositiveEvaluators: row.unique_positive_evaluators,
          firstQualificationUsed: row.first_qualification_used || {},
          electedLeader: row.elected_leader === true,
          comparisonScore: Number(row.comparison_score),
        };
      }),
    });
    if (!evaluated.applied) {
      await client.query('ROLLBACK');
      return evaluated;
    }
    for (let i = 0; i < evaluated.assignments.length; i += 1) {
      const next = evaluated.assignments[i];
      await client.query(
        `UPDATE leader_rank_members
         SET rank=$4, elected_leader=$5
         WHERE country=$1 AND territory=$2 AND person_id=$3`,
        [country, territory, next.id, next.rank, next.rank === 'leader']
      );
    }
    await client.query('COMMIT');
    return {
      ok: true,
      applied: true,
      formulaStatus: rank.FORMULA_STATUS,
      combinedScore: null,
      counts: evaluated.counts,
      assignments: evaluated.assignments,
    };
  } catch (err) {
    await rollback(client);
    return { ok: false, applied: false, reason: reasonFrom(err), formulaStatus: rank.FORMULA_STATUS };
  }
}

async function setStoredLeader(client, input) {
  const src = input || {};
  if (src.clientRank != null) return { ok: false, reason: 'CLIENT_RANK_IGNORED', stored: false };
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE leader_rank_members SET rank='leader', elected_leader=true
       WHERE country=$1 AND territory=$2 AND person_id=$3 AND rank <> 'leader'`,
      [src.country, src.territory, src.personId]
    );
    await client.query('COMMIT');
    return { ok: updated.rowCount === 1, stored: updated.rowCount === 1 };
  } catch (err) {
    await rollback(client);
    return { ok: false, stored: false, reason: reasonFrom(err) };
  }
}

async function promoteRepresentative(client, input) {
  const src = input || {};
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE leader_rank_members SET rank='representative'
       WHERE country=$1 AND territory=$2 AND person_id=$3 AND rank='citizen'`,
      [src.country, src.territory, src.personId]
    );
    await client.query('COMMIT');
    return { ok: updated.rowCount === 1, stored: updated.rowCount === 1 };
  } catch (err) {
    await rollback(client);
    return { ok: false, stored: false, reason: reasonFrom(err) };
  }
}

async function failRankAndOffice(client, input) {
  const src = input || {};
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE leader_offices SET leader_id=$3 WHERE country=$1 AND territory=$2`,
      [src.country, src.territory, src.personId]
    );
    await client.query(
      `UPDATE leader_rank_members SET rank='leader', elected_leader=true
       WHERE country=$1 AND territory=$2 AND person_id=$3`,
      [src.country, src.territory, src.personId]
    );
    throw new Error('MID_TRANSACTION');
  } catch (err) {
    await rollback(client);
    const office = await readOffice(client, src.country, src.territory);
    const member = await client.query(
      'SELECT rank FROM leader_rank_members WHERE country=$1 AND territory=$2 AND person_id=$3',
      [src.country, src.territory, src.personId]
    );
    return {
      ok: office.leader_id == null && member.rows[0] && member.rows[0].rank !== 'leader',
      rolledBack: true,
    };
  }
}

async function applyRankFormula(client, input) {
  const src = input || {};
  if (
    src.comparisonScore != null || src.rank != null || src.clientRank != null || src.clientScore != null ||
    src.populationCount != null || src.territoryPopulation != null || src.clientNow != null || src.clientWeekday != null
  ) {
    return { ok: false, applied: false, reason: 'CLIENT_RANK_IGNORED' };
  }
  const country = String(src.country || '');
  const territory = memberLink.normalizeTerritory(src.territory);
  const zone = formula.zoneFor(country);
  const asOfMs = Number(src.asOfMs);
  if (!zone) return { ok: false, applied: false, reason: 'COUNTRY_REQUIRED' };
  if (!Number.isFinite(asOfMs)) return { ok: false, applied: false, reason: 'SERVER_CLOCK_REQUIRED' };
  if (!formula.isLocalMidnight(asOfMs, zone)) {
    return { ok: false, applied: false, reason: 'NOT_REFRESH_MOMENT' };
  }
  const roundKey = formula.localDateKey(asOfMs, zone);
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [country + ':' + territory + ':rank-formula']);
    const existing = await client.query(
      'SELECT 1 FROM leader_rank_rounds WHERE country = $1 AND territory = $2 AND round_key = $3',
      [country, territory, roundKey]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, applied: false, reason: 'ROUND_ALREADY_APPLIED' };
    }
    const flag = await client.query(
      'SELECT reactions_connected, follows_connected FROM leader_rank_source_flags WHERE country = $1 AND territory = $2',
      [country, territory]
    );
    if (!flag.rows[0] || flag.rows[0].reactions_connected !== true || flag.rows[0].follows_connected !== true) {
      await client.query('ROLLBACK');
      await noteRefreshFailure(client, country, territory, roundKey, asOfMs, 'SOURCE_MISSING');
      return { ok: false, applied: false, reason: 'SOURCE_MISSING' };
    }
    const scope = await client.query(
      'SELECT territory_population FROM leader_rank_scopes WHERE country = $1 AND territory = $2 FOR UPDATE',
      [country, territory]
    );
    if (!scope.rows[0] || scope.rows[0].territory_population == null) {
      await client.query('ROLLBACK');
      await noteRefreshFailure(client, country, territory, roundKey, asOfMs, 'QUALIFICATION_SOURCE_MISSING');
      return { ok: false, applied: false, reason: 'QUALIFICATION_SOURCE_MISSING' };
    }
    const members = await client.query(
      'SELECT person_id, fame, rank, elected_leader, unique_positive_evaluators, first_qualification_used FROM leader_rank_members WHERE country = $1 AND territory = $2 FOR UPDATE',
      [country, territory]
    );
    const reactions = await client.query(
      'SELECT actor_id, target_id, polarity, at_ms, cancelled_at_ms, invalid, fame_delta FROM leader_rank_reactions WHERE country = $1 AND territory = $2',
      [country, territory]
    );
    const follows = await client.query(
      'SELECT follower_id, target_id, at_ms, cancelled_at_ms FROM leader_rank_follows WHERE country = $1 AND territory = $2',
      [country, territory]
    );
    const scored = formula.scoreCohort({
      country: country,
      territory: territory,
      asOfMs: asOfMs,
      members: members.rows.map(function (row) {
        return { id: row.person_id, fame: row.fame, country: country, territory: territory };
      }),
      reactions: reactions.rows,
      follows: follows.rows,
    });
    if (!scored.ok) {
      await client.query('ROLLBACK');
      await noteRefreshFailure(client, country, territory, roundKey, asOfMs, scored.reason || 'RANK_FORMULA_FAILED');
      return scored;
    }
    for (const row of scored.members) {
      await client.query(
        'UPDATE leader_rank_members SET comparison_score = $4 WHERE country = $1 AND territory = $2 AND person_id = $3',
        [country, territory, row.id, row.storedScore]
      );
    }
    if (src.failAfterScore === true) throw new Error('forced rollback');
    const byId = Object.create(null);
    scored.members.forEach(function (row) { byId[row.id] = row; });
    const evaluated = rank.applyWeeklyRanks({
      country: country,
      territory: territory,
      territoryPopulation: scope.rows[0].territory_population,
      refreshComplete: true,
      clock: { weekday: formula.weekdayName(asOfMs, zone), hour: 0, minute: 0 },
      members: members.rows.map(function (row) {
        return {
          id: row.person_id,
          currentRank: row.rank,
          electedLeader: row.elected_leader === true,
          comparisonScore: byId[row.person_id] ? byId[row.person_id].combined : null,
          uniquePositiveEvaluators: row.unique_positive_evaluators,
          firstQualificationUsed: row.first_qualification_used || {},
        };
      }),
    });
    if (!evaluated.applied) {
      await client.query('ROLLBACK');
      await noteRefreshFailure(client, country, territory, roundKey, asOfMs, evaluated.reason || 'RANK_NOT_APPLIED');
      return { ok: false, applied: false, reason: evaluated.reason || 'RANK_NOT_APPLIED' };
    }
    for (const row of evaluated.assignments) {
      await client.query(
        'UPDATE leader_rank_members SET rank = $4 WHERE country = $1 AND territory = $2 AND person_id = $3',
        [country, territory, row.id, row.rank]
      );
    }
    await client.query(
      'INSERT INTO leader_rank_rounds (country, territory, round_key) VALUES ($1, $2, $3)',
      [country, territory, roundKey]
    );
    await client.query('COMMIT');
    return { ok: true, applied: true, formulaStatus: 'FORMULA_CONFIRMED', members: scored.members, correlation: scored.correlation };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_rollback) { /* 이미 닫힌 트랜잭션 */ }
    await noteRefreshFailure(client, country, territory, roundKey, asOfMs, 'RANK_FORMULA_FAILED');
    return { ok: false, applied: false, reason: 'RANK_FORMULA_FAILED', detail: error && error.message ? error.message : '' };
  }
}

async function noteRefreshFailure(client, country, territory, roundKey, asOfMs, reason) {
  if (!country || !territory || !roundKey) return;
  await client.query(
    `INSERT INTO leader_rank_refresh_failures (id, country, territory, round_key, reason, at_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [country + ':' + territory + ':' + roundKey + ':' + reason + ':' + asOfMs + ':' + Date.now(), country, territory, roundKey, reason, asOfMs]
  );
}

module.exports = {
  DAY_MS: DAY_MS,
  VACANT_MS: VACANT_MS,
  FILING_MS: FILING_MS,
  VOTE_MS: VOTE_MS,
  REFILE_MS: REFILE_MS,
  applyMigration: applyMigration,
  ensureOffice: ensureOffice,
  readOffice: readOffice,
  seedRepresentative: seedRepresentative,
  seedPopulation: seedPopulation,
  fileCandidacy: fileCandidacy,
  castVote: castVote,
  openBallot: openBallot,
  openFilingRound: openFilingRound,
  resolveRound: resolveRound,
  removeOffice: removeOffice,
  tick: tick,
  failMidTransaction: failMidTransaction,
  scheduleRefiling: scheduleRefiling,
  readRound: readRound,
  counts: counts,
  proposeImpeachment: proposeImpeachment,
  castImpeachmentVote: castImpeachmentVote,
  closeImpeachment: closeImpeachment,
  reasonFrom: reasonFrom,
  storeMemberFacts: storeMemberFacts,
  refreshStoredRanks: refreshStoredRanks,
  applyRankFormula: applyRankFormula,
  failRankAndOffice: failRankAndOffice,
  promoteRepresentative: promoteRepresentative,
  setStoredLeader: setStoredLeader,
};
