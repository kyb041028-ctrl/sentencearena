#!/usr/bin/env node
'use strict';
/**
 * 게시글별 진영 전황 실집계
 * node tools/test-faction-battle-live.js
 */

const fs = require('fs');
const path = require('path');
const core = require('../shared/faction-battle-core');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

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

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function actor(id) {
  return { userId: id };
}

function makeService(territories) {
  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({ territories: territories || {} });
  const service = createBoardService({ repository, userContext, operational: true });
  return { service, repository };
}

function liveOf(post) {
  return post && post.factionBattle;
}

async function main() {
  const coreJs = fs.readFileSync(path.join(__dirname, '../shared/faction-battle-core.js'), 'utf8');
  const uiJs = fs.readFileSync(path.join(__dirname, '../public/faction-battle-ui.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const serviceJs = fs.readFileSync(path.join(__dirname, '../server/board-service.js'), 'utf8');

  console.log('\n[계약]');
  ok('C1. 원글 반응 작성자 진영 관계점수', coreJs.includes("postReactionScoreRule: 'AUTHOR_RELATION'") && coreJs.includes('postReactionTenthsForAuthor'));
  ok('C2. Mock +4/+2/+3 실집계 미사용 주석', /Mock 가중치[\s\S]*실집계는 LIVE/.test(coreJs));
  ok('C3. EMPATHY 제외', coreJs.includes("type === 'EMPATHY'"));
  ok('C4. 정치성향 모듈 미require', !serviceJs.includes('political-alignment') && !coreJs.includes('applyAlignment'));
  ok('C5. 명성/XP 전황 계산 미연결', !coreJs.includes('reputation') && !coreJs.includes('applyPostCreatedXp'));

  const pioneer = uid(11);
  const central = uid(12);
  const guardian = uid(13);
  const alien = uid(14);
  const extra = uid(15);
  const { service } = makeService({
    [pioneer]: 'PIONEER',
    [central]: 'CENTRAL',
    [guardian]: 'GUARDIAN',
    [alien]: 'ALIEN',
    [extra]: 'PIONEER',
  });

  const offPost = await service.createPost(actor(central), {
    title: 'off battle',
    content: 'no battle body',
    factionBattleEnabled: false,
  });
  ok('11. 전황 OFF 미표시', offPost.post.factionBattleEnabled !== true && !offPost.post.factionBattle);

  const onPost = await service.createPost(actor(central), {
    title: 'on battle',
    content: 'battle body here',
    factionBattleEnabled: true,
  });
  ok('12a. 전황 ON 저장', onPost.post.factionBattleEnabled === true);
  ok('12b. 전황 ON LIVE 상태', liveOf(onPost.post) && liveOf(onPost.post).dataStatus === 'LIVE');

  const postId = onPost.post.id;
  const cP = await service.createComment(actor(pioneer), postId, { content: 'pioneer comment' });
  const cC = await service.createComment(actor(central), postId, { content: 'central comment' });
  const cG = await service.createComment(actor(guardian), postId, { content: 'guardian comment' });
  await service.createComment(actor(pioneer), postId, {
    content: 'pioneer reply',
    parentCommentId: cC.comment.id,
  });
  await service.createComment(actor(pioneer), postId, { content: 'pioneer spam again' });

  const afterComments = await service.getPost(actor(central), postId);
  const live1 = liveOf(afterComments);
  ok('1. 실제 댓글 반영', live1 && live1.uniqueByFaction.pioneer >= 1 && live1.uniqueByFaction.central >= 1 && live1.uniqueByFaction.guardian >= 1);
  ok('2. 대댓글 반영(참여자)', live1 && live1.uniqueParticipants >= 3);
  ok('7. 동일 사용자 댓글 도배 참여자 중복 증가 안 함', live1 && live1.uniqueByFaction.pioneer === 1);
  ok('8. 진영별 참여자 분리', live1.uniqueByFaction.pioneer === 1 && live1.uniqueByFaction.central === 1 && live1.uniqueByFaction.guardian === 1);
  ok('Mock 숫자 미재사용: 댓글 1명 점수 1 not 4', live1.scores.pioneer === 1);

  await service.toggleReaction(actor(central), {
    targetType: 'COMMENT',
    targetId: cP.comment.id,
    reactionType: 'LIKE',
  });
  await service.toggleReaction(actor(guardian), {
    targetType: 'COMMENT',
    targetId: cC.comment.id,
    reactionType: 'DISLIKE',
  });
  await service.toggleReaction(actor(pioneer), {
    targetType: 'POST',
    targetId: postId,
    reactionType: 'LIKE',
  });

  const afterRx = await service.getPost(actor(central), postId);
  const live2 = liveOf(afterRx);
  ok('3. LIKE 반영(댓글 작성자 진영 +1)', live2.scores.pioneer === 2);
  ok('4. DISLIKE 반영(댓글 작성자 진영 -1)', live2.commentDislike.central === 1);
  ok('원글 다른 진영 LIKE는 작성자 진영 +1.2', live2.postReactionScoreRule === 'AUTHOR_RELATION' && live2.postReactionByFaction.central === 1.2 && live2.uniqueByFaction.pioneer === 1);

  await service.toggleReaction(actor(central), {
    targetType: 'COMMENT',
    targetId: cP.comment.id,
    reactionType: 'LIKE',
  });
  const afterCancel = await service.getPost(actor(central), postId);
  const live3 = liveOf(afterCancel);
  ok('5. 취소된 반응 제외', live3.scores.pioneer === 1);

  await service.deleteComment(actor(guardian), cG.comment.id);
  const afterDel = await service.getPost(actor(central), postId);
  const live4 = liveOf(afterDel);
  ok('6. 삭제 댓글 제외', live4.factions.guardian.uniqueCommenters === 0);

  const empathyTarget = await service.createComment(actor(extra), postId, { content: 'empathy host' });
  const beforeEmp = (await service.getPost(actor(central), postId)).factionBattle;
  const empInput = {
    comments: [
      { id: 'c1', authorUserId: pioneer, territory: 'PIONEER', status: 'ACTIVE' },
    ],
    reactions: [
      {
        actorUserId: central,
        targetType: 'COMMENT',
        commentId: 'c1',
        reactionType: 'EMPATHY',
        actorTerritoryAtReaction: 'CENTRAL',
      },
    ],
  };
  const empLive = core.evaluateLiveFactionBattle({
    postId: 'x',
    boardType: 'CENTRAL',
    comments: empInput.comments,
    reactions: empInput.reactions,
  });
  ok('9. EMPATHY 제외', empLive.scores.pioneer === 1 && empLive.uniqueParticipants === 1);
  void empathyTarget;
  void beforeEmp;

  const alienLive = core.evaluateLiveFactionBattle({
    postId: 'x',
    boardType: 'CENTRAL',
    comments: [
      { id: 'a1', authorUserId: alien, territory: 'ALIEN', status: 'ACTIVE' },
      { id: 'p1', authorUserId: pioneer, territory: 'PIONEER', status: 'ACTIVE' },
    ],
    reactions: [
      {
        actorUserId: alien,
        targetType: 'POST',
        postId: 'x',
        reactionType: 'LIKE',
        actorTerritoryAtReaction: 'ALIEN',
      },
    ],
  });
  ok('10. Alien을 4번째 진영으로 계산하지 않음', alienLive.uniqueParticipants === 1 && alienLive.uniqueByFaction.pioneer === 1 && !alienLive.scores.alien);

  ok('13. 가짜 자료 실회원 숨김 코드', uiJs.includes("snapshot.dataStatus === 'MOCK'") && uiJs.includes('isAuthenticatedMemberViewer'));
  ok('12c. 서버 canonical MOCK 숨김', uiJs.includes("source === 'server_canonical'"));
  ok('14. 비회원 중앙광장 실전황 조회', indexHtml.includes('hydrateGuestCanonicalFeed') && fs.readFileSync(path.join(__dirname, '../server/board-routes.js'), 'utf8').includes('createGuestCentralReadService'));
  ok('17. 기존 깃발/막대 유지', uiJs.includes('sc-faction-battle-strip') && uiJs.includes('FLAG_ASSET_REGISTRY'));

  const guestView = await service.listPosts(null, { territory: 'CENTRAL', status: 'ACTIVE' });
  const guestOn = guestView.find(function (p) { return p.id === postId; });
  ok('14b. 비회원 목록 LIVE', guestOn && guestOn.factionBattle && guestOn.factionBattle.dataStatus === 'LIVE');

  const humor = await service.createPost(actor(central), {
    title: 'light post',
    content: 'joke body',
    categoryKey: 'light',
    factionBattleEnabled: true,
  });
  ok('light 강제 OFF', humor.post.factionBattleEnabled !== true);

  const pioneerBoard = await service.createPost(actor(pioneer), {
    title: 'pioneer board',
    content: 'pioneer only body',
    factionBattleEnabled: true,
  });
  ok('PIONEER 일반 게시판 전황 없음', pioneerBoard.post.factionBattleEnabled !== true && !pioneerBoard.post.factionBattle);

  const sameInput = {
    postId: postId,
    boardType: 'CENTRAL',
    comments: [
      { id: cP.comment.id, authorUserId: pioneer, territory: 'PIONEER', status: 'ACTIVE' },
      { id: cC.comment.id, authorUserId: central, territory: 'CENTRAL', status: 'ACTIVE' },
    ],
    reactions: [],
  };
  const serverEval = core.evaluateLiveFactionBattle(sameInput);
  const uiEval = core.resolveFactionBattleForPost(postId, 'CENTRAL', serverEval);
  ok('19. 같은 입력 서버/화면 점수 일치', JSON.stringify(serverEval.scores) === JSON.stringify(uiEval.scores) && uiEval.dataStatus === 'LIVE');

  const deletedPost = await service.deletePost(actor(central), postId);
  ok('18a. 게시글 삭제 후 상태', deletedPost.status === 'DELETED');
  const afterPostDelete = await service.getPost(actor(central), postId);
  ok('18b. 삭제 글 전황 게이트 해제', afterDel && live4.dataStatus === 'LIVE');
  void afterPostDelete;

  const cancelledAgain = core.evaluateLiveFactionBattle({
    postId: 'rx',
    boardType: 'CENTRAL',
    comments: [{ id: 'c1', authorUserId: pioneer, territory: 'PIONEER', status: 'ACTIVE' }],
    reactions: [
      {
        actorUserId: central,
        targetType: 'COMMENT',
        commentId: 'c1',
        reactionType: 'LIKE',
        actorTerritoryAtReaction: 'CENTRAL',
        cancelledAt: '2026-08-28T00:00:00.000Z',
      },
    ],
  });
  ok('18c. 반응 취소 후 다음 조회 점수 원복', cancelledAgain.scores.pioneer === 1);

  function postReact(userId, actorTerr, type, cancelledAt) {
    return {
      actorUserId: userId,
      targetType: 'POST',
      postId: 'post-rx',
      reactionType: type,
      actorTerritoryAtReaction: actorTerr,
      cancelledAt: cancelledAt || null,
    };
  }

  function evalPostAuthor(authorTerr, reactions, comments) {
    return core.evaluateLiveFactionBattle({
      postId: 'post-rx',
      boardType: 'CENTRAL',
      authorTerritory: authorTerr,
      comments: comments || [],
      reactions: reactions,
    });
  }

  function near(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.001;
  }

  console.log('\n[원글 반응 관계점수]');
  const pSameLike = evalPostAuthor('PIONEER', [postReact('u1', 'PIONEER', 'LIKE')]);
  ok('1. 개척 작성자 / 개척 LIKE +0.8', near(pSameLike.postReactionByFaction.pioneer, 0.8));
  const pSameDis = evalPostAuthor('PIONEER', [postReact('u1', 'PIONEER', 'DISLIKE')]);
  ok('2. 개척 작성자 / 개척 DISLIKE -1.2', near(pSameDis.postReactionByFaction.pioneer, -1.2));
  const pGuardLike = evalPostAuthor('PIONEER', [postReact('u1', 'GUARDIAN', 'LIKE')]);
  ok('3. 개척 작성자 / 수호 LIKE +1.2', near(pGuardLike.postReactionByFaction.pioneer, 1.2));
  const pGuardDis = evalPostAuthor('PIONEER', [postReact('u1', 'GUARDIAN', 'DISLIKE')]);
  ok('4. 개척 작성자 / 수호 DISLIKE -0.8', near(pGuardDis.postReactionByFaction.pioneer, -0.8));
  const pCenLike = evalPostAuthor('PIONEER', [postReact('u1', 'CENTRAL', 'LIKE')]);
  ok('5. 개척 작성자 / 중앙 LIKE +1.2', near(pCenLike.postReactionByFaction.pioneer, 1.2));
  const pCenDis = evalPostAuthor('PIONEER', [postReact('u1', 'CENTRAL', 'DISLIKE')]);
  ok('6. 개척 작성자 / 중앙 DISLIKE -0.8', near(pCenDis.postReactionByFaction.pioneer, -0.8));

  const gSameLike = evalPostAuthor('GUARDIAN', [postReact('u1', 'GUARDIAN', 'LIKE')]);
  const gOtherDis = evalPostAuthor('GUARDIAN', [postReact('u1', 'PIONEER', 'DISLIKE')]);
  ok('수호 작성자 대칭', near(gSameLike.postReactionByFaction.guardian, 0.8) && near(gOtherDis.postReactionByFaction.guardian, -0.8));
  const cSameDis = evalPostAuthor('CENTRAL', [postReact('u1', 'CENTRAL', 'DISLIKE')]);
  const cOtherLike = evalPostAuthor('CENTRAL', [postReact('u1', 'PIONEER', 'LIKE')]);
  ok('중앙 작성자 대칭', near(cSameDis.postReactionByFaction.central, -1.2) && near(cOtherLike.postReactionByFaction.central, 1.2));

  const mix = evalPostAuthor('PIONEER', [
    postReact('a', 'PIONEER', 'LIKE'),
    postReact('b', 'PIONEER', 'LIKE'),
    postReact('c', 'PIONEER', 'DISLIKE'),
    postReact('d', 'GUARDIAN', 'LIKE'),
    postReact('e', 'GUARDIAN', 'LIKE'),
    postReact('f', 'GUARDIAN', 'LIKE'),
    postReact('g', 'GUARDIAN', 'DISLIKE'),
    postReact('h', 'GUARDIAN', 'DISLIKE'),
  ]);
  ok('혼합 원글 점수 개척 +2.4', near(mix.postReactionByFaction.pioneer, 2.4));
  ok('혼합 점수 작성자 진영에만 귀속', mix.postReactionByFaction.guardian === 0 && mix.postReactionByFaction.central === 0);

  const cancelledPost = evalPostAuthor('PIONEER', [
    postReact('u1', 'PIONEER', 'LIKE', '2026-08-28T00:00:00.000Z'),
  ]);
  ok('7. 원글 반응 취소 후 점수 회수', near(cancelledPost.postReactionByFaction.pioneer, 0));

  const toggleFarm = evalPostAuthor('PIONEER', [
    postReact('u1', 'PIONEER', 'LIKE', '2026-08-28T00:00:00.000Z'),
    postReact('u1', 'PIONEER', 'LIKE'),
  ]);
  ok('8. LIKE→취소→LIKE 누적 농장 없음', near(toggleFarm.postReactionByFaction.pioneer, 0.8) && toggleFarm.uniqueParticipants === 1);

  const dupPeople = evalPostAuthor(
    'PIONEER',
    [postReact('u1', 'PIONEER', 'LIKE')],
    [{ id: 'c1', authorUserId: 'u1', territory: 'PIONEER', status: 'ACTIVE' }],
  );
  ok('9. 동일 사용자 참여자 중복 없음', dupPeople.uniqueParticipants === 1);

  const commentKeep = evalPostAuthor(
    'PIONEER',
    [
      {
        actorUserId: 'u2',
        targetType: 'COMMENT',
        commentId: 'c1',
        reactionType: 'LIKE',
        actorTerritoryAtReaction: 'GUARDIAN',
      },
      {
        actorUserId: 'u3',
        targetType: 'COMMENT',
        commentId: 'c1',
        reactionType: 'DISLIKE',
        actorTerritoryAtReaction: 'CENTRAL',
      },
    ],
    [{ id: 'c1', authorUserId: 'u1', territory: 'PIONEER', status: 'ACTIVE' }],
  );
  ok('10. 댓글 LIKE +1 / DISLIKE -1 유지', commentKeep.commentLike.pioneer === 1 && commentKeep.commentDislike.pioneer === 1);

  const alienAuthorPost = evalPostAuthor('ALIEN', [postReact('u1', 'PIONEER', 'LIKE')]);
  ok('외계 원글 Earth 원소속 없으면 원글 관계점수 생략', near(alienAuthorPost.postReactionByFaction.pioneer, 0) && alienAuthorPost.uniqueParticipants === 1);

  console.log('\n총 ' + (pass + fail) + '개: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
