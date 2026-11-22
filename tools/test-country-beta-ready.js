'use strict';
/**
 * 운영형 스키마가 이미 있는 격리 DB에 베타 진입 SQL을 적용하고 핵심만 확인한다.
 * node tools/test-country-beta-ready.js
 */
const fs = require('fs');
const path = require('path');
const { createCountryProgressionStore } = require('../server/country-progression-store');
const userDataRepo = require('../server/user-data-supabase-repository');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function line(ok, name) {
  return (ok ? 'PASS ' : 'FAIL ') + name;
}

function sqlFile(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'supabase', name), 'utf8');
}

async function main() {
  const lines = [];
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN country-beta-ready: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-beta-ready: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'country_beta_ready_' + process.pid;
  let client = null;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $fn$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $fn$;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text
      );
      INSERT INTO auth.users (id, email) VALUES
        ('${A}', 'a@example.com'),
        ('${B}', 'b@example.com');
    `);
    const baseFiles = [
      'schema_profiles_identity_history.sql',
      'migration_board_core_system.sql',
      'migration_user_data_system.sql',
      'migration_political_alignment_persistence.sql',
      'migration_political_alignment_beta_v1.sql',
    ];
    for (let i = 0; i < baseFiles.length; i += 1) {
      await client.query(sqlFile(baseFiles[i]));
    }
    await client.query(
      `INSERT INTO public.profiles (id, display_name) VALUES ($1, '가'), ($2, '나')`,
      [A, B]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, xp, level, reputation_score)
       VALUES ($1, 80, 4, 99)`,
      [A]
    );
    await client.query(
      `INSERT INTO public.board_posts
        (id, author_user_id, territory, title, content, status)
       VALUES ('11111111-1111-4111-8111-111111111111', $1, 'CENTRAL', '국가 없는 옛 글', '본문', 'ACTIVE')`,
      [A]
    );
    await client.query(
      `INSERT INTO public.user_follows (follower_user_id, following_user_id)
       VALUES ($1, $2)`,
      [A, B]
    );
    const before = await client.query(
      `SELECT
         (SELECT reputation_score FROM public.user_progression WHERE user_id = $1) AS fame,
         (SELECT count(*)::int FROM public.board_posts) AS posts,
         (SELECT count(*)::int FROM public.user_follows) AS follows`,
      [A]
    );
    await client.query(sqlFile('migration_country_beta_apply.sql'));
    await client.query(sqlFile('migration_country_beta_apply.sql'));
    const after = await client.query(
      `SELECT
         (SELECT reputation_score FROM public.user_progression WHERE user_id = $1) AS fame,
         (SELECT activity_region FROM public.board_posts WHERE title = '국가 없는 옛 글') AS region,
         (SELECT count(*)::int FROM public.profiles) AS people,
         (SELECT count(*)::int FROM public.user_follows) AS follows,
         (SELECT count(*)::int FROM information_schema.columns
            WHERE table_name = 'board_posts' AND column_name = 'activity_region') AS region_col`,
      [A]
    );
    lines.push(line(
      Number(before.rows[0].fame) === 99 && Number(after.rows[0].fame) === 99 &&
      after.rows[0].region == null && Number(after.rows[0].people) === 2 &&
      Number(after.rows[0].follows) === Number(before.rows[0].follows) &&
      Number(after.rows[0].region_col) === 1,
      '1-existing-rows-kept-and-column-added'
    ));

    let typeCode = '';
    try {
      await client.query(`SELECT public.country_beta_require_column('profiles', 'display_name', 'integer', 'integer')`);
    } catch (err) {
      typeCode = String(err && err.message || err);
    }
    lines.push(line(typeCode.indexOf('COUNTRY_BETA_COLUMN_TYPE_MISMATCH') >= 0, '2-type-mismatch-is-an-error'));

    await client.query(
      `INSERT INTO public.user_activity_region_profile
        (user_id, activity_region, xp, level, reputation_score, territory)
       VALUES ($1, 'KR', 30, 2, 12, 'pioneer'),
              ($1, 'US', 10, 1, 5, 'central')`,
      [A]
    );
    const store = createCountryProgressionStore({
      query: function (text, params) { return client.query(text, params); },
    });
    const kr = await store.read(A, 'KR');
    const us = await store.read(A, 'US');
    userDataRepo.setAdminClient({
      query: function (text, params) { return client.query(text, params); },
    });
    const other = await userDataRepo.getPublicProgression(A, 'US');
    const mine = await userDataRepo.getProgression(A, 'KR');
    lines.push(line(
      kr.fame === 12 && kr.xp === 30 && kr.level === 2 &&
      us.fame === 5 && us.xp === 10 && us.level === 1 &&
      Number(mine.reputation_score) === 12 && Number(mine.xp) === 30 && Number(mine.level) === 2 &&
      Number(other.reputation_score) === 5 && Number(other.level) === 1 &&
      kr.fame !== 99 && us.fame !== 99,
      '3-screen-source-reads-country-not-shared-99'
    ));

    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [A]);
    await client.query(`SELECT set_config('request.jwt.claim.country', 'KR', false)`);
    await client.query('SET ROLE authenticated');
    const own = await client.query(
      `SELECT reputation_score FROM public.user_activity_region_profile
       WHERE user_id = $1 AND activity_region = 'KR'`,
      [A]
    );
    const otherHidden = await client.query(
      `SELECT reputation_score FROM public.user_activity_region_profile WHERE user_id = $1`,
      [B]
    );
    let fameWrite = '';
    try {
      await client.query(
        `UPDATE public.user_activity_region_profile SET reputation_score = 1000
         WHERE user_id = $1 AND activity_region = 'KR'`,
        [A]
      );
      const still = await client.query(
        `SELECT reputation_score FROM public.user_activity_region_profile
         WHERE user_id = $1 AND activity_region = 'KR'`,
        [A]
      );
      if (Number(still.rows[0].reputation_score) === 12) fameWrite = 'unchanged';
      else fameWrite = 'changed';
    } catch (err) {
      fameWrite = 'blocked';
    }
    await client.query('RESET ROLE');
    await client.query(
      `INSERT INTO public.board_posts
        (id, author_user_id, territory, title, content, status, activity_region)
       VALUES ('22222222-2222-4222-8222-222222222222', $1, 'CENTRAL', 'US post', 'body', 'ACTIVE', 'US')`,
      [A]
    );
    await client.query(`SELECT set_config('request.jwt.claim.country', 'KR', false)`);
    await client.query('SET ROLE authenticated');
    const publicRead = await client.query(
      `SELECT title FROM public.board_posts WHERE activity_region = 'US'`
    );
    let crossWrite = '';
    try {
      const updated = await client.query(
        `UPDATE public.board_posts SET title = '바뀜' WHERE activity_region = 'US' RETURNING id`
      );
      crossWrite = updated.rows.length === 0 ? 'blocked' : 'changed';
    } catch (err) {
      crossWrite = 'blocked';
    }
    await client.query('RESET ROLE');
    await client.query('SET ROLE anon');
    let anonRead = '';
    try {
      const anonRows = await client.query(`SELECT reputation_score FROM public.user_activity_region_profile`);
      anonRead = anonRows.rows.length === 0 ? 'hidden' : 'visible';
    } catch (err) {
      anonRead = 'blocked';
    }
    await client.query('RESET ROLE');
    lines.push(line(
      own.rows.length === 1 && Number(own.rows[0].reputation_score) === 12 &&
      otherHidden.rows.length === 0 &&
      (fameWrite === 'blocked' || fameWrite === 'unchanged') &&
      publicRead.rows.length === 1 && crossWrite === 'blocked' &&
      (anonRead === 'blocked' || anonRead === 'hidden'),
      '4-rls-own-read-cross-country-and-client-write-blocked'
    ));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (client) {
      try { await client.query('RESET ROLE'); } catch (_e) { /* 역할 */ }
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
  process.stdout.write('DB ' + dbName + (failed.length ? ' FAIL then dropped\n' : ' applied and dropped\n'));
  process.stdout.write(failed.length ? 'RESULT FAIL\n' : 'RESULT PASS\n');
  process.stdout.write('BROWSER NOT RUN\n');
  if (failed.length) process.exit(1);
}

main().catch(function (err) {
  process.stdout.write('FAIL runner ' + String(err && err.stack || err) + '\n');
  process.exit(1);
});
