'use strict';
/**
 * Canonical Earth membership territory foundation
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

const sql = read('supabase/migration_canonical_user_territory.sql');
const sqlBody = sql.replace(/--[^\n]*/g, '');
const svcSrc = read('server/canonical-user-territory-service.js');
const coreSrc = read('shared/canonical-user-territory-core.js');
const adapterSrc = read('server/board-user-context-adapter.js');
const persistSrc = read('server/political-alignment-persist-service.js');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

section('정책 · schema 텍스트');
ok('1. PIONEER valid', core.normalizeCanonicalMembershipTerritory('PIONEER').ok === true && core.normalizeCanonicalMembershipTerritory('PIONEER').territory === 'PIONEER');
ok('2. CENTRAL valid', core.normalizeCanonicalMembershipTerritory('CENTRAL').territory === 'CENTRAL');
ok('3. GUARDIAN valid', core.normalizeCanonicalMembershipTerritory('GUARDIAN').territory === 'GUARDIAN');
ok('4. ALIEN reject', core.normalizeCanonicalMembershipTerritory('ALIEN').ok === false && core.normalizeCanonicalMembershipTerritory('ALIEN').error === 'TERRITORY_MEMBERSHIP_ALIEN_FORBIDDEN');
ok('5. KANTAPBIYA reject', core.normalizeCanonicalMembershipTerritory('KANTAPBIYA').ok === false);
ok('6. unknown reject', core.normalizeCanonicalMembershipTerritory('COMMON').ok === false);
ok('7. null 허용', core.normalizeCanonicalMembershipTerritory(null).ok === true && core.normalizeCanonicalMembershipTerritory(null).territory === null);
ok('empty string → null', core.normalizeCanonicalMembershipTerritory('').territory === null);
ok('source profiles.territory', core.CURRENT_TERRITORY_CANONICAL_SOURCE === 'profiles.territory');
ok('TERRITORY_MOVE NOT_CONNECTED', core.TERRITORY_MOVE === 'NOT_CONNECTED' && svc.TERRITORY_MOVE === 'NOT_CONNECTED');
ok('SELECTION_UI NOT_CONNECTED', core.TERRITORY_SELECTION_UI === 'NOT_CONNECTED');
ok('HISTORY NOT_CONNECTED', core.TERRITORY_HISTORY === 'NOT_CONNECTED');

section('migration 안전');
ok('8. DROP TABLE 없음', !/\bDROP TABLE\b/i.test(sqlBody));
ok('TRUNCATE 없음', !/\bTRUNCATE\b/i.test(sqlBody));
ok('DELETE FROM 없음', !/\bDELETE FROM\b/i.test(sqlBody));
ok('기존 row UPDATE 없음', !/\bUPDATE\s+public\.profiles\b/i.test(sqlBody));
ok('9. DEFAULT CENTRAL 없음', !/DEFAULT\s+'CENTRAL'/i.test(sqlBody) && !/SET\s+territory\s*=\s*'CENTRAL'/i.test(sqlBody));
ok('nullable column', /ADD COLUMN IF NOT EXISTS territory text NULL/i.test(sql));
ok('CHECK Earth only', /PIONEER',\s*'CENTRAL',\s*'GUARDIAN'/.test(sql) && !/IN\s*\([^)]*ALIEN/.test(sqlBody));
ok('client write 금지 트리거', /PROFILES_TERRITORY_CLIENT_WRITE_FORBIDDEN/.test(sql));

section('helper · 미연결');
ok('10. persist score 경로 미변경 표시', /TERRITORY_MOVE: 'NOT_CONNECTED'/.test(persistSrc));
ok('11. transition 호출 없음', !/evaluateTerritoryTransition/.test(svcSrc) && !/evaluateTerritoryTransition/.test(coreSrc));
ok('12. localStorage 미사용', !/localStorage/.test(coreSrc) && /No localStorage/.test(svcSrc) && !/localStorage\.(get|set)Item/.test(svcSrc));
ok('board adapter 아직 구 chain 유지', /current_territory/.test(adapterSrc) && /metadata/.test(adapterSrc) && /CENTRAL fallback/.test(adapterSrc) || /TERRITORY\.CENTRAL/.test(adapterSrc));
ok('board adapter 연결 지점만 명시', boardAdapter.MEMBERSHIP_TERRITORY_CANONICAL_SOURCE === 'profiles.territory');
ok('public write route 없음', !/canonical-user-territory/.test(read('server.js')));
ok('auth/app-entry 미수정', !/(^|\n)(public\/app-entry\.js|public\/auth-v2\/)/.test(authDiff));

function liveSchemaAndRows() {
  const persist = require('../server/achievement-persist-service');
  const sb = persist.getAdminClient();
  return Promise.all([
    sb.from('profiles').select('id,territory', { count: 'exact' }),
    sb.from('user_alignment_state').select('score,previous_signal', { count: 'exact' }),
  ]).then(function (pair) {
    const profiles = pair[0];
    const align = pair[1];
    if (profiles.error) throw profiles.error;
    if (align.error) throw align.error;
    const terr = (profiles.data || []).map(function (r) { return r.territory; });
    const nonNull = terr.filter(function (t) { return t != null; });
    const scores = (align.data || []).map(function (r) { return Number(r.score); });
    const signals = (align.data || []).map(function (r) { return Number(r.previous_signal); });
    ok('live profiles.territory 조회 가능', true);
    ok('기존 profile 유지(42 이상)', (profiles.count || 0) >= 42, 'count=' + profiles.count);
    ok('기존 회원 territory 전부 NULL', nonNull.length === 0, 'nonNull=' + nonNull.length);
    ok('alignment score 합 0 유지', scores.reduce(function (a, b) { return a + b; }, 0) === 0);
    ok('previous_signal 합 0 유지', signals.reduce(function (a, b) { return a + b; }, 0) === 0);
    const sampleId = profiles.data && profiles.data[0] && profiles.data[0].id;
    if (!sampleId) {
      ok('getCanonicalUserTerritory live', false, 'no profile');
      return;
    }
    return svc.getCanonicalUserTerritory(sampleId).then(function (got) {
      ok(
        'getCanonicalUserTerritory null',
        got.territory === null && got.source === 'profiles.territory' && got.available === false
      );
    });
  });
}

function liveConstraintCheck() {
  const {
    createDailyIssuePgExecutor,
    resolveDailyIssueDatabaseUrl,
  } = require('../server/daily-issue-pg-client');
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  if (!url) {
    ok('pg constraint probe skipped', false, 'DATABASE_UNAVAILABLE');
    return Promise.resolve();
  }
  const exec = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!exec.ok) {
    ok('pg constraint probe', false, String(exec.error));
    return Promise.resolve();
  }
  return exec
    .query(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='territory'"
    )
    .then(function (col) {
      const row = col.rows && col.rows[0];
      ok('column nullable YES', row && row.is_nullable === 'YES');
      ok('column_default 없음', row && (row.column_default == null || row.column_default === ''));
      return exec.query(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='profiles_territory_earth_membership_chk'"
      );
    })
    .then(function (chk) {
      const def = String((chk.rows && chk.rows[0] && chk.rows[0].def) || '');
      ok('CHECK includes PIONEER CENTRAL GUARDIAN', /PIONEER/.test(def) && /CENTRAL/.test(def) && /GUARDIAN/.test(def));
      ok('CHECK excludes ALIEN allow-list', !/ALIEN/.test(def));
      return exec.query('SELECT id FROM public.profiles LIMIT 1');
    })
    .then(function (one) {
      const id = one.rows && one.rows[0] && one.rows[0].id;
      if (!id) {
        ok('CHECK reject ALIEN via rollback', false, 'no profile id');
        return;
      }
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
      return expectRejected("UPDATE public.profiles SET territory = 'ALIEN' WHERE id = $1", [id], 'ALIEN UPDATE 거부').then(function () {
        return expectRejected(
          "UPDATE public.profiles SET territory = 'KANTAPBIYA' WHERE id = $1",
          [id],
          'KANTAPBIYA UPDATE 거부'
        );
      }).then(function () {
        return exec.query('SELECT COUNT(territory)::int AS n FROM public.profiles');
      }).then(function (after) {
        ok('constraint probe 후 territory 여전히 전부 NULL', after.rows && after.rows[0] && after.rows[0].n === 0);
      });
    })
    .then(function () {
      return exec.end();
    })
    .catch(function (e) {
      ok('pg constraint probe', false, String(e && e.message ? e.message : e).slice(0, 200));
      return exec.end();
    });
}

function regressions() {
  if (process.env.SC_TERRITORY_FOUNDATION_UNIT_ONLY === '1') return Promise.resolve();
  section('13. board/XP/fame/achievement 회귀');
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

  section('14. political input/simulation/persist/scheduler 회귀');
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
  return Promise.resolve();
}

section('live DB');
liveSchemaAndRows()
  .then(liveConstraintCheck)
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
