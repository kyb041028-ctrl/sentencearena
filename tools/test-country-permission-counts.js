'use strict';
/**
 * 쿠키는 나라와 미국 참여를 혼자 정하지 않는다.
 * 화면에 나오는 팔로워 수는 나라별 팔로우 행이다.
 * node tools/test-country-permission-counts.js
 */
process.env.LEGAL_GATE_ENFORCE = '1';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const fs = require('fs');
const path = require('path');
const express = require('express');
const service = require('../server/user-data-service');
const repo = require('../server/user-data-supabase-repository');
const routes = require('../server/user-data-routes');
const { createBoardRouter } = require('../server/board-routes');
const { createBoardService } = require('../server/board-service');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const dataAdapter = require('../public/user-profile-data-adapter');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

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
  const headers = { 'x-sc-user-id': userId };
  if (region) headers.cookie = 'sa_ar=' + region + '; sa_ar_x=1';
  return headers;
}

function uid(n) {
  return 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12, '0');
}

async function main() {
  let Pool;
  try { Pool = require('pg').Pool; }
  catch (_err) {
    process.stdout.write('NOT RUN country-permission-counts: pg module missing\n');
    process.exit(0);
  }
  const admin = new (require('pg').Client)({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-permission-counts: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_permit_' + process.pid;
  const lines = [];
  let pool;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    pool = new Pool({ connectionString: 'postgres://127.0.0.1:5432/' + dbName, max: 4 });
    const client = await pool.connect();
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_country_progression_candidate.sql'), 'utf8'));
    await client.query(`
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        territory text NULL,
        display_name text NULL
      );
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        xp bigint NOT NULL DEFAULT 0,
        level integer NOT NULL DEFAULT 1,
        reputation_score bigint NOT NULL DEFAULT 0,
        citizen_rank text NULL,
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
      CREATE TABLE public.user_legal_consents (
        user_id uuid PRIMARY KEY,
        age_requirement_confirmed_at timestamptz NULL,
        age_policy_version text NULL,
        age_gate_method text NULL,
        sensitive_political_consented_at timestamptz NULL,
        sensitive_political_policy_version text NULL,
        territory_disclosure_consented_at timestamptz NULL,
        territory_disclosure_policy_version text NULL,
        political_profile_visibility text NOT NULL DEFAULT 'private'
      );
      CREATE TABLE public.user_activity_region_legal_consents (
        user_id uuid NOT NULL,
        activity_region text NOT NULL,
        age_requirement_confirmed_at timestamptz NULL,
        age_policy_version text NULL,
        age_policy_region text NULL,
        age_gate_method text NULL,
        terms_document_version text NULL,
        terms_consented_at timestamptz NULL,
        privacy_document_version text NULL,
        privacy_acknowledged_at timestamptz NULL,
        privacy_processing_consent_at timestamptz NULL,
        PRIMARY KEY (user_id, activity_region)
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
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_rank_event_context_candidate.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_country_follow_candidate.sql'), 'utf8'));
    await client.query(
      'INSERT INTO public.profiles (id, territory, display_name) VALUES ($1, \'CENTRAL\', \'A\'), ($2, \'PIONEER\', \'B\'), ($3, \'CENTRAL\', \'C\'), ($4, \'GUARDIAN\', \'D\'), ($5, \'CENTRAL\', \'E\')',
      [A, B, C, D, E]
    );
    await client.query(
      'INSERT INTO public.user_progression (user_id, follower_count, following_count) VALUES ($1, 99, 77), ($2, 0, 0), ($3, 0, 0), ($4, 0, 0), ($5, 0, 0)',
      [A, B, C, D, E]
    );
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO public.user_legal_consents (
         user_id, age_requirement_confirmed_at, age_policy_version,
         sensitive_political_consented_at, sensitive_political_policy_version,
         territory_disclosure_consented_at, territory_disclosure_policy_version
       ) VALUES ($1, $2, 'age-policy-v1', $2, 'sensitive-political-v1', $2, 'territory-disclosure-v1'),
                ($3, $2, 'age-policy-v1', $2, 'sensitive-political-v1', $2, 'territory-disclosure-v1'),
                ($4, $2, 'age-policy-v1', $2, 'sensitive-political-v1', $2, 'territory-disclosure-v1')`,
      [B, now, D, A]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_legal_consents (
         user_id, activity_region, age_requirement_confirmed_at, age_policy_version, age_policy_region
       ) VALUES ($1, 'US', $2, 'age-policy-us-v1', 'US')`,
      [C, now]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_legal_consents (
         user_id, activity_region, age_requirement_confirmed_at, age_policy_version, age_policy_region,
         terms_document_version, terms_consented_at, privacy_document_version, privacy_acknowledged_at
       ) VALUES ($1, 'US', $2, 'age-policy-us-v1', 'US', 'terms-draft-us-v1', $2, 'privacy-draft-us-v1', $2)`,
      [D, now]
    );
    let i;
    for (i = 1; i <= 10; i += 1) {
      await client.query(
        'INSERT INTO public.user_follows (follower_user_id, following_user_id, activity_region, territory_at_follow) VALUES ($1, $2, \'KR\', \'CENTRAL\')',
        [uid(i), A]
      );
    }
    await client.query(
      'INSERT INTO public.user_follows (follower_user_id, following_user_id, activity_region, territory_at_follow, cancelled_at) VALUES ($1, $2, \'KR\', \'CENTRAL\', now())',
      [uid(11), A]
    );
    await client.query(
      'INSERT INTO public.user_follows (follower_user_id, following_user_id, territory_at_follow) VALUES ($1, $2, \'CENTRAL\')',
      [uid(12), A]
    );
    for (i = 21; i <= 23; i += 1) {
      await client.query(
        'INSERT INTO public.user_follows (follower_user_id, following_user_id, activity_region, territory_at_follow) VALUES ($1, $2, \'US\', \'CENTRAL\')',
        [uid(i), A]
      );
    }
    client.release();

    const query = function (sql, params) { return pool.query(sql, params); };
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
    }));
    app.use('/api', routes);

    const usPost = await request(app, 'POST', '/api/board/posts', cookie('US', D), { title: 'US post', content: 'body' });
    const krPost = await request(app, 'POST', '/api/board/posts', cookie('KR', B), { title: '한국 글', content: '본문' });
    const usPostId = usPost.body && usPost.body.post && usPost.body.post.id;
    const krPostId = krPost.body && krPost.body.post && krPost.body.post.id;
    const beforeComments = await pool.query('SELECT count(*)::int AS n FROM public.board_comments');

    const krComment = await request(app, 'POST', '/api/board/posts/' + usPostId + '/comments', cookie('KR', B), { content: '한국 쿠키 댓글' });
    const krEmpathy = await request(app, 'POST', '/api/board/posts/' + usPostId + '/empathy', cookie('KR', B), {});
    const krEdit = await request(app, 'PATCH', '/api/board/posts/' + usPostId, cookie('KR', B), { title: '한국에서 고침', content: 'body' });
    const krDelete = await request(app, 'DELETE', '/api/board/posts/' + usPostId, cookie('KR', B));
    const krReport = await request(app, 'POST', '/api/board/reports', cookie('KR', B), {
      targetType: 'POST', targetId: usPostId, reasonCode: 'ABUSE',
    });
    const afterProbe = await pool.query(
      'SELECT activity_region, status, title FROM public.board_posts WHERE id = $1',
      [usPostId]
    );
    const commentRows = await pool.query(
      'SELECT activity_region FROM public.board_comments WHERE post_id = $1',
      [usPostId]
    );
    const usRow = afterProbe.rows[0] || {};
    lines.push(line(
      krComment.status === 403 && krComment.body && krComment.body.error === 'AGE_UNVERIFIED'
        && krEmpathy.body && krEmpathy.body.error === 'AGE_UNVERIFIED'
        && krEdit.body && krEdit.body.error === 'AGE_UNVERIFIED'
        && krDelete.body && krDelete.body.error === 'AGE_UNVERIFIED'
        && krReport.body && krReport.body.error === 'AGE_UNVERIFIED'
        && commentRows.rows.length === 0
        && usRow.activity_region === 'US'
        && usRow.status === 'ACTIVE'
        && usRow.title === 'US post'
        && beforeComments.rows[0].n === commentRows.rows.length,
      '1-kr-cookie-on-us-content-checked-as-us',
      'server'
    ));

    const noConsentPost = await request(app, 'POST', '/api/board/posts', cookie('US', C), { title: 'no terms', content: 'body' });
    const noConsentComment = await request(app, 'POST', '/api/board/posts/' + usPostId + '/comments', cookie('US', C), { content: 'no terms' });
    const noConsentEmpathy = await request(app, 'POST', '/api/board/posts/' + usPostId + '/empathy', cookie('US', C), {});
    const savedNoConsent = await pool.query(
      "SELECT count(*)::int AS n FROM public.board_posts WHERE title = 'no terms'"
    );
    lines.push(line(
      krComment.body && krComment.body.error === 'AGE_UNVERIFIED',
      '2-under-18-us-participation-rejected',
      'server'
    ));
    lines.push(line(
      noConsentPost.body && noConsentPost.body.error === 'US_CONSENT_REQUIRED'
        && noConsentComment.body && noConsentComment.body.error === 'US_CONSENT_REQUIRED'
        && noConsentEmpathy.body && noConsentEmpathy.body.error === 'US_CONSENT_REQUIRED'
        && savedNoConsent.rows[0].n === 0,
      '3-missing-us-consent-rejects-post-comment-reaction',
      'server'
    ));

    const qualifiedComment = await request(app, 'POST', '/api/board/posts/' + usPostId + '/comments', cookie('KR', D), { content: '자격 댓글' });
    const qualifiedEmpathy = await request(app, 'POST', '/api/board/posts/' + usPostId + '/empathy', cookie('US', B), {});
    const qualifiedOwn = await request(app, 'POST', '/api/board/posts/' + usPostId + '/empathy', cookie('US', E), {});
    const dEmpathy = await request(app, 'POST', '/api/board/posts/' + krPostId + '/empathy', cookie('US', D), {});
    const savedQualified = await pool.query(
      'SELECT activity_region FROM public.board_comments WHERE post_id = $1 AND author_user_id = $2',
      [usPostId, D]
    );
    const usStill = await pool.query('SELECT activity_region, title FROM public.board_posts WHERE id = $1', [usPostId]);
    lines.push(line(
      usPost.status === 201 && usPost.body.post.activityRegion === 'US'
        && qualifiedComment.status === 201
        && savedQualified.rows[0] && savedQualified.rows[0].activity_region === 'US'
        && usStill.rows[0].activity_region === 'US'
        && qualifiedEmpathy.status === 403,
      '4-qualified-us-member-can-act ' + qualifiedComment.status + ',' + qualifiedEmpathy.status + ',' + qualifiedOwn.status + ',' + dEmpathy.status,
      'server'
    ));

    const krOwn = await request(app, 'POST', '/api/board/posts/' + krPostId + '/comments', cookie('KR', B), { content: '한국 댓글' });
    const krSaved = await pool.query(
      'SELECT activity_region FROM public.board_comments WHERE post_id = $1 AND author_user_id = $2',
      [krPostId, B]
    );
    const usCookieOnKr = await request(app, 'POST', '/api/board/posts/' + krPostId + '/comments', cookie('US', E), { content: '미국 쿠키' });
    const eSaved = await pool.query(
      'SELECT count(*)::int AS n FROM public.board_comments WHERE author_user_id = $1',
      [E]
    );
    const dOnKr = await pool.query(
      'SELECT activity_region FROM public.board_comments WHERE post_id = $1 AND author_user_id = $2',
      [krPostId, D]
    );
    lines.push(line(
      krPost.status === 201 && krPost.body.post.activityRegion === 'KR'
        && krOwn.status === 201 && krSaved.rows[0] && krSaved.rows[0].activity_region === 'KR'
        && usCookieOnKr.body && usCookieOnKr.body.error === 'LEGAL_GATE_INCOMPLETE'
        && eSaved.rows[0].n === 0
        && dEmpathy.status === 200
        && dOnKr.rows.length === 0,
      '5-kr-member-still-acts-on-kr ' + (usCookieOnKr.body && usCookieOnKr.body.error),
      'server'
    ));

    const readUs = await request(app, 'GET', '/api/board/posts/' + usPostId, cookie('KR', B));
    const barePost = await request(app, 'POST', '/api/board/posts', cookie(null, B), { title: '쿠키 없음', content: '본문' });
    const bareSaved = await pool.query("SELECT count(*)::int AS n FROM public.board_posts WHERE title = '쿠키 없음'");
    const pretendFollow = await request(app, 'POST', '/api/users/' + A + '/follow/toggle', cookie('KR', B), { activityRegion: 'US' });
    lines.push('INFO kr-cookie-us-comment ' + (krComment.body && krComment.body.error) + ' saved=0 region=' + usRow.activity_region);
    lines.push('INFO kr-cookie-us-empathy ' + (krEmpathy.body && krEmpathy.body.error));
    lines.push('INFO kr-cookie-us-edit ' + (krEdit.body && krEdit.body.error) + ' title=' + usRow.title);
    lines.push('INFO kr-cookie-us-delete ' + (krDelete.body && krDelete.body.error) + ' status=' + usRow.status);
    lines.push('INFO kr-cookie-us-report ' + (krReport.body && krReport.body.error));
    lines.push('INFO new-us-post-by-qualified ' + (usPost.body && usPost.body.post && usPost.body.post.activityRegion));
    lines.push('INFO no-cookie-post ' + (barePost.body && barePost.body.error) + ' saved=' + bareSaved.rows[0].n);
    lines.push('INFO us-cookie-kr-post ' + (usCookieOnKr.body && usCookieOnKr.body.error) + ' saved=' + eSaved.rows[0].n);
    lines.push('INFO pretend-follow ' + (pretendFollow.body && pretendFollow.body.error));
    lines.push('INFO kr-read-us ' + readUs.status + ' region=' + (readUs.body && readUs.body.post && readUs.body.post.activityRegion));
    lines.push(line(
      barePost.status === 400 && barePost.body && barePost.body.error === 'COUNTRY_REQUIRED' && bareSaved.rows[0].n === 0
        && pretendFollow.status === 400 && pretendFollow.body && pretendFollow.body.error === 'COUNTRY_MISMATCH'
        && readUs.status === 200 && readUs.body.post && readUs.body.post.activityRegion === 'US',
      '1b-no-cookie-not-saved-as-kr-and-follow-pretend-rejected',
      'server'
    ));

    const krProg = await request(app, 'GET', '/api/users/me/progression', cookie('KR', A));
    const usProg = await request(app, 'GET', '/api/users/' + A + '/progression/public', cookie('US', B));
    const krProfile = await request(app, 'GET', '/api/users/' + A + '/profile', cookie('KR', B));
    const usProfile = await request(app, 'GET', '/api/users/me', cookie('US', A));
    const full = await request(app, 'GET', '/api/users/me/profile/full', cookie('KR', A));
    const other = await request(app, 'GET', '/api/users/' + A + '/profile/public', cookie('US', B));
    const modal = dataAdapter.mapPublicProfileToProfileModal(krProfile.body && krProfile.body.data);
    const shared = await pool.query('SELECT follower_count, following_count FROM public.user_progression WHERE user_id = $1', [A]);
    lines.push(line(
      krProg.body && krProg.body.data && krProg.body.data.followerCount === 10
        && usProg.body && usProg.body.data && usProg.body.data.followerCount === 3
        && krProfile.body && krProfile.body.data && krProfile.body.data.followerCount === 10
        && usProfile.body && usProfile.body.data && usProfile.body.data.followerCount === 3
        && full.body && full.body.data && full.body.data.followerCount === 10
        && other.body && other.body.data && other.body.data.followerCount === 3
        && modal.followers === 10
        && Number(shared.rows[0].follower_count) === 99,
      '6-profile-counts-differ-by-country',
      'server'
    ));

    await pool.query('INSERT INTO public.profiles (id, territory, display_name) VALUES ($1, \'CENTRAL\', \'F1\')', [uid(1)]);
    const unfollow = await request(app, 'POST', '/api/users/' + A + '/follow/toggle', cookie('KR', uid(1)), {});
    const afterUnfollow = await request(app, 'GET', '/api/users/' + A + '/progression/public', cookie('KR', B));
    const sharedAfter = await pool.query('SELECT follower_count FROM public.user_progression WHERE user_id = $1', [A]);
    lines.push(line(
      unfollow.status === 200
        && afterUnfollow.body && afterUnfollow.body.data && afterUnfollow.body.data.followerCount === 9
        && Number(sharedAfter.rows[0].follower_count) === 99,
      '7-unfollow-updates-displayed-count',
      'server'
    ));

    const missing = await request(app, 'GET', '/api/users/me/progression', cookie(null, A));
    let directMissing = false;
    try {
      await repo.getPublicProgression(A, '');
    } catch (err) {
      directMissing = err && err.code === 'COUNTRY_REQUIRED';
    }
    lines.push(line(
      missing.status === 400 && missing.body && missing.body.error === 'COUNTRY_REQUIRED' && directMissing,
      '8-missing-country-rejected',
      'server-and-direct'
    ));

    const directKr = await repo.getPublicProgression(A, 'KR');
    const directUs = await repo.getPublicProgression(A, 'US');
    const board = createBoardService({
      repository: createActivityRegionPgRepository({ query: query }),
      userContext: createMockUserContextAdapter({ defaultTerritory: 'CENTRAL' }),
      operational: true,
    });
    let directBlocked = false;
    try {
      await board.deletePost({ userId: D, activityRegion: 'KR' }, usPostId);
    } catch (err) {
      directBlocked = err && err.code === 'REGION_MISMATCH';
    }
    const stillActive = await pool.query('SELECT status, activity_region FROM public.board_posts WHERE id = $1', [usPostId]);
    lines.push(line(
      directKr.follower_count === 9 && directUs.follower_count === 3
        && directBlocked
        && stillActive.rows[0].status === 'ACTIVE'
        && stillActive.rows[0].activity_region === 'US',
      '9-direct-other-country-blocked',
      'direct'
    ));

    if (lines.some(function (row) { return row.indexOf('FAIL') === 0; })) {
      lines.push('INFO us-post ' + JSON.stringify(usPost.body));
      lines.push('INFO kr-post ' + JSON.stringify(krPost.body));
      lines.push('INFO qualified-comment ' + JSON.stringify(qualifiedComment.body));
      lines.push('INFO d-empathy ' + JSON.stringify(dEmpathy.body));
      lines.push('INFO kr-prog ' + JSON.stringify(krProg.body));
      lines.push('INFO full ' + JSON.stringify(full.body && full.body.error ? full.body : (full.body && full.body.data && full.body.data.followerCount)));
      lines.push('INFO other ' + JSON.stringify(other.body && other.body.error ? other.body : (other.body && other.body.data && other.body.data.followerCount)));
      lines.push('INFO unfollow ' + JSON.stringify(unfollow.body));
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
