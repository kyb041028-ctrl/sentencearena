#!/usr/bin/env node
'use strict';

/**
 * 임시 저장소 자동 테스트. Supabase에 접속하지 않는다.
 * 이 결과를 Supabase 통합 검증으로 읽지 않는다.
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');

const persist = require('../server/achievement-persist-service');
const progression = require('../server/user-progression-service');
const evaluator = require('../server/achievement-evaluator-service');

persist.getAdminClient = function () {
  const err = new Error('SUPABASE_BLOCKED_IN_TEMP_TEST');
  err.code = 'SUPABASE_BLOCKED_IN_TEMP_TEST';
  throw err;
};

let postXpCalls = 0;
let commentXpCalls = 0;
let achievementCalls = 0;
progression.applyPostCreatedXp = async function () {
  postXpCalls += 1;
  const err = new Error('PROGRESSION_BLOCKED_IN_TEMP_TEST');
  err.code = 'PROGRESSION_BLOCKED_IN_TEMP_TEST';
  throw err;
};
progression.applyBoardCommentCreatedXp = async function () {
  commentXpCalls += 1;
  const err = new Error('PROGRESSION_BLOCKED_IN_TEMP_TEST');
  err.code = 'PROGRESSION_BLOCKED_IN_TEMP_TEST';
  throw err;
};
evaluator.evaluateAfterPostCreated = async function () {
  achievementCalls += 1;
  throw new Error('ACHIEVEMENT_BLOCKED_IN_TEMP_TEST');
};
evaluator.evaluateAfterCommentCreated = async function () {
  achievementCalls += 1;
  throw new Error('ACHIEVEMENT_BLOCKED_IN_TEMP_TEST');
};
evaluator.evaluateAfterLevelUp = async function () {
  achievementCalls += 1;
  throw new Error('ACHIEVEMENT_BLOCKED_IN_TEMP_TEST');
};

const core = require('../shared/activity-region-core');
const { createBoardDataMapper } = require('../server/board-data-mapper');
const { createActivityRegionStore } = require('../server/activity-region-store');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardRouter } = require('../server/board-routes');
const { runAlignmentBatch } = require('../server/alignment-batch-service');
const { createAlignmentMemoryDataSource } = require('../server/alignment-memory-data-source');

let failed = 0;
function check(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name, detail || '');
    return;
  }
  console.log('PASS', name);
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function request(server, method, urlPath, headers, body) {
  return new Promise(function (resolve, reject) {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method: method,
      path: urlPath,
      headers: Object.assign({
        'content-type': 'application/json',
        'content-length': payload ? Buffer.byteLength(payload) : 0,
      }, headers || {}),
    }, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function titles(rows) {
  return (rows || []).map(function (row) { return row && row.title; });
}

async function main() {
  const userA = uid(1);
  const userB = uid(2);
  const pioneerUser = uid(3);
  const repository = createBoardMemoryRepository();
  const regionLedger = createActivityRegionStore();
  const userContext = createMockUserContextAdapter({
    territories: {
      [userA]: 'CENTRAL',
      [userB]: 'CENTRAL',
      [pioneerUser]: 'PIONEER',
    },
  });
  const service = createBoardService({
    repository: repository,
    userContext: userContext,
    operational: true,
    regionLedger: regionLedger,
  });
  const kr = { userId: userA, activityRegion: 'KR' };
  const us = { userId: userA, activityRegion: 'US' };
  const other = { userId: userB, activityRegion: 'KR' };

  regionLedger.writeActivity({
    userId: userA,
    activeRegion: 'KR',
    xp: 40,
    fame: 7,
    aura: 3,
    tendency: { progressive: 18, conservative: 9, centrist: 12 },
    achievement: 'kr-badge',
    evolution: 5,
    level: 3,
    bookmark: { postId: 'kr-bookmark' },
  });

  const legacy = await repository.createPost({
    authorUserId: userA,
    territory: 'CENTRAL',
    title: '국가 없는 옛 글',
    content: '한국으로 읽는다',
    activityRegion: null,
  });
  check('옛 기록 저장값은 비어 있다', legacy.activityRegion == null);

  const krPost = await service.createPost(kr, {
    title: '한국 글',
    content: '한국 본문',
  });
  const krComment = await service.createComment(kr, krPost.post.id, {
    content: '한국 댓글',
  });
  const krReaction = await service.toggleReaction(kr, {
    targetType: 'POST',
    targetId: krPost.post.id,
    reactionType: 'LIKE',
  });
  check('한국 글 작성', krPost.post && krPost.post.title === '한국 글');
  check('한국 경험 경로는 호출된다', postXpCalls === 1 && achievementCalls >= 1);
  const xpAfterKr = postXpCalls;
  const achAfterKr = achievementCalls;
  const commentXpAfterKr = commentXpCalls;
  check('한국 댓글', krComment.comment && krComment.comment.content === '한국 댓글');
  check('한국 반응', krReaction && krReaction.action === 'CREATED');
  const storedComment = await repository.getComment(krComment.comment.id);
  check('댓글 국가는 원글과 같다', storedComment && storedComment.activityRegion === 'KR');

  const krProfile = regionLedger.readProfile(userA, 'KR');
  const usBefore = regionLedger.readProfile(userA, 'US');
  check('미국 프로필에 한국 점수가 없다',
    usBefore.xp === 0 && usBefore.fame === 0 && usBefore.aura === 0
    && usBefore.tendency == null && usBefore.achievements.length === 0
    && usBefore.evolution === 0 && usBefore.bookmarks.length === 0
    && usBefore.posts.length === 0 && usBefore.level === 1);
  check('한국 점수는 한국에 남는다',
    krProfile.xp === 40 && krProfile.fame === 7 && krProfile.achievements[0] === 'kr-badge'
    && krProfile.bookmarks[0].postId === 'kr-bookmark');

  const usList = await service.listPosts(us, { territory: 'CENTRAL' });
  check('미국 목록에 한국 글이 없다',
    titles(usList).indexOf('한국 글') === -1 && titles(usList).indexOf('국가 없는 옛 글') === -1);
  let usReadErr = null;
  try {
    await service.getPost(us, krPost.post.id);
  } catch (e) {
    usReadErr = e;
  }
  check('미국 조회는 한국 글을 거절한다', usReadErr && usReadErr.code === 'REGION_MISMATCH');
  let usCommentErr = null;
  try {
    await service.createComment(us, krPost.post.id, { content: '미국이 한국 글에 댓글' });
  } catch (e) {
    usCommentErr = e;
  }
  check('미국 댓글은 한국 원글에 못 단다', usCommentErr && usCommentErr.code === 'REGION_MISMATCH');
  let usReactErr = null;
  try {
    await service.toggleReaction(us, {
      targetType: 'POST',
      targetId: krPost.post.id,
      reactionType: 'DISLIKE',
    });
  } catch (e) {
    usReactErr = e;
  }
  check('미국 반응은 한국 글에 못 단다', usReactErr && usReactErr.code === 'REGION_MISMATCH');

  const usPost = await service.createPost(us, {
    title: 'US note',
    content: 'US body',
  });
  const usComment = await service.createComment(us, usPost.post.id, { content: 'US reply' });
  await service.toggleReaction(us, {
    targetType: 'POST',
    targetId: usPost.post.id,
    reactionType: 'LIKE',
  });
  check('미국 글은 한국 경험 경로를 호출하지 않는다', postXpCalls === xpAfterKr && achievementCalls === achAfterKr);
  check('미국 댓글은 한국 경험 경로를 호출하지 않는다', commentXpCalls === commentXpAfterKr);
  const storedUsComment = await repository.getComment(usComment.comment.id);
  check('미국 댓글 국가는 원글 US다', storedUsComment && storedUsComment.activityRegion === 'US');
  const usAfter = regionLedger.readProfile(userA, 'US');
  const krAfter = regionLedger.readProfile(userA, 'KR');
  check('미국 활동은 미국 프로필에만 있다',
    usAfter.posts.length === 1 && usAfter.comments.length === 1 && usAfter.reactions.length === 1
    && usAfter.notices.length >= 1 && usAfter.feed.length === 1 && usAfter.xp === 0
    && usAfter.tendency == null && usAfter.achievements.length === 0);
  check('한국으로 돌아오면 한국 점수가 유지된다',
    krAfter.xp === 40 && krAfter.fame === 7 && krAfter.tendency.progressive === 18
    && krAfter.achievements[0] === 'kr-badge' && krAfter.evolution === 5);
  const back = await service.listPosts(kr, { territory: 'CENTRAL' });
  check('한국 목록은 한국 글을 유지하고 미국 글은 없다',
    titles(back).indexOf('한국 글') !== -1 && titles(back).indexOf('국가 없는 옛 글') !== -1
    && titles(back).indexOf('US note') === -1);
  const krSearch = await service.listPosts(kr, { territory: 'CENTRAL', q: '한국 글' });
  const usSearch = await service.listPosts(us, { territory: 'CENTRAL', q: '한국 글' });
  const usOwnSearch = await service.listPosts(us, { q: 'US note' });
  check('검색은 같은 국가만 본다',
    titles(krSearch).indexOf('한국 글') !== -1
    && titles(usSearch).length === 0
    && titles(usOwnSearch).indexOf('US note') !== -1);
  check('임시 저장소 검색도 국가가 나뉜다',
    regionLedger.searchPosts('KR', '한국').length === 0
    && regionLedger.searchPosts('US', 'US note').length === 1
    && regionLedger.searchPosts('KR', 'US note').length === 0);

  const popularKr = await service.listPopularPosts(kr, { period: 'day', territory: 'CENTRAL', limit: 20 });
  const popularUs = await service.listPopularPosts(us, { period: 'day', territory: 'CENTRAL', limit: 20 });
  const popularIds = function (result) {
    return (result.posts || []).map(function (row) { return row.id; });
  };
  check('한국 인기글에 한국 글이 있다', popularIds(popularKr).indexOf(krPost.post.id) !== -1);
  check('미국 인기글에 한국 글이 없다', popularIds(popularUs).indexOf(krPost.post.id) === -1);
  check('미국 인기글에 미국 글이 있다', popularIds(popularUs).indexOf(usPost.post.id) !== -1);
  check('한국 인기글에 미국 글이 없다', popularIds(popularKr).indexOf(usPost.post.id) === -1);

  let editErr = null;
  try {
    await service.updatePost(other, krPost.post.id, { title: 'B가 고침', content: '안 됨' });
  } catch (e) {
    editErr = e;
  }
  check('사용자 B는 A의 글을 고치지 못한다', editErr && editErr.code === 'BOARD_FORBIDDEN');
  const still = await repository.getPost(krPost.post.id);
  check('거절된 수정은 제목을 남긴다', still && still.title === '한국 글');

  let spoofErr = null;
  try {
    await service.createPost(kr, {
      title: '파라미터로 미국에 쓰기',
      content: '거절',
      activityRegion: 'US',
    });
  } catch (e) {
    spoofErr = e;
  }
  check('한국 세션의 미국 파라미터는 거절된다', spoofErr && spoofErr.code === 'REGION_MISMATCH');
  const usTitles = titles(await service.listPosts(us, {}));
  check('거절된 글은 미국에 없다', usTitles.indexOf('파라미터로 미국에 쓰기') === -1);

  let guestErr = null;
  try {
    await service.createPost(null, { title: '손님', content: '쓰기' });
  } catch (e) {
    guestErr = e;
  }
  check('비로그인 쓰기는 거절된다', guestErr && guestErr.code === 'BOARD_AUTH_REQUIRED');

  let schemaCalls = 0;
  const blockedRepo = Object.assign({}, repository, {
    supportsActivityRegion: false,
    createPost: async function (src) {
      schemaCalls += 1;
      return repository.createPost(src);
    },
  });
  const blocked = createBoardService({
    repository: blockedRepo,
    userContext: userContext,
    operational: true,
    regionLedger: regionLedger,
  });
  let schemaErr = null;
  try {
    await blocked.createPost(us, { title: 'schema', content: 'no' });
  } catch (e) {
    schemaErr = e;
  }
  check('국가 열이 없으면 미국 글을 넣지 않는다',
    schemaErr && schemaErr.code === 'REGION_SCHEMA_UNAVAILABLE' && schemaCalls === 0);

  const selected = core.selectAlignmentBatch({
    region: 'KR',
    users: [
      { userId: userA, activityRegion: null },
      { userId: userB, activityRegion: 'US' },
    ],
    reactions: [
      { id: 'kr', activity_region: '' },
      { id: 'us', activityRegion: 'US' },
    ],
  });
  check('한국 배치는 한국과 옛 기록만 남긴다',
    selected.skipped === false
    && selected.users.length === 1 && selected.users[0].userId === userA
    && selected.reactions.length === 1 && selected.reactions[0].id === 'kr');
  const skippedPick = core.selectAlignmentBatch({ region: 'US', users: [{ userId: userA }], reactions: [] });
  check('미국 문장 모델이 없으면 점수를 만들지 않는다',
    skippedPick.skipped === true && skippedPick.reason === 'US_SENTENCE_MODEL_MISSING'
    && skippedPick.users.length === 0);

  const batchTime = '2026-11-03T00:00:00.000Z';
  const dataSource = createAlignmentMemoryDataSource({
    users: [
      {
        userId: userA,
        alignmentScore: 0,
        currentTerritory: 'CENTRAL',
        previousAlignmentSignal: 0,
      },
      {
        userId: userB,
        alignmentScore: 80,
        currentTerritory: 'PIONEER',
        previousAlignmentSignal: 0,
        activityRegion: 'US',
      },
    ],
    reactions: [],
  });
  let persistCalls = 0;
  const memoryRepo = {
    async getBatchRecord() { return null; },
    async persistBatchPlan() {
      persistCalls += 1;
      return { success: true };
    },
  };
  const usBatch = await runAlignmentBatch({
    batchId: 'alignment-us-skip',
    batchTime: batchTime,
    activityRegion: 'US',
    dataSource: dataSource,
    repository: memoryRepo,
    dryRun: false,
  });
  check('미국 배치는 저장하지 않고 건너뛴다',
    usBatch.skipped === true && usBatch.skipReason === 'US_SENTENCE_MODEL_MISSING'
    && usBatch.persisted === false && persistCalls === 0);
  const krBatch = await runAlignmentBatch({
    batchId: 'alignment-kr-only',
    batchTime: batchTime,
    dataSource: dataSource,
    repository: memoryRepo,
    dryRun: true,
  });
  const krIds = (krBatch.batchResult && krBatch.batchResult.userResults || []).map(function (row) {
    return row.userId;
  });
  check('국가를 생략한 배치는 한국만 계산한다',
    krBatch.dryRun === true && persistCalls === 0
    && krIds.indexOf(userA) !== -1 && krIds.indexOf(userB) === -1);

  const scoring = fs.readFileSync(path.join(__dirname, '..', 'public', 'alignment-scoring.js'), 'utf8');
  check('성향식 가중치는 그대로다',
    scoring.indexOf('W_REACTOR_LIKE = 2.0') !== -1
    && scoring.indexOf('W_REACTOR_DISLIKE = -0.6') !== -1
    && scoring.indexOf('W_AUTHOR_LIKE = 1.0') !== -1);

  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migration_activity_region_v2.sql'), 'utf8');
  check('마이그레이션은 삭제와 기존 행 갱신이 없다',
    sql.indexOf('DELETE FROM') === -1 && sql.indexOf('TRUNCATE') === -1 && sql.indexOf('UPDATE public') === -1);
  check('마이그레이션은 반복 실행 문법을 쓴다',
    sql.indexOf('ADD COLUMN IF NOT EXISTS') !== -1
    && sql.indexOf('CREATE TABLE IF NOT EXISTS') !== -1
    && sql.indexOf('CREATE INDEX IF NOT EXISTS') !== -1
    && sql.indexOf('DROP POLICY IF EXISTS') !== -1
    && sql.indexOf('DROP TRIGGER IF EXISTS') !== -1);
  check('RLS는 새 점수 표만 켠다',
    sql.indexOf('user_activity_region_profile ENABLE ROW LEVEL SECURITY') !== -1
    && sql.indexOf('user_activity_region_achievement ENABLE ROW LEVEL SECURITY') !== -1
    && sql.indexOf('board_posts ENABLE ROW LEVEL SECURITY') === -1);
  check('빈 국가는 KR로 읽고 US 기본값은 없다',
    sql.indexOf("THEN 'KR'") !== -1 && sql.indexOf("DEFAULT 'US'") === -1);
  const mapper = createBoardDataMapper();
  const blankRow = mapper.fromDbPost({ id: 'p', title: '옛글', content: '본문', activity_region: null });
  const usRow = mapper.fromDbPost({ id: 'u', title: 'us', content: 'body', activity_region: 'US' });
  check('운영 글 읽기는 빈 국가를 한국으로, US는 US로 본다',
    core.rowRegion(blankRow) === 'KR' && core.rowRegion(usRow) === 'US'
    && core.rowRegion(mapper.fromDbComment({ id: 'c', activity_region: '' })) === 'KR');

  const pioneer = await service.createPost(
    { userId: pioneerUser, activityRegion: 'KR' },
    { title: '진보 잠긴 글', content: '게스트 금지' }
  );
  const app = express();
  app.use(express.json());
  app.use('/api/board', createBoardRouter({
    operational: true,
    useMemory: true,
    repository: repository,
    regionLedger: regionLedger,
    userContext: userContext,
  }));
  const server = await new Promise(function (resolve) {
    const s = app.listen(0, '127.0.0.1', function () { resolve(s); });
  });
  try {
    const guestWrite = await request(server, 'POST', '/api/board/posts', {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    }, { title: '손님 글', content: '거절' });
    check('비로그인 HTTP 쓰기는 401이다',
      guestWrite.status === 401 && guestWrite.json && guestWrite.json.error === 'BOARD_AUTH_REQUIRED');
    const locked = await request(server, 'GET', '/api/board/posts/' + pioneer.post.id, {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    });
    check('게스트는 잠긴 게시판을 열지 못한다',
      locked.status === 403 && locked.json && locked.json.error === 'BOARD_FORBIDDEN');
    const central = await request(server, 'GET', '/api/board/posts/' + krPost.post.id, {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    });
    check('게스트는 중앙 글을 읽는다',
      central.status === 200 && central.json && central.json.post && central.json.post.title === '한국 글');
    const spoofHttp = await request(server, 'POST', '/api/board/posts', {
      cookie: 'sa_ar=KR; sa_ar_x=1',
      'x-user-id': userA,
    }, { title: '헤더로 미국 쓰기', content: '거절', activityRegion: 'US' });
    check('x-user-id만으로는 글을 쓰지 못한다',
      spoofHttp.status === 401 && spoofHttp.json && spoofHttp.json.error === 'BOARD_AUTH_REQUIRED');
    const querySpoof = await request(server, 'GET', '/api/board/posts?activityRegion=US', {
      cookie: 'sa_ar=KR; sa_ar_x=1',
      'x-user-id': userA,
    });
    check('조회 국가 파라미터 조작은 403이다',
      querySpoof.status === 403 && querySpoof.json && querySpoof.json.error === 'REGION_MISMATCH');
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }

  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('TEMP_STORE_TESTS_PASS');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
