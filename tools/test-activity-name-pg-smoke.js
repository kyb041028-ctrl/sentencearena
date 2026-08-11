#!/usr/bin/env node
'use strict';

/**
 * activity-name unique index + display_name update smoke (pg)
 * DAILY_ISSUE_DATABASE_URL 없으면 SKIP
 */
require('dotenv').config();

const { randomUUID } = require('crypto');
const ActivityNameCore = require('../shared/activity-name-core');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
} = require('../server/daily-issue-pg-client');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  if (!url) {
    console.log('SKIP activity-name pg smoke: DAILY_ISSUE_DATABASE_URL missing');
    process.exit(0);
  }

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!executor.ok) {
    console.error('FAIL', executor.message || executor.error);
    process.exit(1);
  }

  try {
    const idx = await executor.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='profiles_display_name_ci_unique'",
    );
    assert(idx.rowCount >= 1, 'unique index missing — apply migration first');

    const a = randomUUID();
    const b = randomUUID();
    const name = '테스트시민' + String(Math.floor(Math.random() * 9000) + 1000);
    assert(ActivityNameCore.validateActivityName(name).ok, 'fixture name valid');

    await executor.query('BEGIN');
    try {
      await executor.query(
        `INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at, confirmation_token, recovery_token,
          email_change_token_new, email_change
        ) VALUES
        ('00000000-0000-0000-0000-000000000000', $1::uuid, 'authenticated', 'authenticated',
         $2::text, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', $3::uuid, 'authenticated', 'authenticated',
         $4::text, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')`,
        [a, a + '@test.local', b, b + '@test.local'],
      );

      await executor.query(
        `INSERT INTO public.profiles (id, display_name, home_country, citizenship_status)
         VALUES ($1::uuid, $2, 'KR', 'CITIZEN')
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [a, name],
      );

      let dupFailed = false;
      try {
        await executor.query(
          `INSERT INTO public.profiles (id, display_name, home_country, citizenship_status)
           VALUES ($1::uuid, $2, 'KR', 'CITIZEN')
           ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
          [b, name.toLowerCase() === name ? name.toUpperCase() : name],
        );
        // if same case-insensitive, unique index should reject on update path — force update
        await executor.query(`UPDATE public.profiles SET display_name = $2 WHERE id = $1::uuid`, [
          b,
          name,
        ]);
      } catch (e) {
        dupFailed = /unique|duplicate/i.test(String(e.message || e));
      }
      if (!dupFailed) {
        // second insert with same lower() should fail when setting same name
        try {
          await executor.query(`UPDATE public.profiles SET display_name = $2 WHERE id = $1::uuid`, [
            b,
            name,
          ]);
        } catch (e2) {
          dupFailed = /unique|duplicate/i.test(String(e2.message || e2));
        }
      }
      assert(dupFailed, 'case-insensitive duplicate not rejected');

      const emptyA = randomUUID();
      const emptyB = randomUUID();
      await executor.query(
        `INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at, confirmation_token, recovery_token,
          email_change_token_new, email_change
        ) VALUES
        ('00000000-0000-0000-0000-000000000000', $1::uuid, 'authenticated', 'authenticated',
         NULL, '', NULL, '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', $2::uuid, 'authenticated', 'authenticated',
         NULL, '', NULL, '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')`,
        [emptyA, emptyB],
      );
      await executor.query(
        `INSERT INTO public.profiles (id, display_name, home_country, citizenship_status)
         VALUES ($1::uuid, '', 'KR', 'CITIZEN'), ($2::uuid, '', 'KR', 'CITIZEN')
         ON CONFLICT (id) DO NOTHING`,
        [emptyA, emptyB],
      );

      console.log('PASS activity-name pg unique + empty onboarding rows');
    } finally {
      await executor.query('ROLLBACK');
    }
  } catch (e) {
    console.error('FAIL activity-name pg smoke:', e.message || e);
    process.exit(1);
  } finally {
    await executor.end();
  }
}

main();
