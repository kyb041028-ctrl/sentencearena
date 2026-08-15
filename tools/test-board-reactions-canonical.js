'use strict';
/**
 * 실회원 추천/비추천·신고 canonical 연결 (LIKE/DISLIKE ≠ EMPATHY)
 * 절대 count 하드코딩 금지.
 * node tools/test-board-reactions-canonical.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
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

function section(title) {
  console.log('\n[' + title + ']');
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

section('소스 가드');
const indexHtml = read('public/index.html');
const boardClient = read('public/board-api-client.js');
const boardSvc = read('server/board-service.js');
const boardRoutes = read('server/board-routes.js');
const repo = read('server/board-supabase-repository.js');
const sql = read('supabase/migration_board_core_system.sql');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. 추천 UI = onTogglePostReaction/onToggleCommentReaction',
  /onTogglePostReaction\(p\.id, true\)/.test(indexHtml) &&
    /onTogglePostReaction\(p\.id, false\)/.test(indexHtml) &&
    /function onTogglePostReaction/.test(indexHtml) &&
    /function onToggleCommentReaction/.test(indexHtml),
);
ok(
  '2. 실회원 canonical 글 추천은 toggleMemberCanonicalReaction',
  /toggleMemberCanonicalReaction/.test(indexHtml) &&
    /toggleMemberCanonicalReaction/.test(boardClient) &&
    /toggleMemberCanonicalExclusive/.test(indexHtml) &&
    /isAuthenticatedBoardMember\(\) &&\s*isServerCanonicalPost\(post\)/.test(indexHtml),
);
ok(
  '3. POST /reactions/toggle · toggle_board_reaction 재사용',
  /router\.post\('\/reactions\/toggle'/.test(boardRoutes) &&
    /rpc\('toggle_board_reaction'/.test(repo) &&
    /FUNCTION public\.toggle_board_reaction/.test(sql),
);
ok(
  '4. unique = actor+target+reaction_group (LIKE·DISLIKE 공존 가능)',
  /uq_board_reactions_active_post_group/.test(sql) &&
    /actor_user_id, post_id, reaction_group/.test(sql) &&
    !/reaction_type IN \([^)]*EMPATHY/.test(sql),
);
ok(
  '5. EMPATHY 와 LIKE/DISLIKE 분리',
  /onToggleEmpathyPost/.test(indexHtml) &&
    /grantMemberCanonicalPostEmpathy/.test(indexHtml) &&
    !/reactionType:\s*'EMPATHY'/.test(indexHtml) &&
    /LIKE\/DISLIKE 는 board_reactions \(EMPATHY와 분리\)/.test(boardSvc),
);
ok(
  '6. 피드 hydrate earthReaction + counts → likes/dislikes',
  /attachViewerEarthReactions/.test(boardSvc) &&
    /earthReactionCountArray/.test(indexHtml) &&
    /counts\.earthPositive/.test(indexHtml) &&
    /er\.viewerPositive/.test(indexHtml),
);
ok(
  '7. UI exclusive: 반대 계열 먼저 cancel 후 LIKE/DISLIKE',
  /if \(inD\) chain = toggle\(rx\.negativeType \|\| 'DISLIKE'\)/.test(indexHtml) &&
    /return toggle\('LIKE'\)/.test(indexHtml) &&
    /return toggle\('DISLIKE'\)/.test(indexHtml),
);
ok(
  '8. Guest 추천은 기존 likes/dislikes splice 경로 유지',
  /L\.splice\(L\.indexOf\(me\), 1\)/.test(indexHtml) &&
    /Guest \/ legacy localStorage 글/.test(indexHtml),
);
ok(
  '9. 실회원 신고 POST /reports → board_reports',
  /createMemberCanonicalBoardReport/.test(indexHtml) &&
    /createMemberCanonicalReport/.test(boardClient) &&
    /router\.post\('\/reports'/.test(boardRoutes) &&
    /from\('board_reports'\)/.test(repo) &&
    /uq_board_reports_active_post/.test(sql),
);
ok(
  '10. Guest 신고는 sc_reports_v1 유지',
  /var LS_KEY = 'sc_reports_v1'/.test(indexHtml) &&
    /function submitPostReport/.test(indexHtml) &&
    /isAuthenticatedMemberForBoardReport/.test(indexHtml),
);
ok(
  '11. 신고 hydrate (새로고침 정본) · 외계 moderation 없음',
  /attachViewerPostReports/.test(boardSvc) &&
    /viewerReported/.test(boardSvc) &&
    /__scCanonicalReportedPostIds/.test(indexHtml) &&
    !/transferToAlien/.test(boardSvc),
);
ok(
  '12. 게시글/댓글 수정·삭제 UI 없음 (서버 PATCH/DELETE만 유지)',
  !/function editPost\(/.test(indexHtml) &&
    !/function deletePost\(/.test(indexHtml) &&
    /router\.patch\('\/posts\/:postId'/.test(boardRoutes) &&
    /router\.delete\('\/comments\/:commentId'/.test(boardRoutes),
);
ok(
  '13. XP 회수/업적 회수 없음 · 신규 migration 없음',
  !/DELETE_XP/.test(boardSvc) &&
    !/reclaimXp/.test(boardSvc) &&
    !/revokeAchievement/.test(indexHtml) &&
    !/\bTRUNCATE\b|\bDROP TABLE\b/.test(sql.slice(-50)),
);
ok(
  '14. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);
ok(
  '15. identity = auth.users.id (display_name ownership 없음)',
  /requireUser\(actor\)/.test(boardSvc) &&
    !/displayName ownership/.test(boardSvc) &&
    /actor_user_id uuid NOT NULL REFERENCES auth\.users/.test(sql) &&
    /reporter_user_id/.test(sql),
);

section('memory: LIKE toggle / report / 그룹 unique');
(async function () {
  const { createBoardMemoryRepository } = require('../server/board-memory-repository');
  const { createBoardService } = require('../server/board-service');
  const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

  const author = uid(1);
  const other = uid(2);
  const service = createBoardService({
    repository: createBoardMemoryRepository(),
    userContext: createMockUserContextAdapter({
      territories: { [author]: 'CENTRAL', [other]: 'PIONEER' },
    }),
    operational: true,
  });

  const created = await service.createPost(
    { userId: author },
    { title: 'rx', content: 'body', territory: 'CENTRAL' },
  );
  const post = created.post;
  const r1 = await service.toggleReaction(
    { userId: other },
    { targetType: 'POST', targetId: post.id, reactionType: 'LIKE' },
  );
  ok('LIKE CREATED active', r1 && r1.action === 'CREATED' && r1.active === true);
  ok('earthPositive +1 (delta)', r1.counts && r1.counts.earthPositive === 1);

  const r2 = await service.toggleReaction(
    { userId: other },
    { targetType: 'POST', targetId: post.id, reactionType: 'LIKE' },
  );
  ok('LIKE 재클릭 CANCELLED', r2 && r2.action === 'CANCELLED' && r2.active === false);
  ok('earthPositive 0', r2.counts && r2.counts.earthPositive === 0);

  await service.toggleReaction(
    { userId: other },
    { targetType: 'POST', targetId: post.id, reactionType: 'LIKE' },
  );
  const r3 = await service.toggleReaction(
    { userId: other },
    { targetType: 'POST', targetId: post.id, reactionType: 'DISLIKE' },
  );
  ok(
    'DISLIKE 단독 토글은 LIKE를 자동 취소하지 않음 (UI가 두 번 호출)',
    r3 && r3.active === true && r3.counts.earthPositive === 1 && r3.counts.earthNegative === 1,
  );

  const commentPack = await service.createComment({ userId: author }, post.id, { content: 'c1' });
  const cr = await service.toggleReaction(
    { userId: other },
    { targetType: 'COMMENT', targetId: commentPack.comment.id, reactionType: 'LIKE' },
  );
  ok('댓글 LIKE CREATED', cr && cr.action === 'CREATED' && cr.counts.earthPositive === 1);

  const report = await service.createReport(
    { userId: other },
    { targetType: 'POST', targetId: post.id, reasonCode: 'spam', reasonDetail: null },
  );
  ok('신고 SUBMITTED', report && report.status === 'SUBMITTED' && !!report.id);

  let dup = null;
  try {
    await service.createReport(
      { userId: other },
      { targetType: 'POST', targetId: post.id, reasonCode: 'abuse', reasonDetail: null },
    );
  } catch (e) {
    dup = e;
  }
  ok('중복 신고 BOARD_REPORT_DUPLICATE', dup && dup.code === 'BOARD_REPORT_DUPLICATE');

  let selfRep = null;
  try {
    await service.createReport(
      { userId: author },
      { targetType: 'POST', targetId: post.id, reasonCode: 'spam', reasonDetail: null },
    );
  } catch (e) {
    selfRep = e;
  }
  ok('본인 글 신고 거부', selfRep && selfRep.code === 'BOARD_REPORT_SELF_FORBIDDEN');

  let guestToggle = null;
  try {
    await service.toggleReaction(null, {
      targetType: 'POST',
      targetId: post.id,
      reactionType: 'LIKE',
    });
  } catch (e) {
    guestToggle = e;
  }
  ok('비로그인 추천 거부', guestToggle && guestToggle.code === 'BOARD_AUTH_REQUIRED');

  console.log(
    JSON.stringify({
      chromeCheck: [
        '실회원: 타인 canonical 글 추천 ON → 새로고침 후 ON 유지',
        '실회원: 같은 글 비추천으로 전환 → 추천 OFF + 비추천 ON, 새로고침 유지',
        '실회원: 타인 canonical 글 신고 1회 → 새로고침 후 이미 신고됨',
        'Guest: 추천/신고는 기존처럼 localStorage (서버 미호출)',
      ],
    }),
  );

  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  ok('async', false, String(e && e.message ? e.message : e));
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(1);
});
