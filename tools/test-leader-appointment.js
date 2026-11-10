'use strict';
/**
 * 단독 당선 임명과 탄핵 뒤 임시 시민. 운영 DB를 열지 않는다.
 * node tools/test-leader-appointment.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
const vacancy = require('../server/impeachment-vacancy-service');
const service = require('../server/leader-appointment-service');
const httpDev = require('../server/leader-appointment-dev-http');
const rank = require('../shared/dec023-rank-evaluation-core');
const legal = require('../shared/legal-gate-core');
const vote = require('../shared/vote-engine-core');

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

const now = 1700000000000;
const day = vacancy.DAY_MS;
const hour = vote.HOUR_MS;
const header = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Leader-Appointment': 'preview' };
const repo = path.join(__dirname, '..');
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

function people(count, country, territory) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ id: 'v' + country + territory + i, country: country, territory: territory, valid: true, lastPostAtMs: now - 1000 });
  }
  return { source: 'test-fixture', records: rows };
}

function member(id, country, territory, rankName, score, evaluators, stats) {
  const extra = stats || {};
  return {
    id: id,
    country: country,
    territory: territory,
    rank: rankName,
    comparisonScore: score,
    uniquePositiveEvaluators: evaluators,
    firstQualificationUsed: {},
    electedLeader: false,
    excludedFromRepresentativeQuota: false,
    xp: extra.xp != null ? extra.xp : 1,
    fame: extra.fame != null ? extra.fame : 1,
    activity: extra.activity != null ? extra.activity : 1,
    achievements: extra.achievements || [],
  };
}

function office(country, territory) {
  return {
    country: country,
    territory: territory,
    status: 'vacant',
    leaderId: null,
    rank: 'representative',
    season: 'season-kept',
    seasonEnd: null,
  };
}

function openSole(electionStore, filingStore, country, territory, actorId, name, eligibility) {
  const filed = filing.fileCandidacy(filingStore, {
    actor: { id: actorId, name: name, devAuth: true, country: country, territory: territory, office: 'representative' },
    country: country,
    territory: territory,
    window: windowOpen,
    nowMs: now,
    intentConfirmed: true,
    eligibility: eligibility,
  });
  const round = election.openFilingRound(electionStore, { actor: clerk, country: country, territory: territory, window: windowOpen });
  const applied = election.applyToRound(electionStore, filingStore, {
    actor: clerk,
    filingRoundId: round.round && round.round.id,
    candidacyId: filed.candidacy && filed.candidacy.id,
    window: { provided: true },
  });
  const started = election.reviewCandidacy(electionStore, filingStore, {
    actor: clerk,
    candidacyId: filed.candidacy && filed.candidacy.id,
    filingRoundId: round.round && round.round.id,
    action: 'start_review',
    window: { provided: true },
  });
  const approved = election.reviewCandidacy(electionStore, filingStore, {
    actor: clerk,
    candidacyId: filed.candidacy && filed.candidacy.id,
    filingRoundId: round.round && round.round.id,
    action: 'approve',
    window: { provided: true },
  });
  const closed = election.closeRegistration(electionStore, {
    actor: clerk,
    country: country,
    territory: territory,
    filingRoundId: round.round && round.round.id,
    window: { provided: true, closing: true },
  });
  const opened = election.openElection(electionStore, {
    country: country,
    territory: territory,
    nowMs: now,
    window: { provided: true },
    filingRoundId: round.round && round.round.id,
    population: people(1000, country, territory),
  });
  return { filed: filed, round: round, applied: applied, started: started, approved: approved, closed: closed, opened: opened };
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-appoint-'));
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
  const sole = openSole(electionStore, filingStore, 'KR', 'pioneer', 'r1', '한결');
  const usSole = openSole(electionStore, filingStore, 'US', 'pioneer', 'u1', 'Ari', usAdult);
  if (!sole.opened.ok || !usSole.opened.ok) {
    throw new Error('fixture ' + (sole.opened.reason || usSole.opened.reason));
  }
  const members = [
    member('r1', 'KR', 'pioneer', 'representative', 50, 25, { xp: 10, fame: 7, activity: 3, achievements: ['badge'] }),
    member('r2', 'KR', 'pioneer', 'representative', 100, 200),
  ];
  for (let i = 1; i <= 8; i += 1) members.push(member('p' + i, 'KR', 'pioneer', 'representative', 100, 200));
  members.push(member('c1', 'KR', 'pioneer', 'citizen', 90, 150));
  members.push(member('c2', 'KR', 'pioneer', 'citizen', 80, 0));
  members.push(member('c3', 'KR', 'pioneer', 'citizen', 70, 0));
  members.push(member('c4', 'KR', 'pioneer', 'citizen', null, 0));
  members.push(member('c5', 'KR', 'pioneer', 'citizen', null, 0));
  members.push(member('c6', 'KR', 'pioneer', 'citizen', null, 0));
  members.push(member('g1', 'KR', 'guardian', 'representative', 100, 200, { xp: 5, fame: 5, activity: 5, achievements: ['g'] }));
  members.push(member('u1', 'US', 'pioneer', 'representative', 100, 200, { xp: 4, fame: 4, activity: 4, achievements: ['us'] }));
  members.push(member('u2', 'US', 'guardian', 'representative', 100, 200, { xp: 2, fame: 2, activity: 2, achievements: ['ug'] }));
  vacancy.writeStore(paths.vacancy, {
    offices: [office('KR', 'pioneer'), office('KR', 'guardian'), office('US', 'pioneer'), office('US', 'guardian')],
    removals: [],
    schedules: [],
    seasons: [{ id: 'season-kept', end: null }],
  });
  election.writeStore(paths.election, electionStore);
  filing.writeStore(paths.filing, filingStore);
  service.writeRankStore(paths.rank, { members: members, appointments: [], relinquishments: [], refreshes: [] });
  const beforeFail = {
    vacancy: fs.readFileSync(paths.vacancy),
    election: fs.readFileSync(paths.election),
    rank: fs.readFileSync(paths.rank),
  };

  const port = 3019;
  let server = await httpDev.listen(port, paths);
  const bound = server.address().address === '127.0.0.1';
  function post(urlPath, body) {
    return request(port, 'POST', urlPath, body, header);
  }
  const roundId = sole.opened.election.filingRoundId;
  const failBody = {
    filingRoundId: roundId,
    clockSource: 'test-fixture',
    nowMs: now,
    winnerId: 'forged',
    officeGranted: true,
  };
  const failedEarly = await post('/dev/leader-appointment/appointments', Object.assign({ failBeforeWrite: true }, failBody));
  const failedOffice = await post('/dev/leader-appointment/appointments', Object.assign({ failAfterOffice: true }, failBody));
  const earlySame = fs.readFileSync(paths.vacancy).equals(beforeFail.vacancy)
    && fs.readFileSync(paths.election).equals(beforeFail.election)
    && fs.readFileSync(paths.rank).equals(beforeFail.rank);
  const appointed = await post('/dev/leader-appointment/appointments', failBody);
  const viewed = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  const repsAfter = viewed.body.representativeIds || [];
  const tuesday = await post('/dev/leader-appointment/refreshes', {
    country: 'KR',
    territory: 'pioneer',
    clock: { weekday: 'TUESDAY', hour: 0, minute: 0, timeZone: 'Asia/Seoul' },
    refreshComplete: true,
    territoryPopulation: 1000,
    clockSource: 'test-fixture',
    nowMs: now,
  });
  const afterTuesday = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  const wednesday = await post('/dev/leader-appointment/refreshes', {
    country: 'KR',
    territory: 'pioneer',
    clock: { weekday: 'WEDNESDAY', hour: 0, minute: 0 },
    refreshComplete: true,
    territoryPopulation: 1000,
    clockSource: 'test-fixture',
    nowMs: now,
  });
  const afterWednesday = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  const duplicate = await post('/dev/leader-appointment/appointments', failBody);
  const freshElection = election.readStore(paths.election);
  const freshFiling = filing.readStore(paths.filing);
  const second = openSole(freshElection, freshFiling, 'KR', 'pioneer', 'r2', '가온');
  election.writeStore(paths.election, freshElection);
  filing.writeStore(paths.filing, freshFiling);
  const secondAppoint = await post('/dev/leader-appointment/appointments', {
    filingRoundId: second.opened.election && second.opened.election.filingRoundId,
    clockSource: 'test-fixture',
    nowMs: now + 10,
    winnerId: 'forged',
    officeGranted: true,
  });
  await closeServer(server);
  server = await httpDev.listen(port, paths);
  const restarted = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  const pair = await Promise.all([
    post('/dev/leader-appointment/appointments', {
      filingRoundId: usSole.opened.election.filingRoundId,
      clockSource: 'test-fixture',
      nowMs: now,
      winnerId: 'forged',
      officeGranted: true,
    }),
    post('/dev/leader-appointment/appointments', {
      filingRoundId: usSole.opened.election.filingRoundId,
      clockSource: 'test-fixture',
      nowMs: now,
      winnerId: 'other',
      officeGranted: true,
    }),
  ]);
  const usView = await request(port, 'GET', '/dev/leader-appointment/offices/US/pioneer', null, header);
  const guardView = await request(port, 'GET', '/dev/leader-appointment/offices/KR/guardian', null, header);
  const usGuardView = await request(port, 'GET', '/dev/leader-appointment/offices/US/guardian', null, header);
  const repsBeforeRemoval = (afterWednesday.body.representativeIds || []).slice().sort();
  const closeAt = now + hour;
  fs.writeFileSync(paths.citizen, JSON.stringify({
    ballots: [{
      id: 'citizen-r1',
      voteKind: 'citizen_impeachment_48h',
      proposalId: 'imp-r1',
      country: 'KR',
      territory: 'pioneer',
      leaderId: 'r1',
      leaderName: '한결',
      status: 'closed',
      result: 'passed',
      closedOnce: true,
      startsAtMs: closeAt - 48 * hour,
      endsAtMs: closeAt,
      closedAtMs: closeAt,
    }],
    votes: [],
    blocks: [],
  }));
  const removed = await post('/dev/leader-appointment/removals', {
    ballotId: 'citizen-r1',
    clockSource: 'test-fixture',
    nowMs: closeAt,
    winnerId: 'forged',
    officeGranted: true,
  });
  const afterRemoval = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  const removedAgain = await post('/dev/leader-appointment/removals', {
    ballotId: 'citizen-r1',
    clockSource: 'test-fixture',
    nowMs: closeAt + 5,
  });
  const reassigned = await post('/dev/leader-appointment/refreshes', {
    country: 'KR',
    territory: 'pioneer',
    clock: { weekday: 'WEDNESDAY', hour: 0, minute: 0 },
    refreshComplete: true,
    territoryPopulation: 1000,
    clockSource: 'test-fixture',
    nowMs: closeAt + 7 * day,
  });
  const afterReassign = await request(port, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, header);
  const described = rank.describeScore({
    fame: 10,
    cumulativeFame: 10,
    recent90DayEvaluation: 1,
    uniquePositiveEvaluators: 200,
    evaluationReactions: 1,
    followers: 1,
  });
  const r1After = (afterRemoval.body.members || []).filter(function (row) { return row.id === 'r1'; })[0];
  const r1Later = (afterReassign.body.members || []).filter(function (row) { return row.id === 'r1'; })[0];
  const c1AfterAppoint = (viewed.body.members || []).filter(function (row) { return row.id === 'c1'; })[0];
  const appointment = (viewed.body.appointments || [])[0];
  const schedule = (afterRemoval.body.schedules || [])[0];

  ok('1', '단독 실제 임명', bound && failedEarly.body.reason === 'APPOINTMENT_STORE_WRITE_FAILED' && failedOffice.body.reason === 'APPOINTMENT_STORE_WRITE_FAILED' && earlySame && appointed.status === 200 && appointed.body.officeGranted === true && appointment && appointment.winnerId === 'r1' && appointment.office === 'leader' && appointment.filingRoundId === roundId && appointment.appointedAtMs === now && appointment.vacancyEndedAtMs === now && viewed.body.office.status === 'sitting' && viewed.body.office.leaderId === 'r1' && viewed.body.elections.some(function (row) { return row.filingRoundId === roundId && row.officeGranted === true && row.winnerId === 'r1'; }) && appointed.body.clientWinnerIgnored === true);
  ok('2', '대표에서 지도자 전환', (viewed.body.members || []).some(function (row) { return row.id === 'r1' && row.rank === 'leader'; }));
  ok('3', '대표 정원에서 제외', appointment.excludedFromRepresentativeQuota === true && repsAfter.indexOf('r1') < 0 && viewed.body.leaderInsideRepresentativeQuota === false && viewed.body.representativeQuota === 10 && viewed.body.leaderIds.join(',') === 'r1' && repsAfter.length === 9);
  ok('4', '즉시 충원 금지', c1AfterAppoint.rank === 'citizen' && tuesday.body.applied === false && tuesday.body.timezone === 'UNCONFIRMED' && afterTuesday.body.representativeIds.length === 9 && afterTuesday.body.representativeIds.indexOf('c1') < 0);
  ok('5', '다음 수요일 정기 충원', wednesday.body.applied === true && wednesday.body.scoredByThisService === false && wednesday.body.formulaStatus === 'FORMULA_UNCONFIRMED' && described.combinedScore === null && described.weights.fame === 0.45 && described.weights.uniquePositiveEvaluators === 0.3 && described.weights.evaluationReactions === 0.15 && described.weights.followers === 0.1 && afterWednesday.body.representativeIds.length === 10 && afterWednesday.body.representativeIds.indexOf('c1') >= 0 && afterWednesday.body.representativeIds.indexOf('c2') < 0 && afterWednesday.body.representativeIds.indexOf('r1') < 0 && afterWednesday.body.leaderIds.join(',') === 'r1' && wednesday.body.counts.elder <= 50 && wednesday.body.counts.representative === 10);
  ok('6', '탄핵 시 직위 해제', removed.body.office.status === 'vacant' && removed.body.office.leaderId == null && afterRemoval.body.office.status === 'vacant' && schedule && schedule.vacancyEndMs - schedule.vacancyStartMs === 7 * day && schedule.filingStartMs === schedule.vacancyEndMs);
  ok('7', '임시 시민', r1After && r1After.rank === 'citizen' && r1After.electedLeader === false);
  ok('8', '대표 자동 복귀 금지', r1After && r1After.rank !== 'representative' && removed.body.autoReturnRepresentative === false);
  ok('9', '다음 정기 평가 재배치', reassigned.body.applied === true && r1Later && r1Later.rank === 'debater' && r1Later.rank !== 'representative' && r1Later.electedLeader === false && afterReassign.body.office.status === 'vacant');
  ok('10', '기존 대표 즉시 강등 방지', repsBeforeRemoval.length === 10 && afterRemoval.body.representativeIds.slice().sort().join(',') === repsBeforeRemoval.join(','));
  ok('11', '경험치 명성 업적 보존', r1After && r1After.xp === 10 && r1After.fame === 7 && r1After.activity === 3 && JSON.stringify(r1After.achievements) === JSON.stringify(['badge']) && r1Later.xp === 10 && r1Later.fame === 7 && removedAgain.body.alreadyApplied === true && removedAgain.body.member.xp === 10 && removedAgain.body.member.fame === 7 && vacancy.readStore(paths.vacancy).seasons[0].end == null);
  ok('12', '중복 임명 방지', duplicate.body.reason === 'APPOINTMENT_EXISTS' && second.opened.ok === true && secondAppoint.body.reason === 'OFFICE_NOT_VACANT' && viewed.body.appointments.length === 1 && service.readRankStore(paths.rank).appointments.filter(function (row) { return row.country === 'KR' && row.territory === 'pioneer'; }).length === 1);
  ok('13', '동시 요청과 재시작', restarted.body.office.leaderId === 'r1' && restarted.body.office.status === 'sitting' && restarted.body.elections.some(function (row) { return row.officeGranted === true && row.winnerId === 'r1'; }) && pair.filter(function (row) { return row.body.ok === true; }).length === 1 && pair.some(function (row) { return row.body.reason === 'APPOINTMENT_EXISTS'; }) && usView.body.leaderIds.join(',') === 'u1' && usView.body.appointments.length === 1);
  ok('14', 'KR/US와 영토 격리', guardView.body.office.status === 'vacant' && guardView.body.leaderIds.length === 0 && (guardView.body.members || []).some(function (row) { return row.id === 'g1' && row.rank === 'representative' && row.xp === 5; }) && usGuardView.body.office.status === 'vacant' && (usGuardView.body.members || []).some(function (row) { return row.id === 'u2' && row.rank === 'representative' && row.fame === 2; }) && usView.body.office.country === 'US');

  await closeServer(server);
  server = null;
  const regressionFiles = [
    'tools/test-leader-election-vote.js',
    'tools/test-leader-election-rounds.js',
    'tools/test-leader-filing.js',
    'tools/test-rep-impeach-vote.js',
    'tools/test-citizen-impeach-vote.js',
    'tools/test-impeachment-vacancy.js',
    'tools/test-by-election-schedule.js',
    'tools/test-by-election-run.js',
  ];
  const regression = regressionFiles.map(function (file) {
    const result = spawnSync(process.execPath, [file], { cwd: repo, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (result.status !== 0) {
      console.log(file + ' exit ' + result.status);
      console.log(String(result.stdout || '').slice(-800));
      console.log(String(result.stderr || '').slice(-800));
    }
    return result.status === 0;
  });
  ok('15', '기존 선거 탄핵 보궐 회귀', regression.every(function (row) { return row; }));

  let homeStatus = 0;
  try {
    const home = await request(3010, 'GET', '/', null, {});
    homeStatus = home.status;
  } catch (err) {
    homeStatus = 0;
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  const outDir = 'C:/Users/user/AppData/Local/Cursor/AgentStores/cursor_agent_stores/bc-c953b949-98fb-4f5d-8b49-80c8cb69e605/files/media/leader-appointment';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.txt'), [
    failed === 0 ? 'PASS' : 'FAIL',
    '직위는 단독 당선 저장이 성공한 뒤에만 부여한다.',
    '시작 HEAD: 19a5e895f291a57b14e3b65486fc5d71eaba1c7f',
    'JSON 잠금: 단일 프로세스',
    '시간대: 미확정',
    'formulaStatus: FORMULA_UNCONFIRMED',
    '점수는 만들지 않음',
    'productionAuth: false',
    'Postgres: 접근하지 않음. SQL 적용 안 함',
    '3010 응답: ' + homeStatus,
    scenario.join('\n'),
    '하지 않은 항목: 복수 후보 투표 종료 후 승자 확정, 동률 해소, 시즌 종료 자동화.',
  ].join('\n') + '\n');
  if (failed) process.exitCode = 1;
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
