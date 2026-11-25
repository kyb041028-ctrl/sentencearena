#!/usr/bin/env node
'use strict';

/**
 * 로컬 Postgres에 서버가 확인한 시험 세션으로 저장한다.
 * x-user-id는 신원으로 쓰지 않는다.
 * Supabase Auth 세션이 아니고, 운영 DB도 아니다.
 */

process.env.LEGAL_GATE_ENFORCE = '0';
process.env.SA_LOCAL_AUTH_VERIFY = '1';
if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
  delete process.env.NODE_ENV;
}

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const express = require('express');

const { createBoardRouter } = require('../server/board-routes');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createLocalSessionVerifier, hashToken } = require('../server/local-test-session');
const { evaluateProductionBootGuards } = require('../server/production-boot-guards');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ROOT = path.join(__dirname, '..');
const TOKEN_A = crypto.randomBytes(24).toString('hex');
const TOKEN_B = crypto.randomBytes(24).toString('hex');

let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

function commandMissing(name) {
  try {
    execFileSync('where.exe', [name], { stdio: 'ignore' });
    return false;
  } catch (_) {
    return true;
  }
}

function readSql(name) {
  return fs.readFileSync(path.join(ROOT, 'supabase', name), 'utf8');
}

async function applySql(client, label, sql) {
  try {
    await client.query(sql);
    return null;
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : 'sql';
    console.log('SQL_FAIL', label, message);
    return message;
  }
}

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

function closeServer(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
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

function member(token, region, extra) {
  return Object.assign({
    'content-type': 'application/json',
    authorization: 'Bearer ' + token,
    cookie: 'sa_ar=' + region + '; sa_ar_x=1',
  }, extra || {});
}

async function bootSchema(client) {
  const stubError = await applySql(client, 'local-auth-stub', `
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS auth.local_test_sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL,
      expires_at timestamptz NOT NULL
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

async function main() {
  console.log('AUTH_MODE', 'local-session-not-supabase-auth');
  if (commandMissing('docker') && commandMissing('podman')) {
    console.log('SUPABASE_AUTH_BLOCKED', 'docker-and-podman-missing');
  } else {
    console.log('SUPABASE_AUTH_NOT_STARTED', 'no-supabase-project-config');
  }
  const headerGuard = evaluateProductionBootGuards({
    NODE_ENV: 'production',
    DAILY_ISSUE_REPOSITORY: 'db',
    DAILY_ISSUE_DB_SCHEMA: 'daily_issue',
    BOARD_OPERATIONAL: 'true',
    TERRITORY_EVOLUTION_OPERATIONAL: 'true',
    APP_PUBLIC_ORIGIN: 'https://sentencearena.com',
    SA_TEST_ACTOR_HEADER: '1',
  });
  const localGuard = evaluateProductionBootGuards({
    NODE_ENV: 'production',
    DAILY_ISSUE_REPOSITORY: 'db',
    DAILY_ISSUE_DB_SCHEMA: 'daily_issue',
    BOARD_OPERATIONAL: 'true',
    TERRITORY_EVOLUTION_OPERATIONAL: 'true',
    APP_PUBLIC_ORIGIN: 'https://sentencearena.com',
    SA_LOCAL_AUTH_VERIFY: '1',
  });
  check('운영에서 시험 헤더 인증은 꺼진다', !headerGuard.ok);
  check('운영에서 로컬 시험 세션은 꺼진다', !localGuard.ok);

  const pgPath = path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js');
  if (!fs.existsSync(pgPath)) {
    console.log('LOCAL_POSTGRES_UNAVAILABLE');
    process.exitCode = 2;
    return;
  }

  const mod = await import(pathToFileURL(pgPath).href);
  const EmbeddedPostgres = mod.default;
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), 'sa-region-auth-storage-' + Date.now()),
    port: 55446,
    user: 'postgres',
    password: 'password',
    persistent: false,
  });
  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase('sentencearena_region_auth_storage');
  const client = cluster.getPgClient('sentencearena_region_auth_storage');
  await client.connect();
  console.log('DB', 'local-postgresql', 'sentencearena_region_auth_storage');
  let server = null;
  try {
    await bootSchema(client);
    await client.query(
      'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)',
      [USER_A, 'a.local.test@example.com', USER_B, 'b.local.test@example.com']
    );
    await client.query(
      'INSERT INTO auth.local_test_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'1 hour\'), ($3, $4, now() + interval \'1 hour\')',
      [hashToken(TOKEN_A), USER_A, hashToken(TOKEN_B), USER_B]
    );
    await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content) VALUES ($1, 'CENTRAL', '한국 보존 글', '보존 본문')",
      [USER_A]
    );
    await client.query(
      'INSERT INTO public.user_progression (user_id, xp, level, reputation_score) VALUES ($1, 80, 2, 9)',
      [USER_A]
    );
    await client.query(
      'INSERT INTO public.user_alignment_state (user_id, score, previous_signal) VALUES ($1, 12.5, 1)',
      [USER_A]
    );

    const verify = createLocalSessionVerifier(function (sql, params) { return client.query(sql, params); });
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const blocked = await verify({ headers: { authorization: 'Bearer ' + TOKEN_A } });
    if (previousEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    check('운영 모드 검증기는 세션을 받아들이지 않는다', blocked == null);

    const app = express();
    app.use(express.json());
    app.use('/api/board', createBoardRouter({
      operational: true,
      useMemory: false,
      pgQuery: function (sql, params) { return client.query(sql, params); },
      userContext: createMockUserContextAdapter({
        territories: { [USER_A]: 'CENTRAL', [USER_B]: 'CENTRAL' },
      }),
      resolveActorFromRequest: verify,
    }));
    server = await listen(app);

    const guest = await request(server, 'POST', '/api/board/posts', {
      'content-type': 'application/json',
      cookie: 'sa_ar=US; sa_ar_x=1',
      'x-user-id': USER_A,
    }, { title: 'guest write', content: 'no' });
    check('선택 쿠키와 x-user-id만으로는 쓰지 못한다', guest.status === 401, String(guest.status));

    const fake = await request(server, 'POST', '/api/board/posts', member('not-a-session', 'US'), {
      title: 'fake token',
      content: 'no',
    });
    check('없는 세션은 거절된다', fake.status === 401);

    const usPost = await request(server, 'POST', '/api/board/posts', member(TOKEN_A, 'US', { 'x-user-id': USER_B }), {
      title: 'US stored note',
      content: 'US body',
    });
    check(
      '미국 글은 세션 주인으로 저장된다',
      usPost.status === 201 && usPost.json && usPost.json.post && usPost.json.post.activityRegion === 'US' && usPost.json.post.author && usPost.json.post.author.userId === USER_A && usPost.json.progression && usPost.json.progression.xp === 25,
      JSON.stringify(usPost.json && usPost.json.post && usPost.json.post.author)
    );
    const usId = usPost.json.post.id;
    const usComment = await request(server, 'POST', '/api/board/posts/' + usId + '/comments', member(TOKEN_A, 'US'), {
      content: 'US reply',
    });
    check('미국 댓글 국가는 US', usComment.status === 201 && usComment.json.comment.activityRegion === 'US');
    const usReaction = await request(server, 'POST', '/api/board/reactions/toggle', member(TOKEN_B, 'US'), {
      targetType: 'POST',
      targetId: usId,
      reactionType: 'LIKE',
    });
    check('미국 반응이 저장된다', usReaction.status === 200 && usReaction.json && usReaction.json.ok === true);
    const empathy = await request(server, 'POST', '/api/board/posts/' + usId + '/empathy', member(TOKEN_B, 'US'));
    check('미국 명성 1, 경험치 37', empathy.status === 200 && empathy.json && empathy.json.fame === 1 && empathy.json.xp === 37, JSON.stringify(empathy.json));

    const profile = await request(server, 'GET', '/api/board/region-profile', member(TOKEN_A, 'US'));
    const again = await request(server, 'GET', '/api/board/region-profile', member(TOKEN_A, 'US'));
    const row = profile.json && profile.json.profile;
    const rowAgain = again.json && again.json.profile;
    check(
      '미국 프로필 재조회가 저장값이다',
      row && rowAgain && row.region === 'US' && row.xp === 37 && rowAgain.xp === 37 && row.level === 1 && row.fame === 1 && row.aura === 0 && row.tendency == null && row.achievements.indexOf('first-post') !== -1,
      JSON.stringify(row)
    );

    const krPost = await request(server, 'POST', '/api/board/posts', member(TOKEN_A, 'KR'), {
      title: '한국 새 글',
      content: '한국 본문',
    });
    check('한국 글은 국가 칸이 비어 있다', krPost.status === 201 && krPost.json.post.activityRegion == null);
    const krProfile = await request(server, 'GET', '/api/board/region-profile', member(TOKEN_A, 'KR'));
    const krProgress = await client.query('SELECT xp, level, reputation_score FROM public.user_progression WHERE user_id = $1', [USER_A]);
    check(
      '한국 경험치와 명성은 그대로다',
      krProfile.json.profile.xp === 80 && krProfile.json.profile.level === 2 && krProfile.json.profile.fame === 9 && Number(krProgress.rows[0].xp) === 80 && Number(krProgress.rows[0].reputation_score) === 9
    );
    const alignment = await client.query('SELECT score FROM public.user_alignment_state WHERE user_id = $1', [USER_A]);
    check('한국 성향 점수는 그대로다', String(alignment.rows[0].score) === '12.500000');

    const edited = await request(server, 'PATCH', '/api/board/posts/' + usId, member(TOKEN_B, 'US'), { title: 'B changed it' });
    const still = await client.query('SELECT title, author_user_id FROM public.board_posts WHERE id = $1', [usId]);
    check('다른 세션은 미국 글을 고치지 못한다', edited.status === 403 && still.rows[0].title === 'US stored note' && still.rows[0].author_user_id === USER_A, String(edited.status));

    const spoof = await request(server, 'POST', '/api/board/posts', member(TOKEN_A, 'US'), {
      title: 'spoof into KR',
      content: 'no',
      activityRegion: 'KR',
    });
    const spoofCount = await client.query("SELECT count(*)::int AS n FROM public.board_posts WHERE title = 'spoof into KR'");
    check('본문 국가 변경은 저장되지 않는다', spoof.status === 403 && spoofCount.rows[0].n === 0);

    const lists = await request(server, 'GET', '/api/board/posts', member(TOKEN_A, 'US'));
    const titles = (lists.json.posts || []).map(function (post) { return post.title; });
    check('미국 목록에 한국 글이 없다', titles.indexOf('한국 보존 글') < 0 && titles.indexOf('US stored note') >= 0, titles.join(','));

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [USER_A]);
    const seen = await client.query("SELECT count(*)::int AS n FROM public.board_posts WHERE activity_region = 'US'");
    let directInsert = null;
    try {
      await client.query(
        "INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region) VALUES ($1, 'CENTRAL', 'direct us', 'no', 'US')",
        [USER_A]
      );
    } catch (err) {
      directInsert = err;
    }
    await client.query('ROLLBACK');
    check('직접 회원 권한은 미국 글을 보거나 넣지 못한다', seen.rows[0].n === 0 && directInsert, directInsert && directInsert.message ? directInsert.message.split('\n')[0] : '');
  } finally {
    if (server) {
      try { await closeServer(server); } catch (_) {}
    }
    try { await client.end(); } catch (_) {}
    try { await cluster.stop(); } catch (err) {
      console.log('STOP_WARN', err && err.code ? err.code : 'stop');
    }
  }

  console.log('SUPABASE_MOCK_NOT_THIS_TEST');
  console.log('PRODUCTION_NOT_APPLIED');
  if (failed) {
    console.log('LOCAL_POSTGRES_STORAGE_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('LOCAL_POSTGRES_STORAGE_OK');
}

main().catch(function (err) {
  console.log('LOCAL_POSTGRES_STORAGE_FAIL', err && err.message ? err.message : 'error');
  process.exitCode = 1;
});
