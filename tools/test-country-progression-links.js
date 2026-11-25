'use strict';
/**
 * 1단계에 남은 댓글·공감·취소·미국 업적 연결.
 * node tools/test-country-progression-links.js
 */
const fs = require('fs');
const path = require('path');
const { createCountryProgressionStore } = require('../server/country-progression-store');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createActivityRegionScoreRepository } = require('../server/activity-region-score-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function line(ok, name, kind) {
  return (ok ? 'PASS ' : 'FAIL ') + kind + ' ' + name;
}

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN country-progression-links: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-progression-links: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_links_' + process.pid;
  const lines = [];
  let client;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    await client.query(fs.readFileSync(
      path.join(__dirname, '../supabase/migration_country_progression_candidate.sql'), 'utf8'
    ));
    await client.query(`
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        xp bigint NOT NULL DEFAULT 0,
        level integer NOT NULL DEFAULT 1,
        reputation_score bigint NOT NULL DEFAULT 0
      );
      CREATE TABLE public.board_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        author_user_id uuid,
        territory text,
        category_key text,
        board_stage integer,
        title text,
        content text,
        is_anonymous boolean,
        activity_region text,
        status text NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid,
        parent_comment_id uuid,
        author_user_id uuid,
        territory text,
        content text,
        is_anonymous boolean,
        activity_region text,
        status text NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.user_activity_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        activity_type text,
        payload jsonb,
        dedupe_key text,
        activity_region text,
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.user_notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        notification_type text,
        title text,
        message text,
        dedupe_key text,
        is_read boolean NOT NULL DEFAULT false,
        activity_region text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.user_activity_region_achievement (
        user_id uuid NOT NULL,
        activity_region text NOT NULL,
        achievement_key text NOT NULL,
        acquired_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, activity_region, achievement_key)
      );
    `);
    await client.query(
      'INSERT INTO public.user_progression (user_id, xp, level, reputation_score) VALUES ($1, 10, 1, 40)',
      [A]
    );
    let grantCalls = 0;
    const query = function (sql, params) { return client.query(sql, params); };
    const store = createCountryProgressionStore({ query: query });
    const scores = createActivityRegionScoreRepository({ query: query });
    const realGrants = scores.evaluateGrants;
    scores.evaluateGrants = async function (userId, eventType, level) {
      grantCalls += 1;
      return realGrants(userId, eventType, level);
    };
    const repository = createActivityRegionPgRepository({ query: query });
    const service = createBoardService({
      repository: repository,
      userContext: createMockUserContextAdapter({
        territories: {},
        defaultTerritory: 'CENTRAL',
      }),
      operational: true,
      countryProgression: store,
      regionScores: scores,
    });
    const krActor = { userId: A, activityRegion: 'KR' };
    const usActor = { userId: A, activityRegion: 'US' };
    const reactor = { userId: B, activityRegion: 'KR' };
    const krPost = await service.createPost(krActor, { title: '한국 글', content: '본문' });
    const usPost = await service.createPost(usActor, { title: 'US post', content: 'body' });
    const krComment = await service.createComment(krActor, krPost.post.id, { content: '한국 댓글' });
    const afterKrComment = await store.read(A, 'KR');
    const usDuringKr = await store.read(A, 'US');
    const usComment = await service.createComment(usActor, usPost.post.id, { content: 'US comment' });
    const kr = await store.read(A, 'KR');
    const us = await store.read(A, 'US');
    const legacy = await client.query('SELECT xp, reputation_score FROM public.user_progression WHERE user_id = $1', [A]);
    const oldEvents = await client.query(
      'SELECT count(*)::int AS n, count(*) FILTER (WHERE activity_region IS NULL)::int AS blank FROM public.user_activity_events'
    );
    lines.push(line(
      krComment.progression && krComment.progression.xp === 37 && afterKrComment.xp === 37 && usDuringKr.xp === 25,
      '1-kr-comment-xp-only-kr-row',
      'server'
    ));
    lines.push(line(
      usComment.progression && usComment.progression.xp === 37 && us.xp === 37 && kr.xp === 37,
      '2-us-comment-xp-only-us-row',
      'server'
    ));
    lines.push(line(
      Number(legacy.rows[0].xp) === 10 && Number(legacy.rows[0].reputation_score) === 40 && oldEvents.rows[0].n === 4 && oldEvents.rows[0].blank === 0,
      '3-old-and-country-functions-not-both-used',
      'server'
    ));
    const granted = await service.receiveCommentEmpathy(reactor, krComment.comment.id);
    const duplicated = await service.receiveCommentEmpathy(reactor, krComment.comment.id);
    const afterEmpathy = await store.read(A, 'KR');
    const usFame = await store.read(A, 'US');
    lines.push(line(
      granted.granted === true && granted.fameDelta === 1 && afterEmpathy.fame === 1 && usFame.fame === 0,
      '4-comment-empathy-fame-stays-in-kr',
      'server'
    ));
    lines.push(line(
      duplicated.duplicate === true && duplicated.fameDelta === 0 && afterEmpathy.fame === 1,
      '5-comment-empathy-dedupe-blocks-second-grant',
      'server'
    ));
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, territory, title, content, activity_region)
       VALUES ('33333333-3333-4333-8333-333333333333', $1, 'CENTRAL', 'blank', 'body', NULL)`,
      [A]
    );
    await client.query(
      `INSERT INTO public.board_comments (id, post_id, author_user_id, territory, content, activity_region)
       VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', $1, 'CENTRAL', 'blank comment', NULL)`,
      [A]
    );
    let rejected = false;
    try {
      await service.receiveCommentEmpathy(reactor, '44444444-4444-4444-8444-444444444444');
    } catch (err) {
      rejected = err && err.code === 'COUNTRY_REQUIRED';
    }
    let directRejected = false;
    try {
      await store.applyEvent({ userId: A, region: '', eventType: 'EMPATHY_RECEIVED', sourceId: 'none' });
    } catch (err) {
      directRejected = err && err.code === 'COUNTRY_REQUIRED';
    }
    lines.push(line(
      rejected && directRejected,
      '6-missing-country-rejected',
      'server-and-direct'
    ));
    const postGrant = await service.receivePostEmpathy(reactor, krPost.post.id);
    const revoked = await service.revokePostEmpathy(reactor, krPost.post.id);
    const regranted = await service.receivePostEmpathy(reactor, krPost.post.id);
    const krEnd = await store.read(A, 'KR');
    const usEnd = await store.read(A, 'US');
    const legacyEnd = await client.query('SELECT xp, reputation_score FROM public.user_progression WHERE user_id = $1', [A]);
    lines.push(line(
      postGrant.fameDelta === 1 && revoked.revoked === true && revoked.fameDelta === -1 && regranted.fameDelta === 1,
      '7-revoke-and-regrant-amounts-match',
      'server'
    ));
    lines.push(line(
      krEnd.fame === 2 && usEnd.fame === 0 && Number(legacyEnd.rows[0].reputation_score) === 40,
      '8-other-country-and-shared-fame-unchanged',
      'server'
    ));
    const achievementKeys = await client.query(
      "SELECT achievement_key FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = 'US' ORDER BY achievement_key",
      [A]
    );
    const achievementsAfterFirst = await client.query(
      "SELECT count(*)::int AS n FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = 'US'",
      [A]
    );
    const again = await scores.evaluateGrants(A, 'POST_CREATED', usEnd.level);
    const achievementsAfterSecond = await client.query(
      "SELECT count(*)::int AS n FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = 'US'",
      [A]
    );
    lines.push(line(
      grantCalls === 2 && Array.isArray(again),
      '9-us-post-grant-evaluated-once-per-post',
      'server'
    ));
    lines.push('INFO us-achievement-keys ' + achievementKeys.rows.map(function (row) { return row.achievement_key; }).join(','));
    lines.push('INFO us-achievement-rows-after-post ' + achievementsAfterFirst.rows[0].n);
    lines.push('INFO us-achievement-rows-after-reeval ' + achievementsAfterSecond.rows[0].n);
    lines.push(line(
      achievementsAfterSecond.rows[0].n === achievementsAfterFirst.rows[0].n,
      '10-re-evaluation-does-not-grant-twice',
      'server'
    ));
    lines.push(line(
      krEnd.xp === 37 && usEnd.xp === 37 && Number(legacyEnd.rows[0].xp) === 10,
      '11-shared-progression-not-incremented',
      'server'
    ));
    const directRevoke = await store.revokeEvent({
      userId: A, region: 'US', eventType: 'EMPATHY_RECEIVED', sourceId: 'missing-grant',
    });
    lines.push(line(
      directRevoke.status === 'NOT_FOUND' && directRevoke.fameDelta === 0 && usEnd.fame === 0,
      '12-direct-revoke-without-grant-changes-nothing',
      'direct'
    ));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (client) { try { await client.end(); } catch (_e) { /* 닫기 */ } }
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
  process.exit(failed.length ? 1 : 0);
}

main();
