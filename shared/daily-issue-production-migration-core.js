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
]);

const REQUIRED_INDEX_HINTS = Object.freeze([
  'idx_daily_issue_review_items_status',
  'idx_daily_issue_review_items_content_sig',
  'idx_daily_issue_audit_logs_entity',
  'daily_issue_scheduler_runs_type_started_idx',
  'daily_issue_scheduler_runs_status_idx',
  'daily_issue_reactions_one_active',
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

function maskHostRef(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname || 'host';
    const port = u.port || '';
    const m =
      host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i) ||
      host.match(/^([a-z0-9]+)\.supabase\.co$/i) ||
      host.match(/postgres\.([a-z0-9]+)\./i);
    const projectRef = m ? m[1] : null;
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
  buildPreflightReport: buildPreflightReport,
  buildInspectionQueries: buildInspectionQueries,
  summarizeInspection: summarizeInspection,
  applyProductionMigrations: applyProductionMigrations,
  inspectSchema: inspectSchema,
  sha256Hex: sha256Hex,
  isLocalDatabaseHost: isLocalDatabaseHost,
};
