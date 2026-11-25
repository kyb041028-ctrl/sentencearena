#!/usr/bin/env node
'use strict';

/**
 * 인기글 국가 분리. 격리 Postgres만. 점수식은 읽기만 한다.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const popularCore = require('../shared/popular-posts-core');
const { createBoardService } = require('../server/board-service');
const { createBoardRouter } = require('../server/board-routes');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLOCK = Date.now();
const WHEN = new Date(Math.max(popularCore.kstStartOfTodayMs(CLOCK), CLOCK - 30000)).toISOString();
const NOW = CLOCK + 5000;

let failed = 0;
function check(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name, detail || '');
    return;
  }
  console.log('PASS', name);
}

function uid(n) {
  return '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
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
      res.on('data', function (c) { chunks.push(c); });
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

async function main() {
  check('6 공식 가중치',
    popularCore.WEIGHTS.empathy === 2 && popularCore.WEIGHTS.like === 1
    && popularCore.WEIGHTS.dislike === 1 && popularCore.WEIGHTS.uniqueCommenter === 1);
  const formula = fs.readFileSync(path.join(__dirname, '..', 'shared', 'popular-posts-core.js'), 'utf8');
  check('6 공식 문장',
    formula.indexOf('(원글 EMPATHY × 2) + 원글 LIKE + 원글 DISLIKE + 댓글/대댓글 고유 참여자') !== -1);
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  check('10 캐시 키에 국가가 있다',
    page.indexOf('function popularViewerRegion()') !== -1
    && page.indexOf("return popularViewerRegion() + '|'") !== -1);

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

  const dbName = 'popular_country_' + process.pid;
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
      'CREATE TABLE public.board_posts (id uuid PRIMARY KEY, author_user_id uuid, territory text, title text, content text, status text, created_at timestamptz)'
    );
    await client.query(
      'INSERT INTO public.board_posts (id, author_user_id, territory, title, content, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(1), A, 'CENTRAL', '옛', '본문', 'ACTIVE', WHEN]
    );
    const bare = createActivityRegionPgRepository({ query: query });
    let missing = null;
    try {
      await bare.listPopularCandidates({ countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', territory: 'CENTRAL' });
    } catch (err) { missing = err; }
    const legacy = await bare.listPopularCandidates({ status: 'ACTIVE', territory: 'CENTRAL' });
    check('열 없으면 국가 구조는 오류', missing && missing.code === 'COUNTRY_COLUMN_MISSING');
    check('열 없으면 레거시 후보는 읽힌다', legacy.length === 1);

    await client.query('DROP TABLE public.board_posts');
    await client.query(
      'CREATE TABLE public.board_posts (' +
        'id uuid PRIMARY KEY, author_user_id uuid, territory text, title text, content text, status text, ' +
        'board_stage int, activity_region text, is_official boolean DEFAULT false, comment_count int DEFAULT 0, created_at timestamptz)'
    );
    await client.query(
      'CREATE TABLE public.board_reactions (' +
        'id uuid PRIMARY KEY, post_id uuid, actor_user_id uuid, target_type text, reaction_type text, ' +
        'activity_region text, cancelled_at timestamptz, created_at timestamptz)'
    );
    await client.query(
      'CREATE TABLE public.board_comments (' +
        'id uuid PRIMARY KEY, post_id uuid, author_user_id uuid, content text, status text, activity_region text, created_at timestamptz)'
    );
    await client.query(
      'CREATE TABLE public.user_progression_events (' +
        'id uuid PRIMARY KEY, user_id uuid, event_type text, source_id uuid, source_type text, occurred_at timestamptz, activity_region text)'
    );

    const krLikes = [5, 4, 3, 2, 1];
    const usLikes = [50, 40, 30, 20, 10];
    let reactionSeq = 1000;
    for (let i = 0; i < 5; i++) {
      const krId = uid(10 + i);
      const usId = uid(20 + i);
      const title = i === 2 ? '같은 제목' : (i === 0 ? 'KR-top' : 'KR-' + i);
      const usTitle = i === 2 ? '같은 제목' : (i === 0 ? 'US-top' : 'US-' + i);
      await client.query(
        'INSERT INTO public.board_posts (id, author_user_id, territory, title, content, status, activity_region, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [krId, A, 'CENTRAL', title, '한국', 'ACTIVE', 'KR', '2026-11-15T0' + (5 - i) + ':00:00Z']
      );
      await client.query(
        'INSERT INTO public.board_posts (id, author_user_id, territory, title, content, status, activity_region, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [usId, B, 'CENTRAL', usTitle, 'us', 'ACTIVE', 'US', '2026-11-15T0' + (5 - i) + ':30:00Z']
      );
      for (let n = 0; n < krLikes[i]; n++) {
        await client.query(
          'INSERT INTO public.board_reactions (id, post_id, actor_user_id, target_type, reaction_type, activity_region, created_at) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [uid(reactionSeq++), krId, B, 'POST', 'LIKE', 'KR', WHEN]
        );
      }
      for (let n = 0; n < usLikes[i]; n++) {
        await client.query(
          'INSERT INTO public.board_reactions (id, post_id, actor_user_id, target_type, reaction_type, activity_region, created_at) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [uid(reactionSeq++), usId, A, 'POST', 'LIKE', 'US', WHEN]
        );
      }
    }
    await client.query(
      'INSERT INTO public.board_posts (id, author_user_id, territory, title, content, status, activity_region, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [uid(30), A, 'CENTRAL', '빈 글', '없음', 'ACTIVE', null, WHEN]
    );
    await client.query(
      'INSERT INTO public.board_reactions (id, post_id, actor_user_id, target_type, reaction_type, activity_region, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(301), uid(20), A, 'POST', 'LIKE', 'KR', WHEN]
    );
    await client.query(
      'INSERT INTO public.board_reactions (id, post_id, actor_user_id, target_type, reaction_type, activity_region, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(302), uid(10), B, 'POST', 'LIKE', 'US', WHEN]
    );
    await client.query(
      'INSERT INTO public.board_reactions (id, post_id, actor_user_id, target_type, reaction_type, activity_region, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(303), uid(30), A, 'POST', 'LIKE', null, WHEN]
    );
    await client.query(
      'INSERT INTO public.board_comments (id, post_id, author_user_id, content, status, activity_region, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(401), uid(14), A, '한국 댓글', 'ACTIVE', 'KR', WHEN]
    );
    await client.query(
      'INSERT INTO public.board_comments (id, post_id, author_user_id, content, status, activity_region, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(402), uid(14), B, '미국 댓글이 한국 글에', 'ACTIVE', 'US', WHEN]
    );
    await client.query(
      'INSERT INTO public.user_progression_events (id, user_id, event_type, source_id, source_type, occurred_at, activity_region) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(501), B, 'EMPATHY_RECEIVED', uid(10), 'board_post', WHEN, 'KR']
    );
    await client.query(
      'INSERT INTO public.user_progression_events (id, user_id, event_type, source_id, source_type, occurred_at, activity_region) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(502), A, 'EMPATHY_RECEIVED', uid(10), 'board_post', WHEN, 'US']
    );

    const repository = createActivityRegionPgRepository({ query: query });
    sqlLog.length = 0;
    const candidates = await repository.listPopularCandidates({
      countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', territory: 'CENTRAL',
    });
    const candidateSql = sqlLog.filter(function (sql) { return sql.indexOf('FROM public.board_posts') !== -1; }).pop() || '';
    check('SQL 후보에 LIMIT가 없다',
      candidateSql.indexOf('activity_region = $') !== -1 && candidateSql.indexOf('LIMIT') === -1);
    check('SQL 한국 후보 5, 빈 글 없음',
      candidates.length === 5 && candidates.every(function (row) { return row.activityRegion === 'KR'; }));

    const userContext = createMockUserContextAdapter({ territories: { [A]: 'CENTRAL', [B]: 'CENTRAL' } });
    const service = createBoardService({
      repository: repository,
      userContext: userContext,
      operational: true,
      countryStructure: true,
    });
    const kr = { userId: A, activityRegion: 'KR' };
    const us = { userId: A, activityRegion: 'US' };
    const krPage = await service.listPopularPosts(kr, { territory: 'CENTRAL', limit: 2, offset: 0, nowMs: NOW });
    const usPage = await service.listPopularPosts(us, { territory: 'CENTRAL', limit: 2, offset: 0, nowMs: NOW });
    check('1 서비스 KR 인기글은 KR만',
      krPage.posts.length === 2 && krPage.posts[0].title === 'KR-top' && krPage.posts[0].popularScore === 7
      && krPage.posts[1].popularScore === 4
      && krPage.posts.every(function (row) { return row.activityRegion === 'KR' || row.title.indexOf('US') !== 0; }));
    check('2 서비스 US 인기글은 US만',
      usPage.posts.length === 2 && usPage.posts[0].title === 'US-top' && usPage.posts[0].popularScore === 50
      && usPage.posts[1].popularScore === 40);
    check('3 서비스 빈 글 제외',
      krPage.posts.every(function (row) { return row.title !== '빈 글'; })
      && usPage.posts.every(function (row) { return row.title !== '빈 글'; }));
    check('4 KR 반응이 US 점수에 없음', usPage.posts[0].popularScore === 50);
    check('5 US 반응과 US 공감이 KR 점수에 없음', krPage.posts[0].popularScore === 7);
    const krNext = await service.listPopularPosts(kr, { territory: 'CENTRAL', limit: 2, offset: 2, nowMs: NOW });
    check('7 국가별 정렬', krPage.posts[0].popularScore > krPage.posts[1].popularScore);
    check('8 LIMIT 전에 후보 분리', krPage.total === 5 && krPage.posts.length === 2 && krPage.posts[0].title !== 'US-top');
    check('9 페이지와 전체 건수',
      krNext.total === 5 && krNext.posts.length === 2 && krNext.posts[0].popularScore === 3);
    const detail = await service.getPost(kr, uid(20));
    check('12 서비스 한국 사용자는 미국 글 상세를 읽는다', detail && detail.title === 'US-top');
    const sameKr = await service.listPopularPosts(kr, { territory: 'CENTRAL', limit: 5, nowMs: NOW });
    const sameUs = await service.listPopularPosts(us, { territory: 'CENTRAL', limit: 5, nowMs: NOW });
    check('같은 제목은 각 국가 목록에만',
      sameKr.posts.filter(function (row) { return row.title === '같은 제목'; }).length === 1
      && sameUs.posts.filter(function (row) { return row.title === '같은 제목'; }).length === 1);

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
      const httpKr = await request(server, 'GET', '/api/board/popular?territory=CENTRAL&limit=2&offset=0', {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      const httpUs = await request(server, 'GET', '/api/board/popular?territory=CENTRAL&limit=2&offset=0', {
        cookie: 'sa_ar=US; sa_ar_x=1',
      });
      const krTitles = (httpKr.json.posts || []).map(function (row) { return row.title; });
      const usTitles = (httpUs.json.posts || []).map(function (row) { return row.title; });
      check('HTTP KR 인기글',
        httpKr.status === 200 && httpKr.json.total === 5 && krTitles[0] === 'KR-top' && krTitles.indexOf('US-top') === -1);
      check('HTTP US 인기글',
        httpUs.status === 200 && httpUs.json.total === 5 && usTitles[0] === 'US-top' && usTitles.indexOf('KR-top') === -1);
      const read = await request(server, 'GET', '/api/board/posts/' + uid(20), {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      check('HTTP 한국 쿠키로 미국 글 상세', read.status === 200 && read.json.post && read.json.post.title === 'US-top');
      const list = await request(server, 'GET', '/api/board/posts?status=ACTIVE&limit=2', {
        cookie: 'sa_ar=KR; sa_ar_x=1',
      });
      check('11 HTTP 일반 목록은 한국 글만',
        list.status === 200 && (list.json.posts || []).every(function (row) { return row.activityRegion === 'KR'; })
        && list.json.total === 5);
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
  console.log('POPULAR_COUNTRY_PASS');
  console.log('BROWSER NOT RUN');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
