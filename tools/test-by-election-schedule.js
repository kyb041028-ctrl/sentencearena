'use strict';
/**
 * 보궐 일정 정합. 선거를 열지 않는다.
 * node tools/test-by-election-schedule.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const vacancy = require('../server/impeachment-vacancy-service');
const vacancyHttp = require('../server/impeachment-vacancy-dev-http');
const citizen = require('../server/citizen-impeach-vote-service');
const filing = require('../server/leader-filing-service');

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
const hour = vacancy.HOUR_MS;
const header = { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Vacancy': 'preview' };

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

function ballot(id, country, territory, leaderId) {
  const start = removedAt - 48 * hour;
  return {
    id: id,
    proposalId: 'imp-' + id,
    country: country,
    territory: territory,
    leaderId: leaderId,
    leaderName: leaderId,
    status: 'closed',
    result: 'passed',
    closedOnce: true,
    startsAtMs: start,
    endsAtMs: start + 48 * hour,
    closedAtMs: start + 48 * hour,
  };
}

function office(country, territory, leaderId) {
  return { country: country, territory: territory, leaderId: leaderId, leaderName: leaderId, status: 'sitting', rank: 'representative', season: 'season-kept' };
}

function citizenCase(eligible, yesCount, noCount) {
  const ids = [];
  const votes = [];
  for (let i = 0; i < eligible; i += 1) ids.push('p' + i);
  for (let y = 0; y < yesCount; y += 1) votes.push({ ballotId: 'case', choice: 'yes' });
  for (let n = 0; n < noCount; n += 1) votes.push({ ballotId: 'case', choice: 'no' });
  const start = removedAt - citizen.DURATION_MS;
  return citizen.closeUnlocked({
    ballots: [{
      id: 'case',
      status: 'open',
      closedOnce: false,
      voterIds: ids,
      startsAtMs: start,
      endsAtMs: start + citizen.DURATION_MS,
    }],
    votes: votes,
    blocks: [],
    removals: [],
  }, { ballotId: 'case', nowMs: start + citizen.DURATION_MS });
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-bye-'));
  const officePath = path.join(dir, 'offices.json');
  const citizenPath = path.join(dir, 'citizen.json');
  const krId = 'citizen_impeachment_48h:KR:pioneer:align';
  fs.writeFileSync(citizenPath, JSON.stringify({
    ballots: [
      ballot(krId, 'KR', 'pioneer', 'leader-kr'),
      ballot('citizen-us', 'US', 'guardian', 'leader-us'),
      ballot('citizen-guard', 'KR', 'guardian', 'leader-guard'),
      ballot('citizen-central', 'KR', 'central', 'leader-central'),
      ballot('citizen-dup', 'US', 'pioneer', 'leader-dup'),
    ],
    votes: [],
    blocks: [],
    removals: [],
  }));
  vacancy.writeStore(officePath, {
    offices: [
      office('KR', 'pioneer', 'leader-kr'),
      office('KR', 'guardian', 'leader-guard'),
      office('US', 'guardian', 'leader-us'),
      office('US', 'pioneer', 'leader-dup'),
      office('KR', 'central', 'leader-central'),
    ],
    removals: [],
    schedules: [{ citizenBallotId: 'citizen-dup', country: 'US', territory: 'pioneer', scheduleMeaning: 'older-record' }],
  });

  const port = 3017;
  const server = await vacancyHttp.listen(port, officePath, citizenPath);
  const removed = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: krId, passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: removedAt }, header);
  const schedule = removed.body.schedule;
  ok('1', '해임 직후 공석', removed.body.ok === true && removed.body.office.status === 'vacant' && schedule.vacancyStartMs === removedAt && schedule.removedAtMs === removedAt && vacancy.phaseAt(schedule, removedAt) === 'vacant' && removed.body.electionOpened === false);
  ok('2', '7일 직전 공석', vacancy.phaseAt(schedule, schedule.vacancyEndMs - 1) === 'vacant');
  ok('3', '정확히 7일에 접수 예정', schedule.filingStartMs === removedAt + 7 * day && schedule.filingStartMs === schedule.vacancyEndMs && vacancy.phaseAt(schedule, schedule.filingStartMs) === 'filing');
  ok('4', '정확히 10일에 접수 종료와 선거 분기 예정', schedule.filingEndMs === removedAt + 10 * day && vacancy.phaseAt(schedule, schedule.filingEndMs) === 'branch_scheduled' && schedule.electionOpened === false && schedule.schedulerRan === false);
  ok('5', '복수 후보 12일', schedule.paths.multiple.voteStartMs === schedule.filingEndMs && schedule.paths.multiple.voteEndMs - removedAt === 12 * day && schedule.spanMs === 12 * day && schedule.paths.multiple.electionOpened === false);
  ok('6', '보궐에 검증 2일 없음', Object.prototype.hasOwnProperty.call(schedule, 'reviewDays') === false && schedule.scheduleMeaning === 'by_election_after_removal' && Object.prototype.hasOwnProperty.call(filing.POST_IMPEACHMENT_SCHEDULE, 'reviewDays') === false);
  ok('7', '0명·1명·복수 경로', schedule.paths.zero.status === 'weekly_refiling_waiting' && schedule.paths.zero.completesWithinSpan === false && schedule.zeroCompletesWithinSpan === false && schedule.paths.sole.status === 'uncontested_recorded' && schedule.paths.sole.officeGranted === false && schedule.paths.sole.votesOpened === false && schedule.paths.sole.afterFilingEnd === true && schedule.paths.multiple.status === 'open' && schedule.paths.multiple.voteEndMs - schedule.paths.multiple.voteStartMs === 48 * hour && schedule.paths.multiple.officeGranted === false);

  const tie = citizenCase(1000, 100, 100);
  const minority = citizenCase(1000, 99, 101);
  const majority = citizenCase(1000, 101, 99);
  const low = citizenCase(1000, 199, 0);
  const edgeLow = citizenCase(1001, 200, 0);
  const edgePass = citizenCase(1001, 201, 0);
  ok('8', '시민 48시간과 가결 조건 유지', citizen.DURATION_MS === 48 * hour && citizen.meetsTurnout(199, 1000) === false && citizen.meetsTurnout(200, 1000) === true && low.ballot.failReason === 'TURNOUT' && majority.ballot.result === 'passed' && majority.ballot.finalCounts.yes === 101 && tie.ballot.failReason === 'TIE' && minority.ballot.failReason === 'MINORITY' && edgeLow.ballot.failReason === 'TURNOUT' && edgePass.ballot.result === 'passed');

  const reviewStore = filing.emptyStore();
  filing.fileCandidacy(reviewStore, { actor: { id: 'rep-a', name: '한결', devAuth: true, country: 'KR', territory: 'pioneer', office: 'representative' }, country: 'KR', territory: 'pioneer', window: { provided: true, open: true }, nowMs: removedAt, intentConfirmed: true });
  const reviewed = filing.advanceCandidacy(reviewStore, { actor: { id: 'clerk', devAuth: true, office: 'dev-clerk' }, candidacyId: reviewStore.candidacies[0].id, action: 'start_review' });
  ok('9', '별도 검토기간이 있으면 의미와 테스트 유지', reviewed.ok === true && reviewed.candidacy.status === 'in_review' && reviewed.candidacy.review === 'in_review' && reviewed.candidacy.reviewDays == null && filing.POST_IMPEACHMENT_SCHEDULE.scheduleMeaning === 'by_election_after_removal');

  const us = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-us', clockSource: 'test-fixture', nowMs: removedAt + 1000 }, header);
  const central = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-central', passed: true, clockSource: 'test-fixture', nowMs: removedAt }, header);
  const krView = await request(port, 'GET', '/dev/impeachment-vacancy/offices/KR/pioneer', null, header);
  ok('10', 'KR/US와 영토 격리', us.body.office.country === 'US' && us.body.office.territory === 'guardian' && us.body.schedule.vacancyStartMs === removedAt + 1000 && krView.body.office.vacancyStartMs === removedAt && central.body.reason === 'TERRITORY_NOT_ELIGIBLE' && vacancy.readStore(officePath).offices.filter(function (row) { return row.territory === 'central'; })[0].status === 'sitting');

  const seeded = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-dup', passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: removedAt }, header);
  const pair = await Promise.all([
    request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-guard', clockSource: 'test-fixture', nowMs: removedAt }, header),
    request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-guard', clockSource: 'test-fixture', nowMs: removedAt }, header),
  ]);
  const again = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: krId, clockSource: 'test-fixture', nowMs: removedAt + 5 }, header);
  const guardCount = vacancy.readStore(officePath).schedules.filter(function (row) { return row.citizenBallotId === 'citizen-guard'; }).length;
  ok('11', '중복·동시 처리 방지', seeded.body.reason === 'SCHEDULE_EXISTS' && vacancy.readStore(officePath).offices.filter(function (row) { return row.country === 'US' && row.territory === 'pioneer'; })[0].status === 'sitting' && pair.filter(function (row) { return row.body.ok; }).length === 1 && pair.some(function (row) { return row.body.reason === 'REMOVAL_EXISTS'; }) && guardCount === 1 && again.body.reason === 'REMOVAL_EXISTS');

  await closeServer(server);
  const root = path.join(__dirname, '..');
  const runs = [
    ['tools/test-citizen-impeach-vote.js'],
    ['tools/test-impeachment-vacancy.js'],
    ['tools/test-leader-filing.js'],
    ['tools/test-rep-impeach-vote.js'],
    ['tools/test-leader-election-vote.js'],
    ['tools/test-leader-election-rounds.js'],
  ].map(function (args) {
    return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  });
  ok('12', '기존 선거·탄핵 회귀', runs.every(function (row) { return row.status === 0; }));

  console.log(passed + ' passed, ' + failed + ' failed');
  const outDir = 'C:/Users/user/AppData/Local/Cursor/AgentStores/cursor_agent_stores/bc-c953b949-98fb-4f5d-8b49-80c8cb69e605/files/media/by-election-policy';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.txt'), [
    failed ? 'FAIL' : 'PASS',
    scenario.join('\n'),
    'reviewDays 2는 시민 투표 전 검토가 아니다. 해임 뒤 접수 다음의 검증 대기였다.',
    '그 대기는 보궐 일정에서 뺐다. 일반 후보 start_review 상태와 그 테스트는 유지한다.',
    '기준 시각은 해임 확정 시각이다. 공석 종료와 접수 시작은 7일, 접수 종료는 10일, 복수 투표 종료는 12일이다.',
    '0명은 weekly_refiling_waiting 이고 12일 완료를 보장하지 않는다. 1명은 uncontested_recorded, officeGranted false. 2명 이상은 48시간 대상이며 선거는 열지 않는다.',
    '화면의 권한 안내와 election-preview 문장은 수정하지 않았다.',
    '4차 E는 시작하지 않았다.',
  ].join('\n'));
  process.exit(failed ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
