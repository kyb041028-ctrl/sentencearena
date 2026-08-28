'use strict';
/**
 * CENTRAL actor-self must move from score 0. Production vs simulation same input.
 * node tools/test-central-actor-self-alignment.js
 */

require('dotenv').config();

const beta = require('../shared/political-alignment-beta-v1-core');
const simCore = require('../shared/political-alignment-simulation-core');
const simPair = require('../shared/political-alignment-bidirectional-sim-core');
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

function self(actorTerr, targetTerr, type, actorScore) {
  return beta.computeActorSelfSigned({
    reactionType: type,
    actorTerritory: actorTerr,
    targetTerritory: targetTerr,
    actorAlignmentScoreAtReaction: actorScore,
    targetAlignmentScoreAtReaction: targetTerr === 'PIONEER' ? 420 : targetTerr === 'GUARDIAN' ? -420 : 0,
  });
}

function author(actorTerr, targetTerr, type, actorScore) {
  return beta.computeAuthorReceivedSigned({
    reactionType: type,
    actorTerritory: actorTerr,
    targetTerritory: targetTerr,
    actorAlignmentScoreAtReaction: actorScore,
    targetAlignmentScoreAtReaction: targetTerr === 'PIONEER' ? 420 : targetTerr === 'GUARDIAN' ? -420 : 0,
  });
}

function row(partial) {
  var base = {
    id: uid(100),
    actor_user_id: uid(1),
    target_author_user_id: uid(2),
    reaction_type: 'LIKE',
    actor_territory_at_reaction: 'CENTRAL',
    target_author_territory_at_reaction: 'GUARDIAN',
    actor_alignment_score_at_reaction: 0,
    target_author_alignment_score_at_reaction: -420,
    created_at: daysAgo(1),
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

console.log('[central actor-self]');

var gLike = self('CENTRAL', 'GUARDIAN', 'LIKE', 0);
ok(
  '1 CENTRAL score 0 LIKE GUARDIAN → actor GUARDIAN dir',
  gLike.signed < 0 && gLike.signed === -25,
  JSON.stringify(gLike)
);

var pLike = self('CENTRAL', 'PIONEER', 'LIKE', 0);
ok(
  '2 CENTRAL score 0 LIKE PIONEER → actor PIONEER dir',
  pLike.signed > 0 && pLike.signed === 25,
  JSON.stringify(pLike)
);

(function () {
  var rows = [];
  var i;
  for (i = 0; i < 3; i++) {
    rows.push(
      row({
        id: uid(200 + i),
        target_author_user_id: uid(20 + i),
        target_author_territory_at_reaction: 'GUARDIAN',
        reaction_type: 'LIKE',
        actor_alignment_score_at_reaction: 0,
        created_at: daysAgo(2 + i),
      })
    );
  }
  var actor = userById(simCore.simulateAlignmentBatch({ asOf: AS_OF, rows: rows }), uid(1));
  ok('3 CENTRAL one-way self reactions accumulate', actor && actor.rawDelta === -75, actor && String(actor.rawDelta));
})();

var pDislike = self('CENTRAL', 'PIONEER', 'DISLIKE', 0);
ok('4 CENTRAL DISLIKE PIONEER → GUARDIAN dir', pDislike.signed < 0 && pDislike.signed === -25, JSON.stringify(pDislike));
var gDislike = self('CENTRAL', 'GUARDIAN', 'DISLIKE', 0);
ok('4b CENTRAL DISLIKE GUARDIAN → PIONEER dir', gDislike.signed > 0 && gDislike.signed === 25, JSON.stringify(gDislike));

ok(
  '5 PIONEER actor self unchanged',
  self('PIONEER', 'PIONEER', 'LIKE', 420).signed === 17.5 &&
    self('PIONEER', 'GUARDIAN', 'LIKE', 420).signed === -32.5
);
ok(
  '6 GUARDIAN actor self unchanged',
  self('GUARDIAN', 'GUARDIAN', 'LIKE', -420).signed === -17.5 &&
    self('GUARDIAN', 'PIONEER', 'LIKE', -420).signed === 32.5
);

ok(
  '7 author-received CENTRAL score 0 still 0 (gradual author inject unchanged)',
  author('CENTRAL', 'GUARDIAN', 'LIKE', 0).signed === 0 &&
    author('CENTRAL', 'PIONEER', 'LIKE', 0).signed === 0 &&
    author('CENTRAL', 'GUARDIAN', 'LIKE', 0).reason === 'ACTOR_STRENGTH_ZERO'
);
ok('7b PIONEER author-received LIKE same faction 70', author('PIONEER', 'PIONEER', 'LIKE', 420).signed === 70);
ok('7c GUARDIAN LIKE PIONEER author -130', author('GUARDIAN', 'PIONEER', 'LIKE', -420).signed === -130);

ok('8 reactor ratio 0.25', beta.POLICIES.ACTOR_SELF_RATIO === 0.25 && Math.abs(gLike.signed) === 100 * 0.25);
ok('8b PIONEER 25% of 70', self('PIONEER', 'PIONEER', 'LIKE', 420).signed === 70 * 0.25);

(function () {
  var rows = [];
  var i;
  for (i = 0; i < 8; i++) {
    rows.push(
      row({
        id: uid(300 + i),
        target_author_user_id: uid(40 + i),
        target_author_territory_at_reaction: 'GUARDIAN',
        reaction_type: 'LIKE',
        actor_alignment_score_at_reaction: 0,
        created_at: daysAgo(1),
      })
    );
  }
  var actor = userById(simCore.simulateAlignmentBatch({ asOf: AS_OF, rows: rows }), uid(1));
  ok('9 actor daily ±60', actor && actor.rawDelta === -60, actor && String(actor.rawDelta));
})();

(function () {
  var rows = [];
  var i;
  for (i = 0; i < 4; i++) {
    rows.push(
      row({
        id: uid(400 + i),
        actor_user_id: uid(50 + i),
        target_author_user_id: uid(2),
        actor_territory_at_reaction: 'PIONEER',
        target_author_territory_at_reaction: 'GUARDIAN',
        actor_alignment_score_at_reaction: 420,
        reaction_type: 'LIKE',
        created_at: daysAgo(1),
      })
    );
  }
  var authorUser = userById(simCore.simulateAlignmentBatch({ asOf: AS_OF, rows: rows }), uid(2));
  ok('10 community daily ±240', authorUser && authorUser.rawDelta === 240, authorUser && String(authorUser.rawDelta));
})();

(function () {
  var rows = [
    row({
      id: uid(500),
      cancelled_at: daysAgo(1),
      created_at: daysAgo(2),
    }),
  ];
  var actor = userById(simCore.simulateAlignmentBatch({ asOf: AS_OF, rows: rows }), uid(1));
  ok(
    '11 cancelled reaction excluded',
    (!actor || actor.rawDelta === 0 || actor.rawDelta == null) &&
      simCore.simulateAlignmentBatch({ asOf: AS_OF, rows: rows }).eligibleReactionCount === 0
  );
})();

ok(
  '12 self-post self-reaction 0',
  beta.computeActorSelfSigned({
    reactionType: 'LIKE',
    actorTerritory: 'CENTRAL',
    targetTerritory: 'GUARDIAN',
    actorAlignmentScoreAtReaction: 0,
    selfReaction: true,
  }).signed === 0
);

ok(
  '13 Alien excluded',
  self('ALIEN', 'GUARDIAN', 'LIKE', 0).signed === 0 &&
    self('CENTRAL', 'ALIEN', 'LIKE', 0).signed === 0 &&
    self('KANTAPBIYA', 'PIONEER', 'LIKE', 0).signed === 0
);

ok(
  'near-central score 40 LIKE GUARDIAN still moves',
  self('CENTRAL', 'GUARDIAN', 'LIKE', 40).signed === -25
);
ok(
  'CENTRAL→CENTRAL LIKE still 0',
  self('CENTRAL', 'CENTRAL', 'LIKE', 0).signed === 0
);
ok(
  'CENTRAL target DISLIKE still 0',
  self('CENTRAL', 'CENTRAL', 'DISLIKE', 0).signed === 0 &&
    self('PIONEER', 'CENTRAL', 'DISLIKE', 200).signed === 0
);

var prodFn = self('CENTRAL', 'GUARDIAN', 'LIKE', 0);
var simFn = simPair.computeProductionPair({
  isLike: true,
  reactorTerritory: 'CENTRAL',
  authorTerritory: 'GUARDIAN',
  reactorScore: 0,
  authorScore: -420,
});
ok(
  'Production vs sim same input same actor-self',
  prodFn.signed === simFn.actorSelf.signed && simFn.actorSelf.signed === -25
);
ok(
  'Production vs sim same author-received',
  author('CENTRAL', 'GUARDIAN', 'LIKE', 0).signed === simFn.authorRecv.signed &&
    simFn.authorRecv.signed === 0
);

ok('accel not required for first CENTRAL move', gLike.signed === -25 && beta.accelerationMultiplier(0) === 1);

console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
teardown.finishTest(fail);
