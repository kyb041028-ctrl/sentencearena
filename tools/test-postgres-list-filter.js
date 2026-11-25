#!/usr/bin/env node
'use strict';

/**
 * 격리 Postgres 목록 국가 필터.
 * 운영 Supabase와 3010은 쓰지 않는다.
 */

const express = require('express');
const http = require('http');
const { createBoardService } = require('../server/board-service');
const { createBoardRouter } = require('../server/board-routes');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createActivityRegionStore } = require('../server/activity-region-store');
const profileLists = require('../server/profile-activity-list-service');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KR_NEW = '11111111-1111-4111-8111-111111111111';
const US_NEW = '22222222-2222-4222-8222-222222222222';
const KR_MID = '33333333-3333-4333-8333-333333333333';
const US_MID = '44444444-4444-4444-8444-444444444444';
const KR_OLD = '55555555-5555-4555-8555-555555555555';
const BLANK = '66666666-6666-4666-8666-666666666666';
const KR_DELETED = '77777777-7777-4777-8777-777777777777';

let failed = 0;
function check(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name, detail || '');
    return;
  }
  console.log('PASS', name);
}

function titles(rows) {
  return (rows || []).map(function (row) { return row && (row.title || row.post && row.post.title); });
}

function request(server, method, urlPath, headers) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method: method,
      path: urlPath,
      headers: headers || {},
    }, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function feedChecks() {
  const store = createActivityRegionStore();
  store.importLegacy({ userId: A, region: null, post: { title: '예전 글' } });
  check('레거시 listPosts는 빈 기록을 한국으로 읽는다',
    store.listPosts('KR').length === 1 && store.listPosts('US').length === 0);
  check('국가 경로 listCountryPosts는 빈 기록을 넣지 않는다',
    store.listCountryPosts('KR').length === 0 && store.listCountryPosts('US').length === 0);
  store.writeActivity({
    userId: A,
    activeRegion: 'US',
    post: { title: 'US note', body: 'US body' },
    notice: { text: 'US note' },
  });
  const before = store.readProfile(A, 'US');
  store.writeActivity({
    userId: A,
    activeRegion: 'US',
    comment: { body: 'US reply' },
    notice: { text: 'US reply' },
  });
  store.writeActivity({
    userId: A,
    activeRegion: 'US',
    reaction: { kind: 'LIKE' },
  });
  store.writeActivity({
    userId: A,
    activeRegion: 'KR',
    post: { title: '한국 글', body: '한국 본문' },
    notice: { text: '한국 글' },
  });
  const us = store.readProfile(A, 'US');
  const kr = store.readProfile(A, 'KR');
  const usFeed = store.listFeed('US').map(function (item) { return item.type; });
  const krFeed = store.listFeed('KR').map(function (item) { return item.type; });
  check('11 댓글·반응은 건수로 남고 피드 건수를 늘리지 않는다',
    us.posts.length === 1 && us.comments.length === 1 && us.reactions.length === 1
    && us.notices.length === 2 && us.feed.length === before.feed.length
    && us.feed.length === 1 && us.feed[0].type === 'post');
  check('11 국가별 피드와 알림',
    usFeed.indexOf('post') !== -1 && usFeed.indexOf('comment') === -1
    && krFeed.indexOf('post') !== -1
    && kr.notices.length === 1 && kr.comments.length === 0 && kr.reactions.length === 0
    && us.notices[0].region === 'US' && kr.notices[0].region === 'KR');
  check('임시 검색은 게시판 글을 다시 복사하지 않는다',
    store.searchPosts('KR', '한국').length === 1
    && store.searchPosts('US', 'US note').length === 1
    && store.searchPosts('KR', 'US note').length === 0);
}

async function main() {
  feedChecks();
  let Client;
  try { Client = require('pg').Client; }
  catch (err) {
    console.log('POSTGRES NOT RUN pg module missing');
    process.exit(failed ? 1 : 2);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    console.log('POSTGRES NOT RUN ' + String(err && err.message || err));
    process.exit(failed ? 1 : 2);
  }
  const dbName = 'pg_list_filter_' + process.pid;
  let client;
  const sqlLog = [];
  async function query(sql, params) {
    sqlLog.push(String(sql));
    return client.query(sql, params);
  }
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    await client.query(
      'CREATE TABLE public.board_posts (' +
        'id uuid PRIMARY KEY, author_user_id uuid, territory text, title text, content text, status text, created_at timestamptz)'
    );
    await client.query(
      'INSERT INTO public.board_posts (id, author_user_id, territory, title, content, status, created_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [KR_NEW, A, 'CENTRAL', '레거시', '본문', 'ACTIVE', '2026-05-01T00:00:00Z']
    );
    const bareRepo = createActivityRegionPgRepository({ query: query });
    let missingErr = null;
    try {
      await bareRepo.listPosts({ countryStructure: true, activityRegion: 'KR' });
    } catch (err) {
      missingErr = err;
    }
    const bareRows = await bareRepo.listPosts({});
    check('국가 컬럼이 없으면 국가 구조는 오류', missingErr && missingErr.code === 'COUNTRY_COLUMN_MISSING');
    check('국가 컬럼이 없으면 레거시 목록은 동작', bareRows.length === 1 && bareRows[0].title === '레거시');

    await client.query('DROP TABLE public.board_posts');
    await client.query(
      'CREATE TABLE public.board_posts (' +
        'id uuid PRIMARY KEY, author_user_id uuid NOT NULL, territory text NOT NULL, category_key text, ' +
        'board_stage int, title text, content text, is_anonymous boolean DEFAULT false, is_official boolean DEFAULT false, ' +
        'status text NOT NULL, comment_count int DEFAULT 0, activity_region text, created_at timestamptz NOT NULL, ' +
        'updated_at timestamptz, deleted_at timestamptz)'
    );
    await client.query(
      'CREATE TABLE public.board_comments (' +
        'id uuid PRIMARY KEY, post_id uuid, author_user_id uuid, content text, territory text, status text, activity_region text, created_at timestamptz)'
    );
    await client.query(
      'CREATE TABLE public.board_reactions (' +
        'id uuid PRIMARY KEY, post_id uuid, actor_user_id uuid, target_type text, reaction_type text, activity_region text, cancelled_at timestamptz)'
    );
    const posts = [
      [KR_NEW, A, 'CENTRAL', 'KR-new', '고유본문', 'ACTIVE', 'KR', '2026-05-05T00:00:00Z'],
      [US_NEW, A, 'CENTRAL', 'US-new', 'us body', 'ACTIVE', 'US', '2026-05-04T00:00:00Z'],
      [KR_MID, A, 'CENTRAL', '같은 제목', '한국 가운데', 'ACTIVE', 'KR', '2026-05-03T00:00:00Z'],
      [US_MID, B, 'CENTRAL', '같은 제목', 'us middle', 'ACTIVE', 'US', '2026-05-02T00:00:00Z'],
      [KR_OLD, A, 'PIONEER', 'KR-old', '오래된 한국', 'ACTIVE', 'KR', '2026-05-01T00:00:00Z'],
      [BLANK, A, 'CENTRAL', '빈 글', '국가 없음', 'ACTIVE', null, '2026-05-03T12:00:00Z'],
      [KR_DELETED, A, 'CENTRAL', '지운 한국', '삭제', 'DELETED', 'KR', '2026-05-06T00:00:00Z'],
    ];
    for (let i = 0; i < posts.length; i++) {
      await client.query(
        'INSERT INTO public.board_posts (id, author_user_id, territory, title, content, status, activity_region, created_at) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        posts[i]
      );
    }
    await client.query(
      'INSERT INTO public.board_comments (id, post_id, author_user_id, content, territory, status, activity_region, created_at) VALUES ' +
        "($1, $2, $3, 'KR 댓글 1', 'CENTRAL', 'ACTIVE', 'KR', now())," +
        "($4, $5, $6, 'KR 댓글 2', 'CENTRAL', 'ACTIVE', 'KR', now())," +
        "($7, $8, $9, 'US comment', 'CENTRAL', 'ACTIVE', 'US', now())",
      [KR_NEW, KR_NEW, A, KR_MID, KR_MID, A, US_NEW, US_NEW, B]
    );
    await client.query(
      'INSERT INTO public.board_reactions (id, post_id, actor_user_id, target_type, reaction_type, activity_region) VALUES ' +
        "($1, $2, $3, 'POST', 'LIKE', 'KR'), ($4, $5, $6, 'POST', 'LIKE', 'US')",
      [KR_OLD, KR_NEW, B, US_OLD_ID(), US_NEW, A]
    );

    const direct = await client.query(
      "SELECT title FROM public.board_posts WHERE status = 'ACTIVE' AND activity_region = $1 " +
        'ORDER BY created_at DESC, id DESC LIMIT 2',
      ['KR']
    );
    const wrong = await client.query(
      "SELECT title, activity_region FROM (" +
        "SELECT title, activity_region, created_at, id FROM public.board_posts WHERE status = 'ACTIVE' " +
        'ORDER BY created_at DESC, id DESC LIMIT 2) early WHERE activity_region = $1',
      ['KR']
    );
    check('1 SQL 직접 KR 2건', direct.rows.length === 2 && direct.rows[0].title === 'KR-new' && direct.rows[1].title === '같은 제목');
    check('1 SQL 먼저 LIMIT하면 KR 1건이라 실패 조건', wrong.rows.length === 1);

    const repository = createActivityRegionPgRepository({ query: query });
    sqlLog.length = 0;
    const repoPage = await repository.listPosts({
      countryStructure: true,
      activityRegion: 'KR',
      status: 'ACTIVE',
      limit: 2,
      offset: 0,
    });
    const listSql = sqlLog.filter(function (sql) { return sql.indexOf('SELECT *') === 0; })[0] || '';
    const countSql = sqlLog.filter(function (sql) { return sql.indexOf('SELECT count') === 0; })[0] || '';
    check('2 저장소 함수 KR 2건',
      repoPage.length === 2 && repoPage[0].title === 'KR-new' && repoPage[1].title === '같은 제목' && repoPage.totalCount === 3);
    check('2 SQL은 LIMIT보다 국가 조건이 먼저',
      listSql.indexOf('activity_region = $') !== -1
      && listSql.indexOf('activity_region = $') < listSql.indexOf('LIMIT')
      && countSql.indexOf('activity_region = $') !== -1
      && countSql.indexOf('LIMIT') === -1);
    const repoUs = await repository.listPosts({
      countryStructure: true, activityRegion: 'US', status: 'ACTIVE',
    });
    check('2 저장소 US 2건과 빈 글 제외',
      repoUs.length === 2 && repoUs.totalCount === 2
      && titles(repoUs).indexOf('빈 글') === -1 && titles(repoPage).indexOf('빈 글') === -1);
    const repoSearch = await repository.listPosts({
      countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', q: '같은 제목',
    });
    const repoSearchUs = await repository.listPosts({
      countryStructure: true, activityRegion: 'US', status: 'ACTIVE', q: '같은 제목',
    });
    const repoBody = await repository.listPosts({
      countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', q: '고유본문',
    });
    const repoAuthor = await repository.listPosts({
      countryStructure: true, activityRegion: 'US', status: 'ACTIVE', authorUserId: A,
    });
    const repoTerritory = await repository.listPosts({
      countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', territory: 'CENTRAL',
    });
    const repoTail = await repository.listPosts({
      countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', limit: 2, offset: 2,
    });
    const repoEmpty = await repository.listPosts({
      countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', limit: 2, offset: 20,
    });
    check('5 저장소 검색은 국가별',
      repoSearch.length === 1 && repoSearch[0].title === '같은 제목' && repoSearch.totalCount === 1
      && repoSearchUs.length === 1 && repoSearchUs[0].activityRegion === 'US' && repoSearchUs.totalCount === 1);
    check('5 저장소 본문·작성자·영토·정렬',
      repoBody.length === 1 && repoBody[0].title === 'KR-new'
      && repoAuthor.length === 1 && repoAuthor[0].title === 'US-new'
      && repoTerritory.totalCount === 2
      && repoTerritory[0].title === 'KR-new' && repoTerritory[1].title === '같은 제목');
    check('6 저장소 다음 페이지와 빈 페이지',
      repoTail.length === 1 && repoTail[0].title === 'KR-old' && repoTail.totalCount === 3
      && repoEmpty.length === 0 && repoEmpty.totalCount === 3);

    const userContext = createMockUserContextAdapter({ territories: { [A]: 'CENTRAL', [B]: 'CENTRAL' } });
    const service = createBoardService({
      repository: repository,
      userContext: userContext,
      operational: true,
      countryStructure: true,
    });
    const krActor = { userId: A, activityRegion: 'KR' };
    const usActor = { userId: A, activityRegion: 'US' };
    const serviceKr = await service.listPosts(krActor, { status: 'ACTIVE', limit: 2, offset: 0 });
    const serviceUs = await service.listPosts(usActor, { status: 'ACTIVE' });
    check('3 서비스 함수 KR 2건 총 3',
      serviceKr.length === 2 && serviceKr.totalCount === 3
      && serviceKr[0].title === 'KR-new' && serviceKr[1].title === '같은 제목');
    check('3 서비스 함수 US 2건', serviceUs.length === 2 && serviceUs.totalCount === 2 && titles(serviceUs).indexOf('KR-new') === -1);
    const serviceFind = await service.listPosts(krActor, { status: 'ACTIVE', q: '같은 제목' });
    const serviceFindUs = await service.listPosts(usActor, { status: 'ACTIVE', q: '같은 제목' });
    const serviceOther = await service.listPosts(krActor, { status: 'ACTIVE', q: 'US-new' });
    check('5 서비스 검색',
      serviceFind.length === 1 && serviceFind.totalCount === 1
      && serviceFindUs.length === 1 && serviceFindUs.totalCount === 1
      && serviceOther.length === 0 && serviceOther.totalCount === 0);
    const detail = await service.getPost(krActor, US_NEW);
    check('9 서비스 한국 사용자는 미국 글 상세를 읽는다', detail && detail.title === 'US-new');
    const krComments = await client.query("SELECT count(*)::int AS n FROM public.board_comments WHERE activity_region = 'KR'");
    const usComments = await client.query("SELECT count(*)::int AS n FROM public.board_comments WHERE activity_region = 'US'");
    const krReactions = await client.query(
      "SELECT count(*)::int AS n FROM public.board_reactions WHERE activity_region = 'KR' AND cancelled_at IS NULL"
    );
    const usReactions = await client.query(
      "SELECT count(*)::int AS n FROM public.board_reactions WHERE activity_region = 'US' AND cancelled_at IS NULL"
    );
    check('10 SQL 댓글·반응 국가',
      krComments.rows[0].n === 2 && usComments.rows[0].n === 1
      && krReactions.rows[0].n === 1 && usReactions.rows[0].n === 1);
    const profileRows = (await repository.listPosts({ status: 'ACTIVE' })).map(function (row) {
      return {
        id: row.id,
        author_user_id: row.authorUserId,
        title: row.title,
        status: 'ACTIVE',
        activity_region: row.activityRegion,
        territory: row.territory,
        created_at: row.createdAt,
        comment_count: 0,
      };
    });
    const profileKr = profileLists.listPostsFromRows(profileRows, { userId: A, region: 'KR', page: 1 });
    const profileUs = profileLists.listPostsFromRows(profileRows, { userId: A, region: 'US', page: 1 });
    check('10 프로필 글 건수 KR 3 US 1, 빈 글 제외',
      profileKr.totalItems === 3 && profileUs.totalItems === 1
      && profileKr.items.map(function (row) { return row.title; }).indexOf('빈 글') === -1);

    const app = express();
    app.use('/api/board', createBoardRouter({
      operational: true,
      pgQuery: query,
      userContext: userContext,
      resolveActorFromRequest: function () { return { userId: A }; },
    }));
    const server = await new Promise(function (resolve) {
      const s = app.listen(0, '127.0.0.1', function () { resolve(s); });
    });
    try {
      const krHttp = await request(server, 'GET', '/api/board/posts?status=ACTIVE&limit=2&offset=0', {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      const usHttp = await request(server, 'GET', '/api/board/posts?status=ACTIVE', {
        cookie: 'sa_ar=US; sa_ar_x=1',
      });
      const krTitles = titles(krHttp.json && krHttp.json.posts);
      const usTitles = titles(usHttp.json && usHttp.json.posts);
      check('4 HTTP 목록 KR 2건 총 3',
        krHttp.status === 200 && krTitles.length === 2 && krHttp.json.total === 3
        && krTitles[0] === 'KR-new' && krTitles[1] === '같은 제목' && krTitles.indexOf('US-new') === -1);
      check('4 HTTP 목록 US 2건',
        usHttp.status === 200 && usTitles.length === 2 && usHttp.json.total === 2 && usTitles.indexOf('빈 글') === -1);
      const search = await request(server, 'GET', '/api/board/posts?status=ACTIVE&q=' + encodeURIComponent('같은 제목'), {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      const searchUs = await request(server, 'GET', '/api/board/posts?status=ACTIVE&q=' + encodeURIComponent('같은 제목'), {
        cookie: 'sa_ar=US; sa_ar_x=1',
      });
      check('5 HTTP 검색',
        search.status === 200 && titles(search.json.posts).length === 1 && search.json.total === 1
        && searchUs.status === 200 && searchUs.json.total === 1 && titles(searchUs.json.posts)[0] === '같은 제목');
      const page = await request(server, 'GET', '/api/board/posts?status=ACTIVE&limit=2&offset=2', {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      const empty = await request(server, 'GET', '/api/board/posts?status=ACTIVE&limit=2&offset=20', {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      check('6 HTTP 페이지와 7 전체 건수',
        page.status === 200 && titles(page.json.posts).length === 1 && titles(page.json.posts)[0] === 'KR-old' && page.json.total === 3
        && empty.status === 200 && titles(empty.json.posts).length === 0 && empty.json.total === 3);
      const blankHttp = krTitles.indexOf('빈 글') === -1 && usTitles.indexOf('빈 글') === -1;
      check('8 HTTP 빈 글 제외', blankHttp);
      const readUs = await request(server, 'GET', '/api/board/posts/' + US_NEW, {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      check('9 HTTP 한국 쿠키로 미국 글 상세',
        readUs.status === 200 && readUs.json && readUs.json.post && readUs.json.post.title === 'US-new');
    } finally {
      await new Promise(function (resolve) { server.close(resolve); });
    }
  } finally {
    if (client) await client.end();
    await admin.query('DROP DATABASE IF EXISTS ' + dbName);
    await admin.end();
  }
  if (failed) {
    console.error('FAILED', failed);
    process.exit(1);
  }
  console.log('POSTGRES_LIST_FILTER_PASS');
}

function US_OLD_ID() {
  return '88888888-8888-4888-8888-888888888888';
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
