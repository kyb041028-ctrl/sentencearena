'use strict';
/**
 * 지도자 선거 회차. 운영 DB를 열지 않는다.
 * node tools/test-leader-election-rounds.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const electionHttp = require('../server/leader-election-dev-http');
const filingHttp = require('../server/leader-filing-dev-http');
const election = require('../server/leader-election-service');
const vote = require('../shared/vote-engine-core');
const legal = require('../shared/legal-gate-core');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) {
    console.log('PASS: ' + label);
    pass += 1;
  } else {
    console.log('FAIL: ' + label);
    fail += 1;
  }
}

const now = 1700000000000;
const hour = vote.HOUR_MS;
const windowOpen = { provided: true, open: true };
const windowClose = { provided: true, open: true, closing: true };
const clerk = { id: 'clerk', office: 'dev-clerk', verified: true, authSource: 'test-fixture' };
const usAdult = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'US',
    age_policy_region: 'US',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.US_AGE_POLICY_VERSION,
  },
};
const filingHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Filing': 'preview' };
const electionHeader = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Election': 'preview' };

function rep(country, territory, id, name) {
  return { id: id, name: name || id, country: country, territory: territory, office: 'representative', devAuth: true };
}

function people(count, country, territory) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ id: 'v' + i, country: country, territory: territory, valid: true, lastPostAtMs: now - 1000 });
  }
  return { source: 'test-fixture', records: rows };
}

function request(port, method, urlPath, body, headers) {
  return new Promise(function (resolve, reject) {
    const req = http.request({ hostname: '127.0.0.1', port: port, method: method, path: urlPath, headers: headers || {} }, function (res) {
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

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-el-rounds-'));
  const electionPath = path.join(dir, 'election.json');
  const filingPath = path.join(dir, 'filing.json');
  const filingPort = 3023;
  const electionPort = 3024;
  let filingServer = await filingHttp.listen(filingPort, filingPath);
  let electionServer = await electionHttp.listen(electionPort, electionPath, filingPath);
  ok('개발 HTTP는 127.0.0.1', filingServer.address().address === '127.0.0.1' && electionServer.address().address === '127.0.0.1');

  async function fileOne(country, territory, id, name, eligibility) {
    const saved = await request(filingPort, 'POST', '/dev/leader-filing/candidacies', {
      actor: rep(country, territory, id, name),
      country: country,
      territory: territory,
      window: windowOpen,
      nowMs: now,
      intentConfirmed: true,
      eligibility: eligibility,
    }, filingHeader);
    return saved;
  }

  async function openRound(country, territory, window) {
    return request(electionPort, 'POST', '/dev/leader-election/rounds', {
      actor: clerk,
      country: country,
      territory: territory,
      window: window || windowOpen,
    }, electionHeader);
  }

  async function link(roundId, candidacyId) {
    return request(electionPort, 'POST', '/dev/leader-election/rounds/' + encodeURIComponent(roundId) + '/applications', {
      actor: clerk,
      candidacyId: candidacyId,
      window: windowOpen,
    }, electionHeader);
  }

  async function review(roundId, candidacyId, action) {
    return request(electionPort, 'POST', '/dev/leader-election/reviews', {
      actor: clerk,
      candidacyId: candidacyId,
      filingRoundId: roundId,
      action: action,
      window: windowOpen,
    }, electionHeader);
  }

  async function closeRound(roundId, country, territory, window) {
    return request(electionPort, 'POST', '/dev/leader-election/rounds/' + encodeURIComponent(roundId) + '/close', {
      actor: clerk,
      country: country,
      territory: territory,
      window: window,
    }, electionHeader);
  }

  async function openVote(roundId, country, territory) {
    return request(electionPort, 'POST', '/dev/leader-election/elections', {
      country: country,
      territory: territory,
      filingRoundId: roundId,
      window: windowOpen,
      clockSource: 'test-fixture',
      nowMs: now,
      population: people(1000, country, territory),
    }, electionHeader);
  }

  const denied = await request(electionPort, 'POST', '/dev/leader-election/rounds', { actor: clerk, country: 'KR', territory: 'pioneer', window: windowOpen });
  ok('마감 경로도 개발 헤더가 없으면 거부', denied.status === 403 && denied.body.reason === 'DEV_HEADER_NOT_AUTH');

  const round1 = await openRound('KR', 'pioneer');
  const round1Id = round1.body.round && round1.body.round.id;
  const han = await fileOne('KR', 'pioneer', 'r1', '한결');
  const gaon = await fileOne('KR', 'pioneer', 'r2', '가온');
  const link1 = await link(round1Id, han.body.candidacy.id);
  const link2 = await link(round1Id, gaon.body.candidacy.id);
  const start1 = await review(round1Id, han.body.candidacy.id, 'start_review');
  const approve1 = await review(round1Id, han.body.candidacy.id, 'approve');
  const start2 = await review(round1Id, gaon.body.candidacy.id, 'start_review');
  const approve2 = await review(round1Id, gaon.body.candidacy.id, 'approve');
  const closed1 = await closeRound(round1Id, 'KR', 'pioneer', windowClose);
  const opened1 = await openVote(round1Id, 'KR', 'pioneer');
  const ballotId = opened1.body.ballot && opened1.body.ballot.id;
  const cast = await request(electionPort, 'POST', '/dev/leader-election/ballots/' + encodeURIComponent(ballotId) + '/votes', {
    actor: { id: 'v0', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' },
    choice: 'r1',
    clockSource: 'test-fixture',
    nowMs: now + 1000,
  }, electionHeader);
  const ended = await request(electionPort, 'POST', '/dev/leader-election/ballots/' + encodeURIComponent(ballotId) + '/close', {
    clockSource: 'test-fixture',
    nowMs: now + 48 * hour,
  }, electionHeader);
  const view1 = await request(electionPort, 'GET', '/dev/leader-election/elections/' + encodeURIComponent(opened1.body.election.id), null, electionHeader);
  ok('1회차 후보 2명 투표 후 종료', round1.body.round.sequence === 1 && link1.body.stored === true && link2.body.stored === true && start1.body.review.status === 'in_review' && approve1.body.review.status === 'approved' && start2.body.ok === true && approve2.body.review.filingRoundId === round1Id && closed1.body.round.status === 'registration_closed' && opened1.body.election.votesOpened === true && opened1.body.ballot.endsAtMs - opened1.body.ballot.startsAtMs === 48 * hour && cast.body.ok === true && ended.body.ballot.officeGranted === false && view1.body.publicView.status === 'closed' && view1.body.publicView.officeGranted === false && view1.body.publicView.filingRoundId === round1Id);

  const round2 = await openRound('KR', 'pioneer');
  const round2Id = round2.body.round.id;
  const missingWindow = await closeRound(round2Id, 'KR', 'pioneer');
  const stillFiling = election.readStore(electionPath).rounds.filter(function (row) { return row.id === round2Id; })[0];
  const closed2 = await closeRound(round2Id, 'KR', 'pioneer', windowClose);
  const disk = election.readStore(electionPath);
  const again = await request(electionPort, 'GET', '/dev/leader-election/rounds/' + encodeURIComponent(round2Id), null, electionHeader);
  const opened2 = await openVote(round2Id, 'KR', 'pioneer');
  const dupClose = await closeRound(round2Id, 'KR', 'pioneer', windowClose);
  const dupOpen = await openVote(round2Id, 'KR', 'pioneer');
  const lateFile = await fileOne('KR', 'pioneer', 'r6', '늦은');
  const lateLink = await link(round2Id, lateFile.body.candidacy.id);
  const lateReview = await review(round2Id, lateFile.body.candidacy.id, 'start_review');
  ok('2회차 0건 마감 저장 재조회 재접수 대기', missingWindow.body.reason === 'FILING_WINDOW_UNCONFIRMED' && stillFiling.status === 'filing' && disk.rounds.filter(function (row) { return row.id === round2Id; })[0].status === 'registration_closed' && disk.roundApplications.filter(function (row) { return row.filingRoundId === round2Id; }).length === 0 && again.body.round.status === 'registration_closed' && again.body.applications.length === 0 && opened2.body.election.status === 'weekly_refiling_waiting' && opened2.body.election.officeGranted === false && opened2.body.election.candidateIds.length === 0 && opened2.body.election.candidateIds.indexOf('r1') < 0 && opened2.body.election.candidateIds.indexOf('r2') < 0);
  ok('같은 회차 중복 마감·중복 개설 거부', dupClose.body.reason === 'REGISTRATION_ALREADY_CLOSED' && dupClose.body.stored === false && dupOpen.body.reason === 'ELECTION_ALREADY_OPEN' && dupOpen.body.ok === false);
  ok('마감 뒤 추가 신청과 심사 변경 거부', lateLink.body.reason === 'REGISTRATION_CLOSED' && lateReview.body.reason === 'REGISTRATION_CLOSED');

  const round1Kept = await request(electionPort, 'GET', '/dev/leader-election/rounds/' + encodeURIComponent(round1Id), null, electionHeader);
  ok('2회차에 1회차 후보가 없고 1회차 기록은 남음', round1Kept.body.applications.map(function (row) { return row.actorId; }).sort().join(',') === 'r1,r2' && round1Kept.body.election.status === 'closed' && round1Kept.body.election.filingRoundId === round1Id && opened2.body.election.filingRoundId === round2Id);

  const round3 = await openRound('KR', 'pioneer');
  const round3Id = round3.body.round.id;
  const solo = await fileOne('KR', 'pioneer', 'r3', '하람');
  const soloLink = await link(round3Id, solo.body.candidacy.id);
  const oldLink = await link(round3Id, han.body.candidacy.id);
  await review(round3Id, solo.body.candidacy.id, 'start_review');
  await review(round3Id, solo.body.candidacy.id, 'approve');
  await closeRound(round3Id, 'KR', 'pioneer', windowClose);
  const opened3 = await openVote(round3Id, 'KR', 'pioneer');
  ok('3회차 후보 1명 무투표와 직위 미부여', soloLink.body.stored === true && oldLink.body.reason === 'CANDIDACY_ROUND_LOCKED' && opened3.body.election.status === 'uncontested_recorded' && opened3.body.election.officeGranted === false && opened3.body.election.votesOpened === false && opened3.body.election.candidateIds.join(',') === 'r3' && opened3.body.election.winnerId === 'r3');

  const round4 = await openRound('KR', 'pioneer');
  const round4Id = round4.body.round.id;
  const fourA = await fileOne('KR', 'pioneer', 'r4', '나은');
  const fourB = await fileOne('KR', 'pioneer', 'r5', '도윤');
  await link(round4Id, fourA.body.candidacy.id);
  await link(round4Id, fourB.body.candidacy.id);
  await review(round4Id, fourA.body.candidacy.id, 'start_review');
  await review(round4Id, fourA.body.candidacy.id, 'approve');
  await review(round4Id, fourB.body.candidacy.id, 'start_review');
  await review(round4Id, fourB.body.candidacy.id, 'approve');
  await closeRound(round4Id, 'KR', 'pioneer', windowClose);
  const opened4 = await openVote(round4Id, 'KR', 'pioneer');
  ok('4회차 후보 2명 48시간 투표', opened4.body.election.votesOpened === true && opened4.body.election.officeGranted === false && opened4.body.ballot.endsAtMs - opened4.body.ballot.startsAtMs === 48 * hour && opened4.body.election.candidateIds.slice().sort().join(',') === 'r4,r5' && opened4.body.ballot.id.indexOf(round4Id) >= 0);

  const usRound = await openRound('US', 'guardian');
  const usId = usRound.body.round.id;
  const usA = await fileOne('US', 'guardian', 'u1', 'Avery', usAdult);
  const usB = await fileOne('US', 'guardian', 'u2', 'Morgan', usAdult);
  const usCross = await link(usId, han.body.candidacy.id);
  await link(usId, usA.body.candidacy.id);
  await link(usId, usB.body.candidacy.id);
  await review(usId, usA.body.candidacy.id, 'start_review');
  await review(usId, usA.body.candidacy.id, 'approve');
  await review(usId, usB.body.candidacy.id, 'start_review');
  await review(usId, usB.body.candidacy.id, 'approve');
  await closeRound(usId, 'US', 'guardian', windowClose);
  const usOpen = await openVote(usId, 'US', 'guardian');
  const krGuardian = await openRound('KR', 'guardian');
  const bare = await fileOne('KR', 'guardian', 'r8', '무회차');
  const bareReview = await request(electionPort, 'POST', '/dev/leader-election/reviews', {
    actor: clerk,
    candidacyId: bare.body.candidacy.id,
    action: 'start_review',
    window: windowOpen,
  }, electionHeader);
  await request(electionPort, 'POST', '/dev/leader-election/reviews', {
    actor: clerk,
    candidacyId: bare.body.candidacy.id,
    action: 'approve',
    window: windowOpen,
  }, electionHeader);
  await request(electionPort, 'POST', '/dev/leader-election/reviews', {
    actor: clerk,
    candidacyId: bare.body.candidacy.id,
    action: 'close_registration',
    window: windowClose,
  }, electionHeader);
  await closeRound(krGuardian.body.round.id, 'KR', 'guardian', windowClose);
  const guardianOpen = await openVote(krGuardian.body.round.id, 'KR', 'guardian');
  ok('KR/US와 pioneer/guardian 분리', usRound.body.round.id !== round1Id && usCross.body.reason === 'CROSS_SCOPE' && usOpen.body.election.country === 'US' && usOpen.body.election.territory === 'guardian' && usOpen.body.election.candidateIds.slice().sort().join(',') === 'u1,u2' && usOpen.body.ballot.endsAtMs - usOpen.body.ballot.startsAtMs === 48 * hour && bareReview.body.review.filingRoundId == null && guardianOpen.body.election.candidateIds.indexOf('r8') < 0 && guardianOpen.body.election.candidateIds.indexOf('r1') < 0 && guardianOpen.body.election.status === 'weekly_refiling_waiting');

  const beforeRestart = election.readStore(electionPath);
  await closeServer(electionServer);
  electionServer = null;
  electionServer = await electionHttp.listen(electionPort, electionPath, filingPath);
  const restored = await request(electionPort, 'GET', '/dev/leader-election/rounds/' + encodeURIComponent(round1Id), null, electionHeader);
  const restored2 = await request(electionPort, 'GET', '/dev/leader-election/rounds/' + encodeURIComponent(round2Id), null, electionHeader);
  const restored4 = await request(electionPort, 'GET', '/dev/leader-election/elections/' + encodeURIComponent(opened4.body.election.id), null, electionHeader);
  ok('서버 재시작 후 회차 복원', beforeRestart.rounds.length >= 4 && restored.body.election.status === 'closed' && restored.body.applications.length === 2 && restored2.body.election.status === 'weekly_refiling_waiting' && restored4.body.publicView.filingRoundId === round4Id && restored4.body.publicView.officeGranted === false);

  await closeServer(electionServer);
  await closeServer(filingServer);
  electionServer = null;
  filingServer = null;
  console.log(pass + ' passed, ' + fail + ' failed');
  const summary = [
    'leader election rounds: ' + (fail ? 'FAIL' : 'PASS'),
    'passed: ' + pass,
    'failed: ' + fail,
    'election port: 127.0.0.1:' + electionPort,
    'filing port: 127.0.0.1:' + filingPort,
    'round1: ' + round1Id + ' closed officeGranted false',
    'round2: ' + round2Id + ' weekly_refiling_waiting candidates 0',
    'round3: ' + round3Id + ' uncontested_recorded officeGranted false',
    'round4: ' + round4Id + ' 48h candidates r4,r5',
    'us guardian: ' + usId + ' candidates u1,u2',
    'kr guardian empty round did not take unscoped r8',
    'postgres: not verified',
    'production office: not granted',
    'servers closed',
  ].join('\n');
  const outDir = 'C:\\Users\\user\\AppData\\Local\\Cursor\\AgentStores\\cursor_agent_stores\\bc-c953b949-98fb-4f5d-8b49-80c8cb69e605\\files\\media\\leader-election-rounds';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary);
  process.exit(fail ? 1 : 0);
})().catch(async function (err) {
  console.error(err);
  process.exit(1);
});
