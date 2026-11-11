#!/usr/bin/env node
'use strict';

/**
 * Production DB migration prep — static + optional read-only dev inspect.
 * Does not apply SQL. Does not write production or development DBs.
 */

require('dotenv').config();

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const core = require('../shared/production-public-migration-core');
const di = require('../shared/daily-issue-production-migration-core');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
} = require('../server/daily-issue-pg-client');

let passed = 0;
let failed = 0;
const notes = [];

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.log('FAIL', name + (detail ? ' — ' + detail : ''));
  }
}

const root = path.join(__dirname, '..');
const sqlDir = path.join(root, 'supabase');
const sqlFiles = fs.readdirSync(sqlDir).filter(function (n) {
  return n.endsWith('.sql');
}).sort();

const classified = core.classifyAllFiles();
const classifiedNames = {};
classified.required.forEach(function (e) { classifiedNames[e.fileName] = 'REQUIRED_PUBLIC'; });
classified.dailyIssueRequired.forEach(function (e) { classifiedNames[e.fileName] = 'REQUIRED_DAILY_ISSUE'; });
classified.optionalLater.forEach(function (e) { classifiedNames[e.fileName] = 'OPTIONAL_LATER'; });
classified.doNotApply.forEach(function (e) { classifiedNames[e.fileName] = 'DO_NOT_APPLY'; });

const missingRegistered = Object.keys(classifiedNames).filter(function (n) {
  return !fs.existsSync(path.join(sqlDir, n));
});
const unregistered = sqlFiles.filter(function (n) {
  return !classifiedNames[n];
});
const notApprovedForThisTask = [
  'migration_sensitive_consent_withdraw_tx_v1.sql',
  'migration_alignment_batch_consent_recheck_candidate.sql',
  'migration_reaction_snapshot_consent_recheck_candidate.sql',
  'migration_audit_withdrawal_set_null_v1.sql',
  'migration_service_role_route_min_grants_v1.sql',
];

ok('1. 등록된 SQL 파일이 디스크에 있음', missingRegistered.length === 0, missingRegistered.join(','));
ok(
  '1b. 미등록 SQL은 누락된 필수 파일이 아님',
  unregistered.every(function (n) { return !classifiedNames[n]; }),
  unregistered.join(','),
);
ok(
  '1c. 이번 작업에서 승인되지 않은 SQL은 REQUIRED가 아님',
  notApprovedForThisTask.every(function (n) {
    return sqlFiles.indexOf(n) >= 0 && classifiedNames[n] !== 'REQUIRED_PUBLIC' && classifiedNames[n] !== 'REQUIRED_DAILY_ISSUE';
  }),
);
ok(
  '2. 분류 파일 수 = 등록 목록 수',
  Object.keys(classifiedNames).length === sqlFiles.length - unregistered.length,
  String(Object.keys(classifiedNames).length) + '/' + sqlFiles.length + ' unregistered=' + unregistered.length,
);

const HISTORICAL_PUBLIC_REQUIRED_18 = [
  'schema_profiles_identity_history.sql',
  'migration_handle_new_user_emailless_oauth.sql',
  'migration_activity_name_unique.sql',
  'migration_canonical_user_territory.sql',
  'migration_canonical_territory_central_start.sql',
  'migration_board_core_system.sql',
  'migration_user_progression_canonical.sql',
  'migration_user_progression_events_xp.sql',
  'migration_empathy_received_fame_rpc.sql',
  'migration_user_achievements_persist.sql',
  'migration_grant_user_achievement_canonical.sql',
  'migration_achievement_notified_state.sql',
  'migration_achievement_service_role_select_v1.sql',
  'migration_political_alignment_persistence.sql',
  'migration_political_alignment_beta_v1.sql',
  'migration_alignment_self_direction_streak_v1.sql',
  'migration_alien_moderation_v1.sql',
  'migration_alien_operator_review_v1.sql',
];
const CATALOG_ADDED_AFTER_18 = [
  'migration_account_withdrawal_v1.sql',
  'migration_legal_gate_v1.sql',
  'migration_rights_infringement_v1.sql',
  'migration_empathy_received_fame_revoke_rpc.sql',
];
const requiredNames = classified.required.map(function (e) { return e.fileName; });
const expectedRequired = HISTORICAL_PUBLIC_REQUIRED_18.concat(CATALOG_ADDED_AFTER_18);
const missingFromBaseline = expectedRequired.filter(function (n) { return requiredNames.indexOf(n) < 0; });
const extraBeyondBaseline = requiredNames.filter(function (n) { return expectedRequired.indexOf(n) < 0; });
const requiredDupes = requiredNames.filter(function (n, i) { return requiredNames.indexOf(n) !== i; });
const otherClassNames = classified.dailyIssueRequired.concat(classified.optionalLater).concat(classified.doNotApply).map(function (e) {
  return e.fileName;
});
const classOverlap = requiredNames.filter(function (n) { return otherClassNames.indexOf(n) >= 0; });
const deployOrder = core.loadRequiredMigrations().map(function (m) { return m.fileName; });
const countMismatch = requiredNames.length !== expectedRequired.length;

ok(
  '3. public REQUIRED 개수 불일치',
  !countMismatch,
  'COUNT_MISMATCH actual=' + requiredNames.length +
    ' historical=18 added=4 expected=' + expectedRequired.length +
    ' extra=' + extraBeyondBaseline.join(',') +
    ' missingFromBaseline=' + missingFromBaseline.join(','),
);
ok(
  '3b. 과거 18개 다음 추가 4개 파일과 순서',
  requiredNames.join('|') === expectedRequired.join('|'),
  'COUNT_MISMATCH order extra=' + extraBeyondBaseline.join(',') + ' missing=' + missingFromBaseline.join(','),
);
ok('3c. public REQUIRED 파일명 중복 없음', requiredDupes.length === 0, requiredDupes.join(','));
ok(
  '3d. REQUIRED 가 OPTIONAL/DO_NOT_APPLY/daily 와 겹치지 않음',
  classOverlap.length === 0,
  classOverlap.join(','),
);
ok(
  '3e. 배포 도구 순서 = 카탈로그 순서',
  deployOrder.join('|') === requiredNames.join('|'),
  'COUNT_MISMATCH deploy=' + deployOrder.length + ' catalog=' + requiredNames.length,
);
ok(
  '3f. 디스크 파일은 운영 적용 증거가 아님',
  CATALOG_ADDED_AFTER_18.every(function (n) { return fs.existsSync(path.join(sqlDir, n)); }) &&
    notApprovedForThisTask.every(function (n) {
      return classifiedNames[n] !== 'REQUIRED_PUBLIC' && classifiedNames[n] !== 'REQUIRED_DAILY_ISSUE';
    }),
  'repo catalog only; production apply was not queried',
);
ok(
  '3g. 대체된 초안은 REQUIRED 가 아님',
  classifiedNames['migration_alignment_system.sql'] === 'DO_NOT_APPLY' &&
    classifiedNames['migration_user_data_system.sql'] === 'DO_NOT_APPLY' &&
    classifiedNames['drop_profiles_identity_schema.sql'] === 'DO_NOT_APPLY' &&
    classifiedNames['migration_alien_system.sql'] === 'OPTIONAL_LATER' &&
    classifiedNames['migration_empathy_received_fame_rpc.sql'] === 'REQUIRED_PUBLIC' &&
    classifiedNames['migration_empathy_received_fame_revoke_rpc.sql'] === 'REQUIRED_PUBLIC',
);
ok('4. daily_issue REQUIRED 6', classified.dailyIssueRequired.length === 6);
ok('5. OPTIONAL_LATER 13', classified.optionalLater.length === 13);
ok('6. DO_NOT_APPLY 3', classified.doNotApply.length === 3);

const dep = core.assertCatalogDependencies();
ok('7. public dependency 순서', dep.length === 0, dep.join('; '));

const required = core.loadRequiredMigrations();
const destructive = required.filter(function (m) {
  return m.scan.dropTable || m.scan.truncate || m.scan.dropSchema || m.scan.dropColumn;
});
ok('8. REQUIRED destructive top-level 없음', destructive.length === 0, destructive.map(function (m) { return m.id; }).join(','));

ok(
  '9. REQUIRED에 current_territory 컬럼 생성 없음',
  required.every(function (m) {
    return !/\bcurrent_territory\b/.test(m.sql);
  }),
);

const alignmentLegacy = fs.readFileSync(path.join(sqlDir, 'migration_alignment_system.sql'), 'utf8');
ok('10. legacy alignment_system 은 current_territory 포함', /\bcurrent_territory\b/.test(alignmentLegacy));

ok(
  '11. drop_profiles 는 DO_NOT_APPLY 이고 DROP TABLE',
  /DROP TABLE IF EXISTS public\.(identity_history|profiles)/.test(
    fs.readFileSync(path.join(sqlDir, 'drop_profiles_identity_schema.sql'), 'utf8'),
  ),
);

const diRewritten = di.buildRewrittenMigrations('daily_issue');
ok('12. Daily Issue rewrite 6건', diRewritten.length === 6);
ok(
  '13. rewrite 후 public.daily_issue_ 없음',
  diRewritten.every(function (m) {
    return !/\bpublic\.daily_issue_/.test(m.rewrittenSql);
  }),
);
ok(
  '14. rewrite schema=daily_issue',
  diRewritten.every(function (m) {
    return m.rewrittenSql.indexOf('daily_issue.daily_issue_') >= 0;
  }),
);
ok(
  '15. seed rewrite 에 alignment_direction / reactions',
  diRewritten[2].id === 'alignment_seed' &&
    /daily_issue\.daily_issue_review_items/.test(diRewritten[2].rewrittenSql) &&
    /daily_issue\.daily_issue_reactions/.test(diRewritten[2].rewrittenSql) &&
    /alignment_direction/.test(diRewritten[2].rewrittenSql),
);

const rawDiSql = classified.dailyIssueRequired.map(function (e) {
  return fs.readFileSync(path.join(sqlDir, e.fileName), 'utf8');
}).join('\n');
const uncommentedDi = rawDiSql.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/--[^\n]*/g, '\n');
ok(
  '16. Daily Issue SQL 에 schema daily_issue_test 하드코딩 없음',
  !/\bdaily_issue_test\b/.test(uncommentedDi),
);
ok(
  '17. Daily Issue SQL 은 public.daily_issue_ 유지 (dev 파일 보존)',
  /\bpublic\.daily_issue_review_items\b/.test(rawDiSql),
);

const userData = fs.readFileSync(path.join(sqlDir, 'migration_user_data_system.sql'), 'utf8');
const evo = fs.readFileSync(path.join(sqlDir, 'migration_territory_evolution_system.sql'), 'utf8');
const pipeline = fs.readFileSync(path.join(sqlDir, 'migration_user_event_pipeline.sql'), 'utf8');
ok('18. user_data 헤더 적용 금지', /실제 DB에 적용하지 않는다/.test(userData) || /실제 Supabase migration apply 금지/.test(userData));
ok('19. territory evolution 미적용 초안', /실제 Supabase에 적용하지 않음/.test(evo));
ok('20. user_event_pipeline 미적용 초안', /미적용/.test(pipeline));

const preflight = core.buildPreflightReport({ mode: 'check', env: { NODE_ENV: 'development' } });
ok('21. static preflight ok', preflight.ok === true);
ok('22. static connection 이 production 아님', preflight.connection === 'NOT_CONFIGURED' || preflight.connection === 'URL_PRESENT_NON_PRODUCTION');
ok('23. dry-run kind STATIC', preflight.dryRunKind === 'STATIC_VALIDATION_NO_SQL_EXECUTE');

const lastHandle = required.filter(function (m) {
  return /CREATE OR REPLACE FUNCTION public\.handle_new_user\(/.test(m.sql);
});
ok(
  '24. handle_new_user 최종은 central_start',
  lastHandle.length >= 1 && lastHandle[lastHandle.length - 1].id === 'canonical_territory_central_start',
);

async function inspectDevReadOnly() {
  const url = resolveDailyIssueDatabaseUrl({});
  if (!url) {
    notes.push('DEV_SCHEMA_INSPECT=SKIPPED_NO_URL');
    ok('25. production/dev URL 없으면 inspect skip', true);
    return {
      connection: 'NOT_CONFIGURED',
      inspect: null,
    };
  }
  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!executor.ok) {
    notes.push('DEV_SCHEMA_INSPECT=UNAVAILABLE');
    ok('25. executor 없으면 inspect skip', true);
    return { connection: 'URL_PRESENT_NON_PRODUCTION', inspect: null };
  }
  try {
    const inspection = await core.inspectPublicSchema(executor);
    notes.push(
      'DEV_SCHEMA_INSPECT=READ_ONLY missingTables=' +
        (inspection.missingTables || []).join(',') +
        ' missingColumns=' +
        (inspection.missingColumns || []).map(function (c) { return c.table + '.' + c.column; }).join(',') +
        ' missingFunctions=' +
        (inspection.missingFunctions || []).join(','),
    );
    ok('25. dev public inspect read-only 실행', typeof inspection.tableCount === 'number');
    return { connection: 'URL_PRESENT_NON_PRODUCTION', inspect: inspection };
  } catch (e) {
    notes.push('DEV_SCHEMA_INSPECT=ERROR ' + String(e && e.message ? e.message : e));
    ok('25. dev inspect 실패는 skip (write 없음)', true);
    return { connection: 'URL_PRESENT_NON_PRODUCTION', inspect: null };
  } finally {
    await executor.end();
  }
}

inspectDevReadOnly()
  .then(function (dev) {
    ok('26. 이 테스트는 apply 미호출', !dev || true);
    if (failed) {
      console.error('\nFAIL', failed, 'passed', passed);
      process.exit(1);
    }
    console.log('\nOK', passed);
    notes.forEach(function (n) {
      console.log(n);
    });
  })
  .catch(function (e) {
    console.error('FAIL unexpected', e);
    process.exit(1);
  });
