'use strict';

/**
 * Daily Issue 전용 빈 로컬 DB — embedded-postgres + daily_issue_test schema.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { bootDailyIssueLocalPg, DEFAULT_SCHEMA } = require('./daily-issue-local-pg-harness');
const { assertDailyIssueIsolatedTarget } = require('./daily-issue-isolated-target');

function embeddedPostgresPath() {
  return path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js');
}

async function bootDailyIssueIsolated(options) {
  const opts = options || {};
  const pgPath = embeddedPostgresPath();
  if (!fs.existsSync(pgPath)) {
    return { ok: false, reason: 'embedded-postgres-missing', path: pgPath };
  }

  const boot = await bootDailyIssueLocalPg({
    schemaName: opts.schemaName || DEFAULT_SCHEMA,
    port: opts.port,
    databaseName: opts.databaseName || 'daily_issue_isolated_' + Date.now().toString(36),
  });
  if (!boot.ok) {
    return { ok: false, reason: boot.error || 'BOOT_FAILED', detail: boot };
  }

  const gate = assertDailyIssueIsolatedTarget(boot.connectionString, boot.schemaName);
  if (!gate.ok) {
    await boot.shutdown();
    return { ok: false, reason: gate.reason || 'TARGET_REFUSED', gate: gate };
  }

  console.log(
    'DAILY_ISSUE_ISOLATED_BOOT',
    'host=127.0.0.1',
    'schema=' + boot.schemaName,
    'database=' + gate.database,
  );

  return {
    ok: true,
    url: boot.connectionString,
    schemaName: boot.schemaName,
    cluster: boot.cluster,
    client: boot.client,
    async shutdown() {
      await boot.shutdown();
    },
  };
}

module.exports = {
  bootDailyIssueIsolated: bootDailyIssueIsolated,
  embeddedPostgresPath: embeddedPostgresPath,
};
