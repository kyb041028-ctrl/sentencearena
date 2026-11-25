#!/usr/bin/env node
'use strict';

/**
 * 국가 구조가 켜진 목록·검색·프로필 건수.
 * 메모리 함수와 HTTP만 실행한다. 화면과 운영 Postgres는 실행하지 않는다.
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');

const progression = require('../server/user-progression-service');
const evaluator = require('../server/achievement-evaluator-service');
progression.applyPostCreatedXp = async function () {
  throw new Error('PROGRESSION_BLOCKED_IN_TEMP_TEST');
};
progression.applyBoardCommentCreatedXp = async function () {
  throw new Error('PROGRESSION_BLOCKED_IN_TEMP_TEST');
};
evaluator.evaluateAfterPostCreated = async function () {
  throw new Error('ACHIEVEMENT_BLOCKED_IN_TEMP_TEST');
};
evaluator.evaluateAfterCommentCreated = async function () {
  throw new Error('ACHIEVEMENT_BLOCKED_IN_TEMP_TEST');
};
evaluator.evaluateAfterLevelUp = async function () {
  throw new Error('ACHIEVEMENT_BLOCKED_IN_TEMP_TEST');
};

const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardRouter } = require('../server/board-routes');
const { createActivityRegionStore } = require('../server/activity-region-store');
const profileLists = require('../server/profile-activity-list-service');
const ranks = require('../shared/rank-formula-core');

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
    return;
  }
  console.log('PASS', name);
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function titles(rows) {
  return (rows || []).map(function (row) { return row && row.title; });
}

function request(server, method, urlPath, headers) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method: method,
      path: urlPath,
      headers: headers || {},
    }, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const userA = uid(1);
  const userB = uid(2);
  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({
    territories: { [userA]: 'CENTRAL', [userB]: 'CENTRAL' },
  });
  const service = createBoardService({
    repository: repository,
    userContext: userContext,
    operational: true,
    regionLedger: createActivityRegionStore(),
    countryStructure: true,
  });
  const kr = { userId: userA, activityRegion: 'KR' };
  const us = { userId: userA, activityRegion: 'US' };
  const krB = { userId: userB, activityRegion: 'KR' };
  const usB = { userId: userB, activityRegion: 'US' };

  await service.createPost(kr, { title: 'KR-1', content: '한국 본문' });
  await service.createPost(kr, { title: 'KR-2', content: '한국 본문' });
  await service.createPost(kr, { title: '같은 제목', content: '한국 본문' });
  await service.createPost(us, { title: 'US-1', content: 'US body' });
  await service.createPost(us, { title: '같은 제목', content: 'US body' });
  const blank = await repository.createPost({
    authorUserId: userA,
    territory: 'CENTRAL',
    title: '국가 없는 글',
    content: '어느 목록에도 없음',
    activityRegion: null,
  });
  check('함수 빈 글 저장값은 null', blank.activityRegion == null);

  const krPosts = await service.listPosts(kr, { territory: 'CENTRAL' });
  const usPosts = await service.listPosts(us, { territory: 'CENTRAL' });
  check('1 함수 KR 목록 3', krPosts.length === 3 && titles(krPosts).indexOf('국가 없는 글') === -1 && titles(krPosts).indexOf('US-1') === -1);
  check('2 함수 US 목록 2', usPosts.length === 2 && titles(usPosts).indexOf('국가 없는 글') === -1 && titles(usPosts).indexOf('KR-1') === -1);
  check('3 함수 빈 글은 국가별 목록에 없음',
    titles(krPosts).indexOf('국가 없는 글') === -1 && titles(usPosts).indexOf('국가 없는 글') === -1);

  const krSearchUs = await service.listPosts(kr, { territory: 'CENTRAL', q: 'US-1' });
  const usSearchKr = await service.listPosts(us, { territory: 'CENTRAL', q: 'KR-1' });
  const krSame = await service.listPosts(kr, { territory: 'CENTRAL', q: '같은 제목' });
  const usSame = await service.listPosts(us, { territory: 'CENTRAL', q: '같은 제목' });
  check('4 함수 KR 검색에 US 없음', krSearchUs.length === 0);
  check('5 함수 US 검색에 KR 없음', usSearchKr.length === 0);
  check('6 함수 검색 총건수 국가별', krSame.length === 1 && usSame.length === 1);

  const krRows = [];
  const usRows = [];
  const all = await repository.listPosts({ territory: 'CENTRAL' });
  all.forEach(function (row) {
    if (row.authorUserId !== userA) return;
    const item = {
      id: row.id,
      author_user_id: row.authorUserId,
      title: row.title,
      territory: row.territory,
      status: row.status,
      activity_region: row.activityRegion,
      created_at: row.createdAt,
      comment_count: row.commentCount,
    };
    if (row.activityRegion === 'KR') krRows.push(item);
    if (row.activityRegion === 'US') usRows.push(item);
  });
  const krPage = profileLists.listPostsFromRows(krRows.concat(usRows).concat([{
    id: blank.id,
    author_user_id: userA,
    title: blank.title,
    territory: 'CENTRAL',
    status: 'ACTIVE',
    activity_region: null,
    created_at: blank.createdAt,
    comment_count: 0,
  }]), { userId: userA, region: 'KR', page: 1 });
  const usPage = profileLists.listPostsFromRows(krRows.concat(usRows), { userId: userA, region: 'US', page: 1 });
  const krPageTitles = krPage.items.map(function (row) { return row.title; });
  const usPageTitles = usPage.items.map(function (row) { return row.title; });
  check('7 함수 페이지에 상대 국가 없음',
    krPage.totalItems === 3 && usPage.totalItems === 2
    && krPageTitles.indexOf('US-1') === -1 && krPageTitles.indexOf('국가 없는 글') === -1
    && usPageTitles.indexOf('KR-1') === -1);
  check('8 함수 KR 프로필 글 3', krPage.totalItems === 3);
  check('9 함수 US 프로필 글 2', usPage.totalItems === 2);

  const krPostIds = krRows.map(function (row) { return row.id; });
  const usPostIds = usRows.map(function (row) { return row.id; });
  for (let i = 0; i < 4; i++) {
    await service.createComment(kr, krPostIds[i % krPostIds.length], { content: 'KR 댓글 ' + i });
  }
  for (let i = 0; i < 3; i++) {
    await service.createComment(us, usPostIds[i % usPostIds.length], { content: 'US comment ' + i });
  }
  const commentRows = (await repository.listCommentsForPosts(krPostIds.concat(usPostIds, [blank.id]))).map(function (row) {
    return {
      id: row.id,
      post_id: row.postId,
      author_user_id: row.authorUserId,
      content: row.content,
      territory: row.territory,
      status: row.status,
      activity_region: row.activityRegion,
      created_at: row.createdAt,
    };
  });
  const krComments = profileLists.listCommentsFromRows(commentRows, krRows.concat(usRows), { userId: userA, region: 'KR', page: 1 });
  const usComments = profileLists.listCommentsFromRows(commentRows, krRows.concat(usRows), { userId: userA, region: 'US', page: 1 });
  check('10 함수 댓글 KR 4 US 3', krComments.totalItems === 4 && usComments.totalItems === 3);

  const otherKr = await service.createPost(krB, { title: 'B-KR', content: '다른 회원' });
  const otherUs = await service.createPost(usB, { title: 'B-US', content: 'other' });
  await service.toggleReaction(kr, { targetType: 'POST', targetId: otherKr.post.id, reactionType: 'LIKE' });
  await service.toggleReaction(us, { targetType: 'POST', targetId: otherUs.post.id, reactionType: 'LIKE' });
  const cancel = await service.toggleReaction(us, { targetType: 'POST', targetId: otherUs.post.id, reactionType: 'LIKE' });
  check('함수 미국 반응 취소', cancel && cancel.action === 'CANCELLED');
  const openReactions = await repository.listReactionsForPosts([otherKr.post.id, otherUs.post.id]);
  const openKr = openReactions.filter(function (row) {
    return row.cancelledAt == null && row.activityRegion === 'KR';
  });
  const openUs = openReactions.filter(function (row) {
    return row.cancelledAt == null && row.activityRegion === 'US';
  });
  check('함수 작성 반응은 취소 후 국가별', openKr.length === 1 && openUs.length === 0);

  function empathy(region, n, revoked) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        id: region + '-' + i,
        user_id: userA,
        activity_type: 'EMPATHY_RECEIVED',
        activity_region: region,
        source_type: 'board_post',
        source_id: region === 'KR' ? krPostIds[0] : usPostIds[0],
        dedupe_key: 'EMPATHY_RECEIVED:' + (region === 'KR' ? krPostIds[0] : usPostIds[0]) + ':' + uid(9),
        occurred_at: '2026-11-15T0' + i + ':00:00.000Z',
        revoked: false,
      });
    }
    rows.push({
      id: region + '-revoked',
      user_id: userA,
      activity_type: 'EMPATHY_RECEIVED',
      activity_region: region,
      source_type: 'board_post',
      source_id: region === 'KR' ? krPostIds[0] : usPostIds[0],
      dedupe_key: 'EMPATHY_RECEIVED:revoked:' + uid(8),
      occurred_at: '2026-11-15T09:00:00.000Z',
      revoked: revoked,
    });
    rows.push({
      id: 'blank-empathy',
      user_id: userA,
      activity_type: 'EMPATHY_RECEIVED',
      activity_region: null,
      source_type: 'board_post',
      source_id: blank.id,
      dedupe_key: 'EMPATHY_RECEIVED:blank:' + uid(7),
      occurred_at: '2026-11-15T10:00:00.000Z',
      revoked: false,
    });
    return rows;
  }
  const events = empathy('KR', 5, true).concat(empathy('US', 2, true));
  const krLikes = profileLists.listLikesFromRows(events, krRows.concat(usRows), [], { userId: userA, region: 'KR', page: 1 });
  const usLikes = profileLists.listLikesFromRows(events, krRows.concat(usRows), [], { userId: userA, region: 'US', page: 1 });
  check('11 함수 공감 KR 5 US 2, 취소와 빈 국가는 제외',
    krLikes.totalLikes === 5 && usLikes.totalLikes === 2);

  const bRows = [
    { id: otherKr.post.id, author_user_id: userB, title: 'B-KR', status: 'ACTIVE', activity_region: 'KR', created_at: otherKr.post.createdAt, territory: 'CENTRAL', comment_count: 0 },
    { id: otherUs.post.id, author_user_id: userB, title: 'B-US', status: 'ACTIVE', activity_region: 'US', created_at: otherUs.post.createdAt, territory: 'CENTRAL', comment_count: 0 },
  ];
  const bKr = profileLists.listPostsFromRows(bRows, { userId: userB, region: 'KR', page: 1 });
  const bUs = profileLists.listPostsFromRows(bRows, { userId: userB, region: 'US', page: 1 });
  check('13 함수 다른 회원 공개 프로필도 국가별',
    bKr.totalItems === 1 && bKr.items[0].title === 'B-KR'
    && bUs.totalItems === 1 && bUs.items[0].title === 'B-US');

  check('14 함수 계급 가중치 유지',
    ranks.WEIGHTS.fame === 0.45 && ranks.WEIGHTS.uniqueEvaluators === 0.3
    && ranks.WEIGHTS.reactions === 0.15 && ranks.WEIGHTS.followers === 0.1);
  const storyDir = path.join(__dirname, '..', 'public', 'assets', 'achievements', 'story');
  check('14 함수 업적 mp4 바이트 유지',
    fs.statSync(path.join(storyDir, 'first-comment-kr.mp4')).size === 6792520
    && fs.statSync(path.join(storyDir, 'first-comment-us.mp4')).size === 6838763
    && fs.statSync(path.join(storyDir, 'first-empathy-kr.mp4')).size === 6519580
    && fs.statSync(path.join(storyDir, 'first-empathy-us.mp4')).size === 6592143);

  const app = express();
  app.use('/api/board', createBoardRouter({
    operational: true,
    useMemory: true,
    repository: repository,
    userContext: userContext,
  }));
  const server = await new Promise(function (resolve) {
    const s = app.listen(0, '127.0.0.1', function () { resolve(s); });
  });
  try {
    const krHttp = await request(server, 'GET', '/api/board/posts?territory=CENTRAL', {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    });
    const usHttp = await request(server, 'GET', '/api/board/posts?territory=CENTRAL', {
      cookie: 'sa_ar=US; sa_ar_x=1',
    });
    const krAgain = await request(server, 'GET', '/api/board/posts?territory=CENTRAL', {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    });
    const krHttpTitles = titles(krHttp.json && krHttp.json.posts);
    const usHttpTitles = titles(usHttp.json && usHttp.json.posts);
    const krAgainTitles = titles(krAgain.json && krAgain.json.posts);
    check('1 HTTP KR 목록에는 US와 빈 글이 없음',
      krHttp.status === 200 && krHttpTitles.indexOf('KR-1') !== -1
      && krHttpTitles.indexOf('US-1') === -1 && krHttpTitles.indexOf('국가 없는 글') === -1
      && krHttpTitles.indexOf('B-US') === -1 && krHttpTitles.indexOf('B-KR') !== -1);
    check('2 HTTP US 목록에는 KR와 빈 글이 없음',
      usHttp.status === 200 && usHttpTitles.indexOf('US-1') !== -1
      && usHttpTitles.indexOf('KR-1') === -1 && usHttpTitles.indexOf('국가 없는 글') === -1
      && usHttpTitles.indexOf('B-KR') === -1 && usHttpTitles.indexOf('B-US') !== -1);
    check('12 HTTP 국가를 바꿔도 이전 목록이 남지 않음',
      krAgain.status === 200
      && krAgainTitles.indexOf('US-1') === -1 && krAgainTitles.indexOf('KR-1') !== -1
      && usHttpTitles.indexOf('KR-1') === -1);
    const krFind = await request(server, 'GET', '/api/board/posts?territory=CENTRAL&q=' + encodeURIComponent('US-1'), {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    });
    const usFind = await request(server, 'GET', '/api/board/posts?territory=CENTRAL&q=' + encodeURIComponent('같은 제목'), {
      cookie: 'sa_ar=US; sa_ar_x=1',
    });
    check('4 HTTP KR 검색에 US 없음', krFind.status === 200 && titles(krFind.json && krFind.json.posts).length === 0);
    check('6 HTTP US 같은 제목 검색은 1건', usFind.status === 200 && titles(usFind.json && usFind.json.posts).length === 1);
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }

  console.log('SCREEN_PROFILE_LIST NOT RUN');
  console.log('POSTGRES_LIST_QUERY NOT RUN');
  console.log('FOLLOWER_COUNT NOT RUN');
  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('LIST_COUNT_TESTS_PASS');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
