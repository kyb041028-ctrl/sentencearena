'use strict';
/**
 * 센텐스아레나 — 사용자 작성글·댓글 활동 목록 + 대표 업적 UI 테스트
 * node tools/test-user-content-system.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const core = require('../shared/user-content-list-core');
const { createUserContentMemoryRepository } = require('../server/user-content-memory-repository');
const service = require('../server/user-content-service');
const adapter = require('../public/user-content-data-adapter');
const apiClient = require('../public/user-content-api-client');
const inspect = require('../public/user-content-system-inspect');

let pass = 0;
let fail = 0;
const results = [];

function ok(label, condition, detail) {
  if (condition) {
    results.push('  PASS: ' + label);
    pass++;
  } else {
    results.push('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

function section(title) {
  results.push('\n[' + title + ']');
}

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = 'a1234567-e89b-12d3-a456-426614174000';

(async function main() {
  const INDEX = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  section('업적 제목·날짜 CSS');
  ok('1. 업적 제목 line-clamp 2', /-webkit-line-clamp:\s*2/.test(INDEX) && /\.profile-achievement-title\s*\{[\s\S]*?-webkit-line-clamp:\s*2/.test(INDEX));
  ok('2. white-space normal', /\.profile-achievement-title\s*\{[\s\S]*?white-space:\s*normal/.test(INDEX));
  ok('3. 긴 영문 overflow-wrap', /\.profile-achievement-title\s*\{[\s\S]*?overflow-wrap:\s*anywhere/.test(INDEX));
  ok('4. height 100%로 제목 영역 통일', /\.profile-achievement-title\s*\{[\s\S]*?height:\s*100%/.test(INDEX));
  ok('5. 한 줄 nowrap ellipsis 제거(제목)', !/\.profile-achievement-title[^{]*\{[^}]*white-space:\s*nowrap/.test(INDEX));
  ok('6. 날짜 글자 확대(12px)', /\.profile-achievement-date\s*\{[\s\S]*?font-size:\s*calc\(12px/.test(INDEX));
  ok('7. 날짜 flex 세로 중앙', /\.profile-achievement-date\s*\{[\s\S]*?align-items:\s*center/.test(INDEX));
  ok('8. 업적 key 데이터 파일 미변경 경로 유지', fs.existsSync(path.join(__dirname, '../public/achievement-definitions.js')));

  section('활동 클릭·모달 UI');
  ok('9. 작성글·댓글 content-link 클래스', /profile-frame__data-row--content-link/.test(INDEX));
  ok('10. aria-label 작성한 글', /작성한 글 /.test(INDEX));
  ok('11. aria-label 작성한 댓글', /작성한 댓글 /.test(INDEX));
  ok('12. Enter/Space 키 처리', /e\.key === 'Enter' \|\| e\.key === ' '/.test(INDEX));
  ok('13. 활동 모달 존재', /id="sc-user-content-modal"/.test(INDEX));
  ok('14. POSTS/COMMENTS 탭', /id="sc-user-content-tab-posts"/.test(INDEX) && /id="sc-user-content-tab-comments"/.test(INDEX));
  ok('15. 받은 공감 클릭 미연결', !/receivedLikes[\s\S]{0,80}content-link/.test(INDEX));
  ok('16. data-comment-id 부여', /data-comment-id/.test(INDEX));
  ok('17. openUserPostActivityItem', /openUserPostActivityItem/.test(INDEX));
  ok('18. openUserCommentActivityItem', /openUserCommentActivityItem/.test(INDEX));
  ok('19. navigateToBoardPost', /function navigateToBoardPost|window\.navigateToBoardPost/.test(INDEX));
  ok('20. focusBoardComment fallback', /COMMENT_ANCHOR_UNSUPPORTED_OR_NOT_FOUND/.test(INDEX) || /focusBoardComment/.test(INDEX));

  section('contract·paging');
  ok('21. contentType POSTS/COMMENTS', core.normalizeUserContentType('posts') === 'POSTS' && core.normalizeUserContentType('comments') === 'COMMENTS');
  ok('22. page 정규화', core.normalizeUserContentPage(0, 5) === 1 && core.normalizeUserContentPage(9, 5) === 5);
  ok('23. pageSize 기본 10', core.DEFAULT_PAGE_SIZE === 10);
  ok('24. totalPages', core.getPageCount(0, 10) === 0 && core.getPageCount(11, 10) === 2);

  const frozen = { id: 'p1', title: '안녕', body: '<b>x</b>', authorId: UUID, isAnonymous: false, createdAt: '2026-07-30T00:00:00.000Z', reactions: { empathy: [1, 2] }, comments: [] };
  const before = JSON.stringify(frozen);
  core.sanitizeUserPostActivityItem(frozen, { isSelf: true });
  ok('25. 입력 객체 비변경', JSON.stringify(frozen) === before);

  const anonHidden = core.sanitizeUserPostActivityItem(
    { id: 'p2', title: '익명글', authorId: UUID, isAnonymous: true },
    { isSelf: false }
  );
  ok('26. 익명 글 타인 제외', anonHidden == null);
  const anonSelf = core.sanitizeUserPostActivityItem(
    { id: 'p2', title: '익명글', authorId: UUID, isAnonymous: true },
    { isSelf: true }
  );
  ok('27. 익명 글 본인 표시', !!anonSelf && anonSelf.isAnonymous === true);

  const alienComment = core.sanitizeUserCommentActivityItem(
    {
      id: 'c1',
      postId: 'p1',
      text: '<script>alert(1)</script>hello',
      authorId: UUID,
      audienceScope: 'ALIEN',
      postTitle: '원문',
    },
    { isSelf: false, viewerCanSeeAlien: false }
  );
  ok('28. 지구 사용자 외계 댓글 비노출', alienComment == null);
  const alienOk = core.sanitizeUserCommentActivityItem(
    {
      id: 'c1',
      postId: 'p1',
      text: '<script>alert(1)</script>hello world',
      authorId: UUID,
      audienceScope: 'ALIEN',
      postTitle: '원문',
    },
    { isSelf: false, viewerCanSeeAlien: true }
  );
  ok('29. plain text preview sanitize', alienOk && alienOk.contentPreview.indexOf('<script>') === -1);

  const deleted = core.canViewerSeeUserContentItem(
    { id: 'p3', status: 'DELETED', authorId: UUID },
    { isSelf: true, contentType: 'POSTS' }
  );
  ok('30. 삭제 글 제외', deleted.allowed === false);

  const posts = [];
  for (var i = 0; i < 12; i++) {
    posts.push({
      id: 'post_' + i,
      title: '제목 ' + i,
      body: '본문 ' + i,
      authorId: UUID,
      createdAt: '2026-07-' + String((i % 28) + 1).padStart(2, '0') + 'T00:00:00.000Z',
      territoryId: 'COMMON',
      reactions: { empathy: [] },
      comments: [
        {
          id: 'c_' + i,
          authorId: UUID,
          text: '댓글 ' + i,
          createdAt: '2026-07-' + String((i % 28) + 1).padStart(2, '0') + 'T01:00:00.000Z',
          reactions: { empathy: [] },
        },
      ],
    });
  }
  posts.push({
    id: 'anon_post',
    title: '익명',
    authorId: UUID,
    isAnonymous: true,
    createdAt: '2026-07-01T00:00:00.000Z',
    territoryId: 'COMMON',
    comments: [],
    reactions: { empathy: [] },
  });

  const repo = createUserContentMemoryRepository({ posts: posts });
  service.setRepository(repo);
  service.setDataMode('LEGACY_LOCAL');

  const listedSelf = await service.listUserContent({
    profileUserId: UUID,
    contentType: 'POSTS',
    page: 1,
    pageSize: 10,
    isSelf: true,
    viewerCanSeeAlien: false,
    profileCount: 999,
  });
  ok('31. 본인 목록 pageSize 10', listedSelf.items.length === 10 && listedSelf.pageSize === 10);
  ok('32. totalPages 계산', listedSelf.totalPages >= 2);
  ok('33. Mock count mismatch warning', listedSelf.warnings.indexOf('PROFILE_COUNT_MISMATCH') >= 0);
  ok('34. 가짜 목록 미생성(프로필 숫자만큼 복제 없음)', listedSelf.totalItems === 13);

  const listedOther = await service.listUserContent({
    profileUserId: UUID,
    contentType: 'POSTS',
    page: 1,
    pageSize: 10,
    isSelf: false,
    viewerCanSeeAlien: false,
  });
  ok('35. 타인 익명 제외', listedOther.totalItems === 12);

  const commentsVm = await service.listUserContent({
    profileUserId: UUID,
    contentType: 'COMMENTS',
    page: 2,
    pageSize: 10,
    isSelf: true,
  });
  ok('36. 댓글 페이지 2', commentsVm.page === 2 && commentsVm.items.length === 2);

  const stateKeep = core.buildUserContentListViewModel({
    contentType: 'POSTS',
    page: 2,
    pageSize: 10,
    items: posts,
    isSelf: true,
    useFilteredTotal: true,
  });
  ok('37. 탭 독립 page 유지용 모델', stateKeep.page === 2);

  const privateVm = await service.listUserContent({
    profileUserId: UUID2,
    contentType: 'POSTS',
    visibilityContext: 'PRIVATE',
    isSelf: false,
  });
  ok('38. private 상태', privateVm.dataStatus === 'PRIVATE');

  section('API·모드');
  ok('39. 기본 LEGACY_LOCAL', apiClient.getMode() === 'LEGACY_LOCAL' && service.getDataMode() === 'LEGACY_LOCAL');
  apiClient.setMode('API_DRY_RUN');
  const dry = await apiClient.listUserContent({ profileUserId: UUID, contentType: 'POSTS' });
  ok('40. API_DRY_RUN write 없음', dry.dryRun === true && dry.note === 'NO_WRITE');
  apiClient.setMode('API_OPERATIONAL');
  ok('41. API_OPERATIONAL 비활성', apiClient.getMode() === 'LEGACY_LOCAL' && !apiClient.isActivated());
  apiClient.setMode('LEGACY_LOCAL');
  ok('42. route 파일 존재', fs.existsSync(path.join(__dirname, '../server/user-content-routes.js')));
  ok('43. supabase stub 존재', fs.existsSync(path.join(__dirname, '../server/user-content-supabase-repository.js')));

  const nav = core.buildNavigationTarget('COMMENTS', {
    postId: 'p1',
    commentId: 'c1',
    parentCommentId: 'c0',
    territory: 'COMMON',
  });
  ok('44. 댓글 이동 parentCommentId', nav.parentCommentId === 'c0' && nav.commentAnchorSupported === false);

  const insp = inspect.inspectUserContentSystem({
    profileUserId: UUID,
    isSelf: true,
    postsTotal: listedSelf.totalItems,
    commentsTotal: commentsVm.totalItems,
    countMismatch: true,
  });
  ok('45. inspect titleLineClamp 2', insp.achievements.titleLineClamp === 2);
  ok('46. inspect activity links', insp.activityLinks.postsClickable && insp.activityLinks.keyboardAccessible);
  ok('47. inspect operational off', insp.operational.apiOperational === false && insp.operational.dbWriteEnabled === false);

  const localVm = adapter.listFromPostsSnapshot(posts, {
    profileUserId: UUID,
    contentType: 'POSTS',
    page: 1,
    isSelf: true,
  });
  ok('48. adapter local listing', localVm.items.length === 10);

  if (process.env.SC_USER_CONTENT_UNIT_ONLY === '1') {
    console.log('\n=== 사용자 콘텐츠 테스트 결과 (unit only) ===');
    results.forEach(function (r) { console.log(r); });
    console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
  }

  section('회귀 (중첩 금지 · alignment 1회)');
  function runChild(scriptName, expectPattern, timeoutMs, extraEnv) {
    console.log('[regression] 시작:', scriptName);
    const t0 = Date.now();
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, scriptName)], {
        encoding: 'utf8',
        timeout: timeoutMs || 120000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, extraEnv || {}, {
          SC_SKIP_COMPAT_REGRESSION: (extraEnv && extraEnv.SC_SKIP_COMPAT_REGRESSION) || '1',
        }),
      });
      console.log('[regression] 완료:', scriptName, '(' + Math.round((Date.now() - t0) / 1000) + 's)');
      const matched =
        !expectPattern ||
        out.includes(expectPattern) ||
        new RegExp(expectPattern).test(out) ||
        (/PASS \/ 0 FAIL/.test(out) && String(expectPattern).indexOf('PASS') !== -1);
      ok(scriptName + ' 통과', matched, matched ? '' : out.slice(-600));
    } catch (e) {
      console.log('[regression] 실패:', scriptName);
      ok(scriptName + ' 통과', false, String((e.stderr || e.stdout || e.message) || e).slice(-600));
    }
  }

  runChild('test-user-profile-system.js', 'PASS / 0 FAIL', 120000, { SC_PROFILE_UNIT_ONLY: '1' });
  runChild('test-user-data-system.js', 'PASS / 0 FAIL', 120000, { SC_USER_DATA_UNIT_ONLY: '1' });
  runChild('test-user-event-system.js', 'PASS / 0 FAIL', 120000, { SC_USER_EVENT_UNIT_ONLY: '1' });
  runChild('test-alien-system.js', 'PASS / 0 FAIL', 120000, { SC_ALIEN_UNIT_ONLY: '1' });
  runChild('test-territory-evolution-system.js', 'PASS / 0 FAIL', 120000, { SC_TEVO_UNIT_ONLY: '1' });
  runChild('test-board-core-system.js', 'failed: 0', 120000);
  runChild('test-board-compat-system.js', 'failed: 0', 120000, { SC_SKIP_COMPAT_REGRESSION: '1' });
  runChild('test-alignment-supabase-system.js', 'failed: 0', 600000, { SC_SKIP_COMPAT_REGRESSION: '1' });

  console.log('\n=== 사용자 콘텐츠 테스트 결과 ===');
  results.forEach(function (r) { console.log(r); });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
