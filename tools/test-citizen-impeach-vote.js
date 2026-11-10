'use strict';
/**
 * 시민 탄핵투표 48시간. 운영 DB를 열지 않는다.
 * node tools/test-citizen-impeach-vote.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const service = require('../server/citizen-impeach-vote-service');
const httpDev = require('../server/citizen-impeach-vote-dev-http');
const filing = require('../server/leader-filing-service');
const rep = require('../server/rep-impeach-vote-service');
const legal = require('../shared/legal-gate-core');

let pass = 0;
let fail = 0;
const scenario = [];
function ok(id, label, cond) {
  scenario.push((cond ? 'PASS' : 'FAIL') + ' ' + id + ' ' + label);
  if (cond) {
    console.log('PASS: ' + id + ' ' + label);
    pass += 1;
  } else {
    console.log('FAIL: ' + id + ' ' + label);
    fail += 1;
  }
}

const now = 1700000000000;
const hour = service.HOUR_MS;
const windowPeople = now;
const usAdult = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'US',
    age_policy_region: 'US',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.US_AGE_POLICY_VERSION,
  },
};
const krMinor = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'KR',
    age_policy_region: 'KR',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.AGE_POLICY_VERSION,
    usParticipation: 'read-only',
  },
};
const header = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Citizen-Vote': 'preview' };

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

function people(count, country, territory) {
  const rows = [];
  for (let i = 0; i < count; i += 1) rows.push({ id: 'v' + i, country: country, territory: territory, valid: true, lastPostAtMs: windowPeople - 1000 });
  return { source: 'test-fixture', records: rows };
}

function proposal(id, country, territory, leaderId, status) {
  return {
    id: id,
    actorId: 'r1',
    actorName: '한결',
    leaderId: leaderId,
    leaderName: '지도자-' + leaderId,
    country: country,
    territory: territory,
    reason: '저장된 사유 ' + id,
    status: status || 'citizen_impeachment_waiting',
    nextStep: 'citizen_impeachment_waiting',
  };
}

function repBallot(row, status, result) {
  return {
    id: 'representative_impeachment_24h:' + row.country + ':' + row.territory + ':' + row.id,
    voteKind: 'representative_impeachment_24h',
    subjectId: row.id,
    country: row.country,
    territory: row.territory,
    leaderId: row.leaderId,
    leaderName: row.leaderName,
    status: status,
    result: result,
    closedOnce: status === 'closed',
    closedAtMs: now - 1000,
  };
}

(async function () {
  ok('20%-정수', '1001명에서 200명은 부족하고 201명은 20% 이상', service.meetsTurnout(200, 1001) === false && service.meetsTurnout(201, 1001) === true && service.meetsTurnout(199, 1000) === false && service.meetsTurnout(200, 1000) === true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ci-'));
  const citizenPath = path.join(dir, 'citizen.json');
  const filingPath = path.join(dir, 'filing.json');
  const repPath = path.join(dir, 'rep.json');
  const rows = [
    proposal('imp-pass', 'KR', 'pioneer', 'leader-kr'),
    proposal('imp-fail', 'KR', 'pioneer', 'leader-fail'),
    proposal('imp-open', 'KR', 'pioneer', 'leader-open'),
    proposal('imp-halt', 'KR', 'pioneer', 'leader-halt'),
    proposal('imp-error', 'KR', 'pioneer', 'leader-error'),
    proposal('imp-central', 'KR', 'central', 'leader-central'),
    proposal('imp-us', 'US', 'guardian', 'leader-us'),
    proposal('imp-guard', 'KR', 'guardian', 'leader-guard'),
    proposal('imp-mismatch', 'KR', 'pioneer', 'leader-mismatch'),
  ];
  rows[5].status = 'citizen_impeachment_waiting';
  filing.writeStore(filingPath, { candidacies: [], impeachments: rows });
  rep.writeStore(repPath, {
    ballots: [
      repBallot(rows[0], 'closed', 'passed'),
      repBallot(rows[1], 'closed', 'failed'),
      repBallot(rows[2], 'open', null),
      repBallot(rows[3], 'halted', null),
      repBallot(rows[4], 'error', null),
      repBallot(rows[5], 'closed', 'passed'),
      repBallot(rows[6], 'closed', 'passed'),
      repBallot(rows[7], 'closed', 'passed'),
      Object.assign(repBallot(rows[8], 'closed', 'passed'), { leaderId: 'other-leader' }),
    ],
    votes: [],
    blocks: [],
  });

  const port = 3015;
  let server = await httpDev.listen(port, citizenPath, filingPath, repPath);
  ok('bind', '127.0.0.1', server.address().address === '127.0.0.1');

  const noHeader = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-pass', passed: true, population: people(5, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now });
  ok('1', '대표 가결만 개설하고 헤더만으로는 열리지 않음', noHeader.status === 403 && noHeader.body.reason === 'DEV_HEADER_NOT_AUTH');

  const opened = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', {
    proposalId: 'imp-pass',
    passed: false,
    voterIds: ['forged'],
    eligibleCount: 1,
    population: people(1000, 'KR', 'pioneer'),
    clockSource: 'test-fixture',
    nowMs: now,
  }, header);
  const roll = service.readStore(citizenPath).ballots[0];
  ok('1b', '저장된 가결로 48시간 개설, 위조 명부 무시', opened.status === 200 && opened.body.ballot.endsAtMs - opened.body.ballot.startsAtMs === 48 * hour && roll.voterIds.length === 1000 && roll.voterIds.indexOf('forged') < 0 && opened.body.productionAuth === false && opened.body.publicView.countsHidden === true && opened.body.publicView.yes == null);

  const failedOpen = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-fail', passed: true, population: people(5, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now }, header);
  const openOpen = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-open', passed: true, population: people(5, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now }, header);
  const haltOpen = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-halt', population: people(5, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now }, header);
  const errorOpen = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-error', population: people(5, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now }, header);
  const fakeOpen = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'missing', passed: true, population: people(5, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now }, header);
  const mismatch = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-mismatch', passed: true, population: people(5, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now }, header);
  ok('2', '부결 거부', failedOpen.body.reason === 'REP_VOTE_NOT_PASSED');
  ok('3', '진행 중 거부', openOpen.body.reason === 'REP_VOTE_OPEN');
  ok('4', '허위 발의·위조 결과·중단·오류 거부', fakeOpen.body.reason === 'PROPOSAL_NOT_STORED' && mismatch.body.reason === 'PROPOSAL_MISMATCH' && haltOpen.body.reason === 'REP_VOTE_HALTED' && errorOpen.body.reason === 'REP_VOTE_ERROR' && failedOpen.body.ok === false);
  const dup = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-pass', population: people(1000, 'KR', 'pioneer'), clockSource: 'test-fixture', nowMs: now }, header);
  ok('5', '중복 개설 방지', dup.body.reason === 'BALLOT_EXISTS' && service.readStore(citizenPath).ballots.length === 1);

  const central = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-central', population: people(5, 'KR', 'central'), clockSource: 'test-fixture', nowMs: now }, header);
  const usOpen = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-us', population: people(4, 'US', 'guardian'), clockSource: 'test-fixture', nowMs: now }, header);
  const guardOpen = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots', { proposalId: 'imp-guard', population: people(4, 'KR', 'guardian'), clockSource: 'test-fixture', nowMs: now }, header);
  ok('6', 'KR/US 격리', usOpen.body.ballot.country === 'US' && usOpen.body.ballot.id !== opened.body.ballot.id);
  ok('7', 'pioneer/guardian 격리와 central 금지', central.body.reason === 'TERRITORY_NOT_ELIGIBLE' && guardOpen.body.ballot.territory === 'guardian' && guardOpen.body.ballot.voterIds.indexOf('v0') >= 0);

  const ballotId = opened.body.ballot.id;
  const early = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', {
    actor: { id: 'v0', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' },
    choice: 'yes',
    clockSource: 'test-fixture',
    nowMs: now - 1,
  }, header);
  const yes = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', {
    actor: { id: 'v0', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' },
    choice: 'yes',
    clockSource: 'test-fixture',
    nowMs: now + 1000,
  }, header);
  const again = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', {
    actor: { id: 'v0', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' },
    choice: 'no',
    clockSource: 'test-fixture',
    nowMs: now + 1000,
  }, header);
  const pair = await Promise.all([
    request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', { actor: { id: 'v1', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'yes', clockSource: 'test-fixture', nowMs: now + 1000 }, header),
    request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', { actor: { id: 'v1', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'no', clockSource: 'test-fixture', nowMs: now + 1000 }, header),
  ]);
  const abstain = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', { actor: { id: 'v2', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'abstain', clockSource: 'test-fixture', nowMs: now + 1000 }, header);
  const late = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', { actor: { id: 'v3', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'yes', clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const cross = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId) + '/votes', { actor: { id: 'v4', country: 'US', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'yes', clockSource: 'test-fixture', nowMs: now + 1000, eligibility: usAdult }, header);
  ok('8', '미국 미성년 제한', (await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(usOpen.body.ballot.id) + '/votes', { actor: { id: 'v0', country: 'US', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'yes', clockSource: 'test-fixture', nowMs: now + 1000, eligibility: krMinor }, header)).body.reason === 'US_PARTICIPATION_READ_ONLY' && (await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(usOpen.body.ballot.id) + '/votes', { actor: { id: 'v1', country: 'US', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'yes', clockSource: 'test-fixture', nowMs: now + 1000 }, header)).body.reason === 'US_AGE_UNVERIFIED');
  ok('9', '1인 1표와 동시 제출', early.body.reason === 'NOT_STARTED' && yes.body.ok === true && again.body.reason === 'DUPLICATE_VOTE' && pair.filter(function (row) { return row.body.ok; }).length === 1 && pair.some(function (row) { return row.body.reason === 'DUPLICATE_VOTE'; }));
  ok('10', '48시간 시작·종료와 기권 금지', late.body.reason === 'CLOSED' && abstain.body.reason === 'CHOICE_INVALID' && cross.body.reason === 'CROSS_SCOPE' && opened.body.ballot.endsAtMs - now === 48 * hour);

  const hidden = await request(port, 'GET', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(ballotId), null, header);
  ok('공개', '진행 중 찬반 숨김', hidden.body.publicView.countsHidden === true && hidden.body.publicView.yes == null && hidden.body.publicView.no == null && hidden.body.publicView.turnoutDenominator === 'FIXED_VOTER_ROLL_20PCT' && String(hidden.body.publicView.reason).indexOf('저장된 사유') === 0);

  async function openSized(id, country, territory, count) {
    const row = proposal(id, country, territory, 'leader-' + id);
    const box = filing.readStore(filingPath);
    box.impeachments.push(row);
    filing.writeStore(filingPath, box);
    const votes = rep.readStore(repPath);
    votes.ballots.push(repBallot(row, 'closed', 'passed'));
    rep.writeStore(repPath, votes);
    return request(port, 'POST', '/dev/citizen-impeach-vote/ballots', {
      proposalId: id,
      passed: true,
      eligibleCount: 3,
      voterIds: ['nope'],
      population: people(count, country, territory),
      clockSource: 'test-fixture',
      nowMs: now,
    }, header);
  }

  async function castMany(ballot, yesCount, noCount) {
    const store = service.readStore(citizenPath);
    for (let i = 0; i < yesCount; i += 1) {
      const cast = service.castVoteUnlocked(store, { ballotId: ballot.id, actor: { id: 'v' + i, country: ballot.country, territory: ballot.territory, verified: true, authSource: 'test-fixture' }, choice: 'yes', nowMs: now + 10 });
      if (!cast.ok) throw new Error(cast.reason + ' yes ' + i);
    }
    for (let n = 0; n < noCount; n += 1) {
      const cast = service.castVoteUnlocked(store, { ballotId: ballot.id, actor: { id: 'v' + (yesCount + n), country: ballot.country, territory: ballot.territory, verified: true, authSource: 'test-fixture' }, choice: 'no', nowMs: now + 10 });
      if (!cast.ok) throw new Error(cast.reason + ' no ' + n);
    }
    service.writeStore(citizenPath, store);
  }

  const zero = await openSized('imp-zero', 'KR', 'pioneer', 10);
  const zeroClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(zero.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const low = await openSized('imp-199', 'KR', 'pioneer', 1000);
  await castMany(low.body.ballot, 199, 0);
  const lowClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(low.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const passedOpen = await openSized('imp-200', 'KR', 'pioneer', 1000);
  await castMany(passedOpen.body.ballot, 101, 99);
  const passClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(passedOpen.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const tie = await openSized('imp-tie', 'KR', 'pioneer', 1000);
  await castMany(tie.body.ballot, 100, 100);
  const tieClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(tie.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const minority = await openSized('imp-min', 'KR', 'pioneer', 1000);
  await castMany(minority.body.ballot, 99, 101);
  const minorityClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(minority.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const edge = await openSized('imp-1001', 'KR', 'pioneer', 1001);
  await castMany(edge.body.ballot, 200, 0);
  const edgeClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(edge.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const edgePass = await openSized('imp-1001b', 'KR', 'pioneer', 1001);
  await castMany(edgePass.body.ballot, 201, 0);
  const edgePassClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(edgePass.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);

  ok('11', '20% 경계', zeroClose.body.ballot.failReason === 'TURNOUT' && lowClose.body.ballot.failReason === 'TURNOUT' && lowClose.body.ballot.finalCounts.cast === 199 && edgeClose.body.ballot.failReason === 'TURNOUT' && edgePassClose.body.ballot.result === 'passed');
  ok('12', '찬성 과반', passClose.body.ballot.result === 'passed' && passClose.body.ballot.finalCounts.yes === 101 && passClose.body.ballot.finalCounts.no === 99 && passClose.body.publicView.countsHidden === false);
  ok('13', '동률 부결과 반대 과반', tieClose.body.ballot.result === 'failed' && tieClose.body.ballot.failReason === 'TIE' && minorityClose.body.ballot.failReason === 'MINORITY');
  const removal = service.readStore(citizenPath).removals.filter(function (row) { return row.ballotId === passedOpen.body.ballot.id; })[0];
  ok('14', '가결 해임 기록과 후속 절차만 기록', removal && removal.confirmed === true && removal.devOnly === true && removal.officeChanged === false && removal.rankChanged === false && removal.seasonChanged === false && removal.followUpElectionOpened === false && removal.schedule.scheduleMeaning === 'by_election_after_removal' && removal.schedule.vacantDays === 7 && removal.schedule.filingDays === 3 && removal.schedule.electionHours === 48 && removal.schedule.multipleSpanDays === 12 && Object.prototype.hasOwnProperty.call(removal.schedule, 'reviewDays') === false && passClose.body.ballot.officeChanged === false);
  const block = service.readStore(citizenPath).blocks.filter(function (row) { return row.citizenBallotId === tie.body.ballot.id; })[0];
  const repBlock = rep.readStore(repPath).blocks.filter(function (row) { return row.citizenBallotId === tie.body.ballot.id; })[0];
  ok('15', '부결 28일 제한', block && block.blockedUntilMs - block.closedAtMs === 28 * service.DAY_MS && block.leaderId === 'leader-imp-tie' && block.country === 'KR' && block.territory === 'pioneer' && repBlock && repBlock.blockedUntilMs === block.blockedUntilMs);

  const dupClose = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(tie.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour + 5 }, header);
  ok('16a', '중복 마감은 다시 집계하지 않음', dupClose.body.alreadyClosed === true && dupClose.body.recounted === false && service.readStore(citizenPath).blocks.filter(function (row) { return row.citizenBallotId === tie.body.ballot.id; }).length === 1 && rep.readStore(repPath).blocks.filter(function (row) { return row.citizenBallotId === tie.body.ballot.id; }).length === 1);

  const retry = await openSized('imp-retry', 'KR', 'pioneer', 4);
  const failedWrite = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(retry.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour, failCitizenWrite: true }, header);
  const stillOpen = service.readStore(citizenPath).ballots.filter(function (row) { return row.id === retry.body.ballot.id; })[0];
  const recovered = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(retry.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour }, header);
  const partial = await openSized('imp-partial', 'KR', 'pioneer', 4);
  const partialFail = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(partial.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour, failBlockWrite: true }, header);
  const partialRetry = await request(port, 'POST', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(partial.body.ballot.id) + '/close', { clockSource: 'test-fixture', nowMs: now + 48 * hour + 1 }, header);
  ok('16b', '저장 실패 후 재시도', failedWrite.body.reason === 'VOTE_STORE_WRITE_FAILED' && stillOpen.closedOnce !== true && recovered.body.ballot.result === 'failed' && partialFail.body.reason === 'BLOCK_STORE_WRITE_FAILED' && partialFail.body.voteApplied === true && partialRetry.body.alreadyClosed === true && partialRetry.body.recounted === false && rep.readStore(repPath).blocks.filter(function (row) { return row.citizenBallotId === partial.body.ballot.id; }).length === 1);

  const reread = await request(port, 'GET', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(passedOpen.body.ballot.id), null, header);
  ok('저장 재조회', 'GET이 가결 집계를 돌려줌', reread.body.publicView.result === 'passed' && reread.body.publicView.yes === 101 && reread.body.publicView.proposalId === 'imp-200' && reread.body.publicView.repBallotId.indexOf('imp-200') >= 0);

  await closeServer(server);
  server = await httpDev.listen(port, citizenPath, filingPath, repPath);
  const restored = await request(port, 'GET', '/dev/citizen-impeach-vote/ballots/' + encodeURIComponent(passedOpen.body.ballot.id), null, header);
  ok('17', '재시작 후 유지', restored.body.publicView.result === 'passed' && restored.body.publicView.yes === 101 && restored.body.publicView.officeChanged === false);

  await closeServer(server);
  server = null;
  const repTest = spawnSync(process.execPath, ['tools/test-rep-impeach-vote.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const electionTest = spawnSync(process.execPath, ['tools/test-leader-election-vote.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const roundTest = spawnSync(process.execPath, ['tools/test-leader-election-rounds.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  ok('18', '4차 A·4차 B 회귀', repTest.status === 0 && electionTest.status === 0 && roundTest.status === 0);

  console.log(pass + ' passed, ' + fail + ' failed');
  const outDir = 'C:\\Users\\user\\AppData\\Local\\Cursor\\AgentStores\\cursor_agent_stores\\bc-c953b949-98fb-4f5d-8b49-80c8cb69e605\\files\\media\\citizen-impeach-vote';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'scenarios.txt'), scenario.join('\n'));
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
