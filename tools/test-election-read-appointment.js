'use strict';
/**
 * 선거 조회는 저장된 임명과 맞을 때만 officeGranted true 다. 조회는 임명하지 않는다.
 * node tools/test-election-read-appointment.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
const vacancy = require('../server/impeachment-vacancy-service');
const service = require('../server/leader-appointment-service');
const appointmentHttp = require('../server/leader-appointment-dev-http');
const electionHttp = require('../server/leader-election-dev-http');
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
const hour = vote.HOUR_MS;
const filingEnd = removedAt + 10 * day;
const voteEnd = filingEnd + 48 * hour;
const electionHeader = { 'X-SentenceArena-Dev-Election': 'preview' };
const appointmentHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Leader-Appointment': 'preview' };
const clerk = { id: 'clerk', office: 'dev-clerk', verified: true, authSource: 'test-fixture' };
const windowOpen = { provided: true, open: true };
const usAdult = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'US', age_policy_region: 'US',
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

function people(count, country, territory) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ id: 'pop-' + country + '-' + territory + '-' + i, country: country, territory: territory, valid: true, lastPostAtMs: filingEnd - 1000 });
  }
  return { source: 'test-fixture', records: rows };
}

function removalRecord(id, country, territory) {
  return {
    id: 'dev-office-removal:' + id, citizenBallotId: id, country: country, territory: territory,
    leaderId: 'old-' + id, removedAtMs: removedAt, vacancyStartMs: removedAt, rankChanged: false,
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
    country: row.country, territory: row.territory, status: 'vacant', leaderId: null,
    removedAtMs: row.removedAtMs, vacancyStartMs: row.vacancyStartMs, season: 'season-kept', seasonEnd: null,
  };
}

function runFor(row, filingRoundId, status) {
  const plan = vacancy.byElectionPlan(row.removedAtMs);
  return {
    id: 'byrun-' + filingRoundId, citizenBallotId: row.citizenBallotId, country: row.country, territory: row.territory,
    removedAtMs: row.removedAtMs, filingRoundId: filingRoundId, parentFilingRoundId: null, status: status,
    filingStartMs: plan.filingStartMs, filingEndMs: plan.filingEndMs, officeGranted: false,
    votesOpened: status === 'vote_open', appointment: false, recordedCandidateId: status === 'uncontested_recorded' ? null : null,
    tieRule: false, lock: 'single-process',
  };
}

function member(id, country, territory) {
  return {
    id: id, country: country, territory: territory, rank: 'representative', comparisonScore: 80,
    uniquePositiveEvaluators: 200, firstQualificationUsed: {}, electedLeader: false,
    xp: 11, fame: 6, activity: 4, achievements: ['kept'],
  };
}

function openRound(electionStore, filingStore, country, territory, actors, eligibility) {
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
    filingRoundId: round.round.id, population: people(1000, country, territory),
  });
  return { round: round.round, opened: opened };
}

async function cast(store, ballot, country, territory, choice, index) {
  const result = await election.castVote(store, {
    ballotId: ballot.id,
    actor: { id: 'pop-' + country + '-' + territory + '-' + index, country: country, territory: territory, verified: true, authSource: 'test-fixture' },
    choice: choice, nowMs: filingEnd + 1000 + index, eligibility: country === 'US' ? usAdult : undefined,
  });
  if (!result.ok) throw new Error('cast ' + result.reason);
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-election-read-'));
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
  const mainRemoval = removalRecord('ballot-main', 'KR', 'pioneer');
  const soleRemoval = removalRecord('ballot-sole', 'US', 'pioneer');
  const tieRemoval = removalRecord('ballot-tie', 'KR', 'guardian');
  const zeroRemoval = removalRecord('ballot-zero', 'US', 'guardian');
  const main = openRound(electionStore, filingStore, 'KR', 'pioneer', [{ id: 'r1', name: '한결' }, { id: 'r2', name: '가온' }]);
  const sole = openRound(electionStore, filingStore, 'US', 'pioneer', [{ id: 'u1', name: 'Ari' }], usAdult);
  const tie = openRound(electionStore, filingStore, 'KR', 'guardian', [{ id: 'r3', name: '하람' }, { id: 'r4', name: '로운' }]);
  const partial = openRound(electionStore, filingStore, 'KR', 'guardian', [{ id: 'r5', name: '부분' }, { id: 'r6', name: '저장' }]);
  const zero = openRound(electionStore, filingStore, 'US', 'guardian', [{ id: 'u3', name: 'Eden' }, { id: 'u4', name: 'Wynn' }], usAdult);
  const lag = openRound(electionStore, filingStore, 'US', 'guardian', [{ id: 'u5', name: '지연' }, { id: 'u6', name: '복구' }], usAdult);
  [main, sole, tie, partial, zero, lag].forEach(function (item) {
    if (!item.opened.ok) throw new Error('open ' + item.opened.reason);
  });
  main.round.byElectionBallotId = mainRemoval.citizenBallotId;
  sole.round.byElectionBallotId = soleRemoval.citizenBallotId;
  tie.round.byElectionBallotId = tieRemoval.citizenBallotId;
  partial.round.byElectionBallotId = tieRemoval.citizenBallotId;
  zero.round.byElectionBallotId = zeroRemoval.citizenBallotId;
  lag.round.byElectionBallotId = zeroRemoval.citizenBallotId;
  for (let index = 0; index < 3; index += 1) await cast(electionStore, main.opened.ballot, 'KR', 'pioneer', 'r1', index);
  await cast(electionStore, main.opened.ballot, 'KR', 'pioneer', 'r2', 3);
  await cast(electionStore, tie.opened.ballot, 'KR', 'guardian', 'r3', 0);
  await cast(electionStore, tie.opened.ballot, 'KR', 'guardian', 'r4', 1);
  for (let index = 0; index < 3; index += 1) await cast(electionStore, partial.opened.ballot, 'KR', 'guardian', 'r5', index + 2);
  for (let index = 0; index < 3; index += 1) await cast(electionStore, lag.opened.ballot, 'US', 'guardian', 'u5', index);
  for (const item of [tie, partial, zero, lag]) {
    const closed = await election.closeBallot(electionStore, { ballotId: item.opened.ballot.id, nowMs: voteEnd });
    if (!closed.ok) throw new Error('close ' + closed.reason);
  }
  const removals = [mainRemoval, soleRemoval, tieRemoval, zeroRemoval];
  vacancy.writeStore(paths.vacancy, {
    offices: removals.map(officeFor), removals: removals, schedules: removals.map(scheduleFor),
    seasons: [{ id: 'season-kept', end: null }],
  });
  election.writeStore(paths.election, electionStore);
  filing.writeStore(paths.filing, filingStore);
  const runs = [
    runFor(mainRemoval, main.round.id, 'vote_open'),
    runFor(soleRemoval, sole.round.id, 'uncontested_recorded'),
    runFor(tieRemoval, tie.round.id, 'vote_open'),
    runFor(tieRemoval, partial.round.id, 'vote_open'),
    runFor(zeroRemoval, zero.round.id, 'vote_open'),
    runFor(zeroRemoval, lag.round.id, 'vote_open'),
  ];
  runs[1].recordedCandidateId = 'u1';
  fs.writeFileSync(paths.run, JSON.stringify({ runs: runs }, null, 2));
  service.writeRankStore(paths.rank, {
    members: [
      member('r1', 'KR', 'pioneer'), member('r2', 'KR', 'pioneer'), Object.assign(member('c1', 'KR', 'pioneer'), { rank: 'citizen' }),
      member('r3', 'KR', 'guardian'), member('r4', 'KR', 'guardian'), member('r5', 'KR', 'guardian'), member('r6', 'KR', 'guardian'),
      member('u1', 'US', 'pioneer'), member('u3', 'US', 'guardian'), member('u4', 'US', 'guardian'),
      member('u5', 'US', 'guardian'), member('u6', 'US', 'guardian'),
    ],
    appointments: [], relinquishments: [], refreshes: [],
  });
  fs.writeFileSync(paths.citizen, JSON.stringify({ ballots: [], votes: [], blocks: [] }));

  const electionPort = 3023;
  const appointmentPort = 3024;
  const electionServer = await electionHttp.listen(electionPort, paths.election, paths.filing, paths);
  const appointmentServer = await appointmentHttp.listen(appointmentPort, paths);
  function readElection(id) {
    return request(electionPort, 'GET', '/dev/leader-election/elections/' + encodeURIComponent(id), null, electionHeader);
  }
  function readOffice(country, territory) {
    return request(appointmentPort, 'GET', '/dev/leader-appointment/offices/' + country + '/' + territory, null, appointmentHeader);
  }
  function appoint(roundId, nowMs, extra) {
    return request(appointmentPort, 'POST', '/dev/leader-appointment/appointments', Object.assign({
      filingRoundId: roundId, clockSource: 'test-fixture', nowMs: nowMs, winnerId: 'forged', officeGranted: true, candidateCount: 4,
    }, extra || {}), appointmentHeader);
  }
  const beforeReads = fs.readFileSync(paths.rank);
  const openRead = await readElection(main.opened.election.id);
  const openOffice = await readOffice('KR', 'pioneer');
  const disk = election.readStore(paths.election);
  const closed = await election.closeBallot(disk, { ballotId: main.opened.ballot.id, nowMs: voteEnd });
  if (!closed.ok) throw new Error('main close ' + closed.reason);
  election.writeStore(paths.election, disk);
  const closedRow = disk.elections.filter(function (row) { return row.id === main.opened.election.id; })[0];
  const closedRead = await readElection(main.opened.election.id);
  const closedOffice = await readOffice('KR', 'pioneer');
  const appointed = await appoint(main.round.id, voteEnd);
  const afterPlural = await readElection(main.opened.election.id);
  const afterPluralOffice = await readOffice('KR', 'pioneer');
  const soleAppointed = await appoint(sole.round.id, filingEnd);
  const afterSole = await readElection(sole.opened.election.id);
  const afterSoleOffice = await readOffice('US', 'pioneer');
  const tieRead = await readElection(tie.opened.election.id);
  const tieOffice = await readOffice('KR', 'guardian');
  const zeroRead = await readElection(zero.opened.election.id);
  const zeroOffice = await readOffice('US', 'guardian');
  const crashed = await appoint(partial.round.id, voteEnd, { crashBeforeGrant: true });
  const partialRead = await readElection(partial.opened.election.id);
  const partialOffice = await readOffice('KR', 'guardian');
  const lagged = await appoint(lag.round.id, voteEnd, { crashBeforeRun: true });
  const lagRead = await readElection(lag.opened.election.id);
  const lagOffice = await readOffice('US', 'guardian');
  await closeServer(appointmentServer);
  const appointmentServer2 = await appointmentHttp.listen(appointmentPort, paths);
  const recovered = await appoint(lag.round.id, voteEnd);
  const lagAfter = await readElection(lag.opened.election.id);
  const lagOfficeAfter = await readOffice('US', 'guardian');
  const closeAt = voteEnd + hour;
  fs.writeFileSync(paths.citizen, JSON.stringify({
    ballots: [{
      id: 'citizen-r1', voteKind: 'citizen_impeachment_48h', proposalId: 'imp-r1', country: 'KR', territory: 'pioneer',
      leaderId: 'r1', leaderName: '한결', status: 'closed', result: 'passed', closedOnce: true,
      startsAtMs: closeAt - 48 * hour, endsAtMs: closeAt, closedAtMs: closeAt,
    }],
    votes: [], blocks: [],
  }));
  const removed = await request(appointmentPort, 'POST', '/dev/leader-appointment/removals', {
    ballotId: 'citizen-r1', clockSource: 'test-fixture', nowMs: closeAt,
  }, appointmentHeader);
  const clearedRead = await readElection(main.opened.election.id);
  const clearedOffice = await readOffice('KR', 'pioneer');
  const rankBeforeSecondRead = fs.readFileSync(paths.rank);
  const electionBeforeSecondRead = fs.readFileSync(paths.election);
  await readElection(main.opened.election.id);
  await readOffice('KR', 'pioneer');
  const readDidNotWrite = fs.readFileSync(paths.rank).equals(rankBeforeSecondRead) && fs.readFileSync(paths.election).equals(electionBeforeSecondRead);
  await closeServer(electionServer);
  await closeServer(appointmentServer2);

  const openView = openRead.body.publicView;
  const closedView = closedRead.body.publicView;
  const pluralView = afterPlural.body.publicView;
  const soleView = afterSole.body.publicView;
  const tieView = tieRead.body.publicView;
  const zeroView = zeroRead.body.publicView;
  const partialView = partialRead.body.publicView;
  const lagView = lagRead.body.publicView;
  const lagDone = lagAfter.body.publicView;
  const clearedView = clearedRead.body.publicView;
  const pluralMember = (afterPluralOffice.body.members || []).filter(function (row) { return row.id === 'r1'; })[0];
  const citizen = (afterPluralOffice.body.members || []).filter(function (row) { return row.id === 'c1'; })[0];
  const clearedMember = (clearedOffice.body.members || []).filter(function (row) { return row.id === 'r1'; })[0];
  ok('1', '투표 중 officeGranted false', openView.appointmentCheck === 'VOTE_OPEN' && openView.officeGranted === false && openView.voteClosed === false && openView.appointmentComplete === false && openOffice.body.office.status === 'vacant' && openOffice.body.office.leaderId == null);
  ok('2', '종료 후 당선 기록만으로는 임명 아님', closed.ok === true && closedRow.winnerId === 'r1' && closedRow.officeGranted === false && closedView.officeGranted === false && closedView.voteClosed === true && closedView.winnerId === 'r1' && closedView.appointmentCheck === 'WINNER_NOT_APPOINTED' && closedView.appointmentComplete === false && closedOffice.body.office.status === 'vacant');
  ok('3', '복수 임명 후 조회 일치', appointed.body.officeGranted === true && pluralView.officeGranted === true && pluralView.appointmentComplete === true && pluralView.appointmentCheck === 'APPOINTMENT_COMPLETE' && pluralView.winnerId === 'r1' && pluralView.voteClosed === true && afterPluralOffice.body.office.leaderId === 'r1' && afterPluralOffice.body.office.status === 'sitting' && pluralMember.rank === 'leader' && citizen.rank === 'citizen' && afterPluralOffice.body.appointments.length === 1 && afterPluralOffice.body.appointments[0].officeGranted === true && pluralView.multiFileTransaction === false && pluralView.appointedByThisRead === false);
  ok('4', '단독 임명 후 조회 일치', soleAppointed.body.officeGranted === true && soleView.officeGranted === true && soleView.appointmentComplete === true && soleView.voteClosed === false && soleView.winnerId === 'u1' && afterSoleOffice.body.office.leaderId === 'u1' && afterSoleOffice.body.appointments[0].winnerId === 'u1' && afterPluralOffice.body.office.leaderId === 'r1');
  ok('5', '중단된 부분 저장은 완료로 보이지 않음', crashed.body.reason === 'PARTIAL_WRITE' && partialView.officeGranted === false && partialView.appointmentComplete === false && partialView.appointmentCheck === 'PARTIAL_STATE' && partialView.recoveryNeeded === true && partialView.appointmentParts.electionOfficeGranted === false && partialView.appointmentParts.officeStatus === 'sitting' && partialOffice.body.office.leaderId === 'r5' && partialView.storedElectionOfficeGranted === false);
  ok('6', '실행 파일 지연과 복구 후 일치', lagged.body.reason === 'PARTIAL_WRITE' && lagView.officeGranted === false && lagView.appointmentCheck === 'RUN_LAG' && lagView.appointmentParts.electionOfficeGranted === true && lagView.appointmentParts.runOfficeGranted === false && lagOffice.body.office.leaderId === 'u5' && recovered.body.reason === 'RUN_LAG_RECOVERED' && lagDone.officeGranted === true && lagDone.appointmentComplete === true && lagDone.appointmentParts.runOfficeGranted === true && lagDone.appointmentParts.runAppointment === true && lagOfficeAfter.body.office.leaderId === 'u5' && lagOfficeAfter.body.appointments[0].officeGranted === true);
  ok('7', '동률과 0표는 당선자와 직위 없음', tieView.officeGranted === false && tieView.appointmentCheck === 'NO_WINNER' && tieView.winnerId == null && tieView.voteClosed === true && tieOffice.body.office.leaderId == null && zeroView.officeGranted === false && zeroView.appointmentCheck === 'NO_WINNER' && zeroView.winnerId == null && zeroOffice.body.office.status === 'vacant');
  ok('8', '탄핵으로 직위가 비면 임명 완료가 아님', removed.body.ok === true && clearedView.officeGranted === false && clearedView.appointmentComplete === false && clearedView.appointmentCheck === 'OFFICE_CLEARED' && clearedView.recoveryNeeded === false && clearedView.storedElectionOfficeGranted === true && clearedView.voteClosed === true && clearedOffice.body.office.status === 'vacant' && clearedOffice.body.office.leaderId == null && clearedMember.rank === 'citizen' && readDidNotWrite === true && beforeReads.length > 0);
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log(JSON.stringify({
      open: openView && openView.appointmentCheck,
      closed: closedView && closedView.appointmentCheck,
      plural: pluralView && pluralView.appointmentCheck,
      sole: soleView && soleView.appointmentCheck,
      partial: partialView && partialView.appointmentCheck,
      lag: lagView && lagView.appointmentCheck,
      lagDone: lagDone && lagDone.appointmentCheck,
      tie: tieView && tieView.appointmentCheck,
      zero: zeroView && zeroView.appointmentCheck,
      cleared: clearedView && clearedView.appointmentCheck,
      removed: removed.body && removed.body.reason,
      crashed: crashed.body && crashed.body.reason,
      recovered: recovered.body && recovered.body.reason,
    }));
    process.exitCode = 1;
  }
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
