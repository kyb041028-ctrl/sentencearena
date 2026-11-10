'use strict';
/**
 * 복수 후보 48시간 투표가 정상 종료되고 최다 득표자가 한 명으로 저장된 뒤에만 임명한다.
 * node tools/test-plurality-appointment.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
const vacancy = require('../server/impeachment-vacancy-service');
const service = require('../server/leader-appointment-service');
const httpDev = require('../server/leader-appointment-dev-http');
const vote = require('../shared/vote-engine-core');
const legal = require('../shared/legal-gate-core');

let passed = 0;
let failed = 0;
const scenario = [];
function ok(id, label, cond) {
  scenario.push((cond ? 'PASS' : 'FAIL') + ' ' + id + ' ' + label);
  if (cond) {
    console.log('PASS: ' + id + ' ' + label);
    passed += 1;
  } else {
    console.log('FAIL: ' + id + ' ' + label);
    failed += 1;
  }
}

const removedAt = 1700000000000;
const day = vacancy.DAY_MS;
const filingEnd = removedAt + 10 * day;
const voteEnd = filingEnd + 48 * vote.HOUR_MS;
const header = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Leader-Appointment': 'preview' };
const clerk = { id: 'clerk', office: 'dev-clerk', verified: true, authSource: 'test-fixture' };
const windowOpen = { provided: true, open: true };
const usAdult = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'US',
    age_policy_region: 'US',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.US_AGE_POLICY_VERSION,
  },
};

function request(port, method, urlPath, body, headers) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1', port: port, method: method, path: urlPath, headers: headers || {}, agent: false,
    }, function (res) {
      let raw = '';
      res.on('data', function (chunk) { raw += chunk; });
      res.on('end', function () {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (err) { parsed = { raw: raw }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function closeServer(server) {
  return new Promise(function (resolve) {
    if (!server) return resolve();
    server.close(function () { resolve(); });
  });
}

function people(count, country, territory, atMs) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ id: 'pop-' + country + '-' + territory + '-' + i, country: country, territory: territory, valid: true, lastPostAtMs: atMs - 1000 });
  }
  return { source: 'test-fixture', records: rows };
}

function removalRecord(id, country, territory) {
  return {
    id: 'dev-office-removal:' + id,
    citizenBallotId: id,
    country: country,
    territory: territory,
    leaderId: 'old-' + id,
    removedAtMs: removedAt,
    vacancyStartMs: removedAt,
    rankChanged: false,
  };
}

function scheduleFor(row) {
  const plan = vacancy.byElectionPlan(row.removedAtMs);
  plan.citizenBallotId = row.citizenBallotId;
  plan.country = row.country;
  plan.territory = row.territory;
  return plan;
}

function officeFor(row) {
  return {
    country: row.country,
    territory: row.territory,
    status: 'vacant',
    leaderId: null,
    removedAtMs: row.removedAtMs,
    vacancyStartMs: row.vacancyStartMs,
    season: 'season-kept',
    seasonEnd: null,
  };
}

function runFor(row, filingRoundId) {
  const plan = vacancy.byElectionPlan(row.removedAtMs);
  return {
    id: 'byrun-' + filingRoundId,
    citizenBallotId: row.citizenBallotId,
    country: row.country,
    territory: row.territory,
    removedAtMs: row.removedAtMs,
    filingRoundId: filingRoundId,
    parentFilingRoundId: null,
    status: 'vote_open',
    filingStartMs: plan.filingStartMs,
    filingEndMs: plan.filingEndMs,
    officeGranted: false,
    votesOpened: true,
    appointment: false,
    recordedCandidateId: null,
    tieRule: false,
    lock: 'single-process',
  };
}

function member(id, country, territory, rankName) {
  return {
    id: id, country: country, territory: territory, rank: rankName,
    comparisonScore: 80, uniquePositiveEvaluators: 200, firstQualificationUsed: {},
    electedLeader: false, xp: 11, fame: 6, activity: 4, achievements: ['kept'],
  };
}

function openMulti(electionStore, filingStore, country, territory, actors, eligibility) {
  const round = election.openFilingRound(electionStore, { actor: clerk, country: country, territory: territory, window: windowOpen });
  actors.forEach(function (actor) {
    const filed = filing.fileCandidacy(filingStore, {
      actor: { id: actor.id, name: actor.name, devAuth: true, country: country, territory: territory, office: 'representative' },
      country: country, territory: territory, window: windowOpen, nowMs: filingEnd, intentConfirmed: true, eligibility: eligibility,
    });
    election.applyToRound(electionStore, filingStore, {
      actor: clerk, filingRoundId: round.round.id, candidacyId: filed.candidacy.id, window: { provided: true },
    });
    election.reviewCandidacy(electionStore, filingStore, {
      actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'start_review', window: { provided: true },
    });
    election.reviewCandidacy(electionStore, filingStore, {
      actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'approve', window: { provided: true },
    });
  });
  election.closeRegistration(electionStore, {
    actor: clerk, country: country, territory: territory, filingRoundId: round.round.id, window: { provided: true, closing: true },
  });
  const opened = election.openElection(electionStore, {
    country: country, territory: territory, nowMs: filingEnd, window: { provided: true },
    filingRoundId: round.round.id, population: people(1000, country, territory, filingEnd),
  });
  return { round: round.round, opened: opened };
}

async function cast(store, ballot, country, territory, choice, index) {
  const result = await election.castVote(store, {
    ballotId: ballot.id,
    actor: { id: 'pop-' + country + '-' + territory + '-' + index, country: country, territory: territory, verified: true, authSource: 'test-fixture' },
    choice: choice,
    nowMs: filingEnd + 1000 + index,
    eligibility: country === 'US' ? usAdult : undefined,
  });
  if (!result.ok) throw new Error('cast ' + result.reason + ' ' + choice);
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-plurality-'));
  const paths = {
    vacancy: path.join(dir, 'vacancy.json'),
    election: path.join(dir, 'election.json'),
    filing: path.join(dir, 'filing.json'),
    rank: path.join(dir, 'rank.json'),
    citizen: path.join(dir, 'citizen.json'),
    run: path.join(dir, 'run.json'),
  };
  const electionStore = election.emptyStore();
  const filingStore = filing.emptyStore();
  const mainRemoval = removalRecord('ballot-kr-pioneer', 'KR', 'pioneer');
  const wrongRemoval = removalRecord('ballot-wrong', 'KR', 'pioneer', );
  wrongRemoval.removedAtMs = removedAt - 30 * day;
  wrongRemoval.vacancyStartMs = wrongRemoval.removedAtMs;
  const guardRemoval = removalRecord('ballot-kr-guardian', 'KR', 'guardian');
  const usRemoval = removalRecord('ballot-us-pioneer', 'US', 'pioneer');
  const zeroRemoval = removalRecord('ballot-us-guardian', 'US', 'guardian');
  const centralRemoval = removalRecord('ballot-central', 'KR', 'central');
  const alienRemoval = removalRecord('ballot-alien', 'US', 'alien');

  const main = openMulti(electionStore, filingStore, 'KR', 'pioneer', [{ id: 'r1', name: '한결' }, { id: 'r2', name: '가온' }]);
  const wrong = openMulti(electionStore, filingStore, 'KR', 'pioneer', [{ id: 'r5', name: '다른' }, { id: 'r6', name: '회차' }]);
  const tie = openMulti(electionStore, filingStore, 'KR', 'guardian', [{ id: 'r3', name: '하람' }, { id: 'r4', name: '로운' }]);
  const lost = openMulti(electionStore, filingStore, 'KR', 'guardian', [{ id: 'r7', name: '자격' }, { id: 'r8', name: '상실' }]);
  const us = openMulti(electionStore, filingStore, 'US', 'pioneer', [{ id: 'u1', name: 'Ari' }, { id: 'u2', name: 'Noa' }], usAdult);
  const zero = openMulti(electionStore, filingStore, 'US', 'guardian', [{ id: 'u3', name: 'Eden' }, { id: 'u4', name: 'Wynn' }], usAdult);
  const early = openMulti(electionStore, filingStore, 'US', 'guardian', [{ id: 'u5', name: 'Early' }, { id: 'u6', name: 'Still' }], usAdult);
  const halted = openMulti(electionStore, filingStore, 'US', 'guardian', [{ id: 'u7', name: 'Halt' }, { id: 'u8', name: 'Stop' }], usAdult);
  const errored = openMulti(electionStore, filingStore, 'US', 'guardian', [{ id: 'u1', name: 'Err' }, { id: 'u2', name: 'Bad' }], usAdult);
  [main, wrong, tie, lost, us, zero, early, halted, errored].forEach(function (item) {
    if (!item.opened.ok) throw new Error('open ' + (item.opened.reason || 'failed'));
  });
  main.round.byElectionBallotId = mainRemoval.citizenBallotId;
  wrong.round.byElectionBallotId = wrongRemoval.citizenBallotId;
  tie.round.byElectionBallotId = guardRemoval.citizenBallotId;
  lost.round.byElectionBallotId = guardRemoval.citizenBallotId;
  us.round.byElectionBallotId = usRemoval.citizenBallotId;
  zero.round.byElectionBallotId = zeroRemoval.citizenBallotId;
  early.round.byElectionBallotId = zeroRemoval.citizenBallotId;
  halted.round.byElectionBallotId = zeroRemoval.citizenBallotId;
  errored.round.byElectionBallotId = zeroRemoval.citizenBallotId;
  for (let index = 0; index < 3; index += 1) await cast(electionStore, main.opened.ballot, 'KR', 'pioneer', 'r1', index);
  await cast(electionStore, main.opened.ballot, 'KR', 'pioneer', 'r2', 3);
  await cast(electionStore, wrong.opened.ballot, 'KR', 'pioneer', 'r5', 4);
  await cast(electionStore, tie.opened.ballot, 'KR', 'guardian', 'r3', 0);
  await cast(electionStore, tie.opened.ballot, 'KR', 'guardian', 'r4', 1);
  await cast(electionStore, lost.opened.ballot, 'KR', 'guardian', 'r7', 2);
  await cast(electionStore, lost.opened.ballot, 'KR', 'guardian', 'r7', 3);
  await cast(electionStore, lost.opened.ballot, 'KR', 'guardian', 'r8', 4);
  for (let index = 0; index < 3; index += 1) await cast(electionStore, us.opened.ballot, 'US', 'pioneer', 'u1', index);
  await cast(electionStore, us.opened.ballot, 'US', 'pioneer', 'u2', 3);
  for (const item of [main, wrong, tie, lost, us, zero]) {
    const closed = await election.closeBallot(electionStore, { ballotId: item.opened.ballot.id, nowMs: voteEnd });
    if (!closed.ok) throw new Error('close ' + closed.reason);
  }
  vote.haltBallot(electionStore, halted.opened.ballot.id);
  vote.markBallotError(electionStore, errored.opened.ballot.id);
  electionStore.rounds.push(
    { id: 'round-central', country: 'KR', territory: 'central', status: 'election_opened', byElectionBallotId: centralRemoval.citizenBallotId },
    { id: 'round-alien', country: 'US', territory: 'alien', status: 'election_opened', byElectionBallotId: alienRemoval.citizenBallotId }
  );
  const tieElection = electionStore.elections.filter(function (row) { return row.filingRoundId === tie.round.id; })[0];
  const zeroElection = electionStore.elections.filter(function (row) { return row.filingRoundId === zero.round.id; })[0];
  const removals = [mainRemoval, wrongRemoval, guardRemoval, usRemoval, zeroRemoval, centralRemoval, alienRemoval];
  vacancy.writeStore(paths.vacancy, {
    offices: [mainRemoval, guardRemoval, usRemoval, zeroRemoval, centralRemoval, alienRemoval].map(officeFor),
    removals: removals,
    schedules: removals.map(scheduleFor),
    seasons: [{ id: 'season-kept', end: null }],
  });
  election.writeStore(paths.election, electionStore);
  filing.writeStore(paths.filing, filingStore);
  fs.writeFileSync(paths.run, JSON.stringify({
    runs: [main, wrong, tie, lost, us, zero, early, halted, errored].map(function (item) {
      const removal = item === main ? mainRemoval : item === wrong ? wrongRemoval : item === tie || item === lost ? guardRemoval : item === us ? usRemoval : zeroRemoval;
      return runFor(removal, item.round.id);
    }).concat([runFor(centralRemoval, 'round-central'), runFor(alienRemoval, 'round-alien')]),
  }, null, 2));
  service.writeRankStore(paths.rank, {
    members: [
      member('r1', 'KR', 'pioneer', 'representative'),
      member('r2', 'KR', 'pioneer', 'representative'),
      member('c1', 'KR', 'pioneer', 'citizen'),
      member('r3', 'KR', 'guardian', 'representative'),
      member('r4', 'KR', 'guardian', 'representative'),
      member('r7', 'KR', 'guardian', 'citizen'),
      member('r8', 'KR', 'guardian', 'representative'),
      member('u1', 'US', 'pioneer', 'representative'),
      member('u2', 'US', 'pioneer', 'representative'),
      member('u3', 'US', 'guardian', 'representative'),
      member('u4', 'US', 'guardian', 'representative'),
    ],
    appointments: [], relinquishments: [], refreshes: [],
  });

  const port = 3022;
  let server = await httpDev.listen(port, paths);
  function post(roundId, extra) {
    return request(port, 'POST', '/dev/leader-appointment/appointments', Object.assign({
      filingRoundId: roundId,
      clockSource: 'test-fixture',
      nowMs: voteEnd,
      winnerId: 'forged',
      officeGranted: true,
      candidateCount: 9,
    }, extra || {}), header);
  }
  const before = {
    vacancy: fs.readFileSync(paths.vacancy),
    rank: fs.readFileSync(paths.rank),
    election: fs.readFileSync(paths.election),
    run: fs.readFileSync(paths.run),
  };
  const tooEarly = await post(main.round.id, { nowMs: voteEnd - 1 });
  const wrongCall = await post(wrong.round.id);
  const tieCall = await post(tie.round.id);
  const lostCall = await post(lost.round.id);
  const zeroCall = await post(zero.round.id);
  const earlyCall = await post(early.round.id, { nowMs: voteEnd - 1 });
  const haltedCall = await post(halted.round.id);
  const errorCall = await post(errored.round.id);
  const centralCall = await post('round-central');
  const alienCall = await post('round-alien');
  const failedWrite = await post(main.round.id, { failAfterOffice: true });
  const sameAfterFail = fs.readFileSync(paths.vacancy).equals(before.vacancy)
    && fs.readFileSync(paths.rank).equals(before.rank)
    && fs.readFileSync(paths.election).equals(before.election)
    && fs.readFileSync(paths.run).equals(before.run);
  const crashed = await post(main.round.id, { crashBeforeRun: true });
  const afterCrash = {
    office: vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.country === 'KR' && row.territory === 'pioneer'; })[0],
    rank: service.readRankStore(paths.rank),
    election: election.readStore(paths.election).elections.filter(function (row) { return row.filingRoundId === main.round.id; })[0],
    run: JSON.parse(fs.readFileSync(paths.run, 'utf8')).runs.filter(function (row) { return row.filingRoundId === main.round.id; })[0],
  };
  await closeServer(server);
  server = await httpDev.listen(port, paths);
  const recoveryFail = await post(main.round.id, { failRecoveryWrite: true });
  const recovered = await post(main.round.id);
  const after = {
    office: vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.country === 'KR' && row.territory === 'pioneer'; })[0],
    rank: service.readRankStore(paths.rank),
    election: election.readStore(paths.election).elections.filter(function (row) { return row.filingRoundId === main.round.id; })[0],
    run: JSON.parse(fs.readFileSync(paths.run, 'utf8')).runs.filter(function (row) { return row.filingRoundId === main.round.id; })[0],
    guard: vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.country === 'KR' && row.territory === 'guardian'; })[0],
    usGuard: vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.country === 'US' && row.territory === 'guardian'; })[0],
  };
  const duplicate = await post(main.round.id);
  const pair = await Promise.all([post(us.round.id), post(us.round.id)]);
  const usView = await request(port, 'GET', '/dev/leader-appointment/offices/US/pioneer', null, header);
  const krView = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  await closeServer(server);
  server = null;

  const krMember = after.rank.members.filter(function (row) { return row.id === 'r1' && row.country === 'KR' && row.territory === 'pioneer'; })[0];
  const stillRep = after.rank.members.filter(function (row) { return row.id === 'r2' && row.territory === 'pioneer'; })[0];
  const citizen = after.rank.members.filter(function (row) { return row.id === 'c1'; })[0];
  const usMember = (usView.body.members || []).filter(function (row) { return row.id === 'u1'; })[0];
  ok('1', '48시간 종료 전 거부', tooEarly.body.reason === 'VOTE_NOT_ENDED' && tooEarly.body.officeGranted === false && earlyCall.body.reason === 'VOTE_NOT_ENDED' && earlyCall.body.officeGranted === false);
  ok('2', '동률은 당선자와 직위 없음', tieElection.winnerId == null && tieElection.result !== 'plurality' && tieCall.body.reason === 'TIE' && tieCall.body.officeGranted === false && after.guard.status === 'vacant' && after.guard.leaderId == null && after.rank.members.filter(function (row) { return row.id === 'r3' || row.id === 'r4'; }).every(function (row) { return row.rank === 'representative'; }));
  ok('3', '0표 거부', zeroElection.winnerId == null && zeroCall.body.reason === 'ZERO_VOTES' && zeroCall.body.officeGranted === false && after.usGuard.status === 'vacant' && after.usGuard.leaderId == null);
  ok('4', '중단과 오류 거부', haltedCall.body.reason === 'HALTED' && errorCall.body.reason === 'VOTE_ERROR' && haltedCall.body.officeGranted === false && errorCall.body.officeGranted === false);
  ok('5', '다른 회차로 공석을 채우지 못함', wrongCall.body.reason === 'VACANCY_MISMATCH' && wrongCall.body.officeGranted === false);
  ok('6', '자격 상실 거부', lostCall.body.reason === 'NOT_REPRESENTATIVE' && lostCall.body.officeGranted === false);
  ok('7', '중앙과 외계 거부', centralCall.body.reason === 'TERRITORY_NOT_ELIGIBLE' && alienCall.body.reason === 'TERRITORY_NOT_ELIGIBLE');
  ok('8', '저장 실패는 성공이 아님', failedWrite.body.ok === false && failedWrite.body.reason === 'APPOINTMENT_STORE_WRITE_FAILED' && failedWrite.body.multiFileTransaction === false && sameAfterFail === true);
  ok('9', '실행 파일보다 먼저 멈춘 뒤 재시작 복구', crashed.body.reason === 'PARTIAL_WRITE' && crashed.body.stoppedBeforeRun === true && crashed.body.multiFileTransaction === false && afterCrash.office.leaderId === 'r1' && afterCrash.election.officeGranted === true && afterCrash.election.winnerId === 'r1' && afterCrash.run.officeGranted !== true && recoveryFail.body.ok === false && recoveryFail.body.reason === 'APPOINTMENT_STORE_WRITE_FAILED' && recovered.body.reason === 'RUN_LAG_RECOVERED' && recovered.body.grant !== true && recovered.body.winnerId === 'r1' && recovered.body.multiFileTransaction === false && after.office.leaderId === 'r1' && after.election.winnerId === 'r1' && after.election.officeGranted === true && after.run.officeGranted === true && after.run.appointment === true && after.rank.appointments.filter(function (row) { return row.filingRoundId === main.round.id; }).length === 1);
  ok('10', '최다 득표자 임명과 중복 거부', krMember.rank === 'leader' && krMember.excludedFromRepresentativeQuota === true && krMember.xp === 11 && stillRep.rank === 'representative' && citizen.rank === 'citizen' && duplicate.body.reason === 'APPOINTMENT_EXISTS' && duplicate.body.appointment.winnerId === 'r1' && krView.body.office.leaderId === 'r1' && krView.body.clientWinnerIgnored !== false);
  ok('11', '동시 요청은 지도자 1명', pair.filter(function (row) { return row.body.ok === true; }).length === 1 && pair.some(function (row) { return row.body.reason === 'APPOINTMENT_EXISTS'; }) && usView.body.office.leaderId === 'u1' && usView.body.appointments.length === 1 && usMember.rank === 'leader' && krView.body.office.leaderId === 'r1' && usView.body.office.country === 'US' && krView.body.office.territory === 'pioneer');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
