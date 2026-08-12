#!/usr/bin/env node
'use strict';

/**
 * handle_new_user — live Postgres trigger smoke (Google + Kakao + Naver-style)
 *
 * DAILY_ISSUE_DATABASE_URL 없으면 SKIPPED (가짜 PASS 금지)
 * 테스트 auth.users / profiles 행은 트랜잭션 롤백으로 정리
 */

require('dotenv').config();

const { randomUUID } = require('crypto');
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
    console.log('SKIP handle_new_user pg smoke: DAILY_ISSUE_DATABASE_URL missing');
    process.exit(0);
  }

  const executor = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'public' });
  if (!executor.ok) {
    console.error('FAIL pg executor:', executor.message || executor.error);
    process.exit(1);
  }

  try {
    const fn = await executor.query(
      "SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'handle_new_user' LIMIT 1",
    );
    const def = fn.rows && fn.rows[0] ? String(fn.rows[0].def || '') : '';
    assert(def.includes("v_display := ''") || def.includes("v_display:=''"), 'live function must default display_name to empty');
    assert(!def.includes("'nickname'"), 'live function must not use provider nickname fallback');

    const trigger = await executor.query(
      "SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relname = 'users' AND tgname = 'on_auth_user_created' AND NOT t.tgisinternal",
    );
    assert(trigger.rowCount >= 1, 'on_auth_user_created trigger missing on auth.users');

    async function runCase(label, userId, email, meta) {
      await executor.query('BEGIN');
      try {
        await executor.query(
          `INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
            created_at, updated_at, confirmation_token, recovery_token,
            email_change_token_new, email_change
          ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            $1::uuid,
            'authenticated',
            'authenticated',
            $2::text,
            '',
            CASE WHEN $2::text IS NOT NULL THEN now() ELSE NULL END,
            '{"provider":"oauth","providers":["oauth"]}'::jsonb,
            $3::jsonb,
            now(),
            now(),
            '',
            '',
            '',
            ''
          )`,
          [userId, email, JSON.stringify(meta || {})],
        );

        const prof = await executor.query('SELECT id, display_name, home_country FROM public.profiles WHERE id = $1::uuid', [
          userId,
        ]);
        assert(prof.rowCount === 1, label + ': profile row not created');
        const row = prof.rows[0];
        assert(row.id === userId, label + ': profile id mismatch');
        assert(row.display_name != null, label + ': display_name is null');
        assert(row.display_name === '', label + ': display_name must be empty for onboarding');
        assert(row.home_country === 'KR', label + ': home_country default');
        return row;
      } finally {
        await executor.query('ROLLBACK');
      }
    }

    const googleId = randomUUID();
    await runCase('google', googleId, 'smoke.google@test.local', { name: 'Google User', full_name: 'Google User' });

    const kakaoId = randomUUID();
    await runCase('kakao-nickname', kakaoId, null, { nickname: '카카오스모크' });

    const kakaoEmptyId = randomUUID();
    await runCase('kakao-empty', kakaoEmptyId, null, {});

    const naverId = randomUUID();
    await runCase('naver-style', naverId, 'naver.user@test.local', { name: '네이버유저', nickname: '네이버닉' });

    console.log('PASS handle_new_user pg smoke (google + kakao + naver-style → empty display_name)');
  } catch (e) {
    console.error('FAIL handle_new_user pg smoke:', e.message || e);
    process.exit(1);
  } finally {
    await executor.end();
  }
}

main();
