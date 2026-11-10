'use strict';
/**
 * 동률로 끝난 48시간 투표가 다음 접수 회차로 이어지는지 확인한다.
 * node tools/test-tie-refiling.js
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
const runService = require('../server/by-election-run-service');
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
const KR = '투표 결과 동률로 당선자가 결정되지 않았습니다. 지도자 직위는 공석으로 유지되며, 다음 후보 접수 기간에 새로운 선거가 진행됩니다.';
const EN = 'The election ended in a tie. The leadership position remains vacant. A new election cycle will begin with the next candidate registration period.';
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
  return { country: row.country, territory: row.territory, status: 'vacant', leaderId: null, removedAtMs: row.removedAtMs, vacancyStartMs: row.vacancyStartMs, rank: 'representative', fame: 42, season: 'season-kept', seasonEnd: null };
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
  const opened = election.openElection(electionStore, { country: country, territory: territory, nowMs: filingEnd, window: { provided: true }, filingRoundId: round.round.id, population: people(1000, country, territory, filingEnd) });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-tie-refile-'));
  const shared = launch.integratedPaths(dir);
  const electionStore = election.emptyStore();
  const filingStore = filing.emptyStore();
  const pioneer = openRound(electionStore, filingStore, 'KR', 'pioneer', [{ id: 'r1', name: '한결' }, { id: 'r2', name: '가온' }]);
  const guard = openRound(electionStore, filingStore, 'KR', 'guardian', [{ id: 'r3', name: '세찬' }, { id: 'r4', name: '다온' }, { id: 'r5', name: '라온' }]);
  const zero = openRound(electionStore, filingStore, 'US', 'pioneer', [{ id: 'u1', name: 'Ari' }, { id: 'u2', name: 'Noa' }], usAdult);
  const early = openRound(electionStore, filingStore, 'US', 'guardian', [{ id: 'u3', name: 'Eden' }, { id: 'u4', name: 'Wynn' }], usAdult);
  [pioneer, guard, zero, early].forEach(function (item) { if (!item.opened.ok) throw new Error(item.opened.reason); });
  await cast(electionStore, pioneer.opened.ballot, 'KR', 'pioneer', 'r1', 0);
  await cast(electionStore, pioneer.opened.ballot, 'KR', 'pioneer', 'r2', 1);
  await cast(electionStore, guard.opened.ballot, 'KR', 'guardian', 'r3', 0);
  await cast(electionStore, guard.opened.ballot, 'KR', 'guardian', 'r4', 1);
  await cast(electionStore, guard.opened.ballot, 'KR', 'guardian', 'r5', 2);
  const specs = [
    { id: 'tie-kr-pioneer', country: 'KR', territory: 'pioneer', built: pioneer },
    { id: 'tie-kr-guardian', country: 'KR', territory: 'guardian', built: guard },
    { id: 'zero-us-pioneer', country: 'US', territory: 'pioneer', built: zero },
    { id: 'early-us-guardian', country: 'US', territory: 'guardian', built: early },
  ];
  specs.forEach(function (item) { item.built.round.byElectionBallotId = item.id; });
  const removals = specs.map(function (item) { return removalRecord(item.id, item.country, item.territory); });
  function runFor(item) {
    const plan = vacancy.byElectionPlan(removedAt);
    return {
      id: 'byrun-' + item.id, citizenBallotId: item.id, country: item.country, territory: item.territory,
      removedAtMs: removedAt, sequence: item.built.round.sequence, filingRoundId: item.built.round.id, parentFilingRoundId: null,
      status: 'vote_open', openedAtMs: filingEnd - 3 * day, filingStartMs: plan.filingStartMs, filingEndMs: plan.filingEndMs,
      repetition: 1, electionId: item.built.opened.election.id, officeGranted: false, votesOpened: true, appointment: false,
      tieRule: false, recordedCandidateId: null, lock: 'single-process',
    };
  }
  fs.mkdirSync(dir, { recursive: true });
  vacancy.writeStore(shared.vacancy, { offices: removals.map(officeFor), removals: removals, schedules: removals.map(scheduleFor), seasons: [{ id: 'season-kept', end: null }] });
  election.writeStore(shared.election, electionStore);
  filing.writeStore(shared.filing, filingStore);
  fs.writeFileSync(shared.run, JSON.stringify({ runs: specs.map(runFor) }, null, 2));
  service.writeRankStore(shared.rank, { members: ['r1', 'r2', 'r3', 'r4', 'r5'].map(function (id) { return member(id, 'KR', id === 'r1' || id === 'r2' ? 'pioneer' : 'guardian'); }).concat(['u1', 'u2', 'u3', 'u4'].map(function (id) { return member(id, 'US', id === 'u1' || id === 'u2' ? 'pioneer' : 'guardian'); })), appointments: [], relinquishments: [], refreshes: [] });
  fs.writeFileSync(shared.citizen, JSON.stringify({ ballots: [], votes: [], blocks: [] }));
  const startEnv = Object.assign({}, process.env, {
    LEADER_DEV_DATA_DIR: dir,
    LEADER_ELECTION_DEV_PORT: '3051',
    BY_ELECTION_RUN_DEV_PORT: '3052',
    LEADER_APPOINTMENT_DEV_PORT: '3053',
  });
  delete startEnv.LEADER_DEV_INTEGRATION;
  const electionHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Election': 'preview' };
  const byHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-By-Election': 'preview' };
  const appointmentHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Leader-Appointment': 'preview' };
  function advance(id, nowMs, extra) {
    return request(3052, 'POST', '/dev/by-election/advance', Object.assign({ ballotId: id, clockSource: 'test-fixture', nowMs: nowMs }, extra || {}), byHeader);
  }
  function closeVote(ballotId, nowMs) {
    return request(3051, 'POST', '/dev/leader-election/ballots/' + encodeURIComponent(ballotId) + '/close', { clockSource: 'test-fixture', nowMs: nowMs }, electionHeader);
  }
  function electionView(id, nowMs) {
    return request(3051, 'GET', '/dev/leader-election/elections/' + encodeURIComponent(id) + '?nowMs=' + nowMs, null, electionHeader);
  }
  function office(country, territory) {
    return request(3053, 'GET', '/dev/leader-appointment/offices/' + country + '/' + territory, null, appointmentHeader);
  }
  let started = null;
  try {
    started = await runNode(['tools/start-leader-dev.js'], startEnv);
    if (started.code !== 0) throw new Error(started.err || started.out);
    const earlyAdvance = await advance('early-us-guardian', voteEnd - 1);
    const pioneerClose = await closeVote(pioneer.opened.ballot.id, voteEnd);
    const guardClose = await closeVote(guard.opened.ballot.id, voteEnd);
    const zeroClose = await closeVote(zero.opened.ballot.id, voteEnd);
    const beforeConnect = await electionView(pioneer.opened.election.id, voteEnd);
    const pioneerWait = await advance('tie-kr-pioneer', voteEnd + runService.REFILING_MS - 1);
    const pioneerOffice = await office('KR', 'pioneer');
    const nextStart = voteEnd + runService.REFILING_MS;
    const pioneerOpen = await advance('tie-kr-pioneer', nextStart);
    const pioneerAgain = await advance('tie-kr-pioneer', nextStart + 1);
    const pioneerRun = await request(3052, 'GET', '/dev/by-election/runs/tie-kr-pioneer', null, byHeader);
    const oldRoundPost = await request(3051, 'POST', '/dev/leader-election/rounds/' + encodeURIComponent(pioneer.round.id) + '/applications', {
      actor: clerk, window: { provided: true }, candidacyId: 'not-stored',
    }, electionHeader);
    const newRoundView = await request(3051, 'GET', '/dev/leader-election/rounds/' + encodeURIComponent(pioneerOpen.body.run.filingRoundId), null, electionHeader);
    await runNode(['tools/stop-leader-dev.js'], startEnv);
    const restarted = await runNode(['tools/start-leader-dev.js'], startEnv);
    const restored = await request(3052, 'GET', '/dev/by-election/runs/tie-kr-pioneer', null, byHeader);
    const filed = await request(3052, 'POST', '/dev/by-election/applications', {
      ballotId: 'tie-kr-pioneer', actorId: 'r1', actorName: '한결', clockSource: 'test-fixture', nowMs: nextStart + hour,
    }, byHeader);
    const reviewed = await request(3052, 'POST', '/dev/by-election/reviews', {
      ballotId: 'tie-kr-pioneer', candidacyId: filed.body.candidacy.id, action: 'start_review', clockSource: 'test-fixture', nowMs: nextStart + hour,
    }, byHeader);
    const approved = await request(3052, 'POST', '/dev/by-election/reviews', {
      ballotId: 'tie-kr-pioneer', candidacyId: filed.body.candidacy.id, action: 'approve', clockSource: 'test-fixture', nowMs: nextStart + hour + 1,
    }, byHeader);
    const soleEnd = nextStart + runService.FILING_MS;
    const soleBranch = await advance('tie-kr-pioneer', soleEnd, { population: people(1000, 'KR', 'pioneer', soleEnd) });
    const appointed = await request(3053, 'POST', '/dev/leader-appointment/appointments', {
      filingRoundId: pioneerOpen.body.run.filingRoundId, clockSource: 'test-fixture', nowMs: soleEnd, winnerId: 'forged', officeGranted: true,
    }, appointmentHeader);
    const afterSole = await office('KR', 'pioneer');
    const guardWait = await advance('tie-kr-guardian', voteEnd + 1);
    const guardNext = voteEnd + runService.REFILING_MS;
    const guardOpen = await advance('tie-kr-guardian', guardNext);
    const first = await request(3052, 'POST', '/dev/by-election/applications', { ballotId: 'tie-kr-guardian', actorId: 'r3', actorName: '세찬', clockSource: 'test-fixture', nowMs: guardNext + hour }, byHeader);
    const second = await request(3052, 'POST', '/dev/by-election/applications', { ballotId: 'tie-kr-guardian', actorId: 'r4', actorName: '다온', clockSource: 'test-fixture', nowMs: guardNext + hour }, byHeader);
    for (const item of [first, second]) {
      await request(3052, 'POST', '/dev/by-election/reviews', { ballotId: 'tie-kr-guardian', candidacyId: item.body.candidacy.id, action: 'start_review', clockSource: 'test-fixture', nowMs: guardNext + hour }, byHeader);
      await request(3052, 'POST', '/dev/by-election/reviews', { ballotId: 'tie-kr-guardian', candidacyId: item.body.candidacy.id, action: 'approve', clockSource: 'test-fixture', nowMs: guardNext + hour + 1 }, byHeader);
    }
    const guardEnd = guardNext + runService.FILING_MS;
    const pluralOpen = await advance('tie-kr-guardian', guardEnd, { population: people(1000, 'KR', 'guardian', guardEnd) });
    const voteA = await request(3052, 'POST', '/dev/by-election/votes', { ballotId: 'tie-kr-guardian', voteBallotId: pluralOpen.body.ballot.id, actorId: 'pop-KR-guardian-0', country: 'KR', territory: 'guardian', choice: 'r3', clockSource: 'test-fixture', nowMs: guardEnd + hour }, byHeader);
    const voteB = await request(3052, 'POST', '/dev/by-election/votes', { ballotId: 'tie-kr-guardian', voteBallotId: pluralOpen.body.ballot.id, actorId: 'pop-KR-guardian-1', country: 'KR', territory: 'guardian', choice: 'r4', clockSource: 'test-fixture', nowMs: guardEnd + hour }, byHeader);
    const secondCloseAt = guardEnd + 48 * hour;
    const secondClose = await closeVote(pluralOpen.body.ballot.id, secondCloseAt);
    const secondWait = await advance('tie-kr-guardian', secondCloseAt + 1);
    const secondEarly = await advance('tie-kr-guardian', secondCloseAt + runService.REFILING_MS - 1);
    const thirdOpen = await advance('tie-kr-guardian', secondCloseAt + runService.REFILING_MS);
    const thirdAgain = await advance('tie-kr-guardian', secondCloseAt + runService.REFILING_MS + 1);
    const zeroAdvance = await advance('zero-us-pioneer', voteEnd + 1);
    const zeroView = await electionView(zero.opened.election.id, voteEnd);
    const earlyRun = await request(3052, 'GET', '/dev/by-election/runs/early-us-guardian', null, byHeader);
    const zeroRun = await request(3052, 'GET', '/dev/by-election/runs/zero-us-pioneer', null, byHeader);
    const connected = await electionView(pioneer.opened.election.id, nextStart);
    const pioneerReps = (pioneerOffice.body.members || []).filter(function (row) { return row.id === 'r1' || row.id === 'r2'; });
    const newApps = newRoundView.body.applications || [];
    ok('1', '둘 동률', pioneerClose.body.ballot.failReason === 'TIE' && pioneerClose.body.ballot.winnerId == null && pioneerClose.body.ballot.officeGranted === false && beforeConnect.body.publicView.tieNotice.kr === KR && beforeConnect.body.publicView.tieNotice.en === EN && beforeConnect.body.publicView.tieNotice.filingDateShown === false && pioneerWait.body.tie === true && pioneerWait.body.run.nextRefilingAtMs === nextStart && connected.body.publicView.tieNotice.filingDateShown === true && connected.body.publicView.tieNotice.nextFilingStartMs === nextStart);
    ok('2', '셋 이상 공동 최다', guardClose.body.ballot.failReason === 'TIE' && guardClose.body.ballot.winnerId == null && guardClose.body.ballot.finalCandidateTotals.filter(function (row) { return row.votes === 1; }).length === 3 && guardWait.body.tie === true && guardWait.body.opened === false);
    ok('3', '0표는 동률과 다름', zeroClose.body.ballot.failReason === 'ZERO_VOTES' && zeroClose.body.ballot.winnerId == null && zeroAdvance.body.reason === 'ZERO_VOTES' && zeroAdvance.body.tie === false && zeroAdvance.body.opened === false && zeroView.body.publicView.tieNotice == null && zeroView.body.publicView.failReason === 'ZERO_VOTES' && zeroRun.body.runs.length === 1);
    ok('4', '48시간 종료 전 재접수 금지', earlyAdvance.body.reason === 'VOTE_NOT_ENDED' && earlyAdvance.body.opened === false && earlyRun.body.run.filingRoundId === early.round.id && earlyRun.body.run.status === 'vote_open');
    ok('5', '종료 후 공석과 대표 유지', pioneerOffice.body.office.status === 'vacant' && pioneerOffice.body.office.leaderId == null && pioneerReps.length === 2 && pioneerReps.every(function (row) { return row.rank === 'representative' && row.electedLeader === false; }));
    ok('6', '다음 접수 시작 전 새 회차 금지', pioneerWait.body.reason === 'REFILING_TOO_EARLY' && pioneerWait.body.opened === false && pioneerWait.body.run.filingRoundId === pioneer.round.id);
    ok('7', '접수 시작에 새 회차', pioneerOpen.body.opened === true && pioneerOpen.body.run.filingRoundId !== pioneer.round.id && pioneerOpen.body.run.filingStartMs === nextStart && pioneerOpen.body.run.filingEndMs - pioneerOpen.body.run.filingStartMs === runService.FILING_MS && pioneerOpen.body.run.filingStartMs !== removedAt + 7 * day && pioneerOpen.body.run.parentFilingRoundId === pioneer.round.id);
    ok('8', '이전 후보 자동 접수 없음', newApps.length === 0 && filed.body.ok === true && filed.body.filingRoundId === pioneerOpen.body.run.filingRoundId);
    ok('9', '같은 동률의 중복 회차 없음', pioneerAgain.body.alreadyOpen === true && pioneerAgain.body.run.filingRoundId === pioneerOpen.body.run.filingRoundId && oldRoundPost.body.reason === 'OLD_ROUND' && pioneerRun.body.runs.length === 2);
    ok('10', '새 회차 단독 임명', reviewed.body.ok === true && approved.body.ok === true && soleBranch.body.run.status === 'uncontested_recorded' && soleBranch.body.run.officeGranted === false && appointed.body.officeGranted === true && appointed.body.appointment.winnerId === 'r1' && afterSole.body.office.status === 'sitting' && afterSole.body.office.leaderId === 'r1' && afterSole.body.members.filter(function (row) { return row.id === 'r1'; })[0].rank === 'leader' && afterSole.body.members.filter(function (row) { return row.id === 'r2'; })[0].rank === 'representative');
    ok('11', '새 회차 복수 투표', pluralOpen.body.run.status === 'vote_open' && pluralOpen.body.run.votesOpened === true && pluralOpen.body.ballot.voteKind === 'leader_election_48h' && pluralOpen.body.ballot.endsAtMs - pluralOpen.body.ballot.startsAtMs === 48 * hour && pluralOpen.body.officeGranted === false && pluralOpen.body.office.status === 'vacant');
    ok('12', '다시 동률이면 다시 대기', voteA.body.ok === true && voteB.body.ok === true && secondClose.body.ballot.failReason === 'TIE' && secondClose.body.ballot.winnerId == null && secondWait.body.reason === 'REFILING_TOO_EARLY' && secondWait.body.run.nextRefilingAtMs === secondCloseAt + runService.REFILING_MS && secondEarly.body.opened === false && secondEarly.body.run.filingRoundId === guardOpen.body.run.filingRoundId && thirdOpen.body.opened === true && thirdOpen.body.run.filingRoundId !== guardOpen.body.run.filingRoundId && thirdAgain.body.alreadyOpen === true && thirdAgain.body.run.filingRoundId === thirdOpen.body.run.filingRoundId);
    ok('13', 'KR/US와 pioneer/guardian 분리', earlyRun.body.run.country === 'US' && earlyRun.body.run.territory === 'guardian' && earlyRun.body.run.filingRoundId === early.round.id && zeroRun.body.run.country === 'US' && zeroRun.body.run.territory === 'pioneer' && pioneerRun.body.run.country === 'KR' && pioneerRun.body.run.territory === 'pioneer' && guardOpen.body.run.territory === 'guardian' && guardOpen.body.run.country === 'KR' && guardOpen.body.run.filingRoundId !== pioneerOpen.body.run.filingRoundId);
    ok('14', '재시작 후 회차 유지', restarted.code === 0 && restored.body.run.filingRoundId === pioneerOpen.body.run.filingRoundId && restored.body.run.status === 'filing' && restored.body.office.status === 'vacant');
    ok('15', '기존 일정 상수를 재사용', pioneerWait.body.run.nextRefilingAtMs - pioneerWait.body.run.refilingBaseMs === runService.REFILING_MS && pioneerWait.body.run.tieRule === false && appointed.body.multiFileTransaction === false);
    console.log('oldRound=' + pioneer.round.id + ' newRound=' + pioneerOpen.body.run.filingRoundId + ' duplicate=' + pioneerAgain.body.run.filingRoundId);
    console.log(passed + ' passed, ' + failed + ' failed');
    if (failed) process.exitCode = 1;
  } finally {
    await runNode(['tools/stop-leader-dev.js'], startEnv);
  }
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
