'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DB = 'bug_report_local';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const body = crypto.scryptSync(password, salt, 32).toString('hex');
  return salt + ':' + body;
}

async function main() {
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres' });
  await admin.connect();
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
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
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      local_password_hash text
    );
    CREATE TABLE IF NOT EXISTS auth.local_test_sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth.local_test_roles (
      user_id uuid PRIMARY KEY,
      role text NOT NULL CHECK (role IN ('ADMIN', 'OWNER'))
    );
  `);
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migration_bug_report_local_apply.sql'),
    'utf8'
  );
  await client.query(sql);
  const people = [
    [A, 'a@local.test', 'LocalBeta-A-12', null],
    [B, 'b@local.test', 'LocalBeta-B-12', null],
    [ADMIN, 'admin@local.test', 'LocalBeta-Admin-12', 'ADMIN'],
    [OWNER, 'owner@local.test', 'LocalBeta-Owner-12', 'OWNER'],
  ];
  for (let i = 0; i < people.length; i += 1) {
    await client.query(
      'INSERT INTO auth.users (id, email, local_password_hash) VALUES ($1, $2, $3)',
      [people[i][0], people[i][1], hashPassword(people[i][2])]
    );
    if (people[i][3]) {
      await client.query(
        'INSERT INTO auth.local_test_roles (user_id, role) VALUES ($1, $2)',
        [people[i][0], people[i][3]]
      );
    }
  }
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('admin_inquiries','achievement_verified_bugs','user_activity_region_achievement') ORDER BY 1"
  );
  console.log(JSON.stringify({ db: DB, tables: tables.rows.map(function (r) { return r.tablename; }) }));
  await client.end();
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
