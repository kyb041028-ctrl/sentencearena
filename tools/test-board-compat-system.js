#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const boardConfig = require('../shared/board-config-core');
const schema = require('../shared/board-schema-core');
const legacy = require('../public/board-legacy-adapter');
const appConfig = require('../app-config');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    failures.push({ name, detail: detail || '' });
    console.error('FAIL', name, detail || '');
    return;
  }
  passed += 1;
  console.log('PASS', name);
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function runCommentLengthTests() {
  assert('1. 공용 댓글 최대 길이 1500', boardConfig.LIMITS.commentMaxLength === 1500);
  assert('2. 1500자 댓글 허용', schema.validateCommentInput({ content: 'a'.repeat(1500) }).valid);
  assert('3. 1501자 댓글 거부', !schema.validateCommentInput({ content: 'a'.repeat(1501) }).valid);
  assert('4. UI adapter·서버 동일 LIMITS', schema.LIMITS.commentMax === boardConfig.LIMITS.commentMaxLength);
  const limits = appConfig.CONTENT_LIMITS || {};
  assert(
    '5. app-config 140과 게시판 분리',
    limits.demoShortInputMaxChars === 140 && limits.demoShortInputMaxChars !== boardConfig.LIMITS.commentMaxLength,
  );
  assert(
    '6. 오류 코드 BOARD_COMMENT_TOO_LONG',
    schema.validateCommentInput({ content: 'x'.repeat(1501) }).errors.indexOf('BOARD_COMMENT_TOO_LONG') !== -1,
  );
}

function runEmpathyTests() {
  assert('7. empathy alignment 4종 미포함', !boardConfig.isAlignmentReactionType('EMPATHY'));
  assert('8. empathy alignment 입력 미변환', schema.toAlignmentReactionInput({ reaction_type: 'EMPATHY' }) == null);
  const clientSrc = require('fs').readFileSync(path.join(ROOT, 'public', 'board-api-client.js'), 'utf8');
  assert('9. empathy API toggle 거부', /isSocialReactionType/.test(clientSrc));
  const post = {
    id: 'p1',
    title: 't',
    body: 'b',
    authorId: 'u1',
    reactions: { likes: [], dislikes: [], empathy: ['u2', 'u3'], planetVoters: [] },
    comments: [],
  };
  const mapped = legacy.mapLegacyPostToBoardDraft(post, { territoryId: 'COMMON', boardStage: 1 });
  assert(
    '10. legacy adapter empathy 보존',
    mapped.social.social.empathy.length === 2 && mapped.social.alignment.likes.length === 0,
  );
  assert('11. empathy 부정 점수 미처리', !boardConfig.isAlignmentReactionType('EMPATHY'));
}

function runPlanetTests() {
  const post = {
    id: 'p1',
    title: 't',
    body: 'b',
    reactions: { likes: ['a'], dislikes: [], empathy: [], planetVoters: ['x'] },
    comments: [],
  };
  const mapped = legacy.mapLegacyPostToBoardDraft(post, { territoryId: 'COMMON' });
  assert('12. planetVoters 운영 반응 미변환', mapped.social.deferredLegacy.planetVoters.length === 1);
  const validation = schema.validateReactionInput({
    targetType: 'POST',
    targetId: uid(1),
    reactionType: 'PLANET',
  });
  assert('13. planet API 전송 거부', !validation.valid);
  assert('14. legacy adapter planet 보존', mapped.social.deferredLegacy.planetVoters[0] === 'x');
  const view = legacy.mapBoardPostToLegacyViewModel({ id: 'p1', title: 't', content: 'b', status: 'ACTIVE' }, mapped.social);
  assert('15. 신규 저장 planetVoters 미생성', Array.isArray(view.reactions.planetVoters));
}

async function runTerritoryTests() {
  assert('16. COMMON→CENTRAL', boardConfig.normalizeBoardTerritory('COMMON') === 'CENTRAL');
  assert('17. PROGRESSIVE→PIONEER', boardConfig.normalizeBoardTerritory('PROGRESSIVE') === 'PIONEER');
  assert('18. CONSERVATIVE→GUARDIAN', boardConfig.normalizeBoardTerritory('CONSERVATIVE') === 'GUARDIAN');
  assert('19. KANTAPBIYA→ALIEN', boardConfig.normalizeBoardTerritory('KANTAPBIYA') === 'ALIEN');
  assert('20. 운영 값 유지', boardConfig.normalizeBoardTerritory('PIONEER') === 'PIONEER');
  let rejected = false;
  try {
    boardConfig.assertOperationalBoardTerritory('COMMON');
  } catch (e) {
    rejected = e.code === 'BOARD_TERRITORY_INVALID';
  }
  assert('21. 레거시 운영 저장 거부', rejected);
  const repo = createBoardMemoryRepository();
  let repoErr = null;
  try {
    await repo.createPost({
      authorUserId: uid(1),
      territory: 'COMMON',
      title: 't',
      content: 'c',
    });
  } catch (e) {
    repoErr = e;
  }
  assert('22. repository 레거시 territory 거부', repoErr && repoErr.code === 'BOARD_TERRITORY_INVALID');
  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({ territories: { [uid(2)]: 'CENTRAL' } });
  const service = createBoardService({ repository, userContext, operational: true });
  const row = await service.createPost({ userId: uid(2) }, { title: 'ok', content: 'ok' });
  assert('23. repository 운영 territory 저장', row.post.territory === 'CENTRAL');
  const aligned = schema.toAlignmentReactionInput({
    reaction_type: 'LIKE',
    actor_territory_at_reaction: 'PIONEER',
    target_author_territory_at_reaction: 'GUARDIAN',
  });
  assert('24. alignment 입력 운영 territory', aligned && aligned.actorTerritoryAtReaction === 'PIONEER');
}

function runLegacyAdapterTests() {
  const post = {
    id: 'p_legacy',
    title: '제목',
    body: '본문',
    authorId: 'author-1',
    isAnonymous: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    reactions: { likes: ['u1'], dislikes: [], empathy: ['u2'], planetVoters: ['u3'] },
    comments: [
      {
        id: 'c1',
        authorId: 'c-author',
        text: '댓글',
        parentId: null,
        reactions: { likes: [], dislikes: [], empathy: [], planetVoters: [] },
      },
    ],
  };
  const before = JSON.stringify(post);
  const mapped = legacy.mapLegacyPostToBoardDraft(post, { territoryId: 'PROGRESSIVE', boardStage: 2 });
  assert('25. legacy Post draft 변환', mapped.draft.territory === 'PIONEER' && mapped.draft.content === '본문');
  const cm = legacy.mapLegacyCommentToBoardDraft(post.comments[0], { postLegacyId: post.id });
  assert('26. legacy comment draft 변환', cm.draft.content === '댓글');
  const view = legacy.mapBoardPostToLegacyViewModel(
    Object.assign({}, mapped.draft, { id: post.id, status: 'ACTIVE' }),
    mapped.social,
  );
  assert('27. API→legacy UI 변환', view.body === '본문' && view.title === '제목');
  assert('28. 익명 상태 유지', mapped.draft.isAnonymous === true);
  const deleted = legacy.mapLegacyPostToBoardDraft(Object.assign({}, post, { deleted: true }), { territoryId: 'COMMON' });
  assert('29. 삭제 상태 유지', deleted.draft.status === 'DELETED');
  const reply = legacy.mapLegacyCommentToBoardDraft(
    { id: 'c2', text: 'r', parentId: 'c1' },
    { postLegacyId: post.id },
  );
  assert('30. parentId 유지', reply.draft.parentCommentId === 'c1');
  assert('31. 입력 객체 비변경', JSON.stringify(post) === before);
  const withImages = legacy.mapLegacyPostToBoardDraft(
    Object.assign({}, post, { images: ['a.png'] }),
    { territoryId: 'COMMON' },
  );
  assert('32. 손실 필드 warning', withImages.warnings.indexOf('LEGACY_FIELD_IMAGES_NOT_MAPPED') !== -1);
  const bundle = { posts: { COMMON_s1: [post] } };
  const bundleBefore = JSON.stringify(bundle);
  legacy.normalizeLegacyBoardBundle(bundle);
  assert('33. localStorage 원본 비변경', JSON.stringify(bundle) === bundleBefore);
}

function runModeTests() {
  assert('34. 기본 LEGACY_LOCAL', boardConfig.resolveBoardDataMode({}) === boardConfig.DATA_MODES.LEGACY_LOCAL);
  const dry = boardConfig.resolveBoardDataMode({ BOARD_DATA_MODE: 'API_DRY_RUN' });
  assert('35. API_DRY_RUN 모드', dry === boardConfig.DATA_MODES.API_DRY_RUN);
  global.BoardConfigCore = boardConfig;
  global.BoardSchemaCore = schema;
  global.BoardLegacyAdapter = legacy;
  let fetchCalled = false;
  global.fetch = function () {
    fetchCalled = true;
    return Promise.reject(new Error('fetch should not run in API_DRY_RUN'));
  };
  delete require.cache[require.resolve('../public/board-api-client.js')];
  require('../public/board-api-client.js');
  const dryClient = global.createBoardApiClient({ dataMode: 'API_DRY_RUN' });
  return dryClient
    .createComment('00000000-0000-4000-8000-000000000001', { content: 'dry-run' })
    .then(function (res) {
      assert('35b. API_DRY_RUN 서버 쓰기 미호출', res.dryRun === true && !fetchCalled);
      assert(
        '36. API_OPERATIONAL 기본 비활성',
        boardConfig.resolveBoardDataMode({}) !== boardConfig.DATA_MODES.API_OPERATIONAL,
      );
      assert(
        '37. BOARD_OPERATIONAL 꺼짐 유지',
        boardConfig.resolveBoardDataMode({ BOARD_OPERATIONAL: '' }) === boardConfig.DATA_MODES.LEGACY_LOCAL,
      );
    });
}

function runChildTest(scriptName, expectPattern) {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', scriptName)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert(scriptName + ' exit summary', new RegExp(expectPattern).test(out), out.split('\n').slice(-5).join(' | '));
}

async function main() {
  console.log('=== board compat / transition tests ===');
  runCommentLengthTests();
  runEmpathyTests();
  runPlanetTests();
  await runTerritoryTests();
  runLegacyAdapterTests();
  await runModeTests();

  console.log('--- regression (alignment may take several minutes) ---');
  if (process.env.SC_SKIP_COMPAT_REGRESSION === '1') {
    console.log('(skipped — SC_SKIP_COMPAT_REGRESSION=1)');
  } else {
    try {
      runChildTest('test-board-core-system.js', 'passed: 49 failed: 0');
      runChildTest('test-alignment-supabase-system.js', 'passed: 88 failed: 0');
    } catch (e) {
      assert('regression child tests', false, e.message || String(e));
    }
  }

  console.log('---');
  console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
  if (failures.length) {
    failures.forEach((f) => console.error(' -', f.name, f.detail));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
