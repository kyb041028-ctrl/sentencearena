'use strict';
/**
 * Alignment score persistence (manual RPC; scheduler READY_DISABLED)
 * node tools/test-political-alignment-persist.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const batchCore = require('../shared/alignment-batch-core');
const simCore = require('../shared/political-alignment-simulation-core');
const persistCore = require('../shared/political-alignment-persist-core');
const persistSvc = require('../server/political-alignment-persist-service');
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

const sql = read('supabase/migration_political_alignment_persistence.sql');
const svcSrc = read('server/political-alignment-persist-service.js');
const batchSrc = read('shared/alignment-batch-core.js');
const simSrc = read('shared/political-alignment-simulation-core.js');
const oldMig = read('supabase/migration_alignment_system.sql');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

function signed(actor, target, type) {
  return batchCore.computeSignedDelta({
    reactionType: type,
    actorTerritoryAtReaction: actor,
    targetTerritoryAtReaction: target,
  });
}

section('가드 · SSOT');
ok('input polarity 유지', require('../shared/political-reaction-input-core').mapPolarity('LIKE') === 'POSITIVE');
ok('simulation still ACTIVE_READ_ONLY', simCore.POLITICAL_SIMULATION === 'ACTIVE_READ_ONLY');
ok('CENTRAL_SIGN_POLICY CONFIRMED', simCore.CENTRAL_SIGN_POLICY === 'CONFIRMED');
ok('scheduler READY_DISABLED', persistSvc.POLITICAL_BATCH_SCHEDULER === 'READY_DISABLED');
ok('TERRITORY_MOVE SERVER_INTERNAL_BATCH', persistSvc.TERRITORY_MOVE === 'SERVER_INTERNAL_BATCH');
ok(
  '옛 CENTRAL away 분기 제거',
  !/score === 0 \? 1/.test(batchSrc) &&
    !/targetScoreAtBatch/.test(batchSrc) &&
    !/-away \*/.test(batchSrc)
);
ok('simulation delegates computeSignedDelta', /batchCore\.computeSignedDelta/.test(simSrc));
ok('persist service는 mock sim 파일을 쓰지 않음', !/political-orientation-simulation/.test(svcSrc));
ok(
  'public score-write route 없음',
  !/apply_alignment_score_batch/.test(read('server.js')) &&
    !/political-alignment-persist/.test(read('server.js'))
);
ok(
  'localStorage 미사용',
  !/localStorage/.test(svcSrc) && !/sc_political_scores/.test(svcSrc)
);
ok(
  'auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff)
);
ok('RPC는 next_score를 plan에서 읽지 않음', !/plan->>'nextScore'/.test(sql) && !/plan->>'score'/.test(sql));
ok('RPC combinedSignal만 수신', /v_combined := \(v_rec->>'combinedSignal'\)::numeric/.test(sql));
ok('RPC FOR UPDATE', /FOR UPDATE/.test(sql));
ok('RPC ON CONFLICT DO NOTHING batch', /ON CONFLICT \(batch_id\) DO NOTHING/.test(sql));
ok('RPC client score forbidden', /ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN/.test(sql));
ok('GRANT service_role only', /GRANT EXECUTE ON FUNCTION public\.apply_alignment_score_batch/.test(sql) && /REVOKE ALL ON FUNCTION public\.apply_alignment_score_batch/.test(sql));
ok('DROP TABLE/TRUNCATE/DELETE FROM 없음', !/\bTRUNCATE\b/.test(sql.replace(/--[^\n]*/g, '')) && !/\bDROP TABLE\b/.test(sql) && !/\bDELETE FROM\b/.test(sql));
ok('옛 persist_alignment_batch_plan 미포함', !/persist_alignment_batch_plan/.test(sql));
ok('옛 migration은 JS 점수 저장(비채택)', /persist_alignment_batch_plan/.test(oldMig) && /v_alignment->>'score'/.test(oldMig));
ok('초기값 DEFAULT 0', /score numeric\(20, 6\) NOT NULL DEFAULT 0/.test(sql) && /previous_signal numeric\(20, 6\) NOT NULL DEFAULT 0/.test(sql));
ok('pending_territory 컬럼 없음 (이번 persistence)', !/pending_territory/.test(sql));

section('CENTRAL 6 signed (SSOT · score 무관)');
ok('CENTRAL→PIONEER LIKE +100', signed('CENTRAL', 'PIONEER', 'LIKE') === 100);
ok('CENTRAL→PIONEER DISLIKE -100', signed('CENTRAL', 'PIONEER', 'DISLIKE') === -100);
ok('CENTRAL→GUARDIAN LIKE -100', signed('CENTRAL', 'GUARDIAN', 'LIKE') === -100);
ok('CENTRAL→GUARDIAN DISLIKE +100', signed('CENTRAL', 'GUARDIAN', 'DISLIKE') === 100);
ok('CENTRAL→CENTRAL LIKE 0', signed('CENTRAL', 'CENTRAL', 'LIKE') === 0);
ok('CENTRAL→CENTRAL DISLIKE 0', signed('CENTRAL', 'CENTRAL', 'DISLIKE') === 0);
ok(
  'score 인자는 더 이상 없음 · Pioneer/Guardian 유지',
  batchCore.computeSignedDelta.length === 1 &&
    signed('PIONEER', 'PIONEER', 'LIKE') === 70 &&
    signed('GUARDIAN', 'GUARDIAN', 'LIKE') === -70
);
ok(
  '옛 CODE_ONLY away 결과가 write SSOT에서 안 나옴',
  signed('CENTRAL', 'CENTRAL', 'LIKE') === 0 &&
    signed('CENTRAL', 'PIONEER', 'LIKE') === 100
);

section('persist math · previousSignal ≠ score');
(function () {
  var a = persistCore.applyScoreStep({ score: 0, previousSignal: 0 }, 200);
  ok('Batch1 first score +200, prevSignal 200', a.ok && a.nextScore === 200 && a.nextSignal === 200 && a.rawDelta === 200);
  var b = persistCore.applyScoreStep({ score: 200, previousSignal: 200 }, 260);
  ok('Batch2 delta +60, score 260, prev 260', b.ok && b.nextScore === 260 && b.rawDelta === 60 && b.nextSignal === 260);
  var c = persistCore.applyScoreStep({ score: 260, previousSignal: 260 }, -500);
  ok(
    'Batch3 raw -760 cap -500 → score 260-500=-240, prev -500',
    c.ok && c.rawDelta === -760 && c.cappedDelta === -500 && c.nextScore === -240 && c.nextSignal === -500
  );
  var capP = persistCore.applyScoreStep({ score: 0, previousSignal: 0 }, 720);
  ok('+500 cap', capP.cappedDelta === 500 && capP.nextScore === 500 && capP.capApplied);
  var capN = persistCore.applyScoreStep({ score: 0, previousSignal: 0 }, -640);
  ok('-500 cap', capN.cappedDelta === -500 && capN.nextScore === -500);
})();

section('memory store idempotency / atomic / concurrent');
(async function () {
  const store = persistSvc.createMemoryAlignmentStore();
  const u = uid(2);
  const plan1 = {
    batchId: 'alignment-test-b1',
    processedAt: '2026-08-15T08:00:00.000Z',
    users: [{ userId: u, combinedSignal: 200 }],
  };
  const r1 = await store.applyPlan(plan1);
  ok('first batch APPLIED score 200', r1.committed && store.getState(u).score === 200 && store.getState(u).previousSignal === 200);

  const r1b = await store.applyPlan(plan1);
  ok('duplicate ALREADY_APPLIED', r1b.skipped && r1b.skipReason === 'ALREADY_APPLIED' && store.getState(u).score === 200);

  const r2 = await store.applyPlan({
    batchId: 'alignment-test-b2',
    processedAt: '2026-08-15T20:00:00.000Z',
    users: [{ userId: u, combinedSignal: 260 }],
  });
  ok('next batch +60', r2.committed && store.getState(u).score === 260 && store.getState(u).previousSignal === 260);

  const r3 = await store.applyPlan({
    batchId: 'alignment-test-b3',
    processedAt: '2026-08-16T08:00:00.000Z',
    users: [{ userId: u, combinedSignal: -500 }],
  });
  ok('cap batch score -240 prev -500', r3.committed && store.getState(u).score === -240 && store.getState(u).previousSignal === -500);

  const storeC = persistSvc.createMemoryAlignmentStore();
  const planC = {
    batchId: 'alignment-test-conc',
    processedAt: '2026-08-15T08:00:00.000Z',
    users: [{ userId: uid(3), combinedSignal: 80 }],
  };
  const pair = await Promise.all([storeC.applyPlan(planC), storeC.applyPlan(planC)]);
  const committed = pair.filter(function (p) { return p.committed; }).length;
  const skipped = pair.filter(function (p) { return p.skipped; }).length;
  ok('concurrent same batch 1 applied 1 skipped', committed === 1 && skipped === 1 && storeC.getState(uid(3)).score === 80);

  const storeF = persistSvc.createMemoryAlignmentStore();
  await storeF.applyPlan({
    batchId: 'alignment-test-ok',
    processedAt: '2026-08-15T08:00:00.000Z',
    users: [{ userId: uid(4), combinedSignal: 80 }],
  });
  let threw = false;
  try {
    await storeF.applyPlan({
      batchId: 'alignment-test-fail',
      processedAt: '2026-08-15T09:00:00.000Z',
      users: [
        { userId: uid(4), combinedSignal: 160 },
        { userId: null, combinedSignal: 1 },
      ],
    });
  } catch (e) {
    threw = true;
  }
  ok(
    'failure atomic rollback',
    threw &&
      storeF.getState(uid(4)).score === 80 &&
      storeF.getState(uid(4)).previousSignal === 80 &&
      !storeF.hasBatch('alignment-test-fail')
  );

  let forbid = false;
  try {
    await store.applyPlan({
      batchId: 'alignment-test-client-score',
      processedAt: '2026-08-15T10:00:00.000Z',
      users: [{ userId: u, combinedSignal: 0, nextScore: 999 }],
    });
  } catch (e) {
    forbid = e.code === 'ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN';
  }
  ok('client nextScore 거부', forbid);
})()
  .then(function () {
    section('cancelled reaction → combined 변화');
    const AS_OF1 = new Date('2026-08-15T12:00:00.000Z');
    function row(partial) {
      const base = {
        id: uid(500),
        actor_user_id: uid(1),
        target_author_user_id: uid(2),
        reaction_type: 'LIKE',
        actor_territory_at_reaction: 'PIONEER',
        target_author_territory_at_reaction: 'GUARDIAN',
        created_at: new Date(AS_OF1.getTime() - 5 * 86400000).toISOString(),
        cancelled_at: null,
        audience_scope: 'EARTH',
        target_type: 'POST',
        post_id: uid(9),
      };
      Object.keys(partial || {}).forEach(function (k) {
        base[k] = partial[k];
      });
      return base;
    }
    const s1 = simCore.simulateAlignmentBatch({ asOf: AS_OF1, rows: [row({ id: uid(501) })] });
    const author = (s1.users || []).filter(function (u) { return u.userId === uid(2); })[0];
    ok('active LIKE combined +120', author && author.combinedSignal === 120);
    const s2 = simCore.simulateAlignmentBatch({
      asOf: AS_OF1,
      rows: [row({ id: uid(501), cancelled_at: AS_OF1.toISOString() })],
    });
    ok('cancelled 제외 combined 없음', s2.userCount === 0);
    const step = persistCore.applyScoreStep({ score: 120, previousSignal: 120 }, 0);
    ok('다음 batch에 취소가 previousSignal 차이로 반영 -120', step.nextScore === 0 && step.rawDelta === -120);

    section('ALIEN 제외');
    const alien = simCore.simulateAlignmentBatch({
      asOf: AS_OF1,
      rows: [
        row({
          id: uid(502),
          actor_territory_at_reaction: 'ALIEN',
          target_author_territory_at_reaction: 'PIONEER',
        }),
      ],
    });
    ok('ALIEN actor persist 대상 아님', alien.eligibleReactionCount === 0);

    section('service dry-run vs apply (memory)');
    return persistSvc
      .runPoliticalAlignmentBatch({
        apply: false,
        batchId: 'alignment-dry',
        asOf: AS_OF1,
        simulation: s1,
      })
      .then(function (dry) {
        ok('dry-run scoreWrite false', dry.scoreWrite === false && dry.applyAttempted === false);
        const mem = persistSvc.createMemoryAlignmentStore();
        return persistSvc
          .runPoliticalAlignmentBatch({
            apply: true,
            batchId: 'alignment-mem-apply',
            asOf: AS_OF1,
            simulation: s1,
            store: mem,
          })
          .then(function (applied) {
            ok('memory apply committed', applied.scoreWrite === true && applied.rpc.committed === true);
            ok('memory apply first score 120', mem.getState(uid(2)).score === 120);
            return persistSvc.runPoliticalAlignmentBatch({
              apply: true,
              batchId: 'alignment-mem-apply',
              asOf: AS_OF1,
              simulation: s1,
              store: mem,
            });
          })
          .then(function (dup) {
            ok('memory apply retry ALREADY_APPLIED', dup.rpc.skipped === true && mem.getState(uid(2)).score === 120);
          });
      });
  })
  .then(function () {
    console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
    return teardown.finishTest(fail);
  })
  .catch(function (e) {
    ok('async', false, String(e && e.message));
    console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
    return teardown.finishTest(fail || 1);
  });
