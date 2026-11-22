'use strict';
/**
 * 후보 공감 RPC를 격리 Postgres에만 적용한다.
 * 미국 반응은 한국 점수를 읽지 않고 NULL을 남긴다. 운영 DB는 열지 않는다.
 * node tools/test-reaction-rpc-country.js
 */
const fs = require('fs');
const path = require('path');
const live = require('../server/rank-live-source-adapter');
const formula = require('../shared/rank-formula-core');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KR_POST = '11111111-1111-4111-8111-111111111111';
const US_POST = '22222222-2222-4222-8222-222222222222';
const BLANK_POST = '33333333-3333-4333-8333-333333333333';

function line(ok, name) {
  return (ok ? 'PASS ' : 'FAIL ') + name;
}

function wednesdayMs() {
  let ms = Date.UTC(2026, 10, 10, 15, 0, 0);
  for (let i = 0; i < 14; i += 1) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
    ms += formula.DAY_MS;
  }
  throw new Error('wednesday not found');
}

async function applyCandidate(client) {
  const file = path.join(__dirname, '..', 'supabase', 'migration_reaction_snapshot_consent_recheck_candidate.sql');
  const bundle = path.join(__dirname, '..', 'supabase', 'migration_country_beta_bundle_candidate.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const cut = sql.indexOf('REVOKE ALL');
  await client.query(cut >= 0 ? sql.slice(0, cut) : sql);
  await client.query(fs.readFileSync(bundle, 'utf8'));
}

async function main() {
  const lines = [];
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN reaction-rpc: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN reaction-rpc: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'reaction_rpc_country_' + process.pid;
  let client = null;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $fn$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $fn$;
      CREATE OR REPLACE FUNCTION public.board_reaction_group(p_type text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $fn$
        SELECT CASE
          WHEN p_type IN ('LIKE', 'RECOMMEND') THEN 'POSITIVE'
          WHEN p_type IN ('DISLIKE', 'DOWNVOTE') THEN 'NEGATIVE'
          ELSE NULL
        END;
      $fn$;
      CREATE TABLE public.user_alignment_state (user_id uuid PRIMARY KEY, score numeric(20,6));
      CREATE TABLE public.user_legal_consents (
        user_id uuid PRIMARY KEY,
        age_requirement_confirmed_at timestamptz,
        age_policy_version text,
        sensitive_political_consented_at timestamptz,
        sensitive_political_policy_version text,
        territory_disclosure_consented_at timestamptz,
        territory_disclosure_policy_version text
      );
      CREATE TABLE public.board_posts (
        id uuid PRIMARY KEY,
        author_user_id uuid,
        status text,
        territory text,
        activity_region text,
        title text,
        earth_positive_count integer NOT NULL DEFAULT 0,
        earth_negative_count integer NOT NULL DEFAULT 0,
        alien_positive_count integer NOT NULL DEFAULT 0,
        alien_negative_count integer NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY,
        post_id uuid,
        author_user_id uuid,
        status text,
        activity_region text,
        earth_positive_count integer NOT NULL DEFAULT 0,
        earth_negative_count integer NOT NULL DEFAULT 0,
        alien_positive_count integer NOT NULL DEFAULT 0,
        alien_negative_count integer NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.board_reactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id uuid,
        target_type text,
        post_id uuid,
        comment_id uuid,
        target_author_user_id uuid,
        reaction_type text,
        reaction_group text,
        audience_scope text,
        actor_territory_at_reaction text,
        target_author_territory_at_reaction text,
        actor_alignment_score_at_reaction numeric(20,6),
        target_author_alignment_score_at_reaction numeric(20,6),
        activity_region text,
        cancelled_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.user_activity_region_profile (
        user_id uuid,
        activity_region text,
        reputation_score bigint,
        xp bigint,
        PRIMARY KEY (user_id, activity_region)
      );
    `);
    const missingRank = await live.dryRun(client, {
      country: 'KR', territory: 'pioneer', asOfMs: wednesdayMs(),
    });
    lines.push(line(missingRank.reason === 'COUNTRY_COLUMN_MISSING' && missingRank.applied === false, '1-rank-missing-territory-column'));
    const usRank = await live.dryRun(client, { country: 'US', territory: 'pioneer', asOfMs: wednesdayMs() });
    lines.push(line(usRank.reason === 'NOT_REFRESH_MOMENT', '2-us-rank-stays-blocked'));
    await client.query('ALTER TABLE public.user_activity_region_profile ADD COLUMN territory text');
    await client.query(
      `INSERT INTO public.user_alignment_state (user_id, score) VALUES ($1, 7.5), ($2, 7.5)`,
      [A, B]
    );
    await client.query(
      `INSERT INTO public.user_legal_consents
        (user_id, age_requirement_confirmed_at, age_policy_version,
         sensitive_political_consented_at, sensitive_political_policy_version,
         territory_disclosure_consented_at, territory_disclosure_policy_version)
       VALUES ($1, now(), 'age-policy-v1', now(), 'sensitive-political-v1', now(), 'territory-disclosure-v1'),
              ($2, now(), 'age-policy-v1', now(), 'sensitive-political-v1', now(), 'territory-disclosure-v1')`,
      [A, B]
    );
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, status, territory, activity_region, title)
       VALUES ($1,$2,'ACTIVE','CENTRAL','KR','한국 글'),
              ($3,$2,'ACTIVE','CENTRAL','US','US post'),
              ($4,$2,'ACTIVE','CENTRAL',NULL,'국가 없는 옛 글')`,
      [KR_POST, B, US_POST, BLANK_POST]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region, reputation_score, xp, territory)
       VALUES ($1,'KR',10,3,'CENTRAL'), ($1,'US',4,1,'CENTRAL')`,
      [B]
    );
    await applyCandidate(client);
    const def = await client.query(`SELECT pg_get_functiondef('public.toggle_board_reaction(text,uuid,text,text,text,text)'::regprocedure) AS def`);
    const body = def.rows[0].def;
    lines.push(line(
      body.indexOf('COALESCE((SELECT score') < 0 && body.indexOf("IS DISTINCT FROM 'US'") >= 0,
      '3-function-does-not-fill-missing-score-with-zero'
    ));
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [A]);
    const kr = await client.query(
      `SELECT public.toggle_board_reaction('POST', $1, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL') AS result`,
      [KR_POST]
    );
    const krRow = await client.query(
      `SELECT actor_alignment_score_at_reaction AS actor_score,
              target_author_alignment_score_at_reaction AS target_score,
              activity_region, cancelled_at
       FROM public.board_reactions WHERE post_id = $1 AND reaction_type = 'LIKE'`,
      [KR_POST]
    );
    lines.push(line(
      kr.rows[0].result.action === 'CREATED' &&
      Number(krRow.rows[0].actor_score) === 7.5 && Number(krRow.rows[0].target_score) === 7.5 &&
      krRow.rows[0].activity_region === 'KR',
      '4-kr-like-copies-korean-score'
    ));
    const us = await client.query(
      `SELECT public.toggle_board_reaction('POST', $1, 'DISLIKE', 'CENTRAL', 'EARTH', 'CENTRAL') AS result`,
      [US_POST]
    );
    const usRow = await client.query(
      `SELECT actor_alignment_score_at_reaction AS actor_score,
              target_author_alignment_score_at_reaction AS target_score,
              activity_region, reaction_type
       FROM public.board_reactions WHERE post_id = $1 AND cancelled_at IS NULL`,
      [US_POST]
    );
    lines.push(line(
      us.rows[0].result.action === 'CREATED' && usRow.rows.length === 1 &&
      usRow.rows[0].reaction_type === 'DISLIKE' &&
      usRow.rows[0].actor_score == null && usRow.rows[0].target_score == null &&
      usRow.rows[0].activity_region === 'US',
      '5-us-dislike-stores-null-not-zero'
    ));
    const cancel = await client.query(
      `SELECT public.toggle_board_reaction('POST', $1, 'DISLIKE', 'CENTRAL', 'EARTH', 'CENTRAL') AS result`,
      [US_POST]
    );
    const cancelled = await client.query(
      `SELECT cancelled_at IS NOT NULL AS gone,
              (SELECT earth_negative_count FROM public.board_posts WHERE id = $1) AS count
       FROM public.board_reactions WHERE post_id = $1`,
      [US_POST]
    );
    lines.push(line(
      cancel.rows[0].result.action === 'CANCELLED' && cancelled.rows[0].gone === true && Number(cancelled.rows[0].count) === 0,
      '6-us-cancel-works'
    ));
    let blankCode = '';
    try {
      await client.query(
        `SELECT public.toggle_board_reaction('POST', $1, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL')`,
        [BLANK_POST]
      );
    } catch (err) {
      blankCode = String(err && err.message || err);
    }
    const blankRows = await client.query('SELECT count(*)::int AS n FROM public.board_reactions WHERE post_id = $1', [BLANK_POST]);
    lines.push(line(blankCode.indexOf('COUNTRY_REQUIRED') >= 0 && blankRows.rows[0].n === 0, '7-blank-post-is-not-treated-as-korea'));
    const fame = await client.query(
      `SELECT activity_region, reputation_score, xp
       FROM public.user_activity_region_profile WHERE user_id = $1 ORDER BY activity_region`,
      [B]
    );
    const order = await client.query('SELECT public.country_beta_bundle_order() AS marker');
    const triggerDef = await client.query(`SELECT pg_get_functiondef('public.board_reaction_same_activity_region()'::regprocedure) AS def`);
    lines.push(line(
      fame.rows.length === 2 && fame.rows[0].activity_region === 'KR' && Number(fame.rows[0].reputation_score) === 10 &&
      Number(fame.rows[0].xp) === 3 && fame.rows[1].activity_region === 'US' && Number(fame.rows[1].reputation_score) === 4 &&
      order.rows[0].marker === 'use-migration-country-beta-apply' &&
      triggerDef.rows[0].def.indexOf("THEN 'KR'") < 0,
      '8-fame-xp-unchanged-and-blank-is-not-rewritten'
    ));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (client) {
      try { await client.end(); } catch (_e) { /* 닫기 */ }
    }
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
      await admin.query('DROP DATABASE IF EXISTS ' + dbName);
    } catch (_drop) { /* 정리 */ }
    try { await admin.end(); } catch (_e) { /* 닫기 */ }
  }
  const failed = lines.filter(function (row) { return row.indexOf('FAIL') === 0; });
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write(failed.length ? 'RESULT FAIL\n' : 'RESULT PASS\n');
  if (failed.length) process.exit(1);
}

main().catch(function (err) {
  process.stdout.write('FAIL runner ' + String(err && err.stack || err) + '\n');
  process.exit(1);
});
