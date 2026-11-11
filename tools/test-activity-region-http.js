#!/usr/bin/env node
'use strict';

/**
 * 격리된 로컬 PostgreSQL에 실제 HTTP로 글을 저장한다.
 * 운영 Supabase에는 접속하지 않는다.
 * 기록용 Supabase 클라이언트 검사는 DB 검증이 아니다.
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const express = require('express');

const { createBoardRouter } = require('../server/board-routes');
const { createActivityRegionRouter } = require('../server/activity-region-routes');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { isRemoteSupabaseUrl, createPgQuery } = require('../server/activity-region-http-storage');
const { runAlignmentBatch } = require('../server/alignment-batch-service');
const { createAlignmentMemoryDataSource } = require('../server/alignment-memory-data-source');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ROOT = path.join(__dirname, '..');

let failed = 0;
function check(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name, detail || '');
    return;
  }
  console.log('PASS', name);
}

function readSql(name) {
  return fs.readFileSync(path.join(ROOT, 'supabase', name), 'utf8');
}

async function applySql(client, label, sql) {
  try {
    await client.query(sql);
    console.log('SQL_OK', label);
    return null;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error('SQL_FAIL', label, message.split('\n')[0]);
    return message;
  }
}

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

function closeServer(server) {
  return new Promise(function (resolve) { server.close(resolve); });
}

function request(server, method, urlPath, headers, body) {
  return new Promise(function (resolve, reject) {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: urlPath,
      method: method,
      headers: Object.assign({}, headers || {}, data ? { 'content-length': Buffer.byteLength(data) } : {}),
    }, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, json: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function cookie(region) {
  return 'sa_ar=' + region + '; sa_ar_x=1';
}

function member(userId, region) {
  return {
    cookie: cookie(region),
    'x-user-id': userId,
    'content-type': 'application/json',
  };
}

function titlesOf(body) {
  return ((body && body.posts) || []).map(function (post) { return post.title; });
}

function recordingClient() {
  const calls = [];
  function from(table) {
    const state = { payload: null };
    const chain = {
      insert: function (payload) {
        state.payload = payload;
        calls.push({ table: table, op: 'insert', payload: payload });
        return chain;
      },
      select: function () { return chain; },
      eq: function () { return chain; },
      single: function () {
        const payload = state.payload || {};
        return Promise.resolve({
          data: {
            id: '33333333-3333-4333-8333-333333333333',
            author_user_id: payload.author_user_id,
            territory: payload.territory || 'CENTRAL',
            title: payload.title,
            content: payload.content,
            status: 'ACTIVE',
            activity_region: Object.prototype.hasOwnProperty.call(payload, 'activity_region')
              ? payload.activity_region
              : null,
            is_anonymous: false,
            comment_count: 0,
          },
          error: null,
        });
      },
    };
    return chain;
  }
  return { calls: calls, from: from };
}

function appFor(options) {
  const app = express();
  app.use(express.json());
  app.use('/api/board', createBoardRouter(Object.assign({
    operational: true,
    useMemory: false,
    userContext: createMockUserContextAdapter({
      territories: { [USER_A]: 'CENTRAL', [USER_B]: 'CENTRAL' },
    }),
  }, options)));
  return app;
}

async function serviceClientShape() {
  check('Supabase 주소는 풀을 만들지 않는다',
    isRemoteSupabaseUrl('https://example.supabase.co') === true
    && createPgQuery('postgres://u:p@db.example.supabase.co:5432/postgres') == null
    && createPgQuery('') == null);

  const usClient = recordingClient();
  const usApp = appFor({
    activityRegionSchema: true,
    resolveActorFromRequest: async function (req) {
      const id = req.headers['x-user-id'];
      if (!id) return null;
      return { userId: String(id), supabase: usClient };
    },
  });
  const usServer = await listen(usApp);
  const usRes = await request(usServer, 'POST', '/api/board/posts', member(USER_A, 'US'), {
    title: 'US service note',
    content: 'service body',
  });
  const krRes = await request(usServer, 'POST', '/api/board/posts', member(USER_A, 'KR'), {
    title: 'KR service note',
    content: 'service body',
  });
  await closeServer(usServer);
  const usInsert = usClient.calls.filter(function (call) {
    return call.table === 'board_posts' && call.op === 'insert' && call.payload && call.payload.title === 'US service note';
  })[0];
  const krInsert = usClient.calls.filter(function (call) {
    return call.table === 'board_posts' && call.op === 'insert' && call.payload && call.payload.title === 'KR service note';
  })[0];
  check('서비스 클라이언트 US 글은 activity_region US',
    usRes.status === 201 && usInsert && usInsert.payload.activity_region === 'US');
  check('서비스 클라이언트 한국 글은 국가 칸을 넣지 않는다',
    krRes.status === 201 && krInsert && usInsert && krInsert.payload.activity_region == null);

  const blocked = recordingClient();
  const blockedApp = appFor({
    activityRegionSchema: false,
    resolveActorFromRequest: async function (req) {
      const id = req.headers['x-user-id'];
      if (!id) return null;
      return { userId: String(id), supabase: blocked };
    },
  });
  const blockedServer = await listen(blockedApp);
  const blockedRes = await request(blockedServer, 'POST', '/api/board/posts', member(USER_A, 'US'), {
    title: 'US should not save',
    content: 'blocked',
  });
  await closeServer(blockedServer);
  check('스키마 플래그가 없으면 US 쓰기는 저장 전에 중단',
    blockedRes.status === 503
    && blockedRes.json
    && blockedRes.json.error === 'REGION_SCHEMA_UNAVAILABLE'
    && blocked.calls.length === 0);
  console.log('SERVICE_CLIENT_SHAPE_PASS');
}

async function bootSchema(client, withV2) {
  const stubError = await applySql(client, 'local-auth-stub', `
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END $$;
  `);
  if (stubError) throw new Error('stub failed');
  const steps = [
    'schema_profiles_identity_history.sql',
    'migration_board_core_system.sql',
    'migration_user_data_system.sql',
    'migration_political_alignment_persistence.sql',
  ];
  for (let i = 0; i < steps.length; i++) {
    const err = await applySql(client, steps[i], readSql(steps[i]));
    if (err) throw new Error(steps[i]);
  }
  if (withV2) {
    const v2err = await applySql(client, 'migration_activity_region_v2.sql', readSql('migration_activity_region_v2.sql'));
    if (v2err) throw new Error('v2 failed');
  }
}

async function main() {
  await serviceClientShape();

  const mod = await import(pathToFileURL(
    path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')
  ).href);
  const EmbeddedPostgres = mod.default;
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), 'sa-region-http-' + Date.now()),
    port: 55441,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: function () {},
    onError: function () {},
  });
  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase('sentencearena_region_http');
  const client = cluster.getPgClient('sentencearena_region_http');
  await client.connect();
  console.log('DB', 'local-postgresql', 'sentencearena_region_http', 'port', 55441);
  let server = null;
  try {
    await bootSchema(client, true);
    await client.query(
      'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)',
      [USER_A, 'a@example.test', USER_B, 'b@example.test']
    );
    await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content) " +
        "VALUES ($1, 'CENTRAL', '한국 보존 글', '보존 본문')",
      [USER_A]
    );
    await client.query(
      'INSERT INTO public.user_progression (user_id, xp, level, reputation_score) VALUES ($1, 80, 2, 9)',
      [USER_A]
    );
    await client.query(
      "INSERT INTO public.user_achievements (user_id, achievement_key, acquired_at, acquisition_sequence) " +
        "VALUES ($1, 'kr-kept-badge', now(), 1)",
      [USER_A]
    );
    await client.query(
      'INSERT INTO public.user_alignment_state (user_id, score, previous_signal) VALUES ($1, 12.5, 1)',
      [USER_A]
    );
    await client.query(
      "INSERT INTO public.user_notifications (user_id, notification_type, title, message) " +
        "VALUES ($1, 'KR_KEEP', '한국', '한국 알림')",
      [USER_A]
    );

    const query = function (sql, params) { return client.query(sql, params); };
    const app = appFor({
      pgQuery: query,
      resolveActorFromRequest: async function (req) {
        const id = req.headers['x-user-id'];
        if (!id) return null;
        return { userId: String(id) };
      },
    });
    app.use('/api', createActivityRegionRouter({ devSamples: true }));
    server = await listen(app);

    const guest = await request(server, 'POST', '/api/board/posts', {
      cookie: cookie('US'),
      'content-type': 'application/json',
    }, { title: '손님 글', content: '거절' });
    check('비로그인 HTTP 쓰기는 거절', guest.status === 401 && guest.json && guest.json.error === 'BOARD_AUTH_REQUIRED');

    const krPost = await request(server, 'POST', '/api/board/posts', member(USER_A, 'KR'), {
      title: '한국 HTTP 글',
      content: '한국 본문',
    });
    check('한국 HTTP 글이 저장된다',
      krPost.status === 201 && krPost.json && krPost.json.post && krPost.json.post.activityRegion == null,
      JSON.stringify(krPost.json));
    const krId = krPost.json && krPost.json.post && krPost.json.post.id;
    const krComment = await request(server, 'POST', '/api/board/posts/' + krId + '/comments', member(USER_A, 'KR'), {
      content: '한국 HTTP 댓글',
    });
    check('한국 HTTP 댓글 국가는 비어 있다',
      krComment.status === 201 && krComment.json && krComment.json.comment && krComment.json.comment.activityRegion == null);
    const krReaction = await request(server, 'POST', '/api/board/reactions/toggle', member(USER_A, 'KR'), {
      targetType: 'POST',
      targetId: krId,
      reactionType: 'LIKE',
    });
    check('한국 HTTP 반응이 저장된다', krReaction.status === 200 && krReaction.json && krReaction.json.ok === true);

    const usPost = await request(server, 'POST', '/api/board/posts', member(USER_A, 'US'), {
      title: 'US http note',
      content: 'US body',
    });
    check('미국 HTTP 글이 US로 저장된다',
      usPost.status === 201
      && usPost.json
      && usPost.json.post
      && usPost.json.post.activityRegion === 'US'
      && usPost.json.progression
      && usPost.json.progression.xp === 25,
      JSON.stringify(usPost.json && usPost.json.progression));
    const usId = usPost.json.post.id;
    const usComment = await request(server, 'POST', '/api/board/posts/' + usId + '/comments', member(USER_A, 'US'), {
      content: 'US http reply',
    });
    check('미국 HTTP 댓글 국가는 US',
      usComment.status === 201 && usComment.json && usComment.json.comment && usComment.json.comment.activityRegion === 'US');
    const usReaction = await request(server, 'POST', '/api/board/reactions/toggle', member(USER_B, 'US'), {
      targetType: 'POST',
      targetId: usId,
      reactionType: 'LIKE',
    });
    check('미국 HTTP 반응이 저장된다', usReaction.status === 200 && usReaction.json && usReaction.json.ok === true);
    const empathy = await request(server, 'POST', '/api/board/posts/' + usId + '/empathy', member(USER_B, 'US'));
    check('미국 HTTP 명성이 저장된다',
      empathy.status === 200 && empathy.json && empathy.json.fame === 1 && empathy.json.xp === 37,
      JSON.stringify(empathy.json));

    const krList = await request(server, 'GET', '/api/board/posts?territory=CENTRAL', member(USER_A, 'KR'));
    const usList = await request(server, 'GET', '/api/board/posts?territory=CENTRAL', member(USER_A, 'US'));
    const krTitles = titlesOf(krList.json);
    const usTitles = titlesOf(usList.json);
    check('한국 목록에 미국 글이 없다',
      krList.status === 200 && krTitles.indexOf('US http note') === -1 && krTitles.indexOf('한국 보존 글') !== -1 && krTitles.indexOf('한국 HTTP 글') !== -1,
      krTitles.join(','));
    check('미국 목록에 한국 글이 없다',
      usList.status === 200 && usTitles.indexOf('한국 보존 글') === -1 && usTitles.indexOf('한국 HTTP 글') === -1 && usTitles.indexOf('US http note') !== -1,
      usTitles.join(','));

    const usProfile = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'US'));
    const usAgain = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'US'));
    check('미국 경험·업적·명성을 다시 읽는다',
      usProfile.status === 200
      && usProfile.json.profile.stored === true
      && usProfile.json.profile.xp === 37
      && usProfile.json.profile.fame === 1
      && usProfile.json.profile.aura === 0
      && usProfile.json.profile.tendency == null
      && usProfile.json.profile.achievements.indexOf('first-post') !== -1
      && usAgain.json.profile.xp === 37
      && usAgain.json.profile.fame === 1,
      JSON.stringify(usProfile.json));

    const krProfile = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'KR'));
    check('한국 복귀 시 한국 경험·명성이 남는다',
      krProfile.status === 200 && krProfile.json.profile.xp === 80 && krProfile.json.profile.fame === 9 && krProfile.json.profile.level === 2);

    const usRow = (await client.query('SELECT activity_region FROM public.board_posts WHERE id = $1', [usId])).rows[0];
    const krRow = (await client.query('SELECT activity_region FROM public.board_posts WHERE title = $1', ['한국 HTTP 글'])).rows[0];
    const commentRow = (await client.query(
      'SELECT activity_region FROM public.board_comments WHERE post_id = $1',
      [usId]
    )).rows[0];
    const reactionRow = (await client.query(
      "SELECT activity_region FROM public.board_reactions WHERE post_id = $1 AND reaction_type = 'LIKE' AND actor_user_id = $2",
      [usId, USER_B]
    )).rows[0];
    check('DB의 미국 글·댓글·반응은 US이고 한국 글은 비어 있다',
      usRow.activity_region === 'US' && commentRow.activity_region === 'US' && reactionRow.activity_region === 'US' && krRow.activity_region == null);

    const editB = await request(server, 'PATCH', '/api/board/posts/' + usId, member(USER_B, 'US'), { title: 'B가 고침' });
    const editKr = await request(server, 'PATCH', '/api/board/posts/' + usId, member(USER_A, 'KR'), { title: '한국에서 고침' });
    check('다른 회원과 다른 국가의 수정은 거절',
      editB.status === 403 && editB.json.error === 'BOARD_FORBIDDEN'
      && editKr.status === 403 && editKr.json.error === 'REGION_MISMATCH');

    const spoof = await request(server, 'POST', '/api/board/posts', member(USER_A, 'KR'), {
      title: '파라미터 미국',
      content: '우회',
      activityRegion: 'US',
    });
    const spoofCount = (await client.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE title = '파라미터 미국'"
    )).rows[0];
    check('국가 파라미터 우회는 저장되지 않는다',
      spoof.status === 403 && spoof.json.error === 'REGION_MISMATCH' && spoofCount.n === 0);

    const popularKr = await request(server, 'GET', '/api/board/popular?territory=CENTRAL&period=day', member(USER_A, 'KR'));
    const popularUs = await request(server, 'GET', '/api/board/popular?territory=CENTRAL&period=day', member(USER_A, 'US'));
    check('인기글이 섞이지 않는다',
      popularKr.status === 200 && popularUs.status === 200
      && titlesOf(popularKr.json).indexOf('US http note') === -1
      && titlesOf(popularUs.json).indexOf('한국 보존 글') === -1
      && titlesOf(popularUs.json).indexOf('US http note') !== -1,
      titlesOf(popularKr.json).join('|') + ' || ' + titlesOf(popularUs.json).join('|'));

    const samples = await request(server, 'GET', '/api/activity-region/posts', { cookie: cookie('US') });
    const sampleTitles = titlesOf(samples.json);
    const sampleRows = (await client.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE title LIKE '[Sample%'"
    )).rows[0];
    check('개발 샘플은 응답에만 있고 저장소에는 없다',
      samples.status === 200 && sampleTitles.indexOf('[Sample · Progressive] A shorter ballot, a clearer cost') !== -1 && sampleRows.n === 0);

    const kept = (await client.query(
      'SELECT xp, reputation_score, level FROM public.user_progression WHERE user_id = $1',
      [USER_A]
    )).rows[0];
    const badge = (await client.query(
      "SELECT count(*)::int AS n FROM public.user_achievements WHERE user_id = $1 AND achievement_key = 'kr-kept-badge'",
      [USER_A]
    )).rows[0];
    const copied = (await client.query(
      "SELECT count(*)::int AS n FROM public.user_activity_region_achievement WHERE achievement_key = 'kr-kept-badge'"
    )).rows[0];
    const align = (await client.query(
      'SELECT score::text AS score FROM public.user_alignment_state WHERE user_id = $1',
      [USER_A]
    )).rows[0];
    const tendency = (await client.query(
      "SELECT tendency FROM public.user_activity_region_profile WHERE user_id = $1 AND activity_region = 'US'",
      [USER_A]
    )).rows[0];
    check('한국 표본과 성향 점수는 미국 활동 뒤에도 같다',
      Number(kept.xp) === 80 && Number(kept.reputation_score) === 9 && Number(kept.level) === 2
      && badge.n === 1 && copied.n === 0 && align.score === '12.500000' && tendency.tendency == null);

    const krNotice = (await client.query(
      "SELECT count(*)::int AS n FROM public.user_notifications " +
        "WHERE public.activity_region_norm(activity_region) = 'KR' AND message = '한국 알림'"
    )).rows[0];
    const usAsKr = (await client.query(
      "SELECT count(*)::int AS n FROM public.user_notifications " +
        "WHERE activity_region = 'US' AND public.activity_region_norm(activity_region) = 'KR'"
    )).rows[0];
    const usFeed = (await client.query(
      "SELECT count(*)::int AS n FROM public.user_activity_events WHERE activity_region = 'US'"
    )).rows[0];
    check('알림과 피드가 한국 조회에 섞이지 않는다', krNotice.n === 1 && usAsKr.n === 0 && usFeed.n > 0);

    let persistCalls = 0;
    const skipped = await runAlignmentBatch({
      batchId: 'alignment-http-us-skip',
      batchTime: '2026-11-04T00:00:00.000Z',
      activityRegion: 'US',
      dataSource: createAlignmentMemoryDataSource({
        users: [{ userId: USER_A, alignmentScore: 12.5, currentTerritory: 'CENTRAL', previousAlignmentSignal: 1 }],
        reactions: [],
      }),
      repository: {
        async getBatchRecord() { return null; },
        async persistBatchPlan() { persistCalls += 1; return { success: true }; },
      },
    });
    check('미국 성향 배치는 점수를 만들지 않는다',
      skipped.skipped === true && skipped.skipReason === 'US_SENTENCE_MODEL_MISSING' && persistCalls === 0);

    await closeServer(server);
    server = null;

    await cluster.createDatabase('sentencearena_region_bare');
    const bare = cluster.getPgClient('sentencearena_region_bare');
    await bare.connect();
    try {
      await bootSchema(bare, false);
      await bare.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [USER_A, 'a@example.test']);
      const bareApp = appFor({
        pgQuery: function (sql, params) { return bare.query(sql, params); },
        activityRegionSchema: false,
        resolveActorFromRequest: async function (req) {
          const id = req.headers['x-user-id'];
          if (!id) return null;
          return { userId: String(id) };
        },
      });
      const bareServer = await listen(bareApp);
      const bareWrite = await request(bareServer, 'POST', '/api/board/posts', member(USER_A, 'US'), {
        title: '컬럼 없는 미국 글',
        content: '저장되면 실패',
      });
      const bareCount = (await bare.query('SELECT count(*)::int AS n FROM public.board_posts')).rows[0];
      await closeServer(bareServer);
      check('국가 칸이 없는 DB의 US 쓰기는 거절되고 행이 없다',
        bareWrite.status === 503
        && bareWrite.json
        && bareWrite.json.error === 'REGION_SCHEMA_UNAVAILABLE'
        && bareCount.n === 0,
        JSON.stringify(bareWrite.json));
    } finally {
      await bare.end();
    }
  } finally {
    if (server) {
      try { await closeServer(server); } catch (_) {}
    }
    try { await client.end(); } catch (_) {}
    try {
      await cluster.stop();
    } catch (err) {
      console.log('STOP_WARN', err && err.code ? err.code : 'stop');
    }
  }

  if (failed) {
    console.error('HTTP_TESTS_FAILED', failed);
    process.exit(1);
  }
  console.log('LOCAL_POSTGRES_HTTP_PASS');
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
