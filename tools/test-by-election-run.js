'use strict';
/**
 * 보궐 접수와 분기. 직위는 부여하지 않는다. 운영 DB를 열지 않는다.
 * node tools/test-by-election-run.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const service = require('../server/by-election-run-service');
const httpDev = require('../server/by-election-run-dev-http');
const vacancy = require('../server/impeachment-vacancy-service');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
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

const removedAt = 1700000000000;
const day = service.DAY_MS;
const hour = vote.HOUR_MS;
const filingStart = removedAt + 7 * day;
const filingEnd = removedAt + 10 * day;
const voteEnd = filingEnd + 48 * hour;
const header = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-By-Election': 'preview' };
const repo = path.join(__dirname, '..');

function request(port, method, urlPath, body, headers) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      method: method,
      path: urlPath,
      headers: headers || {},
      agent: false,
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
    rows.push({ id: 'v' + i, country: country, territory: territory, valid: true, lastPostAtMs: atMs - 1000 });
  }
  return { source: 'test-fixture', records: rows };
}

function removal(id, country, territory, at) {
  return {
    id: 'dev-office-removal:' + id,
    citizenBallotId: id,
    country: country,
    territory: territory,
    removedAtMs: at,
    vacancyStartMs: at,
    rankChanged: false,
    seasonChanged: false,
    followUpElectionOpened: false,
  };
}

function office(country, territory, status) {
  return {
    country: country,
    territory: territory,
    status: status || 'vacant',
    leaderId: status === 'sitting' ? 'leader-central' : null,
    rank: 'representative',
    fame: 42,
    season: 'season-kept',
    seasonEnd: null,
    removedAtMs: status === 'sitting' ? null : removedAt,
  };
}

function roundsFor(electionPath, ballotId) {
  return election.readStore(electionPath).rounds.filter(function (row) { return row.byElectionBallotId === ballotId; });
}

function appsFor(electionPath, roundId) {
  return election.readStore(electionPath).roundApplications.filter(function (row) { return row.filingRoundId === roundId; });
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-by-election-'));
  const paths = {
    vacancy: path.join(dir, 'vacancy.json'),
    election: path.join(dir, 'election.json'),
    filing: path.join(dir, 'filing.json'),
    run: path.join(dir, 'run.json'),
  };
  const clientAt = Date.now();
  vacancy.writeStore(paths.vacancy, {
    offices: [
      office('KR', 'pioneer', 'vacant'),
      office('KR', 'guardian', 'vacant'),
      office('US', 'pioneer', 'vacant'),
      office('US', 'guardian', 'vacant'),
      office('KR', 'central', 'sitting'),
    ],
    removals: [
      removal('early', 'KR', 'pioneer', removedAt),
      removal('zero', 'KR', 'pioneer', removedAt),
      removal('late', 'KR', 'pioneer', removedAt),
      removal('sole', 'KR', 'pioneer', removedAt),
      removal('exclude', 'KR', 'pioneer', removedAt),
      removal('lost', 'KR', 'pioneer', removedAt),
      removal('multi', 'KR', 'pioneer', removedAt),
      removal('dup', 'KR', 'pioneer', removedAt),
      removal('concurrent', 'KR', 'pioneer', removedAt),
      removal('concurrent-branch', 'KR', 'pioneer', removedAt),
      removal('fail', 'KR', 'pioneer', removedAt),
      removal('restart', 'US', 'pioneer', removedAt),
      removal('us', 'US', 'guardian', removedAt),
      removal('guard', 'KR', 'guardian', removedAt),
      removal('central', 'KR', 'central', removedAt),
      removal('client', 'US', 'pioneer', clientAt),
    ],
    schedules: [],
    ranks: [{ country: 'KR', territory: 'pioneer', representative: 8, fame: 42 }],
    seasons: [{ id: 'season-kept', end: null }],
  });
  election.writeStore(paths.election, election.emptyStore());
  filing.writeStore(paths.filing, filing.emptyStore());
  service.writeStore(paths.run, service.emptyStore());
  const officeBefore = fs.readFileSync(paths.vacancy, 'utf8');

  const port = 3018;
  let server = await httpDev.listen(port, paths);
  const bound = server.address().address === '127.0.0.1';

  function advance(ballotId, nowMs, extra) {
    return request(port, 'POST', '/dev/by-election/advance', Object.assign({
      ballotId: ballotId,
      clockSource: 'test-fixture',
      nowMs: nowMs,
    }, extra || {}), header);
  }
  function apply(ballotId, actorId, name, nowMs) {
    return request(port, 'POST', '/dev/by-election/applications', {
      ballotId: ballotId,
      actorId: actorId,
      actorName: name,
      clockSource: 'test-fixture',
      nowMs: nowMs,
    }, header);
  }
  function review(ballotId, candidacyId, action, nowMs) {
    return request(port, 'POST', '/dev/by-election/reviews', {
      ballotId: ballotId,
      candidacyId: candidacyId,
      action: action,
      clockSource: 'test-fixture',
      nowMs: nowMs,
    }, header);
  }
  async function approve(ballotId, actorId, name, nowMs) {
    const filed = await apply(ballotId, actorId, name, nowMs);
    const started = filed.body && filed.body.candidacy
      ? await review(ballotId, filed.body.candidacy.id, 'start_review', nowMs)
      : { body: { ok: false } };
    const approved = started.body && started.body.ok
      ? await review(ballotId, filed.body.candidacy.id, 'approve', nowMs)
      : { body: { ok: false } };
    return { filed: filed, started: started, approved: approved };
  }

  const noHeader = await request(port, 'POST', '/dev/by-election/advance', {
    ballotId: 'early',
    clockSource: 'test-fixture',
    nowMs: filingStart,
    officeGranted: true,
  });
  const early = await advance('early', filingStart - 1, { winnerId: 'forged', officeGranted: true });
  const earlyView = await request(port, 'GET', '/dev/by-election/runs/early', null, header);

  const usOpen = await advance('us', filingStart);
  const guardOpen = await advance('guard', filingStart);

  const opened = await advance('zero', filingStart, { winnerId: 'forged', officeGranted: true, passed: true });
  const filedMix = await apply('zero', 'r8', '이안', filingStart + hour);
  if (filedMix.body && filedMix.body.candidacy) {
    await review('zero', filedMix.body.candidacy.id, 'start_review', filingStart + hour);
  }
  const before = await advance('zero', filingEnd - 1, { population: people(1000, 'KR', 'pioneer', filingEnd - 1), winnerId: 'forged' });
  const electionsWhileFiling = election.readStore(paths.election).elections.filter(function (row) {
    return opened.body.run && row.filingRoundId === opened.body.run.filingRoundId;
  }).length;
  const zero = await advance('zero', filingEnd, {
    population: people(1000, 'KR', 'pioneer', filingEnd),
    winnerId: 'forged',
    officeGranted: true,
    voterIds: ['hacker'],
    eligibleCount: 1,
  });
  const late = await advance('late', filingEnd, { population: people(1000, 'KR', 'pioneer', filingEnd), officeGranted: true });
  const nextAt = zero.body.run ? Number(zero.body.run.nextRefilingAtMs) : 0;
  const tooSoon = await advance('zero', nextAt - 1, { population: people(1000, 'KR', 'pioneer', nextAt - 1) });
  const refile = await advance('zero', nextAt, { winnerId: 'forged' });
  const refileAgain = await advance('zero', nextAt, { officeGranted: true });
  const refileEnd = refile.body.run ? Number(refile.body.run.filingEndMs) : 0;
  const refileClear = await advance('zero', refileEnd, { population: people(1000, 'KR', 'pioneer', refileEnd) });

  const soleOpen = await advance('sole', filingStart);
  const soleFile = await approve('sole', 'r1', '한결', filingStart + hour);
  const sole = await advance('sole', filingEnd, {
    population: people(1000, 'KR', 'pioneer', filingEnd),
    winnerId: 'forged',
    officeGranted: true,
    passed: true,
    confirmed: true,
  });

  const excludeOpen = await advance('exclude', filingStart);
  const keep = await approve('exclude', 'r3', '하람', filingStart + hour);
  const drop = await approve('exclude', 'r4', '가온', filingStart + hour);
  if (drop.filed.body && drop.filed.body.candidacy) {
    const box = filing.readStore(paths.filing);
    const row = box.candidacies.filter(function (item) { return item.id === drop.filed.body.candidacy.id; })[0];
    row.status = 'withdrawn';
    filing.writeStore(paths.filing, box);
  }
  const excluded = await advance('exclude', filingEnd, {
    population: people(1000, 'KR', 'pioneer', filingEnd),
    winnerId: 'forged',
    officeGranted: true,
  });

  const lostOpen = await advance('lost', filingStart);
  const lostFile = await approve('lost', 'r5', '로운', filingStart + hour);
  if (lostFile.filed.body && lostFile.filed.body.candidacy) {
    const box = filing.readStore(paths.filing);
    const row = box.candidacies.filter(function (item) { return item.id === lostFile.filed.body.candidacy.id; })[0];
    row.actorId = 'lost';
    filing.writeStore(paths.filing, box);
  }
  const lost = await advance('lost', filingEnd, { population: people(1000, 'KR', 'pioneer', filingEnd), officeGranted: true });

  const multiOpen = await advance('multi', filingStart);
  const first = await approve('multi', 'r6', '바다', filingStart + hour);
  const second = await approve('multi', 'r7', '하늘', filingStart + hour);
  const multi = await advance('multi', filingEnd, {
    population: people(1000, 'KR', 'pioneer', filingEnd),
    winnerId: 'forged',
    officeGranted: true,
    voterIds: ['hacker'],
    eligibleCount: 1,
    passed: true,
  });
  const voteBallotId = multi.body.ballot ? multi.body.ballot.id : '';
  const cast = await request(port, 'POST', '/dev/by-election/votes', {
    ballotId: 'multi',
    voteBallotId: voteBallotId,
    actorId: 'v0',
    country: 'KR',
    territory: 'pioneer',
    choice: 'r6',
    clockSource: 'test-fixture',
    nowMs: filingEnd + hour,
    winnerId: 'forged',
  }, header);
  const shown = voteBallotId
    ? await request(port, 'GET', '/dev/by-election/elections/' + multi.body.election.id + '?clockSource=test-fixture&nowMs=' + (filingEnd + hour), null, header)
    : { body: {} };
  const again = await request(port, 'POST', '/dev/by-election/votes', {
    ballotId: 'multi',
    voteBallotId: voteBallotId,
    actorId: 'v0',
    country: 'KR',
    territory: 'pioneer',
    choice: 'r7',
    clockSource: 'test-fixture',
    nowMs: filingEnd + hour + 1,
  }, header);
  const clientCast = await request(port, 'POST', '/dev/by-election/votes', {
    ballotId: 'multi',
    voteBallotId: voteBallotId,
    actorId: 'v1',
    country: 'KR',
    territory: 'pioneer',
    choice: 'r6',
    clockSource: 'browser',
    nowMs: filingEnd + hour,
    winnerId: 'forged',
  }, header);
  const noClose = await request(port, 'POST', '/dev/by-election/close', {
    ballotId: 'multi',
    voteBallotId: voteBallotId,
    winnerId: 'forged',
    officeGranted: true,
    clockSource: 'test-fixture',
    nowMs: voteEnd + 1,
  }, header);
  const afterEnd = await advance('multi', voteEnd + 1, { winnerId: 'forged', officeGranted: true, passed: true });
  const multiView = await request(port, 'GET', '/dev/by-election/runs/multi', null, header);

  const dupA = await advance('dup', filingStart, { officeGranted: true });
  const dupB = await advance('dup', filingStart, { winnerId: 'forged' });
  await advance('dup', filingEnd, { population: people(1000, 'KR', 'pioneer', filingEnd) });

  const pair = await Promise.all([
    advance('concurrent', filingStart, { officeGranted: true, winnerId: 'forged' }),
    advance('concurrent', filingStart, { officeGranted: true, winnerId: 'other' }),
  ]);
  await advance('concurrent', filingEnd, { population: people(1000, 'KR', 'pioneer', filingEnd) });

  await advance('concurrent-branch', filingStart);
  const branchPair = await Promise.all([
    advance('concurrent-branch', filingEnd, { population: people(1000, 'KR', 'pioneer', filingEnd), winnerId: 'forged', officeGranted: true }),
    advance('concurrent-branch', filingEnd, { population: people(1000, 'KR', 'pioneer', filingEnd), winnerId: 'other', officeGranted: true }),
  ]);

  const failOpen = await advance('fail', filingStart, { failElectionWrite: true, officeGranted: true });
  const roundsAfterFailOpen = roundsFor(paths.election, 'fail').length;
  const runAfterFailOpen = fs.readFileSync(paths.run, 'utf8');
  const failOpenRetry = await advance('fail', filingStart);
  const electionBeforeBranch = fs.readFileSync(paths.election, 'utf8');
  const failBranch = await advance('fail', filingEnd, {
    population: people(1000, 'KR', 'pioneer', filingEnd),
    failElectionWrite: true,
    officeGranted: true,
  });
  const electionAfterFail = fs.readFileSync(paths.election, 'utf8');
  const failRun = await advance('fail', filingEnd, {
    population: people(1000, 'KR', 'pioneer', filingEnd),
    failRunWrite: true,
    winnerId: 'forged',
  });
  const electionsAfterRunFail = election.readStore(paths.election).elections.filter(function (row) {
    return row.filingRoundId && roundsFor(paths.election, 'fail').some(function (round) { return round.id === row.filingRoundId; });
  });
  const runStillFiling = service.readStore(paths.run).runs.filter(function (row) { return row.citizenBallotId === 'fail'; })[0];
  const failRetry = await advance('fail', filingEnd, { winnerId: 'forged', officeGranted: true });
  const failElections = election.readStore(paths.election).elections.filter(function (row) {
    return roundsFor(paths.election, 'fail').some(function (round) { return round.id === row.filingRoundId; });
  });

  const client = await request(port, 'POST', '/dev/by-election/advance', {
    ballotId: 'client',
    clockSource: 'browser',
    nowMs: clientAt + 7 * day,
    winnerId: 'forged',
    officeGranted: true,
    passed: true,
  }, header);

  const central = await advance('central', filingEnd, { population: people(1000, 'KR', 'central', filingEnd), officeGranted: true, winnerId: 'forged' });

  await closeServer(server);
  server = await httpDev.listen(port, paths);
  const restarted = await request(port, 'GET', '/dev/by-election/runs/restart', null, header);
  const restartOpen = await advance('restart', filingStart);
  await closeServer(server);
  server = await httpDev.listen(port, paths);
  const restartAgain = await request(port, 'GET', '/dev/by-election/runs/restart', null, header);
  await advance('restart', filingEnd, { population: people(1000, 'US', 'pioneer', filingEnd) });

  const usStill = await request(port, 'GET', '/dev/by-election/runs/us', null, header);
  const guardStill = await request(port, 'GET', '/dev/by-election/runs/guard', null, header);
  const officeAfter = fs.readFileSync(paths.vacancy, 'utf8');
  const pioneerOffice = vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.country === 'KR' && row.territory === 'pioneer'; })[0];
  const centralOffice = vacancy.readStore(paths.vacancy).offices.filter(function (row) { return row.territory === 'central'; })[0];

  const hiddenCandidate = shown.body && Array.isArray(shown.body.candidates)
    ? shown.body.candidates.every(function (row) { return row.votes == null && row.total == null; })
    : false;
  const source = fs.readFileSync(path.join(repo, 'server', 'by-election-run-service.js'), 'utf8');
  const httpSource = fs.readFileSync(path.join(repo, 'server', 'by-election-run-dev-http.js'), 'utf8');
  const loadedDb = Object.keys(require.cache).some(function (key) {
    return key.indexOf('node_modules\\pg\\') >= 0 || key.indexOf('node_modules/pg/') >= 0 || key.indexOf('supabase') >= 0;
  });

  ok('1', '7일 전 접수 금지', noHeader.status === 403 && noHeader.body.reason === 'DEV_HEADER_NOT_AUTH' && early.status === 403 && early.body.reason === 'FILING_TOO_EARLY' && early.body.officeGranted === false && earlyView.body.run == null && roundsFor(paths.election, 'early').length === 0);
  ok('2', '정확히 7일에 접수 개설', opened.status === 200 && opened.body.opened === true && opened.body.branched === false && opened.body.run.status === 'filing' && opened.body.run.filingStartMs === filingStart && opened.body.run.officeGranted === false && opened.body.office.status === 'vacant' && opened.body.office.leaderId == null);
  ok('3', '10일 전 분기 금지', before.status === 200 && before.body.branched === false && before.body.run.status === 'filing' && before.body.run.electionId == null && electionsWhileFiling === 0);
  ok('4', '정확히 10일에 후보 수 분기', zero.status === 200 && zero.body.branched === true && zero.body.run.branchedAtMs === filingEnd && zero.body.run.status === 'weekly_refiling_waiting' && late.status === 200 && late.body.branched === true && late.body.run.status === 'weekly_refiling_waiting' && roundsFor(paths.election, 'late').length === 1 && late.body.run.officeGranted === false);
  ok('5', '0명 재접수 대기와 공석', zero.body.run.status === 'weekly_refiling_waiting' && zero.body.run.votesOpened === false && zero.body.run.officeGranted === false && zero.body.office.status === 'vacant' && zero.body.office.leaderId == null && zero.body.appointment === false && (zero.body.ballot == null));
  const oldApps = appsFor(paths.election, opened.body.run.filingRoundId);
  const newApps = refile.body.run ? appsFor(paths.election, refile.body.run.filingRoundId) : [];
  ok('6', '7일 뒤 독립 재접수와 중복 금지', filedMix.body.ok === true && tooSoon.body.reason === 'REFILING_TOO_EARLY' && tooSoon.body.opened === false && refile.status === 200 && refile.body.run.filingRoundId !== opened.body.run.filingRoundId && refile.body.run.repetition === 2 && refile.body.run.parentFilingRoundId === opened.body.run.filingRoundId && refile.body.run.refilingBaseMs === filingEnd && oldApps.length === 1 && oldApps[0].actorId === 'r8' && newApps.length === 0 && refileAgain.body.alreadyOpen === true && refileAgain.body.run.filingRoundId === refile.body.run.filingRoundId && roundsFor(paths.election, 'zero').length === 2 && refileClear.body.run.status === 'weekly_refiling_waiting');
  ok('7', '유효 1명 uncontested_recorded officeGranted false', soleFile.approved.body.ok === true && sole.body.run.status === 'uncontested_recorded' && sole.body.run.officeGranted === false && sole.body.election.officeGranted === false && sole.body.election.status === 'uncontested_recorded' && sole.body.run.recordedCandidateId === 'r1' && sole.body.election.winnerId === 'r1' && sole.body.office.status === 'vacant' && sole.body.office.leaderId == null);
  ok('8', '직위 부여는 하지 않음', sole.body.officeGranted === false && sole.body.appointment === false && sole.body.office.status === 'vacant' && sole.body.office.rank === 'representative' && sole.body.office.leaderId == null && sole.body.election.winnerId !== 'forged' && source.indexOf('closeBallot') < 0);
  ok('9', '1명은 투표를 열지 않음', sole.body.run.votesOpened === false && sole.body.election.votesOpened === false && sole.body.election.ballotId == null && sole.body.ballot == null && sole.body.publicView.votesOpened === false && sole.body.publicView.officeGranted === false);
  const multiCandidates = shown.body.candidates || [];
  ok('10', '2명 이상 48시간 투표만 개설', first.approved.body.ok === true && second.approved.body.ok === true && multi.body.run.status === 'vote_open' && multi.body.run.votesOpened === true && multi.body.run.officeGranted === false && multi.body.ballot.voteKind === 'leader_election_48h' && multi.body.ballot.endsAtMs - multi.body.ballot.startsAtMs === 48 * hour && multi.body.ballot.eligibleRepresentativeIds.length === 1000 && multi.body.ballot.eligibleRepresentativeIds.indexOf('hacker') < 0 && multi.body.publicView.countsHidden === true && multi.body.office.status === 'vacant' && cast.body.ok === true && shown.body.countsHidden === true && shown.body.castCount === 1 && shown.body.candidateTotals == null && hiddenCandidate && multiCandidates.length === 2 && again.body.reason === 'DUPLICATE_VOTE' && noClose.body.reason === 'APPOINTMENT_NOT_DONE' && afterEnd.body.alreadyBranched === true && afterEnd.body.officeGranted === false && multiView.body.election.status === 'open' && multiView.body.election.winnerId == null);
  const keptReview = election.readStore(paths.election).reviews.filter(function (row) { return keep.filed.body.candidacy && row.candidacyId === keep.filed.body.candidacy.id; })[0];
  ok('11', '자격 재검증으로 유효 후보 유지', excluded.body.excluded && excluded.body.excluded.some(function (row) { return row.reason === 'WITHDRAWN'; }) && excluded.body.run.recordedCandidateId === 'r3' && excluded.body.election.status === 'uncontested_recorded' && keptReview && keptReview.status === 'approved' && keptReview.exclusion == null);
  ok('12', '철회와 자격 상실 제외', excluded.body.run.votesOpened === false && excluded.body.office.status === 'vacant' && lost.body.run.status === 'weekly_refiling_waiting' && lost.body.excluded.some(function (row) { return row.reason === 'NOT_REPRESENTATIVE'; }) && lost.body.run.recordedCandidateId == null && lost.body.officeGranted === false && lost.body.office.leaderId == null);
  ok('13', '중복 실행 차단', dupA.body.opened === true && dupB.body.alreadyOpen === true && dupA.body.run.filingRoundId === dupB.body.run.filingRoundId && roundsFor(paths.election, 'dup').length === 1);
  ok('14', '동시 실행은 하나만', pair.filter(function (row) { return row.body.opened === true; }).length === 1 && pair.filter(function (row) { return row.body.alreadyOpen === true; }).length === 1 && roundsFor(paths.election, 'concurrent').length === 1 && branchPair.filter(function (row) { return row.body.ok && row.body.run && row.body.run.electionId; }).length === 2 && branchPair[0].body.run.electionId === branchPair[1].body.run.electionId && election.readStore(paths.election).elections.filter(function (row) { return row.filingRoundId === branchPair[0].body.run.filingRoundId; }).length === 1 && pair[0].body.lock === 'single-process');
  ok('15', '재시작 후 저장 유지', restartOpen.body.run.status === 'filing' && restartAgain.body.run.filingRoundId === restartOpen.body.run.filingRoundId && restartAgain.body.office.status === 'vacant' && restartAgain.body.officeGranted === false && restarted.body.run == null);
  ok('16', '저장 실패와 재시도', failOpen.body.reason === 'ELECTION_STORE_WRITE_FAILED' && roundsAfterFailOpen === 0 && runAfterFailOpen.indexOf('"citizenBallotId": "fail"') < 0 && failOpenRetry.body.opened === true && failBranch.body.reason === 'ELECTION_STORE_WRITE_FAILED' && electionAfterFail === electionBeforeBranch && failRun.body.reason === 'RUN_STORE_WRITE_FAILED' && electionsAfterRunFail.length === 1 && runStillFiling.status === 'filing' && failRetry.body.adopted === true && failElections.length === 1 && failRetry.body.run.officeGranted === false && failRetry.body.office.status === 'vacant');
  ok('17', 'KR/US 분리', usOpen.body.run.country === 'US' && usOpen.body.run.territory === 'guardian' && opened.body.run.country === 'KR' && usStill.body.run.filingRoundId === usOpen.body.run.filingRoundId && usStill.body.run.status === 'filing' && usStill.body.office.status === 'vacant');
  ok('18', 'pioneer/guardian 분리', guardOpen.body.run.country === 'KR' && guardOpen.body.run.territory === 'guardian' && guardOpen.body.run.filingRoundId !== opened.body.run.filingRoundId && guardStill.body.run.filingRoundId === guardOpen.body.run.filingRoundId && guardStill.body.run.status === 'filing' && pioneerOffice.territory === 'pioneer');
  ok('19', 'central 금지', central.status === 403 && central.body.reason === 'TERRITORY_NOT_ELIGIBLE' && roundsFor(paths.election, 'central').length === 0 && centralOffice.status === 'sitting' && centralOffice.leaderId === 'leader-central');
  ok('20', '계급 명성 시즌 불변', officeAfter === officeBefore && pioneerOffice.rank === 'representative' && pioneerOffice.fame === 42 && pioneerOffice.season === 'season-kept' && pioneerOffice.seasonEnd == null && pioneerOffice.status === 'vacant' && vacancy.readStore(paths.vacancy).ranks[0].representative === 8 && vacancy.readStore(paths.vacancy).seasons[0].end == null);
  ok('23', '클라이언트 시각과 당선 값 무시', client.status === 403 && client.body.reason === 'FILING_TOO_EARLY' && roundsFor(paths.election, 'client').length === 0 && client.body.clientWinnerIgnored === true && early.body.clientWinnerIgnored === true && sole.body.election.winnerId === 'r1' && multi.body.election.winnerId == null && clientCast.body.ok !== true && election.readStore(paths.election).votes.filter(function (row) { return row.ballotId === voteBallotId; }).length === 1);
  ok('24', '운영 인증과 DB 미접근', bound === true && loadedDb === false && source.indexOf("require('pg'") < 0 && source.indexOf('supabase') < 0 && httpSource.indexOf("require('pg'") < 0 && source.indexOf('단일 프로세스') >= 0 && sole.body.productionAuth === false && sole.body.lock === 'single-process' && noClose.body.tieRule === false);

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
  ];
  const regression = regressionFiles.map(function (file) {
    const result = spawnSync(process.execPath, [file], { cwd: repo, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (result.status !== 0) {
      console.log(file + ' exit ' + result.status);
      console.log(String(result.stdout || '').slice(-1200));
      console.log(String(result.stderr || '').slice(-1200));
    }
    return result.status === 0;
  });
  ok('21', '일반 선거 회귀', regression[0] && regression[1] && regression[2]);
  ok('22', '탄핵 공석 접수 회귀', regression[3] && regression[4] && regression[5] && regression[6]);

  let homeStatus = 0;
  try {
    const home = await request(3010, 'GET', '/', null, {});
    homeStatus = home.status;
  } catch (err) {
    homeStatus = 0;
  }

  console.log(passed + ' passed, ' + failed + ' failed');
  const outDir = 'C:/Users/user/AppData/Local/Cursor/AgentStores/cursor_agent_stores/bc-c953b949-98fb-4f5d-8b49-80c8cb69e605/files/media/by-election-run';
  fs.mkdirSync(outDir, { recursive: true });
  const summary = [
    failed === 0 ? 'PASS' : 'FAIL',
    '직위는 부여하지 않았다. 단독 후보는 uncontested_recorded, officeGranted false, 공석 유지.',
    '시작 HEAD: bbe563945988f13d61847262f2fe6642bf745167',
    'JSON 잠금: 단일 프로세스',
    'productionAuth: false',
    'Postgres: 접근하지 않음',
    '3010 응답: ' + homeStatus,
    scenario.join('\n'),
    '하지 않은 항목: 단독 후보 직위 부여, 계급을 지도자로 변경, 시즌 종료일 기록, 복수 투표 종료 후 승자 임명, 동률 해소.',
    '복수 투표는 48시간 개설까지만 한다. 종료 호출은 APPOINTMENT_NOT_DONE 이고 투표는 열린 채로 둔다.',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary + '\n');
  if (failed) process.exitCode = 1;
})().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
