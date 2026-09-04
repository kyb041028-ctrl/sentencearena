'use strict';
/**
 * 타인 회원 Level = user_progression.level (MiniProfile / 게시글·댓글 작성자 / Profile Modal)
 * node tools/test-public-author-level.js
 */

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

section('소스 가드');
const svc = read('server/user-progression-service.js');
const routes = read('server/user-progression-routes.js');
const boardSvc = read('server/board-service.js');
const mapper = read('server/board-data-mapper.js');
const indexHtml = read('public/index.html');
const serverJs = read('server.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. 본인 ProfileFrame canonical 유지 (/api/me/profile + canonicalLevel)',
  /app\.get\('\/api\/me\/profile'/.test(serverJs) &&
    /ensureAndGetProgression/.test(serverJs) &&
    /canonicalLevel/.test(indexHtml) &&
    /실회원은 server user_progression 만/.test(indexHtml),
);

ok(
  '2. MiniProfile 실회원 타인은 getPublicAuthorLevel',
  /function resolveScMiniProfileData/.test(indexHtml) &&
    /function resolvePostDetailAuthorInfo/.test(indexHtml) &&
    /level: getPublicAuthorLevel\(id\)/.test(indexHtml) &&
    !/PlayerProgression/.test(
      (indexHtml.split('function resolvePostDetailAuthorInfo')[1] || '').split(
        'function normalizeAuthorTerritoryId',
      )[0],
    ),
);

ok(
  '3. 게시글 작성자 author.level 캐시',
  /mapCanonicalPostToUi/.test(indexHtml) &&
    /rememberPublicAuthorLevel\(authorId, serverPost\.author\.level\)/.test(indexHtml) &&
    /attachAuthorPublicFields/.test(boardSvc) &&
    /item\.author\.level = levels\[item\.author\.userId\]/.test(boardSvc),
);

ok(
  '4. 댓글 작성자 author.level 캐시',
  /mapCanonicalCommentToUi/.test(indexHtml) &&
    /rememberPublicAuthorLevel\(author, serverComment\.author\.level\)/.test(indexHtml) &&
    /await attachAuthorPublicFields\(mapped\)/.test(boardSvc) &&
    /await attachAuthorPublicFields\(\[mappedComment\]\)/.test(boardSvc),
);

ok(
  '5. 타인 Profile Modal은 public level, localStorage 아님',
  /function createOtherUserProfileBase/.test(indexHtml) &&
    /실회원 타인: localStorage progression\/fame을 공식처럼 쓰지 않음/.test(indexHtml) &&
    /var publicLv = getPublicAuthorLevel\(id\)/.test(indexHtml) &&
    /fetchPublicAuthorLevel\(id\)/.test(indexHtml),
);

const publicLevelHandler = routes.split("router.get('/users/:userId/level'")[1] || '';
ok(
  '6. 타인 XP 원값 미노출 (public level API + author hydrate)',
  /router\.get\('\/users\/:userId\/level'/.test(routes) &&
    /select\('user_id, level'\)/.test(svc) &&
    !/\.xp\b/.test(publicLevelHandler) &&
    !/author\.xp/.test(boardSvc) &&
    !/rememberPublicAuthorLevel\([^)]*xp/.test(indexHtml),
);

ok(
  '7. 타인 fame 원값을 새로 노출하지 않음',
  !/reputation_score/.test(publicLevelHandler) &&
    !/author\.fame/.test(boardSvc) &&
    !/author\.reputation/.test(boardSvc) &&
    /profile\.fame = 0/.test(indexHtml),
);

ok(
  '8. email 미노출',
  !/\bemail\b/.test(publicLevelHandler) &&
    !/author\.email/.test(boardSvc) &&
    /select\('id, display_name'\)/.test(boardSvc),
);

ok(
  '9. political alignment score 미노출',
  !/alignment/.test(publicLevelHandler) &&
    !/political/.test(publicLevelHandler) &&
    /politicalAlignmentPrivate = true/.test(indexHtml),
);

ok(
  '10. USER_DATA_OPERATIONAL OFF 유지',
  /USER_DATA_OPERATIONAL \|\| ''\)\.trim\(\) === 'true'/.test(serverJs) &&
    !/USER_DATA_OPERATIONAL\s*=\s*['"]true['"]/.test(serverJs) &&
    !/USER_DATA_OPERATIONAL=true/.test(routes) &&
    !/USER_DATA_OPERATIONAL=true/.test(boardSvc),
);

ok(
  '11. Guest 방문자 empty (level 12 / fame 3450 없음)',
  /guestProgressionEmpty:\s*true/.test(indexHtml) &&
    /userId: '게스트'/.test(indexHtml) &&
    !/level:\s*12/.test(indexHtml) &&
    !/fame:\s*3450/.test(indexHtml),
);

const resolveFn = (indexHtml.split('function resolvePostDetailAuthorInfo')[1] || '').split(
  'function normalizeAuthorTerritoryId',
)[0];
ok(
  '12. 타인 level은 getPublicAuthorLevel · Guest/localStorage 정본 아님',
  /hasAuthenticatedProfileSession\(\)/.test(resolveFn) &&
    /getPublicAuthorLevel\(id\)/.test(resolveFn) &&
    !/PlayerProgression/.test(resolveFn) &&
    !/P\.getDisplay/.test(resolveFn),
);

ok(
  '13. 기존 board author 식별 유지 · 익명은 userId/level 없음',
  /displayName: isAnonymous \? '익명'/.test(mapper) &&
    /userId: isAnonymous \? null : src\.authorUserId/.test(mapper) &&
    /function attachAuthorPublicFields/.test(boardSvc) &&
    /if \(!item \|\| !item\.author \|\| !item\.author\.userId\) return/.test(boardSvc),
);

ok(
  '14. /api/me/profile 라우트 미변경 · progression 보조 키 resolver',
  /resolveSupabaseServerAuthConfig/.test(routes) &&
    /requireAuthenticatedUser/.test(routes) &&
    !/const anon = process\.env\.SUPABASE_ANON_KEY/.test(routes) &&
    /app\.get\('\/api\/me\/profile'/.test(serverJs) &&
    /ensureAndGetProgression\(uid\)/.test(serverJs),
);

ok(
  '15. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);

ok(
  '16. 공개 level 읽기는 INSERT 없음',
  /async function loadPublicLevelsByUserIds/.test(svc),
);
(function () {
  const fn = svc.split('async function loadPublicLevelsByUserIds')[1].split('async function selectProgressionRow')[0];
  ok(
    '16b. loadPublicLevelsByUserIds no insert/ensure',
    !/\.insert\(/.test(fn) && !/ensureAndGetProgression/.test(fn) && /select\('user_id, level'\)/.test(fn),
  );
})();

ok(
  '17. fallback 1을 rememberPublicAuthorLevel 하지 않음',
  /function rememberPublicAuthorLevel/.test(indexHtml) &&
    !/rememberPublicAuthorLevel\([^)]*,\s*1\s*\)/.test(indexHtml) &&
    /typeof j\.level !== 'number'/.test(indexHtml),
);

section('loadPublicLevelsByUserIds mock');
(async function () {
  const progression = require('../server/user-progression-service');
  const UID_A = '11111111-1111-4111-8111-111111111111';
  const UID_B = '22222222-2222-4222-8222-222222222222';
  let selectCols = '';
  let queriedIds = [];
  const map = await progression.loadPublicLevelsByUserIds(
    [UID_A, 'not-a-uuid', UID_A, UID_B],
    {
      from: function (table) {
        ok('mock table user_progression', table === 'user_progression');
        return {
          select: function (cols) {
            selectCols = String(cols || '');
            return {
              in: async function (col, ids) {
                queriedIds = ids.slice();
                return {
                  data: [{ user_id: UID_A, level: 4 }],
                  error: null,
                };
              },
            };
          },
        };
      },
    },
  );

  ok('select cols user_id, level only', selectCols === 'user_id, level');
  ok(
    'invalid uuid omitted from query',
    queriedIds.indexOf('not-a-uuid') < 0 && queriedIds.indexOf(UID_A) >= 0 && queriedIds.indexOf(UID_B) >= 0,
  );
  ok('A level 4 from server row', map[UID_A] === 4);
  ok('B missing row omitted (not fake 1)', map[UID_B] == null && !Object.prototype.hasOwnProperty.call(map, UID_B));
  ok('map values are level only', JSON.stringify(map) === JSON.stringify({ [UID_A]: 4 }));

  const { createBoardDataMapper } = require('../server/board-data-mapper');
  const m = createBoardDataMapper();
  const anon = m.mapPostForViewer(
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authorUserId: UID_A,
      territory: 'CENTRAL',
      title: 't',
      content: 'c',
      isAnonymous: true,
      status: 'ACTIVE',
      createdAt: '2026-09-03T00:00:00.000Z',
    },
    UID_B,
  );
  ok(
    'anonymous author has no userId/level',
    anon.author && anon.author.userId == null && anon.author.level == null && !('xp' in anon.author),
  );

  const named = m.mapCommentForViewer(
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authorUserId: UID_A,
      content: 'hi',
      status: 'ACTIVE',
      createdAt: '2026-09-03T00:00:00.000Z',
    },
    UID_B,
  );
  ok(
    'comment mapper has userId and no xp/fame/email',
    named.author &&
      named.author.userId === UID_A &&
      named.author.level == null &&
      !('xp' in named.author) &&
      !('fame' in named.author) &&
      !('email' in named.author),
  );

  finish();
})().catch(function (e) {
  ok('mock runner', false, e && e.stack ? e.stack : String(e));
  finish();
});

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
}
