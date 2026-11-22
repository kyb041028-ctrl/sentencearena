'use strict';
/**
 * 국가별 알림과 활동 피드. 격리 Postgres와 실제 라우트.
 * node tools/test-country-notification-feed.js
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const service = require('../server/user-data-service');
const repo = require('../server/user-data-supabase-repository');
const routes = require('../server/user-data-routes');
const { createBoardRouter } = require('../server/board-routes');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createActivityRegionStore } = require('../server/activity-region-store');
const { createActivityRegionScoreRepository } = require('../server/activity-region-score-repository');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function line(ok, name, kind) {
  return (ok ? 'PASS ' : 'FAIL ') + kind + ' ' + name;
}

function request(app, method, pathName, headers, bodyObj) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      const payload = bodyObj != null ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
      const hdrs = Object.assign({}, headers || {});
      if (payload) {
        hdrs['Content-Type'] = 'application/json';
        hdrs['Content-Length'] = String(payload.length);
      }
      const req = require('http').request({
        hostname: '127.0.0.1', port: port, path: pathName, method: method, headers: hdrs,
      }, function (res) {
        let raw = '';
        res.on('data', function (chunk) { raw += chunk; });
        res.on('end', function () {
          server.close();
          let body = null;
          try { body = JSON.parse(raw); } catch (_) { body = raw; }
          resolve({ status: res.statusCode, body: body });
        });
      });
      req.on('error', function (err) {
        server.close();
        resolve({ status: 0, body: String(err && err.message) });
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function cookie(region, userId) {
  return { cookie: 'sa_ar=' + region + '; sa_ar_x=1', 'x-sc-user-id': userId };
}

function typesOf(body) {
  const rows = body && body.data ? body.data : [];
  return rows.map(function (row) { return row.type || row.activityType; });
}

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let Pool;
  try { Pool = require('pg').Pool; }
  catch (_err) {
    process.stdout.write('NOT RUN country-notification-feed: pg module missing\n');
    process.exit(0);
  }
  const admin = new (require('pg').Client)({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-notification-feed: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_notice_' + process.pid;
  const lines = [];
  let pool;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    pool = new Pool({ connectionString: 'postgres://127.0.0.1:5432/' + dbName, max: 4 });
    const client = await pool.connect();
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_country_progression_candidate.sql'), 'utf8'));
    await client.query(`
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, territory text NULL);
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        xp bigint NOT NULL DEFAULT 0,
        level integer NOT NULL DEFAULT 1,
        reputation_score bigint NOT NULL DEFAULT 0,
        follower_count bigint NOT NULL DEFAULT 0,
        following_count bigint NOT NULL DEFAULT 0
      );
      CREATE TABLE public.user_progression_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        event_type text NOT NULL,
        dedupe_key text NOT NULL
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT user_follows_unique UNIQUE (follower_user_id, following_user_id),
        CONSTRAINT user_follows_no_self_follow CHECK (follower_user_id <> following_user_id)
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
        is_official boolean NOT NULL DEFAULT false,
        comment_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
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
        payload jsonb,
        dedupe_key text,
        is_read boolean NOT NULL DEFAULT false,
        read_at timestamptz,
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
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_rank_event_context_candidate.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_country_follow_candidate.sql'), 'utf8'));
    await client.query(
      'INSERT INTO public.profiles (id, territory) VALUES ($1, \'CENTRAL\'), ($2, \'PIONEER\')',
      [A, B]
    );
    await client.query('INSERT INTO public.user_progression (user_id) VALUES ($1), ($2)', [A, B]);
    await client.query(
      'INSERT INTO public.user_notifications (user_id, notification_type, title, message, activity_region) VALUES ($1, \'OLD\', \'old\', \'old\', NULL)',
      [A]
    );
    client.release();

    const query = function (sql, params) { return pool.query(sql, params); };
    const memory = createActivityRegionStore();
    const scores = createActivityRegionScoreRepository({ query: query });
    repo.setAdminClient({ query: query });
    repo.setUserClient({ query: query });
    service.setRepository(repo);
    service.setDataMode('API_OPERATIONAL');
    const app = express();
    app.use(express.json());
    app.use('/api/board', createBoardRouter({
      pgQuery: query,
      operational: true,
      userContext: createMockUserContextAdapter({ defaultTerritory: 'CENTRAL' }),
      resolveActorFromRequest: async function (req) {
        const id = req.headers['x-sc-user-id'];
        return id ? { userId: String(id) } : null;
      },
      regionLedger: memory,
      regionScores: scores,
    }));
    app.use('/api', routes);

    const krPost = await request(app, 'POST', '/api/board/posts', cookie('KR', A), { title: '한국 글', content: '본문' });
    const usPost = await request(app, 'POST', '/api/board/posts', cookie('US', A), { title: 'US post', content: 'body' });
    const krPostId = krPost.body && krPost.body.post && krPost.body.post.id;
    const usPostId = usPost.body && usPost.body.post && usPost.body.post.id;
    const krComment = await request(app, 'POST', '/api/board/posts/' + krPostId + '/comments', cookie('KR', A), { content: '한국 댓글' });
    const usComment = await request(app, 'POST', '/api/board/posts/' + usPostId + '/comments', cookie('US', A), { content: 'US comment' });
    const krEmpathy = await request(app, 'POST', '/api/board/posts/' + krPostId + '/empathy', cookie('KR', B), {});
    const usEmpathy = await request(app, 'POST', '/api/board/posts/' + usPostId + '/empathy', cookie('US', B), {});
    await pool.query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory)
       VALUES ($1, 'KR', 'pioneer'), ($1, 'US', 'guardian')
       ON CONFLICT (user_id, activity_region) DO UPDATE SET territory = EXCLUDED.territory`,
      [B]
    );
    const krFollow = await request(app, 'POST', '/api/users/' + A + '/follow/toggle', cookie('KR', B), {});
    const usFollow = await request(app, 'POST', '/api/users/' + A + '/follow/toggle', cookie('US', B), {});

    const krNotes = await request(app, 'GET', '/api/users/me/notifications', cookie('KR', A));
    const usNotes = await request(app, 'GET', '/api/users/me/notifications', cookie('US', A));
    const krTypes = typesOf(krNotes.body);
    const usTypes = typesOf(usNotes.body);
    lines.push(line(
      krPost.status === 201 && usPost.status === 201 && krComment.status === 201 && usComment.status === 201,
      '0-board-create-http ' + [krPost.status, usPost.status, krComment.status, usComment.status].join(','),
      'server'
    ));
    const krCommentText = (krNotes.body.data || []).filter(function (row) { return row.type === 'BOARD_COMMENT_CREATED'; }).map(function (row) { return row.message; });
    const usCommentText = (usNotes.body.data || []).filter(function (row) { return row.type === 'BOARD_COMMENT_CREATED'; }).map(function (row) { return row.message; });
    lines.push(line(
      krCommentText.length === 1 && krCommentText[0] === '한국 댓글' && usCommentText.length === 1 && usCommentText[0] === 'US comment' && krTypes.indexOf('OLD') < 0,
      '1-kr-comment-notification-only-kr',
      'server'
    ));
    lines.push(line(
      usTypes.indexOf('BOARD_COMMENT_CREATED') >= 0 && krTypes.indexOf('US comment') < 0 && krTypes.filter(function (t) { return t === 'BOARD_COMMENT_CREATED'; }).length === 1,
      '2-us-comment-notification-only-us',
      'server'
    ));
    lines.push(line(
      krEmpathy.status === 200 && usEmpathy.status === 200
        && krTypes.filter(function (t) { return t === 'EMPATHY_RECEIVED'; }).length === 1
        && usTypes.filter(function (t) { return t === 'EMPATHY_RECEIVED'; }).length === 1,
      '3-empathy-notifications-independent ' + krEmpathy.status + ',' + usEmpathy.status,
      'server'
    ));
    lines.push(line(
      krFollow.status === 200 && usFollow.status === 200
        && krTypes.filter(function (t) { return t === 'FOLLOW'; }).length === 1
        && usTypes.filter(function (t) { return t === 'FOLLOW'; }).length === 1,
      '4-follow-notifications-independent ' + krFollow.status + ',' + usFollow.status,
      'server'
    ));

    const krFeed = await request(app, 'GET', '/api/users/me/activity', cookie('KR', A));
    const usFeed = await request(app, 'GET', '/api/users/me/activity', cookie('US', A));
    const krFeedTypes = typesOf(krFeed.body);
    const usFeedTypes = typesOf(usFeed.body);
    const memoryKr = memory.listFeed('KR').map(function (item) { return item.type; });
    const memoryUs = memory.listFeed('US').map(function (item) { return item.type; });
    lines.push(line(
      krFeedTypes.indexOf('POST_CREATED') >= 0 && krFeedTypes.indexOf('BOARD_COMMENT_CREATED') >= 0
        && krFeedTypes.indexOf('EMPATHY_RECEIVED') >= 0 && krFeedTypes.indexOf('FOLLOW') >= 0
        && usFeedTypes.indexOf('POST_CREATED') >= 0 && usFeedTypes.indexOf('FOLLOW') >= 0
        && krFeedTypes.filter(function (t) { return t === 'FOLLOW'; }).length === 1
        && usFeedTypes.filter(function (t) { return t === 'FOLLOW'; }).length === 1
        && memoryKr.indexOf('post') >= 0 && memoryKr.indexOf('comment') >= 0 && memoryKr.indexOf('empathy') >= 0
        && memoryUs.indexOf('post') >= 0 && memory.listFeed('') .length === 0
        && memory.listFeed('KR').every(function (item) { return item.region === 'KR'; })
        && memory.listFeed('US').every(function (item) { return item.region === 'US'; }),
      '7-feeds-independent',
      'server'
    ));

    const usNote = (usNotes.body.data || []).filter(function (row) { return row.type === 'BOARD_COMMENT_CREATED'; })[0];
    const krRead = await request(app, 'PATCH', '/api/users/me/notifications/' + (usNote && usNote.id) + '/read', cookie('KR', A));
    const stillUnread = await pool.query(
      'SELECT is_read FROM public.user_notifications WHERE id = $1',
      [usNote && usNote.id]
    );
    const usRead = await request(app, 'PATCH', '/api/users/me/notifications/' + (usNote && usNote.id) + '/read', cookie('US', A));
    const usAfter = await request(app, 'GET', '/api/users/me/notifications', cookie('US', A));
    const usCommentAfter = (usAfter.body.data || []).filter(function (row) { return row.id === (usNote && usNote.id); })[0];
    const directWrong = await (async function () {
      try {
        await repo.markNotificationRead(A, usNote && usNote.id, 'KR');
        return false;
      } catch (err) {
        return err && err.code === 'COUNTRY_MISMATCH';
      }
    })();
    lines.push(line(
      krRead.status === 400 && krRead.body && krRead.body.error === 'COUNTRY_MISMATCH' && directWrong
        && stillUnread.rows[0] && stillUnread.rows[0].is_read === false,
      '6-other-country-notification-id-blocked',
      'server-and-direct'
    ));
    lines.push(line(
      usRead.status === 200 && usCommentAfter && usCommentAfter.isRead === true,
      '5-mark-read-per-country',
      'server'
    ));
    const krStill = await request(app, 'GET', '/api/users/me/notifications', cookie('KR', A));
    const krCommentRow = (krStill.body.data || []).filter(function (row) { return row.type === 'BOARD_COMMENT_CREATED'; })[0];
    lines.push(line(
      krCommentRow && krCommentRow.isRead !== true,
      '5b-kr-row-stays-unread',
      'server'
    ));

    let missingRejected = false;
    try {
      await scores.recordCountrySideEffect({ userId: A, region: '', eventType: 'POST_CREATED', sourceId: 'missing' });
    } catch (err) {
      missingRejected = err && err.code === 'COUNTRY_REQUIRED';
    }
    let invalidRejected = false;
    try {
      await repo.recordCountryFeed({ userId: A, region: 'JP', eventType: 'FOLLOW', sourceId: 'bad' });
    } catch (err) {
      invalidRejected = err && err.code === 'COUNTRY_REQUIRED';
    }
    const blankStill = await pool.query(
      'SELECT count(*)::int AS n FROM public.user_notifications WHERE user_id = $1 AND activity_region IS NULL',
      [A]
    );
    lines.push(line(
      missingRejected && invalidRejected && blankStill.rows[0].n === 1 && krTypes.indexOf('OLD') < 0,
      '8-missing-country-rejected-and-blank-not-assigned-kr',
      'direct'
    ));
    const firstDup = await scores.recordCountrySideEffect({
      userId: A, region: 'KR', eventType: 'POST_CREATED', sourceId: 'dup-source', text: 'dup',
    });
    const secondDup = await scores.recordCountrySideEffect({
      userId: A, region: 'KR', eventType: 'POST_CREATED', sourceId: 'dup-source', text: 'dup',
    });
    const dupCount = await pool.query(
      'SELECT count(*)::int AS n FROM public.user_activity_events WHERE dedupe_key = $1',
      ['KR:POST_CREATED:dup-source']
    );
    lines.push(line(
      firstDup.status === 'RECORDED' && secondDup.status === 'DUPLICATE' && dupCount.rows[0].n === 1,
      '9-duplicate-event-blocked',
      'direct'
    ));

    const fame = await pool.query(
      'SELECT activity_region, xp, reputation_score FROM public.user_activity_region_profile WHERE user_id = $1 ORDER BY activity_region',
      [A]
    );
    const shared = await pool.query(
      'SELECT xp, reputation_score, follower_count, following_count FROM public.user_progression WHERE user_id = $1',
      [A]
    );
    const byRegion = {};
    fame.rows.forEach(function (row) { byRegion[row.activity_region] = row; });
    lines.push(line(
      byRegion.KR && byRegion.US
        && Number(byRegion.KR.reputation_score) === 1
        && Number(byRegion.US.reputation_score) === 1
        && Number(shared.rows[0].reputation_score) === 0
        && Number(shared.rows[0].follower_count) === 0,
      '10-fame-once-and-shared-counter-unchanged',
      'server'
    ));
    if (lines.some(function (row) { return row.indexOf('FAIL') === 0; })) {
      lines.push('INFO kr-notes ' + krTypes.join(','));
      lines.push('INFO us-notes ' + usTypes.join(','));
      lines.push('INFO kr-feed ' + krFeedTypes.join(','));
      lines.push('INFO us-feed ' + usFeedTypes.join(','));
      lines.push('INFO memory-kr ' + memoryKr.join(','));
      lines.push('INFO memory-us ' + memoryUs.join(','));
      lines.push('INFO kr-post ' + JSON.stringify(krPost.body));
      lines.push('INFO kr-comment ' + JSON.stringify(krComment.body));
      lines.push('INFO kr-empathy ' + JSON.stringify(krEmpathy.body));
      lines.push('INFO kr-follow ' + JSON.stringify(krFollow.body));
    }
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (pool) { try { await pool.end(); } catch (_e) { /* 닫기 */ } }
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
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
