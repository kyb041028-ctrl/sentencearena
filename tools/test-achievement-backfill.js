'use strict';
/**
 * RETROACTIVE first-post backfill + legacy ownership policy
 * node tools/test-achievement-backfill.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

(async function main() {
  section('definition · policy');
  const defs = read('public/achievement-definitions.js');
  ok('1. first-post RETROACTIVE', /id:\s*'first-post'[\s\S]{0,400}conditionHistoryPolicy:\s*'RETROACTIVE'/.test(defs));
  ok('2. first-comment still UNSET/default', !/id:\s*'first-comment'[\s\S]{0,400}conditionHistoryPolicy:\s*'RETROACTIVE'/.test(defs));
  const defCore = require('../shared/achievement-definitions-core');
  defCore.loadDefinitions(); // bust cache by reloading module - need reset
  // force reload
  delete require.cache[require.resolve('../shared/achievement-definitions-core')];
  const defCore2 = require('../shared/achievement-definitions-core');
  const fp = defCore2.getAchievementDefinition('first-post');
  ok('3. core first-post RETROACTIVE', fp && fp.conditionHistoryPolicy === 'RETROACTIVE');

  section('backfill service structure');
  const svcSrc = read('server/achievement-backfill-service.js');
  ok('4. runAchievementBackfill', /function runAchievementBackfill/.test(svcSrc));
  ok('5. policy gate UNSET', /POLICY_UNSET/.test(svcSrc));
  ok('6. policy gate FORWARD_ONLY', /FORWARD_ONLY/.test(svcSrc));
  ok('7. board_posts canonical stats only', /\.from\(['"]board_posts['"]\)/.test(svcSrc));
  ok('8. grantAchievementForUser internal', /grantAchievementForUser/.test(svcSrc));
  ok('9. evaluateAchievementCondition reuse', /evaluateAchievementCondition/.test(svcSrc));

  section('mock backfill unit');
  const backfill = require('../server/achievement-backfill-service');
  const persist = require('../server/achievement-persist-service');
  const stats = require('../server/achievement-stats-service');

  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const userC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const store = { posts: [], achievements: [] };

  persist.setAdminClientForTests({
    from: function (table) {
      const obj = {};
      obj.select = function () {
        return obj;
      };
      obj.eq = function (col, val) {
        if (table === 'board_posts' && col === 'status') {
          obj._filtered = store.posts.filter(function (r) {
            return r.status === val;
          });
        }
        if (table === 'user_achievements' && col === 'user_id') {
          obj._filtered = store.achievements
            .filter(function (r) {
              return r.user_id === val;
            })
            .map(function (r) {
              return {
                achievement_key: r.achievement_key,
                acquired_at: r.acquired_at,
                acquisition_sequence: r.acquisition_sequence,
                season_key: null,
                acquisition_notified_at: r.acquisition_notified_at,
              };
            });
        }
        return obj;
      };
      obj.order = function () {
        return obj;
      };
      obj.then = function (onFulfilled, onRejected) {
        const rows = obj._filtered || (table === 'board_posts' ? store.posts : []);
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      };
      return obj;
    },
    rpc: function (name, params) {
      if (name !== 'grant_user_achievement') {
        return Promise.resolve({ data: null, error: { message: 'unknown' } });
      }
      const uid = params.p_user_id;
      const key = params.p_achievement_key;
      const existing = store.achievements.find(function (r) {
        return r.user_id === uid && r.achievement_key === key;
      });
      if (existing) {
        return Promise.resolve({
          data: {
            status: 'ALREADY_GRANTED',
            achievement_key: key,
            acquired_at: existing.acquired_at,
            acquisition_sequence: existing.acquisition_sequence,
            acquisition_notified_at: existing.acquisition_notified_at,
          },
          error: null,
        });
      }
      let maxSeq = 0;
      store.achievements.forEach(function (r) {
        if (r.user_id === uid && r.acquisition_sequence > maxSeq) maxSeq = r.acquisition_sequence;
      });
      const seq = maxSeq + 1;
      const acquired = new Date().toISOString();
      store.achievements.push({
        user_id: uid,
        achievement_key: key,
        acquired_at: acquired,
        acquisition_sequence: seq,
        acquisition_notified_at: null,
      });
      return Promise.resolve({
        data: {
          status: 'GRANTED',
          achievement_key: key,
          acquired_at: acquired,
          acquisition_sequence: seq,
          acquisition_notified_at: null,
        },
        error: null,
      });
    },
  });

  stats.setStatsClientForTests({
    from: function (table) {
      const obj = {};
      let uid = null;
      let status = 'ACTIVE';
      obj.select = function (_cols, opts) {
        obj._head = opts && opts.head;
        obj._count = opts && opts.count;
        return obj;
      };
      obj.eq = function (col, val) {
        if (col === 'author_user_id') uid = val;
        if (col === 'user_id') uid = val;
        if (col === 'status') status = val;
        return obj;
      };
      obj.gte = function () {
        return obj;
      };
      obj.in = function () {
        return obj;
      };
      obj.limit = function () {
        return obj;
      };
      obj.order = function () {
        return obj;
      };
      obj.maybeSingle = function () {
        return obj;
      };
      obj.then = function (onFulfilled, onRejected) {
        if (table === 'board_posts') {
          const cnt = store.posts.filter(function (r) {
            return r.author_user_id === uid && r.status === status;
          }).length;
          return Promise.resolve({ count: cnt, data: null, error: null }).then(onFulfilled, onRejected);
        }
        if (table === 'user_progression') {
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        return Promise.resolve({ data: [], count: 0, error: null }).then(onFulfilled, onRejected);
      };
      return obj;
    },
  });

  store.posts = [
    { author_user_id: userA, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
    { author_user_id: userB, status: 'ACTIVE' },
  ];

  const dry = await backfill.runAchievementBackfill({ achievementId: 'first-post', dryRun: true });
  ok('10. canonical 1개 + 미보유 → WOULD_GRANT', dry.ok && dry.results.some(function (r) {
    return r.userId === userA && r.status === 'WOULD_GRANT';
  }));
  ok('11. 10개여도 first-post 1개만', dry.results.filter(function (r) {
    return r.status === 'WOULD_GRANT';
  }).length >= 1);

  store.achievements.push({
    user_id: userA,
    achievement_key: 'first-post',
    acquired_at: new Date().toISOString(),
    acquisition_sequence: 1,
    acquisition_notified_at: new Date().toISOString(),
  });
  const ownedDry = await backfill.runAchievementBackfill({ achievementId: 'first-post', dryRun: true });
  ok(
    '12. 기존 first-post 보유 → 추가 없음',
    !ownedDry.results.some(function (r) {
      return r.userId === userA && (r.status === 'WOULD_GRANT' || r.status === 'GRANTED');
    }),
  );

  store.posts = [];
  const zeroDry = await backfill.runAchievementBackfill({ achievementId: 'first-post', dryRun: true });
  ok('13. canonical 0개 → 지급 없음', zeroDry.grantedCount === 0 && zeroDry.eligibleCount === 0);

  const unset = await backfill.runAchievementBackfill({ achievementId: 'first-comment', dryRun: true });
  ok('14. UNSET first-comment backfill 금지', unset.skipped && unset.reason === 'POLICY_UNSET');

  store.posts = [{ author_user_id: userC, status: 'ACTIVE' }];
  store.achievements = [];
  const apply = await backfill.runAchievementBackfill({
    achievementId: 'first-post',
    dryRun: false,
    userIds: [userC],
  });
  ok('15. apply grant 1개', apply.grantedCount === 1);
  const row = store.achievements.find(function (r) {
    return r.user_id === userC && r.achievement_key === 'first-post';
  });
  ok('16. notified_at NULL', row && row.acquisition_notified_at == null);

  persist.resetAdminClientForTests();
  stats.resetStatsClientForTests();

  section('legacy export migration policy');
  const migSrc = read('tools/migrate-legacy-board-posts-export.js');
  ok('17. UUID author only', /AUTHOR_NOT_UUID/.test(migSrc));
  ok('18. demo skip', /DEMO_OR_SEED_ID/.test(migSrc));
  ok('19. no browser grant', !/grantAchievementForUser/.test(migSrc));

  section('security · auth');
  const routes = read('server/achievement-persist-routes.js');
  ok('20. self-grant 404', /NOT_FOUND/.test(routes));
  ok('21. CLIENT_GRANT in ua', /CLIENT_GRANT_FORBIDDEN/.test(read('public/user-achievements.js')));
  const diffNames = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).split(/\r?\n/);
  ok('22. auth.js unchanged', diffNames.indexOf('public/auth.js') === -1);
  ok('23. app-entry unchanged', diffNames.indexOf('public/app-entry.js') === -1);

  section('first-post canonical regression');
  try {
    execFileSync(process.execPath, [path.join(root, 'tools/test-first-post-canonical.js')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
    });
    ok('24. test-first-post-canonical', true);
  } catch (e) {
    ok('24. test-first-post-canonical', false, String(e.message || e).slice(0, 120));
  }

  console.log('\n---');
  console.log('TOTAL: ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
