#!/usr/bin/env node
/**
 * Formula checks for bidirectional alignment SIM only.
 * Does not touch production alignment code.
 */
'use strict';

const core = require('../shared/political-alignment-bidirectional-sim-core');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass += 1;
    console.log('PASS ' + name);
  } else {
    fail += 1;
    console.log('FAIL ' + name);
  }
}

const w = { expected: 0.8, mid: 1.0, unexpected: 1.2 };

const a1 = core.computeNewAuthorSigned(
  { authorTerritory: 'PIONEER', reactorTerritory: 'GUARDIAN', isLike: true, authorScore: 420 },
  w
);
ok('pioneer author + guardian LIKE → guardian dir +1.2 → axis -120', a1.dir === 'GUARDIAN' && a1.signed === -120);

const a2 = core.computeNewAuthorSigned(
  { authorTerritory: 'PIONEER', reactorTerritory: 'PIONEER', isLike: false, authorScore: 420 },
  w
);
ok('pioneer author + pioneer DISLIKE → pioneer -1.2 → axis -120', a2.dir === 'PIONEER' && a2.signed === -120);

const a3 = core.computeNewAuthorSigned(
  { authorTerritory: 'PIONEER', reactorTerritory: 'PIONEER', isLike: true, authorScore: 420 },
  w
);
ok('pioneer author + pioneer LIKE → +80 not +120', a3.signed === 80);

const wrong = core.computeNewAuthorSigned(
  { authorTerritory: 'PIONEER', reactorTerritory: 'GUARDIAN', isLike: true, authorScore: 420 },
  w
);
ok('forbid author-own-faction on opponent LIKE', wrong.dir !== 'PIONEER');

const r1 = core.computeNewReactorSigned(
  { authorTerritory: 'PIONEER', isLike: true, authorScore: 420, reactorScore: -420 },
  { absMagRatio: 1.2 },
  0.25
);
ok('guardian reactor LIKE pioneer author → reactor toward pioneer +30', r1.signed === 30);

const r2 = core.computeNewReactorSigned(
  { authorTerritory: 'PIONEER', isLike: false, authorScore: 420, reactorScore: -420 },
  { absMagRatio: 0.8 },
  0.25
);
ok('guardian reactor DISLIKE pioneer author → away from pioneer -20', r2.signed === -20);

const r3 = core.computeNewReactorSigned(
  { authorTerritory: 'CENTRAL', isLike: false, authorScore: 0, reactorScore: 0 },
  { absMagRatio: 1.2 },
  0.25,
  'ZERO'
);
ok('central DISLIKE with no lean → 0', r3.signed === 0);

const prod = core.computeProductionPair({
  isLike: true,
  reactorTerritory: 'GUARDIAN',
  authorTerritory: 'PIONEER',
  authorScore: 420,
  reactorScore: -420,
});
ok('MODEL0 author-received opponent LIKE is negative (guardian sign)', prod.authorRecv.signed < 0);
ok('MODEL0 actor-self opponent LIKE pioneer content is positive (toward pioneer)', prod.actorSelf.signed > 0);

ok('live daily cap 240', core.LIVE.communityDailyCap === 240);
ok('live DI cap 180', core.LIVE.dailyIssueDailyCap === 180);
ok('live batch 500', core.LIVE.batchCap === 500);
ok('live exit 360 return 160', core.LIVE.exitAbs === 360 && core.LIVE.returnAbs === 160);
ok('live stay 48h consecutive 2', core.LIVE.minTerritoryStayHours === 48 && core.LIVE.requiredConsecutiveBatches === 2);
ok('post/comment write 0', core.LIVE.postWrite === 0 && core.LIVE.commentWrite === 0);

const weights = core.LIVE.weights;
ok(
  '70/100/130 live structure',
  weights.sameTerritoryPositive === 70 &&
    weights.otherTerritoryPositive === 130 &&
    weights.sameTerritoryNegative === 130 &&
    weights.otherTerritoryNegative === 70 &&
    weights.centralRelation === 100
);

const livePair = core.computeProductionPair({
  isLike: true,
  reactorTerritory: 'GUARDIAN',
  authorTerritory: 'PIONEER',
  authorScore: 420,
  reactorScore: -420,
});
ok('live author unexpected LIKE = -130', livePair.authorRecv.signed === -130);
ok('live actor 25% = +32.5', livePair.actorSelf.signed === 32.5);

const legacy = core.computeLegacyProductionPair({
  isLike: true,
  reactorTerritory: 'GUARDIAN',
  authorTerritory: 'PIONEER',
  authorScore: 420,
  reactorScore: -420,
});
ok('legacy author opponent LIKE = -120', legacy.authorRecv.signed === -120);
ok('legacy actor 100% = +120', legacy.actorSelf.signed === 120);

console.log('pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
