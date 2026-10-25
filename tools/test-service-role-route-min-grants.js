#!/usr/bin/env node
'use strict';

/**
 * Static gates for the dev service_role minimum grant migration.
 * Does not connect to a database and does not print secrets.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const tool = require('./apply-service-role-route-min-grants');
const catalog = require('../shared/production-public-migration-core');

const SQL_PATH = path.join(__dirname, '..', 'supabase', 'migration_service_role_route_min_grants_v1.sql');
const TOOL_PATH = path.join(__dirname, 'apply-service-role-route-min-grants.js');
const sql = fs.readFileSync(SQL_PATH, 'utf8');
const toolSrc = fs.readFileSync(TOOL_PATH, 'utf8');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

const grantLines = sql
  .split('\n')
  .map(function (line) {
    return line.trim();
  })
  .filter(function (line) {
    return /^GRANT\b/i.test(line);
  });

ok('1. GRANT 문은 9개', grantLines.length === 9);
ok('2. GRANT ALL 없음', tool.assertSqlSafe(sql) === '' && !/\bGRANT\s+ALL\b/i.test(sql));
ok('3. schema 일괄 GRANT 없음', !/\bON\s+SCHEMA\b/i.test(sql));
ok('4. RLS policy 변경 없음', !/\b(CREATE|ALTER|DROP)\s+POLICY\b/i.test(sql));
ok('5. RLS on/off 변경 없음', !/\bROW\s+LEVEL\s+SECURITY\b/i.test(sql));
ok('6. destructive SQL 없음', !/\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b/i.test(sql));
ok(
  '7. board_posts SELECT INSERT UPDATE',
  /GRANT SELECT, INSERT, UPDATE ON TABLE public\.board_posts TO service_role;/.test(sql),
);
ok(
  '8. board_comments SELECT UPDATE',
  /GRANT SELECT, UPDATE ON TABLE public\.board_comments TO service_role;/.test(sql),
);
ok('9. board_reactions SELECT', /GRANT SELECT ON TABLE public\.board_reactions TO service_role;/.test(sql));
ok(
  '10. board_reports SELECT UPDATE',
  /GRANT SELECT, UPDATE ON TABLE public\.board_reports TO service_role;/.test(sql),
);
ok('11. profiles SELECT', /GRANT SELECT ON TABLE public\.profiles TO service_role;/.test(sql));
ok(
  '12. profiles column UPDATE 4개',
  /GRANT UPDATE \(\s*signup_completed_at,\s*first_visit_guide_eligible_at,\s*first_visit_guide_completed_at,\s*central_plaza_hint_seen_at\s*\) ON TABLE public\.profiles TO service_role;/.test(
    sql,
  ),
);
ok('13. profiles territory UPDATE 없음', !/UPDATE\s*\([^)]*territory/.test(sql));
ok(
  '14. alignment SELECT DELETE',
  /GRANT SELECT, DELETE ON TABLE public\.user_alignment_state TO service_role;/.test(sql) &&
    /GRANT SELECT, DELETE ON TABLE public\.alignment_history TO service_role;/.test(sql) &&
    /GRANT SELECT, DELETE ON TABLE public\.alignment_territory_history TO service_role;/.test(sql),
);
ok('15. anon/authenticated/PUBLIC 추가 GRANT 없음', !/\bTO\s+(anon|authenticated|PUBLIC)\b/.test(sql));
ok(
  '16. production REQUIRED catalog 밖',
  !catalog.REQUIRED.some(function (entry) {
    return entry.fileName === 'migration_service_role_route_min_grants_v1.sql';
  }) &&
    !catalog.DAILY_ISSUE_REQUIRED.some(function (entry) {
      return entry.fileName === 'migration_service_role_route_min_grants_v1.sql';
    }),
);
ok('17. apply tool confirm-dev-db', /--confirm-dev-db/.test(toolSrc));
ok('18. apply tool production 거부', /PRODUCTION_REFUSED/.test(toolSrc));
ok(
  '19. dev ref only',
  tool.EXPECTED_REF === 'wzpreuseuiuzwpoqqckr' &&
    tool.FORBIDDEN_REFS.indexOf('vmpdddcdnxeavchgivcd') !== -1 &&
    tool.FORBIDDEN_REFS.indexOf('rlzltrwwamrgrfwlaqxj') !== -1,
);
function apiUrl(ref) {
  return 'https://' + ref + '.supabase.co';
}
function dbUrl(ref) {
  return 'postgresql://postgres.' + ref + ':pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
}

ok(
  '20. ref gate',
  tool.assertDevTarget(dbUrl(tool.EXPECTED_REF), apiUrl(tool.EXPECTED_REF)) === '' &&
    tool.assertDevTarget(dbUrl(tool.FORBIDDEN_REFS[0]), apiUrl(tool.EXPECTED_REF)) === 'FORBIDDEN_PROJECT_REF' &&
    tool.assertDevTarget(dbUrl(tool.EXPECTED_REF), apiUrl(tool.FORBIDDEN_REFS[1])) === 'FORBIDDEN_PROJECT_REF' &&
    tool.assertDevTarget(dbUrl('aaaaaaaaaaaaaaaaaaaa'), apiUrl(tool.EXPECTED_REF)) === 'DATABASE_REF_MISMATCH',
);

function runTool(extraEnv, args) {
  return spawnSync(process.execPath, [TOOL_PATH].concat(args || []), {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: Object.assign({}, process.env, extraEnv || {}),
  });
}

const secret = 'super-secret-do-not-print';
const noConfirm = runTool({}, []);
ok('21. confirm 없으면 거부', noConfirm.status === 1 && /CONFIRM_REQUIRED/.test(noConfirm.stderr));
ok('22. confirm 거부 출력에 secret 없음', (noConfirm.stdout + noConfirm.stderr).indexOf(secret) < 0);

const production = runTool(
  {
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://example.test',
    DAILY_ISSUE_DATABASE_URL: 'postgresql://postgres.example:' + secret + '@127.0.0.1:5432/postgres',
  },
  ['--confirm-dev-db'],
);
ok('23. production 거부', production.status === 1 && /PRODUCTION_REFUSED/.test(production.stderr));
ok('24. production 거부 출력에 secret 없음', (production.stdout + production.stderr).indexOf(secret) < 0);

const forbidden = runTool(
  {
    NODE_ENV: 'development',
    SUPABASE_URL: apiUrl(tool.FORBIDDEN_REFS[0]),
    DAILY_ISSUE_DATABASE_URL: dbUrl(tool.FORBIDDEN_REFS[0]).replace(':pw@', ':' + secret + '@'),
  },
  ['--confirm-dev-db'],
);
ok('25. 다른 ref 거부', forbidden.status === 1 && /FORBIDDEN_PROJECT_REF/.test(forbidden.stderr));
ok('26. 다른 ref 거부 출력에 secret 없음', (forbidden.stdout + forbidden.stderr).indexOf(secret) < 0);
ok('27. 다른 ref 거부 출력에 URL 없음', (forbidden.stdout + forbidden.stderr).indexOf('postgresql://') < 0);

console.log('OK', passed);
