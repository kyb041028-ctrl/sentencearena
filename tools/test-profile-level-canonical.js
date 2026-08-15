'use strict';
/**
 * ProfileFrame LEVEL + EXP ↔ user_progression canonical
 * node tools/test-profile-level-canonical.js
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

section('소스·라우트');
const mig = read('supabase/migration_user_progression_canonical.sql');
const svc = read('server/user-progression-service.js');
const routes = read('server/user-progression-routes.js');
const stats = read('server/achievement-stats-service.js');
const serverJs = read('server.js');
const indexHtml = read('public/index.html');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok('1. additive user_progression migration', /CREATE TABLE IF NOT EXISTS public\.user_progression/.test(mig));
ok('2. level DEFAULT 1 · xp DEFAULT 0', /level integer NOT NULL DEFAULT 1/.test(mig) && /xp bigint NOT NULL DEFAULT 0/.test(mig));
ok('3. no DROP TABLE/TRUNCATE', !/\bTRUNCATE\b/i.test(mig) && !/\bDROP TABLE\b/i.test(mig));
ok('4. ensureAndGetProgression', /ensureAndGetProgression/.test(svc) && /computeExpDisplay/.test(svc));
ok('5. GET progression returns xp+expPercent', /expPercent/.test(routes) && /result\.xp/.test(routes));
ok('6. /api/me/profile returns level+xp+expPercent', /ensureAndGetProgression/.test(serverJs) && /expPercent/.test(serverJs));
ok('7. progression router mounted', /createUserProgressionRouter/.test(serverJs));
ok(
  '8. evaluator ensure same service',
  /ensureAndGetProgressionLevel/.test(stats) && /user-progression-service/.test(stats),
);
ok(
  '9. member ProfileFrame uses cache LEVEL+EXP',
  /canonicalLevel/.test(indexHtml) &&
    /canonicalExpPercent/.test(indexHtml) &&
    /실회원은 server user_progression 만/.test(indexHtml) &&
    !/progDisplay\.progress\.pct/.test(indexHtml),
);
ok(
  '10. Guest Mock level/exp 유지',
  /level:\s*12/.test(indexHtml) && /expPercent:\s*68/.test(indexHtml) && /allowMock:\s*true/.test(indexHtml),
);
ok('11. avatar placeholder 유지', /avatarLayer/.test(indexHtml) && /준비중/.test(indexHtml));
ok(
  '12. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff),
);
ok(
  '12b. expGauge width uses expPercent',
  /gaugeFill\.style\.width = String\(expPercent\) \+ '%'/.test(indexHtml) &&
    /typeof expRaw === 'number' && isFinite\(expRaw\)/.test(indexHtml),
);

section('서비스 유닛 (mock)');
(function () {
  const progression = require('../server/user-progression-service');
  const pp = require('../config/player-progression');

  ok('13. DEFAULT_LEVEL === 1 · DEFAULT_XP === 0', progression.DEFAULT_LEVEL === 1 && progression.DEFAULT_XP === 0);
  ok('14. normalizeXp(null) → 0', progression.normalizeXp(null) === 0);
  ok('15. Lv1 xp0 → 0%', progression.computeExpDisplay(1, 0).pct === 0);
  ok('16. Lv1 xp20 → 50%', progression.computeExpDisplay(1, 20).pct === 50);
  ok('17. Lv10 xp1500 → 100%', progression.computeExpDisplay(10, 1500).pct === 100);
  ok('17b. Lv5 xp220 → 0%', progression.computeExpDisplay(5, 220).pct === 0);
  ok('17c. xp300 → Lv6', require('../shared/progression-xp-core').calculateLevelFromXp(300) === 6);
  ok(
    '18. display matches config.player-progression',
    progression.computeExpDisplay(2, 50).pct === pp.xpProgressInLevel(2, 50).pct,
  );

  const persist = require('../server/achievement-persist-service');
  const rows = {};
  const orig = persist.getAdminClient;
  persist.getAdminClient = function () {
    return {
      from: function () {
        return {
          select: function () {
            return {
              eq: function (_c, uid) {
                return {
                  maybeSingle: async function () {
                    if (rows[uid]) {
                      return { data: { level: rows[uid].level, xp: rows[uid].xp }, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
          insert: function (payload) {
            return {
              select: function () {
                return {
                  single: async function () {
                    const uid = payload.user_id;
                    rows[uid] = { level: 1, xp: 0 };
                    return { data: { level: 1, xp: 0 }, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  };

  return progression
    .ensureAndGetProgression('11111111-1111-4111-8111-111111111111')
    .then(function (r1) {
      ok(
        '19. ensure creates level1 xp0 exp0%',
        r1.created === true && r1.level === 1 && r1.xp === 0 && r1.expPercent === 0,
      );
      rows['11111111-1111-4111-8111-111111111111'] = { level: 1, xp: 20 };
      return progression.ensureAndGetProgression('11111111-1111-4111-8111-111111111111');
    })
    .then(function (r2) {
      ok(
        '20. ensure returns xp20 → 50%',
        r2.created === false && r2.level === 1 && r2.xp === 20 && r2.expPercent === 50,
      );
      persist.getAdminClient = orig;
    })
    .catch(function (e) {
      persist.getAdminClient = orig;
      ok('19-20. ensure mock', false, String(e && e.message ? e.message : e));
    })
    .then(runLive);
})();

async function runLive() {
  section('live DB (optional)');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  SKIP: SUPABASE_SERVICE_ROLE_KEY missing');
    finish();
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const tableCheck = await sb.from('user_progression').select('user_id, level, xp').limit(1);
  if (tableCheck.error) {
    ok('21. user_progression level+xp readable', false, tableCheck.error.message);
    finish();
    return;
  }
  ok('21. user_progression level+xp readable', true);

  const profiles = await sb.from('profiles').select('id, display_name').limit(5);
  if (profiles.error || !profiles.data || !profiles.data.length) {
    console.log('  SKIP: no profiles for live ensure');
    finish();
    return;
  }

  const progression = require('../server/user-progression-service');
  const preferred =
    profiles.data.find(function (p) {
      return p.display_name === '어휴힘들다';
    }) || profiles.data[0];
  const uid = preferred.id;
  const ensured = await progression.ensureAndGetProgression(uid);
  const after = await sb
    .from('user_progression')
    .select('level, xp')
    .eq('user_id', uid)
    .maybeSingle();

  ok(
    '22. ensure level+xp match DB',
    after.data &&
      Number(after.data.level) === ensured.level &&
      Number(after.data.xp) === ensured.xp,
    'uid=' + uid + ' level=' + ensured.level + ' xp=' + ensured.xp,
  );
  ok(
    '23. expPercent derived from level+xp',
    ensured.expPercent === progression.computeExpDisplay(ensured.level, ensured.xp).pct,
  );

  console.log(
    JSON.stringify({
      liveSample: {
        userId: uid,
        displayName: preferred.display_name || null,
        level: ensured.level,
        xp: ensured.xp,
        expPercent: ensured.expPercent,
        profileFrameExpect: {
          level: String(ensured.level),
          exp: String(ensured.expPercent) + '%',
          gaugeWidth: String(ensured.expPercent) + '%',
        },
      },
    }),
  );

  finish();
}

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
}
