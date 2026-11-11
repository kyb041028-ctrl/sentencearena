/**
 * 개발용 지도자 직위 해임과 공석 기록.
 * 저장된 시민 탄핵이 48시간을 마치고 가결된 경우에만 그 국가·영토의 개발용 직위를 공석으로 바꾼다.
 * 일정만 기록한다. 스케줄러와 선거 개설은 하지 않는다.
 * 운영 직위, 계급, 시즌은 바꾸지 않는다. PostgreSQL 트랜잭션이 아니다.
 */
'use strict';

const fs = require('fs');
const vote = require('../shared/vote-engine-core');
const election = require('./leader-election-service');

const HOUR_MS = vote.HOUR_MS;
const DAY_MS = vote.DAY_MS;
const VOTE_MS = vote.KINDS.leader_election_48h.durationMs;
const VACANT_MS = 7 * DAY_MS;
const FILING_MS = 3 * DAY_MS;

const tails = new Map();

function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(function (resolve) { release = resolve; });
  tails.set(key, gate);
  return prev.then(function () {
    return Promise.resolve().then(fn).then(function (value) {
      release();
      return value;
    }, function (err) {
      release();
      throw err;
    });
  });
}

function emptyStore() {
  return { offices: [], removals: [], schedules: [] };
}

function readStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const store = emptyStore();
  store.offices = Array.isArray(parsed.offices) ? parsed.offices : [];
  store.removals = Array.isArray(parsed.removals) ? parsed.removals : [];
  store.schedules = Array.isArray(parsed.schedules) ? parsed.schedules : [];
  Object.keys(parsed).forEach(function (key) {
    if (key === 'offices' || key === 'removals' || key === 'schedules') return;
    store[key] = parsed[key];
  });
  return store;
}

function writeStore(filePath, store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function findBallot(citizenStore, ballotId) {
  return (citizenStore.ballots || []).filter(function (row) { return row.id === ballotId; })[0] || null;
}

function findOffice(store, country, territory) {
  return store.offices.filter(function (row) { return row.country === country && row.territory === territory; })[0] || null;
}

function findRemoval(store, ballotId) {
  return store.removals.filter(function (row) { return row.citizenBallotId === ballotId; })[0] || null;
}

function byElectionPlan(removedAtMs) {
  const start = Number(removedAtMs);
  const vacancyEndMs = start + VACANT_MS;
  const filingEndMs = vacancyEndMs + FILING_MS;
  const zero = election.sharedCandidatePath(0, 'by_election');
  const sole = election.sharedCandidatePath(1, 'by_election');
  const multiple = election.sharedCandidatePath(2, 'by_election');
  return {
    scheduleMeaning: 'by_election_after_removal',
    removedAtMs: start,
    vacancyStartMs: start,
    vacancyEndMs: vacancyEndMs,
    filingStartMs: vacancyEndMs,
    filingEndMs: filingEndMs,
    voteKind: multiple.voteKind,
    voteDurationMs: multiple.voteDurationMs,
    multipleVoteStartMs: filingEndMs,
    multipleVoteEndMs: filingEndMs + multiple.voteDurationMs,
    spanMs: filingEndMs + multiple.voteDurationMs - start,
    zeroCompletesWithinSpan: false,
    paths: {
      zero: { status: zero.status, officeGranted: false, votesOpened: false, completesWithinSpan: false, electionOpened: false },
      sole: { status: sole.status, officeGranted: false, votesOpened: false, afterFilingEnd: true, electionOpened: false },
      multiple: { status: multiple.status, officeGranted: false, voteStartMs: filingEndMs, voteEndMs: filingEndMs + multiple.voteDurationMs, electionOpened: false },
    },
    schedulerRan: false,
    electionOpened: false,
  };
}

function phaseAt(schedule, atMs) {
  if (!schedule) return null;
  const t = Number(atMs);
  if (!isFinite(t)) return null;
  if (t < schedule.vacancyEndMs) return 'vacant';
  if (t < schedule.filingEndMs) return 'filing';
  return 'branch_scheduled';
}

function applyRemoval(store, citizenStore, input) {
  const src = input || {};
  const ballotId = String(src.ballotId || '');
  const ballot = findBallot(citizenStore, ballotId);
  if (!ballot) return { ok: false, reason: 'CITIZEN_VOTE_NOT_STORED', productionAuth: false };
  if (ballot.status === 'open' || ballot.closedOnce !== true && ballot.status !== 'closed') {
    if (ballot.status === 'open') return { ok: false, reason: 'CITIZEN_VOTE_OPEN', productionAuth: false };
    if (ballot.status === 'halted') return { ok: false, reason: 'CITIZEN_VOTE_HALTED', productionAuth: false };
    if (ballot.status === 'error') return { ok: false, reason: 'CITIZEN_VOTE_ERROR', productionAuth: false };
  }
  if (ballot.status !== 'closed' || ballot.closedOnce !== true) {
    return { ok: false, reason: 'NOT_NORMALLY_ENDED', productionAuth: false };
  }
  if (Number(ballot.endsAtMs) - Number(ballot.startsAtMs) !== VOTE_MS || !(Number(ballot.closedAtMs) >= Number(ballot.endsAtMs))) {
    return { ok: false, reason: 'NOT_NORMALLY_ENDED', productionAuth: false };
  }
  if (ballot.result !== 'passed') return { ok: false, reason: 'CITIZEN_VOTE_NOT_PASSED', productionAuth: false };
  if (ballot.country !== 'KR' && ballot.country !== 'US') return { ok: false, reason: 'COUNTRY_REQUIRED', productionAuth: false };
  if (ballot.territory !== 'pioneer' && ballot.territory !== 'guardian') {
    return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE', productionAuth: false };
  }
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED', productionAuth: false };
  if (nowMs < Number(ballot.closedAtMs)) return { ok: false, reason: 'BEFORE_CLOSE', productionAuth: false };
  const prior = findRemoval(store, ballot.id);
  if (prior) {
    return { ok: false, reason: 'REMOVAL_EXISTS', alreadyRemoved: true, removal: prior, productionAuth: false };
  }
  const priorSchedule = store.schedules.filter(function (row) { return row.citizenBallotId === ballot.id; })[0];
  if (priorSchedule) {
    return { ok: false, reason: 'SCHEDULE_EXISTS', schedule: priorSchedule, productionAuth: false };
  }
  const office = findOffice(store, ballot.country, ballot.territory);
  if (!office || office.status !== 'sitting' || String(office.leaderId || '') !== String(ballot.leaderId || '')) {
    return { ok: false, reason: 'INCUMBENT_MISMATCH', productionAuth: false };
  }
  const schedule = byElectionPlan(nowMs);
  schedule.citizenBallotId = ballot.id;
  schedule.proposalId = ballot.proposalId;
  schedule.country = ballot.country;
  schedule.territory = ballot.territory;
  const removal = {
    id: 'dev-office-removal:' + ballot.id,
    citizenBallotId: ballot.id,
    proposalId: ballot.proposalId,
    leaderId: ballot.leaderId,
    leaderName: office.leaderName || ballot.leaderName || '',
    country: ballot.country,
    territory: ballot.territory,
    removedAtMs: nowMs,
    vacancyStartMs: nowMs,
    devOnly: true,
    devOfficeChanged: true,
    productionOfficeChanged: false,
    rankChanged: false,
    seasonChanged: false,
    followUpElectionOpened: false,
    schedulerRan: false,
  };
  office.status = 'vacant';
  office.removedLeaderId = office.leaderId;
  office.leaderId = null;
  office.removedAtMs = nowMs;
  office.vacancyStartMs = nowMs;
  store.removals.push(removal);
  store.schedules.push(schedule);
  return {
    ok: true,
    stored: true,
    alreadyRemoved: false,
    office: office,
    removal: removal,
    schedule: schedule,
    phase: phaseAt(schedule, nowMs),
    productionAuth: false,
    electionOpened: false,
    schedulerRan: false,
  };
}

function removeAndPersist(officePath, citizenPath, input, options) {
  const src = input || {};
  const opts = options || {};
  return withLock(String(src.ballotId || ''), function () {
    const store = readStore(officePath);
    const citizen = JSON.parse(fs.readFileSync(citizenPath, 'utf8'));
    const before = findRemoval(store, String(src.ballotId || ''));
    const applied = applyRemoval(store, citizen, src);
    if (!applied.ok) return applied;
    try {
      if (opts.failOfficeWrite === true && !before) throw new Error('OFFICE_STORE_WRITE_FAILED');
      writeStore(officePath, store);
    } catch (err) {
      return { ok: false, reason: 'OFFICE_STORE_WRITE_FAILED', applied: false, productionAuth: false };
    }
    const fresh = readStore(officePath);
    const removal = findRemoval(fresh, applied.removal.citizenBallotId);
    return {
      ok: true,
      alreadyRemoved: false,
      office: findOffice(fresh, applied.office.country, applied.office.territory),
      removal: removal,
      schedule: fresh.schedules.filter(function (row) { return row.citizenBallotId === removal.citizenBallotId; })[0] || null,
      productionAuth: false,
      electionOpened: false,
      schedulerRan: false,
    };
  });
}

function publicOffice(store, country, territory) {
  const office = findOffice(store, country, territory);
  if (!office) return null;
  const schedule = store.schedules.filter(function (row) {
    return row.country === country && row.territory === territory;
  }).slice(-1)[0] || null;
  return {
    country: office.country,
    territory: office.territory,
    status: office.status,
    leaderId: office.leaderId,
    leaderName: office.leaderName || '',
    removedLeaderId: office.removedLeaderId || null,
    rank: office.rank,
    season: office.season,
    removedAtMs: office.removedAtMs || null,
    vacancyStartMs: office.vacancyStartMs || null,
    schedule: schedule,
    productionAuth: false,
    electionOpened: false,
    schedulerRan: false,
  };
}

module.exports = {
  HOUR_MS: HOUR_MS,
  DAY_MS: DAY_MS,
  VACANT_MS: VACANT_MS,
  FILING_MS: FILING_MS,
  VOTE_MS: VOTE_MS,
  emptyStore: emptyStore,
  readStore: readStore,
  writeStore: writeStore,
  applyRemoval: applyRemoval,
  removeAndPersist: removeAndPersist,
  publicOffice: publicOffice,
  phaseAt: phaseAt,
  byElectionPlan: byElectionPlan,
  sharedCandidatePath: election.sharedCandidatePath,
};
