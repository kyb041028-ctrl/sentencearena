'use strict';
/**
 * Supabase 클라이언트 인기글·목록이 LIMIT 전에 국가로 잘리는지 확인한다.
 * 운영 Supabase는 호출하지 않는다. 조회 빌더만 쓴다.
 * node tools/test-supabase-popular-country.js
 */
const http = require('http');
const express = require('express');
const { createBoardSupabaseRepository } = require('../server/board-supabase-repository');
const { createBoardService } = require('../server/board-service');
const { createBoardRouter } = require('../server/board-routes');

function line(ok, name) {
  return (ok ? 'PASS ' : 'FAIL ') + name;
}

function createMock(tables, missing) {
  const calls = [];
  function from(table) {
    const q = {
      table: table,
      ops: [],
      cols: '*',
      select: function (cols) {
        this.cols = cols;
        this.ops.push({ op: 'select', cols: cols });
        return this;
      },
      eq: function (column, value) {
        this.ops.push({ op: 'eq', column: column, value: value });
        return this;
      },
      is: function (column, value) {
        this.ops.push({ op: 'is', column: column, value: value });
        return this;
      },
      gte: function (column, value) {
        this.ops.push({ op: 'gte', column: column, value: value });
        return this;
      },
      lte: function (column, value) {
        this.ops.push({ op: 'lte', column: column, value: value });
        return this;
      },
      or: function (text) {
        this.ops.push({ op: 'or', text: text });
        return this;
      },
      order: function () {
        this.ops.push({ op: 'order' });
        return this;
      },
      limit: function (n) {
        this.ops.push({ op: 'limit', n: n });
        return this;
      },
      range: function (fromIndex, toIndex) {
        this.ops.push({ op: 'range', from: fromIndex, to: toIndex });
        return this;
      },
      then: function (resolve, reject) {
        calls.push({ table: this.table, ops: this.ops.slice(), cols: this.cols });
        return Promise.resolve(answer(tables, missing, this)).then(resolve, reject);
      },
    };
    return q;
  }
  return { client: { from: from }, calls: calls };
}

function opIndex(ops, name) {
  for (let i = 0; i < ops.length; i += 1) if (ops[i].op === name) return i;
  return -1;
}

function answer(tables, missing, q) {
  const probe = q.cols === 'activity_region' && opIndex(q.ops, 'limit') >= 0 && opIndex(q.ops, 'eq') < 0;
  if (probe) {
    if (missing && missing[q.table]) {
      return { data: null, error: { code: '42703', message: 'column activity_region does not exist' }, count: null };
    }
    return { data: [], error: null, count: 0 };
  }
  let rows = (tables[q.table] || []).slice();
  q.ops.forEach(function (op) {
    if (op.op === 'eq') {
      rows = rows.filter(function (row) { return String(row[op.column] == null ? '' : row[op.column]) === String(op.value); });
    } else if (op.op === 'is' && op.value == null) {
      rows = rows.filter(function (row) { return row[op.column] == null; });
    } else if (op.op === 'gte') {
      rows = rows.filter(function (row) { return String(row[op.column] || '') >= String(op.value); });
    } else if (op.op === 'lte') {
      rows = rows.filter(function (row) { return String(row[op.column] || '') <= String(op.value); });
    } else if (op.op === 'or') {
      const found = String(op.text || '').match(/%([^%]+)%/);
      const needle = found ? found[1].toLowerCase() : '';
      rows = rows.filter(function (row) {
        return String(row.title || '').toLowerCase().indexOf(needle) >= 0
          || String(row.content || '').toLowerCase().indexOf(needle) >= 0;
      });
    }
  });
  const total = rows.length;
  const range = q.ops.filter(function (op) { return op.op === 'range'; }).pop();
  if (range) rows = rows.slice(range.from, range.to + 1);
  const limit = q.ops.filter(function (op) { return op.op === 'limit'; }).pop();
  if (limit) rows = rows.slice(0, limit.n);
  return { data: rows, error: null, count: total };
}

function row(id, region, title, at) {
  return {
    id: id,
    author_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    territory: 'CENTRAL',
    title: title,
    content: title,
    status: 'ACTIVE',
    activity_region: region,
    created_at: at,
    updated_at: at,
    earth_positive_count: 0,
    earth_negative_count: 0,
    alien_positive_count: 0,
    alien_negative_count: 0,
  };
}

function reaction(postId, region, at, n) {
  return {
    post_id: postId,
    reaction_type: 'LIKE',
    target_type: 'POST',
    created_at: at,
    cancelled_at: null,
    activity_region: region,
    id: 'rx-' + n,
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  return { server: server, port: address.port };
}

function get(port, path, cookie) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: '127.0.0.1',
      port: port,
      path: path,
      headers: { cookie: cookie },
    }, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: JSON.parse(body) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const lines = [];
  const at = new Date().toISOString();
  const krTop = '11111111-1111-4111-8111-111111111111';
  const usTop = '22222222-2222-4222-8222-222222222222';
  const blankId = '33333333-3333-4333-8333-333333333333';
  const posts = [
    row(krTop, 'KR', '한국 인기', at),
    row(usTop, 'US', 'US popular', at),
    row(blankId, null, '국가 없는 옛 글', at),
  ];
  const reactions = [];
  for (let i = 0; i < 5; i += 1) reactions.push(reaction(krTop, 'KR', at, 'kr' + i));
  for (let i = 0; i < 50; i += 1) reactions.push(reaction(usTop, 'US', at, 'us' + i));
  reactions.push(reaction(usTop, 'KR', at, 'cross-kr'));
  reactions.push(reaction(krTop, 'US', at, 'cross-us'));
  reactions.push(reaction(blankId, null, at, 'blank'));
  const empathy = [
    { source_id: krTop, source_type: 'board_post', occurred_at: at, activity_region: 'KR', event_type: 'EMPATHY_RECEIVED' },
    { source_id: krTop, source_type: 'board_post', occurred_at: at, activity_region: 'US', event_type: 'EMPATHY_RECEIVED' },
  ];
  const tables = {
    board_posts: posts,
    board_reactions: reactions,
    board_comments: [],
    user_progression_events: empathy,
  };
  const mock = createMock(tables, {});
  const repo = createBoardSupabaseRepository({ client: mock.client, supportsActivityRegion: true });
  const candidates = await repo.listPopularCandidates({ countryStructure: true, activityRegion: 'KR', status: 'ACTIVE' });
  const candidateCall = mock.calls.filter(function (call) { return call.table === 'board_posts' && call.cols === '*'; }).pop();
  lines.push(line(
    candidates.length === 1 && candidates[0].id === krTop &&
    opIndex(candidateCall.ops, 'eq') >= 0 && opIndex(candidateCall.ops, 'limit') < 0,
    '1-kr-candidates-filtered-before-limit'
  ));
  const beforeReactions = mock.calls.length;
  await repo.listActivePostReactionsSince('2000-01-01T00:00:00.000Z', at, { countryStructure: true, activityRegion: 'US' });
  const reactionCall = mock.calls[mock.calls.length - 1];
  lines.push(line(
    reactionCall.table === 'board_reactions' &&
    opIndex(reactionCall.ops, 'eq') < opIndex(reactionCall.ops, 'limit') &&
    reactionCall.ops.some(function (op) { return op.op === 'eq' && op.column === 'activity_region' && op.value === 'US'; }),
    '2-us-reactions-country-before-limit'
  ));
  const legacy = createBoardSupabaseRepository({ client: createMock(tables, {}).client, supportsActivityRegion: false });
  const legacyMockCalls = [];
  const legacyClient = createMock(tables, {});
  const legacyRepo = createBoardSupabaseRepository({ client: legacyClient.client, supportsActivityRegion: false });
  await legacyRepo.listActivePostReactionsSince('2000-01-01T00:00:00.000Z', at);
  const legacyCall = legacyClient.calls[legacyClient.calls.length - 1];
  lines.push(line(
    legacy.filtersCountryInSql !== true &&
    !legacyCall.ops.some(function (op) { return op.op === 'eq' && op.column === 'activity_region'; }) &&
    opIndex(legacyCall.ops, 'limit') >= 0,
    '3-legacy-keeps-old-limit-without-country'
  ));
  let missingCode = '';
  try {
    await createBoardSupabaseRepository({
      client: createMock(tables, { board_posts: true }).client,
      supportsActivityRegion: true,
    }).listPopularCandidates({ countryStructure: true, activityRegion: 'KR' });
  } catch (err) {
    missingCode = err && err.code;
  }
  const empty = await createBoardSupabaseRepository({
    client: createMock({ board_posts: [], board_reactions: [], board_comments: [], user_progression_events: [] }, {}).client,
    supportsActivityRegion: true,
  }).listPopularCandidates({ countryStructure: true, activityRegion: 'US' });
  lines.push(line(missingCode === 'COUNTRY_COLUMN_MISSING' && empty.length === 0, '4-missing-column-is-not-zero-rows'));

  const service = createBoardService({
    repository: repo,
    operational: true,
    countryStructure: true,
  });
  const kr = await service.listPopularPosts({ activityRegion: 'KR' }, { territory: 'CENTRAL', limit: 2, nowMs: Date.now() });
  const us = await service.listPopularPosts({ activityRegion: 'US' }, { territory: 'CENTRAL', limit: 2, nowMs: Date.now() });
  lines.push(line(
    kr.posts.length === 1 && kr.posts[0].popularScore === 7 && kr.posts[0].id === krTop &&
    us.posts.length === 1 && us.posts[0].popularScore === 50 && us.posts[0].id === usTop,
    '5-service-scores-only-that-country'
  ));
  const found = await service.listPosts({ activityRegion: 'KR' }, { q: 'US popular', limit: 2 });
  const page = await service.listPosts({ activityRegion: 'US' }, { status: 'ACTIVE', limit: 1, offset: 0 });
  lines.push(line(
    found.length === 0 && page.length === 1 && page[0].activityRegion === 'US' && page.totalCount === 1,
    '6-service-list-search-page-by-country'
  ));

  const app = express();
  app.use('/api/board', createBoardRouter({
    useMemory: true,
    operational: true,
    repository: repo,
    resolveActorFromRequest: async function () { return { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }; },
  }));
  const httpServer = await listen(app);
  const krHttp = await get(httpServer.port, '/api/board/popular?territory=CENTRAL&limit=2', 'sa_ar=KR; sa_ar_x=1');
  const usHttp = await get(httpServer.port, '/api/board/posts?limit=5', 'sa_ar=US; sa_ar_x=1');
  httpServer.server.close();
  const krScore = krHttp.body && krHttp.body.posts && krHttp.body.posts[0] ? krHttp.body.posts[0].popularScore : null;
  const usIds = (usHttp.body && usHttp.body.posts || []).map(function (post) { return post.activityRegion; });
  lines.push(line(
    krHttp.status === 200 && krScore === 7 && usHttp.status === 200 && usIds.length === 1 && usIds[0] === 'US',
    '7-http-popular-and-list'
  ));
  void beforeReactions;
  void legacyMockCalls;
  const failed = lines.filter(function (rowText) { return rowText.indexOf('FAIL') === 0; });
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write(failed.length ? 'RESULT FAIL\n' : 'RESULT PASS\n');
  process.stdout.write('BROWSER NOT RUN\n');
  if (failed.length) process.exit(1);
}

main().catch(function (err) {
  process.stdout.write('FAIL runner ' + String(err && err.stack || err) + '\n');
  process.exit(1);
});
