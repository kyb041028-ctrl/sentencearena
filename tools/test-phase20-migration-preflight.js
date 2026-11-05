#!/usr/bin/env node
'use strict';

/**
 * Phase 20 step 2 — migration preflight on empty embedded Postgres only.
 * No Supabase, no production migrator apply, no REAL Auth.
 */

const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const pubCore = require('../shared/production-public-migration-core');
const orders = require('../shared/migration-preflight-orders');
const {
  applySql,
  ensureSupabaseStubRoles,
  TEST_USER,
} = require('./lib/daily-issue-local-pg-harness');

const DI_SCHEMA = 'daily_issue_preflight';
const BASE_HEAD = '4f92d0d5d3f2db70bf7a7af2bee9d490ca2a7401';

let failed = 0;

function report(key, verdict, detail) {
  console.log('PHASE20_PREFLIGHT ' + key + ' ' + verdict + (detail ? ' ' + detail : ''));
  if (verdict === 'FAIL') failed += 1;
}

async function bootClient() {
  const mod = await import(
    pathToFileURL(path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href
  );
  const EmbeddedPostgres = mod.default;
  const port = 55450 + Math.floor(Math.random() * 150);
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), 'phase20-preflight-' + Date.now()),
    port: port,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: function () {},
    onError: function () {},
  });
  await cluster.initialise();
  await cluster.start();
  const dbName = 'phase20_preflight';
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
    [TEST_USER, 'preflight@example.com'],
  );
  await ensureSupabaseStubRoles(client);
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  return {
    client: client,
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

async function main() {
  report('baseline_head', 'INFO', BASE_HEAD);

  const depMissing = pubCore.assertCatalogDependencies();
  report('catalog_deps', depMissing.length === 0 ? 'PASS' : 'FAIL', 'missing=' + depMissing.join(';'));

  const conflict = orders.DO_NOT_APPLY_PUBLIC_FILES.indexOf('migration_user_data_system.sql') >= 0;
  report(
    'user_data_system_class',
    conflict ? 'PASS' : 'FAIL',
    'DO_NOT_APPLY in production-public catalog',
  );

  let boot;
  try {
    boot = await bootClient();
    const client = boot.client;

    for (let i = 0; i < orders.OFFICIAL_PUBLIC_REQUIRED_FILES.length; i += 1) {
      const f = orders.OFFICIAL_PUBLIC_REQUIRED_FILES[i];
      const r = await applySql(client, 'public:' + f, f, null);
      if (!r.ok) {
        report('public_apply', 'FAIL', f + ' ' + r.error);
        break;
      }
      if (i === orders.OFFICIAL_PUBLIC_REQUIRED_FILES.length - 1) {
        report('public_apply', 'PASS', 'count=' + orders.OFFICIAL_PUBLIC_REQUIRED_FILES.length);
      }
    }

    const insp = await pubCore.inspectPublicSchema({
      query: function (sql, params) {
        return client.query(sql, params);
      },
    });
    report(
      'public_inspect',
      insp.ok ? 'PASS' : 'FAIL',
      insp.ok ? 'tables=' + insp.tableCount : (insp.missingTables && insp.missingTables.join(',')) || 'missing',
    );

    await client.query('CREATE SCHEMA IF NOT EXISTS "' + DI_SCHEMA.replace(/"/g, '') + '"');
    for (let j = 0; j < orders.STAGING_DAILY_ISSUE_ALL.length; j += 1) {
      const df = orders.STAGING_DAILY_ISSUE_ALL[j];
      const dr = await applySql(client, 'di:' + df, df, DI_SCHEMA);
      if (!dr.ok) {
        report('daily_issue_apply', 'FAIL', df + ' ' + dr.error);
        break;
      }
      if (j === orders.STAGING_DAILY_ISSUE_ALL.length - 1) {
        report('daily_issue_apply', 'PASS', 'schema=' + DI_SCHEMA + ' count=' + orders.STAGING_DAILY_ISSUE_ALL.length);
      }
    }

    const halt = await client.query(
      'SELECT COUNT(*)::int AS n FROM ' + DI_SCHEMA + '.daily_issue_emergency_halt',
    );
    const usRuns = await client.query(
      'SELECT COUNT(*)::int AS n FROM ' + DI_SCHEMA + '.daily_issue_us_scheduler_runs',
    );
    const arCol = await client.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='daily_issue_review_items' AND column_name='activity_region'",
      [DI_SCHEMA],
    );
    report(
      'di_phase19_objects',
      halt.rows[0].n >= 0 && usRuns.rows[0].n === 0 && arCol.rows[0].n === 1 ? 'PASS' : 'FAIL',
      'halt_rows=' + halt.rows[0].n + ' us_runs_table=ok activity_region_col=' + arCol.rows[0].n,
    );

    const dup = await applySql(client, 'dup:review_lifecycle', 'migration_daily_issue_review_lifecycle.sql', DI_SCHEMA);
    report('idempotent_reapply', dup.ok ? 'PASS' : 'FAIL', dup.error || 'IF NOT EXISTS ok');

    const stubPath = path.join(__dirname, 'lib', 'plan-activity-region-v2-dependency-stub.sql');
    const stubSql = fs.readFileSync(stubPath, 'utf8');
    await client.query(stubSql);
    report('plan_v2_dependency_stub', 'LOCAL_STUB PASS', 'not official catalog');

    const plan = await applySql(
      client,
      'plan:activity_region_v2',
      'migration_activity_region_v2.sql',
      null,
    );
    report(
      'plan_only_activity_region_v2',
      plan.ok ? 'PLAN_ONLY_SMOKE PASS' : 'FAIL',
      plan.error || 'not in official public catalog',
    );

    const br = await client.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='board_posts' AND column_name='activity_region'",
    );
    report(
      'kr_us_board_column',
      br.rows[0].n === 1 ? 'PLAN_ONLY PASS' : 'FAIL',
      'board_posts.activity_region=' + br.rows[0].n,
    );
  } catch (e) {
    report('isolated_boot', 'FAIL', String(e.message || e).slice(0, 200));
  } finally {
    if (boot) await boot.shutdown();
  }

  if (failed) {
    console.log('PHASE20_PREFLIGHT_VERDICT FAIL failed=' + failed);
    process.exit(1);
  }
  console.log('PHASE20_PREFLIGHT_VERDICT PASS');
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
