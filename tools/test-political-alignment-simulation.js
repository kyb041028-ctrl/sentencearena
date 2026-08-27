'use strict';
/**
 * 정치성향 read-only simulation (점수 DB 미기록)
 * node tools/test-political-alignment-simulation.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const inputCore = require('../shared/political-reaction-input-core');
const simCore = require('../shared/political-alignment-simulation-core');
const inputSvc = require('../server/political-reaction-input-service');
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

const AS_OF = new Date('2026-08-15T12:00:00.000Z');

function daysAgo(days) {
  return new Date(AS_OF.getTime() - days * 86400000).toISOString();
}

function row(partial) {
  var base = {
    id: uid(100),
    actor_user_id: uid(1),
    target_author_user_id: uid(2),
    reaction_type: 'LIKE',
    actor_territory_at_reaction: 'PIONEER',
    target_author_territory_at_reaction: 'PIONEER',
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
  return simCore.simulateAlignmentBatch(
    Object.assign({ asOf: AS_OF, rows: rows }, extra || {})
  );
}

function userById(result, id) {
  var i;
  var list = result.users || [];
  for (i = 0; i < list.length; i++) {
    if (list[i].userId === id) return list[i];
  }
  return null;
}

function firstUser(result) {
  return userById(result, uid(2)) || result.users[0] || null;
}

function expectRaw(label, partial, expected) {
  var u = firstUser(sim([row(Object.assign({ id: uid(800 + pass + fail) }, partial))]));
  ok(label, u && u.rawDelta === expected && u.signedStatus === 'CONFIRMED', u ? 'got ' + u.rawDelta : 'no user');
}

const coreSrc = read('shared/political-alignment-simulation-core.js');
const svcSrc = read('server/political-alignment-simulation-service.js');
const indexHtml = read('public/index.html');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

section('정책 가드');
ok('input LIKE → POSITIVE 유지', inputCore.mapPolarity('LIKE') === 'POSITIVE');
ok('WINDOW_COMBINATION_POLICY = CONFIRMED', simCore.WINDOW_COMBINATION_POLICY === 'CONFIRMED');
ok('CENTRAL_SIGN_POLICY = CONFIRMED', simCore.CENTRAL_SIGN_POLICY === 'CONFIRMED');
ok('POLITICAL_SIMULATION = ACTIVE_READ_ONLY', simCore.POLITICAL_SIMULATION === 'ACTIVE_READ_ONLY');
ok('POLITICAL_SCORE_WRITE = NOT_CONNECTED', simCore.POLITICAL_SCORE_WRITE === 'NOT_CONNECTED');
ok('TERRITORY_MOVE = NOT_CONNECTED', simCore.TERRITORY_MOVE === 'NOT_CONNECTED');
ok('scheduler READY_DISABLED', simCore.POLITICAL_BATCH_SCHEDULER === 'READY_DISABLED');
ok(
  'CODE_ONLY / POLICY_UNCONFIRMED 제거',
  !/CODE_ONLY/.test(coreSrc) &&
    !/POLICY_UNCONFIRMED/.test(coreSrc) &&
    !/PARTIAL_CENTRAL_SKIPPED/.test(coreSrc)
);
ok(
  '옛 CENTRAL score-부호 분기는 batch-core에서 제거',
  !/score === 0 \? 1/.test(read('shared/alignment-batch-core.js')) &&
    !/targetScoreAtBatch/.test(read('shared/alignment-batch-core.js'))
);
ok(
  'simulation signed SSOT = batch-core.computeSignedDelta',
  /batchCore\.computeSignedDelta/.test(coreSrc) &&
    typeof require('../shared/alignment-batch-core').computeSignedDelta === 'function'
);
ok(
  '50/50은 SUM 가중합',
  /SUM99 \* rollingWindowRatio \+ SUM30 \* recentWindowRatio/.test(coreSrc)
);
ok(
  'service 쓰기 메서드 없음',
  !/\.insert\s*\(/.test(svcSrc) &&
    !/\.update\s*\(/.test(svcSrc) &&
    !/\.upsert\s*\(/.test(svcSrc) &&
    !/\.delete\s*\(/.test(svcSrc) &&
    !/persistBatchPlan/.test(svcSrc) &&
    !/processAlignmentUserBatch/.test(svcSrc) &&
    !/processAlignmentBatch/.test(svcSrc)
);
ok(
  'alignment_state SELECT만',
  /\.from\('user_alignment_state'\)/.test(svcSrc) &&
    /select\('user_id, score, previous_signal'\)/.test(svcSrc)
);
ok(
  'localStorage 미사용',
  !/localStorage/.test(coreSrc) && !/localStorage/.test(svcSrc) && !/sc_political_scores/.test(coreSrc)
);
ok(
  'Guest applyReactionScoresWithMult 유지',
  /function applyReactionScoresWithMult/.test(indexHtml) && /LEGACY_LOCAL: Guest\/demo/.test(indexHtml)
);
ok(
  'auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff)
);
ok('신규 CREATE TABLE 없음', !/CREATE TABLE/.test(coreSrc) && !/CREATE TABLE/.test(svcSrc));
ok(
  '영토 이동 평가 없음',
  /territoryMoveEvaluated: false/.test(coreSrc) && !/evaluatePoliticalTerritoryTransition/.test(coreSrc)
);

section('1-4 PIONEER actor');
expectRaw('1 PIONEER same positive = +70', {
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'LIKE',
}, 70);
expectRaw('2 PIONEER other positive = +130 pair-capped 120', {
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'LIKE',
}, 120);
expectRaw('3 PIONEER same negative = -130 pair-capped 120', {
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'DISLIKE',
}, -120);
expectRaw('4 PIONEER other negative = -70', {
  actor_territory_at_reaction: 'PIONEER',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'DISLIKE',
}, -70);

section('5-8 GUARDIAN actor');
expectRaw('5 GUARDIAN same positive = -70', {
  actor_territory_at_reaction: 'GUARDIAN',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'LIKE',
}, -70);
expectRaw('6 GUARDIAN other positive = -130 pair-capped 120', {
  actor_territory_at_reaction: 'GUARDIAN',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'LIKE',
}, -120);
expectRaw('7 GUARDIAN same negative = +130 pair-capped 120', {
  actor_territory_at_reaction: 'GUARDIAN',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'DISLIKE',
}, 120);
expectRaw('8 GUARDIAN other negative = +70', {
  actor_territory_at_reaction: 'GUARDIAN',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'DISLIKE',
}, 70);

section('9-14 CENTRAL actor (대상 영토 기준 · score 무관)');
expectRaw('9 CENTRAL→PIONEER positive = +100', {
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'LIKE',
}, 100);
expectRaw('10 CENTRAL→PIONEER negative = -100', {
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'PIONEER',
  reaction_type: 'DISLIKE',
}, -100);
expectRaw('11 CENTRAL→GUARDIAN positive = -100', {
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'LIKE',
}, -100);
expectRaw('12 CENTRAL→GUARDIAN negative = +100', {
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'GUARDIAN',
  reaction_type: 'DISLIKE',
}, 100);
expectRaw('13 CENTRAL→CENTRAL positive = 0', {
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'CENTRAL',
  reaction_type: 'LIKE',
}, 0);
expectRaw('14 CENTRAL→CENTRAL negative = 0', {
  actor_territory_at_reaction: 'CENTRAL',
  target_author_territory_at_reaction: 'CENTRAL',
  reaction_type: 'DISLIKE',
}, 0);

(function () {
  var u = firstUser(
    sim([
      row({
        id: uid(250),
        actor_territory_at_reaction: 'CENTRAL',
        target_author_territory_at_reaction: 'CENTRAL',
        reaction_type: 'LIKE',
      }),
    ])
  );
  ok(
    'CENTRAL→CENTRAL 건수 유지 · unsigned 70 · signed 0',
    u &&
      u.eligibleReactionCount === 1 &&
      u.unsignedMagnitude99 === 70 &&
      u.weighted99 === 0 &&
      u.rawDelta === 0 &&
      u.cappedDelta === 0
  );
})();

(function () {
  var scores = [0, 500, -500];
  var i;
  var all = true;
  for (i = 0; i < scores.length; i++) {
    var map = {};
    map[uid(2)] = scores[i];
    var u = firstUser(
      sim(
        [
          row({
            id: uid(260 + i),
            actor_territory_at_reaction: 'CENTRAL',
            target_author_territory_at_reaction: 'PIONEER',
            reaction_type: 'LIKE',
          }),
        ],
        { currentScoreByUser: map }
      )
    );
    if (!(u && u.rawDelta === 100 && u.currentScore === scores[i] && u.simulatedNextScore === scores[i] + 100)) {
      all = false;
    }
  }
  ok('CENTRAL 부호는 currentScore 0/+500/−500과 무관 (+100)', all);
})();

section('15-20 window / cancelled / ALIEN');
(function () {
  var u = firstUser(sim([row({ id: uid(270), created_at: daysAgo(10) })]));
  ok('15 30일 이내: 99와 30 모두 1', u && u.reactionCount99 === 1 && u.reactionCount30 === 1 && u.rawDelta === 70);
})();
(function () {
  var u = firstUser(sim([row({ id: uid(271), created_at: daysAgo(50) })]));
  ok(
    '16 30~99일: w99=70 w30=0 combined=35',
    u && u.reactionCount99 === 1 && u.reactionCount30 === 0 && u.weighted99 === 70 && u.weighted30 === 0 && u.rawDelta === 35
  );
})();
(function () {
  var r = sim([row({ id: uid(272), created_at: daysAgo(100) })]);
  ok('17 99일 밖 제외', r.eligibleReactionCount === 0 && r.excludeReasons.OUTSIDE_99D === 1);
})();
(function () {
  var r = sim([row({ id: uid(273), cancelled_at: daysAgo(1) })]);
  ok('18 cancelled 제외', r.eligibleReactionCount === 0 && r.excludeReasons.INACTIVE === 1);
})();
(function () {
  var r = sim([
    row({ id: uid(274), actor_territory_at_reaction: 'ALIEN', target_author_territory_at_reaction: 'PIONEER' }),
  ]);
  ok('19 ALIEN actor 제외', r.eligibleReactionCount === 0 && r.excludeReasons.ALIEN_TERRITORY === 1);
})();
(function () {
  var r = sim([
    row({ id: uid(275), actor_territory_at_reaction: 'PIONEER', target_author_territory_at_reaction: 'ALIEN' }),
  ]);
  ok('20 ALIEN target 제외', r.eligibleReactionCount === 0 && r.excludeReasons.ALIEN_TERRITORY === 1);
})();
(function () {
  var exact99 = sim([row({ id: uid(276), created_at: daysAgo(99) })]);
  var exact30 = firstUser(sim([row({ id: uid(277), created_at: daysAgo(30) })]));
  ok('99일 경계 포함', exact99.eligibleReactionCount === 1);
  ok('30일 경계 포함', exact30 && exact30.reactionCount30 === 1);
})();

section('21-24 cap / mixed / deterministic');
(function () {
  var rows = [];
  var i;
  for (i = 0; i < 5; i++) {
    rows.push(
      row({
        id: uid(300 + i),
        actor_user_id: uid(10 + i),
        actor_territory_at_reaction: 'PIONEER',
        target_author_territory_at_reaction: 'GUARDIAN',
        reaction_type: 'LIKE',
        created_at: daysAgo(1 + i),
      })
    );
  }
  var u = firstUser(sim(rows));
  ok('21 raw +600 → capped +500', u && u.rawDelta === 600 && u.cappedDelta === 500 && u.capApplied === true);
})();
(function () {
  var rows = [];
  var i;
  for (i = 0; i < 5; i++) {
    rows.push(
      row({
        id: uid(400 + i),
        actor_user_id: uid(20 + i),
        actor_territory_at_reaction: 'PIONEER',
        target_author_territory_at_reaction: 'PIONEER',
        reaction_type: 'DISLIKE',
        created_at: daysAgo(1 + i),
      })
    );
  }
  var u = firstUser(sim(rows));
  ok('22 raw -600 → capped -500', u && u.rawDelta === -600 && u.cappedDelta === -500 && u.capApplied === true);
})();
(function () {
  var u = firstUser(
    sim([
      row({
        id: uid(410),
        actor_territory_at_reaction: 'PIONEER',
        target_author_territory_at_reaction: 'PIONEER',
        reaction_type: 'LIKE',
      }),
      row({
        id: uid(411),
        actor_user_id: uid(9),
        actor_territory_at_reaction: 'CENTRAL',
        target_author_territory_at_reaction: 'PIONEER',
        reaction_type: 'LIKE',
      }),
      row({
        id: uid(412),
        actor_user_id: uid(8),
        actor_territory_at_reaction: 'CENTRAL',
        target_author_territory_at_reaction: 'CENTRAL',
        target_author_user_id: uid(2),
        reaction_type: 'LIKE',
      }),
    ])
  );
  ok('23 mixed +70 +100 +0 = +170', u && u.eligibleReactionCount === 3 && u.rawDelta === 170);
})();
(function () {
  var a = sim([row({ id: uid(420) })]);
  var b = sim([row({ id: uid(420) })]);
  ok('24 deterministic same asOf', JSON.stringify(a.users) === JSON.stringify(b.users) && a.asOf === AS_OF.toISOString() && a.users[0].rawDelta === 17.5);
})();

section('previousSignal ≠ currentScore');
(function () {
  var prev = {};
  var cur = {};
  prev[uid(2)] = 10;
  cur[uid(2)] = 100;
  var u = firstUser(sim([row({ id: uid(430) })], { previousByUser: prev, currentScoreByUser: cur }));
  ok(
    'rawDelta = combined - previousSignal (70-10), next = current+capped',
    u && u.previousSignal === 10 && u.currentScore === 100 && u.rawDelta === 60 && u.simulatedNextScore === 160
  );
})();
(function () {
  var u = firstUser(sim([row({ id: uid(431) })]));
  ok('currentScore 없으면 nextScore 없음 · previousSignal 기본 0', u && u.currentScore === null && u.simulatedNextScore === null && u.previousSignal === 0 && u.rawDelta === 70);
})();

section('signed helper');
(function () {
  ok(
    'helper CENTRAL→PIONEER LIKE +100',
    simCore.confirmedSignedWeight({ actorTerritory: 'CENTRAL', targetTerritory: 'PIONEER', polarity: 'POSITIVE', weight: 100 }).signed === 100
  );
  ok(
    'helper CENTRAL→CENTRAL LIKE 0',
    simCore.confirmedSignedWeight({ actorTerritory: 'CENTRAL', targetTerritory: 'CENTRAL', polarity: 'POSITIVE', weight: 80 }).signed === 0
  );
  ok(
    'helper PIONEER + / GUARDIAN − 유지',
    simCore.confirmedSignedWeight({ actorTerritory: 'PIONEER', targetTerritory: 'PIONEER', polarity: 'POSITIVE', weight: 70 }).signed === 70 &&
      simCore.confirmedSignedWeight({ actorTerritory: 'GUARDIAN', targetTerritory: 'GUARDIAN', polarity: 'POSITIVE', weight: 70 }).signed === -70
  );
})();

section('territory 미판정 · EMPATHY');
(function () {
  var u = firstUser(sim([row({ id: uid(440) })]));
  ok('territoryMoveEvaluated false', u && u.territoryMoveEvaluated === false);
})();
(function () {
  var r = sim([row({ id: uid(441), reaction_type: 'EMPATHY' }), row({ id: uid(442), reaction_type: 'REPORT' })]);
  ok('EMPATHY/REPORT 제외', r.eligibleReactionCount === 0 && r.excludeReasons.TYPE_EXCLUDED === 2);
})();

section('live dry-run (read-only · UUID 숨김)');
(async function () {
  try {
    const persist = require('../server/achievement-persist-service');
    persist.getAdminClient();
    const inputReport = await inputSvc.inspectCanonicalPoliticalReactions({ asOf: new Date() });
    ok('input live 유지', inputReport && inputReport.scoreWrite === false);

    const svc = require('../server/political-alignment-simulation-service');
    const first = await svc.simulateAlignmentBatch({ asOf: new Date() });
    const second = await svc.simulateAlignmentBatch({ asOf: first.asOf });
    ok('live scoreWrite false', first.scoreWrite === false);
    ok('live scheduler false', first.schedulerConnected === false);
    ok('live territory 미평가', first.territoryMoveEvaluated === false);
    ok('live UUID 숨김', Array.isArray(first.usersRedacted) && first.users === undefined);
    ok('repeat live 동일', JSON.stringify(first.usersRedacted) === JSON.stringify(second.usersRedacted));
    ok('policies CONFIRMED / ACTIVE_READ_ONLY', first.policies && first.policies.CENTRAL_SIGN_POLICY === 'CONFIRMED' && first.policies.POLITICAL_SIMULATION === 'ACTIVE_READ_ONLY');
    ok(
      'live signedStatus CONFIRMED only',
      first.usersRedacted.every(function (u) {
        return u.signedStatus === 'CONFIRMED' || u.eligibleReactionCount === 0;
      })
    );

    var centralSame = first.usersRedacted.filter(function (u) {
      return (
        u.centralActorCount === u.eligibleReactionCount &&
        u.eligibleReactionCount > 0 &&
        u.pioneerActorCount === 0 &&
        u.guardianActorCount === 0 &&
        u.sameTerritoryCount === u.eligibleReactionCount
      );
    });
    ok(
      'live CENTRAL→CENTRAL signed 0 (있으면)',
      centralSame.length === 0 ||
        centralSame.every(function (u) {
          return u.weighted99 === 0 && u.rawDelta === 0 && u.cappedDelta === 0 && u.unsignedMagnitude99 > 0;
        })
    );
    ok(
      'live currentScore 미적용이면 null',
      first.alignmentStateRead === true ||
        first.usersRedacted.every(function (u) {
          return u.currentScore === null && u.simulatedNextScore === null;
        })
    );

    console.log(
      JSON.stringify({
        dryRunSimulation: {
          userCount: first.userCount,
          eligibleReactionCount: first.eligibleReactionCount,
          excludedReactionCount: first.excludedReactionCount,
          excludeReasons: first.excludeReasons,
          polarityCount: first.polarityCount,
          centralSameTerritoryUsers: centralSame.length,
          alignmentStateRead: first.alignmentStateRead,
          alignmentStateError: first.alignmentStateError || null,
          users: first.usersRedacted.map(function (u) {
            return {
              userAlias: u.userAlias,
              eligibleReactionCount: u.eligibleReactionCount,
              reactionCount99: u.reactionCount99,
              reactionCount30: u.reactionCount30,
              positiveCount: u.positiveCount,
              negativeCount: u.negativeCount,
              sameTerritoryCount: u.sameTerritoryCount,
              otherTerritoryCount: u.otherTerritoryCount,
              unsignedMagnitude99: u.unsignedMagnitude99,
              unsignedMagnitude30: u.unsignedMagnitude30,
              weighted99: u.weighted99,
              weighted30: u.weighted30,
              rawDelta: u.rawDelta,
              cappedDelta: u.cappedDelta,
              signedStatus: u.signedStatus,
              currentScore: u.currentScore,
              simulatedNextScore: u.simulatedNextScore,
              centralActorCount: u.centralActorCount,
            };
          }),
        },
      })
    );
  } catch (e) {
    const code = e && e.code;
    ok('live skip or readable', code === 'ACHIEVEMENT_PERSIST_NOT_CONFIGURED', String(e && e.message));
  }

  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail);
})().catch(function (e) {
  ok('async', false, String(e && e.message));
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail || 1);
});
