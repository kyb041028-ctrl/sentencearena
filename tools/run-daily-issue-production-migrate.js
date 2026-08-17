#!/usr/bin/env node
'use strict';

/**
 * 운영용 데일리 이슈 schema(daily_issue) migration CLI
 *
 * modes: check | dry-run | apply | verify
 *
 * 금지:
 * - daily_issue_test / public schema
 * - reset / truncate / cleanup
 * - 비밀번호·전체 URL·secret 출력
 * - 이번 배포 작업에서 실제 운영 apply 강제 실행 (수동 confirm 필요)
 */

require('dotenv').config();

const path = require('path');
const core = require('../shared/daily-issue-production-migration-core');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

function parseArgs(argv) {
  const out = { mode: null, json: true };
  argv.forEach(function (a) {
    if (a === 'check' || a === 'dry-run' || a === 'apply' || a === 'verify') out.mode = a;
    else if (a === '--json') out.json = true;
    else if (a === '--no-json') out.json = false;
  });
  return out;
}

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function refuse(code, extra) {
  const payload = Object.assign({ ok: false, error: code }, extra || {});
  printJson(payload);
  process.exit(1);
}

function createExecutor() {
  const url = resolveDailyIssueDatabaseUrl({});
  const executor = createDailyIssuePgExecutor({
    databaseUrl: url,
    schemaName: core.PRODUCTION_SCHEMA,
  });
  if (!executor.ok) {
    refuse('DATABASE_UNAVAILABLE', {
      message: executor.message || 'pg executor unavailable',
      maskedUrl: url ? maskDatabaseUrl(url) : null,
    });
  }
  return executor;
}

async function runCheck() {
  const report = core.buildPreflightReport({
    mode: 'check',
    requireConfirm: false,
    requireDatabaseUrl: false,
  });

  let inspection = null;
  const canInspect =
    String(process.env.NODE_ENV || '').toLowerCase() === 'production' &&
    String(process.env.DAILY_ISSUE_DB_SCHEMA || '').trim() === core.PRODUCTION_SCHEMA &&
    !!resolveDailyIssueDatabaseUrl({});
  if (canInspect) {
    const executor = createExecutor();
    try {
      inspection = await core.inspectSchema(executor, core.PRODUCTION_SCHEMA);
    } finally {
      await executor.end();
    }
  }

  printJson({
    ok: report.ok,
    mode: 'check',
    applied: false,
    wrote: false,
    gates: report.gates,
    connection: report.connection || (report.target && report.target.maskedUrl ? 'CONFIGURED' : 'NOT_CONFIGURED'),
    dryRunKind: report.dryRunKind || 'STATIC_REWRITE_NO_SQL_EXECUTE',
    target: report.target,
    migrations: report.migrations,
    migrationOrder: report.migrationOrder,
    inspection: inspection,
    note: 'check does not write. apply requires confirm env + NODE_ENV=production + schema=daily_issue',
  });
  process.exit(report.ok ? 0 : 1);
}

async function runDryRun() {
  const gates = core.evaluateProductionMigrationGates({
    requireConfirm: true,
    requireDatabaseUrl: true,
  });
  if (!gates.ok) {
    refuse('GATES_FAILED', { mode: 'dry-run', wrote: false, gates: gates });
  }

  const rewritten = core.buildRewrittenMigrations(core.PRODUCTION_SCHEMA);
  const url = resolveDailyIssueDatabaseUrl({});
  const masked = core.maskHostRef(url);

  printJson({
    ok: true,
    mode: 'dry-run',
    wrote: false,
    applied: false,
    dryRunKind: 'STATIC_REWRITE_NO_SQL_EXECUTE',
    gates: {
      ok: true,
      schema: gates.schema,
      nodeEnv: gates.nodeEnv,
      confirmOk: gates.confirmOk,
      warnings: gates.warnings,
    },
    target: {
      schema: core.PRODUCTION_SCHEMA,
      maskedUrl: masked.maskedUrl,
      projectRef: masked.projectRef,
    },
    migrations: rewritten.map(function (m) {
      return {
        order: m.order,
        id: m.id,
        fileName: m.fileName,
        checksumSha256: m.checksumSha256,
        bytes: m.bytes,
        rewrittenBytes: m.rewrittenBytes,
        rewrittenPreview: m.rewrittenSql.slice(0, 160).replace(/\s+/g, ' '),
      };
    }),
    migrationOrder: rewritten.map(function (m) {
      return m.id;
    }),
    note: 'dry-run: STATIC_REWRITE_NO_SQL_EXECUTE. no SQL executed, no transaction rollback of applied SQL',
  });
}

async function runApply() {
  const gates = core.evaluateProductionMigrationGates({
    requireConfirm: true,
    requireDatabaseUrl: true,
  });
  if (!gates.ok) {
    refuse('GATES_FAILED', { mode: 'apply', wrote: false, gates: gates });
  }

  const url = resolveDailyIssueDatabaseUrl({});
  const masked = core.maskHostRef(url);
  const executor = createExecutor();

  try {
    const result = await core.applyProductionMigrations(executor, {});
    const inspection = await core.inspectSchema(executor, core.PRODUCTION_SCHEMA);
    printJson({
      ok: true,
      mode: 'apply',
      wrote: true,
      applied: true,
      schema: core.PRODUCTION_SCHEMA,
      target: {
        maskedUrl: masked.maskedUrl,
        projectRef: masked.projectRef,
      },
      result: result,
      inspection: inspection,
    });
    if (!inspection.ok) process.exit(2);
  } catch (e) {
    refuse('APPLY_FAILED', {
      mode: 'apply',
      wrote: false,
      rolledBack: true,
      message: String(e && e.message ? e.message : e),
      code: e && e.code ? e.code : null,
      target: { maskedUrl: masked.maskedUrl, projectRef: masked.projectRef },
    });
  } finally {
    await executor.end();
  }
}

async function runVerify() {
  const gates = core.evaluateProductionMigrationGates({
    requireConfirm: false,
    requireDatabaseUrl: true,
  });
  // verify still requires production + schema; confirm optional
  const hardErrors = (gates.errors || []).filter(function (e) {
    return e.code !== 'CONFIRM_MISSING' && e.code !== 'CONFIRM_MISMATCH';
  });
  if (hardErrors.length) {
    refuse('GATES_FAILED', {
      mode: 'verify',
      wrote: false,
      gates: Object.assign({}, gates, { errors: hardErrors, ok: false }),
    });
  }

  const url = resolveDailyIssueDatabaseUrl({});
  const masked = core.maskHostRef(url);
  const migrations = core.loadMigrationFiles();
  const executor = createExecutor();
  try {
    const inspection = await core.inspectSchema(executor, core.PRODUCTION_SCHEMA);
    printJson({
      ok: inspection.ok,
      mode: 'verify',
      wrote: false,
      schema: core.PRODUCTION_SCHEMA,
      target: { maskedUrl: masked.maskedUrl, projectRef: masked.projectRef },
      migrations: migrations.map(function (m) {
        return {
          order: m.order,
          id: m.id,
          fileName: m.fileName,
          checksumSha256: m.checksumSha256,
        };
      }),
      inspection: inspection,
    });
    process.exit(inspection.ok ? 0 : 1);
  } finally {
    await executor.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode) {
    refuse('MODE_REQUIRED', {
      usage: [
        'node tools/run-daily-issue-production-migrate.js check',
        'node tools/run-daily-issue-production-migrate.js dry-run',
        'node tools/run-daily-issue-production-migrate.js apply',
        'node tools/run-daily-issue-production-migrate.js verify',
      ],
      productionSchema: core.PRODUCTION_SCHEMA,
      confirmEnv: core.CONFIRM_ENV,
      confirmValue: core.CONFIRM_VALUE,
    });
  }

  if (args.mode === 'check') return runCheck();
  if (args.mode === 'dry-run') return runDryRun();
  if (args.mode === 'apply') return runApply();
  if (args.mode === 'verify') return runVerify();
  refuse('UNKNOWN_MODE', { mode: args.mode });
}

main().catch(function (e) {
  printJson({
    ok: false,
    error: 'UNEXPECTED',
    message: String(e && e.message ? e.message : e),
  });
  process.exit(1);
});
