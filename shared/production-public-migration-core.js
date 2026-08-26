'use strict';

/**
 * Production public-schema migration catalog + gates.
 * Apply is not executed by default. Confirm + NODE_ENV=production required for apply.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIRM_ENV = 'PUBLIC_SCHEMA_CONFIRM_PRODUCTION_MIGRATION';
const CONFIRM_VALUE = 'APPLY_PUBLIC_SCHEMA_PRODUCTION';

const REQUIRED = Object.freeze([
  {
    id: 'profiles_identity_history',
    fileName: 'schema_profiles_identity_history.sql',
    dependsOn: [],
    notes: 'profiles + identity_history + on_auth_user_created. Greenfield 필수.',
  },
  {
    id: 'handle_new_user_emailless',
    fileName: 'migration_handle_new_user_emailless_oauth.sql',
    dependsOn: ['profiles_identity_history'],
    notes: 'display_name 빈 문자열. central_start 이전에 실행.',
  },
  {
    id: 'activity_name_unique',
    fileName: 'migration_activity_name_unique.sql',
    dependsOn: ['handle_new_user_emailless'],
    notes: '활동명 unique. 기존 중복이 있으면 표시명 보정 UPDATE.',
  },
  {
    id: 'canonical_user_territory',
    fileName: 'migration_canonical_user_territory.sql',
    dependsOn: ['profiles_identity_history'],
    notes: 'profiles.territory Earth membership. NULL 허용 후 central_start가 DEFAULT.',
  },
  {
    id: 'canonical_territory_central_start',
    fileName: 'migration_canonical_territory_central_start.sql',
    dependsOn: ['canonical_user_territory', 'handle_new_user_emailless'],
    notes: 'NULL→CENTRAL + handle_new_user FINAL(territory CENTRAL).',
  },
  {
    id: 'board_core',
    fileName: 'migration_board_core_system.sql',
    dependsOn: ['profiles_identity_history'],
    notes: 'board_posts/comments/reactions/reports + toggle_board_reaction.',
  },
  {
    id: 'user_progression_canonical',
    fileName: 'migration_user_progression_canonical.sql',
    dependsOn: ['profiles_identity_history'],
    notes: 'user_progression ProfileFrame LEVEL.',
  },
  {
    id: 'user_progression_events_xp',
    fileName: 'migration_user_progression_events_xp.sql',
    dependsOn: ['user_progression_canonical'],
    notes: 'user_progression_events + apply_user_progression_event.',
  },
  {
    id: 'empathy_received_fame_rpc',
    fileName: 'migration_empathy_received_fame_rpc.sql',
    dependsOn: ['user_progression_events_xp'],
    notes: 'EMPATHY_RECEIVED → reputation_score. apply_user_progression_event REPLACE.',
  },
  {
    id: 'user_achievements_persist',
    fileName: 'migration_user_achievements_persist.sql',
    dependsOn: ['profiles_identity_history'],
    notes: 'user_achievements / featured.',
  },
  {
    id: 'grant_user_achievement_canonical',
    fileName: 'migration_grant_user_achievement_canonical.sql',
    dependsOn: ['user_achievements_persist'],
    notes: 'grant_user_achievement server-side sequence.',
  },
  {
    id: 'achievement_notified_state',
    fileName: 'migration_achievement_notified_state.sql',
    dependsOn: ['grant_user_achievement_canonical'],
    notes: 'acquisition_notified_at + grant FINAL. 첫 적용만 기존 row backfill.',
  },
  {
    id: 'achievement_service_role_select_v1',
    fileName: 'migration_achievement_service_role_select_v1.sql',
    dependsOn: ['achievement_notified_state'],
    notes: 'service_role SELECT on achievements + mark_user_achievement_notified 복구. progression 미변경.',
  },
  {
    id: 'political_alignment_persistence',
    fileName: 'migration_political_alignment_persistence.sql',
    dependsOn: ['profiles_identity_history'],
    notes: 'user_alignment_state.score SSOT. current_territory 컬럼 없음.',
  },
  {
    id: 'political_alignment_beta_v1',
    fileName: 'migration_political_alignment_beta_v1.sql',
    dependsOn: ['political_alignment_persistence', 'board_core'],
    notes: 'reaction score snapshot + pending territory + batch RPC/toggle REPLACE.',
  },
  {
    id: 'alien_moderation_v1',
    fileName: 'migration_alien_moderation_v1.sql',
    dependsOn: ['profiles_identity_history', 'board_core'],
    notes: 'moderation persist tables. flag OFF여도 schema 필요. 구 apply 도구는 production 거부.',
  },
  {
    id: 'alien_operator_review_v1',
    fileName: 'migration_alien_operator_review_v1.sql',
    dependsOn: ['alien_moderation_v1'],
    notes: 'return_policy OPERATOR_REVIEW (4회차 이상 30일+운영자 복귀). SEASON_END legacy 유지. Alien V1 OFF 유지.',
  },
  {
    id: 'account_withdrawal_v1',
    fileName: 'migration_account_withdrawal_v1.sql',
    dependsOn: ['board_core', 'alien_moderation_v1'],
    notes: '회원탈퇴: 공개 콘텐츠 author nullable + SET NULL, 비식별 audit, withdraw_account_anonymize.',
  },
  {
    id: 'legal_gate_v1',
    fileName: 'migration_legal_gate_v1.sql',
    dependsOn: ['profiles_identity_history'],
    notes: '만 14세 확인 결과 + 정치성향 민감정보 동의. DOB 미저장. 기존 회원 자동 동의 없음.',
  },
  {
    id: 'rights_infringement_v1',
    fileName: 'migration_rights_infringement_v1.sql',
    dependsOn: ['board_core'],
    notes: '권리침해 처리 요청 전용 테이블. board_reports와 분리. 접수는 정식 사건이 아님. 정치성향/IP 미저장.',
  },
]);

const DAILY_ISSUE_REQUIRED = Object.freeze([
  {
    id: 'daily_issue_review_lifecycle',
    fileName: 'migration_daily_issue_review_lifecycle.sql',
    schema: 'daily_issue',
    notes: 'SQL은 public.daily_issue_* . production rewriter만 schema=daily_issue 로 변환. 파일 하드코딩 변경 금지.',
  },
  {
    id: 'daily_issue_morning_scheduler',
    fileName: 'migration_daily_issue_morning_scheduler.sql',
    schema: 'daily_issue',
    notes: 'scheduler_runs. 운영 스케줄러 플래그는 별도 OFF 유지.',
  },
  {
    id: 'daily_issue_alignment_seed',
    fileName: 'migration_daily_issue_alignment_seed_v1.sql',
    schema: 'daily_issue',
    notes: 'alignment_direction + daily_issue_reactions.',
  },
  {
    id: 'daily_issue_comments',
    fileName: 'migration_daily_issue_comments_v1.sql',
    schema: 'daily_issue',
    notes: 'daily_issue_comments. public comments only.',
  },
  {
    id: 'daily_issue_account_withdrawal',
    fileName: 'migration_daily_issue_account_withdrawal_v1.sql',
    schema: 'daily_issue',
    notes: 'comments.user_id nullable SET NULL. reactions ON DELETE CASCADE. 본문 유지.',
  },
]);

const OPTIONAL_LATER = Object.freeze([
  {
    id: 'home_country_iso',
    fileName: 'migration_home_country_iso.sql',
    reason: 'foundation schema already ISO. 구 KR/JP/US CHECK가 있을 때만. handle_new_user를 덮어쓰므로 central_start 이후 금지.',
  },
  {
    id: 'territory_evolution_system',
    fileName: 'migration_territory_evolution_system.sql',
    reason: 'snapshot persist 초안. 현재 runtime은 profiles.territory count. SNAPSHOT_PERSIST_DISABLED.',
  },
  {
    id: 'user_event_pipeline',
    fileName: 'migration_user_event_pipeline.sql',
    reason: 'USER_EVENT_SYSTEM 미활성. 파일 헤더 미적용.',
  },
  {
    id: 'alien_system_draft',
    fileName: 'migration_alien_system.sql',
    reason: '관측/랭크 초안. user_moderation_state는 v1이 대체. 파일 헤더 미적용.',
  },
  {
    id: 'user_sanctions_v1',
    fileName: 'migration_user_sanctions_v1.sql',
    reason: '제재 상태/이의신청 additive. 이번 작업에서 Production apply 하지 않음. Alien V1 활성화와 독립.',
  },
  {
    id: 'retention_policy_v1',
    fileName: 'migration_retention_policy_v1.sql',
    reason: '삭제 콘텐츠 6개월·일반 신고/제재 1년. 전용 apply 도구로 Production 적용 완료. 전체 public REQUIRED 재실행 대상 아님.',
  },
  {
    id: 'signup_completed_at_v1',
    fileName: 'migration_signup_completed_at_v1.sql',
    reason: 'profiles.signup_completed_at. 전용 apply로 Production 적용 완료. 전체 public REQUIRED 재실행 대상 아님.',
  },
  {
    id: 'rights_email_verify_v1',
    fileName: 'migration_rights_email_verify_v1.sql',
    reason: '비회원 권리침해 이메일 확인 임시 테이블. 발송 수단이 준비되고 실제 수신 검증이 끝나기 전에는 Production apply 금지.',
  },
  {
    id: 'misinfo_report_v1',
    fileName: 'migration_misinfo_report_v1.sql',
    reason: '허위정보 신고 악용 제한 테이블. board_reports reason_code 유지. 전용 apply 도구로 Production 적용.',
  },
]);

const DO_NOT_APPLY = Object.freeze([
  {
    id: 'drop_profiles_identity',
    fileName: 'drop_profiles_identity_schema.sql',
    reason: 'DROP TABLE identity_history/profiles CASCADE.',
  },
  {
    id: 'alignment_system_legacy',
    fileName: 'migration_alignment_system.sql',
    reason: 'current_territory 포함 구 schema. live SSOT는 persistence+beta_v1. CREATE TABLE IF NOT EXISTS가 구 스키마를 고정할 수 있음.',
  },
  {
    id: 'user_data_system_draft',
    fileName: 'migration_user_data_system.sql',
    reason: '파일 헤더가 실제 적용 금지. progression/achievements는 canonical 파일이 대체.',
  },
]);

const REQUIRED_TABLES = Object.freeze([
  'profiles',
  'identity_history',
  'board_posts',
  'board_comments',
  'board_reactions',
  'board_reports',
  'user_progression',
  'user_progression_events',
  'user_achievements',
  'user_featured_achievements',
  'user_alignment_state',
  'alignment_batches',
  'alignment_history',
  'alignment_territory_history',
  'user_moderation_state',
  'user_moderation_events',
  'user_moderation_notifications',
  'account_withdrawal_jobs',
  'account_withdrawal_audit',
  'user_legal_consents',
  'rights_infringement_requests',
  'rights_infringement_events',
  'rights_infringement_objections',
  'rights_infringement_abuse_state',
]);

const REQUIRED_COLUMNS = Object.freeze([
  { table: 'profiles', column: 'territory' },
  { table: 'profiles', column: 'citizenship_status' },
  { table: 'profiles', column: 'exile_strike_count' },
  { table: 'board_reactions', column: 'actor_alignment_score_at_reaction' },
  { table: 'board_reactions', column: 'target_author_alignment_score_at_reaction' },
  { table: 'user_alignment_state', column: 'score' },
  { table: 'user_alignment_state', column: 'pending_territory' },
  { table: 'user_achievements', column: 'acquisition_notified_at' },
  { table: 'user_progression', column: 'reputation_score' },
]);

const REQUIRED_FUNCTIONS = Object.freeze([
  'handle_new_user',
  'protect_canonical_membership_territory',
  'toggle_board_reaction',
  'apply_user_progression_event',
  'grant_user_achievement',
  'mark_user_achievement_notified',
  'apply_alignment_score_batch',
  'withdraw_account_anonymize',
]);

function readEnv(name, env) {
  const src = env || process.env;
  return String(src[name] || '').trim();
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function relativeOf(fileName) {
  return path.join('supabase', fileName).replace(/\\/g, '/');
}

function scanSqlText(sql) {
  const body = String(sql || '');
  const uncommented = body.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/--[^\n]*/g, '\n');
  return {
    dropTable: /^\s*DROP TABLE\b/im.test(uncommented),
    dropSchema: /^\s*DROP SCHEMA\b/im.test(uncommented),
    truncate: /^\s*TRUNCATE\b/im.test(uncommented),
    dropColumn: /^\s*ALTER TABLE[\s\S]{0,80}DROP COLUMN\b/im.test(uncommented),
    deleteFromTopLevel: /^\s*DELETE\s+FROM\b/im.test(uncommented),
    updateProfilesTerritory: /UPDATE\s+public\.profiles[\s\S]{0,80}SET\s+territory/i.test(uncommented),
    updateScoreReset: /UPDATE\s+public\.user_alignment_state[\s\S]{0,80}SET\s+score\s*=\s*0/i.test(uncommented),
    createTableIfNotExists: /CREATE TABLE IF NOT EXISTS/i.test(body),
    addColumnIfNotExists: /ADD COLUMN IF NOT EXISTS/i.test(body),
    createOrReplaceFunction: /CREATE OR REPLACE FUNCTION/i.test(body),
    dropPolicyIfExists: /DROP POLICY IF EXISTS/i.test(body),
    dropTriggerIfExists: /DROP TRIGGER IF EXISTS/i.test(body),
    createUniqueIndexIfNotExists: /CREATE UNIQUE INDEX IF NOT EXISTS/i.test(body),
  };
}

function loadRequiredMigrations(options) {
  const root = (options && options.root) || ROOT;
  return REQUIRED.map(function (entry, index) {
    const rel = relativeOf(entry.fileName);
    const abs = path.join(root, rel);
    const raw = fs.readFileSync(abs);
    const sql = raw.toString('utf8');
    return {
      order: index + 1,
      id: entry.id,
      fileName: entry.fileName,
      relativePath: rel,
      dependsOn: entry.dependsOn.slice(),
      notes: entry.notes,
      bytes: raw.length,
      checksumSha256: sha256Hex(raw),
      sql: sql,
      scan: scanSqlText(sql),
    };
  });
}

function assertCatalogDependencies() {
  const ids = {};
  REQUIRED.forEach(function (e) {
    ids[e.id] = true;
  });
  const missing = [];
  REQUIRED.forEach(function (e) {
    e.dependsOn.forEach(function (dep) {
      if (!ids[dep]) missing.push(e.id + '→' + dep);
    });
  });
  REQUIRED.forEach(function (e, i) {
    e.dependsOn.forEach(function (dep) {
      const depIndex = REQUIRED.findIndex(function (x) {
        return x.id === dep;
      });
      if (depIndex > i) missing.push('order ' + e.id + ' before dependency ' + dep);
    });
  });
  return missing;
}

function validateNodeEnv(env) {
  const nodeEnv = readEnv('NODE_ENV', env).toLowerCase();
  if (nodeEnv !== 'production') {
    return { ok: false, code: 'NODE_ENV_NOT_PRODUCTION', nodeEnv: nodeEnv || '' };
  }
  return { ok: true, nodeEnv: 'production' };
}

function validateConfirm(env) {
  const value = readEnv(CONFIRM_ENV, env);
  if (!value) return { ok: false, code: 'CONFIRM_MISSING', envKey: CONFIRM_ENV };
  if (value !== CONFIRM_VALUE) return { ok: false, code: 'CONFIRM_MISMATCH', envKey: CONFIRM_ENV };
  return { ok: true, envKey: CONFIRM_ENV };
}

function isLocalDatabaseHost(url) {
  const masked = maskHostRef(url);
  const host = String(masked.host || '').toLowerCase();
  if (!host) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

function evaluateProductionPublicMigrationGates(options) {
  const opt = options || {};
  const env = opt.env || process.env;
  const errors = [];
  const warnings = [];
  const node = validateNodeEnv(env);
  if (opt.requireNodeEnv === true && !node.ok) errors.push(node);
  if (opt.requireConfirm === true) {
    const confirmGate = validateConfirm(env);
    if (!confirmGate.ok) errors.push(confirmGate);
  }
  const databaseUrl = readEnv('DAILY_ISSUE_DATABASE_URL', env);
  if (opt.requireDatabaseUrl === true && !databaseUrl) {
    errors.push({ ok: false, code: 'DATABASE_URL_MISSING' });
  }
  if (opt.forbidLocalhost === true && databaseUrl && isLocalDatabaseHost(databaseUrl)) {
    errors.push({ ok: false, code: 'LOCALHOST_DB_FORBIDDEN', host: maskHostRef(databaseUrl).host });
  }
  const schema = readEnv('DAILY_ISSUE_DB_SCHEMA', env);
  if (opt.refuseDailyIssueTestSchema === true && schema && /^daily_issue_(test|dev)/i.test(schema)) {
    errors.push({ ok: false, code: 'DAILY_ISSUE_SCHEMA_NOT_PRODUCTION', schema: schema });
  }
  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    nodeEnv: node.nodeEnv || readEnv('NODE_ENV', env),
    hasDatabaseUrl: !!databaseUrl,
    confirmEnv: CONFIRM_ENV,
    confirmValueExpected: CONFIRM_VALUE,
  };
}

function maskHostRef(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname || 'host';
    const port = u.port || '';
    const m =
      host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i) ||
      host.match(/^([a-z0-9]+)\.supabase\.co$/i) ||
      host.match(/postgres\.([a-z0-9]+)\./i);
    return {
      maskedUrl: u.protocol + '//' + host + (port ? ':' + port : '') + '/[db]',
      host: host,
      projectRef: m ? m[1] : null,
    };
  } catch (_) {
    return { maskedUrl: '[invalid-url]', host: null, projectRef: null };
  }
}

function buildPreflightReport(options) {
  const opt = options || {};
  const migrations = loadRequiredMigrations({ root: opt.root });
  const depErrors = assertCatalogDependencies();
  const gates = evaluateProductionPublicMigrationGates({
    env: opt.env,
    requireConfirm: opt.requireConfirm === true,
    requireDatabaseUrl: opt.requireDatabaseUrl === true,
    requireNodeEnv: opt.requireNodeEnv === true,
    forbidLocalhost: opt.forbidLocalhost === true,
    refuseDailyIssueTestSchema: opt.refuseDailyIssueTestSchema === true,
  });
  const url = readEnv('DAILY_ISSUE_DATABASE_URL', opt.env || process.env);
  const masked = url ? maskHostRef(url) : { maskedUrl: null, host: null, projectRef: null };
  const destructive = migrations.filter(function (m) {
    return m.scan.dropTable || m.scan.truncate || m.scan.dropSchema || m.scan.dropColumn;
  });
  return {
    ok: gates.ok && depErrors.length === 0 && destructive.length === 0,
    mode: opt.mode || 'check',
    wrote: false,
    gates: gates,
    dependencyErrors: depErrors,
    target: {
      schema: 'public',
      maskedUrl: masked.maskedUrl,
      host: masked.host,
      projectRef: masked.projectRef,
    },
    connection: url
      ? readEnv('NODE_ENV', opt.env || process.env).toLowerCase() === 'production'
        ? 'CONFIGURED'
        : 'URL_PRESENT_NON_PRODUCTION'
      : 'NOT_CONFIGURED',
    migrations: migrations.map(function (m) {
      return {
        order: m.order,
        id: m.id,
        fileName: m.fileName,
        relativePath: m.relativePath,
        dependsOn: m.dependsOn,
        notes: m.notes,
        bytes: m.bytes,
        checksumSha256: m.checksumSha256,
        scan: m.scan,
      };
    }),
    migrationOrder: migrations.map(function (m) {
      return m.id;
    }),
    optionalLater: OPTIONAL_LATER.slice(),
    doNotApply: DO_NOT_APPLY.slice(),
    destructiveRequired: destructive.map(function (m) {
      return m.id;
    }),
    dryRunKind: 'STATIC_VALIDATION_NO_SQL_EXECUTE',
  };
}

function classifyAllFiles() {
  return {
    required: REQUIRED.map(function (e) {
      return { id: e.id, fileName: e.fileName, class: 'REQUIRED', schema: 'public' };
    }),
    dailyIssueRequired: DAILY_ISSUE_REQUIRED.map(function (e) {
      return { id: e.id, fileName: e.fileName, class: 'REQUIRED', schema: 'daily_issue' };
    }),
    optionalLater: OPTIONAL_LATER.map(function (e) {
      return { id: e.id, fileName: e.fileName, class: 'OPTIONAL_LATER', reason: e.reason };
    }),
    doNotApply: DO_NOT_APPLY.map(function (e) {
      return { id: e.id, fileName: e.fileName, class: 'DO_NOT_APPLY', reason: e.reason };
    }),
  };
}

async function inspectPublicSchema(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw Object.assign(new Error('EXECUTOR_REQUIRED'), { code: 'EXECUTOR_REQUIRED' });
  }
  const tables = await executor.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"
  );
  const cols = await executor.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1::text[])",
    [REQUIRED_TABLES.slice()]
  );
  const fns = await executor.query(
    "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname = ANY($1::text[])",
    [REQUIRED_FUNCTIONS.slice()]
  );
  const tableNames = (tables.rows || []).map(function (r) {
    return r.table_name;
  });
  const colSet = {};
  (cols.rows || []).forEach(function (r) {
    colSet[r.table_name + '.' + r.column_name] = true;
  });
  const fnSet = {};
  (fns.rows || []).forEach(function (r) {
    fnSet[r.proname] = true;
  });
  const missingTables = REQUIRED_TABLES.filter(function (t) {
    return tableNames.indexOf(t) < 0;
  });
  const missingColumns = REQUIRED_COLUMNS.filter(function (c) {
    return !colSet[c.table + '.' + c.column];
  });
  const missingFunctions = REQUIRED_FUNCTIONS.filter(function (f) {
    return !fnSet[f];
  });
  return {
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingFunctions.length === 0,
    missingTables: missingTables,
    missingColumns: missingColumns,
    missingFunctions: missingFunctions,
    tableCount: tableNames.length,
  };
}

async function applyProductionPublicMigrations(executor, options) {
  const opt = options || {};
  const files = loadRequiredMigrations({ root: opt.root });
  if (!executor || typeof executor.withTransaction !== 'function') {
    throw Object.assign(new Error('EXECUTOR_REQUIRED'), { code: 'EXECUTOR_REQUIRED' });
  }
  return executor.withTransaction(async function (tx) {
    const applied = [];
    for (let i = 0; i < files.length; i++) {
      const m = files[i];
      if (m.scan.dropTable || m.scan.truncate || m.scan.dropSchema) {
        throw Object.assign(new Error('DESTRUCTIVE_SQL_FORBIDDEN'), {
          code: 'DESTRUCTIVE_SQL_FORBIDDEN',
          fileName: m.fileName,
        });
      }
      await tx.query(m.sql);
      applied.push({ order: m.order, id: m.id, fileName: m.fileName, checksumSha256: m.checksumSha256 });
    }
    return { ok: true, schema: 'public', applied: applied, migrationOrder: applied.map(function (a) { return a.id; }) };
  });
}

module.exports = {
  CONFIRM_ENV: CONFIRM_ENV,
  CONFIRM_VALUE: CONFIRM_VALUE,
  REQUIRED: REQUIRED,
  DAILY_ISSUE_REQUIRED: DAILY_ISSUE_REQUIRED,
  OPTIONAL_LATER: OPTIONAL_LATER,
  DO_NOT_APPLY: DO_NOT_APPLY,
  REQUIRED_TABLES: REQUIRED_TABLES,
  REQUIRED_COLUMNS: REQUIRED_COLUMNS,
  REQUIRED_FUNCTIONS: REQUIRED_FUNCTIONS,
  scanSqlText: scanSqlText,
  loadRequiredMigrations: loadRequiredMigrations,
  assertCatalogDependencies: assertCatalogDependencies,
  evaluateProductionPublicMigrationGates: evaluateProductionPublicMigrationGates,
  validateNodeEnv: validateNodeEnv,
  validateConfirm: validateConfirm,
  isLocalDatabaseHost: isLocalDatabaseHost,
  maskHostRef: maskHostRef,
  buildPreflightReport: buildPreflightReport,
  classifyAllFiles: classifyAllFiles,
  inspectPublicSchema: inspectPublicSchema,
  applyProductionPublicMigrations: applyProductionPublicMigrations,
  sha256Hex: sha256Hex,
};
