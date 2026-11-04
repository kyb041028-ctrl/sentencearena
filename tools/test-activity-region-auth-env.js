#!/usr/bin/env node
'use strict';

/**
 * 실제 Supabase Auth가 없으면 성공으로 끝내지 않는다.
 * 로컬 Postgres 확인은 따로 적고, 테스트 헤더를 Auth 세션이라고 부르지 않는다.
 * 운영 Supabase에는 접속하지 않는다. 메일을 보내지 않는다.
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const express = require('express');

const { createBoardRouter } = require('../server/board-routes');
const { createActivityRegionRouter } = require('../server/activity-region-routes');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
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
  console.log('CHECK_OK', name);
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

function commandExists(name) {
  try {
    execFileSync('where.exe', [name], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function authBlockReason() {
  if (!commandExists('docker') && !commandExists('podman')) {
    return 'docker-and-podman-missing';
  }
  return '';
}

async function ipChoiceChecks() {
  const injected = express();
  injected.use(express.json());
  injected.use('/api', createActivityRegionRouter({
    devSamples: false,
    lookup: function () { return 'US'; },
  }));
  const server = await listen(injected);
  const fromLookup = await request(server, 'GET', '/api/activity-region');
  const manual = await request(server, 'GET', '/api/activity-region', {
    cookie: 'sa_ar=KR; sa_ar_x=1',
  });
  await closeServer(server);
  check('주입한 IP 국가는 US로 읽힌다',
    fromLookup.status === 200 && fromLookup.json && fromLookup.json.region === 'US' && fromLookup.json.source === 'ip');
  check('저장한 한국 선택은 주입 IP보다 우선한다',
    manual.status === 200 && manual.json && manual.json.region === 'KR' && manual.json.source === 'explicit');

  const previous = process.env.SA_TRUST_EDGE_COUNTRY;
  process.env.SA_TRUST_EDGE_COUNTRY = '1';
  const openApp = express();
  openApp.use('/api', createActivityRegionRouter({
    devSamples: false,
    lookup: function () { return null; },
  }));
  const openServer = await listen(openApp);
  const spoofed = await request(openServer, 'GET', '/api/activity-region', {
    'x-sa-edge-country': 'US',
  });
  await closeServer(openServer);
  const edgeApp = express();
  edgeApp.set('trust proxy', 1);
  edgeApp.use('/api', createActivityRegionRouter({
    devSamples: false,
    lookup: function () { return null; },
  }));
  const edgeServer = await listen(edgeApp);
  const edge = await request(edgeServer, 'GET', '/api/activity-region', {
    'x-sa-edge-country': 'US',
  });
  const edgeManual = await request(edgeServer, 'GET', '/api/activity-region', {
    'x-sa-edge-country': 'US',
    cookie: 'sa_ar=KR; sa_ar_x=1',
  });
  await closeServer(edgeServer);
  if (previous == null) delete process.env.SA_TRUST_EDGE_COUNTRY;
  else process.env.SA_TRUST_EDGE_COUNTRY = previous;
  check('신뢰 프록시가 아니면 국가 헤더는 무시된다',
    spoofed.status === 200 && spoofed.json && spoofed.json.region === 'KR' && spoofed.json.source !== 'ip');
  check('신뢰 프록시의 국가 헤더는 US로 읽힌다',
    edge.status === 200 && edge.json && edge.json.region === 'US' && edge.json.source === 'ip');
  check('저장한 선택은 가장자리 헤더보다 우선한다',
    edgeManual.status === 200 && edgeManual.json && edgeManual.json.region === 'KR' && edgeManual.json.source === 'explicit');
  console.log('IP_MODE', 'injection-only');
  console.log('EXTERNAL_IP', 'UNVERIFIED');
}

async function bootSchema(client) {
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
    'migration_activity_region_v2.sql',
  ];
  for (let i = 0; i < steps.length; i++) {
    const err = await applySql(client, steps[i], readSql(steps[i]));
    if (err) throw new Error(steps[i]);
  }
}

function member(userId, region) {
  return {
    cookie: 'sa_ar=' + region + '; sa_ar_x=1',
    'x-user-id': userId,
    'content-type': 'application/json',
  };
}

async function postgresChecks() {
  const mod = await import(pathToFileURL(
    path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')
  ).href);
  const EmbeddedPostgres = mod.default;
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), 'sa-region-auth-env-' + Date.now()),
    port: 55443,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: function () {},
    onError: function () {},
  });
  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase('sentencearena_region_auth_env');
  const client = cluster.getPgClient('sentencearena_region_auth_env');
  await client.connect();
  console.log('DB', 'local-postgresql', 'sentencearena_region_auth_env', 'port', 55443);
  console.log('IDENTITY_MODE', 'test-header-not-auth-session');
  let server = null;
  try {
    await bootSchema(client);
    await client.query(
      'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)',
      [USER_A, 'a.local.test@example.com', USER_B, 'b.local.test@example.com']
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

    const app = express();
    app.use(express.json());
    app.use('/api/board', createBoardRouter({
      operational: true,
      useMemory: false,
      pgQuery: function (sql, params) { return client.query(sql, params); },
      userContext: createMockUserContextAdapter({
        territories: { [USER_A]: 'CENTRAL', [USER_B]: 'CENTRAL' },
      }),
      resolveActorFromRequest: async function (req) {
        const id = req.headers['x-user-id'];
        if (!id) return null;
        return { userId: String(id) };
      },
    }));
    server = await listen(app);

    const guestWrite = await request(server, 'POST', '/api/board/posts', {
      cookie: 'sa_ar=KR; sa_ar_x=1',
      'content-type': 'application/json',
    }, { title: '손님', content: '거절' });
    check('비로그인 쓰기는 거절된다', guestWrite.status === 401 && guestWrite.json.error === 'BOARD_AUTH_REQUIRED');

    const krPost = await request(server, 'POST', '/api/board/posts', member(USER_A, 'KR'), {
      title: '한국 인증환경 글', content: '한국 본문',
    });
    const krId = krPost.json && krPost.json.post && krPost.json.post.id;
    const krComment = await request(server, 'POST', '/api/board/posts/' + krId + '/comments', member(USER_A, 'KR'), {
      content: '한국 댓글',
    });
    const krReaction = await request(server, 'POST', '/api/board/reactions/toggle', member(USER_A, 'KR'), {
      targetType: 'POST', targetId: krId, reactionType: 'LIKE',
    });
    check('한국 글·댓글·반응이 빈 국가로 저장된다',
      krPost.status === 201 && krPost.json.post.activityRegion == null
      && krComment.status === 201 && krComment.json.comment.activityRegion == null
      && krReaction.status === 200);

    const guestRead = await request(server, 'GET', '/api/board/posts/' + krId, {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    });
    check('게스트는 중앙 글을 읽는다', guestRead.status === 200 && guestRead.json.post.title === '한국 인증환경 글');

    const usPost = await request(server, 'POST', '/api/board/posts', member(USER_A, 'US'), {
      title: 'US auth-env note', content: 'US body',
    });
    const usId = usPost.json && usPost.json.post && usPost.json.post.id;
    const usComment = await request(server, 'POST', '/api/board/posts/' + usId + '/comments', member(USER_A, 'US'), {
      content: 'US reply',
    });
    const usReaction = await request(server, 'POST', '/api/board/reactions/toggle', member(USER_B, 'US'), {
      targetType: 'POST', targetId: usId, reactionType: 'LIKE',
    });
    const empathy = await request(server, 'POST', '/api/board/posts/' + usId + '/empathy', member(USER_B, 'US'));
    const usProfile = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'US'));
    const krProfile = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'KR'));
    const krList = await request(server, 'GET', '/api/board/posts?territory=CENTRAL', member(USER_A, 'KR'));
    const usList = await request(server, 'GET', '/api/board/posts?territory=CENTRAL', member(USER_A, 'US'));
    const krTitles = (krList.json.posts || []).map(function (row) { return row.title; });
    const usTitles = (usList.json.posts || []).map(function (row) { return row.title; });
    check('미국 글·댓글·반응과 점수 재조회가 한국과 섞이지 않는다',
      usPost.status === 201 && usPost.json.post.activityRegion === 'US'
      && usComment.status === 201 && usComment.json.comment.activityRegion === 'US'
      && usReaction.status === 200
      && empathy.status === 200 && empathy.json.fame === 1 && empathy.json.xp === 37
      && usProfile.json.profile.xp === 37 && usProfile.json.profile.fame === 1
      && usProfile.json.profile.tendency == null
      && usProfile.json.profile.achievements.indexOf('first-post') !== -1
      && krProfile.json.profile.xp === 80 && krProfile.json.profile.fame === 9
      && krTitles.indexOf('US auth-env note') === -1
      && usTitles.indexOf('한국 인증환경 글') === -1
      && usTitles.indexOf('US auth-env note') !== -1);

    const editB = await request(server, 'PATCH', '/api/board/posts/' + krId, member(USER_B, 'KR'), { title: 'B가 고침' });
    const spoof = await request(server, 'POST', '/api/board/posts', member(USER_A, 'KR'), {
      title: '파라미터 미국', content: '우회', activityRegion: 'US',
    });
    const spoofN = (await client.query("SELECT count(*)::int AS n FROM public.board_posts WHERE title = '파라미터 미국'")).rows[0];
    check('B의 수정과 국가 파라미터는 거절된다',
      editB.status === 403 && editB.json.error === 'BOARD_FORBIDDEN'
      && spoof.status === 403 && spoof.json.error === 'REGION_MISMATCH' && spoofN.n === 0);

    const commentRegion = (await client.query(
      'SELECT activity_region FROM public.board_comments WHERE post_id = $1', [usId]
    )).rows[0];
    const reactionRegion = (await client.query(
      "SELECT activity_region FROM public.board_reactions WHERE post_id = $1 AND actor_user_id = $2",
      [usId, USER_B]
    )).rows[0];
    check('댓글과 반응 국가는 원글과 같다',
      commentRegion.activity_region === 'US' && reactionRegion.activity_region === 'US');

    async function asMember(fn) {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [USER_A]);
        return await fn();
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw err;
      }
    }
    const directUs = await asMember(function () {
      return client.query("SELECT count(*)::int AS n FROM public.board_posts WHERE activity_region = 'US'");
    });
    await client.query('ROLLBACK');
    let directWrite = null;
    try {
      await asMember(function () {
        return client.query(
          "INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region) " +
            "VALUES ($1, 'CENTRAL', '직접 미국', '우회', 'US')",
          [USER_A]
        );
      });
    } catch (err) { directWrite = err; }
    try { await client.query('ROLLBACK'); } catch (_) {}
    check('로그인 역할은 미국 글을 보거나 쓰지 못한다',
      directUs.rows[0].n === 0 && !!directWrite);

    const badge = (await client.query(
      "SELECT count(*)::int AS n FROM public.user_activity_region_achievement WHERE achievement_key = 'kr-kept-badge'"
    )).rows[0];
    const align = (await client.query(
      'SELECT score::text AS score FROM public.user_alignment_state WHERE user_id = $1', [USER_A]
    )).rows[0];
    check('한국 업적과 성향 점수는 미국 표로 복사되지 않는다', badge.n === 0 && align.score === '12.500000');

    let persistCalls = 0;
    const skipped = await runAlignmentBatch({
      batchId: 'alignment-auth-env-us-skip',
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
    console.log('LOCAL_POSTGRES', 'CHECKS_OK');
  } finally {
    if (server) {
      try { await closeServer(server); } catch (_) {}
    }
    try { await client.end(); } catch (_) {}
    try { await cluster.stop(); } catch (err) {
      console.log('STOP_WARN', err && err.code ? err.code : 'stop');
    }
  }
}

async function main() {
  const reason = authBlockReason();
  console.log('AUTH_REAL', reason ? 'BLOCKED' : 'UNKNOWN', reason || 'docker-present-but-not-started');
  console.log('MAIL', 'not-sent');
  if (reason) console.log('AUTH_BLOCK_REASON', reason);
  await ipChoiceChecks();
  await postgresChecks();
  console.log('PLAYWRIGHT', 'NOT_RUN', 'auth-server-missing');
  console.log('MOCK_HEADER', 'USED_FOR_STORAGE_IDENTITY');
  if (failed) {
    console.error('LOCAL_CHECKS_FAILED', failed);
    process.exitCode = 1;
    return;
  }
  if (reason) {
    console.log('AUTH_ENVIRONMENT_BLOCKED');
    process.exitCode = 2;
    return;
  }
  console.log('AUTH_ENVIRONMENT_READY');
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
