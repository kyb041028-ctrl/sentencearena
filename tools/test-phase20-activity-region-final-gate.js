#!/usr/bin/env node
'use strict';

/**
 * Phase 20 step 4 — final gate (isolated PG only). No Supabase, no REAL auth PASS.
 */

const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const orders = require('../shared/migration-preflight-orders');
const {
  applySql,
  ensureSupabaseStubRoles,
  TEST_USER,
} = require('./lib/daily-issue-local-pg-harness');

const USER_B = '22222222-2222-4222-8222-222222222222';
const BASE_HEAD = 'badaae2c4e92269f08fb324d9d03720119ecd9b9';

let failed = 0;

function report(key, verdict, detail) {
  console.log('PHASE20_FINAL ' + key + ' ' + verdict + (detail ? ' ' + detail : ''));
  if (verdict === 'FAIL') failed += 1;
}

async function asAuthenticated(client, userId, fn) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL role authenticated');
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
    await fn();
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function bootClient() {
  const mod = await import(
    pathToFileURL(path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href
  );
  const EmbeddedPostgres = mod.default;
  const port = 55480 + Math.floor(Math.random() * 120);
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), 'phase20-final-' + Date.now()),
    port: port,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: function () {},
    onError: function () {},
  });
  await cluster.initialise();
  await cluster.start();
  const dbName = 'phase20_final';
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
    'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING',
    [TEST_USER, 'a@example.com', USER_B, 'b@example.com'],
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

async function applyOfficialAndCandidates(client) {
  for (let i = 0; i < orders.OFFICIAL_PUBLIC_REQUIRED_FILES.length; i += 1) {
    const f = orders.OFFICIAL_PUBLIC_REQUIRED_FILES[i];
    const r = await applySql(client, f, f, null);
    if (!r.ok) return r;
  }
  for (let c = 0; c < orders.STAGING_ACTIVITY_REGION_CANDIDATES.length; c += 1) {
    const cf = orders.STAGING_ACTIVITY_REGION_CANDIDATES[c];
    const cr = await applySql(client, cf, cf, null);
    if (!cr.ok) return cr;
  }
  return { ok: true };
}

function alignmentRowsEqual(before, after) {
  return (
    before.rows.length === 1 &&
    after.rows.length === 1 &&
    Number(before.rows[0].score) === Number(after.rows[0].score) &&
    Number(before.rows[0].previous_signal) === Number(after.rows[0].previous_signal)
  );
}

async function main() {
  report('baseline_head', 'INFO', BASE_HEAD);

  let boot;
  try {
    boot = await bootClient();
    const client = boot.client;
    const applied = await applyOfficialAndCandidates(client);
    if (!applied.ok) {
      report('schema_apply', 'FAIL', applied.error);
      throw new Error('apply');
    }
    report('schema_apply', 'ISOLATED DB PASS', 'public22+candidates');

    await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");

    await client.query(
      "INSERT INTO public.profiles (id, display_name, citizenship_status) VALUES ($1, 'A', 'CITIZEN'), ($2, 'B', 'CITIZEN') ON CONFLICT (id) DO NOTHING",
      [TEST_USER, USER_B],
    );
    await client.query(
      'INSERT INTO public.user_alignment_state (user_id, score, previous_signal) VALUES ($1, 120.25, -1), ($2, 5, 0) ON CONFLICT (user_id) DO UPDATE SET score = EXCLUDED.score, previous_signal = EXCLUDED.previous_signal',
      [TEST_USER, USER_B],
    );

    await client.query(
      'INSERT INTO public.user_activity_region_profile (user_id, activity_region, level, xp) VALUES ($1, $2, 2, 20), ($1, $3, 1, 5), ($4, $2, 4, 40) ON CONFLICT DO NOTHING',
      [TEST_USER, 'KR', 'US', USER_B],
    );
    await client.query(
      'INSERT INTO public.user_activity_region_achievement (user_id, activity_region, achievement_key) VALUES ($1, $2, $3), ($4, $2, $5) ON CONFLICT DO NOTHING',
      [TEST_USER, 'KR', 'kr-badge', USER_B, 'b-kr-badge'],
    );

    let aOwnKr = 0;
    let aOwnUs = 0;
    let aSeesB = 0;
    await asAuthenticated(client, TEST_USER, async function () {
      const kr = await client.query(
        'SELECT level FROM public.user_activity_region_profile WHERE user_id = $1 AND activity_region = $2',
        [TEST_USER, 'KR'],
      );
      aOwnKr = kr.rows.length;
      const us = await client.query(
        'SELECT level FROM public.user_activity_region_profile WHERE user_id = $1 AND activity_region = $2',
        [TEST_USER, 'US'],
      );
      aOwnUs = us.rows.length;
      const peek = await client.query(
        'SELECT 1 FROM public.user_activity_region_profile WHERE user_id = $1 LIMIT 1',
        [USER_B],
      );
      aSeesB = peek.rows.length;
    });
    report(
      'rls_ab_profile_select',
      aOwnKr === 1 && aOwnUs === 1 && aSeesB === 0 ? 'ISOLATED DB PASS' : 'FAIL',
      'A_kr=' + aOwnKr + ' A_us=' + aOwnUs + ' A_sees_B=' + aSeesB,
    );

    let aAch = 0;
    let aAchB = 0;
    await asAuthenticated(client, TEST_USER, async function () {
      const own = await client.query(
        'SELECT achievement_key FROM public.user_activity_region_achievement WHERE user_id = $1',
        [TEST_USER],
      );
      aAch = own.rows.length;
      const other = await client.query(
        'SELECT 1 FROM public.user_activity_region_achievement WHERE user_id = $1',
        [USER_B],
      );
      aAchB = other.rows.length;
    });
    report(
      'rls_ab_achievement_select',
      aAch >= 1 && aAchB === 0 ? 'ISOLATED DB PASS' : 'FAIL',
      'A_ach=' + aAch + ' A_sees_B_ach=' + aAchB,
    );

    const svcCount = await client.query(
      'SELECT COUNT(*)::int AS n FROM public.user_activity_region_profile WHERE user_id = $1',
      [USER_B],
    );
    report(
      'rls_service_role_bypass',
      svcCount.rows[0].n === 1 ? 'ISOLATED DB PASS' : 'FAIL',
      'postgres sees B profile (not REAL Supabase Auth)',
    );
    report('real_supabase_auth', 'BLOCKED', 'local jwt stub only');

    const alignBefore = await client.query(
      'SELECT score::numeric AS score, previous_signal::numeric AS previous_signal FROM public.user_alignment_state WHERE user_id=$1',
      [TEST_USER],
    );
    await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region) VALUES ($1, 'CENTRAL', 'us-act', 'x', 'US')",
      [TEST_USER],
    );
    const alignAfter = await client.query(
      'SELECT score::numeric AS score, previous_signal::numeric AS previous_signal FROM public.user_alignment_state WHERE user_id=$1',
      [TEST_USER],
    );
    report(
      'kr_alignment_real_row',
      alignmentRowsEqual(alignBefore, alignAfter) ? 'ISOLATED DB PASS' : 'FAIL',
      'KR score 120.25 after US board insert',
    );

    const tampered = {
      rows: [{ score: 0, previous_signal: alignBefore.rows[0].previous_signal }],
    };
    report(
      'kr_alignment_negative_logic',
      !alignmentRowsEqual(alignBefore, tampered) ? 'ISOLATED DB PASS' : 'FAIL',
      'compare rejects score drift',
    );

    const postKr = await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region) VALUES ($1, 'CENTRAL', 'krp', 'b', NULL) RETURNING id",
      [TEST_USER],
    );
    const krPostId = postKr.rows[0].id;
    const postUs = await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region) VALUES ($1, 'CENTRAL', 'usp', 'b', 'US') RETURNING id",
      [TEST_USER],
    );
    const usPostId = postUs.rows[0].id;

    await client.query(
      "INSERT INTO public.board_comments (post_id, author_user_id, territory, content, activity_region) VALUES ($1, $2, 'CENTRAL', 'c-kr', NULL)",
      [krPostId, TEST_USER],
    );
    await client.query(
      "INSERT INTO public.board_comments (post_id, author_user_id, territory, content, activity_region) VALUES ($1, $2, 'CENTRAL', 'c-us', NULL)",
      [usPostId, TEST_USER],
    );
    await client.query(
      "INSERT INTO public.board_reactions (actor_user_id, target_author_user_id, target_type, post_id, reaction_type, reaction_group, audience_scope, actor_territory_at_reaction, target_author_territory_at_reaction, activity_region) VALUES ($1, $1, 'POST', $2, 'LIKE', 'POSITIVE', 'EARTH', 'CENTRAL', 'CENTRAL', NULL)",
      [TEST_USER, krPostId],
    );
    await client.query(
      "INSERT INTO public.board_reactions (actor_user_id, target_author_user_id, target_type, post_id, reaction_type, reaction_group, audience_scope, actor_territory_at_reaction, target_author_territory_at_reaction, activity_region) VALUES ($1, $1, 'POST', $2, 'LIKE', 'POSITIVE', 'EARTH', 'CENTRAL', 'CENTRAL', NULL)",
      [TEST_USER, usPostId],
    );

    const regions = await client.query(
      'SELECT p.id, public.activity_region_norm(p.activity_region) AS pr, public.activity_region_norm(c.activity_region) AS cr FROM public.board_posts p JOIN public.board_comments c ON c.post_id = p.id WHERE p.id IN ($1, $2)',
      [krPostId, usPostId],
    );
    let childMatch = true;
    for (let i = 0; i < regions.rows.length; i += 1) {
      if (regions.rows[i].pr !== regions.rows[i].cr) childMatch = false;
    }
    report('board_kr_us_children_match', childMatch ? 'ISOLATED DB PASS' : 'FAIL', 'comment inherits post region');

    let lockKr = false;
    try {
      await client.query("UPDATE public.board_posts SET activity_region = 'US' WHERE id = $1", [krPostId]);
    } catch (e) {
      lockKr = String(e.message || e).indexOf('REGION_IMMUTABLE_WITH_CHILDREN') >= 0;
    }
    report(
      'board_post_region_change_blocked',
      lockKr ? 'ISOLATED DB PASS' : 'FAIL',
      'KR post with comment+reaction cannot flip to US',
    );

    const krOnly = await client.query(
      "SELECT COUNT(*)::int AS n FROM public.board_posts WHERE public.activity_region_norm(activity_region)='KR'",
    );
    const usOnly = await client.query(
      "SELECT COUNT(*)::int AS n FROM public.board_posts WHERE public.activity_region_norm(activity_region)='US'",
    );
    report(
      'board_region_filter_db',
      krOnly.rows[0].n >= 1 && usOnly.rows[0].n >= 1 ? 'ISOLATED DB PASS' : 'FAIL',
      'kr=' + krOnly.rows[0].n + ' us=' + usOnly.rows[0].n + ' (app route filter separate)',
    );
    report(
      'board_kr_us_rls_public_split',
      'INFO',
      'board candidate does not add KR/US RESTRICTIVE policies; not claimed as RLS public split',
    );
  } catch (e) {
    report('run', 'FAIL', String(e.message || e).slice(0, 200));
  } finally {
    if (boot) await boot.shutdown();
  }

  if (failed) {
    console.log('PHASE20_FINAL_VERDICT FAIL failed=' + failed);
    process.exit(1);
  }
  console.log('PHASE20_FINAL_VERDICT PASS');
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
