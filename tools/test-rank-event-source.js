'use strict';
/**
 * 평가 원천 2차. 없는 국가·영토·증가분은 UNKNOWN이다.
 * 운영 데이터베이스에는 적용하지 않는다.
 * node tools/test-rank-event-source.js
 */
const fs = require('fs');
const path = require('path');
const formula = require('../shared/rank-formula-core');
const store = require('../server/leader-election-pg-store');
const live = require('../server/rank-live-source-adapter');

function line(ok, name) {
  return (ok ? 'VERIFIED ' : 'FAIL ') + name;
}

function wednesdayMs() {
  let ms = Date.UTC(2026, 10, 10, 15, 0, 0);
  for (let i = 0; i < 14; i += 1) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
    ms += formula.DAY_MS;
  }
  throw new Error('wednesday not found');
}

async function main() {
  const requested = 'postgres://127.0.0.1:5432/postgres';
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN rank-event-source: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN rank-event-source: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_event_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  const lines = [];
  let client;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    await client.query(`
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, home_country text NOT NULL, territory text NULL);
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        xp bigint NOT NULL DEFAULT 0,
        level integer NOT NULL DEFAULT 1,
        reputation_score bigint NOT NULL DEFAULT 0,
        citizen_rank text NULL
      );
      CREATE TABLE public.user_progression_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        event_type text NOT NULL,
        amount bigint NULL,
        source_type text NULL,
        source_id text NULL,
        dedupe_key text NOT NULL UNIQUE,
        occurred_at timestamptz NOT NULL
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (follower_user_id, following_user_id)
      );
      CREATE TABLE public.board_posts (
        id uuid PRIMARY KEY, author_user_id uuid NOT NULL, territory text NOT NULL,
        activity_region text NULL, status text NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY, author_user_id uuid NOT NULL, territory text NOT NULL,
        activity_region text NULL, status text NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE TABLE public.board_reactions (
        id uuid PRIMARY KEY, actor_user_id uuid NOT NULL, target_author_user_id uuid NOT NULL,
        reaction_group text NOT NULL, created_at timestamptz NOT NULL, cancelled_at timestamptz NULL,
        target_author_territory_at_reaction text NULL, post_id uuid NULL, comment_id uuid NULL,
        activity_region text NULL
      );
    `);
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/migration_rank_event_context_candidate.sql'), 'utf8');
    await client.query(sql);
    const asOf = wednesdayMs();
    const inside = new Date(asOf - formula.DAY_MS).toISOString();
    const good = '11111111-1111-4111-8111-111111111111';
    const bad = '22222222-2222-4222-8222-222222222222';
    const fan = '33333333-3333-4333-8333-333333333333';
    const eva = '44444444-4444-4444-8444-444444444444';
    await client.query(
      `INSERT INTO public.profiles (id, home_country, territory) VALUES
        ($1,'KR','PIONEER'), ($2,'KR','PIONEER')`,
      [good, bad]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, reputation_score) VALUES ($1,10), ($2,10)`,
      [good, bad]
    );
    await client.query(
      `INSERT INTO public.user_progression_events
        (user_id, event_type, amount, dedupe_key, occurred_at, activity_region, territory_at_event)
       VALUES ($1,'EMPATHY_RECEIVED',2,$2,$3,'KR','PIONEER')`,
      [good, 'EMPATHY_RECEIVED:post-good:' + eva, inside]
    );
    await client.query(
      `INSERT INTO public.user_progression_events
        (user_id, event_type, amount, dedupe_key, occurred_at)
       VALUES ($1,'EMPATHY_RECEIVED',2,$2,$3)`,
      [bad, 'EMPATHY_RECEIVED:post-old:' + eva, inside]
    );
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, territory, activity_region, status, created_at)
       VALUES ('55555555-5555-4555-8555-555555555555',$1,'PIONEER','KR','ACTIVE',$2)`,
      [good, inside]
    );
    const preview = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const goodScore = (preview.scores || []).filter(function (row) { return row.id === good; })[0];
    const badPlanned = (preview.planned || []).filter(function (row) { return row.id === bad; });
    const badHold = (preview.unverified || []).filter(function (row) { return row.id === bad; })[0];
    lines.push(line(
      !!goodScore && goodScore.r === 8 && badPlanned.length === 0 &&
      badHold && badHold.reason === 'CONTEXT_UNKNOWN' && badHold.changed === false &&
      preview.productionApply === false,
      '1-unknown-member-does-not-block-verified-kr-member'
    ));
    const us = await live.dryRun(client, { country: 'US', territory: 'pioneer', asOfMs: asOf });
    lines.push(line(us.reason === 'NOT_REFRESH_MOMENT' && !!goodScore, '2-us-block-leaves-kr-result'));

    const before = await client.query('SELECT reputation_score FROM public.user_progression WHERE user_id = $1', [good]);
    const rejected = await client.query(
      `SELECT public.apply_empathy_fame_with_context($1,1,'post','EMPATHY_RECEIVED:new:${eva}',now(),NULL,'PIONEER') AS result`,
      [good]
    );
    const afterReject = await client.query('SELECT reputation_score FROM public.user_progression WHERE user_id = $1', [good]);
    lines.push(line(
      rejected.rows[0].result.code === 'CONTEXT_UNKNOWN' &&
      Number(afterReject.rows[0].reputation_score) === Number(before.rows[0].reputation_score),
      '3-missing-context-does-not-change-fame'
    ));
    const applied = await client.query(
      `SELECT public.apply_empathy_fame_with_context($1,3,'post-new','EMPATHY_RECEIVED:post-new:${eva}',now(),'KR','PIONEER') AS result`,
      [good]
    );
    const stored = await client.query(
      `SELECT amount, activity_region, territory_at_event FROM public.user_progression_events WHERE dedupe_key = $1`,
      ['EMPATHY_RECEIVED:post-new:' + eva]
    );
    const fame = await client.query('SELECT reputation_score FROM public.user_progression WHERE user_id = $1', [good]);
    const oldRow = await client.query(
      `SELECT activity_region, territory_at_event FROM public.user_progression_events WHERE user_id = $1 AND activity_region IS NULL`,
      [bad]
    );
    lines.push(line(
      applied.rows[0].result.status === 'APPLIED' &&
      Number(stored.rows[0].amount) === 3 && stored.rows[0].activity_region === 'KR' &&
      stored.rows[0].territory_at_event === 'PIONEER' &&
      Number(fame.rows[0].reputation_score) === Number(before.rows[0].reputation_score) + 3 &&
      oldRow.rows.length === 1 && oldRow.rows[0].activity_region == null,
      '4-new-context-stored-old-row-not-backfilled'
    ));
    const followed = await client.query(
      `SELECT public.record_user_follow_with_context($1,$2,'KR','PIONEER',false) AS result`,
      [fan, good]
    );
    const cancelled = await client.query(
      `SELECT public.record_user_follow_with_context($1,$2,'KR','PIONEER',true) AS result`,
      [fan, good]
    );
    const followRow = await client.query(
      `SELECT cancelled_at IS NOT NULL AS cancelled FROM public.user_follows
       WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, good]
    );
    const missingFollow = await client.query(
      `SELECT public.record_user_follow_with_context($1,$2,NULL,'PIONEER',false) AS result`,
      [fan, bad]
    );
    lines.push(line(
      followed.rows[0].result.status === 'FOLLOWED' && cancelled.rows[0].result.status === 'CANCELLED' &&
      followRow.rows[0].cancelled === true && missingFollow.rows[0].result.code === 'FOLLOW_SCOPE_UNKNOWN',
      '5-follow-cancel-kept-and-unknown-scope-rejected'
    ));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (client) {
      try { await client.end(); } catch (_e) { /* 닫기 */ }
    }
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
      await admin.query('DROP DATABASE IF EXISTS ' + dbName);
    } catch (_drop) { /* 정리 */ }
    try { await admin.end(); } catch (_e) { /* 닫기 */ }
  }
  const failed = lines.filter(function (row) { return row.indexOf('FAIL') === 0; });
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write(failed.length ? 'RESULT FAIL\n' : 'RESULT PASS\n');
  process.exit(failed.length ? 1 : 0);
}

main();
