#!/usr/bin/env node
'use strict';

/**
 * Production public-schema migration CLI
 * modes: check | dry-run | apply | verify
 *
 * This workspace task must not run apply.
 * apply requires NODE_ENV=production + PUBLIC_SCHEMA_CONFIRM_PRODUCTION_MIGRATION.
 */

require('dotenv').config();

const core = require('../shared/production-public-migration-core');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
} = require('../server/daily-issue-pg-client');

function parseArgs(argv) {
  const out = { mode: null };
  argv.forEach(function (a) {
    if (a === 'check' || a === 'dry-run' || a === 'apply' || a === 'verify') out.mode = a;
  });
  return out;
}

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function refuse(code, extra) {
  printJson(Object.assign({ ok: false, error: code, wrote: false }, extra || {}));
  process.exit(1);
}

function createExecutor() {
  const url = resolveDailyIssueDatabaseUrl({});
  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!executor.ok) {
    refuse('DATABASE_UNAVAILABLE', {
      message: executor.message || 'pg executor unavailable',
      target: url ? core.maskHostRef(url) : { maskedUrl: null },
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
  printJson(
    Object.assign({}, report, {
      applied: false,
      wrote: false,
      note:
        'check is static validation only. PRODUCTION_DB_CONNECTION=' +
        report.connection +
        '. apply is not run.',
    })
  );
  process.exit(report.ok ? 0 : 1);
}

async function runDryRun() {
  const report = core.buildPreflightReport({
    mode: 'dry-run',
    requireConfirm: false,
    requireDatabaseUrl: false,
    requireNodeEnv: false,
  });
  printJson(
    Object.assign({}, report, {
      applied: false,
      wrote: false,
      note: 'dry-run: STATIC_VALIDATION_NO_SQL_EXECUTE. No transaction, no SQL execute, no rollback-of-applied-SQL.',
    })
  );
  process.exit(report.ok ? 0 : 1);
}

async function runApply() {
  const url = resolveDailyIssueDatabaseUrl({});
  if (url && core.isLocalDatabaseHost(url)) {
    refuse('GATES_FAILED', {
      mode: 'apply',
      gates: { ok: false, errors: [{ ok: false, code: 'LOCALHOST_DB_FORBIDDEN' }] },
    });
  }
  const gates = core.evaluateProductionPublicMigrationGates({
    requireConfirm: true,
    requireDatabaseUrl: true,
    requireNodeEnv: true,
    forbidLocalhost: true,
    refuseDailyIssueTestSchema: true,
  });
  if (!gates.ok) refuse('GATES_FAILED', { mode: 'apply', gates: gates });
  const masked = core.maskHostRef(url);
  const executor = createExecutor();
  try {
    const result = await core.applyProductionPublicMigrations(executor, {});
    const inspection = await core.inspectPublicSchema(executor);
    printJson({
      ok: inspection.ok,
      mode: 'apply',
      wrote: true,
      applied: true,
      schema: 'public',
      target: masked,
      result: result,
      inspection: inspection,
    });
    if (!inspection.ok) process.exit(2);
  } catch (e) {
    refuse('APPLY_FAILED', {
      mode: 'apply',
      rolledBack: true,
      message: String(e && e.message ? e.message : e),
      code: e && e.code ? e.code : null,
      target: masked,
    });
  } finally {
    await executor.end();
  }
}

async function runVerify() {
  const gates = core.evaluateProductionPublicMigrationGates({
    requireConfirm: false,
    requireDatabaseUrl: true,
    requireNodeEnv: true,
    forbidLocalhost: true,
    refuseDailyIssueTestSchema: true,
  });
  const hard = (gates.errors || []).filter(function (e) {
    return e.code !== 'CONFIRM_MISSING' && e.code !== 'CONFIRM_MISMATCH';
  });
  if (hard.length) refuse('GATES_FAILED', { mode: 'verify', gates: Object.assign({}, gates, { errors: hard, ok: false }) });
  const url = resolveDailyIssueDatabaseUrl({});
  const masked = core.maskHostRef(url);
  const executor = createExecutor();
  try {
    const inspection = await core.inspectPublicSchema(executor);
    printJson({
      ok: inspection.ok,
      mode: 'verify',
      wrote: false,
      schema: 'public',
      target: masked,
      inspection: inspection,
      migrations: core.buildPreflightReport({ requireConfirm: false, requireDatabaseUrl: false }).migrations.map(function (m) {
        return { order: m.order, id: m.id, fileName: m.fileName, checksumSha256: m.checksumSha256 };
      }),
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
        'node tools/run-production-public-migrate.js check',
        'node tools/run-production-public-migrate.js dry-run',
        'node tools/run-production-public-migrate.js apply',
        'node tools/run-production-public-migrate.js verify',
      ],
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
  printJson({ ok: false, error: 'UNEXPECTED', message: String(e && e.message ? e.message : e) });
  process.exit(1);
});
