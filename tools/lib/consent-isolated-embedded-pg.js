'use strict';

/**
 * 빈 로컬 DB consent_isolated — embedded-postgres만. 운영·기존 DB 접속 없음.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const DEFAULT_PORT = 55447;

function embeddedPostgresPath() {
  return path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js');
}

function assertLocalTarget(url) {
  const { isolatedTarget } = require('../test-consent-five-sql-integration.js');
  return isolatedTarget(url);
}

async function bootConsentIsolated(options) {
  const opts = options || {};
  const port = opts.port || DEFAULT_PORT;
  const pgPath = embeddedPostgresPath();
  if (!fs.existsSync(pgPath)) {
    return { ok: false, reason: 'embedded-postgres-missing', path: pgPath };
  }

  const mod = await import(pathToFileURL(pgPath).href);
  const EmbeddedPostgres = mod.default;
  const dataDir = path.join(os.tmpdir(), 'sa-consent-isolated-' + Date.now());
  const cluster = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: port,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: function () {},
    onError: function () {},
  });

  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase('consent_isolated');

  const client = cluster.getPgClient('consent_isolated');
  await client.connect();
  const row = await client.query('SELECT current_database() AS db, inet_server_addr()::text AS host');
  const dbName = row.rows[0] && row.rows[0].db;
  const host = row.rows[0] && row.rows[0].host;
  await client.end();

  if (dbName !== 'consent_isolated') {
    await cluster.stop();
    return { ok: false, reason: 'database-name-mismatch', dbName: dbName };
  }

  const url = 'postgresql://postgres:password@127.0.0.1:' + port + '/consent_isolated';
  const gate = assertLocalTarget(url);
  if (!gate.ok) {
    await cluster.stop();
    return { ok: false, reason: gate.reason || 'target-refused' };
  }

  console.log('CONSENT_ISOLATED_BOOT', 'host=127.0.0.1', 'port=' + port, 'database=consent_isolated', 'server=' + (host || 'local'));
  return {
    ok: true,
    url: url,
    port: port,
    dataDir: dataDir,
    cluster: cluster,
    async stop() {
      try {
        await cluster.stop();
      } catch (_) {}
    },
  };
}

module.exports = {
  bootConsentIsolated: bootConsentIsolated,
  embeddedPostgresPath: embeddedPostgresPath,
  DEFAULT_PORT: DEFAULT_PORT,
};
