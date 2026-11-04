'use strict';

/**
 * 로컬 embedded Postgres — 운영 Supabase 미사용.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SUPABASE = path.join(ROOT, 'supabase');

const DEFAULT_SCHEMA = 'daily_issue_test';
const TEST_USER = '11111111-1111-4111-8111-111111111111';

function rewriteSchema(sql, schema) {
  if (!schema || schema === 'public') return sql;
  return String(sql || '').replace(/\bpublic\.(daily_issue_[a-z0-9_]+)/gi, schema + '.$1');
}

function meaningful(stmt) {
  const noBlock = String(stmt).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const noLine = noBlock.replace(/--[^\n]*/g, ' ');
  return noLine.trim().length > 0;
}

function splitSql(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let dollar = null;
  while (i < sql.length) {
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        buf += dollar;
        i += dollar.length;
        dollar = null;
        continue;
      }
      buf += sql[i];
      i += 1;
      continue;
    }
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl < 0 ? sql.length : nl + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === "'") {
      buf += sql[i];
      i += 1;
      while (i < sql.length) {
        buf += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            buf += sql[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (sql[i] === '$') {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) {
        dollar = m[0];
        buf += dollar;
        i += dollar.length;
        continue;
      }
    }
    if (sql[i] === ';') {
      if (meaningful(buf)) out.push(buf.trim());
      buf = '';
      i += 1;
      continue;
    }
    buf += sql[i];
    i += 1;
  }
  if (meaningful(buf)) out.push(buf.trim());
  return out;
}

async function ensureSupabaseStubRoles(client) {
  const roles = ['anon', 'authenticated', 'service_role'];
  for (let i = 0; i < roles.length; i += 1) {
    const name = roles[i];
    try {
      await client.query('CREATE ROLE "' + name.replace(/"/g, '') + '" NOLOGIN');
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (msg.indexOf('already exists') < 0) throw err;
    }
  }
}

async function applySql(client, label, fileName, schema) {
  const full = path.join(SUPABASE, fileName);
  if (!fs.existsSync(full)) {
    throw new Error('migration missing: ' + fileName);
  }
  const raw = fs.readFileSync(full, 'utf8');
  const sql = rewriteSchema(raw, schema);
  const parts = splitSql(sql);
  try {
    for (let i = 0; i < parts.length; i += 1) {
      await client.query(parts[i]);
    }
    return { ok: true, label: label };
  } catch (err) {
    return {
      ok: false,
      label: label,
      error: String(err && err.message ? err.message : err).split('\n')[0],
    };
  }
}

async function bootDailyIssueLocalPg(options) {
  const opt = options || {};
  const schema = opt.schemaName || DEFAULT_SCHEMA;
  let cluster;
  let port =
    Number(opt.port) > 0 ? Number(opt.port) : 55440 + Math.floor(Math.random() * 200);
  try {
    const mod = await import(
      pathToFileURL(path.join(require('os').tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href
    );
    const EmbeddedPostgres = mod.default;
    if (!EmbeddedPostgres) {
      return { ok: false, error: 'EMBEDDED_POSTGRES_MODULE_MISSING' };
    }
    const dataDir = path.join(require('os').tmpdir(), 'sa-us-di-harness-' + Date.now());
    cluster = new EmbeddedPostgres({
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
  } catch (err) {
    const msg = String(err && err.message ? err.message : err || 'BOOT_FAILED');
    if (cluster) {
      try {
        await cluster.stop();
      } catch (_) {}
    }
    return { ok: false, error: msg.slice(0, 300) };
  }
  const dbName = opt.databaseName || 'sentencearena_us_di_11';
  await cluster.createDatabase(dbName);
  const client = cluster.getPgClient(dbName);
  await client.connect();

  await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await client.query(
    'INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [TEST_USER, 'us-di-test@example.com'],
  );

  await client.query('CREATE SCHEMA IF NOT EXISTS "' + schema.replace(/"/g, '') + '"');
  await ensureSupabaseStubRoles(client);

  const order = [
    'migration_daily_issue_review_lifecycle.sql',
    'migration_daily_issue_comments_v1.sql',
    'migration_daily_issue_alignment_seed_v1.sql',
    'migration_daily_issue_morning_scheduler.sql',
    'migration_daily_issue_us_region_candidate.sql',
  ];
  const applied = [];
  for (let i = 0; i < order.length; i += 1) {
    const r = await applySql(client, order[i], order[i], schema);
    applied.push(r);
    if (!r.ok) {
      await client.end().catch(function () {});
      await cluster.stop().catch(function () {});
      return { ok: false, error: r.error, migration: r.label, applied: applied };
    }
  }

  const url =
    'postgresql://postgres:password@127.0.0.1:' + port + '/' + dbName;
  return {
    ok: true,
    client: client,
    cluster: cluster,
    connectionString: url,
    schemaName: schema,
    testUserId: TEST_USER,
    applied: applied,
    async shutdown() {
      try {
        await client.end();
      } catch (_) {}
      try {
        await cluster.stop();
      } catch (_) {}
    },
  };
}

module.exports = {
  bootDailyIssueLocalPg: bootDailyIssueLocalPg,
  rewriteSchema: rewriteSchema,
  TEST_USER: TEST_USER,
  DEFAULT_SCHEMA: DEFAULT_SCHEMA,
};
