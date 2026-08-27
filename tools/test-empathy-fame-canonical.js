'use strict';
/**
 * 공감 → 명성 +1 회귀. live는 절대 count가 아니라 불변식(UUID/self/fame=event COUNT).
 * 절대값 고정 금지 — Chrome 활동으로 event/fame이 늘어도 PASS 유지.
 * node tools/test-empathy-fame-canonical.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const teardown = require('./test-process-teardown');
let pass = 0;
let fail = 0;
let liveClient = null;

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

section('판정·정책 가드');
const indexHtml = read('public/index.html');
const boardClient = read('public/board-api-client.js');
const boardSvc = read('server/board-service.js');
const boardRoutes = read('server/board-routes.js');
const svc = read('server/user-progression-service.js');
const rpcSql = read('supabase/migration_empathy_received_fame_rpc.sql');
const rankCoreSrc = read('shared/user-rank-core.js');
const stats = read('server/achievement-stats-service.js');
const defs = read('public/achievement-definitions.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. Chrome 공감 버튼 = onToggleEmpathyPost',
  /onEmpathy: function \(\) \{\s*onToggleEmpathyPost\(p\.id\)/.test(indexHtml) &&
    /function onToggleEmpathyPost/.test(indexHtml),
);
ok(
  '2. 실회원 canonical 글은 grantMemberCanonicalPostEmpathy 호출',
  /grantMemberCanonicalPostEmpathy/.test(indexHtml) &&
    /grantMemberCanonicalPostEmpathy/.test(boardClient) &&
    /isAuthenticatedBoardMember\(\) &&\s*isServerCanonicalPost\(post\)/.test(indexHtml),
);
ok(
  '3. Guest/legacy 는 localStorage 경로 유지 · local authorId 로 fame 금지',
  /Guest \/ legacy localStorage 글/.test(indexHtml) &&
    /display name \/ local authorId 로 명성 지급 금지/.test(indexHtml) &&
    !/localStorage authorId/.test(svc),
);
ok(
  '3b. 활동명/특정 UUID 하드코딩 없음',
  !/쇠똥구리|sentencearena|어휴힘들다|영이상점/.test(boardSvc) &&
    !/쇠똥구리|sentencearena|어휴힘들다|영이상점/.test(svc) &&
    !/a1461578-ecc7-43bf-a322-91e9bd9bccb9/.test(boardSvc) &&
    !/a1461578-ecc7-43bf-a322-91e9bd9bccb9/.test(svc),
);
ok(
  '4. board_reactions 에 EMPATHY 타입 없음 (기존 CHECK 유지)',
  !/reaction_type IN \([^)]*EMPATHY/.test(read('supabase/migration_board_core_system.sql')),
);
ok(
  '5. 공식 증가량 = 1 (user-rank-core SSOT)',
  /EMPATHY_RECEIVED:\s*1/.test(rankCoreSrc) && /FAME_CANCEL_POLICY = 'REVOKE_ON_REMOVED_EMPATHY'/.test(rankCoreSrc),
);
ok(
  '6. RPC EMPATHY 는 XP 불변',
  /명성 전용 이벤트는 XP에 amount를 넣지 않음/.test(read('supabase/migration_user_progression_events_xp.sql')) ||
    /EMPATHY_RECEIVED'[\s\S]{0,200}v_new_xp := GREATEST\(0, COALESCE\(v_current\.xp, 0\)\)/.test(rpcSql),
);
ok(
  '7. applyEmpathyReceivedFame looks up board_posts author',
  /applyEmpathyReceivedFame/.test(svc) && /author_user_id/.test(svc) && /SELF_EMPATHY/.test(svc),
);
ok(
  '8. POST /posts/:postId/empathy 라우트',
  /\/posts\/:postId\/empathy/.test(boardRoutes) && /receivePostEmpathy/.test(boardSvc),
);
ok(
  '9. 취소 시 명성 회수는 실제 EMPATHY 제거 1회만',
  /FAME_CANCEL_POLICY=REVOKE_ON_REMOVED_EMPATHY/.test(indexHtml) &&
    /revokeMemberCanonicalPostEmpathy/.test(indexHtml) &&
    /revokeMemberCanonicalPostEmpathy/.test(boardClient),
);
ok(
  '10. first-empathy-received 이름/조건 유지',
  /id: 'first-empathy-received'/.test(defs) &&
    /name: '내 말 맞지\?'/.test(defs) &&
    /VALID_EMPATHY_RECEIVED_COUNT/.test(defs) &&
    /event_type', 'EMPATHY_RECEIVED'/.test(stats),
);
ok(
  '11. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff),
);
ok('12. DROP/TRUNCATE 없음', !/\bTRUNCATE\b|\bDROP TABLE\b/.test(rpcSql));

section('mock: A→B + A→C 공통 · display name 무관');
(function () {
  const progression = require('../server/user-progression-service');
  const rankCore = require('../shared/user-rank-core');
  const persist = require('../server/achievement-persist-service');
  const orig = persist.getAdminClient;

  const AUTHOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const AUTHOR_C = 'cccccccc-cccc-4ccc-9ccc-cccccccccccc';
  const REACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const POST_B = '11111111-1111-4111-8111-111111111111';
  const POST_C = '22222222-2222-4222-8222-222222222222';
  const SELF_POST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const LEGACY_ID = 'p_999_legacy';

  const rows = {
    [AUTHOR_B]: { level: 2, xp: 62, reputation_score: 5 },
    [AUTHOR_C]: { level: 1, xp: 25, reputation_score: 0 },
    [REACTOR_A]: { level: 1, xp: 10, reputation_score: 9 },
  };
  const events = {};
  const posts = {
    [POST_B]: { id: POST_B, author_user_id: AUTHOR_B, status: 'ACTIVE' },
    [POST_C]: { id: POST_C, author_user_id: AUTHOR_C, status: 'ACTIVE' },
    [SELF_POST]: { id: SELF_POST, author_user_id: REACTOR_A, status: 'ACTIVE' },
  };

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
                      return { data: posts[id] || null, error: null };
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
                    const row = rows[uid];
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
          insert: function (payload) {
            const uid = payload && payload.user_id;
            if (uid && !rows[uid]) {
              rows[uid] = { level: 1, xp: 0, reputation_score: 0 };
            }
            return {
              select: function () {
                return {
                  single: async function () {
                    const row = rows[uid] || { level: 1, xp: 0, reputation_score: 0 };
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
        };
      },
      rpc: async function (name, args) {
        if (name !== 'apply_user_progression_event') {
          return { data: null, error: { message: 'unexpected rpc' } };
        }
        const uid = args.p_user_id;
        const row = rows[uid];
        if (!row) return { data: null, error: { message: 'missing row' } };
        if (events[args.p_dedupe_key]) {
          return {
            data: {
              status: 'DUPLICATE',
              previousLevel: row.level,
              newLevel: row.level,
              levelChanged: false,
              previousXp: row.xp,
              newXp: row.xp,
              xpDelta: 0,
              newReputation: row.reputation_score,
            },
            error: null,
          };
        }
        events[args.p_dedupe_key] = true;
        if (args.p_event_type === 'EMPATHY_RECEIVED') {
          row.reputation_score += args.p_amount;
          return {
            data: {
              status: 'APPLIED',
              previousLevel: row.level,
              newLevel: row.level,
              levelChanged: false,
              previousXp: row.xp,
              newXp: row.xp,
              xpDelta: 0,
              newReputation: row.reputation_score,
            },
            error: null,
          };
        }
        row.xp += args.p_amount;
        return {
          data: {
            status: 'APPLIED',
            previousLevel: row.level,
            newLevel: row.level,
            previousXp: row.xp - args.p_amount,
            newXp: row.xp,
            xpDelta: args.p_amount,
            newReputation: row.reputation_score,
          },
          error: null,
        };
      },
    };
  };

  ok('13. SSOT amount === 1', rankCore.fameRewardForEvent('EMPATHY_RECEIVED') === 1);

  return progression
    .applyEmpathyReceivedFame(REACTOR_A, POST_B)
    .then(function (rB) {
      ok(
        '14. A→B fame 5→6 · XP 62 유지',
        rB.granted === true &&
          rB.recipientUserId === AUTHOR_B &&
          rB.fame === 6 &&
          rB.previousFame === 5 &&
          rB.fameDelta === 1 &&
          rB.xp === 62 &&
          rB.level === 2,
        JSON.stringify(rB),
      );
      return progression.applyEmpathyReceivedFame(REACTOR_A, POST_C);
    })
    .then(function (rC) {
      ok(
        '15. A→C fame 0→1 · C 만 변경',
        rC.granted === true &&
          rC.recipientUserId === AUTHOR_C &&
          rC.fame === 1 &&
          rC.xp === 25 &&
          rows[AUTHOR_B].reputation_score === 6 &&
          rows[AUTHOR_C].reputation_score === 1 &&
          rows[REACTOR_A].reputation_score === 9 &&
          rows[AUTHOR_B].xp === 62 &&
          rows[AUTHOR_C].xp === 25 &&
          rows[REACTOR_A].xp === 10,
        JSON.stringify({ rC: rC, rows: rows }),
      );
      return progression.applyEmpathyReceivedFame(REACTOR_A, POST_B);
    })
    .then(function (rDup) {
      ok(
        '16. duplicate A→B fame 중복 없음 (still 6)',
        rDup.duplicate === true && rDup.fame === 6 && rows[AUTHOR_B].reputation_score === 6,
        JSON.stringify(rDup),
      );
      return progression.applyEmpathyReceivedFame(REACTOR_A, SELF_POST);
    })
    .then(function (rSelf) {
      ok(
        '17. 자기 글 공감 명성 증가 없음',
        rSelf.granted === false && rSelf.reason === 'SELF_EMPATHY' && rSelf.fameDelta === 0,
        JSON.stringify(rSelf),
      );
      return progression.applyEmpathyReceivedFame(REACTOR_A, LEGACY_ID).then(
        function () {
          ok('18. legacy p_ id canonical fame 거부', false, 'should throw');
        },
        function (err) {
          ok(
            '18. legacy p_ id canonical fame 거부',
            err && err.code === 'PROGRESSION_SOURCE_ID_INVALID',
            err && err.code,
          );
        },
      );
    })
    .then(function () {
      persist.getAdminClient = orig;
      section('live DB 현재값 (read-only · 공감/글 삽입 없음)');
      return runLiveRead();
    })
    .catch(function (e) {
      persist.getAdminClient = orig;
      ok('async', false, String(e && e.message ? e.message : e));
      finish();
    });
})();

async function runLiveRead() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  SKIP live');
    finish();
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  liveClient = sb;
  const CLIENT_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DEDUPE =
    /^EMPATHY_RECEIVED:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

  /* read-only 불변식 — 특정 회원 event/fame 절대값 하드코딩 금지 (Chrome 활동으로 증가함) */

  const posts = await sb
    .from('board_posts')
    .select('id, author_user_id, status, title, created_at')
    .order('created_at', { ascending: false });
  ok('19. board_posts readable', !posts.error, posts.error && posts.error.message);
  const allPosts = posts.data || [];
  ok(
    '20. 모든 board_posts id 가 클라이언트 UUID 게이트 통과',
    allPosts.length > 0 &&
      allPosts.every(function (p) {
        return CLIENT_UUID.test(String(p.id || ''));
      }),
  );
  ok(
    '21. 모든 author_user_id 가 auth UUID',
    allPosts.every(function (p) {
      return CLIENT_UUID.test(String(p.author_user_id || ''));
    }),
  );

  const events = await sb
    .from('user_progression_events')
    .select('user_id, source_id, amount, dedupe_key, created_at')
    .eq('event_type', 'EMPATHY_RECEIVED');
  ok('22. EMPATHY_RECEIVED readable', !events.error, events.error && events.error.message);
  const evs = events.data || [];

  const postById = {};
  allPosts.forEach(function (p) {
    postById[String(p.id)] = p;
  });

  let eventsValid = true;
  let selfEmpathy = false;
  const eventCountByUser = {};
  evs.forEach(function (e) {
    const uid = String(e.user_id || '');
    eventCountByUser[uid] = (eventCountByUser[uid] || 0) + 1;
    if (Number(e.amount) !== 1) eventsValid = false;
    if (!CLIENT_UUID.test(String(e.source_id || ''))) eventsValid = false;
    const m = String(e.dedupe_key || '').match(DEDUPE);
    if (!m) {
      eventsValid = false;
      return;
    }
    const postId = m[1];
    const reactorId = m[2].toLowerCase();
    if (postId.toLowerCase() !== String(e.source_id || '').toLowerCase()) eventsValid = false;
    const post = postById[e.source_id] || postById[postId];
    if (post) {
      if (String(post.author_user_id) !== uid) eventsValid = false;
      if (reactorId === uid.toLowerCase()) selfEmpathy = true;
    }
  });

  ok(
    '23. EMPATHY_RECEIVED 불변식 (amount=1 · UUID source · dedupe post:reactor)',
    evs.length === 0 || eventsValid,
    JSON.stringify({ n: evs.length, eventsValid: eventsValid }),
  );
  ok('24. live self-empathy event 없음 (recipient ≠ reactor)', !selfEmpathy);
  ok(
    '25. event.source_id 가 board_posts 에 있으면 수신자 = author_user_id',
    eventsValid,
  );

  const authorIds = [];
  const seenAuthor = {};
  allPosts.forEach(function (p) {
    const a = String(p.author_user_id || '');
    if (!a || seenAuthor[a]) return;
    seenAuthor[a] = true;
    authorIds.push(a);
  });
  Object.keys(eventCountByUser).forEach(function (uid) {
    if (!seenAuthor[uid]) authorIds.push(uid);
  });
  const prog = await sb
    .from('user_progression')
    .select('user_id, level, xp, reputation_score')
    .in('user_id', authorIds);
  ok('26. user_progression readable', !prog.error, prog.error && prog.error.message);
  const progBy = {};
  (prog.data || []).forEach(function (p) {
    progBy[p.user_id] = p;
  });

  let fameConsistent = true;
  Object.keys(eventCountByUser).forEach(function (uid) {
    const row = progBy[uid];
    if (!row) {
      fameConsistent = false;
      return;
    }
    if (Number(row.reputation_score) !== eventCountByUser[uid]) fameConsistent = false;
  });
  ok(
    '27. fame = EMPATHY_RECEIVED COUNT (절대값 고정 아님 · Chrome으로 N이 늘어도 N=N 유지)',
    fameConsistent,
    JSON.stringify(eventCountByUser),
  );

  let rangesOk = true;
  Object.keys(progBy).forEach(function (uid) {
    const row = progBy[uid];
    const level = Number(row.level);
    const xp = Number(row.xp);
    const fame = Number(row.reputation_score);
    if (!(level >= 1 && level <= 10 && xp >= 0 && fame >= 0)) rangesOk = false;
  });
  ok('28. live level 1~10 · xp>=0 · fame>=0 (특정 lv/xp/fame 숫자 고정 없음)', rangesOk);

  const sampleEv = evs[0];
  ok(
    '29. 공감 identity 는 display name 이 아니라 UUID (event.user_id / dedupe reactor)',
    evs.length === 0 ||
      (sampleEv &&
        CLIENT_UUID.test(String(sampleEv.user_id || '')) &&
        DEDUPE.test(String(sampleEv.dedupe_key || ''))),
  );

  const prof = await sb.from('profiles').select('id, display_name').in('id', authorIds);
  const nameBy = {};
  (prof.data || []).forEach(function (p) {
    nameBy[p.id] = p.display_name;
  });
  console.log(
    JSON.stringify({
      liveInvariantReport: {
        canonicalPosts: allPosts.length,
        empathyEvents: evs.length,
        authors: authorIds.length,
        sample: authorIds.slice(0, 4).map(function (uid) {
          const row = progBy[uid] || {};
          return {
            displayName: nameBy[uid] || null,
            posts: allPosts.filter(function (p) {
              return p.author_user_id === uid;
            }).length,
            empathyEvents: eventCountByUser[uid] || 0,
            fame: row.reputation_score != null ? Number(row.reputation_score) : null,
            level: row.level != null ? Number(row.level) : null,
            xp: row.xp != null ? Number(row.xp) : null,
          };
        }),
      },
    }),
  );
  finish();
}

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail, liveClient ? [liveClient] : []);
}
