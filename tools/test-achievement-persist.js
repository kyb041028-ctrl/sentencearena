'use strict';
/**
 * 실회원 업적 DB 영구 저장
 * node tools/test-achievement-persist.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

(async function main() {
  section('소스·라우트 구조');
  const mig = read('supabase/migration_user_achievements_persist.sql');
  const svc = read('server/achievement-persist-service.js');
  const routes = read('server/achievement-persist-routes.js');
  const serverJs = read('server.js');
  const ua = read('public/user-achievements.js');
  const authJs = read('public/auth.js');

  ok('1. additive migration 존재', /user_achievements/.test(mig) && /user_featured_achievements/.test(mig));
  const migCanon = read('supabase/migration_grant_user_achievement_canonical.sql');
  ok('1b. canonical grant migration', /pg_advisory_xact_lock/.test(migCanon) && /v_acquired := now\(\)/.test(migCanon));
  ok('2. grant_user_achievement RPC', /grant_user_achievement/.test(mig));
  ok('3. set_featured_achievements RPC', /set_featured_achievements/.test(mig));
  ok('4. service_role only grant', /GRANT EXECUTE ON FUNCTION public\.grant_user_achievement[\s\S]*service_role/.test(mig));
  ok('5. CREATE IF NOT EXISTS', /CREATE TABLE IF NOT EXISTS public\.user_achievements/.test(mig));
  ok('6. no TRUNCATE/DELETE bulk', !/\bTRUNCATE\b/i.test(mig) && !/DELETE FROM public\.(profiles|auth)/i.test(mig));
  ok('7. persist router mount before user-data', /createAchievementPersistRouter[\s\S]*userDataRoutes/.test(serverJs));
  ok('8. GET + featured routes · grant 공개 차단', /\/users\/me\/achievements/.test(routes) && /featured-achievements/.test(routes) && /NOT_FOUND/.test(routes) && /Browser self-grant 금지/.test(routes));
  ok('9. identity from JWT user.id', /auth\.user\.id/.test(routes) && !/x-sc-user-id/.test(routes));
  ok(
    '10. client hydrate · member self-grant 금지',
    /hydrateCurrentUserAchievementsFromServer/.test(ua) &&
      /CLIENT_GRANT_FORBIDDEN/.test(ua) &&
      !/persistMemberGrant/.test(ua) &&
      !/onValidPostCreatedAchievement/.test(ua),
  );
  ok('10b. index.html first-post hook 없음', !/onValidPostCreatedAchievement/.test(read('public/index.html')));
  ok('10c. first-post definition 유지', /id:\s*'first-post'/.test(read('public/achievement-definitions.js')));
  const defCore = require('../shared/achievement-definitions-core');
  ok('10d. definitions 11개', defCore.listAchievementKeys().length === 11);
  ok('11. member empty seed 유지', /createEmptyUserAchievementState/.test(ua) && /memberAchievementState = createEmptyUserAchievementState/.test(ua));
  ok('12. guest mock 유지', /guestAchievementState = createDefaultUserAchievementMock/.test(ua));
  ok('13. auth.js 미변경(이번 작업)', true); // git check below
  ok('13b. service ignores client acquiredAt', /Signature placeholders only/.test(svc) || /client values ignored/.test(svc) || /p_acquisition_sequence: 0/.test(svc));
  ok('13c. server grant service 유지', /function grantAchievementForUser/.test(svc));  section('auth 파일 보호');
  const { execFileSync } = require('child_process');
  const diffNames = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  const forbidden = [
    'public/auth.js',
    'public/auth-v2/auth-client.js',
    'public/app-entry.js',
  ].filter(function (f) {
    return diffNames.split(/\r?\n/).indexOf(f) !== -1;
  });
  ok('14. auth/app-entry 미수정', forbidden.length === 0, forbidden.join(', '));

  section('서비스 유닛 (mock admin)');
  const persist = require('../server/achievement-persist-service');
  const store = {
    achievements: [],
    featured: [],
  };
  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';

  persist.setAdminClientForTests({
    from: function (table) {
      let filtered = null;
      const obj = {};
      obj.select = function () {
        return obj;
      };
      obj.eq = function (col, val) {
        if (table === 'user_achievements') {
          filtered = store.achievements.filter(function (r) {
            return r.user_id === val;
          });
        } else {
          filtered = store.featured.filter(function (r) {
            return r.user_id === val;
          });
        }
        return obj;
      };
      obj.order = function () {
        return obj;
      };
      obj.limit = function (n) {
        const rows = (filtered || []).slice().sort(function (a, b) {
          return (b.acquisition_sequence || 0) - (a.acquisition_sequence || 0);
        });
        return Promise.resolve({ data: rows.slice(0, n), error: null });
      };
      obj.then = function (onFulfilled, onRejected) {
        let rows = filtered || [];
        if (table === 'user_achievements') {
          rows = rows.slice().sort(function (a, b) {
            return a.acquisition_sequence - b.acquisition_sequence;
          });
        } else {
          rows = rows.slice().sort(function (a, b) {
            return a.slot - b.slot;
          });
        }
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
      const season = params.p_season_key == null ? null : params.p_season_key;
      const existing = store.achievements.find(function (r) {
        return (
          r.user_id === uid &&
          r.achievement_key === key &&
          (season == null ? r.season_key == null : r.season_key === season)
        );
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
      let maxSeq = 0;
      store.achievements.forEach(function (r) {
        if (r.user_id === uid) {
          const s = Number(r.acquisition_sequence) || 0;
          if (s > maxSeq) maxSeq = s;
        }
      });
      const seq = maxSeq + 1;
      const acquired = new Date().toISOString();
      store.achievements.push({
        user_id: uid,
        achievement_key: key,
        acquired_at: acquired,
        acquisition_sequence: seq,
        season_key: season,
      });
      return Promise.resolve({
        data: {
          status: 'GRANTED',
          achievement_key: key,
          acquired_at: acquired,
          acquisition_sequence: seq,
          season_key: season,
        },
        error: null,
      });
    },
  });

  const emptyA = await persist.getMyAchievementBundle(userA);
  ok('15. 신규회원 bundle 0개', emptyA.currentAchievements.length === 0 && emptyA.featuredAchievementIds.length === 0);

  const clientFakeAt = '1999-01-01T00:00:00.000Z';
  const g1 = await persist.grantAchievementForUser(userA, {
    achievementId: 'first-post',
    acquiredAt: clientFakeAt,
    acquisitionSequence: 99,
  });
  ok('16. grant 성공', g1.granted === true && g1.record.achievementId === 'first-post');
  ok(
    '17. acquired_at DB canonical (client 값 무시)',
    !!g1.record.acquiredAt && g1.record.acquiredAt !== clientFakeAt && !g1.record.acquiredAt.startsWith('1999'),
  );
  ok('18. acquisitionSequence=1', g1.record.acquisitionSequence === 1);

  const g2 = await persist.grantAchievementForUser(userA, {
    achievementId: 'first-comment',
    acquiredAt: clientFakeAt,
    acquisitionSequence: 99,
  });
  const g3 = await persist.grantAchievementForUser(userA, {
    achievementId: 'beta-citizen',
    acquiredAt: clientFakeAt,
    acquisitionSequence: 99,
  });
  ok(
    '18b. sequence 1→2→3',
    g1.record.acquisitionSequence === 1 &&
      g2.record.acquisitionSequence === 2 &&
      g3.record.acquisitionSequence === 3,
  );

  const gDup = await persist.grantAchievementForUser(userA, {
    achievementId: 'first-post',
    acquiredAt: '2099-01-01T00:00:00.000Z',
    acquisitionSequence: 999,
  });
  ok('19. 중복 grant 차단', gDup.granted === false && gDup.reason === 'ALREADY_ACQUIRED');
  ok(
    '19b. 중복 시 timestamp/sequence 불변',
    gDup.record &&
      gDup.record.acquiredAt === g1.record.acquiredAt &&
      gDup.record.acquisitionSequence === 1,
  );

  const bundleA = await persist.getMyAchievementBundle(userA);
  ok('20. A 로드 복원', bundleA.currentAchievements.length === 3);

  const bundleB = await persist.getMyAchievementBundle(userB);
  ok('21. B는 A 업적 없음', bundleB.currentAchievements.length === 0);

  const gB = await persist.grantAchievementForUser(userB, {
    achievementId: 'first-comment',
  });
  ok('21b. B sequence 독립(=1)', gB.record.acquisitionSequence === 1);
  const bundleA2 = await persist.getMyAchievementBundle(userA);
  const bundleB2 = await persist.getMyAchievementBundle(userB);
  ok(
    '22. A/B 분리',
    bundleA2.currentAchievements[0].achievementId === 'first-post' &&
      bundleB2.currentAchievements[0].achievementId === 'first-comment',
  );

  let featuredRpcArgs = null;
  const userClient = {
    rpc: function (name, params) {
      featuredRpcArgs = { name: name, params: params };
      if (params.p_slot1_key && params.p_slot1_key === 'not-owned') {
        return Promise.resolve({
          data: { status: 'ERROR', code: 'ACHIEVEMENT_NOT_OWNED', key: 'not-owned' },
          error: null,
        });
      }
      store.featured = store.featured.filter(function (r) {
        return r.user_id !== userA;
      });
      [params.p_slot1_key, params.p_slot2_key, params.p_slot3_key].forEach(function (k, i) {
        if (k) {
          store.featured.push({ user_id: userA, slot: i + 1, achievement_key: k });
        }
      });
      return Promise.resolve({ data: { status: 'SET' }, error: null });
    },
  };

  let threw = false;
  try {
    await persist.setFeaturedAchievementsForUser(userClient, userA, ['not-owned']);
  } catch (e) {
    threw = e.code === 'ACHIEVEMENT_NOT_OWNED';
  }
  ok('23. 미획득 대표 선택 거부', threw);

  const feat = await persist.setFeaturedAchievementsForUser(userClient, userA, ['first-post']);
  ok('24. 대표 업적 저장', feat.status === 'SET' && feat.featuredAchievementIds[0] === 'first-post');
  ok('25. featured RPC auth.uid 경로', featuredRpcArgs && featuredRpcArgs.name === 'set_featured_achievements');

  persist.resetAdminClientForTests();

  section('클라이언트 Guest vs Member');
  const defsCode = read('public/achievement-definitions.js');
  const achCode = read('public/user-achievements.js');
  const sandbox = {
    console: console,
    setTimeout: function () {
      return 0;
    },
    clearTimeout: function () {},
    Date: Date,
    Math: Math,
    JSON: JSON,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    RegExp: RegExp,
    parseInt: parseInt,
    isFinite: isFinite,
    Infinity: Infinity,
    NaN: NaN,
    fetch: function (url, opts) {
      var u = String(url || '');
      if (u.indexOf('/achievements/grant') !== -1) {
        var body = opts && opts.body ? JSON.parse(opts.body) : {};
        var serverAt = '2026-08-13T12:34:56.000Z';
        var seq = (sandbox.__scMockGrantSeq = (sandbox.__scMockGrantSeq || 0) + 1);
        if (sandbox.__scMockGrantFail) {
          return Promise.resolve({
            status: 500,
            json: function () {
              return Promise.resolve({ ok: false, error: 'GRANT_PERSIST_FAILED' });
            },
          });
        }
        return Promise.resolve({
          status: 200,
          json: function () {
            return Promise.resolve({
              ok: true,
              granted: true,
              reason: 'GRANTED',
              record: {
                achievementId: body.achievementId,
                acquiredAt: serverAt,
                acquisitionSequence: seq,
                seasonId: body.seasonId || null,
              },
              data: {
                currentAchievements: [
                  {
                    achievementId: body.achievementId,
                    acquiredAt: serverAt,
                    acquisitionSequence: seq,
                    seasonId: body.seasonId || null,
                  },
                ],
                featuredAchievementIds: [],
                seasonHistory: [],
              },
            });
          },
        });
      }
      return Promise.resolve({
        status: 200,
        json: function () {
          return Promise.resolve({
            ok: true,
            data: sandbox.__scMockHydrateBundle || {
              currentAchievements: [],
              featuredAchievementIds: [],
              seasonHistory: [],
            },
          });
        },
      });
    },
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.sessionStorage = {
    getItem: function () {
      return null;
    },
    setItem: function () {},
    removeItem: function () {},
  };
  sandbox.document = {
    readyState: 'complete',
    getElementById: function () {
      return null;
    },
    createElement: function () {
      return {
        style: {},
        classList: {
          add: function () {},
          remove: function () {},
          contains: function () {
            return false;
          },
        },
        setAttribute: function () {},
        appendChild: function () {},
        querySelector: function () {
          return null;
        },
        addEventListener: function () {},
        dataset: {},
      };
    },
    body: {
      appendChild: function () {},
      classList: { add: function () {}, remove: function () {} },
    },
    addEventListener: function () {},
  };
  vm.runInNewContext(defsCode + '\n' + achCode, sandbox);

  sandbox.__scAuthUserId = '';
  sandbox.sessionStorage.getItem = function (k) {
    return k === 'sc_sb_guest_ok' ? '1' : null;
  };
  const guestData = sandbox.getCurrentUserAchievementData();
  ok('26. Guest Mock 유지', guestData.currentAchievements.length >= 3);

  sandbox.sessionStorage.getItem = function () {
    return null;
  };
  sandbox.__scAuthUserId = userA;
  const memberData = sandbox.getCurrentUserAchievementData();
  ok(
    '27. 실회원 시작 0개 (Mock 미주입)',
    memberData.currentAchievements.length === 0 && memberData.featuredAchievementIds.length === 0,
  );

  const memberDenied = sandbox.grantCurrentUserAchievement('first-post', {
    source: 'DEBUG',
    acquiredAt: '1999-01-01T00:00:00.000Z',
  });
  ok(
    '28. 실회원 browser self-grant 금지',
    memberDenied.granted === false &&
      memberDenied.reason === 'CLIENT_GRANT_FORBIDDEN' &&
      sandbox.getCurrentUserAchievements().length === 0,
  );
  ok('28b. 공개 grant route 404', /router\.post\('\/users\/me\/achievements\/grant'[\s\S]{0,120}NOT_FOUND/.test(routes));

  section('DB live smoke (service role)');
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    ok('29. live DB skip (no service role)', true);
    ok('30. concurrent skip', true);
  } else {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const t1 = await sb.from('user_achievements').select('user_id').limit(1);
    const t2 = await sb.from('user_featured_achievements').select('user_id').limit(1);
    ok(
      '29. live tables readable',
      !t1.error && !t2.error,
      (t1.error && t1.error.message) || (t2.error && t2.error.message) || '',
    );

    let liveUserId = null;
    try {
      const email = 'ach-persist-test-' + Date.now() + '@example.com';
      const created = await sb.auth.admin.createUser({
        email: email,
        email_confirm: true,
        user_metadata: { test: 'achievement-persist' },
      });
      liveUserId = created.data && created.data.user && created.data.user.id;
      if (!liveUserId) throw created.error || new Error('createUser failed');

      persist.resetAdminClientForTests();
      const liveSvc = require('../server/achievement-persist-service');
      const [c1, c2] = await Promise.all([
        liveSvc.grantAchievementForUser(liveUserId, { achievementId: 'first-post' }),
        liveSvc.grantAchievementForUser(liveUserId, { achievementId: 'first-comment' }),
      ]);
      const seqs = [c1.record.acquisitionSequence, c2.record.acquisitionSequence].sort();
      ok(
        '30. 동시 grant sequence 중복 없음',
        c1.granted && c2.granted && seqs[0] === 1 && seqs[1] === 2,
        JSON.stringify(seqs),
      );

      const again = await liveSvc.grantAchievementForUser(liveUserId, {
        achievementId: 'first-post',
        acquiredAt: '2099-01-01T00:00:00.000Z',
      });
      ok(
        '31. live 중복 불변',
        !again.granted &&
          again.record.acquisitionSequence === c1.record.acquisitionSequence &&
          again.record.acquiredAt === c1.record.acquiredAt,
      );
      ok(
        '32. live acquired_at not client epoch placeholder',
        !!c1.record.acquiredAt && !String(c1.record.acquiredAt).startsWith('1970'),
      );
    } catch (e) {
      ok('30. concurrent live', false, String(e.message || e).slice(0, 200));
      ok('31. live 중복 불변', false);
      ok('32. live acquired_at', false);
    } finally {
      if (liveUserId) {
        try {
          await sb.auth.admin.deleteUser(liveUserId);
        } catch (_) {}
      }
    }
  }

  section('결과');
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail > 0) process.exit(1);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
