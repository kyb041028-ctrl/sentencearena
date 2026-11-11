/**
 * 개발용 자동 진행.
 * 저장된 일정만 보고 다음 한 단계를 실행한다. 브라우저 요청으로 시각을 만들지 않는다.
 * 운영 스케줄러가 아니다. 잠금은 이 프로세스 안이다. 여러 JSON은 트랜잭션이 아니다.
 */
'use strict';

const election = require('./leader-election-service');
const runService = require('./by-election-run-service');
const appointment = require('./leader-appointment-service');
const vacancy = require('./impeachment-vacancy-service');

function clockNow(input) {
  const src = input || {};
  if (src.clockSource === 'test-fixture' && isFinite(Number(src.nowMs))) return Number(src.nowMs);
  return Date.now();
}

function latestRun(runStore, ballotId) {
  const rows = (runStore.runs || []).filter(function (row) { return row.citizenBallotId === ballotId; });
  return rows.length ? rows[rows.length - 1] : null;
}

function scheduleFor(store, ballotId) {
  return (store.schedules || []).filter(function (row) { return row.citizenBallotId === ballotId; })[0] || null;
}

function populationOf(schedule) {
  if (!schedule || !schedule.population || schedule.population.source !== 'test-fixture') return null;
  return schedule.population;
}

async function tick(paths, input) {
  const nowMs = clockNow(input);
  const clockSource = (input && input.clockSource) || 'wall';
  const vacancyStore = vacancy.readStore(paths.vacancy);
  const steps = [];
  const removals = vacancyStore.removals || [];
  for (let index = 0; index < removals.length; index += 1) {
    const removal = removals[index];
    const ballotId = removal.citizenBallotId;
    const schedule = scheduleFor(vacancyStore, ballotId);
    if (!schedule) {
      steps.push({ ballotId: ballotId, acted: false, reason: 'MISSING_SCHEDULE' });
      continue;
    }
    const runStore = runService.readStore(paths.run);
    const electionStore = election.readStore(paths.election);
    const run = latestRun(runStore, ballotId);
    const body = { ballotId: ballotId, clockSource: clockSource, nowMs: nowMs };
    const population = populationOf(schedule);
    if (population) body.population = population;
    if (!run) {
      if (nowMs < Number(schedule.filingStartMs)) {
        steps.push({ ballotId: ballotId, acted: false, reason: 'VACANCY_WINDOW', dueAtMs: schedule.filingStartMs });
        continue;
      }
      const opened = await runService.advanceAndPersist(paths, body);
      steps.push({ ballotId: ballotId, acted: opened && opened.opened === true, reason: opened && opened.reason, run: opened && opened.run, ok: !!(opened && opened.ok) });
      continue;
    }
    if (run.status === 'filing') {
      if (nowMs < Number(run.filingEndMs)) {
        steps.push({ ballotId: ballotId, acted: false, reason: 'FILING_OPEN', dueAtMs: run.filingEndMs });
        continue;
      }
      if (!population) {
        steps.push({ ballotId: ballotId, acted: false, reason: 'POPULATION_NOT_STORED' });
        continue;
      }
      const branched = await runService.advanceAndPersist(paths, body);
      steps.push({ ballotId: ballotId, acted: !!(branched && branched.branched), reason: branched && branched.reason, run: branched && branched.run, ok: !!(branched && branched.ok) });
      continue;
    }
    if (run.status === 'weekly_refiling_waiting') {
      if (nowMs < Number(run.nextRefilingAtMs)) {
        steps.push({ ballotId: ballotId, acted: false, reason: 'REFILING_TOO_EARLY', dueAtMs: run.nextRefilingAtMs });
        continue;
      }
      const opened = await runService.advanceAndPersist(paths, body);
      steps.push({ ballotId: ballotId, acted: opened && opened.opened === true, reason: opened && opened.reason, run: opened && opened.run, ok: !!(opened && opened.ok) });
      continue;
    }
    if (run.status === 'vote_open') {
      const row = (electionStore.elections || []).filter(function (item) { return item.filingRoundId === run.filingRoundId; })[0];
      const ballot = row && (electionStore.ballots || []).filter(function (item) { return item.id === row.ballotId; })[0];
      if (!ballot) {
        steps.push({ ballotId: ballotId, acted: false, reason: 'VOTE_NOT_CLOSED' });
        continue;
      }
      if (ballot.status === 'halted' || ballot.status === 'error') {
        steps.push({ ballotId: ballotId, acted: false, reason: ballot.status === 'halted' ? 'HALTED' : 'VOTE_ERROR', officeGranted: false });
        continue;
      }
      if (ballot.status !== 'closed' && nowMs >= Number(ballot.endsAtMs)) {
        const closed = await election.closeBallot(electionStore, { ballotId: ballot.id, nowMs: nowMs });
        if (closed && closed.ok) election.writeStore(paths.election, electionStore);
      }
      const fresh = election.readStore(paths.election);
      const freshBallot = (fresh.ballots || []).filter(function (item) { return item.id === ballot.id; })[0];
      if (!freshBallot || freshBallot.status !== 'closed') {
        steps.push({ ballotId: ballotId, acted: false, reason: 'VOTE_NOT_ENDED', dueAtMs: ballot.endsAtMs });
        continue;
      }
      if (freshBallot.failReason === 'TIE' || freshBallot.failReason === 'ZERO_VOTES' || !freshBallot.winnerId) {
        const waited = await runService.advanceAndPersist(paths, body);
        steps.push({ ballotId: ballotId, acted: !!(waited && waited.dirty), reason: waited && waited.reason, run: waited && waited.run, ok: !!(waited && waited.ok), officeGranted: false });
        continue;
      }
      const appointed = await appointment.appointAndPersist(paths, { filingRoundId: run.filingRoundId, clockSource: clockSource, nowMs: nowMs });
      steps.push({
        ballotId: ballotId,
        acted: appointed && appointed.officeGranted === true && appointed.alreadyApplied !== true && appointed.reason !== 'APPOINTMENT_EXISTS',
        reason: appointed && (appointed.reason || 'APPOINTED'),
        officeGranted: appointed && appointed.officeGranted === true,
        ok: !!(appointed && (appointed.ok || appointed.reason === 'APPOINTMENT_EXISTS')),
      });
      continue;
    }
    if (run.status === 'uncontested_recorded') {
      if (nowMs < Number(run.filingEndMs)) {
        steps.push({ ballotId: ballotId, acted: false, reason: 'FILING_STILL_OPEN', dueAtMs: run.filingEndMs });
        continue;
      }
      const appointed = await appointment.appointAndPersist(paths, { filingRoundId: run.filingRoundId, clockSource: clockSource, nowMs: nowMs });
      steps.push({
        ballotId: ballotId,
        acted: appointed && appointed.officeGranted === true && appointed.reason !== 'APPOINTMENT_EXISTS',
        reason: appointed && (appointed.reason || 'APPOINTED'),
        officeGranted: appointed && appointed.officeGranted === true,
        ok: !!(appointed && (appointed.ok || appointed.reason === 'APPOINTMENT_EXISTS')),
      });
      continue;
    }
    steps.push({ ballotId: ballotId, acted: false, reason: 'NOTHING_DUE', status: run.status });
  }
  return {
    ok: true,
    nowMs: nowMs,
    steps: steps,
    productionScheduler: false,
    lock: 'single-process',
    multiFileTransaction: false,
  };
}

module.exports = { tick: tick, clockNow: clockNow };
