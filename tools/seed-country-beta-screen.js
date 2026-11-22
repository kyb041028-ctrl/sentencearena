'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DB = 'country_beta_screen';

function sqlFile(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'supabase', name), 'utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const body = crypto.scryptSync(password, salt, 32).toString('hex');
  return salt + ':' + body;
}

async function main() {
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres' });
  await admin.connect();
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [DB]
  );
  await admin.query('DROP DATABASE IF EXISTS ' + DB);
  await admin.query('CREATE DATABASE ' + DB);
  await admin.end();
  const client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + DB });
  await client.connect();
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $fn$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $fn$
      SELECT current_setting('request.jwt.claim.role', true);
    $fn$;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS local_password_hash text;
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
    CREATE TABLE IF NOT EXISTS auth.local_test_sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL,
      expires_at timestamptz NOT NULL
    );
  `);
  const files = [
    'schema_profiles_identity_history.sql',
    'migration_board_core_system.sql',
    'migration_user_data_system.sql',
    'migration_political_alignment_persistence.sql',
    'migration_political_alignment_beta_v1.sql',
    'migration_legal_gate_v1.sql',
    'migration_signup_completed_at_v1.sql',
    'migration_country_beta_apply.sql',
    'migration_activity_region_legal_consent_candidate.sql',
  ];
  for (let i = 0; i < files.length; i += 1) await client.query(sqlFile(files[i]));
  const passA = hashPassword('LocalBeta-A-12');
  const passB = hashPassword('LocalBeta-B-12');
  await client.query(
    `INSERT INTO auth.users (id, email, local_password_hash) VALUES
      ($1, 'a@local.test', $2),
      ($3, 'b@local.test', $4)`,
    [A, passA, B, passB]
  );
  await client.query(
    `UPDATE public.profiles
     SET display_name = CASE id::text WHEN $1::text THEN 'MemberA' ELSE 'MemberB' END,
         signup_completed_at = now()
     WHERE id IN ($1::uuid, $2::uuid)`,
    [A, B]
  );
  await client.query(
    `INSERT INTO public.user_progression (user_id, xp, level, reputation_score)
     VALUES ($1, 80, 4, 99)`,
    [A]
  );
  await client.query(
    `INSERT INTO public.user_activity_region_profile
      (user_id, activity_region, xp, level, reputation_score, territory)
     VALUES ($1, 'KR', 30, public.country_level_from_xp(30), 12, 'pioneer'),
            ($1, 'US', 10, public.country_level_from_xp(10), 5, 'central'),
            ($2, 'KR', 40, public.country_level_from_xp(40), 7, 'guardian'),
            ($2, 'US', 8, public.country_level_from_xp(8), 3, 'pioneer')`,
    [A, B]
  );
  await client.query(
    `INSERT INTO public.user_legal_consents (
       user_id, age_requirement_confirmed_at, age_policy_version, age_gate_method,
       sensitive_political_consented_at, sensitive_political_policy_version,
       territory_disclosure_consented_at, territory_disclosure_policy_version,
       political_profile_visibility
     ) VALUES
     ($1, now(), 'age-policy-v1', 'dob-input', now(), 'sensitive-political-v1', now(), 'territory-disclosure-v1', 'private'),
     ($2, now(), 'age-policy-v1', 'dob-input', now(), 'sensitive-political-v1', now(), 'territory-disclosure-v1', 'private')`,
    [A, B]
  );
  await client.query(
    `INSERT INTO public.user_activity_region_legal_consents (
       user_id, activity_region, age_requirement_confirmed_at, age_policy_version, age_policy_region,
       age_gate_method, terms_document_version, terms_consented_at, privacy_document_version,
       privacy_acknowledged_at, sensitive_political_consented_at, sensitive_political_policy_version,
       sensitive_applies_to, territory_disclosure_consented_at, territory_disclosure_policy_version,
       territory_disclosure_applies_to
     ) VALUES
     ($1, 'US', now(), 'age-policy-us-v1', 'US', 'dob-input', 'terms-draft-us-v1', now(),
      'privacy-draft-us-v1', now(), now(), 'sensitive-political-v1', 'US', now(), 'territory-disclosure-v1', 'US'),
     ($2, 'US', now(), 'age-policy-us-v1', 'US', 'dob-input', 'terms-draft-us-v1', now(),
      'privacy-draft-us-v1', now(), now(), 'sensitive-political-v1', 'US', now(), 'territory-disclosure-v1', 'US')`,
    [A, B]
  );
  await client.query(
    `INSERT INTO public.board_posts (author_user_id, territory, title, content, status, activity_region)
     VALUES ($1, 'CENTRAL', '한국 공개글', '한국 본문', 'ACTIVE', 'KR'),
            ($1, 'CENTRAL', 'US public post', 'US body', 'ACTIVE', 'US')`,
    [B]
  );
  await client.end();
  process.stdout.write('SEEDED ' + DB + '\n');
}

main().catch(function (err) {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
