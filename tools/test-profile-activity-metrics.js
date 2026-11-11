'use strict';

const assert = require('assert');
const { createMembershipMoveLedger } = require('../shared/membership-move-ledger');
const { civicInfluence } = require('../shared/civic-influence-core');
const { evaluateCitizenRank } = require('../shared/citizen-rank-evaluation-core');
const territory = require('../shared/alignment-territory-core');
const lists = require('../server/profile-activity-list-service');
const metrics = require('../server/profile-territory-metrics-service');

const ledger = createMembershipMoveLedger();
const user = 'user-1';

function move(extra) {
  return Object.assign(
    {
      region: 'KR',
      userId: user,
      eventId: 'b1',
      fromTerritory: 'CENTRAL',
      toTerritory: 'PIONEER',
      confirmed: true,
      initial: false,
    },
    extra
  );
}

assert.strictEqual(ledger.record(move({ initial: true })).reason, 'INITIAL_TERRITORY');
assert.strictEqual(ledger.count('KR', user), 0);

assert.strictEqual(ledger.record(move({ confirmed: false, eventId: 'pending' })).reason, 'NOT_CONFIRMED');
assert.strictEqual(ledger.count('KR', user), 0);

assert.strictEqual(ledger.record(move()).recorded, true);
assert.strictEqual(ledger.record(move()).reason, 'DUPLICATE');
assert.strictEqual(ledger.count('KR', user), 1);

assert.strictEqual(
  ledger.record(move({ eventId: 'b2', fromTerritory: 'PIONEER', toTerritory: 'CENTRAL' })).recorded,
  true
);
assert.strictEqual(ledger.count('KR', user), 2);
assert.strictEqual(
  ledger.record(move({ eventId: 'b3', fromTerritory: 'CENTRAL', toTerritory: 'PIONEER' })).recorded,
  true
);
assert.strictEqual(
  ledger.record(move({ eventId: 'b4', fromTerritory: 'PIONEER', toTerritory: 'CENTRAL' })).recorded,
  true
);
assert.strictEqual(ledger.count('KR', user), 4);
assert.strictEqual(ledger.count('US', user), 0);

assert.strictEqual(
  ledger.record(move({ region: 'US', eventId: 'us1', fromTerritory: 'CENTRAL', toTerritory: 'GUARDIAN' })).recorded,
  true
);
assert.strictEqual(ledger.count('US', user), 1);
assert.strictEqual(ledger.count('KR', user), 4);

const pending = territory.evaluateTerritoryTransition(
  { alignmentScore: 1200, currentTerritory: 'CENTRAL', pendingTerritory: null, pendingTerritoryBatchCount: 0 },
  '2026-01-01T00:00:00.000Z'
);
assert.strictEqual(pending.territoryChanged, false);
assert.strictEqual(
  ledger.record(
    move({
      eventId: 'interval',
      confirmed: pending.territoryChanged,
      fromTerritory: pending.previousTerritory,
      toTerritory: pending.candidateTerritory,
    })
  ).reason,
  'NOT_CONFIRMED'
);

const confirmed = territory.evaluateTerritoryTransition(
  {
    alignmentScore: 1200,
    currentTerritory: 'CENTRAL',
    pendingTerritory: 'PIONEER',
    pendingTerritoryBatchCount: 1,
  },
  '2026-01-02T00:00:00.000Z'
);
assert.strictEqual(confirmed.territoryChanged, true);

const civic = civicInfluence({
  postLikes: { available: true, value: 3 },
  commentLikes: { available: true, value: 4 },
  followers: { available: true, value: 2 },
});
assert.strictEqual(civic.available, true);
assert.strictEqual(civic.value, 3 + 8 + 10);

const missingFollowers = civicInfluence({
  postLikes: { available: true, value: 3 },
  commentLikes: { available: true, value: 4 },
  followers: { available: false, reason: 'FOLLOW_NOT_CONNECTED' },
});
assert.strictEqual(missingFollowers.available, false);
assert.strictEqual(missingFollowers.value, null);
assert.deepStrictEqual(missingFollowers.missing, ['followers']);

const rank = evaluateCitizenRank({ reputation: 99, level: 20, influence: 50 });
assert.strictEqual(rank.available, false);
assert.strictEqual(rank.reason, 'CITIZEN_RANK_POLICY_NOT_FINALIZED');
assert.strictEqual(rank.changed, false);

const posts = [];
let n;
for (n = 0; n < 25; n++) {
  posts.push({
    id: 'p' + n,
    author_user_id: user,
    title: 'Post ' + n,
    territory: 'CENTRAL',
    status: 'ACTIVE',
    activity_region: n === 0 ? 'US' : 'KR',
    created_at: '2026-02-' + String(10 + (n % 9)).padStart(2, '0') + 'T00:00:' + String(n).padStart(2, '0') + 'Z',
    comment_count: n,
  });
}
posts.push({
  id: 'gone',
  author_user_id: user,
  title: 'Deleted',
  status: 'DELETED',
  activity_region: 'KR',
  created_at: '2026-03-01T00:00:00Z',
  comment_count: 9,
});
const postPage = lists.listPostsFromRows(posts, { userId: user, region: 'KR', page: 1 });
assert.strictEqual(postPage.totalItems, 24);
assert.strictEqual(postPage.items.length, 20);
assert.strictEqual(postPage.items[0].commentCount >= 0, true);
assert.strictEqual(postPage.items.some(function (item) { return item.postId === 'p0' || item.postId === 'gone'; }), false);
const usPosts = lists.listPostsFromRows(posts, { userId: user, region: 'US', page: 1 });
assert.strictEqual(usPosts.totalItems, 1);
assert.strictEqual(usPosts.items[0].postId, 'p0');

const comments = lists.listCommentsFromRows(
  [
    {
      id: 'c1',
      post_id: 'p1',
      author_user_id: user,
      content: 'hello there',
      status: 'ACTIVE',
      activity_region: 'KR',
      created_at: '2026-02-02T00:00:00Z',
    },
    {
      id: 'c-us',
      post_id: 'p0',
      author_user_id: user,
      content: 'us only',
      status: 'ACTIVE',
      activity_region: 'US',
      created_at: '2026-02-03T00:00:00Z',
    },
  ],
  posts,
  { userId: user, region: 'KR', page: 1 }
);
assert.strictEqual(comments.totalItems, 1);
assert.strictEqual(comments.items[0].postTitle, 'Post 1');
assert.strictEqual(comments.items[0].commentId, 'c1');

const likes = lists.listLikesFromRows(
  [
    { user_id: user, source_type: 'board_post', source_id: 'p1', occurred_at: '2026-02-01T00:00:00Z', dedupe_key: 'EMPATHY_RECEIVED:p1:other' },
    { user_id: user, source_type: 'board_post', source_id: 'p1', occurred_at: '2026-02-02T00:00:00Z', dedupe_key: 'EMPATHY_RECEIVED:p1:other-2' },
    { user_id: user, source_type: 'board_post', source_id: 'p1', occurred_at: '2026-02-03T00:00:00Z', dedupe_key: 'EMPATHY_RECEIVED:p1:' + user, reactor_user_id: user },
    { user_id: user, source_type: 'board_comment', source_id: 'c1', occurred_at: '2026-02-04T00:00:00Z', dedupe_key: 'EMPATHY_RECEIVED:c1:other' },
    { user_id: user, source_type: 'board_post', source_id: 'p1', revoked: true, dedupe_key: 'EMPATHY_RECEIVED:p1:gone' },
  ],
  posts,
  [{ id: 'c1', post_id: 'p1' }],
  { userId: user, region: 'KR', page: 1 }
);
assert.strictEqual(likes.totalLikes, 3);
assert.strictEqual(likes.commentLikeHistory, 'CONNECTED');
assert.strictEqual(likes.items.length, 2);

assert.throws(function () {
  lists.listPostsFromRows(posts, { userId: user, requestedUserId: 'someone-else', region: 'KR' });
}, function (err) {
  return err.code === 'ACTIVITY_FORBIDDEN';
});

function fakeSb(table) {
  return {
    from: function () {
      const q = {
        select: function () { return q; },
        eq: function () { return q; },
        then: function (resolve) {
          return Promise.resolve({ data: null, error: { code: 'NO_TABLE' }, count: null }).then(resolve);
        },
      };
      return q;
    },
    table: table,
  };
}

metrics.loadTerritoryMetrics(user, 'KR', fakeSb()).then(function (out) {
  assert.strictEqual(out.move.available, false);
  assert.strictEqual(out.move.value, null);
  assert.strictEqual(out.civic.available, false);
  assert.ok(out.civic.missing.indexOf('followers') >= 0);
  assert.notStrictEqual(out.civic.value, 0);
  assert.strictEqual(out.rank.available, false);
  assert.strictEqual(out.rank.reason, 'CITIZEN_RANK_POLICY_NOT_FINALIZED');
  assert.strictEqual(out.rank.text, '');
  return metrics.loadTerritoryMetrics(user, 'US', fakeSb());
}).then(function (us) {
  assert.strictEqual(us.region, 'US');
  assert.strictEqual(us.move.available, false);
  assert.strictEqual(us.move.reason, 'NO_US_MEMBERSHIP_CHANGE_LEDGER');
  assert.strictEqual(us.move.value, null);
  assert.strictEqual(us.civic.available, false);
  console.log('profile activity metrics: ok');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
