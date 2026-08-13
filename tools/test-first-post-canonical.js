'use strict';

/**
 * first-post canonical: UI → board createPost → evaluator → grant
 * node tools/test-first-post-canonical.js
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

(async function main() {
  section('왜 UI가 evaluator를 못 탔는지 / 최소 연결');
  const indexHtml = read('public/index.html');
  const boardClient = read('public/board-api-client.js');
  const boardSvc = read('server/board-service.js');
  const routes = read('server/board-routes.js');
  const persistRoutes = read('server/achievement-persist-routes.js');
  const ua = read('public/user-achievements.js');

  ok(
    '1. 실회원 submit이 createMemberCanonicalBoardPost 호출',
    /createMemberCanonicalBoardPost/.test(indexHtml) &&
      /isAuthenticatedBoardMember/.test(indexHtml),
  );
  ok(
    '2. 실회원은 API 성공 전 localStorage unshift 안 함',
    /completeSuccessfulBoardPost\(post\)/.test(indexHtml) &&
      /createMemberCanonicalBoardPost\([\s\S]*completeSuccessfulBoardPost\(post\)/.test(indexHtml),
  );
  ok('3. Guest는 기존 local 완료 경로 유지', /completeSuccessfulBoardPost\(post\);/.test(indexHtml));
  ok(
    '4. 클라이언트 key grant 없음',
    !/grantCurrentUserAchievement\(\s*['"]first-post['"]/.test(indexHtml),
  );
  ok('5. createMemberCanonicalBoardPost helper', /createMemberCanonicalBoardPost/.test(boardClient));
  ok('6. createPost await evaluator', /await evaluator\.evaluateAfterPostCreated/.test(boardSvc));
  ok('7. fireAndForget post hook 제거', !/fireAndForget\(evaluator\.evaluateAfterPostCreated/.test(boardSvc));
  ok('8. 201 newlyGrantedAchievements', /newlyGrantedAchievements/.test(routes));
  ok('9. POST grant 404 유지', /NOT_FOUND/.test(persistRoutes));
  ok('10. CLIENT_GRANT_FORBIDDEN 유지', /CLIENT_GRANT_FORBIDDEN/.test(ua));
  ok('11. applyCanonicalGrantedAchievements', /applyCanonicalGrantedAchievements/.test(ua));
  ok(
    '12. first-post 조건 유지',
    /id:\s*'first-post'[\s\S]{0,400}VALID_POST_COUNT[\s\S]{0,80}conditionValue:\s*1/.test(
      read('public/achievement-definitions.js'),
    ),
  );

  section('evaluator first-post only');
  const evalCore = require('../shared/achievement-evaluation-core');
  const defCore = require('../shared/achievement-definitions-core');
  const first = evalCore.evaluateAchievementCondition(defCore.getAchievementDefinition('first-post'), {
    achievementStats: { validPostCount: 1 },
    ownedAchievements: [],
  });
  ok('13. VALID_POST_COUNT>=1 PASS', first.eligible === true);
  const owned = evalCore.evaluateAchievementCondition(defCore.getAchievementDefinition('first-post'), {
    achievementStats: { validPostCount: 5 },
    ownedAchievements: [{ achievementKey: 'first-post' }],
  });
  ok('14. already owned not eligible', owned.reason === 'ALREADY_OWNED');

  const evalSvc = require('../server/achievement-evaluator-service');
  ok(
    '15. post created skips derived level',
    /includeLevelReached:\s*false/.test(read('server/achievement-evaluator-service.js')),
  );
  ok('16. evaluateAfterPostCreated exists', typeof evalSvc.evaluateAfterPostCreated === 'function');

  section('board service memory + mock grant');
  const { createBoardMemoryRepository } = require('../server/board-memory-repository');
  const { createBoardService } = require('../server/board-service');
  const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
  const persist = require('../server/achievement-persist-service');
  const stats = require('../server/achievement-stats-service');

  const author = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const store = { achievements: [], featured: [] };
  persist.setAdminClientForTests({
    from: function (table) {
      let filtered = null;
      const obj = {};
      obj.select = function () { return obj; };
      obj.eq = function (col, val) {
        if (table === 'user_achievements') {
          filtered = store.achievements.filter(function (r) { return r.user_id === val; });
        } else {
          filtered = store.featured.filter(function (r) { return r.user_id === val; });
        }
        return obj;
      };
      obj.order = function () { return obj; };
      obj.limit = function (n) {
        const rows = (filtered || []).slice();
        return Promise.resolve({ data: rows.slice(0, n), error: null });
      };
      obj.then = function (onFulfilled, onRejected) {
        const rows = (filtered || []).slice().sort(function (a, b) {
          return (a.acquisition_sequence || 0) - (b.acquisition_sequence || 0);
        });
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      };
      return obj;
    },
    rpc: function (name, params) {
      if (name !== 'grant_user_achievement') {
        return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
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
            achievement_key: existing.achievement_key,
            acquired_at: existing.acquired_at,
            acquisition_sequence: existing.acquisition_sequence,
            season_key: existing.season_key,
          },
          error: null,
        });
      }
      const seq = store.achievements.filter(function (r) { return r.user_id === uid; }).length + 1;
      const acquired = new Date().toISOString();
      store.achievements.push({
        user_id: uid,
        achievement_key: key,
        acquired_at: acquired,
        acquisition_sequence: seq,
        season_key: params.p_season_key,
      });
      return Promise.resolve({
        data: {
          status: 'GRANTED',
          achievement_key: key,
          acquired_at: acquired,
          acquisition_sequence: seq,
          season_key: params.p_season_key,
        },
        error: null,
      });
    },
  });
  stats.setStatsClientForTests({
    from: function (table) {
      const obj = {};
      obj.select = function () { return obj; };
      obj.eq = function () { return obj; };
      obj.in = function () { return obj; };
      obj.gte = function () { return obj; };
      obj.maybeSingle = function () {
        return Promise.resolve({ data: null, error: null });
      };
      obj.then = function (onFulfilled, onRejected) {
        if (table === 'board_posts') {
          return Promise.resolve({ data: [{ id: 'p1' }], error: null, count: 1 }).then(onFulfilled, onRejected);
        }
        return Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled, onRejected);
      };
      return obj;
    },
  });

  const service = createBoardService({
    repository: createBoardMemoryRepository(),
    userContext: createMockUserContextAdapter({ defaultTerritory: 'CENTRAL' }),
    operational: true,
  });
  const created = await service.createPost({ userId: author }, { title: 'hello', content: 'first body' });
  ok('17. canonical createPost 성공', !!(created.post && created.post.id));
  const grantedKeys = (created.newlyGrantedAchievements || []).map(function (r) {
    return r.achievementId;
  });
  ok(
    '18. first-post grant in response',
    grantedKeys.indexOf('first-post') !== -1,
    JSON.stringify(grantedKeys),
  );
  ok(
    '19. 다른 업적 미지급',
    grantedKeys.every(function (k) { return k === 'first-post'; }),
    JSON.stringify(grantedKeys),
  );

  const again = await service.createPost({ userId: author }, { title: 'hello2', content: 'second body' });
  const againKeys = (again.newlyGrantedAchievements || []).map(function (r) {
    return r.achievementId;
  });
  ok('20. 중복 first-post 재지급 없음', againKeys.indexOf('first-post') === -1, JSON.stringify(againKeys));

  persist.resetAdminClientForTests();
  stats.resetStatsClientForTests();

  section('회귀 auth/app-entry');
  const diffNames = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).split(/\r?\n/);
  ok('21. auth.js unchanged', diffNames.indexOf('public/auth.js') === -1);
  ok('22. app-entry unchanged', diffNames.indexOf('public/app-entry.js') === -1);
  ok('23. achievement definitions unchanged keys', defCore.listAchievementKeys().length === 11);

  console.log('\n---');
  console.log('TOTAL: ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
