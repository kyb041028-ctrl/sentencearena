'use strict';
/**
 * 통합 실행이 같은 저장 파일을 쓰는지 확인한다.
 * node tools/test-leader-dev-one-store.js
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
const vacancy = require('../server/impeachment-vacancy-service');
const service = require('../server/leader-appointment-service');
const launch = require('../server/leader-dev-launch');
const vote = require('../shared/vote-engine-core');
const legal = require('../shared/legal-gate-core');

let passed = 0;
let failed = 0;
function ok(id, label, cond) {
  console.log((cond ? 'PASS: ' : 'FAIL: ') + id + ' ' + label);
  if (cond) passed += 1;
  else failed += 1;
}

const removedAt = 1700000000000;
const day = vacancy.DAY_MS;
const hour = vote.HOUR_MS;
const filingEnd = removedAt + 10 * day;
const voteEnd = filingEnd + 48 * hour;
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
    const child = spawn(process.execPath, args, {
      cwd: path.join(__dirname, '..'),
      env: env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', function (chunk) { out += chunk.toString(); });
    child.stderr.on('data', function (chunk) { err += chunk.toString(); });
    child.on('exit', function (code) { resolve({ code: code, out: out, err: err }); });
  });
}

function hashTree(dir) {
  const found = {};
  if (!fs.existsSync(dir)) return found;
  function walk(current) {
    fs.readdirSync(current, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found[full] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    });
  }
  walk(dir);
  return found;
}

function people(count, country, territory) {
  const rows = [];
  for (let i = 0; i < count; i += 1) rows.push({ id: 'pop-' + country + '-' + territory + '-' + i, country: country, territory: territory, valid: true, lastPostAtMs: filingEnd - 1000 });
  return { source: 'test-fixture', records: rows };
}

function removalRecord(id, country, territory) {
  return { id: 'dev-office-removal:' + id, citizenBallotId: id, country: country, territory: territory, leaderId: 'old-' + id, removedAtMs: removedAt, vacancyStartMs: removedAt, rankChanged: false };
}

function scheduleFor(row) {
  const plan = vacancy.byElectionPlan(row.removedAtMs);
  plan.citizenBallotId = row.citizenBallotId;
  plan.country = row.country;
  plan.territory = row.territory;
  return plan;
}

function officeFor(row) {
  return { country: row.country, territory: row.territory, status: 'vacant', leaderId: null, removedAtMs: row.removedAtMs, vacancyStartMs: row.vacancyStartMs, season: 'season-kept', seasonEnd: null };
}

function runFor(row, filingRoundId, status, recorded) {
  const plan = vacancy.byElectionPlan(row.removedAtMs);
  return {
    id: 'byrun-' + filingRoundId, citizenBallotId: row.citizenBallotId, country: row.country, territory: row.territory,
    removedAtMs: row.removedAtMs, filingRoundId: filingRoundId, parentFilingRoundId: null, status: status,
    filingStartMs: plan.filingStartMs, filingEndMs: plan.filingEndMs, officeGranted: false, votesOpened: status === 'vote_open',
    appointment: false, recordedCandidateId: recorded || null, tieRule: false, lock: 'single-process',
  };
}

function member(id, country, territory) {
  return { id: id, country: country, territory: territory, rank: 'representative', comparisonScore: 80, uniquePositiveEvaluators: 200, firstQualificationUsed: {}, electedLeader: false, xp: 11, fame: 6, activity: 4, achievements: ['kept'] };
}

function openRound(electionStore, filingStore, country, territory, actors, eligibility) {
  const round = election.openFilingRound(electionStore, { actor: clerk, country: country, territory: territory, window: windowOpen });
  actors.forEach(function (actor) {
    const filed = filing.fileCandidacy(filingStore, {
      actor: { id: actor.id, name: actor.name, devAuth: true, country: country, territory: territory, office: 'representative' },
      country: country, territory: territory, window: windowOpen, nowMs: filingEnd, intentConfirmed: true, eligibility: eligibility,
    });
    election.applyToRound(electionStore, filingStore, { actor: clerk, filingRoundId: round.round.id, candidacyId: filed.candidacy.id, window: { provided: true } });
    election.reviewCandidacy(electionStore, filingStore, { actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'start_review', window: { provided: true } });
    election.reviewCandidacy(electionStore, filingStore, { actor: clerk, candidacyId: filed.candidacy.id, filingRoundId: round.round.id, action: 'approve', window: { provided: true } });
  });
  election.closeRegistration(electionStore, { actor: clerk, country: country, territory: territory, filingRoundId: round.round.id, window: { provided: true, closing: true } });
  const opened = election.openElection(electionStore, { country: country, territory: territory, nowMs: filingEnd, window: { provided: true }, filingRoundId: round.round.id, population: people(1000, country, territory) });
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
  const repoData = path.join(__dirname, '..', 'dev-data');
  const beforeTree = hashTree(repoData);
  const clean = Object.assign({}, process.env);
  ['LEADER_DEV_INTEGRATION', 'LEADER_DEV_DATA_DIR', 'LEADER_ELECTION_STORE', 'LEADER_FILING_STORE', 'IMPEACHMENT_VACANCY_STORE', 'LEADER_APPOINTMENT_RANK_STORE', 'BY_ELECTION_RUN_STORE', 'LEADER_APPOINTMENT_CITIZEN_STORE'].forEach(function (key) { delete clean[key]; });
  const mismatch = await runNode(['tools/start-leader-dev.js', '--check'], clean);
  const forced = launch.findStoreMismatch({
    election: { election: 'A', vacancy: 'V', rank: 'R', filing: 'F', run: 'N', citizen: 'C' },
    'by-election': { election: 'B', vacancy: 'V', rank: 'R', filing: 'F', run: 'N', citizen: 'C' },
    appointment: { election: 'A', vacancy: 'V', rank: 'R', filing: 'F', run: 'N', citizen: 'C' },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-one-store-'));
  const matchedEnv = Object.assign({}, clean, launch.childEnv(dir).env);
  const matched = await runNode(['tools/start-leader-dev.js', '--check'], matchedEnv);
  const hintDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-solo-hint-'));
  const hintEnv = Object.assign({}, clean, {
    LEADER_ELECTION_DEV_PORT: '3041',
    BY_ELECTION_RUN_DEV_PORT: '3042',
    LEADER_APPOINTMENT_DEV_PORT: '3043',
    LEADER_ELECTION_STORE: path.join(hintDir, 'election.json'),
    LEADER_FILING_STORE: path.join(hintDir, 'filing.json'),
    IMPEACHMENT_VACANCY_STORE: path.join(hintDir, 'vacancy.json'),
    LEADER_APPOINTMENT_RANK_STORE: path.join(hintDir, 'rank.json'),
    BY_ELECTION_RUN_STORE: path.join(hintDir, 'run.json'),
    LEADER_APPOINTMENT_CITIZEN_STORE: path.join(hintDir, 'citizen.json'),
  });
  const electionHint = spawn(process.execPath, ['server/leader-election-dev-http.js'], { cwd: path.join(__dirname, '..'), env: hintEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const byHint = spawn(process.execPath, ['server/by-election-run-dev-http.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, clean, { BY_ELECTION_RUN_DEV_PORT: '3042' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const appointmentHint = spawn(process.execPath, ['server/leader-appointment-dev-http.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, clean, { LEADER_APPOINTMENT_DEV_PORT: '3043' }), stdio: ['ignore', 'pipe', 'pipe'] });
  function readHint(child) {
    return new Promise(function (resolve) {
      let buf = '';
      child.stdout.on('data', function (chunk) { buf += chunk.toString(); if (buf.indexOf('dev http') >= 0) resolve(buf); });
    });
  }
  const hints = await Promise.all([readHint(electionHint), readHint(byHint), readHint(appointmentHint)]);
  [electionHint, byHint, appointmentHint].forEach(function (child) { child.kill(); });

  const shared = launch.integratedPaths(dir);
  const electionStore = election.emptyStore();
  const filingStore = filing.emptyStore();
  const soleRemoval = removalRecord('ballot-sole', 'US', 'pioneer');
  const mainRemoval = removalRecord('ballot-main', 'KR', 'pioneer');
  const sole = openRound(electionStore, filingStore, 'US', 'pioneer', [{ id: 'u1', name: 'Ari' }], usAdult);
  const main = openRound(electionStore, filingStore, 'KR', 'pioneer', [{ id: 'r1', name: '한결' }, { id: 'r2', name: '가온' }]);
  [sole, main].forEach(function (item) { if (!item.opened.ok) throw new Error(item.opened.reason); });
  sole.round.byElectionBallotId = soleRemoval.citizenBallotId;
  main.round.byElectionBallotId = mainRemoval.citizenBallotId;
  for (let index = 0; index < 3; index += 1) await cast(electionStore, main.opened.ballot, 'KR', 'pioneer', 'r1', index);
  const removals = [soleRemoval, mainRemoval];
  fs.mkdirSync(dir, { recursive: true });
  vacancy.writeStore(shared.vacancy, { offices: removals.map(officeFor), removals: removals, schedules: removals.map(scheduleFor), seasons: [{ id: 'season-kept', end: null }] });
  election.writeStore(shared.election, electionStore);
  filing.writeStore(shared.filing, filingStore);
  fs.writeFileSync(shared.run, JSON.stringify({ runs: [runFor(soleRemoval, sole.round.id, 'uncontested_recorded', 'u1'), runFor(mainRemoval, main.round.id, 'vote_open')] }, null, 2));
  service.writeRankStore(shared.rank, { members: [member('u1', 'US', 'pioneer'), member('r1', 'KR', 'pioneer'), member('r2', 'KR', 'pioneer')], appointments: [], relinquishments: [], refreshes: [] });
  fs.writeFileSync(shared.citizen, JSON.stringify({ ballots: [], votes: [], blocks: [] }));
  const beforeBoot = [shared.election, shared.vacancy, shared.rank, shared.filing, shared.run, shared.citizen].map(function (file) { return fs.readFileSync(file); });
  const startEnv = Object.assign({}, clean, {
    LEADER_DEV_DATA_DIR: dir,
    LEADER_ELECTION_DEV_PORT: '3031',
    BY_ELECTION_RUN_DEV_PORT: '3032',
    LEADER_APPOINTMENT_DEV_PORT: '3033',
  });
  const started = await runNode(['tools/start-leader-dev.js'], startEnv);
  const afterBoot = [shared.election, shared.vacancy, shared.rank, shared.filing, shared.run, shared.citizen].every(function (file, index) { return fs.readFileSync(file).equals(beforeBoot[index]); });
  const electionHeader = { 'X-SentenceArena-Dev-Election': 'preview' };
  const byHeader = { 'X-SentenceArena-Dev-By-Election': 'preview' };
  const appointmentHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Leader-Appointment': 'preview' };
  async function reads(id) {
    const left = await request(3031, 'GET', '/dev/leader-election/elections/' + encodeURIComponent(id), null, electionHeader);
    const right = await request(3032, 'GET', '/dev/by-election/elections/' + encodeURIComponent(id), null, byHeader);
    return { election: left.body.publicView, by: right.body };
  }
  function appoint(roundId, nowMs) {
    return request(3033, 'POST', '/dev/leader-appointment/appointments', { filingRoundId: roundId, clockSource: 'test-fixture', nowMs: nowMs, winnerId: 'forged', officeGranted: true }, appointmentHeader);
  }
  const soleDone = await appoint(sole.round.id, filingEnd);
  const afterSole = await reads(sole.opened.election.id);
  const disk = election.readStore(shared.election);
  const closed = await election.closeBallot(disk, { ballotId: main.opened.ballot.id, nowMs: voteEnd });
  if (!closed.ok) throw new Error('close ' + closed.reason);
  election.writeStore(shared.election, disk);
  const pluralDone = await appoint(main.round.id, voteEnd);
  const afterPlural = await reads(main.opened.election.id);
  const closeAt = voteEnd + hour;
  fs.writeFileSync(shared.citizen, JSON.stringify({ ballots: [{ id: 'citizen-u1', voteKind: 'citizen_impeachment_48h', proposalId: 'imp-u1', country: 'US', territory: 'pioneer', leaderId: 'u1', leaderName: 'Ari', status: 'closed', result: 'passed', closedOnce: true, startsAtMs: closeAt - 48 * hour, endsAtMs: closeAt, closedAtMs: closeAt }], votes: [], blocks: [] }));
  const removed = await request(3033, 'POST', '/dev/leader-appointment/removals', { ballotId: 'citizen-u1', clockSource: 'test-fixture', nowMs: closeAt }, appointmentHeader);
  const cleared = await reads(sole.opened.election.id);
  const samePaths = launch.describe(launch.childEnv(dir).env).same === true;
  const stopped = await runNode(['tools/stop-leader-dev.js'], startEnv);
  let closedPort = false;
  try { await request(3031, 'GET', '/dev/leader-election/elections/none', null, electionHeader); }
  catch (err) { closedPort = true; }
  const kept = [shared.election, shared.vacancy, shared.rank, shared.filing, shared.run, shared.citizen].every(function (file) { return fs.existsSync(file); });
  const afterTree = hashTree(repoData);
  const oldKeys = Object.keys(beforeTree);
  const oldUntouched = oldKeys.every(function (file) { return afterTree[file] === beforeTree[file]; });
  const hintOk = hints.every(function (text) {
    return text.indexOf('LEADER_DEV_INTEGRATION=1') >= 0 && text.indexOf('node tools/start-leader-dev.js') >= 0 && text.indexOf('node tools/stop-leader-dev.js') >= 0 && text.indexOf('leader-integrated') >= 0 && text.indexOf('LEADER_ELECTION_STORE=') >= 0 && text.indexOf('IMPEACHMENT_VACANCY_STORE=') >= 0 && text.indexOf('LEADER_APPOINTMENT_RANK_STORE=') >= 0 && text.indexOf('LEADER_FILING_STORE=') >= 0 && text.indexOf('BY_ELECTION_RUN_STORE=') >= 0;
  });

  function same(pair, check, granted) {
    return pair.election && pair.by && pair.election.appointmentCheck === check && pair.by.appointmentCheck === check && pair.election.officeGranted === granted && pair.by.officeGranted === granted;
  }
  ok('1', '저장 파일이 다르면 설정 오류', mismatch.code === 1 && mismatch.err.indexOf('CONFIG_STORE_MISMATCH') >= 0 && forced.length === 1 && forced[0].key === 'election' && matched.code === 0 && matched.out.indexOf('CONFIG_OK') >= 0);
  ok('2', '단독 실행은 통합 경로를 안내', hintOk === true);
  ok('3', '통합 시작이 기존 파일을 덮어쓰지 않음', started.code === 0 && started.out.indexOf('integrated leader dev servers') >= 0 && started.out.indexOf(dir) >= 0 && afterBoot === true && samePaths === true);
  ok('4', '단독 임명', soleDone.body.officeGranted === true && same(afterSole, 'APPOINTMENT_COMPLETE', true) && afterSole.election.winnerId === 'u1');
  ok('5', '복수 임명', pluralDone.body.officeGranted === true && same(afterPlural, 'APPOINTMENT_COMPLETE', true) && afterPlural.election.winnerId === 'r1' && afterPlural.election.voteClosed === true);
  ok('6', '탄핵 해제와 선거 조회', removed.body.ok === true && same(cleared, 'OFFICE_CLEARED', false) && cleared.election.recoveryNeeded === false && cleared.election.multiFileTransaction === false);
  ok('7', '중지 뒤 서버가 닫히고 저장은 남음', stopped.code === 0 && stopped.out.indexOf('stopped') >= 0 && closedPort === true && kept === true);
  ok('8', '기존 dev-data JSON은 그대로', oldUntouched === true);
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
