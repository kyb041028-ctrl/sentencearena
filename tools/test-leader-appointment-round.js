'use strict';
/**
 * 단독 임명은 그 보궐 회차의 접수 종료 뒤에만 한다. 운영 DB를 열지 않는다.
 * node tools/test-leader-appointment-round.js
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
const filingStart = removedAt + 7 * day;
const filingEnd = removedAt + 10 * day;
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

function removalRecord(id, country, territory, at) {
  return {
    id: 'dev-office-removal:' + id,
    citizenBallotId: id,
    country: country,
    territory: territory,
    leaderId: 'old-' + id,
    removedAtMs: at,
    vacancyStartMs: at,
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

function runFor(row, filingRoundId, status, winnerId, parentId) {
  const plan = vacancy.byElectionPlan(row.removedAtMs);
  const start = parentId ? plan.filingEndMs + 7 * day : plan.filingStartMs;
  const end = parentId ? start + 3 * day : plan.filingEndMs;
  return {
    id: 'byrun-' + filingRoundId,
    citizenBallotId: row.citizenBallotId,
    country: row.country,
    territory: row.territory,
    removedAtMs: row.removedAtMs,
    filingRoundId: filingRoundId,
    parentFilingRoundId: parentId || null,
    status: status,
    filingStartMs: start,
    filingEndMs: end,
    officeGranted: false,
    votesOpened: status === 'vote_open',
    recordedCandidateId: winnerId || null,
    lock: 'single-process',
  };
}

function member(id, country, territory, rankName) {
  return {
    id: id,
    country: country,
    territory: territory,
    rank: rankName,
    comparisonScore: 80,
    uniquePositiveEvaluators: 200,
    firstQualificationUsed: {},
    electedLeader: false,
    xp: 11,
    fame: 6,
    activity: 4,
    achievements: ['kept'],
  };
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

function fileOne(electionStore, filingStore, country, territory, actorId, name, eligibility) {
  const filed = filing.fileCandidacy(filingStore, {
    actor: { id: actorId, name: name, devAuth: true, country: country, territory: territory, office: 'representative' },
    country: country,
    territory: territory,
    window: windowOpen,
    nowMs: filingEnd,
    intentConfirmed: true,
    eligibility: eligibility,
  });
  const round = election.openFilingRound(electionStore, { actor: clerk, country: country, territory: territory, window: windowOpen });
  election.applyToRound(electionStore, filingStore, {
    actor: clerk,
    filingRoundId: round.round.id,
    candidacyId: filed.candidacy.id,
    window: { provided: true },
  });
  election.reviewCandidacy(electionStore, filingStore, {
    actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'start_review', window: { provided: true },
  });
  election.reviewCandidacy(electionStore, filingStore, {
    actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'approve', window: { provided: true },
  });
  election.closeRegistration(electionStore, {
    actor: clerk, country: country, territory: territory, filingRoundId: round.round.id, window: { provided: true, closing: true },
  });
  const opened = election.openElection(electionStore, {
    country: country,
    territory: territory,
    nowMs: filingEnd,
    window: { provided: true },
    filingRoundId: round.round.id,
    population: people(1000, country, territory, filingEnd),
  });
  round.round.byElectionBallotId = null;
  return { round: round.round, opened: opened, candidacyId: filed.candidacy.id };
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-appoint-round-'));
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
  const mainRemoval = removalRecord('ballot-main', 'KR', 'pioneer', removedAt);
  const wrongRemoval = removalRecord('ballot-wrong', 'KR', 'pioneer', removedAt - 30 * day);
  const guardRemoval = removalRecord('ballot-guard', 'KR', 'guardian', removedAt);
  const pathRemoval = removalRecord('ballot-path', 'US', 'guardian', removedAt);
  const liveAt = Date.now();
  const liveRemoval = removalRecord('ballot-live', 'US', 'pioneer', liveAt);

  const main = fileOne(electionStore, filingStore, 'KR', 'pioneer', 'r1', '한결');
  const wrong = fileOne(electionStore, filingStore, 'KR', 'pioneer', 'r2', '가온');
  const oldRound = fileOne(electionStore, filingStore, 'KR', 'guardian', 'r3', '하람');
  const newRound = fileOne(electionStore, filingStore, 'KR', 'guardian', 'r4', '로운');
  const lost = fileOne(electionStore, filingStore, 'US', 'guardian', 'u3', 'Noa', usAdult);
  const crashRound = fileOne(electionStore, filingStore, 'US', 'guardian', 'u4', 'Eden', usAdult);
  const emptyRound = election.openFilingRound(electionStore, { actor: clerk, country: 'US', territory: 'guardian', window: windowOpen });
  election.closeRegistration(electionStore, {
    actor: clerk, country: 'US', territory: 'guardian', filingRoundId: emptyRound.round.id, window: { provided: true, closing: true },
  });
  const emptyOpened = election.openElection(electionStore, {
    country: 'US', territory: 'guardian', nowMs: filingEnd, window: { provided: true },
    filingRoundId: emptyRound.round.id, population: people(1000, 'US', 'guardian', filingEnd),
  });
  const multiRound = election.openFilingRound(electionStore, { actor: clerk, country: 'US', territory: 'guardian', window: windowOpen });
  ['u5', 'u6'].forEach(function (id, index) {
    const filed = filing.fileCandidacy(filingStore, {
      actor: { id: id, name: id, devAuth: true, country: 'US', territory: 'guardian', office: 'representative' },
      country: 'US', territory: 'guardian', window: windowOpen, nowMs: filingEnd, intentConfirmed: true, eligibility: usAdult,
    });
    election.applyToRound(electionStore, filingStore, {
      actor: clerk, filingRoundId: multiRound.round.id, candidacyId: filed.candidacy.id, window: { provided: true },
    });
    election.reviewCandidacy(electionStore, filingStore, {
      actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: multiRound.round.id, action: 'start_review', window: { provided: true },
    });
    election.reviewCandidacy(electionStore, filingStore, {
      actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: multiRound.round.id, action: 'approve', window: { provided: true },
    });
    void index;
  });
  election.closeRegistration(electionStore, {
    actor: clerk, country: 'US', territory: 'guardian', filingRoundId: multiRound.round.id, window: { provided: true, closing: true },
  });
  const multiOpened = election.openElection(electionStore, {
    country: 'US', territory: 'guardian', nowMs: filingEnd, window: { provided: true },
    filingRoundId: multiRound.round.id, population: people(1000, 'US', 'guardian', filingEnd),
  });
  const liveRound = fileOne(electionStore, filingStore, 'US', 'pioneer', 'u1', 'Ari', usAdult);
  if (!main.opened.ok || !wrong.opened.ok || !oldRound.opened.ok || !newRound.opened.ok || !lost.opened.ok || !crashRound.opened.ok || !emptyOpened.ok || !multiOpened.ok || !liveRound.opened.ok) {
    throw new Error('fixture open failed');
  }
  main.round.byElectionBallotId = mainRemoval.citizenBallotId;
  wrong.round.byElectionBallotId = wrongRemoval.citizenBallotId;
  oldRound.round.byElectionBallotId = guardRemoval.citizenBallotId;
  newRound.round.byElectionBallotId = guardRemoval.citizenBallotId;
  lost.round.byElectionBallotId = pathRemoval.citizenBallotId;
  crashRound.round.byElectionBallotId = pathRemoval.citizenBallotId;
  emptyRound.round.byElectionBallotId = pathRemoval.citizenBallotId;
  multiRound.round.byElectionBallotId = pathRemoval.citizenBallotId;
  liveRound.round.byElectionBallotId = liveRemoval.citizenBallotId;

  const refileRun = runFor(guardRemoval, newRound.round.id, 'uncontested_recorded', 'r4', oldRound.round.id);
  const runs = [
    runFor(mainRemoval, main.round.id, 'uncontested_recorded', 'r1'),
    runFor(wrongRemoval, wrong.round.id, 'uncontested_recorded', 'r2'),
    runFor(guardRemoval, oldRound.round.id, 'uncontested_recorded', 'r3'),
    refileRun,
    runFor(pathRemoval, lost.round.id, 'uncontested_recorded', 'u3'),
    runFor(pathRemoval, crashRound.round.id, 'uncontested_recorded', 'u4'),
    runFor(pathRemoval, emptyRound.round.id, 'weekly_refiling_waiting', null),
    runFor(pathRemoval, multiRound.round.id, 'vote_open', null),
    runFor(liveRemoval, liveRound.round.id, 'uncontested_recorded', 'u1'),
  ];
  const offices = [mainRemoval, guardRemoval, pathRemoval, liveRemoval].map(officeFor);
  offices.forEach(function (row) {
    if (row.territory === 'pioneer' && row.country === 'KR') row.removedAtMs = mainRemoval.removedAtMs;
  });
  vacancy.writeStore(paths.vacancy, {
    offices: offices,
    removals: [mainRemoval, wrongRemoval, guardRemoval, pathRemoval, liveRemoval],
    schedules: [mainRemoval, wrongRemoval, guardRemoval, pathRemoval, liveRemoval].map(scheduleFor),
    seasons: [{ id: 'season-kept', end: null }],
  });
  election.writeStore(paths.election, electionStore);
  filing.writeStore(paths.filing, filingStore);
  fs.writeFileSync(paths.run, JSON.stringify({ runs: runs }, null, 2));
  service.writeRankStore(paths.rank, {
    members: [
      member('r1', 'KR', 'pioneer', 'representative'),
      member('r2', 'KR', 'pioneer', 'representative'),
      member('c1', 'KR', 'pioneer', 'citizen'),
      member('r3', 'KR', 'guardian', 'representative'),
      member('r4', 'KR', 'guardian', 'representative'),
      member('u3', 'US', 'guardian', 'citizen'),
      member('u4', 'US', 'guardian', 'representative'),
      member('u1', 'US', 'pioneer', 'representative'),
    ],
    appointments: [],
    relinquishments: [],
    refreshes: [],
  });

  const port = 3020;
  let server = await httpDev.listen(port, paths);
  function post(body) {
    return request(port, 'POST', '/dev/leader-appointment/appointments', body, header);
  }
  function at(roundId, atMs, extra) {
    return post(Object.assign({
      filingRoundId: roundId,
      clockSource: 'test-fixture',
      nowMs: atMs,
      winnerId: 'forged',
      officeGranted: true,
      candidateCount: 9,
    }, extra || {}));
  }

  const rightAfter = await at(main.round.id, removedAt);
  const justBefore7 = await at(main.round.id, filingStart - 1);
  const browserClock = await post({
    filingRoundId: liveRound.round.id,
    clockSource: 'browser',
    nowMs: liveAt + 10 * day,
    winnerId: 'forged',
    officeGranted: true,
    candidateCount: 1,
  });
  const duringFiling = await at(main.round.id, filingStart);
  const justBeforeClose = await at(main.round.id, filingEnd - 1);
  const officeBeforeAppoint = vacancy.readStore(paths.vacancy).offices.filter(function (row) {
    return row.country === 'KR' && row.territory === 'pioneer';
  })[0];
  const appointed = await at(main.round.id, filingEnd);
  const viewed = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  const again = await at(main.round.id, filingEnd + 5);
  const wrongCall = await at(wrong.round.id, filingEnd);
  const oldCall = await at(oldRound.round.id, refileRun.filingEndMs);
  const refileTooSoon = await at(newRound.round.id, refileRun.filingStartMs);
  const refileAtOldEnd = await at(newRound.round.id, filingEnd);
  const refileOk = await at(newRound.round.id, refileRun.filingEndMs);
  const lostCall = await at(lost.round.id, filingEnd);
  const zeroCall = await at(emptyRound.round.id, filingEnd);
  const multiCall = await at(multiRound.round.id, filingEnd);
  const beforeRollback = {
    vacancy: fs.readFileSync(paths.vacancy),
    rank: fs.readFileSync(paths.rank),
    election: fs.readFileSync(paths.election),
  };
  const rollback = await at(crashRound.round.id, filingEnd, { failAfterOffice: true });
  const afterRollback = fs.readFileSync(paths.vacancy).equals(beforeRollback.vacancy)
    && fs.readFileSync(paths.rank).equals(beforeRollback.rank)
    && fs.readFileSync(paths.election).equals(beforeRollback.election);
  const crash = await at(crashRound.round.id, filingEnd, { crashBeforeGrant: true });
  const crashedOffice = vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.country === 'US' && row.territory === 'guardian'; })[0];
  const crashedMember = service.readRankStore(paths.rank).members.filter(function (row) { return row.id === 'u4'; })[0];
  const crashedElection = election.readStore(paths.election).elections.filter(function (row) { return row.filingRoundId === crashRound.round.id; })[0];
  const recovered = await at(crashRound.round.id, filingEnd);
  const recoveredOffice = vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.country === 'US' && row.territory === 'guardian'; })[0];
  const recoveredMember = service.readRankStore(paths.rank).members.filter(function (row) { return row.id === 'u4'; })[0];
  const recoveredElection = election.readStore(paths.election).elections.filter(function (row) { return row.filingRoundId === crashRound.round.id; })[0];
  const recoveredAfter = await at(crashRound.round.id, filingEnd);
  await closeServer(server);
  server = await httpDev.listen(port, paths);
  const restarted = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  await closeServer(server);
  server = null;

  const mainMember = (viewed.body.members || []).filter(function (row) { return row.id === 'r1'; })[0];
  const stillCitizen = (viewed.body.members || []).filter(function (row) { return row.id === 'c1'; })[0];
  const appointment = (viewed.body.appointments || [])[0];
  const zeroRun = JSON.parse(fs.readFileSync(paths.run, 'utf8')).runs.filter(function (row) { return row.filingRoundId === emptyRound.round.id; })[0];
  const multiRun = JSON.parse(fs.readFileSync(paths.run, 'utf8')).runs.filter(function (row) { return row.filingRoundId === multiRound.round.id; })[0];

  ok('1', '해임 직후 거부', rightAfter.body.reason === 'VACANCY_WINDOW' && rightAfter.body.officeGranted === false && browserClock.body.reason === 'VACANCY_WINDOW' && browserClock.body.clientWinnerIgnored === true);
  ok('2', '7일 직전 거부', justBefore7.body.reason === 'VACANCY_WINDOW' && justBefore7.body.officeGranted === false);
  ok('3', '7일 뒤 접수 중 거부', duringFiling.body.reason === 'FILING_STILL_OPEN' && duringFiling.body.officeGranted === false);
  ok('4', '10일 종료 직전 거부', justBeforeClose.body.reason === 'FILING_STILL_OPEN' && officeBeforeAppoint.status === 'vacant' && officeBeforeAppoint.leaderId == null);
  ok('5', '접수 종료 후 단독 임명', appointed.status === 200 && appointed.body.officeGranted === true && appointed.body.multiFileTransaction === false && viewed.body.office.status === 'sitting' && viewed.body.office.leaderId === 'r1' && mainMember.rank === 'leader' && mainMember.excludedFromRepresentativeQuota === true && mainMember.xp === 11 && mainMember.fame === 6 && mainMember.activity === 4 && JSON.stringify(mainMember.achievements) === JSON.stringify(['kept']) && stillCitizen.rank === 'citizen' && appointment.citizenBallotId === 'ballot-main' && appointment.filingRoundId === main.round.id && viewed.body.elections.some(function (row) { return row.filingRoundId === main.round.id && row.officeGranted === true && row.winnerId === 'r1'; }) && viewed.body.representativeIds.indexOf('r1') < 0);
  ok('6', '다른 공석 회차 거부', wrongCall.body.reason === 'VACANCY_MISMATCH' && wrongCall.body.officeGranted === false);
  ok('7', '이전 회차 재사용 거부', oldCall.body.reason === 'SUPERSEDED_ROUND' && refileTooSoon.body.reason === 'FILING_STILL_OPEN' && refileAtOldEnd.body.reason === 'VACANCY_WINDOW' && refileOk.status === 200 && refileOk.body.office && refileOk.body.office.leaderId === 'r4' && refileOk.body.appointment.filingRoundId === newRound.round.id);
  ok('8', '자격 상실 거부', lostCall.body.reason === 'NOT_REPRESENTATIVE' && lostCall.body.officeGranted === false);
  ok('9', '0명과 2명 이상은 단독 임명 거부', emptyOpened.election.status === 'weekly_refiling_waiting' && multiOpened.election.status === 'open' && zeroCall.body.reason === 'NOT_SOLE_ROUND' && multiCall.body.reason === 'NOT_SOLE_ROUND' && zeroRun.status === 'weekly_refiling_waiting' && multiRun.status === 'vote_open' && zeroRun.officeGranted === false && multiRun.officeGranted === false);
  ok('10', '재요청 중복 방지', again.body.reason === 'APPOINTMENT_EXISTS' && service.readRankStore(paths.rank).appointments.filter(function (row) { return row.filingRoundId === main.round.id; }).length === 1);
  ok('11', '저장 실패와 부분 상태 복구', rollback.body.reason === 'APPOINTMENT_STORE_WRITE_FAILED' && rollback.body.multiFileTransaction === false && afterRollback === true && crash.body.reason === 'PARTIAL_WRITE' && crash.body.partialWriteLeft === true && crash.body.multiFileTransaction === false && crashedOffice.status === 'sitting' && crashedMember.rank === 'leader' && crashedElection.officeGranted !== true && recovered.body.reason === 'PARTIAL_STATE_RECOVERED' && recoveredOffice.status === 'vacant' && recoveredOffice.leaderId == null && recoveredMember.rank === 'representative' && recoveredMember.xp === 11 && recoveredElection.officeGranted !== true && recoveredAfter.body.officeGranted === true && recoveredAfter.body.office.leaderId === 'u4');
  ok('12', '재시작 후 일치', restarted.body.office.status === 'sitting' && restarted.body.office.leaderId === 'r1' && restarted.body.appointments[0].winnerId === 'r1' && restarted.body.appointments[0].officeGranted === true && restarted.body.elections.some(function (row) { return row.winnerId === 'r1' && row.officeGranted === true; }) && (restarted.body.members || []).some(function (row) { return row.id === 'r1' && row.rank === 'leader'; }));

  const earlyVacant = rightAfter.body.officeGranted === false && justBefore7.body.officeGranted === false && duringFiling.body.officeGranted === false && justBeforeClose.body.officeGranted === false;
  if (!earlyVacant) console.log('early window changed office');
  console.log(passed + ' passed, ' + failed + ' failed');
  const outDir = 'C:/Users/user/AppData/Local/Cursor/AgentStores/cursor_agent_stores/bc-c953b949-98fb-4f5d-8b49-80c8cb69e605/files/media/leader-appointment-round';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.txt'), [
    failed === 0 ? 'PASS' : 'FAIL',
    '단독 임명은 그 보궐 회차의 접수 종료 뒤에만 한다.',
    '시작 HEAD: 5f149df4e4f2eb14c43066ed60256a4da15717f3',
    'JSON 잠금: 단일 프로세스',
    '여러 JSON은 프로세스 중단 시 트랜잭션이 아님',
    '시간대: 미확정',
    'formulaStatus: FORMULA_UNCONFIRMED',
    'productionAuth: false',
    'Postgres: 접근하지 않음',
    scenario.join('\n'),
    '하지 않은 항목: 복수 승자 확정, 동률 해소, 시즌 종료 자동화.',
  ].join('\n') + '\n');
  if (failed) process.exitCode = 1;
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
