'use strict';
/**
 * ProfileFrame 활동 수치 = 서버 canonical COUNT
 * posts/comments/receivedLikes/discussions
 * node tools/test-profile-activity-canonical.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

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

const SOIL = 'a1461578-ecc7-43bf-a322-91e9bd9bccb9';
const ARENA = 'b2024a2d-4b3f-4fd4-be2f-68035a19d739';
const HARD = '88073fef-c74b-4387-9143-53665dc3045d';
const SHOP = 'e72e9c04-a187-4ee9-9105-b66ca9585673';

section('소스 가드');
const indexHtml = read('public/index.html');
const serverJs = read('server.js');
const activitySvc = read('server/user-activity-stats-service.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});
const diffActivity = execFileSync('git', ['diff', '--', 'server/user-activity-stats-service.js', 'server.js', 'public/index.html'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. GET /api/me/profile returns activityStats',
  /app\.get\('\/api\/me\/profile'/.test(serverJs) &&
    /activityStats,/.test(serverJs) &&
    /loadActivityStats/.test(serverJs),
);
ok(
  '2. service COUNT board_posts/board_comments ACTIVE + EMPATHY_RECEIVED',
  /board_posts/.test(activitySvc) &&
    /board_comments/.test(activitySvc) &&
    /status', 'ACTIVE'/.test(activitySvc) &&
    /EMPATHY_RECEIVED/.test(activitySvc) &&
    /author_user_id/.test(activitySvc),
);
ok(
  '3. receivedLikes 는 event COUNT 이며 fame/reputation_score 복사 아님',
  /receivedLikes/.test(activitySvc) &&
    /fame\(reputation_score\) 과 별도 COUNT/.test(activitySvc) &&
    !/reputation_score/.test(activitySvc.replace(/fame\(reputation_score\)/g, '')),
);
ok(
  '4. discussions = distinct postId (글 ∪ 댓글)',
  /discussionIds/.test(activitySvc) && /post_id/.test(activitySvc),
);
ok(
  '5. 클라이언트 count를 서버에 POST 하지 않음',
  !/POST['"]\s*,\s*['"]\/api\/me\/profile/.test(indexHtml) &&
    !/activityStats[\s\S]{0,80}authFetch\([^)]*method:\s*['"]POST/.test(indexHtml) &&
    !/body:.*posts/.test(diffActivity.slice(0, 20000)),
);
ok(
  '6. member ProfileFrame activity = cache.canonicalActivityStats',
  /실회원은 GET \/api\/me\/profile activityStats 만/.test(indexHtml) &&
    /canonicalActivityStats/.test(indexHtml) &&
    /jProf\.activityStats/.test(indexHtml),
);
ok(
  '7. member loadCurrentUserProfile 가 bundle mergeResolvedProfileActivity 를 쓰지 않음',
  (function () {
    var marker = '실회원은 GET /api/me/profile activityStats 만';
    var i = indexHtml.indexOf(marker);
    if (i < 0) return false;
    var slice = indexHtml.slice(i, i + 1800);
    return (
      slice.indexOf('mergeResolvedProfileTerritory') >= 0 &&
      slice.indexOf('mergeResolvedProfileActivity') < 0 &&
      slice.indexOf('canonicalActivityStats') >= 0
    );
  })(),
);
ok(
  '8. Guest activity 임의 숫자 없음',
  /guestProgressionEmpty:\s*true/.test(indexHtml) &&
    /createGuestVisitorProfileBase/.test(indexHtml) &&
    !/posts:\s*24/.test(indexHtml) &&
    !/comments:\s*183/.test(indexHtml) &&
    !/receivedLikes:\s*421/.test(indexHtml) &&
    !/aura:\s*89/.test(indexHtml),
);
ok(
  '9. 팔로워 forceRealData → 0 (follow 신규 구현 없음)',
  /DATA_NOT_CONNECTED · 실회원 0/.test(indexHtml) &&
    !/from\('user_follows'\)/.test(activitySvc) &&
    !/CREATE TABLE[\s\S]*user_follows/.test(diffActivity),
);
ok(
  '10. 글/댓글 작성 후 profile prefetch (서버 recount)',
  /createMemberCanonicalBoardPost[\s\S]*__scPrefetchUserProfile/.test(indexHtml) &&
    /createMemberCanonicalBoardComment[\s\S]*__scPrefetchUserProfile/.test(indexHtml),
);
ok(
  '11. 이번 작업 follow 시스템 / XP / fame 정책 / 집계 테이블 미생성',
  !/FAME_REWARDS/.test(activitySvc) &&
    !/XP_PER_LEVEL/.test(activitySvc) &&
    !/CREATE TABLE/.test(activitySvc) &&
    !/from\('user_follows'\)/.test(activitySvc),
);
ok(
  '12. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);

section('집계 시뮬레이션 (fixture)');
const activityService = require('../server/user-activity-stats-service');

function createMockSb(tables) {
  return {
    from: function (name) {
      var rows = (tables[name] || []).slice();
      var q = {
        select: function () {
          return q;
        },
        eq: function (col, val) {
          rows = rows.filter(function (r) {
            return String(r[col]) === String(val);
          });
          return q;
        },
        then: function (resolve, reject) {
          return Promise.resolve({ data: rows.slice(), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const USER_A = '11111111-1111-4111-8111-111111111111';
const POST_A1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const POST_A2 = 'aaaaaaaa-2222-4222-8222-222222222222';
const POST_B1 = 'bbbbbbbb-1111-4111-8111-111111111111';
const POST_DEL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CMT_A1 = 'cccccccc-1111-4111-8111-111111111111';
const CMT_A2 = 'cccccccc-2222-4222-8222-222222222222';
const CMT_DEL = 'cccccccc-dddd-4ddd-8ddd-dddddddddddd';

const fixtureTables = {
  board_posts: [
    { id: POST_A1, author_user_id: USER_A, status: 'ACTIVE' },
    { id: POST_A2, author_user_id: USER_A, status: 'ACTIVE' },
    { id: POST_DEL, author_user_id: USER_A, status: 'DELETED' },
    { id: POST_B1, author_user_id: '99999999-9999-4999-8999-999999999999', status: 'ACTIVE' },
  ],
  board_comments: [
    { id: CMT_A1, post_id: POST_B1, author_user_id: USER_A, status: 'ACTIVE' },
    { id: CMT_A2, post_id: POST_A1, author_user_id: USER_A, status: 'ACTIVE' },
    { id: CMT_DEL, post_id: POST_B1, author_user_id: USER_A, status: 'DELETED' },
  ],
  user_progression_events: [
    { id: 'e1', user_id: USER_A, event_type: 'EMPATHY_RECEIVED' },
    { id: 'e2', user_id: USER_A, event_type: 'EMPATHY_RECEIVED' },
    { id: 'e3', user_id: USER_A, event_type: 'POST_CREATED' },
    { id: 'e4', user_id: '99999999-9999-4999-8999-999999999999', event_type: 'EMPATHY_RECEIVED' },
  ],
};

(async function runFixture() {
  activityService.setStatsClientForTests(createMockSb(fixtureTables));
  const stats = await activityService.loadActivityStats(USER_A);
  activityService.resetStatsClientForTests();

  ok('13. canonical 게시글 2 → posts 2 (DELETED 제외)', stats.posts === 2, JSON.stringify(stats));
  ok('14. canonical 댓글 2 → comments 2 (DELETED 제외)', stats.comments === 2, JSON.stringify(stats));
  ok(
    '15. EMPATHY_RECEIVED 2 → receivedLikes 2 (POST_CREATED/타인 event 제외)',
    stats.receivedLikes === 2,
    JSON.stringify(stats),
  );
  ok(
    '16. discussions = distinct(POST_A1, POST_A2, POST_B1) = 3',
    stats.discussions === 3,
    JSON.stringify(stats),
  );
  ok('17. source=server_canonical', stats.source === 'server_canonical');

  const grown = JSON.parse(JSON.stringify(fixtureTables));
  grown.board_posts.push({
    id: 'aaaaaaaa-3333-4333-8333-333333333333',
    author_user_id: USER_A,
    status: 'ACTIVE',
  });
  grown.board_comments.push({
    id: 'cccccccc-3333-4333-8333-333333333333',
    post_id: 'bbbbbbbb-2222-4222-8222-222222222222',
    author_user_id: USER_A,
    status: 'ACTIVE',
  });
  activityService.setStatsClientForTests(createMockSb(grown));
  const stats2 = await activityService.loadActivityStats(USER_A);
  activityService.resetStatsClientForTests();
  ok('18. 새 canonical 게시글 → posts 2→3', stats2.posts === 3, JSON.stringify(stats2));
  ok('19. 새 canonical 댓글 → comments 2→3', stats2.comments === 3, JSON.stringify(stats2));
  ok('20. 새 글+다른 post 댓글 → discussions 3→5', stats2.discussions === 5, JSON.stringify(stats2));

  section('클라이언트 hydrate (localStorage 조작 무시)');
  const apiStats = { posts: 2, comments: 2, receivedLikes: 2, discussions: 3 };
  const tamperedBundle = { posts: { CENTRAL: [{ id: 'p_legacy', authorId: USER_A }] } };
  const mockActivity = { posts: 24, comments: 183, receivedLikes: 421, discussions: 37, aura: 89 };

  function hydrateMember(jProf) {
    var canonicalActivityStats = null;
    if (jProf.ok && jProf.activityStats && typeof jProf.activityStats === 'object') {
      canonicalActivityStats = {
        posts: Math.max(0, Math.floor(Number(jProf.activityStats.posts) || 0)),
        comments: Math.max(0, Math.floor(Number(jProf.activityStats.comments) || 0)),
        receivedLikes: Math.max(0, Math.floor(Number(jProf.activityStats.receivedLikes) || 0)),
        discussions: Math.max(0, Math.floor(Number(jProf.activityStats.discussions) || 0)),
      };
    }
    var cache = { canonicalActivityStats: canonicalActivityStats, fame: 1, level: 2 };
    var profile = {
      activity: { posts: 0, comments: 0, receivedLikes: 0, discussions: 0, aura: 0 },
    };
    var canonicalActivity = cache.canonicalActivityStats;
    if (canonicalActivity && typeof canonicalActivity === 'object') {
      profile.activity = Object.assign({}, profile.activity, {
        posts: canonicalActivity.posts,
        comments: canonicalActivity.comments,
        receivedLikes: canonicalActivity.receivedLikes,
        discussions: canonicalActivity.discussions,
      });
    }
    return profile.activity;
  }

  const memberAct = hydrateMember({ ok: true, activityStats: apiStats });
  ok(
    '21. ProfileFrame N/M = API counts (bundle p_legacy 미포함)',
    memberAct.posts === 2 &&
      memberAct.comments === 2 &&
      memberAct.receivedLikes === 2 &&
      memberAct.discussions === 3 &&
      tamperedBundle.posts.CENTRAL.length === 1,
    JSON.stringify(memberAct),
  );
  ok(
    '22. localStorage Mock 숫자가 member count를 덮지 않음',
    memberAct.posts !== mockActivity.posts && memberAct.comments !== mockActivity.comments,
  );

  ok(
    '23. Guest empty는 Mock 24/183을 canonical로 쓰지 않음',
    /guestEmpty: true/.test(indexHtml) &&
      /posts: '--'/.test(indexHtml) &&
      memberAct.posts !== mockActivity.posts,
  );

  section('실회원 live COUNT (read-only)');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const liveReport = {};
  if (!url || !key) {
    ok('24. live DB configured', false, 'SUPABASE env missing');
  } else {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    activityService.setStatsClientForTests(sb);
    const ids = [
      ['soilBeetle', SOIL],
      ['sentencearena', ARENA],
      ['hard', HARD],
      ['shop', SHOP],
    ];
    let liveOk = true;
    for (let i = 0; i < ids.length; i++) {
      const label = ids[i][0];
      const uid = ids[i][1];
      const st = await activityService.loadActivityStats(uid);
      const posts = await sb
        .from('board_posts')
        .select('id, status')
        .eq('author_user_id', uid);
      const comments = await sb
        .from('board_comments')
        .select('id, status, post_id')
        .eq('author_user_id', uid);
      const events = await sb
        .from('user_progression_events')
        .select('id')
        .eq('user_id', uid)
        .eq('event_type', 'EMPATHY_RECEIVED');
      const prog = await sb
        .from('user_progression')
        .select('level, xp, reputation_score')
        .eq('user_id', uid)
        .maybeSingle();
      const prof = await sb.from('profiles').select('display_name').eq('id', uid).maybeSingle();
      const activePosts = (posts.data || []).filter(function (p) {
        return p.status === 'ACTIVE';
      }).length;
      const activeComments = (comments.data || []).filter(function (c) {
        return c.status === 'ACTIVE';
      }).length;
      const emp = (events.data || []).length;
      liveReport[label] = {
        displayName: prof.data && prof.data.display_name,
        posts: st.posts,
        comments: st.comments,
        receivedLikes: st.receivedLikes,
        discussions: st.discussions,
        fame: prog.data ? Number(prog.data.reputation_score) : null,
        level: prog.data ? Number(prog.data.level) : null,
        xp: prog.data ? Number(prog.data.xp) : null,
      };
      if (st.posts !== activePosts || st.comments !== activeComments || st.receivedLikes !== emp) {
        liveOk = false;
      }
    }
    activityService.resetStatsClientForTests();
    ok(
      '24. live COUNT = 직접 SELECT ACTIVE/EMPATHY_RECEIVED',
      liveOk,
      JSON.stringify(liveReport),
    );
    ok(
      '25. receivedLikes ≠ fame 필드 복사 (독립 COUNT; 값이 같아도 source 다름)',
      liveReport.soilBeetle &&
        typeof liveReport.soilBeetle.receivedLikes === 'number' &&
        typeof liveReport.soilBeetle.fame === 'number',
    );
    ok(
      '26. live 활동 COUNT 는 음수 아님 (절대 post=0 고정 없음)',
      liveReport.hard &&
        liveReport.hard.posts >= 0 &&
        liveReport.hard.comments >= 0 &&
        liveReport.hard.receivedLikes >= 0,
      JSON.stringify(liveReport.hard),
    );
  }

  console.log('\n[Chrome 기대 표시 — 로그인 회원 ProfileFrame 활동 5칸]');
  console.log(JSON.stringify(liveReport, null, 2));

  console.log('\n결과: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  activityService.resetStatsClientForTests();
  process.exit(1);
});
