#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../shared/beta-official-posts-core');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const root = path.join(__dirname, '..');
const read = function (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
};

const pack = core.validatePack();
assert(pack.ok, 'pack invalid: ' + (pack.errors || []).join(','));

const guides = core.POSTS.filter(function (p) {
  return p.kind === core.KIND.GUIDE;
});
const debates = core.POSTS.filter(function (p) {
  return p.kind === core.KIND.DEBATE;
});
assert(guides.length === 6, '6 guide posts');
assert(debates.length === 3, '3 debate posts');

assert(
  guides.some(function (p) {
    return p.seedKey === 'guide-welcome';
  }),
  'welcome',
);
assert(
  guides.some(function (p) {
    return /중앙광장/.test(p.title);
  }),
  'central guide',
);
assert(
  guides.some(function (p) {
    return /개척영토와 수호영토/.test(p.title);
  }),
  'territory guide',
);
assert(
  guides.some(function (p) {
    return /좋아요/.test(p.title);
  }),
  'reaction guide',
);
assert(
  guides.some(function (p) {
    return /외계행성/.test(p.title);
  }),
  'alien guide',
);
assert(
  guides.some(function (p) {
    return /신고와 운영원칙/.test(p.title);
  }),
  'policy guide',
);

core.POSTS.forEach(function (p) {
  assert(p.territory == null || p.territory === core.TERRITORY, 'posts use pack territory');
  assert(core.isOfficialTitle(p.title), 'official title ' + p.seedKey);
  assert(/공식 안내입니다|운영 토론 주제입니다/.test(p.content), 'official body mark ' + p.seedKey);
});

assert(/정치 진영이 아닙니다/.test(core.allCopyText()), 'alien not a faction');
assert(/정치적 견해 자체는 제재 사유가 아닙니다/.test(core.allCopyText()), 'speech not sanctioned');
assert(/가입할 때 고르는 것이 아닙니다|골라 이동하는 구조가 아닙니다/.test(core.allCopyText()), 'no territory pick');
assert(/신고가 많이 들어왔다는 사실만으로 자동 제재/.test(core.allCopyText()), 'no auto sanction on report count');

debates.forEach(function (p) {
  assert(p.content.indexOf('여러분은 어떻게 생각하시나요?') !== -1, 'debate prompt ' + p.seedKey);
  assert(!/정답은|반드시 찬성|반드시 반대|개척이어야|수호이어야/.test(p.content), 'no steered answer ' + p.seedKey);
});

const hits = core.forbiddenHits(core.allCopyText());
assert(hits.length === 0, 'forbidden copy ' + hits.join(','));

const titles = core.POSTS.map(function (p) {
  return p.title;
});
const first = core.planInserts([]);
assert(first.create.length === 9 && first.skip.length === 0, 'empty db creates all');
const second = core.planInserts(titles);
assert(second.create.length === 0 && second.skip.length === 9, 'second run skips all');
const partial = core.planInserts([titles[0], titles[1]]);
assert(partial.create.length === 7 && partial.skip.length === 2, 'partial skip');

const row = core.insertRow(core.POSTS[0], '11111111-1111-4111-8111-111111111111');
assert(row.territory === 'CENTRAL', 'insert CENTRAL');
assert(row.board_stage === 1, 'stage 1');
assert(row.is_anonymous === false, 'not anonymous');
assert(row.status === 'ACTIVE', 'active');
assert(row.faction_battle_enabled === false, 'no fake faction battle');
assert(row.is_official === true, 'official flag on insert row');
assert(Object.prototype.hasOwnProperty.call(row, 'earth_positive_count') === false, 'no fake reaction counts');
assert(!row.comment_count, 'no fake comments');

assert(core.isUuid('11111111-1111-4111-8111-111111111111') === true, 'uuid ok');
assert(core.isUuid('not-a-user') === false, 'uuid reject');

const applySrc = read('tools/apply-beta-official-posts.js');
assert(/PRODUCTION_REFUSED/.test(applySrc), 'apply refuses production');
assert(/AUTHOR_NOT_FOUND/.test(applySrc), 'no fake user create');
assert(/is_official: true/.test(read('shared/beta-official-posts-core.js')), 'insert row sets official');
assert(/IS_OFFICIAL_COLUMN_MISSING/.test(applySrc), 'apply fails closed if column missing');
assert(/\.update\(/.test(applySrc) === false, 'apply does not update existing posts');
assert(/board_comments/.test(applySrc) === false, 'apply does not touch comments');
assert(/board_reactions/.test(applySrc) === false, 'apply does not touch reactions');
assert(/auth\.users/.test(applySrc) === false || /INSERT/.test(applySrc) === true, 'no auth user insert');
assert(/from\('profiles'\)/.test(applySrc), 'author lookup only');
assert(/createUser|signUp/.test(applySrc) === false, 'no fake signup');

const authJs = read('public/auth.js');
assert(authJs.indexOf('beta-official') === -1, 'auth.js untouched by pack');

const entry = read('public/app-entry.js');
assert(entry.indexOf('beta-official-posts') === -1, 'app-entry not coupled');

const index = read('public/index.html');
assert(/appendOfficialBoardTitle/.test(index), 'list marks official posts');
assert(/function isOfficialBoardTitle/.test(index) === false, 'title string is not the badge source');
assert(/p\.isOfficial === true/.test(index) && /post\.isOfficial === true/.test(index), 'badge uses server isOfficial');
assert(index.indexOf('auth.js') !== -1, 'auth script kept');

console.log('PASS beta official posts');
