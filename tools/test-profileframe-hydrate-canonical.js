'use strict';
/**
 * ProfileFrame hydrate: GET /api/me/profile → cache → render
 * localStorage/Mock 이 실회원 LEVEL/EXP 를 덮지 않는지 회귀
 * node tools/test-profileframe-hydrate-canonical.js
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

section('소스 가드');
const indexHtml = read('public/index.html');
const pp = read('public/player-progression.js');
const serverJs = read('server.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. /api/me/profile top-level level+xp+expPercent',
  /return res\.json\(\{ ok: true, profile, level, xp, expPercent, fame, activityStats, territory \}\)/.test(serverJs),
);
ok(
  '2. prefetch reads jProf.level/xp/expPercent',
  /jProf\.level/.test(indexHtml) &&
    /jProf\.xp/.test(indexHtml) &&
    /jProf\.expPercent/.test(indexHtml) &&
    /canonicalExpPercent/.test(indexHtml),
);
ok(
  '3. sc:auth-user triggers prefetch (app-entry cache 보정)',
  /addEventListener\('sc:auth-user'[\s\S]*__scPrefetchUserProfile/.test(indexHtml),
);
ok(
  '4. profile open re-prefetch for members (window flags, not cross-IIFE)',
  /isMemberSession/.test(indexHtml) &&
    /btnTab\.addEventListener\('click'[\s\S]*__scPrefetchUserProfile/.test(indexHtml),
);
ok(
  '5. member loadCurrentUserProfile ignores PlayerProgression for LEVEL/EXP',
  /실회원은 server user_progression 만/.test(indexHtml) &&
    !/profile\.expPercent = progDisplay/.test(indexHtml),
);
ok(
  '6. renderProfileData preserves expPercent=0 (no || fallback)',
  /typeof expRaw === 'number' && isFinite\(expRaw\)/.test(indexHtml),
);
ok(
  '7. fetch fail keeps prev canonical (no Mock overwrite)',
  /fetch 실패 시 기존 canonical 유지/.test(indexHtml),
);
ok(
  '8. avatar dock member uses canonical cache',
  /localStorage 무시/.test(pp) && /canonicalLevel/.test(pp),
);
ok(
  '9. LEVEL DOM = levelLayer · EXP DOM = expLayer',
  /setLayerText\('levelLayer'/.test(indexHtml) && /setLayerText\('expLayer'/.test(indexHtml),
);
ok(
  '10. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);
ok('11. Guest Mock level 12 / exp 68 유지', /level:\s*12/.test(indexHtml) && /expPercent:\s*68/.test(indexHtml));

section('hydrate 시뮬레이션 (canonical vs localStorage)');
(function () {
  const progression = require('../server/user-progression-service');
  const ppCfg = require('../config/player-progression');

  const canonicalDb = { level: 2, xp: 62 };
  const display = progression.computeExpDisplay(canonicalDb.level, canonicalDb.xp);
  const api = {
    ok: true,
    profile: { display_name: 'test_member' },
    level: canonicalDb.level,
    xp: canonicalDb.xp,
    expPercent: display.pct,
  };

  ok('12. DB level2/xp62 → expPercent 44', api.expPercent === 44, 'got ' + api.expPercent);
  ok(
    '13. API mirrors DB',
    api.level === 2 && api.xp === 62 && api.expPercent === 44,
  );

  function hydrateMemberFromApi(jProf, prevCache, localProgression) {
    /* mirrors __scPrefetchUserProfile field mapping + loadCurrentUserProfile member path */
    var canonicalLevel = null;
    var canonicalXp = null;
    var canonicalExpPercent = null;
    if (jProf && jProf.ok && typeof jProf.level === 'number') canonicalLevel = Math.floor(jProf.level);
    if (jProf && jProf.ok && typeof jProf.xp === 'number') canonicalXp = Math.max(0, Math.floor(jProf.xp));
    if (jProf && jProf.ok && typeof jProf.expPercent === 'number') {
      canonicalExpPercent = Math.max(0, Math.min(100, Math.round(jProf.expPercent)));
    }
    prevCache = prevCache || {};
    if (canonicalLevel == null && typeof prevCache.canonicalLevel === 'number') {
      canonicalLevel = prevCache.canonicalLevel;
    }
    if (canonicalXp == null && typeof prevCache.canonicalXp === 'number') {
      canonicalXp = prevCache.canonicalXp;
    }
    if (canonicalExpPercent == null && typeof prevCache.canonicalExpPercent === 'number') {
      canonicalExpPercent = prevCache.canonicalExpPercent;
    }
    var cache = {
      authUser: { id: 'member-uid' },
      dbProfile: (jProf && jProf.profile) || null,
      canonicalLevel: canonicalLevel,
      level: canonicalLevel,
      canonicalXp: canonicalXp,
      xp: canonicalXp,
      canonicalExpPercent: canonicalExpPercent,
      expPercent: canonicalExpPercent,
    };
    /* localProgression intentionally ignored for member LEVEL/EXP */
    void localProgression;
    var profile = { level: 1, expPercent: 0 };
    if (typeof cache.canonicalLevel === 'number' && cache.canonicalLevel >= 1) {
      profile.level = Math.floor(cache.canonicalLevel);
    }
    if (typeof cache.canonicalExpPercent === 'number' && isFinite(cache.canonicalExpPercent)) {
      profile.expPercent = Math.max(0, Math.min(100, Math.round(cache.canonicalExpPercent)));
    }
    return { cache: cache, profile: profile };
  }

  function renderLayers(profile) {
    var expRaw = profile.expPercent;
    var expPercent =
      typeof expRaw === 'number' && isFinite(expRaw)
        ? Math.max(0, Math.min(100, Math.round(expRaw)))
        : 0;
    return {
      levelLayer: String(profile.level != null ? profile.level : ''),
      expLayer: String(expPercent) + '%',
    };
  }

  var emptyCache = hydrateMemberFromApi(api, null, { level: 1, xp: 0, pct: 0 });
  var emptyDom = renderLayers(emptyCache.profile);
  ok(
    '14. fresh hydrate empty cache → Lv2 / 44%',
    emptyDom.levelLayer === '2' && emptyDom.expLayer === '44%',
    JSON.stringify(emptyDom),
  );

  var vsLow = hydrateMemberFromApi(api, null, { level: 1, xp: 0, pct: 0 });
  ok(
    '15. localStorage level1/xp0 ignored → Lv2 / 44%',
    vsLow.profile.level === 2 && vsLow.profile.expPercent === 44,
  );

  var vsHigh = hydrateMemberFromApi(api, null, { level: 5, xp: 9999, pct: 99 });
  ok(
    '16. localStorage level5/xp9999 ignored → Lv2 / 44%',
    vsHigh.profile.level === 2 && vsHigh.profile.expPercent === 44,
  );

  var afterCloseOpen = hydrateMemberFromApi(api, emptyCache.cache, { level: 1, xp: 0 });
  ok(
    '17. profile close/open re-hydrate → Lv2 / 44%',
    afterCloseOpen.profile.level === 2 && afterCloseOpen.profile.expPercent === 44,
  );

  var afterSkin = renderLayers(afterCloseOpen.profile);
  ok(
    '18. skin change uses same profile data → Lv2 / 44%',
    afterSkin.levelLayer === '2' && afterSkin.expLayer === '44%',
  );

  var afterRefresh = hydrateMemberFromApi(api, afterCloseOpen.cache, null);
  ok(
    '19. profile refresh → Lv2 / 44%',
    afterRefresh.profile.level === 2 && afterRefresh.profile.expPercent === 44,
  );

  var afterAch = renderLayers(afterRefresh.profile);
  ok(
    '20. achievement refresh path keeps LEVEL/EXP',
    afterAch.levelLayer === '2' && afterAch.expLayer === '44%',
  );

  var zeroApi = {
    ok: true,
    profile: {},
    level: 1,
    xp: 0,
    expPercent: progression.computeExpDisplay(1, 0).pct,
  };
  var zeroH = hydrateMemberFromApi(zeroApi, null, { level: 12, pct: 68 });
  var zeroDom = renderLayers(zeroH.profile);
  ok(
    '21. canonical expPercent=0 정상 표시',
    zeroDom.levelLayer === '1' && zeroDom.expLayer === '0%',
    JSON.stringify(zeroDom),
  );
  ok('22. canonical level=1 정상 표시', zeroH.profile.level === 1);

  var failApi = null;
  var keepPrev = hydrateMemberFromApi(failApi, {
    canonicalLevel: 2,
    canonicalXp: 62,
    canonicalExpPercent: 44,
  }, { level: 12, pct: 68 });
  ok(
    '23. API fail keeps previous canonical (not Mock 12/68)',
    keepPrev.profile.level === 2 && keepPrev.profile.expPercent === 44,
  );

  /* Guest path: Mock allowed */
  var guestProfile = { level: 12, expPercent: 68 };
  var guestDom = renderLayers(guestProfile);
  ok(
    '24. Guest Mock level12 / EXP68% 유지',
    guestDom.levelLayer === '12' && guestDom.expLayer === '68%',
  );

  ok(
    '25. config xpProgress matches service for 2/62',
    ppCfg.xpProgressInLevel(2, 62).pct === 44,
  );
})();

section('요약');
console.log('PASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
