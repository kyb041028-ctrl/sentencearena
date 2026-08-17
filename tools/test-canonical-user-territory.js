'use strict';
/**
 * Canonical Earth membership — CENTRAL start, no user selection
 * node tools/test-canonical-user-territory.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const core = require('../shared/canonical-user-territory-core');
const svc = require('../server/canonical-user-territory-service');
const boardAdapter = require('../server/board-user-context-adapter');
const teardown = require('./test-process-teardown');

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

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function runChild(script, expectNeedle, timeoutMs, env) {
  const out = execFileSync(process.execPath, [path.join(__dirname, script)], {
    encoding: 'utf8',
    timeout: timeoutMs || 180000,
    env: Object.assign({}, process.env, env || {}),
  });
  if (expectNeedle && out.indexOf(expectNeedle) === -1) {
    throw new Error(script + ' missing: ' + expectNeedle + '\n' + out.slice(-2000));
  }
  return out;
}

const foundSql = read('supabase/migration_canonical_user_territory.sql');
const foundBody = foundSql.replace(/--[^\n]*/g, '');
const startSql = read('supabase/migration_canonical_territory_central_start.sql');
const startBody = startSql.replace(/--[^\n]*/g, '');
const svcSrc = read('server/canonical-user-territory-service.js');
const coreSrc = read('shared/canonical-user-territory-core.js');
const adapterSrc = read('server/board-user-context-adapter.js');
const persistSrc = read('server/political-alignment-persist-service.js');
const boardSvcSrc = read('server/board-service.js');
const entrySrc = read('public/app-entry.js');
const indexHtml = read('public/index.html');
const serverJs = read('server.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

section('정책');
ok('PIONEER valid', core.normalizeCanonicalMembershipTerritory('PIONEER').territory === 'PIONEER');
ok('CENTRAL valid', core.normalizeCanonicalMembershipTerritory('CENTRAL').territory === 'CENTRAL');
ok('GUARDIAN valid', core.normalizeCanonicalMembershipTerritory('GUARDIAN').territory === 'GUARDIAN');
ok('ALIEN reject', core.normalizeCanonicalMembershipTerritory('ALIEN').error === 'TERRITORY_MEMBERSHIP_ALIEN_FORBIDDEN');
ok('KANTAPBIYA reject', core.normalizeCanonicalMembershipTerritory('KANTAPBIYA').ok === false);
ok('source profiles.territory', core.CURRENT_TERRITORY_CANONICAL_SOURCE === 'profiles.territory');
ok('INITIAL_TERRITORY CENTRAL', core.INITIAL_TERRITORY === 'CENTRAL' && svc.INITIAL_TERRITORY === 'CENTRAL');
ok('INITIAL_ALIGNMENT_SCORE 0', core.INITIAL_ALIGNMENT_SCORE === 0);
ok('SELECTION_UI NOT_APPLICABLE', core.TERRITORY_SELECTION_UI === 'NOT_APPLICABLE');
ok('SELF_WRITE NOT_ALLOWED', core.TERRITORY_SELF_WRITE === 'NOT_ALLOWED');
ok('TERRITORY_MOVE SERVER_INTERNAL_BATCH', core.TERRITORY_MOVE === 'SERVER_INTERNAL_BATCH');
ok('HISTORY ACTIVE', core.TERRITORY_HISTORY === 'ACTIVE');
ok('BOARD_MEMBERSHIP_CONTEXT PROFILES_TERRITORY', core.BOARD_MEMBERSHIP_CONTEXT === 'PROFILES_TERRITORY');

section('foundation migration 유지');
ok('foundation DROP TABLE 없음', !/\bDROP TABLE\b/i.test(foundBody));
ok('foundation CHECK Earth only', /PIONEER',\s*'CENTRAL',\s*'GUARDIAN'/.test(foundSql));
ok('foundation client write 금지', /PROFILES_TERRITORY_CLIENT_WRITE_FORBIDDEN/.test(foundSql));

section('CENTRAL start migration');
ok('correction DROP/TRUNCATE/DELETE 없음', !/\bDROP TABLE\b/i.test(startBody) && !/\bTRUNCATE\b/i.test(startBody) && !/\bDELETE FROM\b/i.test(startBody));
ok('NULL backfill CENTRAL', /UPDATE\s+public\.profiles\s+SET\s+territory\s*=\s*'CENTRAL'\s+WHERE\s+territory\s+IS\s+NULL/i.test(startBody));
ok('DEFAULT CENTRAL', /SET DEFAULT 'CENTRAL'/.test(startSql));
ok('handle_new_user CENTRAL', /citizenship_status, territory/.test(startSql) && /'CENTRAL'/.test(startSql));
ok('provider 분기 없음', !/google/i.test(startBody) && !/kakao/i.test(startBody) && !/naver/i.test(startBody));

section('잘못된 selection 제거');
ok('5. selection UI 파일 없음', !exists('public/territory-selection.js'));
ok('6. PIONEER 선택 버튼 없음', !/data-canonical="PIONEER"/.test(indexHtml) && !/최초 소속 영토 선택/.test(indexHtml));
ok('7. GUARDIAN 선택 버튼 없음', !/data-canonical="GUARDIAN"/.test(indexHtml));
ok('app-entry gating 없음', !/needsTerritorySelection/.test(entrySrc) && !/ScTerritorySelection/.test(entrySrc) && !/loadCurrentProfilePack/.test(entrySrc));
ok('8. browser self-write API 없음', !/createCanonicalTerritoryRouter/.test(serverJs) && !exists('server/canonical-user-territory-routes.js') && !/saveInitialCanonicalUserTerritory/.test(svcSrc));
ok('9. 지도 membership write 없음', /window\.__scApp\.goBoard/.test(indexHtml) && !/\/api\/me\/territory/.test(indexHtml) && /게시판으로 이동/.test(indexHtml));
ok('10. profile territory read', /activityStats, territory/.test(serverJs));
ok('11. canonical source', boardAdapter.MEMBERSHIP_TERRITORY_CANONICAL_SOURCE === 'profiles.territory');
ok('13. reaction snapshot uses getUserTerritory', /getUserTerritory\(userId\)/.test(boardSvcSrc) && /getCanonicalUserTerritory/.test(adapterSrc) && !/current_territory/.test(adapterSrc) && !/metadata/.test(adapterSrc));
ok('transition 호출 없음', !/evaluateTerritoryTransition/.test(svcSrc) && !/evaluateTerritoryTransition/.test(coreSrc));
ok('localStorage 미사용', !/localStorage/.test(coreSrc) && /No localStorage/.test(svcSrc));
ok('Guest write 없음', !/\/api\/me\/territory/.test(entrySrc));
ok('20. auth.js diff 없음', !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) && !/(^|\n)public\/auth-v2\//.test(authDiff));
ok('app-entry 최소(복구)', !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff));

function alignmentSum(sb) {
  return sb.from('user_alignment_state').select('score,previous_signal').then(function (align) {
    if (align.error) throw align.error;
    const scores = (align.data || []).map(function (r) {
      return Number(r.score) || 0;
    });
    const signals = (align.data || []).map(function (r) {
      return Number(r.previous_signal) || 0;
    });
    return {
      score: scores.reduce(function (a, b) {
        return a + b;
      }, 0),
      signal: signals.reduce(function (a, b) {
        return a + b;
      }, 0),
      rows: (align.data || []).length,
    };
  });
}

function liveSchemaAndRows() {
  const persist = require('../server/achievement-persist-service');
  const sb = persist.getAdminClient();
  return Promise.all([
    sb.from('profiles').select('id,territory', { count: 'exact' }),
    alignmentSum(sb),
  ]).then(function (pair) {
    const profiles = pair[0];
    const align = pair[1];
    if (profiles.error) throw profiles.error;
    const rows = profiles.data || [];
    const nulls = rows.filter(function (r) {
      return r.territory == null;
    });
    const central = rows.filter(function (r) {
      return r.territory === 'CENTRAL';
    });
    ok('live profiles.territory 조회', true);
    ok('3. 기존 NULL → CENTRAL backfill', nulls.length === 0, 'nulls=' + nulls.length);
    ok('profiles 42명 이상', (profiles.count || 0) >= 42, 'count=' + profiles.count);
    ok('CENTRAL 회원 42명 이상', central.length >= 42, 'central=' + central.length);
    ok('14. alignment score 합 0', align.score === 0);
    ok('previous_signal 합 0', align.signal === 0);
    const sampleId = rows[0] && rows[0].id;
    if (!sampleId) {
      ok('getCanonicalUserTerritory', false, 'no profile');
      return;
    }
    return svc.getCanonicalUserTerritory(sampleId).then(function (got) {
      ok(
        'getCanonicalUserTerritory CENTRAL',
        got.territory === 'CENTRAL' && got.source === 'profiles.territory'
      );
      return boardAdapter.createCanonicalUserContextAdapter().getUserTerritory(sampleId);
    }).then(function (boardT) {
      ok('board adapter membership CENTRAL', boardT === 'CENTRAL');
    });
  });
}

function liveConstraintAndNewUser() {
  const { createClient } = require('@supabase/supabase-js');
  const {
    createDailyIssuePgExecutor,
    resolveDailyIssueDatabaseUrl,
  } = require('../server/daily-issue-pg-client');
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const sbUrl = String(process.env.SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url) {
    ok('pg probe skipped', false, 'DATABASE_UNAVAILABLE');
    return Promise.resolve();
  }
  const exec = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!exec.ok) {
    ok('pg probe', false, String(exec.error));
    return Promise.resolve();
  }
  let beforeCount = 0;
  let beforeAlign = null;
  let liveUserId = null;
  const persist = require('../server/achievement-persist-service');
  persist.resetAdminClientForTests();
  const sb = sbUrl && serviceKey
    ? createClient(sbUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

  return exec
    .query(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='territory'"
    )
    .then(function (col) {
      const row = col.rows && col.rows[0];
      ok('column DEFAULT CENTRAL', row && /CENTRAL/.test(String(row.column_default || '')));
      return exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
    })
    .then(function (cnt) {
      beforeCount = cnt.rows && cnt.rows[0] && cnt.rows[0].n;
      ok('profiles row 수 기록', typeof beforeCount === 'number' && beforeCount >= 42, 'n=' + beforeCount);
      return exec.query("SELECT COUNT(*) FILTER (WHERE territory IS NOT NULL AND territory <> 'CENTRAL')::int AS n FROM public.profiles");
    })
    .then(function (other) {
      ok('4. non-NULL non-CENTRAL 덮어쓰기 없음(현재 0 또는 유지)', other.rows && other.rows[0] && other.rows[0].n === 0, 'other=' + (other.rows && other.rows[0] && other.rows[0].n));
      return exec.query('SELECT id FROM public.profiles LIMIT 1');
    })
    .then(function (one) {
      const id = one.rows && one.rows[0] && one.rows[0].id;
      function expectRejected(sql, params, label) {
        return exec
          .withTransaction(function (tx) {
            return tx.query(sql, params);
          })
          .then(function () {
            ok(label, false, 'accepted');
          })
          .catch(function (e) {
            const msg = String(e && e.message ? e.message : e);
            ok(label, /profiles_territory_earth_membership_chk|check constraint/i.test(msg), msg.slice(0, 160));
          });
      }
      return expectRejected("UPDATE public.profiles SET territory = 'ALIEN' WHERE id = $1", [id], '12. ALIEN UPDATE 거부').then(function () {
        return expectRejected("UPDATE public.profiles SET territory = 'KANTAPBIYA' WHERE id = $1", [id], 'KANTAPBIYA UPDATE 거부');
      });
    })
    .then(function () {
      if (!sb) {
        ok('1. 신규 회원 CENTRAL skipped', false, 'no service role');
        return;
      }
      return alignmentSum(sb).then(function (sum) {
        beforeAlign = sum;
        return sb.auth.admin.createUser({
          email: 'terr-central-' + Date.now() + '@example.com',
          email_confirm: true,
          user_metadata: { test: 'canonical-central-start' },
        });
      }).then(function (created) {
        liveUserId = created.data && created.data.user && created.data.user.id;
        if (!liveUserId) throw created.error || new Error('createUser failed');
        function waitProfile(n) {
          return sb.from('profiles').select('id,territory').eq('id', liveUserId).maybeSingle().then(function (r) {
            if (r.data && r.data.id) return r.data;
            if (n <= 0) throw new Error('PROFILE_NOT_READY');
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(waitProfile(n - 1));
              }, 200);
            });
          });
        }
        return waitProfile(12);
      }).then(function (row) {
        ok('1. 신규 일반 회원 territory CENTRAL', row.territory === 'CENTRAL', String(row.territory));
        return sb.from('user_alignment_state').select('score,previous_signal').eq('user_id', liveUserId).maybeSingle();
      }).then(function (st) {
        const has = st.data && st.data.score != null;
        ok(
          '2. 신규 회원 score 기본 0 또는 state 미생성',
          !has || (Number(st.data.score) === 0 && Number(st.data.previous_signal) === 0)
        );
        return alignmentSum(sb);
      }).then(function (after) {
        ok(
          '14. score/previous_signal 불변',
          after.score === beforeAlign.score && after.signal === beforeAlign.signal,
          'before=' + beforeAlign.score + '/' + beforeAlign.signal + ' after=' + after.score + '/' + after.signal
        );
      });
    })
    .then(function () {
      if (liveUserId && sb) {
        return sb.auth.admin.deleteUser(liveUserId).catch(function () {});
      }
    })
    .then(function () {
      return exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
    })
    .then(function (after) {
      const n = after.rows && after.rows[0] && after.rows[0].n;
      ok('profiles row 수 유지(±1 테스트유저 정리)', Math.abs(n - beforeCount) <= 1, 'before=' + beforeCount + ' after=' + n);
      return exec.end();
    })
    .catch(function (e) {
      ok('live central start', false, String(e && e.message ? e.message : e).slice(0, 220));
      return exec.end();
    })
    .then(function () {
      if (sb) teardown.closeSupabaseClient(sb);
    });
}

function regressions() {
  if (process.env.SC_TERRITORY_FOUNDATION_UNIT_ONLY === '1') return Promise.resolve();
  section('board/XP/fame/achievement 회귀');
  try {
    runChild('test-board-core-system.js', 'failed: 0', 180000);
    ok('board-core', true);
  } catch (e) {
    ok('board-core', false, String(e.message || e).slice(0, 220));
  }
  try {
    runChild('test-progression-xp-earning.js', 'PASS', 180000);
    ok('XP earning', true);
  } catch (e) {
    ok('XP earning', false, String(e.message || e).slice(0, 220));
  }
  try {
    runChild('test-profileframe-fame-canonical.js', 'PASS', 180000);
    ok('fame canonical', true);
  } catch (e) {
    ok('fame canonical', false, String(e.message || e).slice(0, 220));
  }
  try {
    runChild('test-achievement-persist.js', 'PASS', 180000);
    ok('achievement persist', true);
  } catch (e) {
    ok('achievement persist', false, String(e.message || e).slice(0, 220));
  }

  section('political 회귀');
  try {
    runChild('test-political-reaction-input.js', 'PASS', 180000);
    ok('political input', true);
  } catch (e) {
    ok('political input', false, String(e.message || e).slice(0, 220));
  }
  try {
    runChild('test-political-alignment-simulation.js', 'PASS', 180000);
    ok('political simulation', true);
  } catch (e) {
    ok('political simulation', false, String(e.message || e).slice(0, 220));
  }
  try {
    runChild('test-political-alignment-persist.js', 'PASS', 180000);
    ok('political persist', true);
  } catch (e) {
    ok('political persist', false, String(e.message || e).slice(0, 220));
  }
  try {
    runChild('test-political-alignment-scheduler.js', 'PASS', 180000);
    ok('political scheduler', true);
  } catch (e) {
    ok('political scheduler', false, String(e.message || e).slice(0, 220));
  }

  section('auth 회귀');
  try {
    runChild('test-activity-name-onboarding.js', 'PASS', 60000);
    ok('activity-name onboarding', true);
  } catch (e) {
    ok('activity-name onboarding', false, String(e.message || e).slice(0, 220));
  }
  try {
    runChild('test-handle-new-user-emailless.js', 'PASS', 60000);
    ok('handle_new_user emailless', true);
  } catch (e) {
    ok('handle_new_user emailless', false, String(e.message || e).slice(0, 220));
  }
  return Promise.resolve();
}

section('live DB');
liveSchemaAndRows()
  .then(liveConstraintAndNewUser)
  .then(regressions)
  .then(function () {
    console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
    return teardown.finishTest(fail);
  })
  .catch(function (e) {
    ok('async', false, String(e && e.message ? e.message : e));
    console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
    return teardown.finishTest(fail || 1);
  });
