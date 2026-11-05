'use strict';

/**
 * 운영용 데일리 이슈 schema(daily_issue) migration 게이트·유틸
 *
 * - schema는 정확히 daily_issue 만 허용 (test/public/빈값 거부)
 * - NODE_ENV=production 필수
 * - confirm 환경변수로 명시 승인
 * - reset/truncate/cleanup 없음
 * - 비밀값(URL 원문·비밀번호) 미포함
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRODUCTION_SCHEMA = 'daily_issue';
const CONFIRM_ENV = 'DAILY_ISSUE_CONFIRM_PRODUCTION_MIGRATION';
const CONFIRM_VALUE = 'APPLY_DAILY_ISSUE_PRODUCTION';

const ALLOWED_MIGRATION_PROJECT_REF = 'wzpreuseuiuzwpoqqckr';
const ALLOWED_MIGRATION_DB_USER = 'postgres.wzpreuseuiuzwpoqqckr';
const ALLOWED_MIGRATION_DB_HOST = 'aws-0-ap-northeast-2.pooler.supabase.com';
const ALLOWED_MIGRATION_DB_PORT = '5432';
const ALLOWED_MIGRATION_DB_NAME = 'postgres';
const SSL_CA_ENV = 'DAILY_ISSUE_PG_SSL_CA_FILE';
const FORBIDDEN_MIGRATION_PROJECT_REFS = Object.freeze([
  'rlzltrwwamrgrfwlaqxj',
  'vmpdddcdnxeavchgivcd',
]);

const ROOT = path.join(__dirname, '..');

const MIGRATION_FILES = Object.freeze([
  {
    id: 'review_lifecycle',
    order: 1,
    fileName: 'migration_daily_issue_review_lifecycle.sql',
    relativePath: path.join('supabase', 'migration_daily_issue_review_lifecycle.sql'),
  },
  {
    id: 'morning_scheduler',
    order: 2,
    fileName: 'migration_daily_issue_morning_scheduler.sql',
    relativePath: path.join('supabase', 'migration_daily_issue_morning_scheduler.sql'),
  },
  {
    id: 'alignment_seed',
    order: 3,
    fileName: 'migration_daily_issue_alignment_seed_v1.sql',
    relativePath: path.join('supabase', 'migration_daily_issue_alignment_seed_v1.sql'),
  },
  {
    id: 'comments',
    order: 4,
    fileName: 'migration_daily_issue_comments_v1.sql',
    relativePath: path.join('supabase', 'migration_daily_issue_comments_v1.sql'),
  },
  {
    id: 'account_withdrawal',
    order: 5,
    fileName: 'migration_daily_issue_account_withdrawal_v1.sql',
    relativePath: path.join('supabase', 'migration_daily_issue_account_withdrawal_v1.sql'),
  },
  {
    id: 'ops_workflow',
    order: 6,
    fileName: 'migration_daily_issue_ops_workflow_v1.sql',
    relativePath: path.join('supabase', 'migration_daily_issue_ops_workflow_v1.sql'),
  },
]);

const REQUIRED_TABLES = Object.freeze([
  'daily_issue_review_items',
  'daily_issue_sources',
  'daily_issue_evidences',
  'daily_issue_claims',
  'daily_issue_review_item_sources',
  'daily_issue_review_item_evidences',
  'daily_issue_review_item_claims',
  'daily_issue_claim_evidences',
  'daily_issue_claim_sources',
  'daily_issue_updates',
  'daily_issue_audit_logs',
  'daily_issue_repository_meta',
  'daily_issue_scheduler_runs',
  'daily_issue_reactions',
  'daily_issue_comments',
  'daily_issue_recollect_jobs',
]);

const REQUIRED_INDEX_HINTS = Object.freeze([
  'idx_daily_issue_review_items_status',
  'idx_daily_issue_review_items_content_sig',
  'idx_daily_issue_audit_logs_entity',
  'daily_issue_scheduler_runs_type_started_idx',
  'daily_issue_scheduler_runs_status_idx',
  'daily_issue_reactions_one_active',
  'idx_daily_issue_comments_issue_created',
]);

const FORBIDDEN_DEV_ENV_KEYS = Object.freeze([
  'DAILY_ISSUE_ALLOW_TEST_RESET',
  'DAILY_ISSUE_APPLY_MIGRATION_IN_TEST',
  'DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE',
  'DAILY_ISSUE_ADMIN_API_TOKEN',
  'BOARD_DEV_MEMORY',
  'ALIGNMENT_LIVE_VERIFY',
  'ALIGNMENT_VERIFY_PROJECT_REF',
  'ALIGNMENT_VERIFY_TEST_USER_ID',
  'ALIGNMENT_VERIFY_CLEANUP',
  'OPEN_BROWSER',
]);

function readEnv(name, env) {
  const src = env || process.env;
  return String(src[name] || '').trim();
}

function validateDailyIssueSslCa(env) {
  const raw = readEnv(SSL_CA_ENV, env).replace(/^["']|["']$/g, '');
  if (!raw) return { ok: false, code: 'SSL_CA_REQUIRED' };
  let buf;
  try {
    buf = fs.readFileSync(raw);
  } catch (_) {
    return { ok: false, code: 'SSL_CA_FILE_UNREADABLE' };
  }
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  if (/PRIVATE KEY/.test(text)) return { ok: false, code: 'SSL_CA_FILE_INVALID' };
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!blocks || !blocks.length) return { ok: false, code: 'SSL_CA_FILE_INVALID' };
  const now = Date.now();
  for (let i = 0; i < blocks.length; i++) {
    const b64 = blocks[i]
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\s+/g, '');
    let cert;
    try {
      cert = new crypto.X509Certificate(Buffer.from(b64, 'base64'));
    } catch (_) {
      return { ok: false, code: 'SSL_CA_FILE_INVALID' };
    }
    const from = Date.parse(cert.validFrom);
    const to = Date.parse(cert.validTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > now || to < now) {
      return { ok: false, code: 'SSL_CA_FILE_INVALID' };
    }
  }
  return { ok: true, code: 'SSL_CA_OK', pem: text };
}

function findUnscopedConstraintLookups(migrations) {
  const hits = [];
  (migrations || []).forEach(function (m) {
    const sql = String((m && (m.rewrittenSql || m.sql)) || '');
    if (/FROM\s+pg_constraint\b/i.test(sql) && !/\bconrelid\b|::regclass/i.test(sql)) {
      hits.push(m.id || m.fileName || 'unknown');
    }
  });
  return hits;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function rewriteSchema(sql, schema) {
  const s = String(schema || '').trim();
  if (!s || s === 'public') {
    throw Object.assign(new Error('REWRITE_REFUSED_PUBLIC_OR_EMPTY'), {
      code: 'REWRITE_REFUSED_PUBLIC_OR_EMPTY',
    });
  }
  if (s !== PRODUCTION_SCHEMA) {
    throw Object.assign(new Error('REWRITE_REFUSED_SCHEMA'), {
      code: 'REWRITE_REFUSED_SCHEMA',
      schema: s,
    });
  }
  return String(sql).replace(/\bpublic\.(daily_issue_[a-z0-9_]+)/gi, s + '.$1');
}

function assertNoDestructiveSql(sql) {
  const body = String(sql || '');
  if (/^\s*TRUNCATE\b/im.test(body)) {
    const err = new Error('DESTRUCTIVE_SQL_FORBIDDEN');
    err.code = 'DESTRUCTIVE_SQL_FORBIDDEN';
    err.detail = 'TRUNCATE';
    throw err;
  }
  if (/^\s*DROP\s+TABLE\b/im.test(body)) {
    const err = new Error('DESTRUCTIVE_SQL_FORBIDDEN');
    err.code = 'DESTRUCTIVE_SQL_FORBIDDEN';
    err.detail = 'DROP TABLE';
    throw err;
  }
  if (/^\s*DELETE\s+FROM\b/im.test(body)) {
    const err = new Error('DESTRUCTIVE_SQL_FORBIDDEN');
    err.code = 'DESTRUCTIVE_SQL_FORBIDDEN';
    err.detail = 'DELETE';
    throw err;
  }
  return true;
}

function loadMigrationFiles(options) {
  const opt = options || {};
  const root = opt.root || ROOT;
  return MIGRATION_FILES.map(function (entry) {
    const abs = path.join(root, entry.relativePath);
    const raw = fs.readFileSync(abs);
    const text = raw.toString('utf8');
    assertNoDestructiveSql(text);
    return {
      id: entry.id,
      order: entry.order,
      fileName: entry.fileName,
      relativePath: entry.relativePath.replace(/\\/g, '/'),
      absolutePath: abs,
      bytes: raw.length,
      checksumSha256: sha256Hex(raw),
      sql: text,
    };
  }).sort(function (a, b) {
    return a.order - b.order;
  });
}

function buildRewrittenMigrations(schema, options) {
  const files = loadMigrationFiles(options);
  return files.map(function (f) {
    const rewritten = rewriteSchema(f.sql, schema);
    assertNoDestructiveSql(rewritten);
    return {
      id: f.id,
      order: f.order,
      fileName: f.fileName,
      relativePath: f.relativePath,
      checksumSha256: f.checksumSha256,
      bytes: f.bytes,
      rewrittenBytes: Buffer.byteLength(rewritten, 'utf8'),
      rewrittenSql: rewritten,
    };
  });
}

function validateProductionSchema(schema) {
  const s = String(schema == null ? '' : schema).trim();
  if (!s) {
    return { ok: false, code: 'SCHEMA_EMPTY', schema: s };
  }
  if (s === 'public') {
    return { ok: false, code: 'SCHEMA_PUBLIC_FORBIDDEN', schema: s };
  }
  if (/^daily_issue_test/i.test(s) || /^daily_issue_dev/i.test(s)) {
    return { ok: false, code: 'SCHEMA_TEST_FORBIDDEN', schema: s };
  }
  if (s !== PRODUCTION_SCHEMA) {
    return {
      ok: false,
      code: 'SCHEMA_NOT_PRODUCTION',
      schema: s,
      expected: PRODUCTION_SCHEMA,
    };
  }
  return { ok: true, schema: PRODUCTION_SCHEMA };
}

function validateConfirm(env) {
  const value = readEnv(CONFIRM_ENV, env);
  if (!value) {
    return { ok: false, code: 'CONFIRM_MISSING', envKey: CONFIRM_ENV };
  }
  if (value !== CONFIRM_VALUE) {
    return { ok: false, code: 'CONFIRM_MISMATCH', envKey: CONFIRM_ENV };
  }
  return { ok: true, envKey: CONFIRM_ENV };
}

function validateNodeEnv(env) {
  const nodeEnv = readEnv('NODE_ENV', env).toLowerCase();
  if (nodeEnv !== 'production') {
    return { ok: false, code: 'NODE_ENV_NOT_PRODUCTION', nodeEnv: nodeEnv || '' };
  }
  return { ok: true, nodeEnv: 'production' };
}

function evaluateProductionMigrationGates(options) {
  const opt = options || {};
  const env = opt.env || process.env;
  const errors = [];
  const warnings = [];

  const node = validateNodeEnv(env);
  if (!node.ok) errors.push(node);

  const schemaRaw =
    opt.schema != null ? String(opt.schema).trim() : readEnv('DAILY_ISSUE_DB_SCHEMA', env);
  const schemaGate = validateProductionSchema(schemaRaw);
  if (!schemaGate.ok) errors.push(schemaGate);

  let confirmGate = { ok: true, skipped: true };
  if (opt.requireConfirm !== false) {
    confirmGate = validateConfirm(env);
    if (!confirmGate.ok) errors.push(confirmGate);
  } else {
    const peek = validateConfirm(env);
    if (!peek.ok) {
      warnings.push({ code: 'CONFIRM_NOT_SET', envKey: CONFIRM_ENV });
    }
  }

  const databaseUrl = readEnv('DAILY_ISSUE_DATABASE_URL', env);
  if (opt.requireDatabaseUrl !== false && !databaseUrl) {
    errors.push({ ok: false, code: 'DATABASE_URL_MISSING' });
  }
  if (databaseUrl && isLocalDatabaseHost(databaseUrl)) {
    errors.push({ ok: false, code: 'LOCALHOST_DB_FORBIDDEN', host: maskHostRef(databaseUrl).host });
  }
  if (databaseUrl) {
    const target = assertDailyIssueMigrationTarget(databaseUrl);
    if (!target.ok) {
      errors.push({ ok: false, code: target.code });
    }
    const ca = validateDailyIssueSslCa(env);
    if (!ca.ok) errors.push({ ok: false, code: ca.code });
  }

  FORBIDDEN_DEV_ENV_KEYS.forEach(function (k) {
    if (readEnv(k, env)) {
      warnings.push({ code: 'DEV_FLAG_PRESENT', key: k });
    }
  });

  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    schema: schemaGate.ok ? PRODUCTION_SCHEMA : schemaRaw,
    nodeEnv: node.nodeEnv || readEnv('NODE_ENV', env),
    confirmRequired: opt.requireConfirm !== false,
    confirmOk: confirmGate.ok === true && !confirmGate.skipped,
    hasDatabaseUrl: !!databaseUrl,
    productionSchema: PRODUCTION_SCHEMA,
    confirmEnv: CONFIRM_ENV,
    confirmValueExpected: CONFIRM_VALUE,
  };
}

function isLocalDatabaseHost(url) {
  const masked = maskHostRef(url);
  const host = String(masked.host || '').toLowerCase();
  if (!host) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

function projectRefFromLoginUser(username) {
  const user = String(username || '');
  const match = user.match(/^postgres\.([a-z0-9]+)$/i);
  return match ? match[1] : null;
}

function assertDailyIssueMigrationTarget(url) {
  const raw = String(url == null ? '' : url);
  const lower = raw.toLowerCase();
  for (let i = 0; i < FORBIDDEN_MIGRATION_PROJECT_REFS.length; i++) {
    if (lower.indexOf(FORBIDDEN_MIGRATION_PROJECT_REFS[i]) >= 0) {
      return { ok: false, code: 'FORBIDDEN_PROJECT_REF' };
    }
  }
  if (!raw.trim()) return { ok: false, code: 'TARGET_UNIDENTIFIED' };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return { ok: false, code: 'TARGET_UNIDENTIFIED' };
  }
  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    return { ok: false, code: 'TARGET_UNIDENTIFIED' };
  }

  let user = '';
  let database = '';
  try {
    user = decodeURIComponent(parsed.username || '');
    database = decodeURIComponent(String(parsed.pathname || '').replace(/^\/+/, '').replace(/\/+$/, ''));
  } catch (_) {
    return { ok: false, code: 'TARGET_UNIDENTIFIED' };
  }
  const host = String(parsed.hostname || '').toLowerCase();
  const port = String(parsed.port || '');
  const ref = projectRefFromLoginUser(user);
  if (!host || !port || !database || !ref) {
    return { ok: false, code: 'TARGET_UNIDENTIFIED' };
  }
  if (ref !== ALLOWED_MIGRATION_PROJECT_REF || user !== ALLOWED_MIGRATION_DB_USER) {
    return { ok: false, code: 'PROJECT_REF_NOT_ALLOWED' };
  }
  if (host !== ALLOWED_MIGRATION_DB_HOST) {
    return { ok: false, code: 'DB_HOST_MISMATCH' };
  }
  if (port !== ALLOWED_MIGRATION_DB_PORT) {
    return { ok: false, code: 'DB_PORT_MISMATCH' };
  }
  if (database !== ALLOWED_MIGRATION_DB_NAME) {
    return { ok: false, code: 'DB_NAME_MISMATCH' };
  }
  return {
    ok: true,
    code: 'TARGET_ALLOWED',
    projectRef: ALLOWED_MIGRATION_PROJECT_REF,
    host: host,
    port: port,
    database: database,
  };
}

function maskHostRef(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname || 'host';
    const port = u.port || '';
    const hostMatch =
      host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i) ||
      host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    let user = '';
    try {
      user = decodeURIComponent(u.username || '');
    } catch (_) {
      user = '';
    }
    const userRef = projectRefFromLoginUser(user);
    const projectRef = hostMatch ? hostMatch[1] : userRef;
    return {
      maskedUrl: u.protocol + '//' + host + (port ? ':' + port : '') + '/[db]',
      host: host,
      projectRef: projectRef,
    };
  } catch (_) {
    return { maskedUrl: '[invalid-url]', host: null, projectRef: null };
  }
}

function buildPreflightReport(options) {
  const opt = options || {};
  const gates = evaluateProductionMigrationGates({
    env: opt.env,
    schema: opt.schema,
    requireConfirm: opt.requireConfirm === true,
    requireDatabaseUrl: opt.requireDatabaseUrl !== false,
  });
  const migrations = loadMigrationFiles({ root: opt.root });
  const url = readEnv('DAILY_ISSUE_DATABASE_URL', opt.env || process.env);
  const masked = url
    ? maskHostRef(url)
    : { maskedUrl: null, host: null, projectRef: null };

  return {
    ok: gates.ok,
    mode: opt.mode || 'check',
    gates: gates,
    connection: url ? 'CONFIGURED' : 'NOT_CONFIGURED',
    dryRunKind: 'STATIC_REWRITE_NO_SQL_EXECUTE',
    target: {
      schema: PRODUCTION_SCHEMA,
      maskedUrl: masked.maskedUrl,
      host: masked.host,
      projectRef: masked.projectRef,
    },
    migrations: migrations.map(function (m) {
      return {
        order: m.order,
        id: m.id,
        fileName: m.fileName,
        relativePath: m.relativePath,
        bytes: m.bytes,
        checksumSha256: m.checksumSha256,
      };
    }),
    migrationOrder: migrations.map(function (m) {
      return m.id;
    }),
  };
}

function buildInspectionQueries(schema) {
  const s = validateProductionSchema(schema);
  if (!s.ok) throw Object.assign(new Error(s.code), s);
  const schemaName = PRODUCTION_SCHEMA;
  return {
    schemaExists: {
      text:
        'SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS ok',
      params: [schemaName],
    },
    tables: {
      text:
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
      params: [schemaName],
    },
    indexes: {
      text: 'SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname',
      params: [schemaName],
    },
    foreignKeys: {
      text:
        "SELECT tc.constraint_name, tc.table_name FROM information_schema.table_constraints tc WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY' ORDER BY tc.table_name, tc.constraint_name",
      params: [schemaName],
    },
    rls: {
      text:
        "SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname",
      params: [schemaName],
    },
    columns: {
      text:
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'daily_issue_review_items' AND column_name = 'alignment_direction'",
      params: [schemaName],
    },
  };
}

function summarizeInspection(rowsByKey) {
  const tables = (rowsByKey.tables || []).map(function (r) {
    return r.table_name;
  });
  const indexes = (rowsByKey.indexes || []).map(function (r) {
    return r.indexname;
  });
  const fks = rowsByKey.foreignKeys || [];
  const rls = rowsByKey.rls || [];
  const columns = rowsByKey.columns;

  const missingTables = REQUIRED_TABLES.filter(function (t) {
    return tables.indexOf(t) < 0;
  });
  const missingIndexHints = REQUIRED_INDEX_HINTS.filter(function (name) {
    return !indexes.some(function (idx) {
      return idx === name || idx.indexOf(name) >= 0;
    });
  });
  const missingRlsTables = REQUIRED_TABLES.filter(function (t) {
    const row = rls.find(function (r) {
      return r.table_name === t;
    });
    return !row || !row.rls_enabled;
  });

  const hasAlignmentDirection =
    columns == null
      ? true
      : columns.some(function (r) {
          return r.column_name === 'alignment_direction';
        });

  const ok =
    missingTables.length === 0 &&
    missingIndexHints.length === 0 &&
    missingRlsTables.length === 0 &&
    fks.length > 0 &&
    hasAlignmentDirection;

  return {
    ok: ok,
    tableCount: tables.length,
    tables: tables,
    missingTables: missingTables,
    indexCount: indexes.length,
    missingIndexHints: missingIndexHints,
    foreignKeyCount: fks.length,
    missingRlsTables: missingRlsTables,
    hasSchedulerTable: tables.indexOf('daily_issue_scheduler_runs') >= 0,
    hasReactionsTable: tables.indexOf('daily_issue_reactions') >= 0,
    hasCommentsTable: tables.indexOf('daily_issue_comments') >= 0,
    hasAlignmentDirection: hasAlignmentDirection,
  };
}

async function applyProductionMigrations(executor, options) {
  const opt = options || {};
  const schema = PRODUCTION_SCHEMA;
  const rewritten = buildRewrittenMigrations(schema, { root: opt.root });

  if (!executor || typeof executor.withTransaction !== 'function') {
    const err = new Error('EXECUTOR_REQUIRED');
    err.code = 'EXECUTOR_REQUIRED';
    throw err;
  }

  return executor.withTransaction(async function (tx) {
    await tx.query('CREATE SCHEMA IF NOT EXISTS "' + schema.replace(/"/g, '') + '"');
    const applied = [];
    for (let i = 0; i < rewritten.length; i++) {
      const m = rewritten[i];
      await tx.query(m.rewrittenSql);
      applied.push({
        order: m.order,
        id: m.id,
        fileName: m.fileName,
        checksumSha256: m.checksumSha256,
      });
    }
    return {
      ok: true,
      schema: schema,
      applied: applied,
      migrationOrder: applied.map(function (a) {
        return a.id;
      }),
    };
  });
}

async function inspectSchema(executor, schema) {
  const queries = buildInspectionQueries(schema || PRODUCTION_SCHEMA);
  const schemaExists = await executor.query(queries.schemaExists.text, queries.schemaExists.params);
  const exists = !!(schemaExists.rows && schemaExists.rows[0] && schemaExists.rows[0].ok);
  if (!exists) {
    return {
      ok: false,
      schemaExists: false,
      summary: summarizeInspection({ tables: [], indexes: [], foreignKeys: [], rls: [], columns: [] }),
    };
  }
  const tables = await executor.query(queries.tables.text, queries.tables.params);
  const indexes = await executor.query(queries.indexes.text, queries.indexes.params);
  const foreignKeys = await executor.query(queries.foreignKeys.text, queries.foreignKeys.params);
  const rls = await executor.query(queries.rls.text, queries.rls.params);
  const columns = await executor.query(queries.columns.text, queries.columns.params);
  const summary = summarizeInspection({
    tables: tables.rows || [],
    indexes: indexes.rows || [],
    foreignKeys: foreignKeys.rows || [],
    rls: rls.rows || [],
    columns: columns.rows || [],
  });
  return {
    ok: summary.ok,
    schemaExists: true,
    summary: summary,
  };
}

module.exports = {
  PRODUCTION_SCHEMA: PRODUCTION_SCHEMA,
  CONFIRM_ENV: CONFIRM_ENV,
  CONFIRM_VALUE: CONFIRM_VALUE,
  ALLOWED_MIGRATION_PROJECT_REF: ALLOWED_MIGRATION_PROJECT_REF,
  ALLOWED_MIGRATION_DB_USER: ALLOWED_MIGRATION_DB_USER,
  ALLOWED_MIGRATION_DB_HOST: ALLOWED_MIGRATION_DB_HOST,
  ALLOWED_MIGRATION_DB_PORT: ALLOWED_MIGRATION_DB_PORT,
  ALLOWED_MIGRATION_DB_NAME: ALLOWED_MIGRATION_DB_NAME,
  SSL_CA_ENV: SSL_CA_ENV,
  FORBIDDEN_MIGRATION_PROJECT_REFS: FORBIDDEN_MIGRATION_PROJECT_REFS,
  validateDailyIssueSslCa: validateDailyIssueSslCa,
  findUnscopedConstraintLookups: findUnscopedConstraintLookups,
  assertDailyIssueMigrationTarget: assertDailyIssueMigrationTarget,
  MIGRATION_FILES: MIGRATION_FILES,
  REQUIRED_TABLES: REQUIRED_TABLES,
  REQUIRED_INDEX_HINTS: REQUIRED_INDEX_HINTS,
  FORBIDDEN_DEV_ENV_KEYS: FORBIDDEN_DEV_ENV_KEYS,
  rewriteSchema: rewriteSchema,
  assertNoDestructiveSql: assertNoDestructiveSql,
  loadMigrationFiles: loadMigrationFiles,
  buildRewrittenMigrations: buildRewrittenMigrations,
  validateProductionSchema: validateProductionSchema,
  validateConfirm: validateConfirm,
  validateNodeEnv: validateNodeEnv,
  evaluateProductionMigrationGates: evaluateProductionMigrationGates,
  maskHostRef: maskHostRef,
  projectRefFromLoginUser: projectRefFromLoginUser,
  buildPreflightReport: buildPreflightReport,
  buildInspectionQueries: buildInspectionQueries,
  summarizeInspection: summarizeInspection,
  applyProductionMigrations: applyProductionMigrations,
  inspectSchema: inspectSchema,
  sha256Hex: sha256Hex,
  isLocalDatabaseHost: isLocalDatabaseHost,
};
