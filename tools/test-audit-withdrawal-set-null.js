#!/usr/bin/env node
'use strict';

/**
 * Static gates for the withdrawal audit SET NULL trigger fix.
 * Does not connect to a database and does not print secrets.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const tool = require('./apply-audit-withdrawal-set-null');
const catalog = require('../shared/production-public-migration-core');

const SQL_PATH = path.join(__dirname, '..', 'supabase', 'migration_audit_withdrawal_set_null_v1.sql');
const TOOL_PATH = path.join(__dirname, 'apply-audit-withdrawal-set-null.js');
const sql = fs.readFileSync(SQL_PATH, 'utf8');
const toolSrc = fs.readFileSync(TOOL_PATH, 'utf8');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

ok('1. GRANT 없음', tool.assertSqlSafe(sql) === '' && !/\bGRANT\b/i.test(sql));
ok('2. RLS policy 변경 없음', !/\b(CREATE|ALTER|DROP)\s+POLICY\b/i.test(sql));
ok('3. destructive SQL 없음', !/\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b/i.test(sql));
ok('4. audit content update 는 여전히 거부', /RAISE EXCEPTION 'ADMIN_AUDIT_APPEND_ONLY'/.test(sql));
ok('5. purge GUC 유지', /app\.allow_admin_audit_purge/.test(sql));
ok('6. user reference NULL 만 허용', /actor_user_id/.test(sql) && /target_user_id/.test(sql) && /IS NULL/.test(sql));
ok('7. legal_hold DELETE 는 여전히 거부', /RAISE EXCEPTION 'LEGAL_HOLD_EVENT_APPEND_ONLY'/.test(sql));
ok('8. retention 기간 변경 없음', !/interval/i.test(sql) && !/1 year/i.test(sql));
ok(
  '9. production REQUIRED catalog 밖',
  !catalog.REQUIRED.some(function (entry) {
    return entry.fileName === 'migration_audit_withdrawal_set_null_v1.sql';
  }) &&
    !catalog.DAILY_ISSUE_REQUIRED.some(function (entry) {
      return entry.fileName === 'migration_audit_withdrawal_set_null_v1.sql';
    }),
);
ok('10. apply tool confirm-dev-db', /--confirm-dev-db/.test(toolSrc));
ok('11. apply tool production 거부', /PRODUCTION_REFUSED/.test(toolSrc));
ok(
  '12. dev ref only',
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
  '13. ref gate',
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
ok('14. confirm 없으면 거부', noConfirm.status === 1 && /CONFIRM_REQUIRED/.test(noConfirm.stderr));
ok('15. confirm 거부 출력에 secret 없음', (noConfirm.stdout + noConfirm.stderr).indexOf(secret) < 0);

const production = runTool(
  {
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://example.test',
    DAILY_ISSUE_DATABASE_URL: 'postgresql://postgres.example:' + secret + '@127.0.0.1:5432/postgres',
  },
  ['--confirm-dev-db'],
);
ok('16. production 거부', production.status === 1 && /PRODUCTION_REFUSED/.test(production.stderr));
ok('17. production 거부 출력에 secret 없음', (production.stdout + production.stderr).indexOf(secret) < 0);

const forbidden = runTool(
  {
    NODE_ENV: 'development',
    SUPABASE_URL: apiUrl(tool.FORBIDDEN_REFS[0]),
    DAILY_ISSUE_DATABASE_URL: dbUrl(tool.FORBIDDEN_REFS[0]).replace(':pw@', ':' + secret + '@'),
  },
  ['--confirm-dev-db'],
);
ok('18. 다른 ref 거부', forbidden.status === 1 && /FORBIDDEN_PROJECT_REF/.test(forbidden.stderr));
ok('19. 다른 ref 거부 출력에 secret 없음', (forbidden.stdout + forbidden.stderr).indexOf(secret) < 0);
ok('20. 다른 ref 거부 출력에 URL 없음', (forbidden.stdout + forbidden.stderr).indexOf('postgresql://') < 0);

console.log('OK', passed);
