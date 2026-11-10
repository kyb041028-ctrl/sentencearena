'use strict';
/**
 * 탄핵 가결 뒤 개발용 공석 기록. 운영 DB를 열지 않는다.
 * node tools/test-impeachment-vacancy.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const service = require('../server/impeachment-vacancy-service');
const httpDev = require('../server/impeachment-vacancy-dev-http');

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
const hour = service.HOUR_MS;
const day = service.DAY_MS;
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

function ballot(id, country, territory, leaderId, status, result) {
  const start = now - 48 * hour;
  const row = {
    id: id,
    voteKind: 'citizen_impeachment_48h',
    proposalId: 'imp-' + id,
    country: country,
    territory: territory,
    leaderId: leaderId,
    leaderName: '지도자-' + leaderId,
    status: status,
    result: result,
    closedOnce: status === 'closed',
    startsAtMs: start,
    endsAtMs: start + 48 * hour,
    closedAtMs: status === 'closed' ? start + 48 * hour : null,
    officeChanged: false,
    rankChanged: false,
    seasonChanged: false,
  };
  return row;
}

function office(country, territory, leaderId, extra) {
  return Object.assign({
    country: country,
    territory: territory,
    leaderId: leaderId,
    leaderName: '지도자-' + leaderId,
    status: 'sitting',
    rank: 'representative',
    season: 'season-kept',
    note: '기존-' + country + '-' + territory,
  }, extra || {});
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-vacancy-'));
  const officePath = path.join(dir, 'offices.json');
  const citizenPath = path.join(dir, 'citizen.json');
  const passedId = 'citizen_impeachment_48h:KR:pioneer:imp-pass';
  const rows = [
    ballot(passedId, 'KR', 'pioneer', 'leader-kr', 'closed', 'passed'),
    ballot('citizen-fail', 'KR', 'pioneer', 'leader-fail', 'closed', 'failed'),
    ballot('citizen-open', 'KR', 'pioneer', 'leader-open', 'open', null),
    ballot('citizen-central', 'KR', 'central', 'leader-central', 'closed', 'passed'),
    ballot('citizen-us', 'US', 'guardian', 'leader-us', 'closed', 'passed'),
    ballot('citizen-guard', 'KR', 'guardian', 'leader-guard', 'closed', 'passed'),
    ballot('citizen-wrong', 'US', 'pioneer', 'not-the-leader', 'closed', 'passed'),
    ballot('citizen-retry', 'US', 'pioneer', 'leader-retry', 'closed', 'passed'),
  ];
  rows[2].closedOnce = false;
  rows[2].endsAtMs = now + hour;
  fs.writeFileSync(citizenPath, JSON.stringify({ ballots: rows, votes: [], blocks: [], removals: [] }));
  service.writeStore(officePath, {
    offices: [
      office('KR', 'pioneer', 'leader-kr'),
      office('KR', 'guardian', 'leader-guard'),
      office('US', 'guardian', 'leader-us'),
      office('US', 'pioneer', 'leader-retry'),
      office('KR', 'central', 'leader-central'),
    ],
    removals: [],
    schedules: [],
    ranks: [{ country: 'KR', territory: 'pioneer', citizen: 10, debater: 4, elder: 2, representative: 8 }],
  });

  const port = 3016;
  let server = await httpDev.listen(port, officePath, citizenPath);
  ok('bind', '127.0.0.1', server.address().address === '127.0.0.1');

  const noHeader = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: passedId, passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: now });
  const removed = await request(port, 'POST', '/dev/impeachment-vacancy/removals', {
    ballotId: passedId,
    passed: false,
    confirmed: false,
    clockSource: 'test-fixture',
    nowMs: now,
  }, header);
  const again = await request(port, 'GET', '/dev/impeachment-vacancy/offices/KR/pioneer', null, header);
  ok('1', '가결 해임', noHeader.status === 403 && removed.status === 200 && removed.body.office.status === 'vacant' && removed.body.removal.leaderId === 'leader-kr' && removed.body.productionAuth === false && removed.body.electionOpened === false && again.body.office.status === 'vacant' && again.body.office.removedLeaderId === 'leader-kr');
  ok('2', '부결 거부', (await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-fail', passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: now }, header)).body.reason === 'CITIZEN_VOTE_NOT_PASSED');
  ok('3', '진행 중 거부', (await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-open', passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: now }, header)).body.reason === 'CITIZEN_VOTE_OPEN');
  ok('4', '허위 가결 거부', (await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'missing', passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: now }, header)).body.reason === 'CITIZEN_VOTE_NOT_STORED');
  ok('5', '현직 불일치 거부', (await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-wrong', passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: now }, header)).body.reason === 'INCUMBENT_MISMATCH' && service.readStore(officePath).offices.filter(function (row) { return row.country === 'US' && row.territory === 'pioneer'; })[0].status === 'sitting');
  const duplicate = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: passedId, passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: now + 5 }, header);
  ok('6', '중복 해임 차단', duplicate.body.reason === 'REMOVAL_EXISTS' && service.readStore(officePath).removals.filter(function (row) { return row.citizenBallotId === passedId; }).length === 1);

  const pair = await Promise.all([
    request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-guard', passed: true, clockSource: 'test-fixture', nowMs: now }, header),
    request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-guard', confirmed: true, clockSource: 'test-fixture', nowMs: now }, header),
  ]);
  const guardRows = service.readStore(officePath).removals.filter(function (row) { return row.citizenBallotId === 'citizen-guard'; });
  ok('7', '동시 요청 중복 차단', pair.filter(function (row) { return row.body.ok; }).length === 1 && pair.some(function (row) { return row.body.reason === 'REMOVAL_EXISTS'; }) && guardRows.length === 1);

  const us = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-us', clockSource: 'test-fixture', nowMs: now }, header);
  const usView = await request(port, 'GET', '/dev/impeachment-vacancy/offices/US/guardian', null, header);
  const krStill = await request(port, 'GET', '/dev/impeachment-vacancy/offices/KR/pioneer', null, header);
  ok('8', 'KR/US', us.body.office.country === 'US' && usView.body.office.status === 'vacant' && krStill.body.office.country === 'KR' && krStill.body.office.removedLeaderId === 'leader-kr');
  ok('9', 'pioneer/guardian', guardRows[0].territory === 'guardian' && krStill.body.office.territory === 'pioneer' && service.readStore(officePath).offices.filter(function (row) { return row.country === 'KR' && row.territory === 'guardian'; })[0].status === 'vacant');
  ok('10', 'central 거부', (await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-central', passed: true, confirmed: true, clockSource: 'test-fixture', nowMs: now }, header)).body.reason === 'TERRITORY_NOT_ELIGIBLE' && service.readStore(officePath).offices.filter(function (row) { return row.territory === 'central'; })[0].status === 'sitting');

  const schedule = removed.body.schedule;
  ok('11', '공석 시작 시각', schedule.vacancyStartMs === now && removed.body.removal.removedAtMs === now && removed.body.removal.vacancyStartMs === now);
  ok('12', '공석 7일 경계', schedule.vacancyEndMs - schedule.vacancyStartMs === 7 * day && service.phaseAt(schedule, schedule.vacancyStartMs) === 'vacant' && service.phaseAt(schedule, schedule.vacancyEndMs - 1) === 'vacant' && service.phaseAt(schedule, schedule.vacancyEndMs) === 'filing');
  ok('13', '접수 3일', schedule.filingStartMs === schedule.vacancyEndMs && schedule.filingEndMs - schedule.filingStartMs === 3 * day && service.phaseAt(schedule, schedule.filingEndMs - 1) === 'filing');
  ok('14', '검증 2일 없음', Object.prototype.hasOwnProperty.call(schedule, 'reviewDays') === false && schedule.voteDurationMs === 48 * hour && schedule.spanMs === 12 * day && schedule.schedulerRan === false && schedule.electionOpened === false && service.phaseAt(schedule, schedule.filingEndMs) === 'vote_scheduled');

  const one = await request(port, 'POST', '/dev/impeachment-vacancy/shared-election-path', { candidateCount: 1, electionUse: 'by_election' }, header);
  const none = await request(port, 'POST', '/dev/impeachment-vacancy/shared-election-path', { candidateCount: 0, electionUse: 'by_election' }, header);
  const generalOne = await request(port, 'POST', '/dev/impeachment-vacancy/shared-election-path', { candidateCount: 1, electionUse: 'general' }, header);
  ok('15', '단독 후보 규칙 호환', one.body.status === 'uncontested_recorded' && one.body.officeGranted === false && one.body.votesOpened === false && one.body.electionOpened === false && one.body.status === generalOne.body.status && none.body.status === 'weekly_refiling_waiting' && none.body.electionOpened === false);
  const many = await request(port, 'POST', '/dev/impeachment-vacancy/shared-election-path', { candidateCount: 2, electionUse: 'by_election' }, header);
  const generalMany = await request(port, 'POST', '/dev/impeachment-vacancy/shared-election-path', { candidateCount: 2, electionUse: 'general' }, header);
  ok('16', '복수 48시간 호환', many.body.status === 'open' && many.body.voteKind === 'leader_election_48h' && many.body.voteDurationMs === 48 * hour && many.body.officeGranted === false && many.body.electionOpened === false && many.body.stored === false && many.body.status === generalMany.body.status);

  const rankRow = service.readStore(officePath).ranks[0];
  const pioneer = service.readStore(officePath).offices.filter(function (row) { return row.country === 'KR' && row.territory === 'pioneer'; })[0];
  ok('보존', '계급·시즌·한국 기존 메모', pioneer.rank === 'representative' && pioneer.season === 'season-kept' && pioneer.note === '기존-KR-pioneer' && pioneer.leaderId === null && rankRow.citizen === 10 && rankRow.representative === 8 && removed.body.removal.rankChanged === false && removed.body.removal.seasonChanged === false && removed.body.removal.productionOfficeChanged === false);

  await closeServer(server);
  server = await httpDev.listen(port, officePath, citizenPath);
  const restored = await request(port, 'GET', '/dev/impeachment-vacancy/offices/KR/pioneer', null, header);
  ok('17', '재시작 후 기록 유지', restored.body.office.status === 'vacant' && restored.body.office.schedule.vacancyStartMs === now && restored.body.office.schedule.electionOpened === false);

  const failedWrite = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-retry', clockSource: 'test-fixture', nowMs: now, failOfficeWrite: true }, header);
  const still = service.readStore(officePath).offices.filter(function (row) { return row.country === 'US' && row.territory === 'pioneer'; })[0];
  const recovered = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-retry', clockSource: 'test-fixture', nowMs: now }, header);
  const twice = await request(port, 'POST', '/dev/impeachment-vacancy/removals', { ballotId: 'citizen-retry', clockSource: 'test-fixture', nowMs: now + 1 }, header);
  ok('18', '저장 실패와 재시도', failedWrite.body.reason === 'OFFICE_STORE_WRITE_FAILED' && still.status === 'sitting' && still.leaderId === 'leader-retry' && recovered.body.office.status === 'vacant' && twice.body.reason === 'REMOVAL_EXISTS' && service.readStore(officePath).removals.filter(function (row) { return row.citizenBallotId === 'citizen-retry'; }).length === 1);

  await closeServer(server);
  server = null;
  const rounds = spawnSync(process.execPath, ['tools/test-leader-election-rounds.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const votes = spawnSync(process.execPath, ['tools/test-leader-election-vote.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  ok('19', '선거 회차 회귀', rounds.status === 0 && votes.status === 0);
  const citizen = spawnSync(process.execPath, ['tools/test-citizen-impeach-vote.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  ok('20', '시민 탄핵 24개 회귀', citizen.status === 0 && String(citizen.stdout).indexOf('24 passed, 0 failed') >= 0);

  console.log(passed + ' passed, ' + failed + ' failed');
  const outDir = 'C:/Users/user/AppData/Local/Cursor/AgentStores/cursor_agent_stores/bc-c953b949-98fb-4f5d-8b49-80c8cb69e605/files/media/impeachment-vacancy';
  fs.mkdirSync(outDir, { recursive: true });
  const summary = [
    '화면 없음. HTTP 결과만 기록한다.',
    scenario.join('\n'),
    '충돌: DEC-023과 시민 탄핵 가결 기록은 검증 2일을 유지한다. 시민 투표 테스트의 reviewDays === 2 단정은 지우지 않았다.',
    '4차 D 공석 일정은 검증 2일 없이 공석 7일, 접수 3일, 기존 선거 48시간이다. 합계 12일.',
    '해임 시각과 공석 시작: ' + now,
    '공석 종료: ' + (now + 7 * day),
    '접수 종료: ' + (now + 10 * day),
    '투표 예정: 48시간. 선거는 열지 않음.',
    'productionAuth: false',
    'Postgres: 미검증',
    '실제 회원 인증: 미검증',
    '4차 E: 시작하지 않음. 자동 접수와 투표 개설은 하지 않음.',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary);
  process.exit(failed ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
