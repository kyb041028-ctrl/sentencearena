'use strict';
/**
 * Political alignment 05:00/17:00 scheduler (Asia/Seoul).
 * Isolated memory store + fake clock. Does not write dest DB.
 *
 * node tools/test-political-alignment-scheduler.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const batchCore = require('../shared/alignment-batch-core');
const simCore = require('../shared/political-alignment-simulation-core');
const persistSvc = require('../server/political-alignment-persist-service');
const schedCore = require('../shared/political-alignment-scheduler-core');
const schedSvc = require('../server/political-alignment-scheduler-service');
const batchId = require('../server/alignment-batch-id');
const teardown = require('./test-process-teardown');

const envWas = process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED;
delete process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED;

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log('  PASS: ' + label);
    pass += 1;
  } else {
    console.log('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail += 1;
  }
}

function section(title) {
  console.log('\n[' + title + ']');
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

/** Construct an instant whose Asia/Seoul wall clock is y-m-d h:min:sec. Independent of process TZ. */
function kst(y, m, d, h, min, sec) {
  return new Date(Date.UTC(y, m - 1, d, h, min, sec || 0) - 9 * 3600 * 1000);
}

function silentLogger() {
  return { info: function () {}, error: function () {}, log: function () {} };
}

function fixtureSim(asOf, users) {
  return {
    asOf: new Date(asOf).toISOString(),
    users: users || [{ userId: uid(11), combinedSignal: 80 }],
    policies: simCore.POLICIES,
  };
}

function baseOpt(asOf, extras) {
  const store = persistSvc.createMemoryAlignmentStore();
  const simulation = fixtureSim(asOf, (extras && extras.users) || [{ userId: uid(11), combinedSignal: 80 }]);
  return Object.assign(
    {
      forceEnabled: true,
      asOf: asOf,
      store: store,
      simulation: simulation,
      logger: silentLogger(),
    },
    extras || {},
    { store: (extras && extras.store) || store, simulation: (extras && extras.simulation) || simulation }
  );
}

const coreSrc = read('shared/political-alignment-scheduler-core.js');
const svcSrc = read('server/political-alignment-scheduler-service.js');
const persistSrc = read('server/political-alignment-persist-service.js');
const batchSrc = read('shared/alignment-batch-core.js');
const serverSrc = read('server.js');
const cliSrc = read('tools/run-political-alignment-batch.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

const startedSchedulers = [];
function startTracked(opt) {
  const started = schedSvc.startAlignmentScheduler(opt);
  if (started && typeof started.stop === 'function') startedSchedulers.push(started);
  return started;
}

(async function main() {
  try {
  section('가드 · SSOT · 정책');
  ok('POLITICAL_REACTION_INPUT ACTIVE_CANONICAL', persistSvc.POLITICAL_REACTION_INPUT === 'ACTIVE_CANONICAL');
  ok('simulation ACTIVE_READ_ONLY', simCore.POLITICAL_SIMULATION === 'ACTIVE_READ_ONLY');
  ok('CENTRAL_SIGN_POLICY CONFIRMED', simCore.CENTRAL_SIGN_POLICY === 'CONFIRMED');
  ok('persist scheduler READY_DISABLED', persistSvc.POLITICAL_BATCH_SCHEDULER === 'READY_DISABLED');
  ok('sched core READY_DISABLED', schedCore.POLITICAL_BATCH_SCHEDULER === 'READY_DISABLED');
  ok('MISSED_BATCH_POLICY PENDING', schedCore.MISSED_BATCH_POLICY === 'PENDING');
  ok('RETRY_POLICY PENDING', schedCore.RETRY_POLICY === 'PENDING');
  ok('TERRITORY_MOVE NOT_CONNECTED', schedSvc.TERRITORY_MOVE === 'NOT_CONNECTED');
  ok(
    'env 키 POLITICAL_ALIGNMENT_SCHEDULER_ENABLED',
    schedCore.ENV_ENABLED_KEY === 'POLITICAL_ALIGNMENT_SCHEDULER_ENABLED'
  );
  ok(
    'scheduler는 계산 공식 미복제',
    !/computeSignedDelta/.test(coreSrc) &&
      !/computeSignedDelta/.test(svcSrc) &&
      !/maxScoreChangePerBatch/.test(coreSrc) &&
      !/maxScoreChangePerBatch/.test(svcSrc) &&
      !/WEIGHT_SAME_TERRITORY/.test(coreSrc + svcSrc) &&
      !/\* 0\.5/.test(coreSrc) &&
      !/\* 0\.5/.test(svcSrc) &&
      !/processAlignmentUserBatch/.test(coreSrc + svcSrc)
  );
  ok(
    'OS local time API 미사용',
    !/\.getHours\(/.test(coreSrc) &&
      !/\.getTimezoneOffset\(/.test(coreSrc) &&
      !/\.getHours\(/.test(svcSrc)
  );
  ok(
    'catch-up 창 없음',
    !/catchupMinutes/.test(coreSrc) && !/catchupMinutes/.test(svcSrc) && !/7\s*\*\s*86400/.test(coreSrc + svcSrc)
  );
  ok('scheduler는 persist service를 호출', /runPoliticalAlignmentBatch/.test(svcSrc));
  ok('signed SSOT 유지 (alignment-batch-core)', /function computeSignedDelta/.test(batchSrc));
  ok(
    'manual CLI 유지',
    /--dry-run/.test(cliSrc) && /--apply/.test(cliSrc) && /runPoliticalAlignmentBatch/.test(cliSrc)
  );
  ok(
    'public score-write API 없음',
    !/apply_alignment_score_batch/.test(serverSrc) && !/political-alignment-persist-service/.test(serverSrc)
  );
  ok(
    'server.js scheduler opt-in',
    /POLITICAL_ALIGNMENT_SCHEDULER_ENABLED/.test(serverSrc) && /political-alignment-scheduler-service/.test(serverSrc)
  );
  ok(
    'auth/app-entry 미수정',
    !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) && !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff)
  );
  ok(
    'CENTRAL signed 유지',
    batchCore.computeSignedDelta({
      reactionType: 'LIKE',
      actorTerritoryAtReaction: 'CENTRAL',
      targetTerritoryAtReaction: 'PIONEER',
    }) === 120 &&
      batchCore.computeSignedDelta({
        reactionType: 'LIKE',
        actorTerritoryAtReaction: 'CENTRAL',
        targetTerritoryAtReaction: 'CENTRAL',
      }) === 0
  );

  section('기본 disabled · startup 즉시 실행 금지');
  const t0500 = kst(2026, 8, 16, 5, 0, 0);
  const disabled = await schedSvc.tick(
    Object.assign(baseOpt(t0500), { forceEnabled: false, enabled: false })
  );
  ok(
    'env 꺼진 05:00 tick은 실행 안 함',
    disabled.reason === 'SCHEDULER_DISABLED' && disabled.skipped === true && disabled.crashed === false
  );
  const disabledStart = startTracked({
    forceEnabled: false,
    enabled: false,
    asOf: t0500,
    logger: silentLogger(),
  });
  ok('env 꺼진 start는 started false', disabledStart.started === false);

  const t0501 = kst(2026, 8, 16, 5, 1, 0);
  const opt0501 = baseOpt(t0501);
  const started0501 = startTracked(Object.assign(opt0501, { intervalMs: 3600000 }));
  const tick0501s = await started0501.startTick;
  started0501.stop();
  ok('05:01 startup skipped NOT_SLOT', tick0501s.reason === 'NOT_SLOT' && !opt0501.store.hasBatch('alignment-20260816-0500'));

  const t1324 = kst(2026, 8, 16, 13, 24, 0);
  const opt1324 = baseOpt(t1324);
  const started1324 = startTracked(Object.assign(opt1324, { intervalMs: 3600000 }));
  const tick1324 = await started1324.startTick;
  started1324.stop();
  ok('13:24 startup 즉시 run 없음', tick1324.reason === 'NOT_SLOT' && opt1324.store.getHistory().length === 0);

  const t0530 = kst(2026, 8, 16, 5, 30, 0);
  const r0530 = await schedSvc.tick(baseOpt(t0530));
  ok('05:30 missed catch-up 없음', r0530.reason === 'NOT_SLOT' && r0530.skipped);

  section('05:00 / 17:00 fake clock');
  const opt459 = baseOpt(kst(2026, 8, 16, 4, 59, 0));
  const r459 = await schedSvc.tick(opt459);
  ok('04:59 no run', r459.reason === 'NOT_SLOT' && !opt459.store.hasBatch('alignment-20260816-0500'));

  const opt500 = baseOpt(t0500);
  const r500 = await schedSvc.tick(opt500);
  ok(
    '05:00 run APPLIED',
    r500.outcome === 'APPLIED' &&
      r500.batchId === 'alignment-20260816-0500' &&
      opt500.store.hasBatch('alignment-20260816-0500') &&
      opt500.store.getState(uid(11)).score === 80
  );

  const r500dup = await schedSvc.tick(opt500);
  ok(
    'duplicate 05:00 ALREADY_APPLIED 점수 유지',
    r500dup.outcome === 'ALREADY_APPLIED' &&
      opt500.store.getState(uid(11)).score === 80 &&
      opt500.store.getHistory().length === 1
  );

  const opt1659 = baseOpt(kst(2026, 8, 16, 16, 59, 0));
  const r1659 = await schedSvc.tick(opt1659);
  ok('16:59 no run', r1659.reason === 'NOT_SLOT');

  const t1700 = kst(2026, 8, 16, 17, 0, 0);
  const opt1700 = baseOpt(t1700);
  const r1700 = await schedSvc.tick(opt1700);
  ok(
    '17:00 run APPLIED',
    r1700.outcome === 'APPLIED' &&
      r1700.batchId === 'alignment-20260817-1700'.replace('20260817', '20260816') &&
      r1700.batchId === 'alignment-20260816-1700' &&
      opt1700.store.hasBatch('alignment-20260816-1700')
  );

  const r1700dup = await schedSvc.tick(opt1700);
  ok('duplicate 17:00 ALREADY_APPLIED', r1700dup.outcome === 'ALREADY_APPLIED' && opt1700.store.getHistory().length === 1);

  const tNext0500 = kst(2026, 8, 17, 5, 0, 0);
  const rNext = await schedSvc.tick(baseOpt(tNext0500));
  ok(
    '다음날 05:00 새 batch id',
    rNext.outcome === 'APPLIED' && rNext.batchId === 'alignment-20260817-0500'
  );

  section('Asia/Seoul · 서버 TZ 독립');
  const utc0500 = new Date('2026-08-15T20:00:00.000Z');
  const utc1700 = new Date('2026-08-16T08:00:00.000Z');
  const utc2359 = new Date('2026-08-15T14:59:00.000Z');
  ok(
    'UTC instant 05:00 KST batch id',
    schedCore.evaluateTick(utc0500).batchId === 'alignment-20260816-0500' &&
      batchId.createAlignmentBatchId(utc0500) === 'alignment-20260816-0500'
  );
  ok('UTC instant 17:00 KST batch id', schedCore.evaluateTick(utc1700).batchId === 'alignment-20260816-1700');
  ok('23:59 KST 실행 없음', schedCore.evaluateTick(utc2359).due === false);
  const nextMorning = schedCore.evaluateTick(new Date('2026-08-16T20:00:00.000Z'));
  ok('다음날 05:00 KST 새 날짜 id', nextMorning.due && nextMorning.batchId === 'alignment-20260817-0500');
  ok(
    'slot id == createAlignmentBatchId at slot',
    batchId.createAlignmentBatchId(t0500) === 'alignment-20260816-0500' &&
      batchId.getAlignmentDueSlot(t0500).batchId === 'alignment-20260816-0500'
  );
  ok('Intl timezone Asia/Seoul', schedCore.TIMEZONE === 'Asia/Seoul' && batchId.SEOUL_TZ === 'Asia/Seoul');
  const partsUtc = schedCore.getSeoulDateParts(utc0500);
  ok(
    'process local getHours를 쓰지 않음 (KST 05)',
    partsUtc.hour === '05' && partsUtc.minute === '00' && partsUtc.day === '16'
  );

  section('multi-instance / manual 충돌');
  const concStore = persistSvc.createMemoryAlignmentStore();
  const concAsOf = t0500;
  const concOpt = {
    forceEnabled: true,
    asOf: concAsOf,
    store: concStore,
    simulation: fixtureSim(concAsOf),
    logger: silentLogger(),
  };
  const concPair = await Promise.all([schedSvc.tick(concOpt), schedSvc.tick(concOpt)]);
  const concApplied = concPair.filter(function (r) {
    return r.outcome === 'APPLIED';
  }).length;
  const concSkipped = concPair.filter(function (r) {
    return r.outcome === 'ALREADY_APPLIED';
  }).length;
  ok(
    'multi-instance 동시 tick 한 번만 적용',
    concApplied === 1 && concSkipped === 1 && concStore.getState(uid(11)).score === 80
  );

  const clashStore = persistSvc.createMemoryAlignmentStore();
  const clashSim = fixtureSim(t1700);
  const manual = await persistSvc.runPoliticalAlignmentBatch({
    apply: true,
    batchId: 'alignment-20260816-1700',
    asOf: t1700,
    simulation: clashSim,
    store: clashStore,
  });
  const schedAfterManual = await schedSvc.tick({
    forceEnabled: true,
    asOf: t1700,
    store: clashStore,
    simulation: clashSim,
    logger: silentLogger(),
  });
  ok(
    'manual CLI와 scheduler 같은 slot 한 번만 적용',
    manual.rpc.committed === true &&
      schedAfterManual.outcome === 'ALREADY_APPLIED' &&
      clashStore.getState(uid(11)).score === 80
  );

  const clash2 = persistSvc.createMemoryAlignmentStore();
  const clash2Sim = fixtureSim(t0500);
  await schedSvc.tick({
    forceEnabled: true,
    asOf: t0500,
    store: clash2,
    simulation: clash2Sim,
    logger: silentLogger(),
  });
  const manualAfter = await persistSvc.runPoliticalAlignmentBatch({
    apply: true,
    batchId: 'alignment-20260816-0500',
    asOf: t0500,
    simulation: clash2Sim,
    store: clash2,
  });
  ok('scheduler 후 동일 slot manual ALREADY_APPLIED', manualAfter.rpc.skipped === true && clash2.getHistory().length === 1);

  section('failure · rollback · process crash 없음');
  const failStore = persistSvc.createMemoryAlignmentStore();
  await failStore.applyPlan({
    batchId: 'alignment-pre',
    processedAt: t0500.toISOString(),
    users: [{ userId: uid(11), combinedSignal: 80 }],
  });
  const origApply = failStore.applyPlan.bind(failStore);
  failStore.applyPlan = async function (plan) {
    const poisoned = JSON.parse(JSON.stringify(plan));
    poisoned.users = (poisoned.users || []).concat([{ userId: null, combinedSignal: 1 }]);
    return origApply(poisoned);
  };
  const failTick = await schedSvc.tick({
    forceEnabled: true,
    asOf: t0500,
    store: failStore,
    simulation: fixtureSim(t0500, [{ userId: uid(11), combinedSignal: 160 }]),
    logger: silentLogger(),
  });
  ok(
    'batch failure FAILED이며 crash 아님',
    failTick.outcome === 'FAILED' && failTick.crashed === false && failTick.ok === false
  );
  ok(
    'failure rollback · 해당 slot APPLIED 아님',
    failStore.getState(uid(11)).score === 80 && !failStore.hasBatch('alignment-20260816-0500')
  );

  let threw = false;
  try {
    await schedSvc.tick({
      forceEnabled: true,
      asOf: t0500,
      logger: silentLogger(),
      persistRunner: function () {
        throw new Error('BOOM');
      },
    });
  } catch (e) {
    threw = true;
  }
  ok('tick 예외를 process로 전파하지 않음', threw === false);

  const afterFail = await schedSvc.tick(baseOpt(t1700));
  ok('다음 17:00 slot은 정상 실행 가능', afterFail.outcome === 'APPLIED' && afterFail.crashed === false);

  section('로그에 PII/반응 원문 없음');
  ok(
    'logger payload 필드 제한',
    /safeLogPayload/.test(svcSrc) && !/reaction_type/.test(svcSrc) && !/\buserId\b/.test(svcSrc)
  );
  // persistRunner logs in persist service already redact. scheduler userCount only.

  section('기존 persistence 불변식');
  const capStore = persistSvc.createMemoryAlignmentStore();
  await capStore.applyPlan({
    batchId: 'alignment-cap0',
    processedAt: t0500.toISOString(),
    users: [{ userId: uid(21), combinedSignal: 260 }],
  });
  await persistSvc.runPoliticalAlignmentBatch({
    apply: true,
    batchId: 'alignment-20260816-1700',
    asOf: t1700,
    store: capStore,
    simulation: fixtureSim(t1700, [{ userId: uid(21), combinedSignal: -500 }]),
  });
  ok(
    '±500 cap 공식 유지 260 + (-500) = -240',
    capStore.getState(uid(21)).score === -240 && capStore.getState(uid(21)).previousSignal === -500
  );

  } finally {
    startedSchedulers.forEach(function (s) {
      try {
        s.stop();
      } catch (e) {}
    });
    if (envWas != null) process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED = envWas;
    else delete process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED;
  }

  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail);
})().catch(function (e) {
  startedSchedulers.forEach(function (s) {
    try {
      s.stop();
    } catch (err) {}
  });
  if (envWas != null) process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED = envWas;
  else delete process.env.POLITICAL_ALIGNMENT_SCHEDULER_ENABLED;
  console.error(e);
  return teardown.finishTest(1);
});
