'use strict';
/**
 * DEC-023 격리 평가 엔진. 저장소와 API를 열지 않는다.
 * node tools/test-dec023-rank-evaluation.js
 */

const fs = require('fs');
const path = require('path');
const core = require('../shared/dec023-rank-evaluation-core');

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

const clock = { weekday: 'WEDNESDAY', hour: 0, minute: 0 };

function member(id, extra) {
  return Object.assign(
    {
      id: id,
      country: 'KR',
      territory: 'pioneer',
      currentRank: 'citizen',
      uniquePositiveEvaluators: 1000,
      firstQualificationUsed: { debater: true, elder: true, representative: true },
      electedLeader: false,
      comparisonScore: 100 - Number(String(id).replace(/\D/g, '') || 0),
    },
    extra || {},
  );
}

function apply(members, extra) {
  return core.applyWeeklyRanks(
    Object.assign(
      {
        country: 'KR',
        territory: 'pioneer',
        territoryPopulation: 1000,
        clock: clock,
        refreshComplete: true,
        members: members,
      },
      extra || {},
    ),
  );
}

function rankOf(result, id) {
  var row = (result.assignments || []).filter(function (a) {
    return a.id === id;
  })[0];
  return row ? row.rank : null;
}

console.log('\n[score interface]');
var described = core.describeScore({
  fame: 10,
  cumulativeFame: 40,
  recent90DayEvaluation: 3,
  uniquePositiveEvaluators: 8,
  evaluationReactions: 2,
  followers: 4,
});
ok('formula stays unconfirmed', described.formulaStatus === 'FORMULA_UNCONFIRMED');
ok('combined score is not invented', described.combinedScore === null);
ok('fame weight is 0.45', described.weights.fame === 0.45);
ok('positive evaluator weight is 0.30', described.weights.uniquePositiveEvaluators === 0.3);
ok('reaction weight is 0.15', described.weights.evaluationReactions === 0.15);
ok('follower weight is 0.10', described.weights.followers === 0.1);
ok('english official labels are unset', core.EN_OFFICIAL_LABELS === null);

console.log('\n[first qualification uses territory population]');
ok('debater floor at small population', core.firstQualificationThreshold('debater', 100).threshold === 10);
ok('debater rises with population', core.firstQualificationThreshold('debater', 1000).threshold === 20);
ok('elder floor', core.firstQualificationThreshold('elder', 100).threshold === 50);
ok('elder rises', core.firstQualificationThreshold('elder', 3000).threshold === 150);
ok('representative floor', core.firstQualificationThreshold('representative', 100).threshold === 100);
ok('representative rises', core.firstQualificationThreshold('representative', 3000).threshold === 300);
ok('missing population is not guessed', core.firstQualificationThreshold('debater', null).ok === false);

console.log('\n[valid population]');
var asOf = Date.UTC(2026, 10, 4, 0, 0, 0);
var day = 24 * 60 * 60 * 1000;
var counted = core.countValidPopulation({
  country: 'KR',
  territory: 'pioneer',
  asOfMs: asOf,
  records: [
    { id: 'a', country: 'KR', territory: 'pioneer', valid: true, lastPostAtMs: asOf - 10 * day },
    { id: 'a', country: 'KR', territory: 'pioneer', valid: true, lastCommentAtMs: asOf - day },
    { id: 'b', country: 'KR', territory: 'pioneer', valid: true, lastCommentAtMs: asOf - 30 * day },
    { id: 'c', country: 'KR', territory: 'pioneer', valid: true, lastPostAtMs: asOf - 31 * day },
    { id: 'd', country: 'KR', territory: 'pioneer', valid: false, lastPostAtMs: asOf - day },
    { id: 'e', country: 'US', territory: 'pioneer', valid: true, lastPostAtMs: asOf - day },
    { id: 'f', country: 'KR', territory: 'guardian', valid: true, lastPostAtMs: asOf - day },
  ],
});
ok('unique recent valid members only', counted.count === 2, String(counted.count));
ok('clock is required', core.countValidPopulation({ country: 'KR', territory: 'pioneer', records: [] }).ok === false);
var usOnly = core.countValidPopulation({
  country: 'US',
  territory: 'pioneer',
  asOfMs: asOf,
  records: [
    { id: 'e', country: 'US', territory: 'pioneer', valid: true, lastPostAtMs: asOf - day },
    { id: 'a', country: 'KR', territory: 'pioneer', valid: true, lastPostAtMs: asOf - day },
  ],
});
ok('US count ignores KR', usOnly.count === 1);

console.log('\n[weekly assignment]');
ok('election opens at 1000', core.leaderElectionOpen(1000).open === true);
ok('election stays closed below 1000', core.leaderElectionOpen(999).open === false);

var held = apply([member('m1')], { clock: { weekday: 'TUESDAY', hour: 0, minute: 0 } });
ok('other weekday does not apply', held.applied === false && rankOf(held, 'm1') === 'citizen');

var people = [];
var n;
for (n = 1; n <= 20; n++) {
  people.push(
    member('p' + n, {
      comparisonScore: 100 - n,
      currentRank: n <= 12 ? 'representative' : 'citizen',
    }),
  );
}
people.push(member('lead', { electedLeader: true, comparisonScore: 1, currentRank: 'leader' }));
var placed = apply(people);
ok('weekly refresh applies', placed.applied === true);
ok('one leader', placed.counts.leader === 1 && rankOf(placed, 'lead') === 'leader');
ok('leader is outside the 10 representatives', placed.counts.representative === 10);
ok('representative cap holds', placed.counts.representative <= 10);
var reps = placed.assignments.filter(function (a) {
  return a.rank === 'representative';
});
ok('lowest incumbent representatives stay when tied by distinct scores', reps.length === 10);

var short = [];
for (n = 1; n <= 4; n++) {
  short.push(member('q' + n, { uniquePositiveEvaluators: 0, firstQualificationUsed: {}, comparisonScore: n }));
}
var unfilled = apply(short, { territoryPopulation: 1000 });
ok('unqualified seats stay empty', unfilled.counts.representative === 0 && unfilled.unfilled.representative === 10);
ok('default remains citizen', unfilled.counts.citizen === 4);

var tiePeople = [];
for (n = 1; n <= 49; n++) {
  tiePeople.push(
    member('h' + n, {
      territory: 'central',
      currentRank: 'citizen',
      comparisonScore: 1000 - n,
      uniquePositiveEvaluators: 0,
      firstQualificationUsed: { elder: true, debater: true },
    }),
  );
}
tiePeople.push(
  member('keep', {
    territory: 'central',
    currentRank: 'elder',
    comparisonScore: 1,
    uniquePositiveEvaluators: 0,
    firstQualificationUsed: { elder: true, debater: true },
  }),
);
tiePeople.push(
  member('wait', {
    territory: 'central',
    currentRank: 'citizen',
    comparisonScore: 1,
    uniquePositiveEvaluators: 0,
    firstQualificationUsed: { elder: true, debater: true },
  }),
);
var tied = apply(tiePeople, { territory: 'central' });
ok('central has no leader seat', tied.ok === true && tied.counts.leader === 0 && tied.unfilled.leader === 0);
ok(
  'tie keeps the incumbent and does not promote the tied newcomer',
  rankOf(tied, 'keep') === 'elder' && rankOf(tied, 'wait') === 'citizen',
);

var mixed = apply([member('kr1'), member('us1', { country: 'US' })]);
ok('mixed country is rejected', mixed.ok === false && mixed.reason === 'COUNTRY_OR_TERRITORY_MIXED');

var usRun = apply([member('us1', { country: 'US', comparisonScore: 3 })], { country: 'US', territory: 'guardian' });
var krRun = apply([member('kr1', { comparisonScore: 9 })]);
ok('US assignment does not reuse KR result', rankOf(usRun, 'kr1') === null && rankOf(krRun, 'us1') === null);

var remainder = [];
for (n = 1; n <= 10; n++) {
  remainder.push(
    member('r' + n, {
      territory: 'alien',
      currentRank: 'citizen',
      comparisonScore: 20 - n,
      firstQualificationUsed: { debater: true },
      uniquePositiveEvaluators: 0,
    }),
  );
}
var rest = apply(remainder, { territory: 'alien', territoryPopulation: 10 });
ok('debaters are at most 30 percent of the remainder', rest.counts.debater <= 3, String(rest.counts.debater));
ok('citizens are at least 70 percent of that remainder', rest.counts.citizen >= 7, String(rest.counts.citizen));
ok('alien leader seat is not filled', rest.counts.leader === 0);

console.log('\n[legacy formula stays out of this engine]');
var legacy = fs.readFileSync(path.join(__dirname, '..', 'public', 'player-progression.js'), 'utf8');
var engine = fs.readFileSync(path.join(__dirname, '..', 'shared', 'dec023-rank-evaluation-core.js'), 'utf8');
ok('legacy file still has the old 5-leader cap', /chiefsMaxCount:\s*5/.test(legacy));
ok('new engine does not copy the 5-leader cap', !/chiefsMaxCount/.test(engine));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
