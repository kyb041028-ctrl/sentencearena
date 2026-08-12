#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

assert(index.includes('function createAuthenticatedProfileBase()'), 'has authenticated clean base');
assert(index.includes("level: 1"), 'auth base level default');
assert(index.includes("expPercent: 0"), 'auth base exp default');
assert(index.includes("fame: 0"), 'auth base fame default');
assert(index.includes("followers: 0"), 'auth base followers default');
assert(index.includes("achievements: []"), 'auth base empty achievements');

assert(
  index.includes("readPoliticalScoresForProfileUser(scoresUserId, { allowGuestFallback: false })"),
  'auth alignment blocks guest fallback',
);
assert(
  index.includes("readPoliticalScoresForProfileUser(id, { allowGuestFallback: false })"),
  'modal alignment blocks guest fallback',
);
assert(index.includes('profile.achievements = [];'), 'auth profile achievements reset empty');
assert(index.includes("profile.userId = '회원';"), 'auth fallback user label no uuid suffix');
assert(!index.includes("nickname + ' · ' + shortId"), 'no profileframe nickname+shortId');
assert(!index.includes("회원 · "), 'no member short id suffix');

console.log('PASS profileframe auth clean defaults static checks');
