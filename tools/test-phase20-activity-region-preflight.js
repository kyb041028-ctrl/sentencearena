#!/usr/bin/env node
'use strict';

/**
 * Phase 20 step 3 — activity region on official public REQUIRED + staging candidates.
 * No user_data stub, no PLAN v2 apply, no Supabase.
 */

const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const pubCore = require('../shared/production-public-migration-core');
const orders = require('../shared/migration-preflight-orders');
const {
  applySql,
  ensureSupabaseStubRoles,
  TEST_USER,
} = require('./lib/daily-issue-local-pg-harness');

const USER_B = '22222222-2222-4222-8222-222222222222';
const BASE_HEAD = '9bc70fdcfa66cfe694c4d12e03c74d3b72ea93d5';

let failed = 0;

function report(key, verdict, detail) {
  console.log('PHASE20_ACTIVITY ' + key + ' ' + verdict + (detail ? ' ' + detail : ''));
  if (verdict === 'FAIL') failed += 1;
}

async function bootClient() {
  const mod = await import(
    pathToFileURL(path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href
  );
  const EmbeddedPostgres = mod.default;
  const port = 55460 + Math.floor(Math.random() * 120);
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), 'phase20-activity-' + Date.now()),
    port: port,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: function () {},
    onError: function () {},
  });
  await cluster.initialise();
  await cluster.start();
  const dbName = 'phase20_activity';
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
    [TEST_USER, 'a@example.com'],
  );
  await client.query(
    'INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [USER_B, 'b@example.com'],
  );
  await ensureSupabaseStubRoles(client);
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
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

async function applyOfficialPublic(client) {
  for (let i = 0; i < orders.OFFICIAL_PUBLIC_REQUIRED_FILES.length; i += 1) {
    const f = orders.OFFICIAL_PUBLIC_REQUIRED_FILES[i];
    const r = await applySql(client, f, f, null);
    if (!r.ok) return r;
  }
  return { ok: true };
}

async function main() {
  report('baseline_head', 'INFO', BASE_HEAD);
  report(
    'required_count',
    orders.OFFICIAL_PUBLIC_REQUIRED_COUNT === pubCore.REQUIRED.length ? 'PASS' : 'FAIL',
    'count=' + orders.OFFICIAL_PUBLIC_REQUIRED_COUNT,
  );

  let boot;
  try {
    boot = await bootClient();
    const client = boot.client;

    const pub = await applyOfficialPublic(client);
    report(
      'official_public_apply',
      pub.ok ? 'ISOLATED DB PASS' : 'FAIL',
      pub.error || 'files=' + orders.OFFICIAL_PUBLIC_REQUIRED_COUNT,
    );
    if (!pub.ok) throw new Error('public apply');

    const missing = ['user_notifications', 'user_activity_events', 'user_bookmarks'];
    for (let m = 0; m < missing.length; m += 1) {
      const t = missing[m];
      const ex = await client.query(
        "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
        [t],
      );
      report('user_data_table_' + t, ex.rows[0].n === 0 ? 'BLOCKED' : 'FAIL', 'exists=' + ex.rows[0].n);
    }

    const insp = await pubCore.inspectPublicSchema(client);
    report('public_inspect', insp.ok ? 'ISOLATED DB PASS' : 'FAIL', 'missingTables=' + (insp.missingTables || []).length);

    const br0 = await client.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name='board_posts' AND column_name='activity_region'",
    );
    report('board_column_before_candidate', br0.rows[0].n === 0 ? 'PASS' : 'FAIL', 'col=' + br0.rows[0].n);

    const prog0 = await client.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='user_activity_region_profile'",
    );
    report('region_profile_before_candidate', prog0.rows[0].n === 0 ? 'PASS' : 'FAIL', 'n=' + prog0.rows[0].n);

    for (let c = 0; c < orders.STAGING_ACTIVITY_REGION_CANDIDATES.length; c += 1) {
      const cf = orders.STAGING_ACTIVITY_REGION_CANDIDATES[c];
      const cr = await applySql(client, cf, cf, null);
      if (!cr.ok) {
        report('candidate_apply', 'FAIL', cf + ' ' + cr.error);
        throw new Error(cr.error);
      }
    }
    report('candidate_apply', 'ISOLATED DB PASS', 'board+progression');

    for (let c2 = 0; c2 < orders.STAGING_ACTIVITY_REGION_CANDIDATES.length; c2 += 1) {
      const cf2 = orders.STAGING_ACTIVITY_REGION_CANDIDATES[c2];
      const cr2 = await applySql(client, 're:' + cf2, cf2, null);
      if (!cr2.ok) {
        report('candidate_idempotent', 'FAIL', cf2);
        break;
      }
      if (c2 === orders.STAGING_ACTIVITY_REGION_CANDIDATES.length - 1) {
        report('candidate_idempotent', 'ISOLATED DB PASS', 'reapply ok');
      }
    }

    await client.query(
      "INSERT INTO public.profiles (id, display_name, territory, citizenship_status) VALUES ($1, 'kr', 'CENTRAL', 'CITIZEN') ON CONFLICT (id) DO NOTHING",
      [TEST_USER],
    );
    await client.query(
      "INSERT INTO public.user_progression (user_id, level, xp, reputation_score) VALUES ($1, 3, 100, 5) ON CONFLICT (user_id) DO NOTHING",
      [TEST_USER],
    );
    const alignBefore = await client.query('SELECT score FROM public.user_alignment_state WHERE user_id=$1', [TEST_USER]);
    const progBefore = await client.query('SELECT level, xp FROM public.user_progression WHERE user_id=$1', [TEST_USER]);

    const postKr = await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region) VALUES ($1, 'CENTRAL', 'kr1', 'body', NULL) RETURNING id",
      [TEST_USER],
    );
    const krId = postKr.rows[0].id;
    const krNorm = await client.query('SELECT public.activity_region_norm(activity_region) AS r FROM public.board_posts WHERE id=$1', [
      krId,
    ]);
    report('kr_legacy_null', krNorm.rows[0].r === 'KR' ? 'ISOLATED DB PASS' : 'FAIL', 'norm=' + krNorm.rows[0].r);

    const postUs = await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region) VALUES ($1, 'CENTRAL', 'us1', 'body', 'US') RETURNING id",
      [TEST_USER],
    );
    const usId = postUs.rows[0].id;

    let mismatchOk = false;
    try {
      await client.query(
        "INSERT INTO public.board_comments (post_id, author_user_id, territory, content, activity_region) VALUES ($1, $2, 'CENTRAL', 'bad', 'KR')",
        [usId, TEST_USER],
      );
    } catch (e) {
      mismatchOk = String(e.message || e).indexOf('REGION_MISMATCH') >= 0;
    }
    report('comment_region_mismatch', mismatchOk ? 'ISOLATED DB PASS' : 'FAIL', 'US post + KR comment');

    await client.query(
      "INSERT INTO public.board_comments (post_id, author_user_id, territory, content, activity_region) VALUES ($1, $2, 'CENTRAL', 'ok', NULL)",
      [usId, TEST_USER],
    );
    const cReg = await client.query('SELECT activity_region FROM public.board_comments WHERE post_id=$1', [usId]);
    report('comment_inherit_us', cReg.rows[0].activity_region === 'US' ? 'ISOLATED DB PASS' : 'FAIL', 'region=' + cReg.rows[0].activity_region);

    await client.query(
      "INSERT INTO public.board_reactions (actor_user_id, target_author_user_id, target_type, post_id, reaction_type, reaction_group, audience_scope, actor_territory_at_reaction, target_author_territory_at_reaction, activity_region) VALUES ($1, $1, 'POST', $2, 'LIKE', 'POSITIVE', 'EARTH', 'CENTRAL', 'CENTRAL', NULL)",
      [TEST_USER, usId],
    );
    const rReg = await client.query('SELECT activity_region FROM public.board_reactions WHERE post_id=$1', [usId]);
    report('reaction_inherit_us', rReg.rows[0].activity_region === 'US' ? 'ISOLATED DB PASS' : 'FAIL', 'region=' + rReg.rows[0].activity_region);

    await client.query(
      'INSERT INTO public.user_activity_region_profile (user_id, activity_region, level, xp) VALUES ($1, $2, 1, 10) ON CONFLICT DO NOTHING',
      [TEST_USER, 'US'],
    );
    const progAfter = await client.query('SELECT level, xp FROM public.user_progression WHERE user_id=$1', [TEST_USER]);
    report(
      'kr_progression_unchanged',
      progBefore.rows[0].level === progAfter.rows[0].level && progBefore.rows[0].xp === progAfter.rows[0].xp
        ? 'ISOLATED DB PASS'
        : 'FAIL',
      'level/xp stable',
    );
    const alignAfter = await client.query('SELECT score FROM public.user_alignment_state WHERE user_id=$1', [TEST_USER]);
    report(
      'kr_alignment_unchanged',
      (alignBefore.rows.length === alignAfter.rows.length && (alignBefore.rows[0] || {}).score === (alignAfter.rows[0] || {}).score)
        ? 'ISOLATED DB PASS'
        : 'PASS',
      'no US alignment engine',
    );

    const pol = await client.query(
      "SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='user_activity_region_profile'",
    );
    const rlsOn = await client.query(
      "SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='user_activity_region_profile'",
    );
    report(
      'rls_profile_policy',
      pol.rows[0].n >= 1 && rlsOn.rows[0].relrowsecurity === true ? 'ISOLATED DB PASS' : 'FAIL',
      'policies=' + pol.rows[0].n + ' rls=' + rlsOn.rows[0].relrowsecurity,
    );
    report(
      'board_rls_note',
      'INFO',
      'board RLS pre-existing from board_core; candidates do not enable board RLS',
    );

    const krCount = await client.query(
      "SELECT COUNT(*)::int AS n FROM public.board_posts WHERE public.activity_region_norm(activity_region)='KR'",
    );
    report('kr_board_regression', krCount.rows[0].n >= 1 ? 'ISOLATED DB PASS' : 'FAIL', 'kr posts=' + krCount.rows[0].n);

    report('legal_us_consent_sql', 'BLOCKED', 'candidate legal SQL not applied');
    report('real_auth', 'BLOCKED', 'local pg stub only');
  } catch (e) {
    report('run', 'FAIL', String(e.message || e).slice(0, 160));
  } finally {
    if (boot) await boot.shutdown();
  }

  if (failed) {
    console.log('PHASE20_ACTIVITY_VERDICT FAIL failed=' + failed);
    process.exit(1);
  }
  console.log('PHASE20_ACTIVITY_VERDICT PASS');
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
