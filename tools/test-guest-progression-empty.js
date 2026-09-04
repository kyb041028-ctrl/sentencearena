'use strict';
/**
 * Guest 임의 progression 숫자 제거
 * node tools/test-guest-progression-empty.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vm = require('vm');

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
const indexHtml = read('public/index.html');
const pp = read('public/player-progression.js');
const ua = read('public/user-achievements.js');
const serverJs = read('server.js');
const progSvc = read('server/user-progression-service.js');
const progRoutes = read('server/user-progression-routes.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. Guest ProfileFrame에 level 12 없음',
  /guestProgressionEmpty:\s*true/.test(indexHtml) && !/level:\s*12/.test(indexHtml),
);
ok('2. Guest ProfileFrame에 fame 3450 없음', !/fame:\s*3450/.test(indexHtml));
ok(
  '3. Guest 임의 XP 없음',
  /createGuestVisitorProfileBase/.test(indexHtml) &&
    /expPercent: null/.test(indexHtml) &&
    /isGuestProgressionViewer/.test(pp) &&
    /paintGuestEmptyAvatarDock/.test(pp),
);
ok(
  '4. Guest 임의 expPercent 없음',
  !/expPercent:\s*68/.test(indexHtml) && /guestEmpty \? '—'/.test(indexHtml),
);
ok(
  '5. Guest 임의 Activity 숫자 없음',
  !/posts:\s*24/.test(indexHtml) &&
    !/comments:\s*183/.test(indexHtml) &&
    /posts: '--'/.test(indexHtml),
);
ok(
  '6. Guest 가짜 획득 업적 없음',
  /guestAchievementState = createEmptyUserAchievementState/.test(ua) &&
    /guestProfile\.achievements = \[\]/.test(indexHtml),
);
ok(
  '7. Guest 대표 업적 없음',
  /achievements: \[\]/.test(indexHtml) &&
    /data && data\.guestProgressionEmpty/.test(indexHtml) &&
    /회원가입 후 업적을 획득할 수 있습니다/.test(indexHtml),
);
ok(
  '8. Guest 때문에 user_progression row 생성 안 함',
  !/ensureAndGetProgression/.test(indexHtml) &&
    /ensureAndGetProgression/.test(progSvc) &&
    /ensureAndGetProgression\(auth\.user\.id\)/.test(progRoutes) &&
    !/ensureAndGetProgression\('guest/.test(progSvc),
);
ok(
  '9. Guest localStorage progression canonical 아님',
  /paintGuestEmptyAvatarDock/.test(pp) &&
    /isGuestProgressionViewer\(uid\)\) return null/.test(pp) &&
    /실회원은 server user_progression 만/.test(indexHtml) &&
    /Guest viewer도 서버 공개 author\.level/.test(indexHtml) &&
    !/P\.getDisplay/.test(
      (indexHtml.split('window.buildUserProfileDataForModal')[1] || '').split(
        'function buildScProfileModalFrameMarkup',
      )[0],
    ),
);
ok(
  '10. 실회원 본인 ProfileFrame canonical 유지',
  /app\.get\('\/api\/me\/profile'/.test(serverJs) &&
    /ensureAndGetProgression/.test(serverJs) &&
    /canonicalLevel/.test(indexHtml) &&
    /createAuthenticatedProfileBase/.test(indexHtml),
);
ok(
  '11. 실회원 타인 level 서버 정본 유지',
  /getPublicAuthorLevel\(id\)/.test(indexHtml) &&
    /rememberPublicAuthorLevel/.test(indexHtml) &&
    /loadPublicLevelsByUserIds/.test(progSvc),
);
ok(
  '12. Guest viewer도 회원 author 공개 Level 사용',
  /function resolvePostDetailAuthorInfo/.test(indexHtml) &&
    /getPublicAuthorLevel\(id\)/.test(indexHtml) &&
    !/PlayerProgression/.test(
      (indexHtml.split('function resolvePostDetailAuthorInfo')[1] || '').split(
        'function normalizeAuthorTerritoryId',
      )[0],
    ),
);
ok(
  '13. 로그아웃/Guest 전환 시 회원 cache 비움',
  /window\.__scUserProfileCache = null/.test(indexHtml) &&
    /function enterGuestApp/.test(indexHtml) &&
    /function signOut/.test(indexHtml),
);
ok(
  '14. Guest empty가 회원 데이터를 덮지 않음',
  /createAuthenticatedProfileBase/.test(indexHtml) &&
    /hasAuthenticatedProfileSession\(\)/.test(indexHtml) &&
    /guestProgressionEmpty/.test(indexHtml),
);
ok(
  '15. Guest read-only 유지',
  /window\.__scRequireLoggedInMember = requireLoggedInMember/.test(indexHtml) &&
    /회원가입 또는 로그인 후 이용할 수 있습니다/.test(indexHtml),
);
ok(
  '16. auth/app-entry/OAuth 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);
ok(
  '17. DEV_ONLY achievement mock 유지',
  /DEV_ONLY fixture/.test(ua) && /DEFAULT_USER_ACHIEVEMENT_MOCK/.test(ua),
);
ok(
  '18. HUD 회원가입 후 시작',
  /회원가입 후 시작/.test(pp) && /명성 : —/.test(pp),
);

section('Guest achievement runtime');
(function () {
  const defsCode = read('public/achievement-definitions.js');
  const achCode = read('public/user-achievements.js');
  const sandbox = {
    window: {},
    document: {
      addEventListener: function () {},
      querySelector: function () {
        return null;
      },
      getElementById: function () {
        return null;
      },
    },
    sessionStorage: {
      getItem: function (k) {
        return k === 'sc_sb_guest_ok' ? '1' : null;
      },
      setItem: function () {},
    },
    localStorage: {
      getItem: function () {
        return null;
      },
      setItem: function () {},
    },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(defsCode + '\n' + achCode, sandbox);
  sandbox.__scAuthUserId = '';
  const guestData = sandbox.getCurrentUserAchievementData();
  ok(
    '19. Guest currentAchievements empty',
    guestData.currentAchievements.length === 0 && guestData.featuredAchievementIds.length === 0,
  );
  const slots = sandbox.buildProfileAchievementsFromFeatured();
  ok('20. Guest featured slots empty', !slots.length);
})();

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
}

finish();
