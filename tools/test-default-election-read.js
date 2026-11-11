'use strict';
/**
 * 기본 개발 서버의 선거 조회가 임명 상태를 읽기만 한다.
 * node tools/test-default-election-read.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
const vacancy = require('../server/impeachment-vacancy-service');
const service = require('../server/leader-appointment-service');
const appointmentHttp = require('../server/leader-appointment-dev-http');
const byHttp = require('../server/by-election-run-dev-http');
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

function closeServer(server) {
  return new Promise(function (resolve) {
    if (!server) return resolve();
    server.close(function () { resolve(); });
  });
}

function stopChild(child) {
  return new Promise(function (resolve) {
    if (!child || child.killed) return resolve();
    child.once('exit', function () { resolve(); });
    child.kill();
  });
}

function startDefault(script, env, readyText) {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [script], {
      cwd: path.join(__dirname, '..'),
      env: Object.assign({}, process.env, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(function () { reject(new Error(script + ' did not start ' + buf)); }, 10000);
    child.stdout.on('data', function (chunk) {
      buf += chunk.toString();
      if (buf.indexOf(readyText) >= 0) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', function (chunk) { buf += chunk.toString(); });
    child.on('exit', function (code) {
      if (buf.indexOf(readyText) < 0) {
        clearTimeout(timer);
        reject(new Error(script + ' exited ' + code + ' ' + buf));
      }
    });
  });
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

function member(id, country, territory, rankName) {
  return { id: id, country: country, territory: territory, rank: rankName || 'representative', comparisonScore: 80, uniquePositiveEvaluators: 200, firstQualificationUsed: {}, electedLeader: false, xp: 11, fame: 6, activity: 4, achievements: ['kept'] };
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-default-read-'));
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
  const soleRemoval = removalRecord('ballot-sole', 'US', 'pioneer');
  const mainRemoval = removalRecord('ballot-main', 'KR', 'pioneer');
  const partialRemoval = removalRecord('ballot-partial', 'KR', 'guardian');
  const lagRemoval = removalRecord('ballot-lag', 'US', 'guardian');
  const sole = openRound(electionStore, filingStore, 'US', 'pioneer', [{ id: 'u1', name: 'Ari' }], usAdult);
  const main = openRound(electionStore, filingStore, 'KR', 'pioneer', [{ id: 'r1', name: '한결' }, { id: 'r2', name: '가온' }]);
  const partial = openRound(electionStore, filingStore, 'KR', 'guardian', [{ id: 'r5', name: '부분' }, { id: 'r6', name: '저장' }]);
  const lag = openRound(electionStore, filingStore, 'US', 'guardian', [{ id: 'u5', name: '지연' }, { id: 'u6', name: '복구' }], usAdult);
  [sole, main, partial, lag].forEach(function (item) { if (!item.opened.ok) throw new Error(item.opened.reason); });
  sole.round.byElectionBallotId = soleRemoval.citizenBallotId;
  main.round.byElectionBallotId = mainRemoval.citizenBallotId;
  partial.round.byElectionBallotId = partialRemoval.citizenBallotId;
  lag.round.byElectionBallotId = lagRemoval.citizenBallotId;
  for (let index = 0; index < 3; index += 1) await cast(electionStore, main.opened.ballot, 'KR', 'pioneer', 'r1', index);
  for (let index = 0; index < 3; index += 1) await cast(electionStore, partial.opened.ballot, 'KR', 'guardian', 'r5', index);
  for (let index = 0; index < 3; index += 1) await cast(electionStore, lag.opened.ballot, 'US', 'guardian', 'u5', index);
  for (const item of [partial, lag]) {
    const closed = await election.closeBallot(electionStore, { ballotId: item.opened.ballot.id, nowMs: voteEnd });
    if (!closed.ok) throw new Error(closed.reason);
  }
  const removals = [soleRemoval, mainRemoval, partialRemoval, lagRemoval];
  vacancy.writeStore(paths.vacancy, { offices: removals.map(officeFor), removals: removals, schedules: removals.map(scheduleFor), seasons: [{ id: 'season-kept', end: null }] });
  election.writeStore(paths.election, electionStore);
  filing.writeStore(paths.filing, filingStore);
  fs.writeFileSync(paths.run, JSON.stringify({ runs: [
    runFor(soleRemoval, sole.round.id, 'uncontested_recorded', 'u1'),
    runFor(mainRemoval, main.round.id, 'vote_open'),
    runFor(partialRemoval, partial.round.id, 'vote_open'),
    runFor(lagRemoval, lag.round.id, 'vote_open'),
  ] }, null, 2));
  service.writeRankStore(paths.rank, { members: [member('u1', 'US', 'pioneer'), member('r1', 'KR', 'pioneer'), member('r2', 'KR', 'pioneer'), member('c1', 'KR', 'pioneer', 'citizen'), member('r5', 'KR', 'guardian'), member('r6', 'KR', 'guardian'), member('u5', 'US', 'guardian'), member('u6', 'US', 'guardian')], appointments: [], relinquishments: [], refreshes: [] });
  fs.writeFileSync(paths.citizen, JSON.stringify({ ballots: [], votes: [], blocks: [] }));

  const env = {
    LEADER_ELECTION_DEV_PORT: '3025',
    BY_ELECTION_RUN_DEV_PORT: '3026',
    LEADER_ELECTION_STORE: paths.election,
    LEADER_FILING_STORE: paths.filing,
    IMPEACHMENT_VACANCY_STORE: paths.vacancy,
    LEADER_APPOINTMENT_RANK_STORE: paths.rank,
    BY_ELECTION_RUN_STORE: paths.run,
  };
  const electionChild = await startDefault('server/leader-election-dev-http.js', env, 'leader election dev http');
  const byChild = await startDefault('server/by-election-run-dev-http.js', env, 'by-election run dev http');
  const appointmentServer = await appointmentHttp.listen(3027, paths);
  const electionHeader = { 'X-SentenceArena-Dev-Election': 'preview' };
  const byHeader = { 'X-SentenceArena-Dev-By-Election': 'preview' };
  const appointmentHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Leader-Appointment': 'preview' };
  async function reads(id) {
    const left = await request(3025, 'GET', '/dev/leader-election/elections/' + encodeURIComponent(id), null, electionHeader);
    const right = await request(3026, 'GET', '/dev/by-election/elections/' + encodeURIComponent(id), null, byHeader);
    return { election: left.body.publicView, by: right.body };
  }
  function appoint(roundId, nowMs, extra) {
    return request(3027, 'POST', '/dev/leader-appointment/appointments', Object.assign({
      filingRoundId: roundId, clockSource: 'test-fixture', nowMs: nowMs, winnerId: 'forged', officeGranted: true,
    }, extra || {}), appointmentHeader);
  }
  const before = await reads(sole.opened.election.id);
  const openVote = await reads(main.opened.election.id);
  const soleDone = await appoint(sole.round.id, filingEnd);
  const afterSole = await reads(sole.opened.election.id);
  const disk = election.readStore(paths.election);
  const closed = await election.closeBallot(disk, { ballotId: main.opened.ballot.id, nowMs: voteEnd });
  if (!closed.ok) throw new Error('close ' + closed.reason);
  election.writeStore(paths.election, disk);
  const pluralDone = await appoint(main.round.id, voteEnd);
  const afterPlural = await reads(main.opened.election.id);
  const crashed = await appoint(partial.round.id, voteEnd, { crashBeforeGrant: true });
  const afterPartial = await reads(partial.opened.election.id);
  const lagged = await appoint(lag.round.id, voteEnd, { crashBeforeRun: true });
  const duringLag = await reads(lag.opened.election.id);
  const recovered = await appoint(lag.round.id, voteEnd);
  const afterLag = await reads(lag.opened.election.id);
  const closeAt = voteEnd + hour;
  fs.writeFileSync(paths.citizen, JSON.stringify({ ballots: [{ id: 'citizen-u1', voteKind: 'citizen_impeachment_48h', proposalId: 'imp-u1', country: 'US', territory: 'pioneer', leaderId: 'u1', leaderName: 'Ari', status: 'closed', result: 'passed', closedOnce: true, startsAtMs: closeAt - 48 * hour, endsAtMs: closeAt, closedAtMs: closeAt }], votes: [], blocks: [] }));
  const removed = await request(3027, 'POST', '/dev/leader-appointment/removals', { ballotId: 'citizen-u1', clockSource: 'test-fixture', nowMs: closeAt }, appointmentHeader);
  const cleared = await reads(sole.opened.election.id);
  const snap = [paths.vacancy, paths.election, paths.rank, paths.run].map(function (file) { return fs.readFileSync(file); });
  await reads(main.opened.election.id);
  const unchanged = [paths.vacancy, paths.election, paths.rank, paths.run].every(function (file, index) { return fs.readFileSync(file).equals(snap[index]); });
  fs.renameSync(paths.rank, paths.rank + '.hidden');
  const missing = await reads(main.opened.election.id);
  fs.renameSync(paths.rank + '.hidden', paths.rank);
  const barePaths = { vacancy: paths.vacancy, election: paths.election, filing: paths.filing, run: paths.run };
  const bare = await byHttp.listen(3028, barePaths);
  const bareRead = await request(3028, 'GET', '/dev/by-election/elections/' + encodeURIComponent(main.opened.election.id), null, byHeader);
  await closeServer(bare);
  await closeServer(appointmentServer);
  await stopChild(electionChild);
  await stopChild(byChild);

  function same(pair, check, granted) {
    return pair.election && pair.by && pair.election.appointmentCheck === check && pair.by.appointmentCheck === check && pair.election.officeGranted === granted && pair.by.officeGranted === granted && pair.election.appointedByThisRead === false && pair.by.appointedByThisRead === false && pair.election.multiFileTransaction === false && pair.by.multiFileTransaction === false;
  }
  ok('1', '임명 전', same(before, 'WINNER_NOT_APPOINTED', false) && same(openVote, 'VOTE_OPEN', false) && before.election.winnerId === 'u1');
  ok('2', '단독 임명 후', soleDone.body.officeGranted === true && same(afterSole, 'APPOINTMENT_COMPLETE', true) && afterSole.election.winnerId === 'u1' && afterSole.election.recoveryNeeded === false);
  ok('3', '복수 임명 후', pluralDone.body.officeGranted === true && same(afterPlural, 'APPOINTMENT_COMPLETE', true) && afterPlural.election.voteClosed === true && afterPlural.election.winnerId === 'r1');
  ok('4', '부분 저장', crashed.body.reason === 'PARTIAL_WRITE' && same(afterPartial, 'PARTIAL_STATE', false) && afterPartial.election.recoveryNeeded === true);
  ok('5', '실행 파일 지연과 복구', lagged.body.stoppedBeforeRun === true && same(duringLag, 'RUN_LAG', false) && duringLag.election.recoveryNeeded === true && recovered.body.reason === 'RUN_LAG_RECOVERED' && same(afterLag, 'APPOINTMENT_COMPLETE', true) && afterLag.election.appointmentParts.runOfficeGranted === true);
  ok('6', '정상 탄핵은 복구 대상이 아님', removed.body.ok === true && same(cleared, 'OFFICE_CLEARED', false) && cleared.election.recoveryNeeded === false && cleared.election.storedElectionOfficeGranted === true);
  ok('7', '저장을 확인하지 못하면 완료로 보지 않음', missing.election.appointmentCheck === 'STORE_READ_ERROR' && missing.election.officeGranted === false && missing.by.officeGranted === false && bareRead.body.appointmentCheck === 'STORES_NOT_CHECKED' && bareRead.body.officeGranted === false && bareRead.body.appointmentComplete === false);
  ok('8', '조회는 파일을 쓰지 않음', unchanged === true);
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
