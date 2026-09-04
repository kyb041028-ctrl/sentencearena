'use strict';
/**
 * 실회원 ProfileFrame 대표 업적 슬롯 — canonical featured 반영
 * node tools/test-featured-profile-frame.js
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

function loadSandbox() {
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
  sandbox.__scFetchLog = [];
  sandbox.fetch = function (url, opts) {
    var u = String(url || '');
    sandbox.__scFetchLog.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    if (!sandbox.__scPersistStore) {
      sandbox.__scPersistStore = {
        currentAchievements: [],
        featuredAchievementIds: [],
      };
    }
    var store = sandbox.__scPersistStore;
    if (u.indexOf('/featured-achievements') !== -1) {
      var featBody = opts && opts.body ? JSON.parse(opts.body) : { keys: [] };
      store.featuredAchievementIds = (featBody.keys || []).slice(0, 3);
      return Promise.resolve({
        status: 200,
        json: function () {
          return Promise.resolve({
            ok: true,
            featuredAchievementIds: store.featuredAchievementIds.slice(),
            data: {
              currentAchievements: store.currentAchievements.slice(),
              featuredAchievementIds: store.featuredAchievementIds.slice(),
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
          data: {
            currentAchievements: store.currentAchievements.slice(),
            featuredAchievementIds: store.featuredAchievementIds.slice(),
            seasonHistory: [],
          },
        });
      },
    });
  };
  vm.runInNewContext(defsCode + '\n' + achCode, sandbox);
  return sandbox;
}

(async function main() {
  section('소스 — 실회원 ProfileFrame 데이터 경로');
  const indexHtml = read('public/index.html');
  const authStart = indexHtml.indexOf('var authUser = resolveAuthUserForProfile()');
  const authEnd = indexHtml.indexOf('window.loadCurrentUserProfile = loadCurrentUserProfile');
  const authChunk = authStart >= 0 && authEnd > authStart ? indexHtml.slice(authStart, authEnd) : '';
  ok('1. 실회원 분기에 featured 빌더 사용', /buildProfileAchievementsFromFeatured/.test(authChunk));
  ok('2. 실회원 achievements=[] wipe 제거', !/profile\.achievements = \[\]/.test(authChunk));
  const guestStart = indexHtml.indexOf('if (!hasAuthenticatedProfileSession())');
  const guestChunk = guestStart >= 0 && authStart > guestStart ? indexHtml.slice(guestStart, authStart) : '';
  ok('3. Guest 분기는 featured 없이 empty', /guestProfile\.achievements = \[\]/.test(guestChunk) && !/buildProfileAchievementsFromFeatured/.test(guestChunk));
  ok('4. first-post 아이콘 매핑', /'first-post':\s*'achievement_first_post'/.test(read('public/user-achievements.js')));

  section('실회원 first-post → 선택 완료 → 슬롯 1');
  const g = loadSandbox();
  const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  g.__scAuthUserId = userA;
  g.resetMemberAlertBaseline();
  const rec = {
    achievementId: 'first-post',
    acquiredAt: '2026-08-13T08:00:00.000Z',
    acquisitionSequence: 1,
    seasonId: null,
    acquisitionNotifiedAt: '2026-08-13T08:00:01.000Z',
  };
  g.__scPersistStore = {
    currentAchievements: [rec],
    featuredAchievementIds: [],
  };
  await g.hydrateCurrentUserAchievementsFromServer(true);
  ok('5. first-post 보유', g.hasCurrentUserAchievement('first-post') === true);
  ok('6. featured 0개', g.getCurrentUserFeaturedAchievementIds().length === 0);
  ok('7. 모달 기록에 first-post', g.getCurrentUserAchievementHistory().some(function (h) {
    return h.achievementId === 'first-post';
  }));

  const draft = g.toggleFeaturedDraftKey('first-post');
  ok('8. selectedAchievementKeys(draft)에 first-post', draft.ok && g.getFeaturedDraftKeys()[0] === 'first-post');
  const confirm = g.confirmFeaturedDraftSelection();
  ok('9. 선택 완료 persist 시작', confirm.ok && confirm.persistPromise);
  await confirm.persistPromise;
  ok(
    '10. featured persistence 성공',
    g.getCurrentUserFeaturedAchievementIds().join(',') === 'first-post',
  );
  const slots = g.buildProfileAchievementsFromFeatured();
  ok('11. ProfileFrame 슬롯 1 first-post', slots[0] && slots[0].id === 'first-post');
  ok(
    '12. 표시명 글쓰기 버튼이 눌렸다',
    slots[0] && slots[0].title === '글쓰기 버튼이 눌렸다',
  );
  ok('13. 아이콘 정상', slots[0] && slots[0].iconId === 'achievement_first_post');
  ok('14. 획득일 정상', slots[0] && String(slots[0].date).length > 0);

  g.__scPersistStore.featuredAchievementIds = ['first-post'];
  g.resetMemberAlertBaseline();
  await g.hydrateCurrentUserAchievementsFromServer(true);
  const afterHydrate = g.buildProfileAchievementsFromFeatured();
  ok(
    '15. hydrate 후에도 슬롯 유지',
    afterHydrate[0] && afterHydrate[0].id === 'first-post' && afterHydrate[0].title === '글쓰기 버튼이 눌렸다',
  );

  section('순서 · 해제 · 거부');
  const rec2 = {
    achievementId: 'territory-citizen',
    acquiredAt: '2026-08-13T09:00:00.000Z',
    acquisitionSequence: 2,
    seasonId: null,
    acquisitionNotifiedAt: '2026-08-13T09:00:01.000Z',
  };
  const rec3 = {
    achievementId: 'beta-citizen',
    acquiredAt: '2026-08-13T10:00:00.000Z',
    acquisitionSequence: 3,
    seasonId: null,
    acquisitionNotifiedAt: '2026-08-13T10:00:01.000Z',
  };
  g.__scPersistStore.currentAchievements = [rec, rec2, rec3];
  g.resetMemberAlertBaseline();
  await g.hydrateCurrentUserAchievementsFromServer(true);
  const set3 = g.setFeaturedAchievementIds(['first-post', 'territory-citizen', 'beta-citizen']);
  ok('16. 3개 선택', set3.ok && set3.featuredAchievementIds.join(',') === 'first-post,territory-citizen,beta-citizen');
  const orderSlots = g.buildProfileAchievementsFromFeatured();
  ok(
    '17. ProfileFrame 순서 유지',
    orderSlots.map(function (s) { return s.id; }).join(',') === 'first-post,territory-citizen,beta-citizen',
  );
  const off = g.toggleFeaturedAchievement('first-post');
  ok(
    '18. 하나 해제 시 나머지 앞으로',
    off.ok && off.featuredAchievementIds.join(',') === 'territory-citizen,beta-citizen',
  );
  const unowned = g.setFeaturedAchievementIds(['witness-of-an-era']);
  ok('19. 미보유 featured 거부', unowned.ok === false);
  const four = g.setFeaturedAchievementIds([
    'first-post',
    'territory-citizen',
    'beta-citizen',
    'record-builder',
  ]);
  ok('20. 4개 저장 거부', four.ok === false);
  const dup = g.validateFeaturedAchievementSelection(['first-post', 'first-post']);
  ok('21. 중복 key 검증 거부', dup.valid === false);

  section('Guest Mock 회귀');
  const guest = loadSandbox();
  guest.__scAuthUserId = '';
  guest.sessionStorage.getItem = function (k) {
    return k === 'sc_sb_guest_ok' ? '1' : null;
  };
  const guestData = guest.getCurrentUserAchievementData();
  const guestSlots = guest.buildProfileAchievementsFromFeatured();
  ok('22. Guest 획득 업적 없음', guestData.currentAchievements.length === 0);
  ok(
    '23. Guest 대표 업적 없음',
    guestSlots.length === 0 || guestSlots.every(function (s) { return !s.id; }),
  );
  ok(
    '24. Guest notified API 미사용',
    guest.__scFetchLog.filter(function (e) {
      return String(e.url).indexOf('/notified') !== -1;
    }).length === 0,
  );

  section('auth/app-entry 보호');
  const diffNames = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).split(/\r?\n/);
  ok('25. auth.js unchanged', diffNames.indexOf('public/auth.js') === -1);
  ok('26. app-entry unchanged', diffNames.indexOf('public/app-entry.js') === -1);

  console.log('\n---');
  console.log('TOTAL: ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
