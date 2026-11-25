'use strict';
/**
 * 확인된 지도자 선거 흐름을 통합 개발 서버에서 확인한다.
 * node tools/test-leader-lifecycle.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const legal = require('../shared/legal-gate-core');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
const vacancy = require('../server/impeachment-vacancy-service');
const appointment = require('../server/leader-appointment-service');
const runService = require('../server/by-election-run-service');
const launch = require('../server/leader-dev-launch');
const auto = require('../server/leader-dev-auto-advance');
const vote = require('../shared/vote-engine-core');

let passed = 0;
let failed = 0;
let activeEnv = null;
const results = [];
function ok(id, label, cond) {
  results.push((cond ? 'PASS' : 'FAIL') + ' ' + id + ' ' + label);
  console.log((cond ? 'PASS: ' : 'FAIL: ') + id + ' ' + label);
  if (cond) passed += 1;
  else failed += 1;
}

const base = 1700000000000;
const day = vote.DAY_MS;
const hour = vote.HOUR_MS;
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
    const req = http.request({ hostname: '127.0.0.1', port: port, method: method, path: urlPath, headers: headers || {}, agent: false }, function (res) {
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

function runNode(args, env) {
  return new Promise(function (resolve) {
    const child = spawn(process.execPath, args, { cwd: path.join(__dirname, '..'), env: env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', function (chunk) { out += chunk.toString(); });
    child.stderr.on('data', function (chunk) { err += chunk.toString(); });
    child.on('exit', function (code) { resolve({ code: code, out: out, err: err }); });
  });
}

function people(count, country, territory, atMs) {
  const rows = [];
  for (let i = 0; i < count; i += 1) rows.push({ id: 'pop-' + country + '-' + territory + '-' + i, country: country, territory: territory, valid: true, lastPostAtMs: atMs - 1000 });
  return { source: 'test-fixture', records: rows };
}

function member(id, country, territory) {
  return { id: id, country: country, territory: territory, rank: 'representative', comparisonScore: 80, uniquePositiveEvaluators: 200, firstQualificationUsed: {}, electedLeader: false, xp: 11, fame: 6, activity: 4, achievements: ['kept'] };
}

function removal(id, country, territory, atMs) {
  return { id: 'dev-office-removal:' + id, citizenBallotId: id, country: country, territory: territory, leaderId: 'old-' + id, removedAtMs: atMs, vacancyStartMs: atMs, rankChanged: false };
}

function schedule(row) {
  const plan = vacancy.byElectionPlan(row.removedAtMs);
  plan.citizenBallotId = row.citizenBallotId;
  plan.country = row.country;
  plan.territory = row.territory;
  plan.population = people(1000, row.country, row.territory, plan.filingEndMs);
  return plan;
}

function office(row) {
  return { country: row.country, territory: row.territory, status: 'vacant', leaderId: null, removedAtMs: row.removedAtMs, vacancyStartMs: row.vacancyStartMs, rank: 'representative', fame: 42, season: 'season-kept', seasonEnd: null };
}

function openVote(electionStore, filingStore, country, territory, actors, atMs) {
  const round = election.openFilingRound(electionStore, { actor: clerk, country: country, territory: territory, window: windowOpen });
  actors.forEach(function (actor) {
    const filed = filing.fileCandidacy(filingStore, {
      actor: { id: actor.id, name: actor.name, devAuth: true, country: country, territory: territory, office: 'representative' },
      country: country, territory: territory, window: windowOpen, nowMs: atMs, intentConfirmed: true, eligibility: country === 'US' ? usAdult : undefined,
    });
    election.applyToRound(electionStore, filingStore, { actor: clerk, filingRoundId: round.round.id, candidacyId: filed.candidacy.id, window: { provided: true } });
    election.reviewCandidacy(electionStore, filingStore, { actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'start_review', window: { provided: true } });
    election.reviewCandidacy(electionStore, filingStore, { actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'approve', window: { provided: true } });
  });
  election.closeRegistration(electionStore, { actor: clerk, country: country, territory: territory, filingRoundId: round.round.id, window: { provided: true, closing: true } });
  const opened = election.openElection(electionStore, { country: country, territory: territory, nowMs: atMs, window: { provided: true }, filingRoundId: round.round.id, population: people(1000, country, territory, atMs) });
  if (!opened.ok || !opened.ballot) throw new Error('openVote ' + country + ' ' + territory + ' ' + (opened.reason || 'NO_BALLOT'));
  return { round: round.round, opened: opened };
}

(async function () {
  const ports = { election: '3061', by: '3062', appointment: '3063', filing: '3064', rep: '3065', citizen: '3066', vacancy: '3067' };
  const byHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-By-Election': 'preview' };
  const electionHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Election': 'preview' };
  const appointmentHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Leader-Appointment': 'preview' };
  const filingHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Filing': 'preview' };
  const repHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Vote': 'preview' };
  const citizenHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Citizen-Vote': 'preview' };
  function envFor(dir) {
    const env = Object.assign({}, process.env, {
      LEADER_DEV_DATA_DIR: dir,
      LEADER_ELECTION_DEV_PORT: ports.election,
      BY_ELECTION_RUN_DEV_PORT: ports.by,
      LEADER_APPOINTMENT_DEV_PORT: ports.appointment,
      LEADER_FILING_DEV_PORT: ports.filing,
      REP_IMPEACH_VOTE_DEV_PORT: ports.rep,
      CITIZEN_IMPEACH_VOTE_DEV_PORT: ports.citizen,
      IMPEACHMENT_VACANCY_DEV_PORT: ports.vacancy,
    });
    delete env.LEADER_DEV_INTEGRATION;
    return env;
  }
  async function boot(dir) {
    activeEnv = envFor(dir);
    const started = await runNode(['tools/start-leader-dev.js'], activeEnv);
    if (started.code !== 0) throw new Error(started.err || started.out);
    return started;
  }
  async function halt() {
    await runNode(['tools/stop-leader-dev.js'], envFor(process.env.LEADER_DEV_DATA_DIR || ''));
  }

  const autoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-life-auto-'));
  const autoPaths = launch.integratedPaths(autoDir);
  const due = removal('due', 'KR', 'pioneer', base);
  const later = removal('later', 'KR', 'guardian', base + 30 * day);
  const bare = removal('bare', 'US', 'pioneer', base);
  const duePlan = schedule(due);
  const laterPlan = schedule(later);
  fs.mkdirSync(autoDir, { recursive: true });
  vacancy.writeStore(autoPaths.vacancy, { offices: [office(due), office(later), office(bare)], removals: [due, later, bare], schedules: [duePlan, laterPlan], seasons: [{ id: 'season-kept', end: null }] });
  election.writeStore(autoPaths.election, election.emptyStore());
  filing.writeStore(autoPaths.filing, filing.emptyStore());
  fs.writeFileSync(autoPaths.run, JSON.stringify({ runs: [] }));
  appointment.writeRankStore(autoPaths.rank, { members: [member('r1', 'KR', 'pioneer')], appointments: [], relinquishments: [], refreshes: [] });
  fs.writeFileSync(autoPaths.citizen, JSON.stringify({ ballots: [], votes: [], blocks: [] }));
  await boot(autoDir);
  const firstTick = await auto.tick(autoPaths, { clockSource: 'test-fixture', nowMs: duePlan.filingStartMs });
  const secondTick = await auto.tick(autoPaths, { clockSource: 'test-fixture', nowMs: duePlan.filingStartMs });
  const autoRun = await request(3062, 'GET', '/dev/by-election/runs/due', null, byHeader);
  const laterRun = await request(3062, 'GET', '/dev/by-election/runs/later', null, byHeader);
  const childRestart = await runNode(['-e', 'const auto=require("./server/leader-dev-auto-advance"); const launch=require("./server/leader-dev-launch"); auto.tick(launch.integratedPaths(process.argv[1]), {clockSource:"test-fixture", nowMs:Number(process.argv[2])}).then(function(result){ process.stdout.write(JSON.stringify(result.steps)); });', autoDir, String(duePlan.filingStartMs)]);
  let restartedDue = null;
  try { restartedDue = JSON.parse(childRestart.out).filter(function (row) { return row.ballotId === 'due'; })[0]; } catch (err) { restartedDue = null; }
  await runNode(['tools/stop-leader-dev.js'], envFor(autoDir));
  const dueStep = firstTick.steps.filter(function (row) { return row.ballotId === 'due'; })[0];
  const laterStep = firstTick.steps.filter(function (row) { return row.ballotId === 'later'; })[0];
  const bareStep = firstTick.steps.filter(function (row) { return row.ballotId === 'bare'; })[0];
  const dueAgain = secondTick.steps.filter(function (row) { return row.ballotId === 'due'; })[0];
  ok('18', '자동 진행이 기한이 된 접수만 연다', firstTick.productionScheduler === false && firstTick.multiFileTransaction === false && firstTick.lock === 'single-process' && dueStep && dueStep.acted === true && dueStep.run && dueStep.run.status === 'filing' && laterStep.acted === false && laterStep.reason === 'VACANCY_WINDOW' && bareStep.reason === 'MISSING_SCHEDULE' && dueAgain.acted === false && autoRun.body.run && autoRun.body.run.status === 'filing' && autoRun.body.runs.length === 1 && (!laterRun.body || !laterRun.body.run) && restartedDue && restartedDue.acted === false);

  let lostUpdate = false;
  for (let trial = 0; trial < 5 && !lostUpdate; trial += 1) {
    const race = path.join(os.tmpdir(), 'sa-json-race-' + trial + '.json');
    fs.writeFileSync(race, '{"seed":true}');
    const script = 'const fs=require("fs"); const file=process.argv[1]; const key=process.argv[2]; const data=JSON.parse(fs.readFileSync(file,"utf8")); const start=Date.now(); while(Date.now()-start<300){} data[key]=true; fs.writeFileSync(file, JSON.stringify(data));';
    await Promise.all([
      runNode(['-e', script, race, 'left']),
      runNode(['-e', script, race, 'right']),
    ]);
    const finalRace = JSON.parse(fs.readFileSync(race, 'utf8'));
    lostUpdate = finalRace.left !== true || finalRace.right !== true;
  }
  ok('lock', '프로세스 둘은 JSON을 함께 지키지 못함', lostUpdate === true);

  const haltDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-life-halt-'));
  const haltPaths = launch.integratedPaths(haltDir);
  const haltElection = election.emptyStore();
  const haltFiling = filing.emptyStore();
  const halted = openVote(haltElection, haltFiling, 'KR', 'pioneer', [{ id: 'r1', name: '한결' }, { id: 'r2', name: '가온' }], base);
  halted.opened.ballot.status = 'halted';
  const erred = openVote(haltElection, haltFiling, 'KR', 'guardian', [{ id: 'r3', name: '세찬' }, { id: 'r4', name: '다온' }], base);
  erred.opened.ballot.status = 'error';
  halted.round.byElectionBallotId = 'halt';
  erred.round.byElectionBallotId = 'error';
  const haltRemoval = removal('halt', 'KR', 'pioneer', base - 10 * day);
  const errorRemoval = removal('error', 'KR', 'guardian', base - 10 * day);
  fs.mkdirSync(haltDir, { recursive: true });
  vacancy.writeStore(haltPaths.vacancy, { offices: [office(haltRemoval), office(errorRemoval)], removals: [haltRemoval, errorRemoval], schedules: [schedule(haltRemoval), schedule(errorRemoval)] });
  election.writeStore(haltPaths.election, haltElection);
  filing.writeStore(haltPaths.filing, haltFiling);
  fs.writeFileSync(haltPaths.run, JSON.stringify({ runs: [
    { id: 'halt-run', citizenBallotId: 'halt', country: 'KR', territory: 'pioneer', filingRoundId: halted.round.id, status: 'vote_open', filingStartMs: base - 3 * day, filingEndMs: base, officeGranted: false, votesOpened: true, electionId: halted.opened.election.id },
    { id: 'error-run', citizenBallotId: 'error', country: 'KR', territory: 'guardian', filingRoundId: erred.round.id, status: 'vote_open', filingStartMs: base - 3 * day, filingEndMs: base, officeGranted: false, votesOpened: true, electionId: erred.opened.election.id },
  ] }));
  appointment.writeRankStore(haltPaths.rank, { members: [], appointments: [], relinquishments: [], refreshes: [] });
  const haltedAdvance = await runService.advanceAndPersist(haltPaths, { ballotId: 'halt', clockSource: 'test-fixture', nowMs: base + 48 * hour });
  const errorAdvance = await runService.advanceAndPersist(haltPaths, { ballotId: 'error', clockSource: 'test-fixture', nowMs: base + 48 * hour });
  ok('halt', '중단과 오류는 임명하지 않음', haltedAdvance.reason === 'HALTED' && haltedAdvance.officeGranted === false && errorAdvance.reason === 'VOTE_ERROR' && errorAdvance.officeGranted === false);

  const chainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-life-chain-'));
  const chainPaths = launch.integratedPaths(chainDir);
  const chainRemoval = removal('chain', 'KR', 'pioneer', base);
  const chainPlan = schedule(chainRemoval);
  fs.mkdirSync(chainDir, { recursive: true });
  vacancy.writeStore(chainPaths.vacancy, { offices: [office(chainRemoval)], removals: [chainRemoval], schedules: [chainPlan] });
  election.writeStore(chainPaths.election, election.emptyStore());
  filing.writeStore(chainPaths.filing, filing.emptyStore());
  fs.writeFileSync(chainPaths.run, JSON.stringify({ runs: [] }));
  appointment.writeRankStore(chainPaths.rank, { members: [member('r1', 'KR', 'pioneer'), member('r2', 'KR', 'pioneer')], appointments: [], relinquishments: [], refreshes: [] });
  fs.writeFileSync(chainPaths.citizen, JSON.stringify({ ballots: [], votes: [], blocks: [] }));
  const chainOpen = await auto.tick(chainPaths, { clockSource: 'test-fixture', nowMs: chainPlan.filingStartMs });
  const chainFile = await runService.fileAndPersist(chainPaths, { ballotId: 'chain', actorId: 'r1', actorName: '한결', clockSource: 'test-fixture', nowMs: chainPlan.filingStartMs + hour });
  await runService.reviewAndPersist(chainPaths, { ballotId: 'chain', candidacyId: chainFile.candidacy.id, action: 'start_review', clockSource: 'test-fixture', nowMs: chainPlan.filingStartMs + hour });
  await runService.reviewAndPersist(chainPaths, { ballotId: 'chain', candidacyId: chainFile.candidacy.id, action: 'approve', clockSource: 'test-fixture', nowMs: chainPlan.filingStartMs + hour });
  const chainBranch = await auto.tick(chainPaths, { clockSource: 'test-fixture', nowMs: chainPlan.filingEndMs });
  const chainAppoint = await auto.tick(chainPaths, { clockSource: 'test-fixture', nowMs: chainPlan.filingEndMs });
  const chainOffice = vacancy.readStore(chainPaths.vacancy).offices[0];
  const chainRank = appointment.readRankStore(chainPaths.rank).members.filter(function (row) { return row.id === 'r1'; })[0];

  const voteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-life-vote-tick-'));
  const votePaths = launch.integratedPaths(voteDir);
  const voteElection = election.emptyStore();
  const voteFiling = filing.emptyStore();
  const winVote = openVote(voteElection, voteFiling, 'KR', 'pioneer', [{ id: 'r1', name: '한결' }, { id: 'r2', name: '가온' }], base);
  const tieVote = openVote(voteElection, voteFiling, 'KR', 'guardian', [{ id: 'r3', name: '세찬' }, { id: 'r4', name: '다온' }], base);
  const zeroVote = openVote(voteElection, voteFiling, 'US', 'pioneer', [{ id: 'u1', name: 'Ari' }, { id: 'u2', name: 'Noa' }], base);
  await election.castVote(voteElection, { ballotId: winVote.opened.ballot.id, actor: { id: 'pop-KR-pioneer-0', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r1', nowMs: base + 1000 });
  await election.castVote(voteElection, { ballotId: winVote.opened.ballot.id, actor: { id: 'pop-KR-pioneer-1', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r1', nowMs: base + 1000 });
  await election.castVote(voteElection, { ballotId: winVote.opened.ballot.id, actor: { id: 'pop-KR-pioneer-2', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r2', nowMs: base + 1000 });
  await election.castVote(voteElection, { ballotId: tieVote.opened.ballot.id, actor: { id: 'pop-KR-guardian-0', country: 'KR', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'r3', nowMs: base + 1000 });
  await election.castVote(voteElection, { ballotId: tieVote.opened.ballot.id, actor: { id: 'pop-KR-guardian-1', country: 'KR', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'r4', nowMs: base + 1000 });
  winVote.round.byElectionBallotId = 'win';
  tieVote.round.byElectionBallotId = 'gtie';
  zeroVote.round.byElectionBallotId = 'gzero';
  function pastRemoval(id, country, territory) {
    return removal(id, country, territory, base - 10 * day);
  }
  const winRemoval = pastRemoval('win', 'KR', 'pioneer');
  const gtieRemoval = pastRemoval('gtie', 'KR', 'guardian');
  const gzeroRemoval = pastRemoval('gzero', 'US', 'pioneer');
  function voteRun(id, country, territory, seeded) {
    return { id: 'byrun-' + id, citizenBallotId: id, country: country, territory: territory, filingRoundId: seeded.round.id, status: 'vote_open', filingStartMs: base - 3 * day, filingEndMs: base, officeGranted: false, votesOpened: true, appointment: false, electionId: seeded.opened.election.id };
  }
  fs.mkdirSync(voteDir, { recursive: true });
  vacancy.writeStore(votePaths.vacancy, { offices: [office(winRemoval), office(gtieRemoval), office(gzeroRemoval)], removals: [winRemoval, gtieRemoval, gzeroRemoval], schedules: [schedule(winRemoval), schedule(gtieRemoval), schedule(gzeroRemoval)] });
  election.writeStore(votePaths.election, voteElection);
  filing.writeStore(votePaths.filing, voteFiling);
  fs.writeFileSync(votePaths.run, JSON.stringify({ runs: [voteRun('win', 'KR', 'pioneer', winVote), voteRun('gtie', 'KR', 'guardian', tieVote), voteRun('gzero', 'US', 'pioneer', zeroVote)] }));
  appointment.writeRankStore(votePaths.rank, { members: [member('r1', 'KR', 'pioneer'), member('r2', 'KR', 'pioneer'), member('r3', 'KR', 'guardian'), member('r4', 'KR', 'guardian'), member('u1', 'US', 'pioneer'), member('u2', 'US', 'pioneer')], appointments: [], relinquishments: [], refreshes: [] });
  const voteTick = await auto.tick(votePaths, { clockSource: 'test-fixture', nowMs: base + 48 * hour });
  const voteTickAgain = await auto.tick(votePaths, { clockSource: 'test-fixture', nowMs: base + 48 * hour });
  const winStep = voteTick.steps.filter(function (row) { return row.ballotId === 'win'; })[0];
  const tieStep = voteTick.steps.filter(function (row) { return row.ballotId === 'gtie'; })[0];
  const zeroStep = voteTick.steps.filter(function (row) { return row.ballotId === 'gzero'; })[0];
  const winAgain = voteTickAgain.steps.filter(function (row) { return row.ballotId === 'win'; })[0];
  const seated = vacancy.readStore(votePaths.vacancy).offices.filter(function (row) { return row.territory === 'pioneer' && row.country === 'KR'; })[0];
  const tieRun = runService.readStore(votePaths.run).runs.filter(function (row) { return row.citizenBallotId === 'gtie'; }).pop();
  const zeroRun = runService.readStore(votePaths.run).runs.filter(function (row) { return row.citizenBallotId === 'gzero'; }).pop();
  ok('auto-chain', '자동 진행이 접수 종료, 임명, 동률, 0표를 저장 일정대로 처리', chainOpen.steps[0].acted === true && chainBranch.steps[0].run.status === 'uncontested_recorded' && chainAppoint.steps[0].officeGranted === true && chainOffice.status === 'sitting' && chainOffice.leaderId === 'r1' && chainRank.rank === 'leader' && winStep.officeGranted === true && seated.leaderId === 'r1' && tieStep.officeGranted === false && tieRun.status === 'weekly_refiling_waiting' && tieRun.refilingReason === 'TIE' && zeroStep.officeGranted === false && zeroRun.status === 'weekly_refiling_waiting' && zeroRun.refilingReason === 'ZERO_VOTES' && winAgain.acted === false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-life-http-'));
  const paths = launch.integratedPaths(dir);
  const electionStore = election.emptyStore();
  const filingStore = filing.emptyStore();
  const tie = openVote(electionStore, filingStore, 'KR', 'guardian', [{ id: 'r3', name: '세찬' }, { id: 'r4', name: '다온' }], base);
  const zero = openVote(electionStore, filingStore, 'US', 'pioneer', [{ id: 'u1', name: 'Ari' }, { id: 'u2', name: 'Noa' }], base);
  await election.castVote(electionStore, { ballotId: tie.opened.ballot.id, actor: { id: 'pop-KR-guardian-0', country: 'KR', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'r3', nowMs: base + 1000 });
  await election.castVote(electionStore, { ballotId: tie.opened.ballot.id, actor: { id: 'pop-KR-guardian-1', country: 'KR', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'r4', nowMs: base + 1000 });
  tie.round.byElectionBallotId = 'tie';
  zero.round.byElectionBallotId = 'zero';
  const pioneerRemoval = removal('pioneer', 'KR', 'pioneer', base);
  const guardRemoval = removal('tie', 'KR', 'guardian', base - 10 * day);
  const zeroRemoval = removal('zero', 'US', 'pioneer', base - 10 * day);
  const emptyRemoval = removal('empty', 'US', 'guardian', base);
  const pioneerPlan = schedule(pioneerRemoval);
  fs.mkdirSync(dir, { recursive: true });
  vacancy.writeStore(paths.vacancy, {
    offices: [office(pioneerRemoval), office(guardRemoval), office(zeroRemoval), office(emptyRemoval)],
    removals: [pioneerRemoval, guardRemoval, zeroRemoval, emptyRemoval],
    schedules: [pioneerPlan, schedule(guardRemoval), schedule(zeroRemoval), schedule(emptyRemoval)],
    seasons: [{ id: 'season-kept', end: null }],
  });
  election.writeStore(paths.election, electionStore);
  filing.writeStore(paths.filing, filingStore);
  function seededRun(id, country, territory, round, openedElection) {
    return { id: 'byrun-' + id, citizenBallotId: id, country: country, territory: territory, filingRoundId: round.id, status: 'vote_open', filingStartMs: base - 3 * day, filingEndMs: base, officeGranted: false, votesOpened: true, appointment: false, tieRule: false, electionId: openedElection.id, lock: 'single-process' };
  }
  fs.writeFileSync(paths.run, JSON.stringify({ runs: [seededRun('tie', 'KR', 'guardian', tie.round, tie.opened.election), seededRun('zero', 'US', 'pioneer', zero.round, zero.opened.election)] }));
  appointment.writeRankStore(paths.rank, { members: [member('r1', 'KR', 'pioneer'), member('r2', 'KR', 'pioneer'), member('r6', 'KR', 'pioneer'), member('r3', 'KR', 'guardian'), member('r4', 'KR', 'guardian'), member('u1', 'US', 'pioneer'), member('u2', 'US', 'pioneer')], appointments: [], relinquishments: [], refreshes: [] });
  fs.writeFileSync(paths.citizen, JSON.stringify({ ballots: [], votes: [], blocks: [], removals: [] }));
  await boot(dir);
  function advance(id, nowMs, extra) {
    return request(3062, 'POST', '/dev/by-election/advance', Object.assign({ ballotId: id, clockSource: 'test-fixture', nowMs: nowMs }, extra || {}), byHeader);
  }
  const earlyFiling = await advance('pioneer', pioneerPlan.filingStartMs - 1);
  const pair = await Promise.all([advance('pioneer', pioneerPlan.filingStartMs), advance('pioneer', pioneerPlan.filingStartMs)]);
  const openedFiling = pair.filter(function (row) { return row.body && row.body.opened === true; });
  const already = pair.filter(function (row) { return row.body && row.body.alreadyOpen === true; });
  const failWrite = await advance('empty', schedule(emptyRemoval).filingStartMs, { failRunWrite: true });
  const emptyOpen = await advance('empty', schedule(emptyRemoval).filingStartMs);
  const fileOne = await request(3062, 'POST', '/dev/by-election/applications', { ballotId: 'pioneer', actorId: 'r1', actorName: '한결', clockSource: 'test-fixture', nowMs: pioneerPlan.filingStartMs + hour }, byHeader);
  await request(3062, 'POST', '/dev/by-election/reviews', { ballotId: 'pioneer', candidacyId: fileOne.body.candidacy.id, action: 'start_review', clockSource: 'test-fixture', nowMs: pioneerPlan.filingStartMs + hour }, byHeader);
  await request(3062, 'POST', '/dev/by-election/reviews', { ballotId: 'pioneer', candidacyId: fileOne.body.candidacy.id, action: 'approve', clockSource: 'test-fixture', nowMs: pioneerPlan.filingStartMs + hour }, byHeader);
  const sole = await advance('pioneer', pioneerPlan.filingEndMs, { population: people(1000, 'KR', 'pioneer', pioneerPlan.filingEndMs) });
  const appointed = await request(3063, 'POST', '/dev/leader-appointment/appointments', { filingRoundId: sole.body.run.filingRoundId, clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs }, appointmentHeader);
  const afterAppoint = await request(3063, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, appointmentHeader);
  const duplicateAppoint = await request(3063, 'POST', '/dev/leader-appointment/appointments', { filingRoundId: sole.body.run.filingRoundId, clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs }, appointmentHeader);
  const proposal = await request(3064, 'POST', '/dev/leader-filing/impeachments', {
    actor: { id: 'r2', name: '가온', devAuth: true, country: 'KR', territory: 'pioneer', office: 'representative' },
    country: 'KR', territory: 'pioneer', leader: { id: 'r1', name: '한결', country: 'KR', territory: 'pioneer' }, reason: '개발용 탄핵', nowMs: pioneerPlan.filingEndMs + hour,
  }, filingHeader);
  const repOpen = await request(3065, 'POST', '/dev/rep-impeach-vote/ballots', { proposalId: proposal.body.proposal.id, clockSource: 'test-fixture', startsAtMs: pioneerPlan.filingEndMs + hour, nowMs: pioneerPlan.filingEndMs + hour }, repHeader);
  for (const id of ['r2', 'r6', 'r7', 'r8', 'r5']) {
    await request(3065, 'POST', '/dev/rep-impeach-vote/ballots/' + encodeURIComponent(repOpen.body.ballotId) + '/votes', {
      actor: { id: id, country: 'KR', territory: 'pioneer', office: 'representative', verified: true, authSource: 'test-fixture' },
      choice: 'yes', clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs + hour + 1000,
    }, repHeader);
  }
  const repClose = await request(3065, 'POST', '/dev/rep-impeach-vote/ballots/' + encodeURIComponent(repOpen.body.ballotId) + '/close', { clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs + hour + 24 * hour }, repHeader);
  const citizenPop = people(1000, 'KR', 'pioneer', pioneerPlan.filingEndMs + 2 * day);
  const citizenOpen = await request(3066, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: proposal.body.proposal.id, clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs + 2 * day, population: citizenPop }, citizenHeader);
  if (!citizenOpen.body || !citizenOpen.body.ballot) throw new Error('citizen open ' + JSON.stringify({ status: citizenOpen.status, body: citizenOpen.body, proposal: proposal.body && proposal.body.proposal && proposal.body.proposal.status, rep: repOpen.body && repOpen.body.ballotId, repClose: repClose.body && (repClose.body.ok ? repClose.body.ballot && repClose.body.ballot.result : repClose.body.reason) }));
  const citizenId = citizenOpen.body.ballot.id;
  const casts = [];
  for (let i = 0; i < 201; i += 1) {
    casts.push(request(3066, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(citizenId) + '/votes', {
      actor: { id: 'pop-KR-pioneer-' + i, country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' },
      choice: 'yes', clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs + 2 * day + 1000,
    }, citizenHeader));
  }
  const castResults = await Promise.all(casts);
  const citizenClose = await request(3066, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(citizenId) + '/close', { clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs + 2 * day + 48 * hour }, citizenHeader);
  const removed = await request(3063, 'POST', '/dev/leader-appointment/removals', { ballotId: citizenId, clockSource: 'test-fixture', nowMs: pioneerPlan.filingEndMs + 2 * day + 48 * hour }, appointmentHeader);
  const removedAt = pioneerPlan.filingEndMs + 2 * day + 48 * hour;
  const tooSoon = await advance(citizenId, removedAt + 7 * day - 1);
  const byFiling = await advance(citizenId, removedAt + 7 * day);
  const byEnd = removedAt + 10 * day;
  const firstBy = await request(3062, 'POST', '/dev/by-election/applications', { ballotId: citizenId, actorId: 'r2', actorName: '가온', clockSource: 'test-fixture', nowMs: removedAt + 7 * day + hour }, byHeader);
  const secondBy = await request(3062, 'POST', '/dev/by-election/applications', { ballotId: citizenId, actorId: 'r6', actorName: '바다', clockSource: 'test-fixture', nowMs: removedAt + 7 * day + hour }, byHeader);
  for (const item of [firstBy, secondBy]) {
    await request(3062, 'POST', '/dev/by-election/reviews', { ballotId: citizenId, candidacyId: item.body.candidacy.id, action: 'start_review', clockSource: 'test-fixture', nowMs: removedAt + 7 * day + hour }, byHeader);
    await request(3062, 'POST', '/dev/by-election/reviews', { ballotId: citizenId, candidacyId: item.body.candidacy.id, action: 'approve', clockSource: 'test-fixture', nowMs: removedAt + 7 * day + hour }, byHeader);
  }
  const plural = await advance(citizenId, byEnd, { population: people(1000, 'KR', 'pioneer', byEnd) });
  await request(3062, 'POST', '/dev/by-election/votes', { ballotId: citizenId, voteBallotId: plural.body.ballot.id, actorId: 'pop-KR-pioneer-0', country: 'KR', territory: 'pioneer', choice: 'r2', clockSource: 'test-fixture', nowMs: byEnd + hour }, byHeader);
  await request(3062, 'POST', '/dev/by-election/votes', { ballotId: citizenId, voteBallotId: plural.body.ballot.id, actorId: 'pop-KR-pioneer-1', country: 'KR', territory: 'pioneer', choice: 'r2', clockSource: 'test-fixture', nowMs: byEnd + hour }, byHeader);
  await request(3062, 'POST', '/dev/by-election/votes', { ballotId: citizenId, voteBallotId: plural.body.ballot.id, actorId: 'pop-KR-pioneer-2', country: 'KR', territory: 'pioneer', choice: 'r6', clockSource: 'test-fixture', nowMs: byEnd + hour }, byHeader);
  const voteClose = await request(3061, 'POST', '/dev/leader-election/ballots/' + encodeURIComponent(plural.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: byEnd + 48 * hour }, electionHeader);
  const pluralAppoint = await request(3063, 'POST', '/dev/leader-appointment/appointments', { filingRoundId: plural.body.run.filingRoundId, clockSource: 'test-fixture', nowMs: byEnd + 48 * hour }, appointmentHeader);
  const tieClose = await request(3061, 'POST', '/dev/leader-election/ballots/' + encodeURIComponent(tie.opened.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: base + 48 * hour }, electionHeader);
  const tieWait = await advance('tie', base + 48 * hour + 1);
  const tieNext = base + 48 * hour + runService.REFILING_MS;
  const tieOpen = await advance('tie', tieNext);
  const zeroClose = await request(3061, 'POST', '/dev/leader-election/ballots/' + encodeURIComponent(zero.opened.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: base + 48 * hour }, electionHeader);
  const zeroWait = await advance('zero', base + 48 * hour + 1);
  const zeroOpen = await advance('zero', base + 48 * hour + runService.REFILING_MS);
  const zeroStart = base + 48 * hour + runService.REFILING_MS;
  const againA = await request(3062, 'POST', '/dev/by-election/applications', { ballotId: 'zero', actorId: 'u1', actorName: 'Ari', eligibility: usAdult, clockSource: 'test-fixture', nowMs: zeroStart + hour }, byHeader);
  const againB = await request(3062, 'POST', '/dev/by-election/applications', { ballotId: 'zero', actorId: 'u2', actorName: 'Noa', eligibility: usAdult, clockSource: 'test-fixture', nowMs: zeroStart + hour }, byHeader);
  if (!againA.body.ok || !againB.body.ok) throw new Error('zero refile ' + JSON.stringify({ a: againA.body, b: againB.body }));
  for (const item of [againA, againB]) {
    await request(3062, 'POST', '/dev/by-election/reviews', { ballotId: 'zero', candidacyId: item.body.candidacy.id, action: 'start_review', clockSource: 'test-fixture', nowMs: zeroStart + hour }, byHeader);
    await request(3062, 'POST', '/dev/by-election/reviews', { ballotId: 'zero', candidacyId: item.body.candidacy.id, action: 'approve', clockSource: 'test-fixture', nowMs: zeroStart + hour }, byHeader);
  }
  const zeroVote2 = await advance('zero', zeroStart + runService.FILING_MS, { population: people(1000, 'US', 'pioneer', zeroStart + runService.FILING_MS) });
  const zeroClose2 = await request(3061, 'POST', '/dev/leader-election/ballots/' + encodeURIComponent(zeroVote2.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: zeroStart + runService.FILING_MS + 48 * hour }, electionHeader);
  const zeroWait2 = await advance('zero', zeroStart + runService.FILING_MS + 48 * hour + 1);
  const zeroOpen2 = await advance('zero', zeroStart + runService.FILING_MS + 48 * hour + runService.REFILING_MS);
  const oldRound = await request(3061, 'POST', '/dev/leader-election/rounds/' + encodeURIComponent(tie.round.id) + '/applications', { actor: clerk, window: { provided: true }, candidacyId: 'missing' }, electionHeader);
  const emptyEnd = schedule(emptyRemoval).filingStartMs + runService.FILING_MS;
  const emptyBranch = await advance('empty', emptyEnd, { population: people(1000, 'US', 'guardian', emptyEnd) });
  const repeatEarly = await advance('empty', emptyEnd + runService.REFILING_MS - 1);
  const emptyAgain = await advance('empty', emptyEnd + runService.REFILING_MS);
  await runNode(['tools/stop-leader-dev.js'], envFor(dir));
  await boot(dir);
  const restored = await request(3062, 'GET', '/dev/by-election/runs/empty', null, byHeader);
  const pioneerOffice = await request(3063, 'GET', '/dev/leader-appointment/offices/KR/pioneer', null, appointmentHeader);
  const guardOffice = await request(3063, 'GET', '/dev/leader-appointment/offices/KR/guardian', null, appointmentHeader);
  const usOffice = await request(3063, 'GET', '/dev/leader-appointment/offices/US/pioneer', null, appointmentHeader);
  const electionRead = await request(3061, 'GET', '/dev/leader-election/elections/' + encodeURIComponent(plural.body.election.id), null, electionHeader);
  const byRead = await request(3062, 'GET', '/dev/by-election/elections/' + encodeURIComponent(plural.body.election.id), null, byHeader);
  const runRead = await request(3062, 'GET', '/dev/by-election/runs/' + encodeURIComponent(citizenId), null, byHeader);
  const leader = (pioneerOffice.body.members || []).filter(function (row) { return row.id === 'r2'; })[0];
  const former = (pioneerOffice.body.members || []).filter(function (row) { return row.id === 'r1'; })[0];
  ok('1', '공석 접수', earlyFiling.body.reason === 'FILING_TOO_EARLY' && openedFiling.length === 1 && openedFiling[0].body.run.status === 'filing' && openedFiling[0].body.run.filingEndMs - openedFiling[0].body.run.filingStartMs === 3 * day);
  ok('2', '단독 당선', sole.body.run.status === 'uncontested_recorded' && sole.body.run.recordedCandidateId === 'r1' && sole.body.officeGranted === false);
  ok('3', '임명과 계급', appointed.body.officeGranted === true && appointed.body.appointment.winnerId === 'r1' && afterAppoint.body.office.leaderId === 'r1' && afterAppoint.body.members.filter(function (row) { return row.id === 'r1'; })[0].rank === 'leader' && afterAppoint.body.members.filter(function (row) { return row.rank === 'representative'; }).every(function (row) { return row.id !== 'r1'; }));
  ok('4', '탄핵 발의', proposal.body.ok === true && proposal.body.proposal.status === 'received' && proposal.body.proposal.nextStep === 'representative_vote_24h');
  ok('5', '시민 투표와 해임', castResults.filter(function (row) { return row.body && row.body.ok; }).length === 201 && repClose.body.ok === true && citizenClose.body.ballot.result === 'passed' && removed.body.ok === true && removed.body.member.rank === 'citizen' && removed.body.autoReturnRepresentative === false && removed.body.office.status === 'vacant');
  ok('6', '7일 공석', tooSoon.body.reason === 'FILING_TOO_EARLY' && tooSoon.body.opened === false && byFiling.body.opened === true && byFiling.body.run.filingStartMs === removedAt + 7 * day);
  ok('7', '3일 보궐 접수', byFiling.body.run.filingEndMs - byFiling.body.run.filingStartMs === 3 * day && firstBy.body.ok === true && secondBy.body.ok === true);
  ok('8', '복수 선거', plural.body.run.status === 'vote_open' && plural.body.ballot.voteKind === 'leader_election_48h' && plural.body.officeGranted === false);
  ok('9', '48시간 종료', voteClose.body.ballot.result === 'plurality' && voteClose.body.ballot.winnerId === 'r2' && voteClose.body.ballot.officeGranted === false && voteClose.body.ballot.endsAtMs - voteClose.body.ballot.startsAtMs === 48 * hour);
  ok('10', '복수 임명', pluralAppoint.body.officeGranted === true && pluralAppoint.body.appointment.winnerId === 'r2' && duplicateAppoint.body.reason === 'APPOINTMENT_EXISTS');
  ok('11', '동률 재접수', tieClose.body.ballot.failReason === 'TIE' && tieClose.body.ballot.winnerId == null && tieWait.body.tie === true && tieWait.body.opened === false && tieWait.body.run.nextRefilingAtMs - tieWait.body.run.refilingBaseMs === runService.REFILING_MS && tieOpen.body.opened === true && tieOpen.body.run.filingRoundId !== tie.round.id && (tieOpen.body.run.filingStartMs !== guardRemoval.removedAtMs + 7 * day));
  ok('12', '0표 재접수', zeroClose.body.ballot.failReason === 'ZERO_VOTES' && zeroWait.body.zeroVotes === true && zeroWait.body.tie === false && zeroWait.body.run.refilingReason === 'ZERO_VOTES' && zeroOpen.body.opened === true && zeroOpen.body.run.filingRoundId !== zero.round.id && zeroVote2.body.run.status === 'vote_open' && zeroClose2.body.ballot.failReason === 'ZERO_VOTES' && zeroWait2.body.zeroVotes === true && zeroWait2.body.run.refilingReason === 'ZERO_VOTES' && zeroOpen2.body.opened === true && zeroOpen2.body.run.filingRoundId !== zeroOpen.body.run.filingRoundId && oldRound.body.reason === 'OLD_ROUND');
  ok('13', '후보 0명 재접수', emptyBranch.body.run.status === 'weekly_refiling_waiting' && emptyBranch.body.office.status === 'vacant' && emptyBranch.body.officeGranted === false);
  ok('14', '반복 재접수와 재시작', repeatEarly.body.reason === 'REFILING_TOO_EARLY' && emptyAgain.body.opened === true && emptyAgain.body.run.filingRoundId !== emptyBranch.body.run.filingRoundId && restored.body.run.filingRoundId === emptyAgain.body.run.filingRoundId);
  ok('15', '동시 요청과 저장 실패', already.length === 1 && failWrite.body.reason === 'RUN_STORE_WRITE_FAILED' && failWrite.body.ok !== true && emptyOpen.body.ok === true);
  ok('16', '국가와 영토 분리', pioneerOffice.body.office.country === 'KR' && pioneerOffice.body.office.territory === 'pioneer' && pioneerOffice.body.office.leaderId === 'r2' && guardOffice.body.office.status === 'vacant' && guardOffice.body.office.leaderId == null && usOffice.body.office.country === 'US' && usOffice.body.office.leaderId == null);
  ok('17', '조회가 저장된 직위와 같음', electionRead.body.publicView.officeGranted === true && electionRead.body.publicView.winnerId === 'r2' && byRead.body.officeGranted === true && byRead.body.winnerId === 'r2' && runRead.body.officeGranted === true && runRead.body.appointmentCheck === 'APPOINTMENT_COMPLETE' && runRead.body.office.leaderId === 'r2' && leader.rank === 'leader' && former.rank === 'citizen' && pioneerOffice.body.office.leaderId === 'r2');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
  await runNode(['tools/stop-leader-dev.js'], envFor(dir));
})().catch(async function (err) {
  console.error(err);
  process.exitCode = 1;
  if (activeEnv) {
    try { await runNode(['tools/stop-leader-dev.js'], activeEnv); } catch (stopErr) { return; }
  }
});
