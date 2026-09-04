'use strict';
/**
 * persistent 업적 획득 알람 (acquisition_notified_at)
 * node tools/test-achievement-notified.js
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

function loadMemberSandbox() {
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
        classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
        setAttribute: function () {},
        appendChild: function () {},
        querySelector: function () {
          return null;
        },
        addEventListener: function () {},
        dataset: {},
      };
    },
    body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } },
    addEventListener: function () {},
  };
  sandbox.__alerts = [];
  sandbox.__notifiedPosts = [];
  sandbox.__store = {
    currentAchievements: [],
    featuredAchievementIds: [],
  };
  sandbox.enqueueAchievementAcquiredAlert = function (def, rec, opts) {
    sandbox.__alerts.push({
      achievementId: rec && rec.achievementId,
      sequence: rec && rec.acquisitionSequence,
      onShown: opts && opts.onShown,
    });
    return true;
  };
  sandbox.fetch = function (url, opts) {
    var u = String(url || '');
    var method = (opts && opts.method) || 'GET';
    if (u.indexOf('/achievements/grant') !== -1) {
      return Promise.resolve({
        status: 404,
        json: function () {
          return Promise.resolve({ ok: false, error: 'NOT_FOUND' });
        },
      });
    }
    if (u.indexOf('/achievements/notified') !== -1) {
      var body = opts && opts.body ? JSON.parse(opts.body) : {};
      sandbox.__notifiedPosts.push(body);
      var ts = '2026-08-13T12:00:00.000Z';
      sandbox.__store.currentAchievements.forEach(function (r) {
        if (
          r.achievementId === body.achievementId &&
          Number(r.acquisitionSequence) === Number(body.acquisitionSequence)
        ) {
          r.acquisitionNotifiedAt = ts;
        }
      });
      return Promise.resolve({
        status: 200,
        json: function () {
          return Promise.resolve({
            ok: true,
            status: 'NOTIFIED',
            achievementId: body.achievementId,
            acquisitionSequence: body.acquisitionSequence,
            acquisitionNotifiedAt: ts,
          });
        },
      });
    }
    return Promise.resolve({
      status: 200,
      json: function () {
        return Promise.resolve({
          ok: true,
          data: {
            currentAchievements: sandbox.__store.currentAchievements.slice(),
            featuredAchievementIds: sandbox.__store.featuredAchievementIds.slice(),
            seasonHistory: [],
          },
        });
      },
    });
  };
  vm.runInNewContext(defsCode + '\n' + achCode, sandbox);
  sandbox.enqueueAchievementAcquiredAlert = function (def, rec, opts) {
    sandbox.__alerts.push({
      achievementId: rec && rec.achievementId,
      sequence: rec && rec.acquisitionSequence,
      onShown: opts && opts.onShown,
    });
    return true;
  };
  return sandbox;
}

(async function main() {
  section('스키마 · 정책 필드');
  const defs = read('public/achievement-definitions.js');
  const mig = read('supabase/migration_achievement_notified_state.sql');
  const alertSrc = read('public/achievement-acquired-alert.js');
  const ua = read('public/user-achievements.js');
  const routes = read('server/achievement-persist-routes.js');
  ok('1. conditionHistoryPolicy enum', /ACHIEVEMENT_CONDITION_HISTORY_POLICIES/.test(defs) && /UNSET/.test(defs) && /RETROACTIVE/.test(defs) && /FORWARD_ONLY/.test(defs));
  ok('2. 11개 정책 값 미확정(UNSET default)', /normalizeConditionHistoryPolicy/.test(defs));
  ok('3. acquisition_notified_at column', /ADD COLUMN acquisition_notified_at/.test(mig));
  ok('4. 기존 row backfill 1회', /IF NOT EXISTS/.test(mig) && /SET acquisition_notified_at = COALESCE\(acquired_at/.test(mig));
  ok('5. 신규 grant NULL notified', /'acquisition_notified_at', NULL/.test(mig));
  ok('6. mark RPC auth.uid', /mark_user_achievement_notified/.test(mig) && /auth\.uid\(\)/.test(mig));
  ok('7. DROP/TRUNCATE 없음', !/\bDROP TABLE\b/i.test(mig.replace(/--[^\n]*/g, '')) && !/\bTRUNCATE\b/i.test(mig.replace(/--[^\n]*/g, '')));
  ok('8. onShown after visible', /item\.onShown/.test(alertSrc) && /animateIn\(card/.test(alertSrc));
  ok('9. queue 시 notified 처리 안 함', !/markAchievementAcquisitionNotified\(rec\)/.test(alertSrc));
  ok('10. client mark uses sequence', /acquisitionSequence/.test(ua) && /\/achievements\/notified/.test(ua));
  ok('11. grant 404 유지', /router\.post\('\/users\/me\/achievements\/grant'[\s\S]{0,160}NOT_FOUND/.test(routes));
  ok('12. notified endpoint', /\/users\/me\/achievements\/notified/.test(routes));

  const defCore = require('../shared/achievement-definitions-core');
  const first = defCore.getAchievementDefinition('first-post');
  ok('13. first-post conditionHistoryPolicy RETROACTIVE', first && first.conditionHistoryPolicy === 'RETROACTIVE');
  ok('14. definitions 11개 유지', defCore.listAchievementKeys().length === 11);

  section('17-20 기존/신규 hydrate');
  const legacy = loadMemberSandbox();
  legacy.__scAuthUserId = '11111111-1111-1111-1111-111111111111';
  legacy.__store.currentAchievements = [
    {
      achievementId: 'first-post',
      acquiredAt: '2026-08-01T00:00:00.000Z',
      acquisitionSequence: 1,
      seasonId: null,
      acquisitionNotifiedAt: '2026-08-01T00:00:01.000Z',
    },
  ];
  await legacy.hydrateCurrentUserAchievementsFromServer(true);
  ok('17. 기존 보유 업적 로그인 알람 없음', legacy.__alerts.length === 0);

  const live = loadMemberSandbox();
  live.__scAuthUserId = '11111111-1111-1111-1111-111111111111';
  const shown = live.applyCanonicalGrantedAchievements([
    {
      record: {
        achievementId: 'first-post',
        acquiredAt: '2026-08-13T11:00:00.000Z',
        acquisitionSequence: 1,
        seasonId: null,
        acquisitionNotifiedAt: null,
      },
    },
  ]);
  ok('18. 신규 실시간 획득 알람 1회', shown.shown === 1 && live.__alerts.length === 1 && live.__alerts[0].achievementId === 'first-post');
  ok('18b. queue만으로 notified POST 없음', live.__notifiedPosts.length === 0);
  await live.__alerts[0].onShown();
  ok('19. 표시 성공 → notified 저장', live.__notifiedPosts.length === 1 && live.__notifiedPosts[0].achievementId === 'first-post' && live.__notifiedPosts[0].acquisitionSequence === 1);
  ok('19b. acquired_at 미전송', live.__notifiedPosts[0].acquiredAt == null);

  live.__alerts = [];
  live.__store.currentAchievements = [
    {
      achievementId: 'first-post',
      acquiredAt: '2026-08-13T11:00:00.000Z',
      acquisitionSequence: 1,
      seasonId: null,
      acquisitionNotifiedAt: '2026-08-13T12:00:00.000Z',
    },
  ];
  live.resetMemberAlertBaseline();
  await live.hydrateCurrentUserAchievementsFromServer(true);
  ok('20. 새로고침 재알람 없음', live.__alerts.length === 0);

  section('21-25 오프라인/소급 FIFO');
  const offline = loadMemberSandbox();
  offline.__scAuthUserId = '11111111-1111-1111-1111-111111111111';
  offline.__store.currentAchievements = [
    {
      achievementId: 'first-comment',
      acquiredAt: '2026-08-13T11:00:00.000Z',
      acquisitionSequence: 2,
      seasonId: null,
      acquisitionNotifiedAt: null,
    },
  ];
  await offline.hydrateCurrentUserAchievementsFromServer(true);
  ok('21. 로그아웃 중 grant → 다음 로그인 알람 1회', offline.__alerts.length === 1 && offline.__alerts[0].achievementId === 'first-comment');

  const retro = loadMemberSandbox();
  retro.__scAuthUserId = '11111111-1111-1111-1111-111111111111';
  retro.__store.currentAchievements = [
    {
      achievementId: 'record-builder',
      acquiredAt: '2026-08-13T11:00:00.000Z',
      acquisitionSequence: 4,
      seasonId: null,
      acquisitionNotifiedAt: null,
    },
  ];
  await retro.hydrateCurrentUserAchievementsFromServer(true);
  ok('22. 소급 notified NULL → 알람 1회', retro.__alerts.length === 1 && retro.__alerts[0].achievementId === 'record-builder');
  await retro.__alerts[0].onShown();
  retro.__alerts = [];
  await retro.hydrateCurrentUserAchievementsFromServer(true);
  ok('23. 동일 업적 다음 로그인 알람 없음', retro.__alerts.length === 0);

  const unseen = loadMemberSandbox();
  unseen.__scAuthUserId = '11111111-1111-1111-1111-111111111111';
  unseen.__store.currentAchievements = [
    {
      achievementId: 'first-post',
      acquiredAt: '2026-08-13T11:00:00.000Z',
      acquisitionSequence: 1,
      seasonId: null,
      acquisitionNotifiedAt: null,
    },
  ];
  await unseen.hydrateCurrentUserAchievementsFromServer(true);
  ok('24. 미표시 종료 후 재로그인 가능', unseen.__alerts.length === 1 && unseen.__notifiedPosts.length === 0);

  const fifo = loadMemberSandbox();
  fifo.__scAuthUserId = '11111111-1111-1111-1111-111111111111';
  fifo.__store.currentAchievements = [
    {
      achievementId: 'first-comment',
      acquiredAt: '2026-08-13T11:02:00.000Z',
      acquisitionSequence: 3,
      seasonId: null,
      acquisitionNotifiedAt: null,
    },
    {
      achievementId: 'first-post',
      acquiredAt: '2026-08-13T11:00:00.000Z',
      acquisitionSequence: 1,
      seasonId: null,
      acquisitionNotifiedAt: null,
    },
    {
      achievementId: 'first-empathy-received',
      acquiredAt: '2026-08-13T11:01:00.000Z',
      acquisitionSequence: 2,
      seasonId: null,
      acquisitionNotifiedAt: null,
    },
  ];
  await fifo.hydrateCurrentUserAchievementsFromServer(true);
  ok(
    '25. 3개 acquisition_sequence FIFO',
    fifo.__alerts.map(function (a) { return a.achievementId; }).join(',') ===
      'first-post,first-empathy-received,first-comment',
  );

  section('26 Guest');
  const guest = loadMemberSandbox();
  guest.__scAuthUserId = '';
  guest.sessionStorage.getItem = function (k) {
    return k === 'sc_sb_guest_ok' ? '1' : null;
  };
  const guestData = guest.getCurrentUserAchievementData();
  ok('26. Guest 업적 없음 · persistence/notified 미사용', guestData.currentAchievements.length === 0 && guest.__notifiedPosts.length === 0 && guest.__alerts.length === 0);

  section('보안 27-33');
  ok('27. browser self-grant 404', /NOT_FOUND/.test(routes));
  ok('28. CLIENT_GRANT_FORBIDDEN', /CLIENT_GRANT_FORBIDDEN/.test(ua));
  ok('29. mark RPC 본인만', /user_id = v_user_id/.test(mig) && /ACHIEVEMENT_NOT_OWNED/.test(mig));
  ok('30. key만 notified 불가', /ACQUISITION_SEQUENCE_INVALID/.test(mig) && /ACQUISITION_SEQUENCE_INVALID/.test(read('server/achievement-persist-service.js')));
  ok('31. notified requireAuthenticatedUser', /requireAuthenticatedUser/.test(routes) && /achievements\/notified/.test(routes));
  ok('32. acquired_at 클라이언트 변경 불가', /Does not accept or mutate acquired_at/.test(read('server/achievement-persist-service.js')));
  ok('33. sequence 클라이언트 변경 불가', /p_acquisition_sequence are intentionally ignored/.test(mig) || /client untrusted/.test(mig));

  const persist = require('../server/achievement-persist-service');
  let keyOnly = false;
  try {
    await persist.markAchievementNotifiedForUser({ rpc: function () {} }, 'u', { achievementId: 'first-post' });
  } catch (e) {
    keyOnly = e.code === 'ACQUISITION_SEQUENCE_INVALID';
  }
  ok('30b. service key-only 거부', keyOnly);

  section('auth 보호');
  const diffNames = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).split(/\r?\n/);
  ok('auth.js unchanged', diffNames.indexOf('public/auth.js') === -1);
  ok('app-entry unchanged', diffNames.indexOf('public/app-entry.js') === -1);

  console.log('\n---');
  console.log('TOTAL: ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
