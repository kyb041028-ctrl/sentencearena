#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('../shared/board-schema-core');
const core = require('../shared/beta-official-posts-core');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardDataMapper } = require('../server/board-data-mapper');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function makeService() {
  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({
    territories: { [uid(1)]: 'CENTRAL', [uid(2)]: 'CENTRAL' },
  });
  const service = createBoardService({ repository, userContext, operational: true });
  return { service, repository };
}

(async function main() {
  const { service, repository } = makeService();
  const author = uid(1);
  const other = uid(2);
  const mapper = createBoardDataMapper();

  const created = await service.createPost({ userId: author }, {
    title: '일반 회원 글',
    content: '본문',
  });
  assert(created.post.isOfficial === false, '1. member default isOfficial=false');

  const forged = await service.createPost({ userId: author }, {
    title: '조작 시도',
    content: '본문',
    isOfficial: true,
    is_official: true,
  });
  assert(forged.post.isOfficial === false, '2. client is_official=true ignored');

  let reserved = null;
  try {
    await service.createPost({ userId: author }, {
      title: '[공식] 테스트',
      content: '본문',
    });
  } catch (e) {
    reserved = e;
  }
  assert(reserved && reserved.code === 'BOARD_OFFICIAL_TITLE_RESERVED', '3. reserved title rejected');
  assert(
    String(reserved.message).indexOf('공식 표시는 운영자 게시글에만') !== -1,
    '3b. reserved title message',
  );

  const withWord = await service.createPost({ userId: author }, {
    title: '토론 제목',
    content: '공식 기록이 아니라 개인 의견입니다.',
  });
  assert(withWord.post && withWord.post.isOfficial === false, '4. body may use 공식');

  const packRow = core.insertRow(core.POSTS[0], author);
  assert(packRow.is_official === true, '5. official tool insert row is_official true');
  const operatorRow = await repository.createPost({
    authorUserId: author,
    territory: 'CENTRAL',
    title: packRow.title,
    content: packRow.content,
    isOfficial: packRow.is_official === true,
  });
  const operatorView = await service.getPost({ userId: other }, operatorRow.id);
  assert(operatorView.isOfficial === true, '5b. only operator-stored row is official');

  assert(schema.shouldShowOfficialBadge(true) === true, '6. official list badge source');
  assert(schema.shouldShowOfficialBadge(false) === false, '8. unofficial title does not badge');
  assert(schema.shouldShowOfficialBadge('[공식] 위조') === false, '8b. title string is not a flag');

  const unofficialMapped = mapper.mapPostForViewer({
    id: 'x',
    authorUserId: author,
    territory: 'CENTRAL',
    title: '[공식] 위조',
    content: 'x',
    isOfficial: false,
    status: 'ACTIVE',
  }, other);
  assert(unofficialMapped.isOfficial === false, '8c. mapper ignores title');
  assert(unofficialMapped.title.indexOf('[공식]') === 0, '8d. unofficial title text kept');

  const titles = core.POSTS.map(function (p) { return p.title; });
  const first = core.planInserts([]);
  const second = core.planInserts(titles);
  assert(first.create.length === 9 && second.create.length === 0 && second.skip.length === 9, '9. second run no duplicates');

  const sql = read('supabase/migration_board_posts_is_official_v1.sql');
  assert(/ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false/.test(sql), 'sql additive default false');
  assert(/UPDATE[\s\S]*SET[\s\S]*is_official\s*=\s*true/i.test(sql) === false, '10. no official backfill');
  assert(/WHERE[\s\S]*\[공식\]/.test(sql) === false, '10b. no title-based backfill');
  assert(/protect_board_posts_is_official/.test(sql), '9. db trigger protects column');

  const applySrc = read('tools/apply-beta-official-posts.js');
  assert(/\.update\(/.test(applySrc) === false, '10c. apply does not update existing posts');
  assert(/IS_OFFICIAL_COLUMN_MISSING/.test(applySrc), 'apply fails closed without column');

  const index = read('public/index.html');
  assert(/function isOfficialBoardTitle/.test(index) === false, '7. title helper removed');
  assert(/appendOfficialBoardTitle\(h, p\.title/.test(index), '6. list badge helper');
  assert(/appendOfficialBoardTitle\(h1, post\.title/.test(index), '7. detail badge helper');
  assert(/p\.isOfficial === true/.test(index), '6b. list uses server flag');
  assert(/post\.isOfficial === true/.test(index), '7b. detail uses server flag');

  const client = read('public/board-api-client.js');
  assert(/delete snapshot\.isOfficial/.test(client) && /delete snapshot\.is_official/.test(client), 'client strips official flags');

  assert(read('public/auth.js').indexOf('is_official') === -1, '13. auth.js unchanged by this flag');
  assert(read('public/auth.js').indexOf('isOfficial') === -1, '13b. auth.js has no isOfficial');
  assert(read('shared/political-alignment-bidirectional-sim-core.js').indexOf('is_official') === -1, '12. alignment sim untouched');
  assert(read('shared/popular-posts-core.js').indexOf('is_official') === -1, '11. popular core untouched');
  const supabaseRepo = read('server/board-supabase-repository.js');
  assert(
    /if \(input && input\.isOfficial === true\) insert\.is_official = true/.test(supabaseRepo),
    'operator supabase insert sets is_official only from service flag',
  );
  assert(!/is_official:\s*input/.test(supabaseRepo), 'does not copy client is_official field');
  assert(!/is_official:\s*src/.test(supabaseRepo), 'does not copy client is_official src');

  const reservedCreate = schema.validatePostInput({ title: '[공식] x', content: '본문' });
  assert(reservedCreate.valid === false && reservedCreate.errors[0] === 'BOARD_OFFICIAL_TITLE_RESERVED', 'schema reserved');
  const allowedOfficial = schema.validatePostInput({
    title: '[공식] 운영 안내',
    content: '본문',
    allowOfficialTitle: true,
  });
  assert(allowedOfficial.valid === true, 'official path may keep [공식] title');

  console.log('PASS official board flag');
})().catch(function (e) {
  console.error('FAIL official board flag', e && e.message ? e.message : e);
  process.exit(1);
});
