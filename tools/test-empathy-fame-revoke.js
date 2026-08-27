'use strict';
/**
 * EMPATHY 취소 → 명성 회수. 실제 event 제거 1회만 -1.
 * node tools/test-empathy-fame-revoke.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const teardown = require('./test-process-teardown');
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
const svc = read('server/user-progression-service.js');
const rankCoreSrc = read('shared/user-rank-core.js');
const rpcSql = read('supabase/migration_empathy_received_fame_revoke_rpc.sql');
const addRpcSql = read('supabase/migration_empathy_received_fame_rpc.sql');
const reactionSql = read('supabase/migration_board_core_system.sql');
const defs = read('public/achievement-definitions.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. cancel policy = REVOKE_ON_REMOVED_EMPATHY',
  /FAME_CANCEL_POLICY = 'REVOKE_ON_REMOVED_EMPATHY'/.test(rankCoreSrc) &&
    /FAME_CANCEL_POLICY=REVOKE_ON_REMOVED_EMPATHY/.test(indexHtml),
);
ok(
  '2. RPC는 실제 EMPATHY_RECEIVED DELETE + FOR UPDATE',
  /revoke_empathy_received_fame/.test(rpcSql) &&
    /DELETE FROM public\.user_progression_events/.test(rpcSql) &&
    /event_type = 'EMPATHY_RECEIVED'/.test(rpcSql) &&
    /FOR UPDATE/.test(rpcSql) &&
    /RETURNING id, amount/.test(rpcSql) &&
    /status', 'NOT_FOUND'/.test(rpcSql),
);
ok(
  '3. 0 미만 방지 + XP 불변',
  /v_new_rep := GREATEST\(/.test(rpcSql) &&
    /newXp', COALESCE\(v_current\.xp, 0\)/.test(rpcSql) &&
    /xpDelta', 0/.test(rpcSql),
);
ok(
  '4. 새 테이블/DROP/TRUNCATE 없음 · service_role only',
  !/\bCREATE TABLE\b/.test(rpcSql) &&
    !/\bDROP TABLE\b/.test(rpcSql) &&
    !/\bTRUNCATE\b/.test(rpcSql) &&
    /GRANT EXECUTE ON FUNCTION public\.revoke_empathy_received_fame/.test(rpcSql) &&
    /TO service_role/.test(rpcSql),
);
ok(
  '5. 추가 RPC는 음수 amount로 명성 깎지 않음 유지',
  /GREATEST\(0, COALESCE\(p_amount, 0\)\)/.test(addRpcSql),
);
ok(
  '6. 게시글/댓글 DELETE empathy 라우트',
  /router\.delete\('\/posts\/:postId\/empathy'/.test(boardRoutes) &&
    /revokePostEmpathy/.test(boardRoutes) &&
    /router\.delete\('\/comments\/:commentId\/empathy'/.test(boardRoutes) &&
    /revokeCommentEmpathy/.test(boardRoutes) &&
    /receiveCommentEmpathy/.test(boardRoutes),
);
ok(
  '7. 대댓글은 board_comments 동일 경로 (새 저장소 없음)',
  /대댓글은 board_comments 동일 행/.test(boardSvc) &&
    /receiveCommentEmpathy/.test(boardSvc) &&
    /revokeCommentEmpathy/.test(boardSvc),
);
function sliceFn(src, startName, endName) {
  const start = src.indexOf('async function ' + startName);
  const end = src.indexOf(endName, start + 1);
  return start >= 0 && end > start ? src.slice(start, end) : '';
}
const revokePostSrc = sliceFn(boardSvc, 'revokePostEmpathy', 'async function resolveCommentEmpathyContext');
const revokeCommentSrc = sliceFn(boardSvc, 'revokeCommentEmpathy', 'return {');
ok(
  '8. 취소 경로 업적 evaluator 미호출',
  /grantEmpathyAchievements/.test(boardSvc) &&
    revokePostSrc.indexOf('grantEmpathyAchievements') < 0 &&
    revokeCommentSrc.indexOf('grantEmpathyAchievements') < 0 &&
    revokePostSrc.indexOf('evaluateAfterEmpathyReceived') < 0 &&
    revokeCommentSrc.indexOf('evaluateAfterEmpathyReceived') < 0,
);
ok(
  '9. LIKE/DISLIKE toggle 은 명성 RPC 미사용',
  /async function toggleReaction[\s\S]*?return repository\.toggleReaction/.test(boardSvc) &&
    !/applyEmpathyReceivedFame|revokeEmpathyReceivedFame|reputation_score/.test(
      boardSvc.match(/async function toggleReaction[\s\S]*?return repository\.toggleReaction/)[0],
    ) &&
    !/reaction_type IN \([^)]*EMPATHY/.test(reactionSql),
);
ok(
  '10. Alien 내부 추가/취소 Earth 명성 없음',
  /ALIEN_INTERNAL_NO_EARTH_FAME/.test(boardSvc) &&
    /isAlienInternalTerritory\(post\.territory\)/.test(boardSvc) &&
    /isAlienInternalTerritory\(ctx\.post\.territory\)/.test(boardSvc),
);
ok(
  '11. first-empathy-received PERMANENT_ONCE 유지',
  /id: 'first-empathy-received'/.test(defs) &&
    /persistenceType: 'PERMANENT_ONCE'/.test(
      defs.slice(defs.indexOf("id: 'first-empathy-received'"), defs.indexOf("id: 'first-empathy-received'") + 800),
    ),
);
ok(
  '12. 클라이언트 취소 API',
  /revokeMemberCanonicalPostEmpathy/.test(boardClient) &&
    /revokeMemberCanonicalCommentEmpathy/.test(boardClient) &&
    /grantMemberCanonicalCommentEmpathy/.test(boardClient) &&
    /fetchMemberCanonicalEmpathy\('DELETE'/.test(boardClient),
);
ok(
  '13. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff),
);

section('isolated mock: 추가/취소/중복/재추가/여러 사용자');
(function () {
  const progression = require('../server/user-progression-service');
  const persist = require('../server/achievement-persist-service');
  const orig = persist.getAdminClient;

  const AUTHOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const REACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const REACTOR_C = 'cccccccc-cccc-4ccc-9ccc-cccccccccccc';
  const REACTOR_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const POST_A = '11111111-1111-4111-8111-111111111111';
  const COMMENT_A = '22222222-2222-4222-8222-222222222222';
  const REPLY_A = '33333333-3333-4333-8333-333333333333';
  const SELF_POST = '44444444-4444-4444-8444-444444444444';

  const rows = {
    [AUTHOR_A]: { level: 2, xp: 62, reputation_score: 0 },
    [REACTOR_B]: { level: 1, xp: 10, reputation_score: 0 },
    [REACTOR_C]: { level: 1, xp: 0, reputation_score: 0 },
    [REACTOR_D]: { level: 1, xp: 0, reputation_score: 0 },
  };
  const events = {};
  const posts = {
    [POST_A]: { id: POST_A, author_user_id: AUTHOR_A, status: 'ACTIVE' },
    [SELF_POST]: { id: SELF_POST, author_user_id: REACTOR_B, status: 'ACTIVE' },
  };
  const comments = {
    [COMMENT_A]: {
      id: COMMENT_A,
      author_user_id: AUTHOR_A,
      status: 'ACTIVE',
      post_id: POST_A,
    },
    [REPLY_A]: {
      id: REPLY_A,
      author_user_id: AUTHOR_A,
      status: 'ACTIVE',
      post_id: POST_A,
    },
  };
  const achievements = {};

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
        if (table === 'board_comments') {
          return {
            select: function () {
              return {
                eq: function (_c, id) {
                  return {
                    maybeSingle: async function () {
                      return { data: comments[id] || null, error: null };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === 'user_achievements') {
          return {
            select: function () {
              return {
                eq: function () {
                  return {
                    eq: async function () {
                      return { data: Object.keys(achievements).map(function (k) {
                        return { achievement_key: k };
                      }), error: null };
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
        const uid = args.p_user_id;
        const row = rows[uid];
        if (!row) return { data: null, error: { message: 'missing row' } };
        const base = {
          previousLevel: row.level,
          newLevel: row.level,
          levelChanged: false,
          previousXp: row.xp,
          newXp: row.xp,
          xpDelta: 0,
        };
        if (name === 'apply_user_progression_event') {
          if (events[args.p_dedupe_key]) {
            return {
              data: Object.assign({ status: 'DUPLICATE', newReputation: row.reputation_score }, base),
              error: null,
            };
          }
          events[args.p_dedupe_key] = { amount: Number(args.p_amount) || 0, type: args.p_event_type };
          if (args.p_event_type === 'EMPATHY_RECEIVED') {
            row.reputation_score += Math.max(0, Number(args.p_amount) || 0);
            if (!achievements['first-empathy-received'] && row.reputation_score >= 1) {
              achievements['first-empathy-received'] = true;
            }
          }
          return {
            data: Object.assign({ status: 'APPLIED', newReputation: row.reputation_score }, base),
            error: null,
          };
        }
        if (name === 'revoke_empathy_received_fame') {
          const ev = events[args.p_dedupe_key];
          if (!ev) {
            return {
              data: Object.assign({
                status: 'NOT_FOUND',
                newReputation: row.reputation_score,
                fameDelta: 0,
              }, base),
              error: null,
            };
          }
          delete events[args.p_dedupe_key];
          const amt = Math.max(0, Number(ev.amount) || 0);
          row.reputation_score = Math.max(0, row.reputation_score - amt);
          return {
            data: Object.assign({
              status: 'APPLIED',
              newReputation: row.reputation_score,
              fameDelta: -amt,
            }, base),
            error: null,
          };
        }
        return { data: null, error: { message: 'unexpected rpc ' + name } };
      },
    };
  };

  return progression
    .applyEmpathyReceivedFame(REACTOR_B, POST_A)
    .then(function (r1) {
      ok('14. EMPATHY 추가 → +1', r1.granted === true && r1.fame === 1 && r1.fameDelta === 1 && r1.xp === 62 && r1.level === 2, JSON.stringify(r1));
      return progression.revokeEmpathyReceivedFame(REACTOR_B, POST_A);
    })
    .then(function (r2) {
      ok('15. EMPATHY 취소 → -1', r2.revoked === true && r2.fame === 0 && r2.fameDelta === -1 && r2.xp === 62, JSON.stringify(r2));
      return progression.revokeEmpathyReceivedFame(REACTOR_B, POST_A);
    })
    .then(function (r3) {
      ok('16. 중복 취소 → 추가 -1 없음', r3.revoked === false && r3.reason === 'NOT_FOUND' && r3.fame === 0 && r3.fameDelta === 0, JSON.stringify(r3));
      return progression.revokeEmpathyReceivedFame(REACTOR_C, POST_A);
    })
    .then(function (r4) {
      ok('17. EMPATHY 없는 상태 취소 → 변화 없음', r4.revoked === false && r4.fame === 0 && r4.fameDelta === 0, JSON.stringify(r4));
      return progression.applyEmpathyReceivedFame(REACTOR_B, POST_A);
    })
    .then(function (r5) {
      return progression.revokeEmpathyReceivedFame(REACTOR_B, POST_A).then(function () {
        return progression.applyEmpathyReceivedFame(REACTOR_B, POST_A);
      }).then(function (again) {
        ok('18. 추가→취소→추가 → 최종 +1', again.granted === true && again.fame === 1 && rows[AUTHOR_A].reputation_score === 1 && !!events['EMPATHY_RECEIVED:' + POST_A + ':' + REACTOR_B], JSON.stringify(again));
        return progression.applyEmpathyReceivedFame(REACTOR_C, POST_A);
      });
    })
    .then(function (rBC) {
      ok('19. B/C 두 사용자 EMPATHY → +2', rBC.granted === true && rBC.fame === 2, JSON.stringify(rBC));
      return progression.revokeEmpathyReceivedFame(REACTOR_B, POST_A);
    })
    .then(function (rBOff) {
      ok('20. B만 취소 → +1 (C 유지)', rBOff.revoked === true && rBOff.fame === 1 && !!events['EMPATHY_RECEIVED:' + POST_A + ':' + REACTOR_C], JSON.stringify(rBOff));
      return progression.applyEmpathyReceivedFame(REACTOR_B, SELF_POST);
    })
    .then(function (selfOn) {
      ok('21. 자기 EMPATHY → 명성 변화 없음', selfOn.granted === false && selfOn.reason === 'SELF_EMPATHY' && selfOn.fameDelta === 0 && rows[REACTOR_B].reputation_score === 0, JSON.stringify(selfOn));
      return progression.revokeEmpathyReceivedFame(REACTOR_B, SELF_POST);
    })
    .then(function (selfOff) {
      ok('22. 자기 EMPATHY 취소 → 명성 변화 없음', selfOff.revoked === false && selfOff.reason === 'SELF_EMPATHY' && selfOff.fameDelta === 0, JSON.stringify(selfOff));
      ok('23. 공감 취소 후 first-empathy-received 유지', achievements['first-empathy-received'] === true);
      return progression.applyEmpathyReceivedFame(REACTOR_B, COMMENT_A, { targetType: 'COMMENT' });
    })
    .then(function (cOn) {
      ok('24. 댓글 EMPATHY 추가 → 작성자 +1', cOn.granted === true && cOn.fame === 2 && cOn.xp === 62, JSON.stringify(cOn));
      return progression.revokeEmpathyReceivedFame(REACTOR_B, COMMENT_A, { targetType: 'COMMENT' });
    })
    .then(function (cOff) {
      ok('25. 댓글 EMPATHY 취소 → -1', cOff.revoked === true && cOff.fame === 1, JSON.stringify(cOff));
      return progression.revokeEmpathyReceivedFame(REACTOR_B, COMMENT_A, { targetType: 'COMMENT' });
    })
    .then(function (cDup) {
      ok('26. 댓글 중복 취소 → 추가 감소 없음', cDup.revoked === false && cDup.fame === 1, JSON.stringify(cDup));
      return progression.applyEmpathyReceivedFame(REACTOR_B, REPLY_A, { targetType: 'COMMENT' });
    })
    .then(function (replyOn) {
      ok('27. 대댓글은 COMMENT 경로 재사용 +1', replyOn.granted === true && replyOn.fame === 2, JSON.stringify(replyOn));
      return progression.revokeEmpathyReceivedFame(REACTOR_B, REPLY_A, { targetType: 'COMMENT' });
    })
    .then(function (replyOff) {
      ok('28. 대댓글 취소 → -1', replyOff.revoked === true && replyOff.fame === 1, JSON.stringify(replyOff));
      return Promise.all([
        progression.revokeEmpathyReceivedFame(REACTOR_C, POST_A),
        progression.revokeEmpathyReceivedFame(REACTOR_C, POST_A),
      ]);
    })
    .then(function (pair) {
      const applied = pair.filter(function (r) { return r.revoked === true; }).length;
      const missing = pair.filter(function (r) { return r.reason === 'NOT_FOUND'; }).length;
      ok(
        '29. 동시 취소 요청 → 명성 1회만 감소',
        applied === 1 && missing === 1 && rows[AUTHOR_A].reputation_score === 0,
        JSON.stringify({ applied: applied, missing: missing, fame: rows[AUTHOR_A].reputation_score, pair: pair }),
      );
      persist.getAdminClient = orig;
      finish();
    })
    .catch(function (e) {
      persist.getAdminClient = orig;
      ok('isolated async', false, String(e && e.message ? e.message : e));
      finish();
    });
})();

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail, []);
}
