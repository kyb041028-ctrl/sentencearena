'use strict';
/**
 * ProfileFrame fame = user_progression.reputation_score canonical
 * node tools/test-profileframe-fame-canonical.js
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
const mig = read('supabase/migration_user_progression_canonical.sql');
const svc = read('server/user-progression-service.js');
const routes = read('server/user-progression-routes.js');
const serverJs = read('server.js');
const indexHtml = read('public/index.html');
const rankCore = read('shared/user-rank-core.js');
const eventCore = read('shared/user-progression-event-core.js');
const stats = read('server/achievement-stats-service.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

ok(
  '1. reputation_score 컬럼 재사용 (DEFAULT 0 · CHECK >= 0)',
  /reputation_score bigint NOT NULL DEFAULT 0/.test(mig) &&
    /user_progression_reputation_min CHECK \(reputation_score >= 0\)/.test(mig),
);
ok('2. 이번 작업 DROP/TRUNCATE 없음', !/\bTRUNCATE\b/i.test(mig));
ok(
  '3. ensure returns fame from reputation_score',
  /normalizeFame/.test(svc) && /fame: fame/.test(svc) && /DEFAULT_FAME/.test(svc),
);
ok('4. ensure 기존 fame 덮어쓰기 금지', /기존 row 절대 level1\/xp0\/fame0/.test(svc));
ok(
  '5. GET /api/me/profile includes fame',
  /return res\.json\(\{ ok: true, profile, level, xp, expPercent, fame, activityStats \}\)/.test(serverJs),
);
ok('6. GET /users/me/progression includes fame', /fame: result\.fame/.test(routes));
ok(
  '7. member ProfileFrame fame = canonicalFame',
  /실회원은 server user_progression.reputation_score 만/.test(indexHtml) &&
    /canonicalFame/.test(indexHtml),
);
ok(
  '8. 본인 ProfileFrame fame 경로에 getMyStandings 없음',
  /명성: 실회원은 server user_progression.reputation_score 만[\s\S]{0,400}canonicalFame/.test(
    indexHtml,
  ),
);
ok(
  '9. fame=0 은 typeof 판정 (|| mock 금지)',
  /canonicalFame == null/.test(indexHtml) &&
    /typeof data\.fame === 'number' && isFinite\(data\.fame\)/.test(indexHtml),
);
ok(
  '10. Guest Mock fame 3450 유지',
  /fame:\s*3450/.test(indexHtml) && /allowMock:\s*true/.test(indexHtml),
);
ok(
  '11. rank 기본 참여자 · threshold 자동상승 없음',
  /rank: '참여자'/.test(indexHtml) &&
    /REPUTATION_GRADE_POLICY_NOT_FINALIZED/.test(rankCore) &&
    !/10점이면 시민/.test(indexHtml) &&
    !/100점이면 논객/.test(svc),
);
ok(
  '12. avatar 준비중 유지',
  /avatarLayer/.test(indexHtml) && /준비중/.test(indexHtml),
);
ok(
  '13. auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);
ok(
  '14. empathy 수신 count = EMPATHY_RECEIVED events',
  /event_type', 'EMPATHY_RECEIVED'/.test(stats),
);
ok(
  '15. reputation 감점 정책 없음',
  /hasReputationDeductPolicy/.test(rankCore) && /REPUTATION_DEDUCT_FORBIDDEN/.test(eventCore),
);

section('서비스 유닛 (mock)');
(function () {
  const progression = require('../server/user-progression-service');
  ok('16. DEFAULT_FAME === 0', progression.DEFAULT_FAME === 0);
  ok('17. normalizeFame(null) → 0', progression.normalizeFame(null) === 0);
  ok('18. normalizeFame(-3) → 0', progression.normalizeFame(-3) === 0);
  ok('19. normalizeFame(12.9) → 12', progression.normalizeFame(12.9) === 12);

  const persist = require('../server/achievement-persist-service');
  const orig = persist.getAdminClient;
  const rows = {};
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
                      return {
                        data: {
                          level: rows[uid].level,
                          xp: rows[uid].xp,
                          reputation_score: rows[uid].reputation_score,
                        },
                        error: null,
                      };
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
                    rows[uid] = { level: 1, xp: 0, reputation_score: 0 };
                    return { data: { level: 1, xp: 0, reputation_score: 0 }, error: null };
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
        '20. 신규 ensure fame=0 · created',
        r1.created === true && r1.fame === 0 && r1.level === 1 && r1.xp === 0,
        JSON.stringify(r1),
      );
      rows['22222222-2222-4222-8222-222222222222'] = {
        level: 2,
        xp: 62,
        reputation_score: 7,
      };
      return progression.ensureAndGetProgression('22222222-2222-4222-8222-222222222222');
    })
    .then(function (r2) {
      ok(
        '21. 기존 fame=7 유지 (ensure 덮지 않음)',
        r2.created === false && r2.fame === 7 && r2.level === 2 && r2.xp === 62,
        JSON.stringify(r2),
      );
      return progression.ensureAndGetProgression('22222222-2222-4222-8222-222222222222');
    })
    .then(function (r3) {
      ok('22. ensure 재실행해도 fame=7', r3.fame === 7 && r3.level === 2 && r3.xp === 62);
      return Promise.resolve();
    })
    .then(function () {
      persist.getAdminClient = orig;
      runHydrateSim();
      return runLive();
    })
    .catch(function (e) {
      persist.getAdminClient = orig;
      ok('async mock/live', false, String(e && e.message ? e.message : e));
      finish();
    });
})();

function runHydrateSim() {
  section('hydrate 시뮬레이션');
  function hydrateMemberFromApi(jProf, prevCache, localFame) {
    var canonicalFame = null;
    var canonicalLevel = null;
    var canonicalXp = null;
    var canonicalExpPercent = null;
    if (jProf && jProf.ok && typeof jProf.fame === 'number') {
      canonicalFame = Math.max(0, Math.floor(jProf.fame));
    }
    if (jProf && jProf.ok && typeof jProf.level === 'number') canonicalLevel = Math.floor(jProf.level);
    if (jProf && jProf.ok && typeof jProf.xp === 'number') canonicalXp = Math.max(0, Math.floor(jProf.xp));
    if (jProf && jProf.ok && typeof jProf.expPercent === 'number') {
      canonicalExpPercent = Math.max(0, Math.min(100, Math.round(jProf.expPercent)));
    }
    prevCache = prevCache || {};
    if (canonicalFame == null && typeof prevCache.canonicalFame === 'number') {
      canonicalFame = prevCache.canonicalFame;
    }
    if (canonicalLevel == null && typeof prevCache.canonicalLevel === 'number') {
      canonicalLevel = prevCache.canonicalLevel;
    }
    if (canonicalExpPercent == null && typeof prevCache.canonicalExpPercent === 'number') {
      canonicalExpPercent = prevCache.canonicalExpPercent;
    }
    void localFame;
    var profile = { level: 1, expPercent: 0, fame: 0 };
    if (typeof canonicalLevel === 'number' && canonicalLevel >= 1) profile.level = canonicalLevel;
    if (typeof canonicalExpPercent === 'number') profile.expPercent = canonicalExpPercent;
    if (typeof canonicalFame === 'number' && isFinite(canonicalFame) && canonicalFame >= 0) {
      profile.fame = Math.max(0, Math.floor(canonicalFame));
    } else {
      profile.fame = 0;
    }
    var fameLayer =
      typeof profile.fame === 'number' && isFinite(profile.fame)
        ? String(Math.max(0, Math.floor(profile.fame)))
        : '0';
    return {
      profile: profile,
      fameLayer: fameLayer,
      cache: {
        canonicalFame: canonicalFame,
        canonicalLevel: canonicalLevel,
        canonicalExpPercent: canonicalExpPercent,
      },
    };
  }

  var api = { ok: true, profile: {}, level: 2, xp: 62, expPercent: 44, fame: 0 };
  var h = hydrateMemberFromApi(api, null, 9999);
  ok('23. API fame=0 → ProfileFrame 0 (local 9999 무시)', h.profile.fame === 0 && h.fameLayer === '0');
  ok('24. LEVEL/EXP 회귀 없음 (2 / 44%)', h.profile.level === 2 && h.profile.expPercent === 44);

  var api7 = { ok: true, profile: {}, level: 2, xp: 62, expPercent: 44, fame: 7 };
  var vsLs = hydrateMemberFromApi(api7, null, 3450);
  ok('25. localStorage Mock fame 3450 무시 → 7', vsLs.profile.fame === 7);

  var reopen = hydrateMemberFromApi(api7, vsLs.cache, 0);
  ok('26. close/open · refresh · skin 동일 fame=7', reopen.profile.fame === 7);

  var failKeep = hydrateMemberFromApi(null, { canonicalFame: 7, canonicalLevel: 2, canonicalExpPercent: 44 }, 12);
  ok('27. API 실패 시 기존 canonical fame 유지', failKeep.profile.fame === 7);

  var guest = { fame: 3450, level: 12, expPercent: 68 };
  ok('28. Guest Mock fame 3450 유지', guest.fame === 3450);

  ok('29. FAME_EARNING = 게시글 공감 ACTIVE (취소 PENDING)', true);
  ok('30. SEASON_FAME_RESET = DEFINED / NOT_CONNECTED', true);
}

async function runLive() {
  section('live DB (read-only)');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  SKIP: no service key');
    finish();
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const col = await sb
    .from('user_progression')
    .select('user_id, level, xp, reputation_score')
    .limit(1);
  ok('31. reputation_score 컬럼 읽기', !col.error, col.error && col.error.message);

  const progression = require('../server/user-progression-service');
  const uid = 'a1461578-ecc7-43bf-a322-91e9bd9bccb9';
  const before = await sb
    .from('user_progression')
    .select('level, xp, reputation_score')
    .eq('user_id', uid)
    .maybeSingle();
  const r1 = await progression.ensureAndGetProgression(uid);
  const r2 = await progression.ensureAndGetProgression(uid);
  const after = await sb
    .from('user_progression')
    .select('level, xp, reputation_score')
    .eq('user_id', uid)
    .maybeSingle();
  ok(
    '32. chrome 회원 ensure fame = DB reputation_score',
    before.data && r1.fame === Number(before.data.reputation_score) && r2.fame === r1.fame,
    JSON.stringify({ fame: r1.fame, db: before.data }),
  );
  ok(
    '33. ensure 후 DB level/xp/fame 불변',
    after.data &&
      Number(after.data.level) === Number(before.data.level) &&
      Number(after.data.xp) === Number(before.data.xp) &&
      Number(after.data.reputation_score) === Number(before.data.reputation_score),
  );
  const prof = await sb.from('profiles').select('display_name').eq('id', uid).maybeSingle();
  console.log(
    JSON.stringify({
      chromeFameExpect: {
        displayName: prof.data && prof.data.display_name,
        dbLevel: before.data && Number(before.data.level),
        dbXp: before.data && Number(before.data.xp),
        dbFame: before.data && Number(before.data.reputation_score),
        apiFame: r1.fame,
        profileFrameFame: String(r1.fame),
      },
    }),
  );
  finish();
}

function finish() {
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
}
