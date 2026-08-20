#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const teardown = require('./test-process-teardown');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migration_board_core_system.sql'), 'utf8');

const schema = require('../shared/board-schema-core');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardDataMapper } = require('../server/board-data-mapper');

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

function makeService(territories) {
  const repository = createBoardMemoryRepository();
  const userContext = createMockUserContextAdapter({ territories: territories || {} });
  const service = createBoardService({ repository, userContext, operational: true });
  return { service, repository, userContext };
}

function runSqlTests() {
  assert('SQL 1. 테이블 4개', /board_posts/.test(SQL) && /board_comments/.test(SQL) && /board_reactions/.test(SQL) && /board_reports/.test(SQL));
  assert('SQL 2. PK/FK/UNIQUE/CHECK', /PRIMARY KEY/.test(SQL) && /REFERENCES auth\.users/.test(SQL) && /uq_board_reactions_active_post_group/.test(SQL) && /board_posts_title_not_blank/.test(SQL));
  assert('SQL 2b. 댓글 최대 1500', /board_comments_content_max_len/.test(SQL) && /1500/.test(SQL));
  assert('SQL 3. RLS 활성화', (SQL.match(/ENABLE ROW LEVEL SECURITY/g) || []).length >= 4);
  assert('SQL 4. 익명 author 보호 View', /board_posts_public/.test(SQL) && /is_anonymous AND .*auth\.uid\(\)/.test(SQL));
  assert('SQL 5. 활성 반응 계열 unique 부분 인덱스', /WHERE cancelled_at IS NULL AND target_type = 'POST'/.test(SQL) && /WHERE cancelled_at IS NULL AND target_type = 'COMMENT'/.test(SQL));
  assert('SQL 6. 지구·외계 구분 컬럼', /audience_scope/.test(SQL) && /EARTH/.test(SQL) && /ALIEN/.test(SQL));
  assert('SQL 7. 반응 당시 양쪽 영토', /actor_territory_at_reaction/.test(SQL) && /target_author_territory_at_reaction/.test(SQL));
  assert('SQL 8. 소프트 삭제 컬럼', /deleted_at/.test(SQL) && /status.*DELETED/.test(SQL));
  assert('SQL 9. 반응 RPC 존재', /FUNCTION public\.toggle_board_reaction/.test(SQL));
  assert('SQL 10. RPC 재클릭 취소', /v_action := 'CANCELLED'/.test(SQL));
  assert('SQL 11. 같은 계열 교체', /v_action := 'REPLACED'/.test(SQL));
  assert('SQL 12. 다른 계열 유지(그룹 unique)', /reaction_group/.test(SQL) && /uq_board_reactions_active_post_group/.test(SQL));
  assert('SQL 13. 삭제 대상 반응 금지', /BOARD_TARGET_NOT_ACTIVE/.test(SQL));
  assert('SQL 14. 중복 신고 방지', /uq_board_reports_active_post/.test(SQL));
}

async function runServiceTests() {
  const author = uid(1);
  const other = uid(2);
  const alien = uid(3);
  const { service, repository } = makeService({
    [author]: 'CENTRAL',
    [other]: 'PIONEER',
    [alien]: 'ALIEN',
  });

  let authErr = null;
  try {
    await service.createPost(null, { title: 't', content: 'c' });
  } catch (e) {
    authErr = e;
  }
  assert('Svc 15. 비로그인 작성 거부', authErr && authErr.code === 'BOARD_AUTH_REQUIRED');

  const created = await service.createPost({ userId: author }, {
    title: 'hello',
    content: 'world body',
    isAnonymous: true,
  });
  assert('Svc 16. 게시글 작성 성공', created.post && created.post.id && created.post.isAnonymous === true);

  const anonView = await service.getPost({ userId: other }, created.post.id);
  assert('Svc 17. 익명 응답 실제 ID 제거', anonView.author.userId == null && anonView.author.displayName === '익명');
  assert('Svc 19. 타인에게 실제 ID 미노출', !JSON.stringify(anonView).includes(author));

  const mine = await service.getPost({ userId: author }, created.post.id);
  assert('Svc 18. 작성자 isMine', mine.isMine === true && mine.author.userId == null);

  const commentPack = await service.createComment({ userId: other }, created.post.id, { content: 'nice post' });
  const comment = commentPack.comment || commentPack;
  assert('Svc 20. 댓글 작성', comment && comment.id && comment.content === 'nice post');

  const replyPack = await service.createComment({ userId: author }, created.post.id, {
    content: 'reply',
    parentCommentId: comment.id,
  });
  const reply = replyPack.comment || replyPack;
  assert('Svc 21a. 대댓글 parent 허용', reply.parentCommentId === comment.id);

  let depthErr = null;
  try {
    await service.createComment({ userId: other }, created.post.id, {
      content: 'too deep',
      parentCommentId: reply.id,
    });
  } catch (e) {
    depthErr = e;
  }
  assert('Svc 21b. 대댓글 depth 제한', depthErr && depthErr.code === 'BOARD_COMMENT_DEPTH_EXCEEDED');

  let forbidEdit = null;
  try {
    await service.updatePost({ userId: other }, created.post.id, { title: 'hack', content: 'hack' });
  } catch (e) {
    forbidEdit = e;
  }
  assert('Svc 22. 작성자만 수정', forbidEdit && forbidEdit.code === 'BOARD_FORBIDDEN');

  const deleted = await service.deletePost({ userId: author }, created.post.id);
  assert('Svc 23. 소프트 삭제', deleted.status === 'DELETED' && deleted.deletedAt);

  const deletedView = await service.getPost({ userId: other }, created.post.id);
  assert('Svc 24. 삭제 내용 미노출', deletedView.content == null && /삭제/.test(deletedView.title));

  let commentOnDeleted = null;
  try {
    await service.createComment({ userId: other }, created.post.id, { content: 'nope' });
  } catch (e) {
    commentOnDeleted = e;
  }
  assert('Svc 25. 삭제 대상 신규 댓글 금지', commentOnDeleted && commentOnDeleted.code === 'BOARD_TARGET_NOT_ACTIVE');

  let reactOnDeleted = null;
  try {
    await service.toggleReaction({ userId: other }, {
      targetType: 'POST',
      targetId: created.post.id,
      reactionType: 'LIKE',
    });
  } catch (e) {
    reactOnDeleted = e;
  }
  assert('Svc 26. 삭제 대상 신규 반응 금지', reactOnDeleted && reactOnDeleted.code === 'BOARD_TARGET_NOT_ACTIVE');

  // Fresh post for reactions
  const p2 = await service.createPost({ userId: author }, { title: 'react', content: 'body' });
  const like = await service.toggleReaction({ userId: other }, {
    targetType: 'POST',
    targetId: p2.post.id,
    reactionType: 'LIKE',
    actorTerritory: 'ALIEN',
    audienceScope: 'ALIEN',
  });
  assert('Svc 27. LIKE 생성', like.action === 'CREATED' && like.active === true);
  assert('Svc 33. 클라이언트 actor territory 조작 방지', like.counts.earthPositive === 1 && like.counts.alienPositive === 0);
  assert('Svc 34. 클라이언트 audience scope 조작 방지', like.counts.alienPositive === 0);

  const cancel = await service.toggleReaction({ userId: other }, {
    targetType: 'POST',
    targetId: p2.post.id,
    reactionType: 'LIKE',
  });
  assert('Svc 28. LIKE 재클릭 취소', cancel.action === 'CANCELLED' && cancel.active === false);

  await service.toggleReaction({ userId: other }, { targetType: 'POST', targetId: p2.post.id, reactionType: 'LIKE' });
  const replaced = await service.toggleReaction({ userId: other }, {
    targetType: 'POST',
    targetId: p2.post.id,
    reactionType: 'RECOMMEND',
  });
  assert('Svc 29. LIKE → RECOMMEND 교체', replaced.action === 'REPLACED' && replaced.active === true);

  const dislike = await service.toggleReaction({ userId: other }, {
    targetType: 'POST',
    targetId: p2.post.id,
    reactionType: 'DISLIKE',
  });
  assert('Svc 30. DISLIKE와 긍정 동시 유지', dislike.action === 'CREATED' && dislike.counts.earthPositive === 1 && dislike.counts.earthNegative === 1);

  const alienReact = await service.toggleReaction({ userId: alien }, {
    targetType: 'POST',
    targetId: p2.post.id,
    reactionType: 'LIKE',
  });
  assert('Svc 31. 외계 반응 EARTH 미반영', alienReact.counts.earthPositive === 1 && alienReact.counts.alienPositive === 1);
  assert('Svc 32. 지구 반응 ALIEN 수치 분리', alienReact.counts.alienNegative === 0);

  let selfReport = null;
  try {
    await service.createReport({ userId: author }, {
      targetType: 'POST',
      targetId: p2.post.id,
      reasonCode: 'spam',
    });
  } catch (e) {
    selfReport = e;
  }
  assert('Svc 35. 자기 대상 신고 금지', selfReport && selfReport.code === 'BOARD_REPORT_SELF_FORBIDDEN');

  await service.createReport({ userId: other }, {
    targetType: 'POST',
    targetId: p2.post.id,
    reasonCode: 'spam',
  });
  let dupReport = null;
  try {
    await service.createReport({ userId: other }, {
      targetType: 'POST',
      targetId: p2.post.id,
      reasonCode: 'abuse',
    });
  } catch (e) {
    dupReport = e;
  }
  assert('Svc 36. 중복 신고 금지', dupReport && dupReport.code === 'BOARD_REPORT_DUPLICATE');

  const input = { title: 'immutable', content: 'check' };
  const before = JSON.stringify(input);
  await service.createPost({ userId: author }, input);
  assert('Svc 37. 입력 객체 비변경', JSON.stringify(input) === before);

  const publicConfig = require('../app-config').getPublicClientConfig();
  assert('Svc 38. service-role key 노출 없음', !JSON.stringify(publicConfig).includes('SERVICE_ROLE'));

  const routesSrc = fs.readFileSync(path.join(ROOT, 'server', 'board-routes.js'), 'utf8');
  assert('Svc 39. 일반 오류에 DB 상세 미노출', /ok: false,\s*error: code/.test(routesSrc.replace(/\s+/g, ' ')));
  assert(
    'Svc 39b. 회원 신고 응답은 mapReportForMember',
    /mapReportForMember\(report\)/.test(routesSrc) && typeof schema.mapReportForMember === 'function',
  );

  let syntaxOk = true;
  try {
    execFileSync(process.execPath, ['-c', path.join(ROOT, 'server.js')], { stdio: 'pipe' });
    execFileSync(process.execPath, ['-c', path.join(ROOT, 'public', 'board-api-client.js')], { stdio: 'pipe' });
  } catch (e) {
    syntaxOk = false;
  }
  assert('Svc 40. 주요 파일 syntax OK', syntaxOk);

  const reactions = await repository.listReactionsForAlignment({ audienceScope: 'EARTH' });
  const mapped = reactions.map(schema.toAlignmentReactionInput);
  assert('Align 41. alignment 입력 변환', mapped.length > 0 && mapped[0].targetUserId && mapped[0].reactionType);
  assert('Align 42. cancelled_at 유지', mapped.some((r) => r.cancelledAt != null) || reactions.some((r) => r.cancelledAt != null));
  assert('Align 43. target_author_user_id 존재', mapped.every((r) => !!r.targetUserId));
  assert('Align 44. territory snapshot 존재', mapped.every((r) => !!r.actorTerritoryAtReaction && !!r.targetTerritoryAtReaction));
  assert('Align 45. EARTH 필터', mapped.every((r) => r.audienceScope === 'EARTH'));
}

function runRegressionHint() {
  // Invoked separately by npm script chain; here we just confirm board tests don't break require of alignment modules.
  assert('Reg 46. alignment schema core require', typeof require('../shared/alignment-schema-core').validateAlignmentPersistencePlan === 'function');
  assert('Reg 47. board schema core require', typeof schema.validateReactionInput === 'function');
}

async function main() {
  console.log('=== board core system tests ===');
  runSqlTests();
  await runServiceTests();
  runRegressionHint();
  console.log('---');
  console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
  if (failures.length) {
    failures.forEach((f) => console.error(' -', f.name, f.detail));
  }
  return teardown.finishTest(failed);
}

main().catch((e) => {
  console.error(e);
  return teardown.finishTest(1);
});
