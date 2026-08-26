'use strict';
/**
 * 실회원 게시판 feed = canonical board_posts
 * node tools/test-board-feed-canonical.js
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

section('소스 가드');
const indexHtml = read('public/index.html');
const boardClient = read('public/board-api-client.js');
const boardSvc = read('server/board-service.js');
const boardRoutes = read('server/board-routes.js');
const mapper = read('server/board-data-mapper.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. 실회원 getPosts 는 memberCanonicalFeedCache',
  /isAuthenticatedBoardMember\(\)/.test(indexHtml) &&
    /memberCanonicalFeedCache/.test(indexHtml) &&
    /function hydrateMemberCanonicalFeed/.test(indexHtml),
);
ok(
  '2. Guest 는 sc_board_bundle_v1 유지',
  /var BUNDLE_KEY = 'sc_board_bundle_v1'/.test(indexHtml) &&
    /function loadBundle/.test(indexHtml) &&
    /isAuthenticatedBoardMember\(\)/.test(indexHtml),
);
ok(
  '3. GET /api/board/posts 재사용',
  /router\.get\('\/posts'/.test(boardRoutes) &&
    /listMemberCanonicalBoardPosts/.test(boardClient) &&
    /status: 'ACTIVE'/.test(indexHtml) &&
    /listMemberCanonicalPosts/.test(boardClient),
);
ok(
  '4. canonical 식별 = source server_canonical (UUID만으로 판정 안 함)',
  /source: 'server_canonical'/.test(mapper) &&
    /function isServerCanonicalPost/.test(indexHtml) &&
    /String\(p\.source \|\| ''\) === 'server_canonical'/.test(indexHtml) &&
    /UUID 문자열만으로는 canonical 아님/.test(indexHtml),
);
ok(
  '5. 실회원 getPosts는 canonical만 · displayOnly 혼합 금지',
  /실회원: server canonical만/.test(indexHtml) &&
    !/return copy\.concat\(getDisplayOnlyPosts/.test(indexHtml) &&
    /function getDisplayOnlyPosts/.test(indexHtml),
);
ok(
  '6. seed/demo display-only 식별 유지',
  /id\.indexOf\('demo_'\) === 0/.test(indexHtml) &&
    /id\.indexOf\('seed_'\) === 0/.test(indexHtml),
);
ok(
  '7. 작성 후 server UUID + source 유지',
  /post\.id = serverPost\.id/.test(indexHtml) &&
    /post\.source = 'server_canonical'/.test(indexHtml),
);
ok(
  '8. empathy 게이트 = isServerCanonicalPost',
  /isServerCanonicalPost\(post\)/.test(indexHtml) &&
    /grantMemberCanonicalPostEmpathy/.test(indexHtml),
);
ok(
  '9. 댓글 hydrate/작성도 server canonical post',
  /hydrateCanonicalCommentsForPost/.test(indexHtml) &&
    /isServerCanonicalPost\(post\)/.test(indexHtml) &&
    /createMemberCanonicalBoardComment/.test(indexHtml),
);
ok(
  '10. 활동명 하드코딩 없음',
  !/쇠똥구리|sentencearena|어휴힘들다|영이상점/.test(boardSvc) &&
    !/쇠똥구리/.test(mapper),
);
ok(
  '11. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff),
);
ok(
  '12. board_reactions EMPATHY 타입 추가 없음',
  !/reaction_type IN \([^)]*EMPATHY/.test(read('supabase/migration_board_core_system.sql')),
);
ok(
  '13. 신규 migration 없음 · attachCanonicalFeedHydration',
  /attachCanonicalFeedHydration/.test(boardSvc) &&
    /EMPATHY_RECEIVED/.test(boardSvc) &&
    !fs.existsSync(path.join(root, 'supabase', 'migration_board_feed_canonical.sql')),
);

section('mapper / memory list');
(async function () {
  const { createBoardDataMapper } = require('../server/board-data-mapper');
  const { createBoardService } = require('../server/board-service');
  const { createBoardMemoryRepository } = require('../server/board-memory-repository');
  const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
  const persist = require('../server/achievement-persist-service');
  persist.setAdminClientForTests({
    from: function (table) {
      return {
        select: function () {
          return {
            in: async function () {
              return { data: table === 'profiles' ? [] : [], error: null };
            },
            eq: function () {
              return {
                in: async function () {
                  return { data: [], error: null };
                },
              };
            },
          };
        },
      };
    },
  });

  const m = createBoardDataMapper();
  const mapped = m.mapPostForViewer(
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      authorUserId: 'cccccccccccccccc-cccc-4ccc-8ccc-cccccccccccc'.slice(0, 36),
      territory: 'CENTRAL',
      boardStage: 1,
      title: 'B post',
      content: 'body-b',
      status: 'ACTIVE',
      createdAt: '2026-08-15T00:00:00.000Z',
    },
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  ok(
    '14. mapPostForViewer source=server_canonical',
    mapped.source === 'server_canonical' && mapped.canonical === true && mapped.id.indexOf('p_') !== 0,
  );

  const AUTHOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const AUTHOR_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const REACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const repo = createBoardMemoryRepository();
  const service = createBoardService({
    repository: repo,
    userContext: createMockUserContextAdapter({
      territories: { [AUTHOR_B]: 'CENTRAL', [AUTHOR_C]: 'CENTRAL', [REACTOR_A]: 'CENTRAL' },
    }),
    operational: true,
  });

  const createdB = await service.createPost({ userId: AUTHOR_B }, { title: 'from-b', content: 'body-b-ok' });
  const createdC = await service.createPost({ userId: AUTHOR_C }, { title: 'from-c', content: 'body-c-ok' });
  ok(
    '15. B/C 작성 응답 canonical UUID · source',
    createdB.post &&
      createdB.post.source === 'server_canonical' &&
      createdC.post &&
      createdC.post.source === 'server_canonical' &&
      createdB.post.author.userId === AUTHOR_B &&
      createdC.post.author.userId === AUTHOR_C,
    JSON.stringify({ b: createdB.post && createdB.post.id, c: createdC.post && createdC.post.id }),
  );

  const listed = await service.listPosts({ userId: REACTOR_A }, { status: 'ACTIVE' });
  const ids = (listed || []).map(function (p) { return p.id; });
  ok(
    '16. 목록에 B·C 글 모두 표시 · 전부 server_canonical',
    listed.length >= 2 &&
      ids.indexOf(createdB.post.id) >= 0 &&
      ids.indexOf(createdC.post.id) >= 0 &&
      listed.every(function (p) { return p.source === 'server_canonical'; }),
    String(listed.length),
  );

  const empathyA = require('../server/user-progression-service');
  persist.setAdminClientForTests({
    from: function (table) {
      if (table === 'board_posts') {
        const posts = {};
        posts[createdB.post.id] = {
          id: createdB.post.id,
          author_user_id: AUTHOR_B,
          status: 'ACTIVE',
        };
        posts[createdC.post.id] = {
          id: createdC.post.id,
          author_user_id: AUTHOR_C,
          status: 'ACTIVE',
        };
        return {
          select: function () {
            return {
              eq: function (_c, id) {
                return {
                  maybeSingle: async function () {
                    return { data: posts[id] || null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      const rows = {
        [AUTHOR_B]: { level: 1, xp: 25, reputation_score: 0 },
        [AUTHOR_C]: { level: 1, xp: 25, reputation_score: 0 },
        [REACTOR_A]: { level: 1, xp: 10, reputation_score: 4 },
      };
      return {
        select: function () {
          return {
            eq: function (_c, uid) {
              return {
                maybeSingle: async function () {
                  const row = rows[uid];
                  if (!row) return { data: null, error: null };
                  return {
                    data: Object.assign({ updated_at: new Date().toISOString() }, row),
                    error: null,
                  };
                },
              };
            },
          };
        },
        insert: function () {
          return {
            select: function () {
              return {
                single: async function () {
                  return { data: { level: 1, xp: 0, reputation_score: 0 }, error: null };
                },
              };
            },
          };
        },
      };
    },
    rpc: async function (_name, args) {
      const events = persist._feedTestEvents || (persist._feedTestEvents = {});
      const rows = persist._feedTestRows || (persist._feedTestRows = {
        [AUTHOR_B]: { level: 1, xp: 25, reputation_score: 0 },
        [AUTHOR_C]: { level: 1, xp: 25, reputation_score: 0 },
        [REACTOR_A]: { level: 1, xp: 10, reputation_score: 4 },
      });
      const uid = args.p_user_id;
      const row = rows[uid];
      if (events[args.p_dedupe_key]) {
        return {
          data: {
            status: 'DUPLICATE',
            previousLevel: row.level,
            newLevel: row.level,
            previousXp: row.xp,
            newXp: row.xp,
            xpDelta: 0,
            newReputation: row.reputation_score,
          },
          error: null,
        };
      }
      events[args.p_dedupe_key] = true;
      if (args.p_event_type === 'EMPATHY_RECEIVED') row.reputation_score += args.p_amount;
      return {
        data: {
          status: 'APPLIED',
          previousLevel: row.level,
          newLevel: row.level,
          previousXp: row.xp,
          newXp: row.xp,
          xpDelta: 0,
          newReputation: row.reputation_score,
        },
        error: null,
      };
    },
  });
  persist._feedTestRows = {
    [AUTHOR_B]: { level: 1, xp: 25, reputation_score: 0 },
    [AUTHOR_C]: { level: 1, xp: 25, reputation_score: 0 },
    [REACTOR_A]: { level: 1, xp: 10, reputation_score: 4 },
  };
  persist._feedTestEvents = {};

  /* applyEmpathy uses a different from() shape; re-use isolated fame mock below */
  const origAdmin = persist.getAdminClient;
  let fameRows = {
    [AUTHOR_B]: { level: 1, xp: 25, reputation_score: 0 },
    [AUTHOR_C]: { level: 1, xp: 25, reputation_score: 0 },
    [REACTOR_A]: { level: 1, xp: 10, reputation_score: 4 },
  };
  const fameEvents = {};
  const famePosts = {};
  famePosts[createdB.post.id] = { id: createdB.post.id, author_user_id: AUTHOR_B, status: 'ACTIVE' };
  famePosts[createdC.post.id] = { id: createdC.post.id, author_user_id: AUTHOR_C, status: 'ACTIVE' };
  persist.getAdminClient = function () {
    return {
      from: function (table) {
        if (table === 'board_posts') {
          return {
            select: function () {
              return {
                eq: function (_c, id) {
                  return {
                    maybeSingle: async function () {
                      return { data: famePosts[id] || null, error: null };
                    },
                  };
                },
              };
            },
          };
        }
        return {
          select: function () {
            return {
              eq: function (_c, uid) {
                return {
                  maybeSingle: async function () {
                    const row = fameRows[uid];
                    if (!row) return { data: null, error: null };
                    return {
                      data: {
                        level: row.level,
                        xp: row.xp,
                        reputation_score: row.reputation_score,
                        updated_at: new Date().toISOString(),
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          insert: function () {
            return {
              select: function () {
                return {
                  single: async function () {
                    return { data: { level: 1, xp: 0, reputation_score: 0 }, error: null };
                  },
                };
              },
            };
          },
        };
      },
      rpc: async function (_n, args) {
        const uid = args.p_user_id;
        const row = fameRows[uid];
        if (fameEvents[args.p_dedupe_key]) {
          return {
            data: {
              status: 'DUPLICATE',
              previousLevel: row.level,
              newLevel: row.level,
              previousXp: row.xp,
              newXp: row.xp,
              xpDelta: 0,
              newReputation: row.reputation_score,
            },
            error: null,
          };
        }
        fameEvents[args.p_dedupe_key] = true;
        if (args.p_event_type === 'EMPATHY_RECEIVED') row.reputation_score += args.p_amount;
        return {
          data: {
            status: 'APPLIED',
            previousLevel: row.level,
            newLevel: row.level,
            previousXp: row.xp,
            newXp: row.xp,
            xpDelta: 0,
            newReputation: row.reputation_score,
          },
          error: null,
        };
      },
    };
  };

  const rB = await empathyA.applyEmpathyReceivedFame(REACTOR_A, createdB.post.id);
  const rC = await empathyA.applyEmpathyReceivedFame(REACTOR_A, createdC.post.id);
  ok(
    '17. A→B · A→C fame 각각 +1 · A 불변 · XP 불변',
    rB.granted &&
      rC.granted &&
      rB.recipientUserId === AUTHOR_B &&
      rC.recipientUserId === AUTHOR_C &&
      fameRows[AUTHOR_B].reputation_score === 1 &&
      fameRows[AUTHOR_C].reputation_score === 1 &&
      fameRows[REACTOR_A].reputation_score === 4 &&
      fameRows[AUTHOR_B].xp === 25 &&
      fameRows[AUTHOR_C].xp === 25,
    JSON.stringify({ rB: rB.fame, rC: rC.fame, A: fameRows[REACTOR_A] }),
  );

  persist.getAdminClient = origAdmin;
  persist.resetAdminClientForTests();

  const xpCore = require('../shared/progression-xp-core');
  ok('18. 게시글 XP +25 회귀', xpCore.XP_REWARDS.POST_CREATED === 25);
  ok('19. 댓글 XP +12 회귀', xpCore.XP_REWARDS.BOARD_COMMENT_CREATED === 12);
  ok(
    '20. Guest localStorage 키 유지',
    /sc_board_bundle_v1/.test(indexHtml) && /sc_board_posts_v1/.test(indexHtml),
  );
  ok(
    '21. 새로고침 hydrate = listMemberCanonicalBoardPosts',
    /refreshBoardView/.test(indexHtml) &&
      /hydrateMemberCanonicalFeed/.test(indexHtml) &&
      /listMemberCanonicalBoardPosts\(\{ status: 'ACTIVE' \}\)/.test(indexHtml),
  );
  ok(
    '22. legacy localStorage 자동 board_posts migration 없음',
    !/insert\(\{[\s\S]*legacy/.test(boardSvc) && !/migrateLegacy.*board_posts/.test(indexHtml),
  );

  section('live DB read-only');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  SKIP live');
    finish();
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const posts = await sb
    .from('board_posts')
    .select('id, author_user_id, territory, board_stage, status, title')
    .eq('status', 'ACTIVE');
  ok('23. ACTIVE board_posts readable', !posts.error, posts.error && posts.error.message);
  const rows = posts.data || [];
  const authors = {};
  rows.forEach(function (p) {
    authors[p.author_user_id] = (authors[p.author_user_id] || 0) + 1;
  });
  ok(
    '24. 서로 다른 canonical 작성자 2명 이상 · CENTRAL 글 존재',
    Object.keys(authors).length >= 2 &&
      rows.some(function (p) { return p.territory === 'CENTRAL' && p.board_stage === 1; }),
    JSON.stringify({ authors: Object.keys(authors).length, n: rows.length }),
  );
  const names = await sb
    .from('profiles')
    .select('id, display_name')
    .in('id', Object.keys(authors));
  const nameBy = {};
  (names.data || []).forEach(function (p) {
    nameBy[p.id] = p.display_name;
  });
  const chromeRows = rows
    .filter(function (p) { return p.territory === 'CENTRAL'; })
    .map(function (p) {
      return {
        id: p.id,
        title: p.title,
        displayName: nameBy[p.author_user_id] || null,
        authorUserId: p.author_user_id,
      };
    });
  console.log(JSON.stringify({ chromeFeedExpectCommon: chromeRows }));
  finish();
})().catch(function (e) {
  ok('async', false, String(e && e.message ? e.message : e));
  finish();
});

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
}
