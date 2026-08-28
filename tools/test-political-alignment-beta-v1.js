'use strict';
/**
 * BETA ALIGNMENT V1 canonical tests A–AD
 * node tools/test-political-alignment-beta-v1.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const beta = require('../shared/political-alignment-beta-v1-core');
const simCore = require('../shared/political-alignment-simulation-core');
const persistSvc = require('../server/political-alignment-persist-service');
const boardSchema = require('../shared/board-schema-core');
const inputCore = require('../shared/political-reaction-input-core');
const teardown = require('./test-process-teardown');

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

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

const AS_OF = new Date('2026-08-15T12:00:00.000Z');

function daysAgo(days) {
  return new Date(AS_OF.getTime() - days * 86400000).toISOString();
}

function userById(result, id) {
  var i;
  var list = result.users || [];
  for (i = 0; i < list.length; i++) {
    if (list[i].userId === id) return list[i];
  }
  return null;
}

function row(partial) {
  var base = {
    id: uid(100),
    actor_user_id: uid(1),
    target_author_user_id: uid(2),
    reaction_type: 'LIKE',
    actor_territory_at_reaction: 'PIONEER',
    target_author_territory_at_reaction: 'PIONEER',
    actor_alignment_score_at_reaction: 0,
    target_author_alignment_score_at_reaction: 0,
    created_at: daysAgo(5),
    cancelled_at: null,
    audience_scope: 'EARTH',
    target_type: 'POST',
    post_id: uid(3),
  };
  Object.keys(partial || {}).forEach(function (k) {
    base[k] = partial[k];
  });
  return base;
}

function sim(rows, extra) {
  return simCore.simulateAlignmentBatch(Object.assign({ asOf: AS_OF, rows: rows }, extra || {}));
}

function actorDelta(partial) {
  var r = sim([row(Object.assign({ id: uid(900 + pass + fail) }, partial))]);
  var u = userById(r, uid(1));
  return u ? u.rawDelta : null;
}

function authorDelta(partial) {
  var r = sim([row(Object.assign({ id: uid(900 + pass + fail) }, partial))]);
  var u = userById(r, uid(2));
  return u ? u.rawDelta : null;
}

const sql = fs.readFileSync(path.join(root, 'supabase', 'migration_political_alignment_beta_v1.sql'), 'utf8');
const sqlBody = sql.replace(/--[^\n]*/g, '');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });

section('가드');
ok('BETA_V1 policies', beta.POLICIES.VERSION === 'BETA_V1' && beta.POLICIES.EXIT_ABS === 360 && beta.POLICIES.RETURN_ABS === 160 && beta.POLICIES.MIN_TERRITORY_STAY_HOURS === 24 && beta.POLICIES.REQUIRED_CONSECUTIVE_BATCHES === 2);
ok('scheduler 기본 OFF 문서', persistSvc.POLITICAL_BATCH_SCHEDULER === 'READY_DISABLED');
ok('simulation TERRITORY_MOVE NOT_CONNECTED', simCore.TERRITORY_MOVE === 'NOT_CONNECTED');
ok('persist TERRITORY_MOVE SERVER_INTERNAL_BATCH', persistSvc.TERRITORY_MOVE === 'SERVER_INTERNAL_BATCH');
ok('DAILY_ISSUE ACTIVE_SEED', beta.POLICIES.DAILY_ISSUE === 'ACTIVE_SEED');
ok('migration DROP TABLE/TRUNCATE/DELETE FROM 없음', !/\bTRUNCATE\b/.test(sqlBody) && !/\bDROP TABLE\b/.test(sqlBody) && !/\bDELETE FROM\b/.test(sqlBody));
ok("stay SQL 24h all-moves", /interval '24 hours'/.test(sql) && !/interval '48 hours'/.test(sql));
ok(
  'auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\//.test(authDiff)
);
ok('score snapshot 컬럼 additive', /actor_alignment_score_at_reaction/.test(sql) && /target_author_alignment_score_at_reaction/.test(sql));
ok('board schema snapshot parse 0', boardSchema.toAlignmentReactionInput(row({ actor_alignment_score_at_reaction: 0 })).actorAlignmentScoreAtReaction === 0);

section('A 신규 CENTRAL / score0');
ok('A default state score 0', require('../shared/political-alignment-persist-core').defaultInitialState().score === 0);
ok('A INITIAL CENTRAL', require('../shared/canonical-user-territory-core').INITIAL_TERRITORY === 'CENTRAL');

section('B-E ACTOR_SELF');
ok('A CENTRAL score0 LIKE GUARDIAN actor -25', actorDelta({
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'GUARDIAN',
  actor_alignment_score_at_reaction: 0,
  reaction_type: 'LIKE',
}) === -25);
ok('A CENTRAL score0 LIKE PIONEER actor +25', actorDelta({
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'PIONEER',
  actor_alignment_score_at_reaction: 0,
  reaction_type: 'LIKE',
}) === 25);
ok('B PIONEER target LIKE actor +', actorDelta({
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'LIKE',
}) === 17.5);
ok('C PIONEER target DISLIKE actor -', actorDelta({
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'DISLIKE',
}) === -32.5);
ok('D GUARDIAN target LIKE actor -', actorDelta({
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'LIKE',
}) === -32.5);
ok('E GUARDIAN target DISLIKE actor +', actorDelta({
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'DISLIKE',
}) === 17.5);

section('F-I AUTHOR_RECEIVED');
ok('F PIONEER actor LIKE author +', authorDelta({
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'LIKE',
}) === 70);
ok('G PIONEER actor DISLIKE author pair-capped 120', authorDelta({
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'DISLIKE',
}) === -120);
ok('H GUARDIAN actor LIKE author pair-capped 120', authorDelta({
  actor_territory_at_reaction: 'GUARDIAN',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'LIKE',
}) === -120);
ok('I GUARDIAN actor DISLIKE author +', authorDelta({
  actor_territory_at_reaction: 'GUARDIAN',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'DISLIKE',
}) === 70);

section('J-L CENTRAL gradual');
ok('J score 120 strength 0.5', beta.gradualStrength(120) === 0.5 && beta.effectiveLean('CENTRAL', 120) === 'PIONEER');
ok('K score -160 strength 0.75', beta.gradualStrength(-160) === 0.75 && beta.effectiveLean('CENTRAL', -160) === 'GUARDIAN');
ok('L deadzone ±40', beta.gradualStrength(40) === 0 && beta.gradualStrength(-40) === 0 && beta.gradualStrength(0) === 0);
ok('J CENTRAL-CENTRAL LIKE actor 0', actorDelta({
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'CENTRAL',
  target_author_alignment_score_at_reaction: 120,
  actor_alignment_score_at_reaction: 0,
  reaction_type: 'LIKE',
}) === 0);
ok('K CENTRAL actor -160 LIKE author *0.75', authorDelta({
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'PIONEER',
  actor_alignment_score_at_reaction: -160,
  target_author_alignment_score_at_reaction: 0,
  reaction_type: 'LIKE',
}) === -97.5);
ok('L deadzone contribution 0', actorDelta({
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'CENTRAL',
  target_author_alignment_score_at_reaction: 40,
  actor_alignment_score_at_reaction: 40,
  reaction_type: 'LIKE',
}) === 0);

section('M pair 7d cap 120');
(function () {
  var rows = [];
  var i;
  for (i = 0; i < 3; i++) {
    rows.push(row({
      id: uid(500 + i),
      actor_user_id: uid(1),
      target_author_user_id: uid(2),
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'GUARDIAN',
      reaction_type: 'LIKE',
      created_at: daysAgo(1),
    }));
  }
  var r = sim(rows);
  var author = userById(r, uid(2));
  var actor = userById(r, uid(1));
  ok('M author pair abs cap 120', author && author.rawDelta === 120);
  ok('M actor 25% then daily ±60', actor && actor.rawDelta === -60);
})();

section('N community daily ±240');
(function () {
  var rows = [];
  var i;
  for (i = 0; i < 4; i++) {
    rows.push(row({
      id: uid(520 + i),
      actor_user_id: uid(10 + i),
      target_author_user_id: uid(2),
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'GUARDIAN',
      reaction_type: 'LIKE',
      created_at: daysAgo(1),
    }));
  }
  var author = userById(sim(rows), uid(2));
  ok('N same-day 4x130 → 240', author && author.rawDelta === 240 && author.capApplied === false);
})();

section('O Daily Issue leftover helper · live seed cap 180');
ok('O leftover 4-choice helper unused by live seed', beta.dailyIssueSignedDelta('STRONG_PIONEER') === 120);
ok('O live daily cap ±180', beta.applySignedDailyCap(180, 60, 180).stored === 0 && beta.applySignedDailyCap(-180, -10, 180).stored === 0);
ok('O live DAILY_ISSUE ACTIVE_SEED', simCore.POLICIES.DAILY_ISSUE === 'ACTIVE_SEED');
ok('O live DI magnitude 60', beta.computeDailyIssueReactionSigned('PIONEER', 'LIKE') === 60);

section('P-R exclude');
(function () {
  var r = sim([row({ id: uid(540), actor_user_id: uid(2), target_author_user_id: uid(2) })]);
  ok('P self reaction 0', r.eligibleReactionCount === 0 && r.excludeReasons.SELF_REACTION === 1);
})();
(function () {
  var r = sim([row({ id: uid(541), reaction_type: 'EMPATHY' }), row({ id: uid(542), reaction_type: 'REPORT' })]);
  ok('Q EMPATHY/REPORT 0', r.eligibleReactionCount === 0 && r.excludeReasons.TYPE_EXCLUDED === 2);
})();
(function () {
  var r = sim([row({ id: uid(543), cancelled_at: daysAgo(1) })]);
  ok('R cancelled 제외', r.eligibleReactionCount === 0 && r.excludeReasons.INACTIVE === 1);
})();

section('S snapshot invariant');
(function () {
  var rows = [row({
    id: uid(550),
    actor_territory_at_reaction: 'CENTRAL',
    target_author_territory_at_reaction: 'CENTRAL',
    target_author_alignment_score_at_reaction: 120,
    actor_alignment_score_at_reaction: 0,
    reaction_type: 'LIKE',
  })];
  var cur = {};
  cur[uid(1)] = 999;
  cur[uid(2)] = 999;
  var a = sim(rows);
  var b = sim(rows, { currentScoreByUser: cur });
  ok('S past snapshot unchanged by current score', userById(a, uid(1)).rawDelta === 0 && userById(b, uid(1)).rawDelta === 0);
})();

section('T-W EXIT 360 × 2');
(async function () {
  const t0 = '2026-08-10T08:00:00.000Z';
  const t1 = '2026-08-10T20:00:00.000Z';
  const store = persistSvc.createMemoryAlignmentStore();
  const u = uid(30);
  store.seedTerritory(u, 'CENTRAL');
  await store.applyPlan({ batchId: 'tv-359', processedAt: t0, users: [{ userId: u, combinedSignal: 359 }] });
  ok('T CENTRAL +359 no move', store.getTerritory(u) === 'CENTRAL' && store.getState(u).pendingTerritory == null && store.getState(u).score === 359);

  const storeP = persistSvc.createMemoryAlignmentStore();
  const p = uid(31);
  storeP.seedTerritory(p, 'CENTRAL');
  await storeP.applyPlan({ batchId: 'tv-360-1', processedAt: t0, users: [{ userId: p, combinedSignal: 360 }] });
  ok('U first +360 pending 1', storeP.getTerritory(p) === 'CENTRAL' && storeP.getState(p).pendingTerritory === 'PIONEER' && storeP.getState(p).pendingTerritoryCount === 1);
  await storeP.applyPlan({ batchId: 'tv-360-2', processedAt: t1, users: [{ userId: p, combinedSignal: 360 }] });
  ok('V second +360 → PIONEER', storeP.getTerritory(p) === 'PIONEER' && storeP.getState(p).pendingTerritory == null);
  ok('V territory history ALIGNMENT', storeP.getTerritoryHistory().length === 1 && storeP.getTerritoryHistory()[0].reason === 'ALIGNMENT' && storeP.getTerritoryHistory()[0].fromTerritory === 'CENTRAL');

  const storeG = persistSvc.createMemoryAlignmentStore();
  const g = uid(32);
  storeG.seedTerritory(g, 'CENTRAL');
  await storeG.applyPlan({ batchId: 'tv-g1', processedAt: t0, users: [{ userId: g, combinedSignal: -360 }] });
  await storeG.applyPlan({ batchId: 'tv-g2', processedAt: t1, users: [{ userId: g, combinedSignal: -360 }] });
  ok('W CENTRAL -360 2회 → GUARDIAN', storeG.getTerritory(g) === 'GUARDIAN');

  section('X-Z RETURN + 24h');
  const storeX = persistSvc.createMemoryAlignmentStore();
  const x = uid(33);
  storeX.seedTerritory(x, 'PIONEER');
  storeX.seedState(x, { score: 0, previousSignal: 0, lastTerritoryChangedAt: '2026-01-01T00:00:00.000Z' });
  await storeX.applyPlan({ batchId: 'tv-x1', processedAt: t0, users: [{ userId: x, combinedSignal: 161 }] });
  await storeX.applyPlan({ batchId: 'tv-x2', processedAt: t1, users: [{ userId: x, combinedSignal: 161 }] });
  ok('X PIONEER +161 유지', storeX.getTerritory(x) === 'PIONEER');

  const storeY = persistSvc.createMemoryAlignmentStore();
  const y = uid(34);
  const enter = '2026-08-10T00:00:00.000Z';
  const soon = '2026-08-10T10:00:00.000Z';
  const soon2 = '2026-08-10T22:00:00.000Z';
  storeY.seedTerritory(y, 'PIONEER');
  storeY.seedState(y, { score: 0, previousSignal: 0, lastTerritoryChangedAt: enter });
  await storeY.applyPlan({ batchId: 'tv-y1', processedAt: soon, users: [{ userId: y, combinedSignal: 160 }] });
  await storeY.applyPlan({ batchId: 'tv-y2', processedAt: soon2, users: [{ userId: y, combinedSignal: 160 }] });
  ok('Y 24h 미만 +160 유지', storeY.getTerritory(y) === 'PIONEER');

  const storeZ = persistSvc.createMemoryAlignmentStore();
  const z = uid(35);
  const oldEnter = '2026-08-01T00:00:00.000Z';
  storeZ.seedTerritory(z, 'PIONEER');
  storeZ.seedState(z, { score: 0, previousSignal: 0, lastTerritoryChangedAt: oldEnter });
  await storeZ.applyPlan({ batchId: 'tv-z1', processedAt: t0, users: [{ userId: z, combinedSignal: 160 }] });
  ok('Z first return pending', storeZ.getTerritory(z) === 'PIONEER' && storeZ.getState(z).pendingTerritory === 'CENTRAL');
  await storeZ.applyPlan({ batchId: 'tv-z2', processedAt: t1, users: [{ userId: z, combinedSignal: 160 }] });
  ok('Z 24h 이후 +160 2회 → CENTRAL', storeZ.getTerritory(z) === 'CENTRAL');

  section('AA-AD switch / alien / idempotent / rollback');
  const storeAA = persistSvc.createMemoryAlignmentStore();
  const aa = uid(36);
  storeAA.seedTerritory(aa, 'PIONEER');
  storeAA.seedState(aa, { score: 0, previousSignal: 0, lastTerritoryChangedAt: oldEnter });
  await storeAA.applyPlan({ batchId: 'tv-aa1', processedAt: t0, users: [{ userId: aa, combinedSignal: -360 }] });
  await storeAA.applyPlan({ batchId: 'tv-aa2', processedAt: t1, users: [{ userId: aa, combinedSignal: -360 }] });
  ok('AA PIONEER 직접 GUARDIAN 없음', storeAA.getTerritory(aa) === 'CENTRAL');

  const storeAB = persistSvc.createMemoryAlignmentStore();
  const ab = uid(37);
  storeAB.seedTerritory(ab, 'ALIEN');
  await storeAB.applyPlan({ batchId: 'tv-ab1', processedAt: t0, users: [{ userId: ab, combinedSignal: 500 }] });
  await storeAB.applyPlan({ batchId: 'tv-ab2', processedAt: t1, users: [{ userId: ab, combinedSignal: 500 }] });
  ok('AB ALIEN 자동 이동 없음', storeAB.getTerritory(ab) === 'ALIEN');

  const dup = await storeP.applyPlan({ batchId: 'tv-360-2', processedAt: t1, users: [{ userId: p, combinedSignal: 360 }] });
  ok('AC duplicate batch idempotent', dup.skipped === true && storeP.getTerritory(p) === 'PIONEER' && storeP.getState(p).score === 360);

  const storeAD = persistSvc.createMemoryAlignmentStore();
  const ad = uid(38);
  storeAD.seedTerritory(ad, 'CENTRAL');
  storeAD.seedState(ad, {
    score: 0,
    previousSignal: 0,
    pendingTerritory: 'PIONEER',
    pendingTerritoryCount: 1,
  });
  let threw = false;
  try {
    await storeAD.applyPlan({
      batchId: 'tv-ad-fail',
      processedAt: t1,
      users: [
        { userId: ad, combinedSignal: 360 },
        { userId: null, combinedSignal: 1 },
      ],
    });
  } catch (e) {
    threw = true;
  }
  ok(
    'AD failure no partial territory',
    threw &&
      storeAD.getTerritory(ad) === 'CENTRAL' &&
      storeAD.getState(ad).pendingTerritoryCount === 1 &&
      storeAD.getTerritoryHistory().length === 0 &&
      !storeAD.hasBatch('tv-ad-fail')
  );

  ok('99/30 ratios 유지', simCore.WINDOW_COMBINATION_POLICY === 'CONFIRMED');
  ok('batch cap 500', require('../shared/political-alignment-persist-core').getCap() === 500);
  ok('input SELF_REACTION', inputCore.EXCLUDE.SELF_REACTION === 'SELF_REACTION');

  section('24h stay all moves + boundary + slots');
  const stayMs = beta.POLICIES.MIN_TERRITORY_STAY_HOURS * 3600000;
  const movedAt = '2026-08-20T00:00:00.000Z';
  const at23h5959 = new Date(Date.parse(movedAt) + stayMs - 1000).toISOString();
  const at24h = new Date(Date.parse(movedAt) + stayMs).toISOString();
  const at24hPlus12 = new Date(Date.parse(movedAt) + stayMs + 12 * 3600000).toISOString();

  function stayEval(current, score, lastAt, batchAt, pending, pendingCount) {
    return beta.evaluateTerritoryTransition({
      alignmentScore: score,
      currentTerritory: current,
      pendingTerritory: pending || null,
      pendingTerritoryBatchCount: pendingCount || 0,
      lastTerritoryChangedAt: lastAt,
    }, batchAt);
  }

  ok('A 23:59:59 PIONEER→CENTRAL 금지', stayEval('PIONEER', 160, movedAt, at23h5959).nextTerritory === 'PIONEER' && stayEval('PIONEER', 160, movedAt, at23h5959).territoryChanged === false);
  ok('A 24h PIONEER 체류 통과 pending 시작', stayEval('PIONEER', 160, movedAt, at24h).pendingTerritory === 'CENTRAL' && stayEval('PIONEER', 160, movedAt, at24h).pendingTerritoryBatchCount === 1 && stayEval('PIONEER', 160, movedAt, at24h).territoryChanged === false);
  ok('A 24h+연속2 PIONEER→CENTRAL', stayEval('PIONEER', 160, movedAt, at24hPlus12, 'CENTRAL', 1).territoryChanged === true && stayEval('PIONEER', 160, movedAt, at24hPlus12, 'CENTRAL', 1).nextTerritory === 'CENTRAL');

  ok('B 23:59:59 GUARDIAN→CENTRAL 금지', stayEval('GUARDIAN', -160, movedAt, at23h5959).nextTerritory === 'GUARDIAN' && !stayEval('GUARDIAN', -160, movedAt, at23h5959).territoryChanged);
  ok('B 24h GUARDIAN 체류 통과 pending', stayEval('GUARDIAN', -160, movedAt, at24h).pendingTerritory === 'CENTRAL' && stayEval('GUARDIAN', -160, movedAt, at24h).pendingTerritoryBatchCount === 1);
  ok('B 24h+연속2 GUARDIAN→CENTRAL', stayEval('GUARDIAN', -160, movedAt, at24hPlus12, 'CENTRAL', 1).nextTerritory === 'CENTRAL' && stayEval('GUARDIAN', -160, movedAt, at24hPlus12, 'CENTRAL', 1).territoryChanged);

  ok('C 23h CENTRAL→PIONEER 금지', stayEval('CENTRAL', 360, movedAt, at23h5959).nextTerritory === 'CENTRAL' && !stayEval('CENTRAL', 360, movedAt, at23h5959).territoryChanged);
  ok('C 24h CENTRAL→PIONEER pending', stayEval('CENTRAL', 360, movedAt, at24h).pendingTerritory === 'PIONEER' && stayEval('CENTRAL', 360, movedAt, at24h).pendingTerritoryBatchCount === 1);
  ok('C 24h+연속2 CENTRAL→PIONEER', stayEval('CENTRAL', 360, movedAt, at24hPlus12, 'PIONEER', 1).nextTerritory === 'PIONEER' && stayEval('CENTRAL', 360, movedAt, at24hPlus12, 'PIONEER', 1).territoryChanged);

  ok('D 23h CENTRAL→GUARDIAN 금지', stayEval('CENTRAL', -360, movedAt, at23h5959).nextTerritory === 'CENTRAL');
  ok('D 24h+연속2 CENTRAL→GUARDIAN', stayEval('CENTRAL', -360, movedAt, at24hPlus12, 'GUARDIAN', 1).nextTerritory === 'GUARDIAN' && stayEval('CENTRAL', -360, movedAt, at24hPlus12, 'GUARDIAN', 1).territoryChanged);

  ok('null last_changed 첫 이동은 24h 미적용', stayEval('CENTRAL', 360, null, at23h5959).pendingTerritory === 'PIONEER' && stayEval('CENTRAL', 360, null, at23h5959).pendingTerritoryBatchCount === 1);

  const kst0500 = '2026-08-27T20:00:00.000Z';
  const kst1700 = '2026-08-28T08:00:00.000Z';
  const next0500 = '2026-08-28T20:00:00.000Z';
  const storeSlot = persistSvc.createMemoryAlignmentStore();
  const slotUser = uid(39);
  storeSlot.seedTerritory(slotUser, 'PIONEER');
  storeSlot.seedState(slotUser, { score: 0, previousSignal: 0, lastTerritoryChangedAt: kst0500 });
  await storeSlot.applyPlan({ batchId: 'slot-1700', processedAt: kst1700, users: [{ userId: slotUser, combinedSignal: 160 }] });
  ok('05:00 이동 후 같은 날 17:00 재이동 금지', storeSlot.getTerritory(slotUser) === 'PIONEER');
  await storeSlot.applyPlan({ batchId: 'slot-next-0500', processedAt: next0500, users: [{ userId: slotUser, combinedSignal: 160 }] });
  ok('다음날 05:00은 24h 통과 pending 1', storeSlot.getTerritory(slotUser) === 'PIONEER' && storeSlot.getState(slotUser).pendingTerritory === 'CENTRAL' && storeSlot.getState(slotUser).pendingTerritoryCount === 1);

  ok('24h 지나도 연속 1회는 이동 아님', stayEval('CENTRAL', 360, movedAt, at24h).territoryChanged === false);
  ok('±360 유지', beta.POLICIES.EXIT_ABS === 360);
  ok('±160 유지', beta.POLICIES.RETURN_ABS === 160);

  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail);
})().catch(function (e) {
  ok('async', false, String(e && e.message));
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail || 1);
});
