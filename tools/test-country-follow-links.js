'use strict';
/**
 * 국가별 팔로우 연결. 격리 Postgres와 실제 사용자 데이터 라우트만 사용한다.
 * node tools/test-country-follow-links.js
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const service = require('../server/user-data-service');
const repo = require('../server/user-data-supabase-repository');
const routes = require('../server/user-data-routes');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

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

function cookie(region) {
  return { cookie: 'sa_ar=' + region + '; sa_ar_x=1', 'x-sc-user-id': A };
}

async function main() {
  let Pool;
  try { Pool = require('pg').Pool; }
  catch (_err) {
    process.stdout.write('NOT RUN country-follow-links: pg module missing\n');
    process.exit(0);
  }
  const admin = new (require('pg').Client)({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-follow-links: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_follow_' + process.pid;
  const lines = [];
  let pool;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    pool = new Pool({ connectionString: 'postgres://127.0.0.1:5432/' + dbName, max: 4 });
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, territory text NULL);
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        follower_count bigint NOT NULL DEFAULT 0,
        following_count bigint NOT NULL DEFAULT 0
      );
      CREATE TABLE public.user_progression_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        event_type text NOT NULL,
        dedupe_key text NOT NULL
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
      CREATE TABLE public.user_activity_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        activity_type text,
        payload jsonb,
        dedupe_key text,
        activity_region text,
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT user_follows_unique UNIQUE (follower_user_id, following_user_id),
        CONSTRAINT user_follows_no_self_follow CHECK (follower_user_id <> following_user_id)
      );
    `);
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_rank_event_context_candidate.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_country_follow_candidate.sql'), 'utf8'));
    await client.query(
      'INSERT INTO public.profiles (id, territory) VALUES ($1, \'CENTRAL\'), ($2, \'PIONEER\'), ($3, \'GUARDIAN\')',
      [A, B, D]
    );
    await client.query(
      'INSERT INTO public.user_progression (user_id) VALUES ($1), ($2), ($3)',
      [A, B, D]
    );
    await client.query(
      'INSERT INTO public.user_follows (follower_user_id, following_user_id) VALUES ($1, $2)',
      [C, B]
    );
    client.release();

    repo.setAdminClient({ query: function (sql, params) { return pool.query(sql, params); } });
    repo.setUserClient({ query: function (sql, params) { return pool.query(sql, params); } });
    service.setRepository(repo);
    service.setDataMode('API_OPERATIONAL');
    const app = express();
    app.use(express.json());
    app.use('/api', routes);

    const krFollow = await request(app, 'POST', '/api/users/' + B + '/follow/toggle', cookie('KR'), {});
    const usState = await request(app, 'GET', '/api/users/' + B + '/follow-state', cookie('US'));
    const usFollow = await request(app, 'POST', '/api/users/' + B + '/follow/toggle', cookie('US'), {});
    const krFollowers = await request(app, 'GET', '/api/users/' + B + '/followers', cookie('KR'));
    const usFollowers = await request(app, 'GET', '/api/users/' + B + '/followers', cookie('US'));
    lines.push(line(
      krFollow.status === 200 && krFollow.body && krFollow.body.data && krFollow.body.data.status === 'FOLLOWED',
      '1-kr-a-follows-b',
      'server'
    ));
    lines.push(line(
      usState.status === 200 && usState.body && usState.body.data && usState.body.data.isFollowing === false,
      '2-us-follow-state-not-following',
      'server'
    ));
    lines.push(line(
      usFollow.status === 200 && usFollow.body && usFollow.body.data && usFollow.body.data.status === 'FOLLOWED',
      '3-us-a-follows-b',
      'server'
    ));
    const shared = await pool.query(
      'SELECT user_id, follower_count, following_count FROM public.user_progression WHERE user_id IN ($1, $2) ORDER BY user_id',
      [A, B]
    );
    lines.push(line(
      krFollowers.body && krFollowers.body.data && krFollowers.body.data.length === 1 &&
      usFollowers.body && usFollowers.body.data && usFollowers.body.data.length === 1 &&
      Number(shared.rows[0].following_count) === 0 && Number(shared.rows[0].follower_count) === 0 &&
      Number(shared.rows[1].following_count) === 0 && Number(shared.rows[1].follower_count) === 0,
      '4-each-country-shows-one-follower',
      'server'
    ));

    const repeat = await pool.query(
      'SELECT public.isolate_follow_once($1,$2,\'KR\',\'CENTRAL\',false) AS result',
      [A, B]
    );
    const krAfterRepeat = await request(app, 'GET', '/api/users/' + B + '/followers', cookie('KR'));
    lines.push(line(
      repeat.rows[0].result.status === 'EXISTING' && repeat.rows[0].result.code === 'DUPLICATE' &&
      krAfterRepeat.body.data.length === 1,
      '7-repeat-does-not-double',
      'direct'
    ));

    const krUnfollow = await request(app, 'POST', '/api/users/' + B + '/follow/toggle', cookie('KR'), {});
    const usAfter = await request(app, 'GET', '/api/users/' + B + '/follow-state', cookie('US'));
    const krAfter = await request(app, 'GET', '/api/users/' + B + '/follow-state', cookie('KR'));
    lines.push(line(
      krUnfollow.body && krUnfollow.body.data && krUnfollow.body.data.status === 'CANCELLED' &&
      krAfter.body.data.isFollowing === false && usAfter.body.data.isFollowing === true,
      '5-kr-unfollow-keeps-us',
      'server'
    ));
    const krRefollow = await request(app, 'POST', '/api/users/' + B + '/follow/toggle', cookie('KR'), {});
    const krBack = await request(app, 'GET', '/api/users/' + B + '/followers', cookie('KR'));
    const usStill = await request(app, 'GET', '/api/users/' + B + '/followers', cookie('US'));
    const sharedAfter = await pool.query(
      'SELECT COALESCE(sum(follower_count), 0)::int AS followers, COALESCE(sum(following_count), 0)::int AS following FROM public.user_progression'
    );
    lines.push(line(
      krRefollow.body && krRefollow.body.data && krRefollow.body.data.status === 'FOLLOWED' &&
      krBack.body.data.length === 1 && usStill.body.data.length === 1 &&
      Number(sharedAfter.rows[0].followers) === 0 && Number(sharedAfter.rows[0].following) === 0,
      '6-kr-refollow',
      'server'
    ));

    const [sideKr, sideUs] = await Promise.all([
      request(app, 'POST', '/api/users/' + D + '/follow/toggle', cookie('KR'), {}),
      request(app, 'POST', '/api/users/' + D + '/follow/toggle', cookie('US'), {}),
    ]);
    const dKr = await request(app, 'GET', '/api/users/' + D + '/followers', cookie('KR'));
    const dUs = await request(app, 'GET', '/api/users/' + D + '/followers', cookie('US'));
    lines.push(line(
      sideKr.body && sideKr.body.data && sideKr.body.data.status === 'FOLLOWED' &&
      sideUs.body && sideUs.body.data && sideUs.body.data.status === 'FOLLOWED' &&
      dKr.body.data.length === 1 && dUs.body.data.length === 1,
      '8-concurrent-kr-and-us',
      'server'
    ));

    const followingKr = await request(app, 'GET', '/api/users/' + A + '/following', cookie('KR'));
    const followingUs = await request(app, 'GET', '/api/users/' + A + '/following', cookie('US'));
    const stateKr = await request(app, 'GET', '/api/users/' + B + '/follow-state', cookie('KR'));
    const stateUs = await request(app, 'GET', '/api/users/' + B + '/follow-state', cookie('US'));
    const legacy = await pool.query(
      'SELECT activity_region FROM public.user_follows WHERE follower_user_id = $1 AND following_user_id = $2',
      [C, B]
    );
    const krListNow = await request(app, 'GET', '/api/users/' + B + '/followers', cookie('KR'));
    const usListNow = await request(app, 'GET', '/api/users/' + B + '/followers', cookie('US'));
    const legacyInKr = (krListNow.body.data || []).some(function (row) { return row.follower_user_id === C; });
    const legacyInUs = (usListNow.body.data || []).some(function (row) { return row.follower_user_id === C; });
    lines.push(line(
      followingKr.body.data.some(function (row) { return row.following_user_id === B; }) &&
      followingUs.body.data.some(function (row) { return row.following_user_id === B; }) &&
      stateKr.body.data.isFollowing === true && stateUs.body.data.isFollowing === true &&
      legacy.rows[0].activity_region == null && legacyInKr === false && legacyInUs === false &&
      krListNow.body.data.length === 1 && usListNow.body.data.length === 1,
      '10-followers-following-and-state-are-country-scoped',
      'server'
    ));

    const missing = await request(app, 'POST', '/api/users/' + B + '/follow/toggle', { 'x-sc-user-id': A }, {});
    const mismatch = await request(app, 'POST', '/api/users/' + B + '/follow/toggle', cookie('KR'), { activityRegion: 'US' });
    const beforeDirect = await pool.query(
      'SELECT activity_region, cancelled_at IS NULL AS active FROM public.user_follows WHERE follower_user_id = $1 AND following_user_id = $2 ORDER BY activity_region NULLS FIRST',
      [A, B]
    );
    const other = await pool.query(
      'SELECT public.isolate_follow_once($1,$2,\'US\',\'CENTRAL\',true) AS result',
      [A, B]
    );
    const afterDirect = await pool.query(
      'SELECT activity_region, cancelled_at IS NULL AS active FROM public.user_follows WHERE follower_user_id = $1 AND following_user_id = $2 AND activity_region = \'KR\'',
      [A, B]
    );
    const blank = await pool.query(
      'SELECT public.isolate_follow_once($1,$2,NULL,\'CENTRAL\',false) AS result',
      [A, B]
    );
    lines.push(line(
      missing.status === 400 && missing.body.error === 'COUNTRY_REQUIRED' &&
      mismatch.status === 400 && mismatch.body.error === 'COUNTRY_MISMATCH' &&
      blank.rows[0].result.code === 'FOLLOW_SCOPE_UNKNOWN' &&
      other.rows[0].result.status !== 'ERROR' &&
      afterDirect.rows[0].active === true,
      '9-missing-or-other-country-does-not-cross',
      'server-and-direct'
    ));

    lines.push('INFO legacy-null-row-kept ' + String(legacy.rows[0].activity_region));
    lines.push('INFO direct-us-cancel-status ' + other.rows[0].result.status);
    lines.push('INFO kr-rows-before-direct ' + beforeDirect.rows.map(function (row) {
      return String(row.activity_region) + ':' + String(row.active);
    }).join(','));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    service.setDataMode('LEGACY_LOCAL');
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
