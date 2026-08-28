#!/usr/bin/env node
'use strict';
/**
 * 인기글 실제 활동 점수
 * node tools/test-popular-posts.js
 */

const fs = require('fs');
const path = require('path');
const core = require('../shared/popular-posts-core');
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

const author = uid(1);
const u2 = uid(2);
const u3 = uid(3);
const u4 = uid(4);
const NOW = Date.parse('2026-08-28T03:00:00.000Z'); // 한국 12:00

function scoreOf(result, postId) {
  const list = result && result.posts ? result.posts : [];
  let i;
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === postId) return result.posts[i].popularScore;
  }
  return 0;
}

function included(result, postId) {
  const list = result && result.posts ? result.posts : [];
  return list.some(function (p) {
    return p && p.id === postId;
  });
}

function breakdownOf(result, postId) {
  const list = result && result.posts ? result.posts : [];
  let i;
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === postId) return list[i].popularBreakdown;
  }
  return null;
}

async function popular(service, period) {
  return service.listPopularPosts(actor(author), {
    period: period,
    territory: 'CENTRAL',
    nowMs: NOW,
    limit: 50,
  });
}

function stampPostCreated(repository, postId, iso) {
  const row = repository._debug.posts.get(postId);
  if (row) row.createdAt = iso;
}

function stampReactionCreated(repository, postId, iso) {
  repository._debug.reactions.forEach(function (r) {
    if (r.postId === postId && !r.cancelledAt) r.createdAt = iso;
  });
}

function stampCommentCreated(repository, commentId, iso) {
  const row = repository._debug.comments.get(commentId);
  if (row) row.createdAt = iso;
}

async function main() {
  const coreJs = fs.readFileSync(path.join(__dirname, '../shared/popular-posts-core.js'), 'utf8');
  const serviceJs = fs.readFileSync(path.join(__dirname, '../server/board-service.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const fameJs = fs.readFileSync(path.join(__dirname, '../server/user-progression-service.js'), 'utf8');
  const battleJs = fs.readFileSync(path.join(__dirname, '../shared/faction-battle-core.js'), 'utf8');

  console.log('\n[계약]');
  ok('C1. 공식 가중치 공감2 LIKE1 DISLIKE1 참여1', core.WEIGHTS.empathy === 2 && core.WEIGHTS.like === 1 && core.WEIGHTS.dislike === 1 && core.WEIGHTS.uniqueCommenter === 1);
  ok('C2. 본문 길이/조회수 공식 없음', !coreJs.includes('bodyLength') && !coreJs.includes('view_count') && !coreJs.includes('viewCount'));
  ok('C3. 정치성향 모듈 미require', !serviceJs.includes('political-alignment') && !coreJs.includes('applyAlignment'));
  ok('C4. 전황 AUTHOR_RELATION 유지', battleJs.includes("postReactionScoreRule: 'AUTHOR_RELATION'"));
  ok('C5. 명성 EMPATHY_RECEIVED 유지', fameJs.includes('EMPATHY_RECEIVED') && fameJs.includes('revokeEmpathyReceivedFame'));
  ok('C6. 화면 일간/주간/월간 탭', indexHtml.includes('data-centrist-hot-period') || indexHtml.includes('data-common-hot-period'));
  ok('C7. 서버 popular API', fs.readFileSync(path.join(__dirname, '../server/board-routes.js'), 'utf8').includes("router.get('/popular'"));

  const example = core.scoreFromCounts({
    empathyCount: 10,
    likeCount: 20,
    dislikeCount: 15,
    uniqueCommenterCount: 12,
  });
  ok('C8. 예시 67점', example.score === 67);

  const dayWindow = core.resolvePeriodWindow('day', NOW);
  ok('C9. 일간은 KST 오늘 00:00', dayWindow.fromMs === Date.parse('2026-08-27T15:00:00.000Z') && dayWindow.toMs === NOW);
  const weekWindow = core.resolvePeriodWindow('week', NOW);
  ok('C10. 주간은 최근 7일', weekWindow.fromMs === NOW - 7 * 24 * 60 * 60 * 1000);
  const monthWindow = core.resolvePeriodWindow('month', NOW);
  ok('C11. 월간은 최근 30일', monthWindow.fromMs === NOW - 30 * 24 * 60 * 60 * 1000);

  const { service, repository } = makeService({
    [author]: 'CENTRAL',
    [u2]: 'CENTRAL',
    [u3]: 'PIONEER',
    [u4]: 'GUARDIAN',
  });

  async function makePost(title) {
    const created = await service.createPost(actor(author), {
      title: title,
      content: 'body for ' + title,
    });
    return created.post;
  }

  console.log('\n[인기점수]');
  const pEmpathy = await makePost('empathy only');
  repository.recordPostEmpathyEvent({
    sourceId: pEmpathy.id,
    sourceType: 'board_post',
    occurredAt: new Date(NOW).toISOString(),
    reactorUserId: u2,
  });
  let r = await popular(service, 'day');
  ok('1. 공감 1개 → +2', scoreOf(r, pEmpathy.id) === 2);

  const pLike = await makePost('like only');
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pLike.id,
    reactionType: 'LIKE',
  });
  stampReactionCreated(repository, pLike.id, new Date(NOW).toISOString());
  r = await popular(service, 'day');
  ok('2. 본문 LIKE 1개 → +1', scoreOf(r, pLike.id) === 1);

  const pDislike = await makePost('dislike only');
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pDislike.id,
    reactionType: 'DISLIKE',
  });
  stampReactionCreated(repository, pDislike.id, new Date(NOW).toISOString());
  r = await popular(service, 'day');
  ok('3. 본문 DISLIKE 1개 → +1 (마이너스 아님)', scoreOf(r, pDislike.id) === 1);

  const pComment = await makePost('one commenter');
  const c1 = await service.createComment(actor(u2), pComment.id, { content: 'one comment' });
  stampCommentCreated(repository, c1.comment.id, new Date(NOW).toISOString());
  r = await popular(service, 'day');
  ok('4. 댓글 1명 → +1', scoreOf(r, pComment.id) === 1);

  const pSpam = await makePost('spam comments');
  let si;
  for (si = 0; si < 10; si++) {
    const c = await service.createComment(actor(u2), pSpam.id, { content: 'spam ' + si + ' extra text' });
    stampCommentCreated(repository, c.comment.id, new Date(NOW).toISOString());
  }
  r = await popular(service, 'day');
  ok('5. 같은 회원 댓글 10개 → +1', scoreOf(r, pSpam.id) === 1);

  const pReply = await makePost('comment plus replies');
  const parent = await service.createComment(actor(u2), pReply.id, { content: 'parent comment text' });
  stampCommentCreated(repository, parent.comment.id, new Date(NOW).toISOString());
  const r1 = await service.createComment(actor(u2), pReply.id, {
    content: 'reply one extra text',
    parentCommentId: parent.comment.id,
  });
  stampCommentCreated(repository, r1.comment.id, new Date(NOW).toISOString());
  const r2 = await service.createComment(actor(u2), pReply.id, {
    content: 'reply two extra text',
    parentCommentId: parent.comment.id,
  });
  stampCommentCreated(repository, r2.comment.id, new Date(NOW).toISOString());
  r = await popular(service, 'day');
  ok('6. 같은 회원 댓글+대댓글 여러 개 → +1', scoreOf(r, pReply.id) === 1);

  const pStack = await makePost('stack signals');
  repository.recordPostEmpathyEvent({
    sourceId: pStack.id,
    sourceType: 'board_post',
    occurredAt: new Date(NOW).toISOString(),
    reactorUserId: u2,
  });
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pStack.id,
    reactionType: 'LIKE',
  });
  stampReactionCreated(repository, pStack.id, new Date(NOW).toISOString());
  const cStack = await service.createComment(actor(u2), pStack.id, { content: 'stacked comment text' });
  stampCommentCreated(repository, cStack.comment.id, new Date(NOW).toISOString());
  r = await popular(service, 'day');
  ok('7. 한 사람이 공감+LIKE+댓글 → +4', scoreOf(r, pStack.id) === 4);

  console.log('\n[댓글 반응 제외]');
  const pIgnore = await makePost('ignore comment reactions');
  const cIgnore = await service.createComment(actor(u3), pIgnore.id, { content: 'target comment body' });
  stampCommentCreated(repository, cIgnore.comment.id, new Date(NOW).toISOString());
  await service.toggleReaction(actor(u2), {
    targetType: 'COMMENT',
    targetId: cIgnore.comment.id,
    reactionType: 'LIKE',
  });
  await service.toggleReaction(actor(u4), {
    targetType: 'COMMENT',
    targetId: cIgnore.comment.id,
    reactionType: 'DISLIKE',
  });
  r = await popular(service, 'day');
  ok('8. 댓글 LIKE/DISLIKE → 원글 인기점수 변화 없음', scoreOf(r, pIgnore.id) === 1);

  repository.recordPostEmpathyEvent({
    sourceId: cIgnore.comment.id,
    sourceType: 'board_comment',
    occurredAt: new Date(NOW).toISOString(),
    reactorUserId: u2,
  });
  r = await popular(service, 'day');
  ok('9. 댓글 공감 → 원글 인기점수 변화 없음', scoreOf(r, pIgnore.id) === 1);

  console.log('\n[취소/삭제]');
  const pCancelLike = await makePost('cancel like');
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pCancelLike.id,
    reactionType: 'LIKE',
  });
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pCancelLike.id,
    reactionType: 'LIKE',
  });
  r = await popular(service, 'day');
  ok('10. 취소 LIKE → 제외', !included(r, pCancelLike.id) || scoreOf(r, pCancelLike.id) === 0);

  const pCancelDislike = await makePost('cancel dislike');
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pCancelDislike.id,
    reactionType: 'DISLIKE',
  });
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pCancelDislike.id,
    reactionType: 'DISLIKE',
  });
  r = await popular(service, 'day');
  ok('11. 취소 DISLIKE → 제외', !included(r, pCancelDislike.id) || scoreOf(r, pCancelDislike.id) === 0);

  const pCancelEmpathy = await makePost('cancel empathy');
  repository.recordPostEmpathyEvent({
    sourceId: pCancelEmpathy.id,
    sourceType: 'board_post',
    occurredAt: new Date(NOW).toISOString(),
    reactorUserId: u2,
  });
  r = await popular(service, 'day');
  ok('12a. 공감 기록 시 포함', scoreOf(r, pCancelEmpathy.id) === 2);
  var evs = repository._debug.empathyEvents;
  var ei;
  for (ei = evs.length - 1; ei >= 0; ei--) {
    if (evs[ei] && evs[ei].sourceId === pCancelEmpathy.id) evs.splice(ei, 1);
  }
  r = await popular(service, 'day');
  ok('12. 취소 공감(이벤트 삭제) → 제외', !included(r, pCancelEmpathy.id));

  const pDelComment = await makePost('deleted comment');
  const cDel = await service.createComment(actor(u2), pDelComment.id, { content: 'will delete this comment' });
  stampCommentCreated(repository, cDel.comment.id, new Date(NOW).toISOString());
  await service.deleteComment(actor(u2), cDel.comment.id);
  r = await popular(service, 'day');
  ok('13. 삭제 댓글 → 제외', !included(r, pDelComment.id));

  console.log('\n[기간]');
  const pDayOut = await makePost('outside daily');
  repository.recordPostEmpathyEvent({
    sourceId: pDayOut.id,
    sourceType: 'board_post',
    occurredAt: '2026-08-27T14:00:00.000Z',
    reactorUserId: u2,
  });
  r = await popular(service, 'day');
  ok('14. 일간 기간 밖 반응 → 일간 제외', !included(r, pDayOut.id));

  const pWeekOut = await makePost('outside week');
  repository.recordPostEmpathyEvent({
    sourceId: pWeekOut.id,
    sourceType: 'board_post',
    occurredAt: '2026-08-20T03:00:00.000Z',
    reactorUserId: u2,
  });
  r = await popular(service, 'week');
  ok('15. 7일 밖 반응 → 주간 제외', !included(r, pWeekOut.id));
  const pWeekIn = await makePost('inside week');
  repository.recordPostEmpathyEvent({
    sourceId: pWeekIn.id,
    sourceType: 'board_post',
    occurredAt: '2026-08-22T03:00:00.000Z',
    reactorUserId: u2,
  });
  r = await popular(service, 'week');
  ok('15b. 7일 안 반응 → 주간 포함', included(r, pWeekIn.id));

  const pMonthOut = await makePost('outside month');
  repository.recordPostEmpathyEvent({
    sourceId: pMonthOut.id,
    sourceType: 'board_post',
    occurredAt: '2026-07-28T03:00:00.000Z',
    reactorUserId: u2,
  });
  r = await popular(service, 'month');
  ok('16. 30일 밖 반응 → 월간 제외', !included(r, pMonthOut.id));

  const pOld = await makePost('old post today activity');
  stampPostCreated(repository, pOld.id, '2026-08-18T03:00:00.000Z');
  repository.recordPostEmpathyEvent({
    sourceId: pOld.id,
    sourceType: 'board_post',
    occurredAt: new Date(NOW).toISOString(),
    reactorUserId: u2,
  });
  r = await popular(service, 'day');
  ok('17. 오래된 글에 오늘 반응 → 일간 후보 포함', included(r, pOld.id) && scoreOf(r, pOld.id) === 2);

  const pTieOld = await makePost('tie older');
  const pTieNew = await makePost('tie newer');
  stampPostCreated(repository, pTieOld.id, '2026-08-20T00:00:00.000Z');
  stampPostCreated(repository, pTieNew.id, '2026-08-27T00:00:00.000Z');
  await service.toggleReaction(actor(u2), {
    targetType: 'POST',
    targetId: pTieOld.id,
    reactionType: 'LIKE',
  });
  stampReactionCreated(repository, pTieOld.id, new Date(NOW).toISOString());
  await service.toggleReaction(actor(u3), {
    targetType: 'POST',
    targetId: pTieNew.id,
    reactionType: 'LIKE',
  });
  stampReactionCreated(repository, pTieNew.id, new Date(NOW).toISOString());
  r = await popular(service, 'day');
  const tieIdx = r.posts
    .map(function (p, i) {
      return { id: p.id, i: i, score: p.popularScore };
    })
    .filter(function (x) {
      return x.id === pTieOld.id || x.id === pTieNew.id;
    });
  const newPos = tieIdx.find(function (x) {
    return x.id === pTieNew.id;
  });
  const oldPos = tieIdx.find(function (x) {
    return x.id === pTieOld.id;
  });
  ok(
    '18. 동점이면 최신글 우선',
    newPos && oldPos && newPos.score === oldPos.score && newPos.i < oldPos.i,
  );

  const pPeriodSplit = await makePost('period split');
  stampPostCreated(repository, pPeriodSplit.id, '2026-07-01T00:00:00.000Z');
  repository.recordPostEmpathyEvent({
    sourceId: pPeriodSplit.id,
    sourceType: 'board_post',
    occurredAt: new Date(NOW).toISOString(),
    reactorUserId: u2,
  });
  repository.recordPostEmpathyEvent({
    sourceId: pPeriodSplit.id,
    sourceType: 'board_post',
    occurredAt: '2026-08-22T03:00:00.000Z',
    reactorUserId: u3,
  });
  const dayR = await popular(service, 'day');
  const weekR = await popular(service, 'week');
  const monthR = await popular(service, 'month');
  ok(
    '10x. 일/주/월 각각 따로 계산',
    scoreOf(dayR, pPeriodSplit.id) === 2 &&
      scoreOf(weekR, pPeriodSplit.id) === 4 &&
      scoreOf(monthR, pPeriodSplit.id) === 4,
  );

  const pDeleted = await makePost('will delete post');
  repository.recordPostEmpathyEvent({
    sourceId: pDeleted.id,
    sourceType: 'board_post',
    occurredAt: new Date(NOW).toISOString(),
    reactorUserId: u2,
  });
  await service.deletePost(actor(author), pDeleted.id);
  r = await popular(service, 'day');
  ok('24. 삭제된 게시글 제외', !included(r, pDeleted.id));

  console.log('\n[회귀]');
  ok('19. 정치성향 회귀 없음(인기글 경로 비연결)', !serviceJs.includes("require('../shared/political-alignment"));
  ok('20. 진영 전황 회귀 없음', battleJs.includes('postReactionTenthsForAuthor') && serviceJs.includes('attachFactionBattles'));
  ok('21. 명성 회귀 없음', /revokeEmpathyReceivedFame/.test(fameJs) && !coreJs.includes('reputation_score'));

  const b = breakdownOf(await popular(service, 'day'), pStack.id);
  ok(
    '고유 댓글 참여 필드',
    b && b.empathyCount === 1 && b.likeCount === 1 && b.uniqueCommenterCount === 1,
  );

  console.log('\n결과: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exit(1);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
