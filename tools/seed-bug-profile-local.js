'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB = 'bug_profile_local';
const SOURCE = 'country_beta_screen';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const body = crypto.scryptSync(password, salt, 32).toString('hex');
  return salt + ':' + body;
}

async function main() {
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres' });
  await admin.connect();
  const busy = await admin.query(
    'SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [SOURCE]
  );
  if (Number(busy.rows[0].n) > 0) {
    throw new Error('SOURCE_IN_USE');
  }
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [DB]
  );
  await admin.query('DROP DATABASE IF EXISTS ' + DB);
  await admin.query('CREATE DATABASE ' + DB + ' TEMPLATE ' + SOURCE);
  await admin.end();

  const client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + DB });
  await client.connect();
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migration_bug_profile_local.sql'),
    'utf8'
  );
  await client.query(sql);
  const people = [
    [ADMIN, 'admin@local.test', 'LocalBeta-Admin-12', 'ADMIN'],
    [OWNER, 'owner@local.test', 'LocalBeta-Owner-12', 'OWNER'],
  ];
  for (let i = 0; i < people.length; i += 1) {
    await client.query(
      `INSERT INTO auth.users (id, email, local_password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, local_password_hash = EXCLUDED.local_password_hash`,
      [people[i][0], people[i][1], hashPassword(people[i][2])]
    );
    await client.query(
      `INSERT INTO auth.local_test_roles (user_id, role) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
      [people[i][0], people[i][3]]
    );
  }
  const check = await client.query(
    `SELECT
      (SELECT COUNT(*) FROM public.profiles) AS profiles,
      (SELECT COUNT(*) FROM public.user_activity_region_profile) AS country_profiles,
      (SELECT COUNT(*) FROM public.admin_inquiries) AS inquiries`
  );
  console.log(JSON.stringify({ db: DB, check: check.rows[0] }));
  await client.end();
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
