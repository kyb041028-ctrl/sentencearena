'use strict';
/**
 * BOARD_COMMENT_CREATED +12 canonical
 * node tools/test-board-comment-canonical.js
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

section('소스');
const xpCore = require('../shared/progression-xp-core');
const svc = read('server/user-progression-service.js');
const boardSvc = read('server/board-service.js');
const boardRoutes = read('server/board-routes.js');
const client = read('public/board-api-client.js');
const indexHtml = read('public/index.html');
const stats = read('server/achievement-stats-service.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });

ok('1. BOARD_COMMENT +12 ACTIVE', xpCore.XP_REWARDS.BOARD_COMMENT_CREATED === 12 && xpCore.ACTIVITY_STATUS.BOARD_COMMENT_CREATED === 'ACTIVE');
ok('2. ISSUE COMMENT ACTIVE', xpCore.ACTIVITY_STATUS.ISSUE_COMMENT_CREATED === 'ACTIVE');
ok('3. applyBoardCommentCreatedXp', /applyBoardCommentCreatedXp/.test(svc));
ok('4. dedupe BOARD_COMMENT_CREATED', /dedupeKeyForBoardCommentCreated/.test(read('shared/progression-xp-core.js')));
ok('5. createComment awaits progression+achievements', /applyBoardCommentCreatedXp/.test(boardSvc) && /evaluateAfterCommentCreated/.test(boardSvc));
ok('6. route returns progression', /progression: result\.progression/.test(boardRoutes));
ok('7. client createMemberCanonicalBoardComment', /createMemberCanonicalBoardComment/.test(client));
ok('8. UI skipLocalXp for member', /skipLocalXp:\s*true/.test(indexHtml) && /createMemberCanonicalBoardComment/.test(indexHtml));
ok('9. hydrate on openPostDetail', /hydrateCanonicalCommentsForPost/.test(indexHtml));
ok('10. empty comments stats → 0', /validCommentOnOthersPostCount = 0/.test(stats));
ok(
  '11. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);

section('idempotency mock');
(async function () {
  const progression = require('../server/user-progression-service');
  const persist = require('../server/achievement-persist-service');
  const events = {};
  let row = { level: 1, xp: 25 };
  const orig = persist.getAdminClient;
  persist.getAdminClient = function () {
    return {
      rpc: async function (name, args) {
        ok('rpc BOARD_COMMENT_CREATED', args.p_event_type === 'BOARD_COMMENT_CREATED');
        ok('amount 12', args.p_amount === 12);
        ok('dedupe key', args.p_dedupe_key === 'BOARD_COMMENT_CREATED:cmt-1');
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
            },
            error: null,
          };
        }
        events[args.p_dedupe_key] = true;
        const prev = row.xp;
        row.xp = prev + args.p_amount;
        row.level = xpCore.calculateLevelFromXp(row.xp);
        return {
          data: {
            status: 'APPLIED',
            previousLevel: 1,
            newLevel: row.level,
            levelChanged: false,
            previousXp: prev,
            newXp: row.xp,
            xpDelta: 12,
          },
          error: null,
        };
      },
      from: function () {
        return {
          select: function () {
            return {
              eq: function () {
                return {
                  maybeSingle: async function () {
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  };

  const uid = '11111111-1111-4111-8111-111111111111';
  const r1 = await progression.applyBoardCommentCreatedXp(uid, 'cmt-1');
  ok('first +12 → xp37', r1.xp === 37 && r1.status === 'APPLIED');
  const r2 = await progression.applyBoardCommentCreatedXp(uid, 'cmt-1');
  ok('duplicate +0', r2.duplicate && r2.xp === 37);
  persist.getAdminClient = orig;

  section('first-comment self vs others (evaluator core)');
  const evalCore = require('../shared/achievement-evaluation-core');
  const defCore = require('../shared/achievement-definitions-core');
  const first = defCore.getAchievementDefinition('first-comment');
  ok('first-comment def', first && first.conditionType === 'VALID_COMMENT_ON_OTHERS_POST_COUNT');
  const selfCtx = {
    ownedAchievements: [],
    achievementStats: { validCommentOnOthersPostCount: 0 },
    userProgression: { level: 1 },
  };
  const selfEval = evalCore.evaluateAchievementCondition(first, selfCtx);
  ok('self-post comments not grant', selfEval.eligible === false);
  const otherCtx = {
    ownedAchievements: [],
    achievementStats: { validCommentOnOthersPostCount: 1 },
    userProgression: { level: 1 },
  };
  const otherEval = evalCore.evaluateAchievementCondition(first, otherCtx);
  ok('others-post grants eligible', otherEval.eligible === true);

  console.log(
    JSON.stringify({
      chromeCheck: [
        '다른 회원 canonical 글에 댓글 1개',
        'EXP +12 반영',
        'first-comment 미보유 시 중앙 알람',
        '새로고침 후 댓글/EXP 유지',
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
