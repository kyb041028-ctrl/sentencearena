'use strict';
/**
 * Lv1~10 XP SSOT + POST_CREATED earning
 * node tools/test-progression-xp-earning.js
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

section('SSOT 경계');
const xpCore = require('../shared/progression-xp-core');
const cases = [
  [0, 1],
  [39, 1],
  [40, 2],
  [89, 2],
  [90, 3],
  [149, 3],
  [150, 4],
  [219, 4],
  [220, 5],
  [299, 5],
  [300, 6],
  [419, 6],
  [420, 7],
  [579, 7],
  [580, 8],
  [799, 8],
  [800, 9],
  [1099, 9],
  [1100, 10],
  [1499, 10],
  [1500, 10],
  [9999, 10],
];
cases.forEach(function (c) {
  ok('xp' + c[0] + ' → Lv' + c[1], xpCore.calculateLevelFromXp(c[0]) === c[1]);
});
ok('Lv1 xp0 → 0%', xpCore.xpProgressInLevel(1, 0).pct === 0);
ok('xp40 Lv2 → 0%', xpCore.xpProgressInLevel(2, 40).pct === 0);
ok('xp220 Lv5', xpCore.calculateLevelFromXp(220) === 5);
ok('xp300 Lv6', xpCore.calculateLevelFromXp(300) === 6);
ok('xp1500 Lv10 100%', xpCore.xpProgressInLevel(10, 1500).pct === 100);
ok('MAX_LEVEL 10 · MAX_TOTAL_XP 1500', xpCore.MAX_LEVEL === 10 && xpCore.MAX_TOTAL_XP === 1500);
ok(
  'XP_PER_LEVEL official',
  JSON.stringify(xpCore.XP_PER_LEVEL) === JSON.stringify([40, 50, 60, 70, 80, 120, 160, 220, 300, 400]),
);
ok('POST +25 · comment statuses', xpCore.XP_REWARDS.POST_CREATED === 25 && xpCore.ACTIVITY_STATUS.BOARD_COMMENT_CREATED === 'ACTIVE' && xpCore.ACTIVITY_STATUS.ISSUE_COMMENT_CREATED === 'ACTIVE');
ok('DELETE_XP_POLICY PENDING', xpCore.DELETE_XP_POLICY === 'PENDING');

section('config / service 정렬');
const cfgProg = require('../config/player-progression');
ok('config uses same levelFromXp', cfgProg.levelFromTotalXp(300) === 6 && cfgProg.MAX_LEVEL === 10);
const ud = require('../shared/user-data-config-core');
ok('user-data autoLevelCap 10', ud.PROGRESSION_RULES.autoLevelCap === 10);
ok('user-data computeAutoLevelFromXp(300)=6', ud.computeAutoLevelFromXp(300) === 6);

section('소스 연결');
const boardSvc = read('server/board-service.js');
const boardRoutes = read('server/board-routes.js');
const mig = read('supabase/migration_user_progression_events_xp.sql');
const indexHtml = read('public/index.html');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });

ok('migration events+RPC', /user_progression_events/.test(mig) && /apply_user_progression_event/.test(mig) && /WHEN v_new_xp >= 1100 THEN 10/.test(mig));
ok('board createPost applyPostCreatedXp', /applyPostCreatedXp/.test(boardSvc));
ok('board route returns progression', /progression: result\.progression/.test(boardRoutes));
ok('client applyCanonicalProgressionFromServer', /applyCanonicalProgressionFromServer/.test(indexHtml));
ok('member skipLocalXp', /skipLocalXp:\s*true/.test(indexHtml));
ok(
  'auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);

section('applyPostCreatedXp mock idempotency');
(async function () {
  const progression = require('../server/user-progression-service');
  const persist = require('../server/achievement-persist-service');
  const events = {};
  let row = { level: 1, xp: 0 };
  const orig = persist.getAdminClient;
  persist.getAdminClient = function () {
    return {
      rpc: async function (name, args) {
        ok('rpc name', name === 'apply_user_progression_event');
        ok('amount from SSOT not client', args.p_amount === 25);
        ok('dedupe POST_CREATED:id', args.p_dedupe_key === 'POST_CREATED:post-abc');
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
        const prevLv = row.level;
        row.xp = prev + args.p_amount;
        row.level = xpCore.calculateLevelFromXp(row.xp);
        return {
          data: {
            status: 'APPLIED',
            previousLevel: prevLv,
            newLevel: row.level,
            levelChanged: row.level !== prevLv,
            previousXp: prev,
            newXp: row.xp,
            xpDelta: args.p_amount,
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
  const r1 = await progression.applyPostCreatedXp(uid, 'post-abc');
  ok('first apply +25 xp25 Lv1', r1.status === 'APPLIED' && r1.xp === 25 && r1.level === 1 && r1.expPercent === 63);
  const r2 = await progression.applyPostCreatedXp(uid, 'post-abc');
  ok('duplicate +0', r2.duplicate && r2.xp === 25 && r2.xpDelta === 0);
  persist.getAdminClient = orig;

  section('live schema (read-only · 테스트계정 미변경)');
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
  const ev = await sb.from('user_progression_events').select('id').limit(1);
  ok('events table readable', !ev.error, ev.error && ev.error.message);
  const sample = await sb.from('user_progression').select('user_id, level, xp').limit(1);
  const liveRow = sample.data && sample.data[0];
  ok(
    'live user_progression readable (특정 회원 xp 절대값 고정 없음)',
    liveRow && Number(liveRow.level) >= 1 && Number(liveRow.level) <= 10 && Number(liveRow.xp) >= 0,
    JSON.stringify(liveRow),
  );
  console.log(
    JSON.stringify({
      liveProgressionSample: {
        level: liveRow && Number(liveRow.level),
        xp: liveRow && Number(liveRow.xp),
        note: 'Chrome 활동으로 값이 변해도 FAIL하지 않음 · 새 글 XP는 isolated mock',
      },
    }),
  );
  finish();
})().catch(function (e) {
  ok('async', false, String(e && e.message ? e.message : e));
  finish();
});

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail, liveClient ? [liveClient] : []);
}
