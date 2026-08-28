'use strict';
/**
 * Bidirectional v2: 0.7/1.0/1.3 author, actor 25%, ±60, consistency accel.
 * node tools/test-political-alignment-bidirectional-v2.js
 */

require('dotenv').config();

const path = require('path');
const { execFileSync } = require('child_process');
const beta = require('../shared/political-alignment-beta-v1-core');
const batch = require('../shared/alignment-batch-core');
const simCore = require('../shared/political-alignment-simulation-core');
const persistSvc = require('../server/political-alignment-persist-service');
const teardown = require('./test-process-teardown');

const root = path.join(__dirname, '..');
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

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

const AS_OF = new Date('2026-08-15T12:00:00.000Z');

function daysAgo(days) {
  return new Date(AS_OF.getTime() - days * 86400000).toISOString();
}

function userById(result, id) {
  var list = result.users || [];
  var i;
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

function authorRecv(actorTerr, targetTerr, type) {
  return beta.computeAuthorReceivedSigned({
    reactionType: type,
    actorTerritory: actorTerr,
    targetTerritory: targetTerr,
    actorAlignmentScoreAtReaction: actorTerr === 'PIONEER' ? 420 : actorTerr === 'GUARDIAN' ? -420 : 0,
    targetAlignmentScoreAtReaction: targetTerr === 'PIONEER' ? 420 : targetTerr === 'GUARDIAN' ? -420 : 0,
  });
}

function actorSelf(actorTerr, targetTerr, type, actorScore) {
  return beta.computeActorSelfSigned({
    reactionType: type,
    actorTerritory: actorTerr,
    targetTerritory: targetTerr,
    actorAlignmentScoreAtReaction: actorScore != null ? actorScore : actorTerr === 'PIONEER' ? 420 : actorTerr === 'GUARDIAN' ? -420 : 0,
    targetAlignmentScoreAtReaction: targetTerr === 'PIONEER' ? 420 : targetTerr === 'GUARDIAN' ? -420 : 0,
  });
}

console.log('[bidirectional v2]');

ok('1 same-faction LIKE author 70', authorRecv('PIONEER', 'PIONEER', 'LIKE').signed === 70);
ok('2 same-faction DISLIKE author 130', authorRecv('PIONEER', 'PIONEER', 'DISLIKE').signed === -130);
ok('3 opponent LIKE author 130 guardian direction', authorRecv('GUARDIAN', 'PIONEER', 'LIKE').signed === -130);
ok('4 opponent DISLIKE author 70', authorRecv('GUARDIAN', 'PIONEER', 'DISLIKE').signed === 70);
ok(
  '5 central relation 100',
  authorRecv('PIONEER', 'CENTRAL', 'LIKE').signed === 100 &&
    authorRecv('GUARDIAN', 'CENTRAL', 'LIKE').signed === -100 &&
    beta.computeAuthorReceivedSigned({
      reactionType: 'LIKE',
      actorTerritory: 'CENTRAL',
      targetTerritory: 'PIONEER',
      actorAlignmentScoreAtReaction: null,
      targetAlignmentScoreAtReaction: 420,
    }).signed === 100
);
ok(
  '6 actor 25% of author unsigned',
  actorSelf('GUARDIAN', 'PIONEER', 'LIKE').signed === 32.5 &&
    actorSelf('PIONEER', 'PIONEER', 'LIKE').signed === 17.5
);

ok('guardian author symmetric LIKE 70', authorRecv('GUARDIAN', 'GUARDIAN', 'LIKE').signed === -70);
ok('guardian author same DISLIKE 130', authorRecv('GUARDIAN', 'GUARDIAN', 'DISLIKE').signed === 130);
ok('pioneer LIKE guardian author → author guardian dir', authorRecv('PIONEER', 'GUARDIAN', 'LIKE').signed === 130);
ok('forbid opponent LIKE as author own-faction boost', authorRecv('GUARDIAN', 'PIONEER', 'LIKE').signed < 0);

ok('central author pioneer LIKE +100', authorRecv('PIONEER', 'CENTRAL', 'LIKE').signed === 100);
ok('central author guardian LIKE -100', authorRecv('GUARDIAN', 'CENTRAL', 'LIKE').signed === -100);
ok('central-central 0', authorRecv('CENTRAL', 'CENTRAL', 'LIKE').signed === 0 && authorRecv('CENTRAL', 'CENTRAL', 'DISLIKE').signed === 0);

ok('actor LIKE toward pioneer', actorSelf('GUARDIAN', 'PIONEER', 'LIKE').signed > 0);
ok('actor DISLIKE away from pioneer', actorSelf('GUARDIAN', 'PIONEER', 'DISLIKE').signed < 0);
ok('12 central target DISLIKE actor self 0', actorSelf('GUARDIAN', 'CENTRAL', 'DISLIKE', -420).signed === 0);
ok(
  'central target LIKE pulls actor toward 0',
  actorSelf('PIONEER', 'CENTRAL', 'LIKE', 200).signed === -25
);
ok(
  'CENTRAL score 0 LIKE GUARDIAN actor-self -25',
  actorSelf('CENTRAL', 'GUARDIAN', 'LIKE', 0).signed === -25
);
ok(
  'CENTRAL score 0 LIKE PIONEER actor-self +25',
  actorSelf('CENTRAL', 'PIONEER', 'LIKE', 0).signed === 25
);
ok(
  'CENTRAL score 0 author-received still 0',
  authorRecv('CENTRAL', 'GUARDIAN', 'LIKE').signed === 0 &&
    authorRecv('CENTRAL', 'PIONEER', 'LIKE').signed === 0
);

(function () {
  var rows = [];
  var i;
  for (i = 0; i < 8; i++) {
    rows.push(row({
      id: uid(200 + i),
      actor_user_id: uid(1),
      target_author_user_id: uid(20 + i),
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'PIONEER',
      reaction_type: 'LIKE',
      created_at: daysAgo(1),
    }));
  }
  var actor = userById(sim(rows), uid(1));
  ok('7 actor daily +60 cap', actor && actor.rawDelta === 60);
})();

(function () {
  var rows = [];
  var i;
  for (i = 0; i < 8; i++) {
    rows.push(row({
      id: uid(220 + i),
      actor_user_id: uid(1),
      target_author_user_id: uid(40 + i),
      actor_territory_at_reaction: 'GUARDIAN',
      target_author_territory_at_reaction: 'PIONEER',
      reaction_type: 'DISLIKE',
      created_at: daysAgo(1),
    }));
  }
  var actor = userById(sim(rows), uid(1));
  ok('8 actor daily -60 cap', actor && actor.rawDelta === -60);
})();

(function () {
  var rows = [];
  var i;
  for (i = 0; i < 4; i++) {
    rows.push(row({
      id: uid(240 + i),
      actor_user_id: uid(50 + i),
      target_author_user_id: uid(2),
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'GUARDIAN',
      reaction_type: 'LIKE',
      created_at: daysAgo(1),
    }));
  }
  var author = userById(sim(rows), uid(2));
  ok('9 community daily ±240', author && author.rawDelta === 240);
})();

ok('10 3 directional → no streak', beta.classifySelfDirectionDay([10, 10, 10]).ok === false && beta.classifySelfDirectionDay([10, 10, 10]).reason === 'TOO_FEW');
ok('11 4 of 3 same = 75% consistent', beta.classifySelfDirectionDay([10, 10, 10, -1]).ok === true && beta.classifySelfDirectionDay([10, 10, 10, -1]).share === 0.75);
ok('12 10 of 6 = 60% not consistent', beta.classifySelfDirectionDay([1, 1, 1, 1, 1, 1, -1, -1, -1, -1]).ok === false);

ok('13 3-4d multiplier 1.1', beta.accelerationMultiplier(3) === 1.1 && beta.accelerationMultiplier(4) === 1.1);
ok('14 5-7d multiplier 1.2', beta.accelerationMultiplier(5) === 1.2 && beta.accelerationMultiplier(7) === 1.2);
ok('15 8d+ multiplier 1.3', beta.accelerationMultiplier(8) === 1.3 && beta.accelerationMultiplier(20) === 1.3 && beta.accelerationMultiplier(20) <= 1.3);

(function () {
  var s = beta.emptySelfDirectionState();
  var a = beta.applyCompletedSelfDirectionDay(s, 'd1', [1, 1, 1, 1]);
  ok('first consistent day streak 1', a.streak === 1 && a.direction === 'PIONEER');
  var b = beta.applyCompletedSelfDirectionDay(a, 'd2', [-1, -1, -1, -1]);
  ok('16 reverse direction resets streak to 1', b.streak === 1 && b.direction === 'GUARDIAN');
  var c = beta.applyCompletedSelfDirectionDay(b, 'd3', [1, 1, -1, -1]);
  ok('17 ambiguous day clears accel', c.streak === 0 && c.direction == null && c.reset === true);
})();

ok(
  '18 received-only does not create accel',
  beta.classifySelfDirectionDay([]).ok === false &&
    beta.applyActorSelfAcceleration(0, { streakDays: 8, currentTerritory: 'CENTRAL', score: 0 }).multiplier === 1
);

ok(
  '19 approach 120 from exit ends accel',
  beta.accelerationAllowed({ direction: 'PIONEER', currentTerritory: 'CENTRAL', score: 240 }) === false &&
    beta.accelerationAllowed({ direction: 'GUARDIAN', currentTerritory: 'CENTRAL', score: -240 }) === false
);
ok(
  '20 PIONEER +240 no accel',
  beta.applyActorSelfAcceleration(17.5, { streakDays: 8, currentTerritory: 'CENTRAL', score: 240 }).multiplier === 1
);
ok(
  '21 GUARDIAN -240 no accel',
  beta.applyActorSelfAcceleration(-17.5, { streakDays: 8, currentTerritory: 'CENTRAL', score: -240 }).multiplier === 1
);
ok(
  'pioneer +230 still allows 1.3',
  beta.applyActorSelfAcceleration(17.5, { streakDays: 8, currentTerritory: 'CENTRAL', score: 230 }).multiplier === 1.3
);

(function () {
  var ev = beta.evaluateTerritoryTransition({
    alignmentScore: 360,
    currentTerritory: 'CENTRAL',
    pendingTerritory: 'PIONEER',
    pendingTerritoryBatchCount: 1,
  }, '2026-08-15T08:00:00.000Z');
  ok('22 pole entry resets streak', ev.territoryChanged && ev.nextTerritory === 'PIONEER' && ev.resetSelfDirectionStreak === true);
})();

(function () {
  var ev = beta.evaluateTerritoryTransition({
    alignmentScore: 160,
    currentTerritory: 'PIONEER',
    pendingTerritory: 'CENTRAL',
    pendingTerritoryBatchCount: 1,
    lastTerritoryChangedAt: '2026-01-01T00:00:00.000Z',
  }, '2026-08-15T08:00:00.000Z');
  ok('23 central passage keeps streak flag off', ev.territoryChanged && ev.nextTerritory === 'CENTRAL' && !ev.resetSelfDirectionStreak);
})();

(function () {
  var r = sim([row({ id: uid(300), cancelled_at: daysAgo(1) })]);
  ok('24 cancelled excluded', r.eligibleReactionCount === 0 && r.excludeReasons.INACTIVE === 1);
})();

(function () {
  var r = sim([row({ id: uid(301), actor_user_id: uid(2), target_author_user_id: uid(2) })]);
  ok('25 self reaction excluded', r.eligibleReactionCount === 0 && r.excludeReasons.SELF_REACTION === 1);
})();

(function () {
  var r = sim([row({
    id: uid(302),
    actor_territory_at_reaction: 'ALIEN',
    target_author_territory_at_reaction: 'PIONEER',
  })]);
  ok('26 alien excluded', r.eligibleReactionCount === 0 && r.excludeReasons.ALIEN_TERRITORY === 1);
})();

ok('inside pioneer territory no accel', beta.accelerationAllowed({ direction: 'PIONEER', currentTerritory: 'PIONEER', score: 100 }) === false);
ok('zero signed excluded from 70% denom', beta.classifySelfDirectionDay([0, 0, 10, 10, 10, 10]).ok === true);

ok(
  'accel then ±60: 1.3 still caps 60',
  beta.applySignedDailyCap(0, beta.applyActorSelfAcceleration(80, { streakDays: 8, currentTerritory: 'CENTRAL', score: 0 }).signed, 60).nextSum === 60
);

ok('pair 7d still 120', beta.POLICIES.PAIR_ALIGNMENT_7D_CAP === 120);
ok('community 240', beta.POLICIES.COMMUNITY_ALIGNMENT_DAILY_CAP === 240);
ok('exit 360 return 160', beta.POLICIES.EXIT_ABS === 360 && beta.POLICIES.RETURN_ABS === 160);
ok('99/30 50/50', batch.getAlignmentBatchProcessorConfig().rollingWindowRatio === 0.5);
ok('scheduler READY_DISABLED', persistSvc.POLITICAL_BATCH_SCHEDULER === 'READY_DISABLED');
ok('actor 25% policy', beta.POLICIES.ACTOR_SELF_RATIO === 0.25 && beta.POLICIES.ACTOR_SELF_DAILY_CAP === 60);
ok('no backfill policy', beta.POLICIES.STREAK_NO_BACKFILL === true);
ok('weights 70/100/130', batch.relationMagnitude('PIONEER', 'PIONEER', true) === 70 && batch.relationMagnitude('PIONEER', 'GUARDIAN', true) === 130 && batch.relationMagnitude('PIONEER', 'CENTRAL', true) === 100);

(function () {
  var rows = [];
  var i;
  for (i = 0; i < 20; i++) {
    rows.push(row({
      id: uid(400 + i),
      actor_user_id: uid(80 + i),
      target_author_user_id: uid(2),
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'PIONEER',
      reaction_type: 'LIKE',
      created_at: daysAgo(2),
    }));
  }
  var author = userById(sim(rows), uid(2));
  ok('crowd 20 likes still apply (capped 240 not zeroed)', author && author.rawDelta === 240 && author.eligibleReactionCount === 20);
})();

(function () {
  var rows = [];
  var d;
  var k;
  for (d = 8; d >= 1; d--) {
    for (k = 0; k < 4; k++) {
      rows.push(row({
        id: uid(500 + d * 10 + k),
        actor_user_id: uid(1),
        target_author_user_id: uid(90 + d * 10 + k),
        actor_territory_at_reaction: 'CENTRAL',
        target_author_territory_at_reaction: 'GUARDIAN',
        actor_alignment_score_at_reaction: -80,
        target_author_alignment_score_at_reaction: -420,
        reaction_type: 'LIKE',
        created_at: daysAgo(d),
      }));
    }
  }
  var without = userById(sim(rows), uid(1));
  var withAccel = userById(sim(rows, { acceleration: { epochDay: '2000-01-01' } }), uid(1));
  ok('CENTRAL 4 likes/day hits actor ±60', without && without.rawDelta === -480);
  ok('epoch accel cannot exceed actor daily ±60', withAccel && withAccel.rawDelta === -480);
})();

const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
ok(
  'auth.js untouched',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) && !/(^|\n)public\/auth-v2\//.test(authDiff)
);

console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
teardown.finishTest(fail);
