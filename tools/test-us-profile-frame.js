#!/usr/bin/env node
'use strict';

const assert = require('assert');
const frame = require('../server/us-profile-frame');
const xp = require('../shared/progression-xp-core');

const user = '11111111-1111-4111-8111-111111111111';
const counts = frame.countActivity(
  [{ id: 'us-post' }, { id: 'us-post' }],
  [
    { id: 'c1', post_id: 'us-post' },
    { id: 'c1', post_id: 'us-post' },
    { id: 'c2', post_id: 'other-us' },
    { id: '', post_id: 'other-us' },
  ],
  [
    { id: 'e1', dedupe_key: 'US:EMPATHY_RECEIVED:us-post:other-user' },
    { id: 'e1b', dedupe_key: 'US:EMPATHY_RECEIVED:us-post:other-user' },
    { id: 'e2', dedupe_key: 'US:EMPATHY_RECEIVED:us-post:' + user },
    { id: 'e3', dedupe_key: 'KR:EMPATHY_RECEIVED:kr-post:other-user' },
  ],
  user
);
assert.strictEqual(counts.posts, 1);
assert.strictEqual(counts.comments, 3);
assert.strictEqual(counts.discussions, 2);
assert.strictEqual(counts.receivedLikes, 1);
assert.notStrictEqual(counts.receivedLikes, 9);

const shown = frame.displayFields({
  stored: true,
  xp: 37,
  fame: 9,
  territory: 'PIONEER',
  displayName: 'BlueFox',
  achievements: ['first-post', 'first-comment', 'record-builder', 'steady-footsteps'],
  featured: ['record-builder', 'first-post', 'missing-badge'],
});
const progress = xp.buildProgressionDisplay(null, 37);
assert.strictEqual(shown.levelFromXp, progress.level);
assert.strictEqual(shown.expPercent, progress.expPercent);
assert.strictEqual(shown.levelFromXp, 1);
assert.strictEqual(shown.territory, 'pioneer');
assert.strictEqual(shown.territoryLabel, 'Progressive Territory');
assert.strictEqual(shown.displayName, 'BlueFox');
assert.deepStrictEqual(shown.featuredAchievements, ['record-builder', 'first-post']);

const empty = frame.displayFields({
  stored: false,
  xp: 80,
  territory: 'CENTRAL',
  displayName: user,
  achievements: ['kr-kept-badge'],
  featured: null,
});
assert.strictEqual(empty.levelFromXp, null);
assert.strictEqual(empty.expPercent, null);
assert.strictEqual(empty.territory, null);
assert.strictEqual(empty.territoryLabel, null);
assert.strictEqual(empty.displayName, null);
assert.deepStrictEqual(empty.featuredAchievements, ['kr-kept-badge']);

const unnamed = frame.displayFields({
  stored: true,
  xp: 0,
  territory: null,
  displayName: 'not an email@host',
  achievements: [],
});
assert.strictEqual(unnamed.displayName, null);
assert.strictEqual(unnamed.territoryLabel, null);
assert.strictEqual(unnamed.levelFromXp, 1);
assert.strictEqual(unnamed.expPercent, 0);

console.log('PASS us profile frame counts, isolation, and empty territory');
