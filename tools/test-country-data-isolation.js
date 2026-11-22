'use strict';
/**
 * 국가 데이터 격리 5차. 격리 Postgres와 로컬 라우터만 사용한다.
 * 빈 국가를 KR이나 US로 채우지 않는다.
 * node tools/test-country-data-isolation.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('../server/leader-election-pg-store');
const scores = require('../server/activity-region-score-repository');
const { createActivityRegionRouter } = require('../server/activity-region-routes');
const { createActivityRegionStore } = require('../server/activity-region-store');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function line(ok, name) {
  if (ok === 'NOT RUN') return 'NOT RUN ' + name;
  return (ok ? 'VERIFIED ' : 'FAIL ') + name;
}

function ask(port, method, urlPath, cookie, body) {
  return new Promise(function (resolve, reject) {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      method: method,
      path: urlPath,
      headers: {
        cookie: cookie,
        'content-type': 'application/json',
        'content-length': data ? Buffer.byteLength(data) : 0,
      },
    }, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_err) { json = { raw: text }; }
        resolve({ status: res.statusCode, cache: res.headers['cache-control'], json: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const requested = 'postgres://127.0.0.1:5432/postgres';
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN country-data-isolation: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-data-isolation: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_country_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  const lines = [];
  let client;
  let other;
  let server;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    other = new Client({ connectionString: dbUrl });
    await other.connect();
    await store.applyMigration(client);
    await client.query(`
      CREATE TABLE public.board_posts (
        id uuid PRIMARY KEY,
        author_user_id uuid,
        territory text,
        category_key text,
        board_stage text,
        title text,
        content text,
        is_anonymous boolean,
        status text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY,
        post_id uuid,
        author_user_id uuid,
        status text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.board_reactions (
        id uuid PRIMARY KEY,
        post_id uuid,
        comment_id uuid,
        target_type text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(fs.readFileSync(
      path.join(__dirname, '../supabase/migration_activity_region_board_scope_candidate.sql'), 'utf8'
    ));
    await client.query(`
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY, home_country text NOT NULL, display_name text NULL, territory text NULL
      );
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        xp bigint NOT NULL DEFAULT 0,
        level integer NOT NULL DEFAULT 1,
        reputation_score bigint NOT NULL DEFAULT 0
      );
      CREATE TABLE public.user_achievements (
        user_id uuid NOT NULL,
        achievement_key text NOT NULL,
        acquired_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, achievement_key)
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        activity_region text NULL,
        territory_at_follow text NULL,
        cancelled_at timestamptz NULL,
        UNIQUE (follower_user_id, following_user_id)
      );
      CREATE TABLE public.user_activity_region_profile (
        user_id uuid NOT NULL,
        activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
        level integer NOT NULL DEFAULT 1,
        xp bigint NOT NULL DEFAULT 0,
        reputation_score bigint NOT NULL DEFAULT 0,
        aura bigint NOT NULL DEFAULT 0,
        tendency jsonb NULL,
        evolution_contribution bigint NOT NULL DEFAULT 0,
        territory text NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, activity_region)
      );
      CREATE TABLE public.user_activity_region_achievement (
        user_id uuid NOT NULL,
        activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
        achievement_key text NOT NULL,
        acquired_at timestamptz NOT NULL DEFAULT now(),
        featured_slot integer NULL,
        acquisition_sequence bigint NULL,
        season_key text NULL,
        acquisition_notified_at timestamptz NULL,
        PRIMARY KEY (user_id, activity_region, achievement_key)
      );
      CREATE TABLE public.user_activity_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        activity_type text NOT NULL,
        payload jsonb NULL,
        dedupe_key text NOT NULL UNIQUE,
        activity_region text NULL
      );
      CREATE TABLE public.user_notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        notification_type text NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        activity_region text NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(
      `INSERT INTO public.profiles (id, home_country, display_name, territory)
       VALUES ($1, 'KR', 'A', 'PIONEER'), ($2, 'KR', 'B', 'PIONEER')`,
      [A, B]
    );
    await client.query(
      'INSERT INTO public.user_progression (user_id, xp, level, reputation_score) VALUES ($1, 10, 1, 40)',
      [A]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_profile
        (user_id, activity_region, level, xp, reputation_score)
       VALUES ($1, 'US', 1, 0, 0)`,
      [A]
    );

    const memory = createActivityRegionStore();
    const app = express();
    app.use(express.json());
    app.use(createActivityRegionRouter({
      devSamples: false,
      store: memory,
      resolveUser: function () { return A; },
    }));
    server = http.createServer(app);
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const krCookie = 'sa_ar=KR; sa_ar_x=1';
    const usCookie = 'sa_ar=US; sa_ar_x=1';

    for (let i = 1; i <= 10; i += 1) {
      await client.query(
        `INSERT INTO public.board_posts
          (id, author_user_id, territory, category_key, board_stage, title, content, is_anonymous, activity_region, status)
         VALUES ($1,$2,'PIONEER','talk','open',$3,'body',false,'KR','ACTIVE')`,
        ['33333333-3333-4333-8333-' + String(i).padStart(12, '0'), A, 'KR post ' + i]
      );
      await ask(port, 'POST', '/activity-region/posts', krCookie, { title: 'KR post ' + i, body: 'body' });
    }
    const dbKr = await client.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE author_user_id = $1 AND activity_region = 'KR'",
      [A]
    );
    const dbUs = await client.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE author_user_id = $1 AND activity_region = 'US'",
      [A]
    );
    const apiUs = await ask(port, 'GET', '/activity-region/posts', usCookie);
    const apiKr = await ask(port, 'GET', '/activity-region/posts', krCookie);
    const memberUsPosts = (apiUs.json.posts || []).filter(function (post) { return post.userId === A; });
    lines.push(line(
      dbKr.rows[0].n === 10 && dbUs.rows[0].n === 0 &&
      (apiKr.json.posts || []).length === 10 && memberUsPosts.length === 0 &&
      apiUs.cache === 'no-store',
      '1-kr-10-posts-us-posts-0'
    ));

    await client.query(
      'UPDATE public.user_progression SET reputation_score = reputation_score + 500 WHERE user_id = $1',
      [A]
    );
    const fame = await client.query(
      `SELECT p.reputation_score AS kr, u.reputation_score AS us
       FROM public.user_progression p
       JOIN public.user_activity_region_profile u ON u.user_id = p.user_id AND u.activity_region = 'US'
       WHERE p.user_id = $1`,
      [A]
    );
    const fameSplit = fame.rows[0].kr !== fame.rows[0].us && Number(fame.rows[0].us) === 0 && Number(fame.rows[0].kr) === 540;
    lines.push(line(
      fameSplit ? 'NOT RUN' : false,
      '2-kr-fame-plus-500-us-unchanged-but-kr-fame-is-shared-column'
    ));
    if (fameSplit) {
      lines[lines.length - 1] = 'FAIL 2-kr-fame-stored-in-shared-user-progression';
    }

    const repo = scores.createActivityRegionScoreRepository({ query: function (sql, params) { return client.query(sql, params); } });
    const beforeKr = await client.query('SELECT level, xp FROM public.user_progression WHERE user_id = $1', [A]);
    await repo.applyEvent({ region: 'US', userId: A, eventType: 'POST_CREATED', sourceId: 'us-post-1' });
    await repo.applyEvent({ region: 'US', userId: A, eventType: 'POST_CREATED', sourceId: 'us-post-2' });
    const afterUs = await repo.readProfile(A, 'US');
    const afterKr = await client.query('SELECT level, xp, reputation_score FROM public.user_progression WHERE user_id = $1', [A]);
    let usWriteRejected = false;
    try { await repo.applyEvent({ region: 'KR', userId: A, eventType: 'POST_CREATED', sourceId: 'nope' }); }
    catch (err) { usWriteRejected = err && err.code === 'REGION_MISMATCH'; }
    lines.push(line(
      afterUs.level >= 2 && afterUs.xp === 50 &&
      Number(afterKr.rows[0].level) === Number(beforeKr.rows[0].level) &&
      Number(afterKr.rows[0].xp) === Number(beforeKr.rows[0].xp) &&
      usWriteRejected,
      '3-us-level-up-leaves-kr-level'
    ));

    await client.query(
      `INSERT INTO public.user_follows
        (follower_user_id, following_user_id, activity_region, territory_at_follow)
       VALUES ($1,$2,'KR','PIONEER')`,
      [A, B]
    );
    const usFollows = await client.query(
      "SELECT count(*)::int AS n FROM public.user_follows WHERE follower_user_id = $1 AND activity_region = 'US'",
      [A]
    );
    const liveFollowRead = await client.query(
      'SELECT count(*)::int AS n FROM public.user_follows WHERE follower_user_id = $1',
      [A]
    );
    lines.push(line(
      usFollows.rows[0].n === 0 && liveFollowRead.rows[0].n === 0,
      '4-kr-follow-hidden-from-us-live-read'
    ));

    await client.query(
      `INSERT INTO public.user_achievements (user_id, achievement_key) VALUES ($1,'kr-first-post')`,
      [A]
    );
    const usAch = await repo.readProfile(A, 'US');
    const krAch = await client.query(
      'SELECT achievement_key FROM public.user_achievements WHERE user_id = $1',
      [A]
    );
    const usKeys = usAch.achievements || [];
    lines.push(line(
      krAch.rows.some(function (row) { return row.achievement_key === 'kr-first-post'; }) &&
      usKeys.indexOf('kr-first-post') < 0 &&
      krAch.rows.every(function (row) { return usKeys.indexOf(row.achievement_key) < 0; }),
      '5-kr-achievement-not-in-us-profile'
    ));

    await client.query(
      `INSERT INTO public.leader_rank_members
        (country, territory, person_id, fame, rank, comparison_score, valid, elected_leader, unique_positive_evaluators)
       VALUES ('KR','pioneer',$1,540,'debater',1,true,false,0),
              ('US','pioneer',$1,0,'citizen',1,true,false,0)`,
      [A]
    );
    await client.query(
      `UPDATE public.leader_rank_members SET rank = 'elder'
       WHERE country = 'KR' AND territory = 'pioneer' AND person_id = $1`,
      [A]
    );
    const ranks = await client.query(
      `SELECT country, rank FROM public.leader_rank_members WHERE person_id = $1 ORDER BY country`,
      [A]
    );
    const crossRank = await client.query(
      `UPDATE public.leader_rank_members SET rank = 'leader'
       WHERE country = 'US' AND territory = 'pioneer' AND person_id = $1 AND country = 'KR'`,
      [A]
    );
    lines.push(line(
      ranks.rows[0].country === 'KR' && ranks.rows[0].rank === 'elder' &&
      ranks.rows[1].country === 'US' && ranks.rows[1].rank === 'citizen' &&
      crossRank.rowCount === 0,
      '6-kr-rank-change-leaves-us-rank'
    ));

    const voteMs = 48 * 60 * 60 * 1000;
    const nowMs = Date.now();
    await client.query(
      `INSERT INTO public.leader_offices (id, country, territory) VALUES
        ('office-kr','KR','pioneer'), ('office-us','US','pioneer')`
    );
    await client.query(
      `INSERT INTO public.leader_filing_rounds
        (id, office_id, country, territory, vacancy_id, status, opened_at_ms, filing_ends_at_ms)
       VALUES
        ('round-kr','office-kr','KR','pioneer','vac-kr','vote',$1,$2),
        ('round-us','office-us','US','pioneer','vac-us','vote',$1,$2)`,
      [nowMs - voteMs, nowMs]
    );
    await client.query(
      `INSERT INTO public.leader_ballots
        (id, round_id, country, territory, status, starts_at_ms, ends_at_ms)
       VALUES
        ('ballot-kr','round-kr','KR','pioneer','open',$1,$2),
        ('ballot-us','round-us','US','pioneer','open',$1,$2)`,
      [nowMs - 1000, nowMs - 1000 + voteMs]
    );
    const voted = await store.castVote(client, {
      ballotId: 'ballot-us', voterId: A, choice: 'cand-us', nowMs: nowMs,
    });
    const krVotes = await client.query(
      `SELECT count(*)::int AS n FROM public.leader_casts c
       JOIN public.leader_ballots b ON b.id = c.ballot_id
       WHERE b.country = 'KR'`
    );
    const usVotes = await client.query(
      `SELECT count(*)::int AS n FROM public.leader_casts c
       JOIN public.leader_ballots b ON b.id = c.ballot_id
       WHERE b.country = 'US' AND c.voter_id = $1`,
      [A]
    );
    lines.push(line(
      voted.ok === true && krVotes.rows[0].n === 0 && usVotes.rows[0].n === 1,
      '7-us-vote-leaves-kr-election'
    ));

    let switched = true;
    for (let i = 0; i < 3; i += 1) {
      const usView = await ask(port, 'GET', '/activity-region/profile', usCookie);
      const krView = await ask(port, 'GET', '/activity-region/profile', krCookie);
      const usPosts = ((usView.json.profile || {}).posts || []).length;
      const krPosts = ((krView.json.profile || {}).posts || []).length;
      if (usView.status !== 200 || krView.status !== 200 || usPosts !== 0 || krPosts !== 10) switched = false;
      if (usView.cache !== 'no-store' || krView.cache !== 'no-store') switched = false;
    }
    const mismatch = await ask(port, 'GET', '/activity-region/profile?region=US', krCookie);
    lines.push(line(
      switched && mismatch.status === 403 && mismatch.json.error === 'REGION_MISMATCH',
      '8-repeated-switch-does-not-show-other-country'
    ));

    await client.query(
      `INSERT INTO public.user_notifications (user_id, notification_type, title, message, activity_region)
       VALUES ($1,'KR_ONLY','KR','korea-only','KR')`,
      [A]
    );
    const noteUs = await client.query(
      "SELECT count(*)::int AS n FROM public.user_notifications WHERE user_id = $1 AND activity_region = 'US'",
      [A]
    );
    const noteKr = await client.query(
      "SELECT count(*)::int AS n FROM public.user_notifications WHERE user_id = $1 AND activity_region = 'KR'",
      [A]
    );
    const noteBare = await client.query(
      'SELECT count(*)::int AS n FROM public.user_notifications WHERE user_id = $1 AND activity_region IS NULL',
      [A]
    );
    const rankUs = ranks.rows[1].rank;
    const feedUs = memory.readProfile(A, 'US').feed.length;
    const feedKr = memory.readProfile(A, 'KR').feed.length;
    await client.query(
      `INSERT INTO public.board_posts
        (id, author_user_id, territory, category_key, board_stage, title, content, is_anonymous, activity_region, status)
       VALUES ('55555555-5555-4555-8555-555555555555',$1,'PIONEER','talk','open','us-stat','body',false,'US','ACTIVE')`,
      [A]
    );
    const scopedKr = await client.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE author_user_id = $1 AND activity_region = 'KR'",
      [A]
    );
    const unscopedStats = await client.query(
      'SELECT count(*)::int AS n FROM public.board_posts WHERE author_user_id = $1',
      [A]
    );
    lines.push(line(
      noteUs.rows[0].n >= 2 && noteKr.rows[0].n === 1 && noteBare.rows[0].n === 0 &&
      rankUs === 'citizen' && feedUs === 0 && feedKr === 10 &&
      scopedKr.rows[0].n === 10 && unscopedStats.rows[0].n === scopedKr.rows[0].n,
      '9-notifications-stats-rankings-feeds-do-not-mix'
    ));

    const krBefore = await client.query(
      "SELECT title FROM public.board_posts WHERE author_user_id = $1 AND activity_region = 'KR' ORDER BY title",
      [A]
    );
    await client.query(
      "UPDATE public.board_posts SET title = 'other-country' WHERE author_user_id = $1 AND activity_region = 'US'",
      [A]
    );
    const krAfter = await client.query(
      "SELECT title FROM public.board_posts WHERE author_user_id = $1 AND activity_region = 'KR' ORDER BY title",
      [A]
    );
    const denied = await ask(port, 'POST', '/activity-region/posts', krCookie, {
      region: 'US', title: 'should-fail', body: 'no',
    });
    const concurrent = await Promise.all([
      client.query(
        `INSERT INTO public.board_posts
          (id, author_user_id, territory, category_key, board_stage, title, content, is_anonymous, activity_region, status)
         VALUES ('44444444-4444-4444-8444-444444444441',$1,'PIONEER','talk','open','more-kr','body',false,'KR','ACTIVE')`,
        [A]
      ),
      other.query(
        `INSERT INTO public.board_posts
          (id, author_user_id, territory, category_key, board_stage, title, content, is_anonymous, activity_region, status)
         VALUES ('44444444-4444-4444-8444-444444444442',$1,'PIONEER','talk','open','one-us','body',false,'US','ACTIVE')`,
        [A]
      ),
    ]);
    const afterKrCount = await client.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE author_user_id = $1 AND activity_region = 'KR'",
      [A]
    );
    const afterUsCount = await client.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE author_user_id = $1 AND activity_region = 'US'",
      [A]
    );
    lines.push(line(
      JSON.stringify(krBefore.rows) === JSON.stringify(krAfter.rows) &&
      denied.status === 403 && concurrent.length === 2 &&
      afterKrCount.rows[0].n === 11 && afterUsCount.rows[0].n === 2,
      '10-direct-and-concurrent-requests-do-not-contaminate'
    ));

    const invented = await client.query("SELECT public.activity_region_norm(NULL) AS region");
    lines.push(line(
      invented.rows[0].region !== 'KR' && invented.rows[0].region !== 'US',
      '11-null-country-is-not-assigned'
    ));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (server) { try { await new Promise(function (resolve) { server.close(resolve); }); } catch (_e) { /* 닫기 */ } }
    if (other) { try { await other.end(); } catch (_e) { /* 닫기 */ } }
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
