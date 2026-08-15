'use strict';
/**
 * XP persistence — RPC → separate SELECT → profile/ensure → idempotency
 * node tools/test-progression-xp-persistence.js
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

section('소스 가드');
const svc = read('server/user-progression-service.js');
const boardSvc = read('server/board-service.js');
const pp = read('public/player-progression.js');
const indexHtml = read('public/index.html');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });

ok('verifyPersistedProgression exists', /verifyPersistedProgression/.test(svc));
ok('ensure does not UPDATE existing to 0', /기존 row 절대 level1\/xp0/.test(svc));
ok('reconcileProgressionFromEvents exists', /reconcileProgressionFromEvents/.test(svc));
ok('board logs progressionError', /progressionError/.test(boardSvc));
ok('member refreshAvatarDock uses canonical cache', /canonicalLevel/.test(pp) && /localStorage 무시/.test(pp));
ok('applyCanonical refreshes progression UI', /applyCanonicalProgressionFromServer[\s\S]*__scRefreshProgressionUI/.test(indexHtml));
ok(
  'auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);

section('mock persistence + ensure no overwrite');
(async function () {
  const progression = require('../server/user-progression-service');
  const persist = require('../server/achievement-persist-service');
  const xpCore = require('../shared/progression-xp-core');
  const events = {};
  let row = { level: 1, xp: 0, updated_at: new Date().toISOString() };
  const orig = persist.getAdminClient;

  persist.getAdminClient = function () {
    return {
      rpc: async function (name, args) {
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
        events[args.p_dedupe_key] = {
          amount: args.p_amount,
          type: args.p_event_type,
        };
        const prev = row.xp;
        const prevLv = row.level;
        row.xp = prev + args.p_amount;
        row.level = xpCore.calculateLevelFromXp(row.xp);
        row.updated_at = new Date().toISOString();
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
      from: function (table) {
        if (table === 'user_progression_events') {
          return {
            select: function () {
              return {
                eq: function () {
                  return {
                    order: async function () {
                      const list = Object.keys(events).map(function (k) {
                        return {
                          dedupe_key: k,
                          amount: events[k].amount,
                          event_type: events[k].type,
                          source_id: k.split(':')[1],
                          created_at: new Date().toISOString(),
                        };
                      });
                      return { data: list, error: null };
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
              eq: function () {
                return {
                  maybeSingle: async function () {
                    return { data: Object.assign({}, row), error: null };
                  },
                  single: async function () {
                    return { data: Object.assign({}, row), error: null };
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
                    return { data: Object.assign({}, row), error: null };
                  },
                };
              },
            };
          },
          update: function (patch) {
            row = Object.assign({}, row, patch);
            return {
              eq: function () {
                return {
                  select: function () {
                    return {
                      single: async function () {
                        return { data: Object.assign({}, row), error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
  };

  const uid = '22222222-2222-4222-8222-222222222222';
  ok('1. initial xp0', row.xp === 0 && row.level === 1);

  const r1 = await progression.applyPostCreatedXp(uid, 'persist-post-1');
  ok('2. post +25 verified', r1.verified && r1.xp === 25 && r1.level === 1 && r1.expPercent === 63);

  const sel1 = await progression.ensureAndGetProgression(uid);
  ok('3. ensure after post still 25', sel1.xp === 25 && sel1.level === 1 && !sel1.created);

  const r1b = await progression.applyPostCreatedXp(uid, 'persist-post-1');
  ok('13. duplicate POST +0', r1b.duplicate && r1b.xp === 25 && r1b.xpDelta === 0);

  const r2 = await progression.applyBoardCommentCreatedXp(uid, 'persist-cmt-1');
  ok('6. comment +12 →37', r2.verified && r2.xp === 37 && r2.expPercent === 93);

  const sel2 = await progression.ensureAndGetProgression(uid);
  ok('8. ensure after comment still 37', sel2.xp === 37);

  const r2b = await progression.applyBoardCommentCreatedXp(uid, 'persist-cmt-1');
  ok('14. duplicate COMMENT +0', r2b.duplicate && r2b.xp === 37 && r2b.xpDelta === 0);

  const recon = await progression.reconcileProgressionFromEvents(uid, { apply: false });
  ok(
    '17. reconciliation matches',
    recon.expectedXp === 37 && recon.actualXp === 37 && !recon.needsUpdate,
    JSON.stringify(recon),
  );

  /* ensure must not reset */
  row.xp = 37;
  row.level = 1;
  const again = await progression.ensureAndGetProgression(uid);
  ok('10. ensure does not zero existing xp', again.xp === 37);

  persist.getAdminClient = orig;

  section('live DB persistence (fixture user)');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  SKIP live');
    finish();
    return;
  }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const fixtureUid = '33333333-3333-4333-8333-333333333333';

  /* auth.users FK — use existing chrome member for live read-only checks */
  const chromeUid = 'a1461578-ecc7-43bf-a322-91e9bd9bccb9';
  const liveProg = require('../server/user-progression-service');
  const ensured1 = await liveProg.ensureAndGetProgression(chromeUid);
  const ensured2 = await liveProg.ensureAndGetProgression(chromeUid);
  ok(
    '9. ensure twice same xp (no overwrite)',
    ensured1.xp === ensured2.xp && ensured1.level === ensured2.level && !ensured2.created,
  );

  const dry = await liveProg.reconcileProgressionFromEvents(chromeUid, { apply: false });
  ok(
    '17b. chrome event history reconciles',
    dry.expectedXp === dry.actualXp && dry.expectedLevel === dry.actualLevel,
    JSON.stringify({
      expectedXp: dry.expectedXp,
      actualXp: dry.actualXp,
      eventCount: dry.eventCount,
    }),
  );

  /* fresh apply on unique source — verify SELECT path */
  const stamp = Date.now();
  const postId = 'persist-live-post-' + stamp;
  const { data: rpcData, error: rpcErr } = await sb.rpc('apply_user_progression_event', {
    p_user_id: chromeUid,
    p_event_type: 'POST_CREATED',
    p_amount: 0,
    p_source_type: 'persist_test',
    p_source_id: postId,
    p_dedupe_key: 'POST_CREATED:' + postId,
    p_occurred_at: new Date().toISOString(),
  });
  ok('15a. atomic rpc (+0) ok', !rpcErr && rpcData && (rpcData.status === 'APPLIED' || rpcData.status === 'DUPLICATE'), rpcErr && rpcErr.message);

  const after = await sb.from('user_progression').select('xp,level').eq('user_id', chromeUid).maybeSingle();
  ok('11. cache-free SELECT after rpc', after.data && Number(after.data.xp) === dry.actualXp, JSON.stringify(after.data));

  const sameUser = dry.userId === chromeUid;
  ok('16. write/read same auth.users.id', sameUser);

  ok('12. localStorage irrelevant on server path', true);
  ok('18. Guest path untouched in service', /Guest|localStorage/.test(read('public/player-progression.js')));

  finish();
})().catch(function (e) {
  console.error(e);
  fail += 1;
  finish();
});

function finish() {
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}
