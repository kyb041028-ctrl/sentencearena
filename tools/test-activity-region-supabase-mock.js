#!/usr/bin/env node
'use strict';

/**
 * Supabase 모양의 메모리 클라이언트다. 운영 Supabase도, 로컬 Postgres도 아니다.
 * 신원은 x-user-id 시험 헤더다. Auth 세션이 아니다.
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { createBoardRouter } = require('../server/board-routes');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const persist = require('../server/achievement-persist-service');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

function createMockSupabase() {
  const tables = {};
  const client = {
    currentUserId: null,
    rows: function (name) {
      return (tables[name] || []).map(function (row) { return Object.assign({}, row); });
    },
    seed: function (name, row) {
      if (!tables[name]) tables[name] = [];
      tables[name].push(Object.assign({}, row));
    },
  };

  function table(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function defaults(name, row) {
    const copy = Object.assign({}, row);
    if (!copy.id) copy.id = crypto.randomUUID();
    if (!copy.created_at) copy.created_at = new Date().toISOString();
    if ((name === 'board_posts' || name === 'board_comments') && !copy.status) copy.status = 'ACTIVE';
    if (name === 'board_posts' && copy.comment_count == null) copy.comment_count = 0;
    if (name === 'user_activity_region_profile') {
      if (copy.level == null) copy.level = 1;
      if (copy.xp == null) copy.xp = 0;
      if (copy.reputation_score == null) copy.reputation_score = 0;
      if (copy.aura == null) copy.aura = 0;
      if (!Object.prototype.hasOwnProperty.call(row, 'tendency')) copy.tendency = null;
      if (copy.evolution_contribution == null) copy.evolution_contribution = 0;
    }
    return copy;
  }

  function match(row, filters) {
    let i;
    for (i = 0; i < filters.length; i++) {
      const filter = filters[i];
      const value = row[filter.k];
      if (filter.t === 'eq' && value !== filter.v) return false;
      if (filter.t === 'in' && filter.v.indexOf(value) < 0) return false;
      if (filter.t === 'is' && filter.v == null && value != null) return false;
      if (filter.t === 'gte' && String(value) < String(filter.v)) return false;
      if (filter.t === 'lte' && String(value) > String(filter.v)) return false;
    }
    return true;
  }

  client.from = function (name) {
    const state = { filters: [], op: 'select', payload: null, order: null, limit: null, done: null };
    const api = {
      insert: function (row) { state.op = 'insert'; state.payload = row; return api; },
      update: function (row) { state.op = 'update'; state.payload = row; return api; },
      select: function () { return api; },
      eq: function (k, v) { state.filters.push({ t: 'eq', k: k, v: v }); return api; },
      in: function (k, v) { state.filters.push({ t: 'in', k: k, v: v || [] }); return api; },
      is: function (k, v) { state.filters.push({ t: 'is', k: k, v: v }); return api; },
      gte: function (k, v) { state.filters.push({ t: 'gte', k: k, v: v }); return api; },
      lte: function (k, v) { state.filters.push({ t: 'lte', k: k, v: v }); return api; },
      order: function (col, opts) {
        state.order = { col: col, asc: !(opts && opts.ascending === false) };
        return api;
      },
      limit: function (n) { state.limit = n; return api; },
      maybeSingle: function () { return run('maybe'); },
      single: function () { return run('single'); },
      then: function (resolve, reject) { return run('list').then(resolve, reject); },
    };

    function run(mode) {
      if (!state.done) state.done = Promise.resolve().then(function () { return exec(mode); });
      return state.done;
    }

    function exec(mode) {
      const rows = table(name);
      if (state.op === 'insert') {
        const saved = defaults(name, state.payload || {});
        rows.push(saved);
        const data = mode === 'list' ? [saved] : saved;
        return { data: data, error: null };
      }
      let found = rows.filter(function (row) { return match(row, state.filters); });
      if (state.op === 'update') {
        found.forEach(function (row) { Object.assign(row, state.payload || {}); });
      }
      if (state.order) {
        const col = state.order.col;
        const dir = state.order.asc ? 1 : -1;
        found = found.slice().sort(function (a, b) {
          return String(a[col] || '').localeCompare(String(b[col] || '')) * dir;
        });
      }
      if (state.limit != null) found = found.slice(0, state.limit);
      if (mode === 'maybe') return { data: found[0] || null, error: null };
      if (mode === 'single') {
        if (!found[0]) return { data: null, error: { message: 'MOCK_NO_ROW' } };
        return { data: found[0], error: null };
      }
      return { data: found, error: null };
    }

    return api;
  };

  client.rpc = async function (name, args) {
    if (name !== 'toggle_board_reaction') {
      return { data: null, error: { message: 'MOCK_RPC_ABSENT', code: 'MOCK_RPC_ABSENT' } };
    }
    const targetType = args.p_target_type;
    const targetId = args.p_target_id;
    const parents = targetType === 'COMMENT' ? table('board_comments') : table('board_posts');
    const parent = parents.filter(function (row) { return row.id === targetId; })[0] || null;
    const saved = defaults('board_reactions', {
      actor_user_id: client.currentUserId,
      target_type: targetType,
      post_id: targetType === 'POST' ? targetId : null,
      comment_id: targetType === 'COMMENT' ? targetId : null,
      reaction_type: args.p_reaction_type,
      cancelled_at: null,
      activity_region: parent ? parent.activity_region || null : null,
    });
    table('board_reactions').push(saved);
    return { data: { success: true, action: 'CREATED' }, error: null };
  };

  return client;
}

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

function closeServer(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}

function request(server, method, path, headers, body) {
  const addr = server.address();
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: path,
        method: method,
        headers: headers || {},
      },
      function (res) {
        const chunks = [];
        res.on('data', function (chunk) { chunks.push(chunk); });
        res.on('end', function () {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) { json = null; }
          resolve({ status: res.statusCode, json: json });
        });
      }
    );
    req.on('error', reject);
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

function member(userId, region) {
  return {
    'content-type': 'application/json',
    'x-user-id': userId,
    cookie: 'sa_ar=' + region + '; sa_ar_x=1',
  };
}

function routerOptions(client, schema) {
  return {
    operational: true,
    useMemory: false,
    activityRegionSchema: schema,
    supabaseAdmin: schema ? client : undefined,
    userContext: createMockUserContextAdapter({ defaultTerritory: 'CENTRAL' }),
    resolveActorFromRequest: async function (req) {
      const id = req.headers['x-user-id'];
      if (!id) return null;
      client.currentUserId = String(id);
      return { userId: String(id), supabase: client };
    },
  };
}

async function main() {
  console.log('SUPABASE_MOCK_NOT_PRODUCTION');
  console.log('LOCAL_POSTGRES_NOT_THIS_TEST');
  console.log('IDENTITY_MODE', 'test-header-not-auth-session');
  const client = createMockSupabase();
  const krPostId = crypto.randomUUID();
  client.seed('board_posts', {
    id: krPostId,
    author_user_id: USER_A,
    territory: 'CENTRAL',
    title: '한국 보존 글',
    content: '보존 본문',
    status: 'ACTIVE',
    activity_region: null,
    created_at: new Date().toISOString(),
  });
  client.seed('user_progression', {
    user_id: USER_A,
    xp: 80,
    level: 2,
    reputation_score: 9,
  });
  client.seed('user_alignment_state', { user_id: USER_A, score: '12.500000' });
  client.seed('user_notifications', {
    user_id: USER_A,
    notification_type: 'KR_KEEP',
    title: '한국 알림',
    message: '한국',
    activity_region: null,
  });
  persist.setAdminClientForTests(client);

  const app = express();
  app.use(express.json());
  app.use('/api/board', createBoardRouter(routerOptions(client, true)));
  const server = await listen(app);

  const blocked = await request(server, 'POST', '/api/board/posts', { 'content-type': 'application/json' }, {
    title: 'guest',
    content: 'guest',
  });
  check('게스트 쓰기는 거절된다', blocked.status === 401, String(blocked.status));

  const krPost = await request(server, 'POST', '/api/board/posts', member(USER_A, 'KR'), {
    title: '한국 새 글',
    content: '한국 본문',
  });
  check(
    '한국 글은 국가 칸을 비운 채 저장된다',
    krPost.status === 201 && krPost.json && krPost.json.post && krPost.json.post.activityRegion == null,
    JSON.stringify(krPost.json && krPost.json.post)
  );

  const usPost = await request(server, 'POST', '/api/board/posts', member(USER_A, 'US'), {
    title: 'US service note',
    content: 'US body',
  });
  check(
    '미국 글이 서버 경로에 US로 저장된다',
    usPost.status === 201 && usPost.json && usPost.json.post && usPost.json.post.activityRegion === 'US' && usPost.json.progression && usPost.json.progression.xp === 25,
    JSON.stringify(usPost.json && usPost.json.progression)
  );
  const usId = usPost.json && usPost.json.post && usPost.json.post.id;
  check(
    '미국 글 작성자 레벨은 한국 레벨 2가 아니다',
    usPost.json && usPost.json.post && usPost.json.post.author && usPost.json.post.author.level === 1,
    JSON.stringify(usPost.json && usPost.json.post && usPost.json.post.author)
  );

  const usComment = await request(server, 'POST', '/api/board/posts/' + usId + '/comments', member(USER_A, 'US'), {
    content: 'US reply',
  });
  check(
    '미국 댓글 국가는 부모 글과 같다',
    usComment.status === 201 && usComment.json && usComment.json.comment && usComment.json.comment.activityRegion === 'US'
  );

  const usReaction = await request(server, 'POST', '/api/board/reactions/toggle', member(USER_B, 'US'), {
    targetType: 'POST',
    targetId: usId,
    reactionType: 'LIKE',
  });
  check('미국 반응이 저장된다', usReaction.status === 200 && usReaction.json && usReaction.json.ok === true, JSON.stringify(usReaction.json));
  const reactionRow = client.rows('board_reactions').filter(function (row) {
    return row.post_id === usId && row.actor_user_id === USER_B;
  })[0];
  check('미국 반응 국가는 US', !!(reactionRow && reactionRow.activity_region === 'US'), JSON.stringify(reactionRow));

  const empathy = await request(server, 'POST', '/api/board/posts/' + usId + '/empathy', member(USER_B, 'US'));
  check(
    '미국 공감 명성은 1이고 경험치는 37이다',
    empathy.status === 200 && empathy.json && empathy.json.fame === 1 && empathy.json.xp === 37,
    JSON.stringify(empathy.json)
  );

  const usProfile = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'US'));
  const again = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'US'));
  const profile = usProfile.json && usProfile.json.profile;
  const profileAgain = again.json && again.json.profile;
  check(
    '미국 프로필 재조회가 저장값을 복원한다',
    profile && profileAgain && profile.xp === 37 && profileAgain.xp === 37 && profile.fame === 1 && profile.aura === 0 && profile.tendency == null && profile.level === 1 && profile.achievements.indexOf('first-post') !== -1 && profile.activity && profile.activity.posts === 1,
    JSON.stringify(profile)
  );

  const krProfile = await request(server, 'GET', '/api/board/region-profile', member(USER_A, 'KR'));
  const krRow = client.rows('user_progression')[0];
  check(
    '한국 경험치와 명성은 그대로다',
    krProfile.json && krProfile.json.profile && krProfile.json.profile.xp === 80 && krProfile.json.profile.fame === 9 && krProfile.json.profile.level === 2 && krRow.xp === 80 && krRow.reputation_score === 9 && krRow.level === 2,
    JSON.stringify(krProfile.json)
  );
  check(
    '한국 성향 점수는 바뀌지 않았다',
    client.rows('user_alignment_state')[0].score === '12.500000'
  );

  const usList = await request(server, 'GET', '/api/board/posts', member(USER_A, 'US'));
  const titles = ((usList.json && usList.json.posts) || []).map(function (post) { return post.title; });
  check('미국 목록에 한국 글이 없다', usList.status === 200 && titles.indexOf('한국 보존 글') < 0 && titles.indexOf('US service note') >= 0, titles.join(','));

  const popular = await request(server, 'GET', '/api/board/popular?territory=CENTRAL', member(USER_A, 'US'));
  const popularTitles = ((popular.json && popular.json.posts) || []).map(function (post) { return post.title; });
  check('미국 인기글에 한국 글이 없다', popular.status === 200 && popularTitles.indexOf('한국 보존 글') < 0, JSON.stringify(popular.json));

  const guestList = await request(server, 'GET', '/api/board/posts', { cookie: 'sa_ar=US; sa_ar_x=1' });
  const guestTitles = ((guestList.json && guestList.json.posts) || []).map(function (post) { return post.title; });
  check('게스트 미국 목록에도 한국 글이 없다', guestList.status === 200 && guestTitles.indexOf('한국 보존 글') < 0, guestTitles.join(','));

  const notices = client.rows('user_notifications');
  const usNotices = notices.filter(function (row) { return row.activity_region === 'US'; });
  const krNotices = notices.filter(function (row) { return row.title === '한국 알림'; });
  check('미국 알림과 한국 알림이 섞이지 않는다', usNotices.length >= 3 && krNotices.length === 1, String(usNotices.length));
  const events = client.rows('user_activity_events');
  check(
    '미국 피드 사건만 US로 남는다',
    events.length >= 3 && events.every(function (row) { return row.activity_region === 'US'; })
  );
  check(
    '한국 업적 표로 미국 업적을 복사하지 않는다',
    client.rows('user_achievements').length === 0 && client.rows('user_activity_region_achievement').some(function (row) { return row.achievement_key === 'first-post'; })
  );

  const edited = await request(server, 'PATCH', '/api/board/posts/' + usId, member(USER_B, 'US'), { title: 'B changed it' });
  const still = client.rows('board_posts').filter(function (row) { return row.id === usId; })[0];
  check('다른 회원은 미국 글을 고치지 못한다', edited.status === 403 && still && still.title === 'US service note', String(edited.status));

  const spoof = await request(server, 'POST', '/api/board/posts', member(USER_A, 'US'), {
    title: 'spoof into KR',
    content: 'no',
    activityRegion: 'KR',
  });
  check(
    '본문으로 국가를 바꾸면 저장하지 않는다',
    spoof.status === 403 && spoof.json && spoof.json.error === 'REGION_MISMATCH' && client.rows('board_posts').every(function (row) { return row.title !== 'spoof into KR'; }),
    JSON.stringify(spoof.json)
  );

  await closeServer(server);

  let inserts = 0;
  const spy = {
    currentUserId: null,
    from: function () {
      return {
        insert: function () { inserts += 1; return this; },
        select: function () { return this; },
        eq: function () { return this; },
        single: function () { return Promise.resolve({ data: null, error: { message: 'NO' } }); },
        maybeSingle: function () { return Promise.resolve({ data: null, error: null }); },
        then: function (resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
    },
    rpc: async function () { return { data: null, error: { message: 'NO' } }; },
  };
  const bare = express();
  bare.use(express.json());
  bare.use('/api/board', createBoardRouter(routerOptions(spy, false)));
  const bareServer = await listen(bare);
  const bareWrite = await request(bareServer, 'POST', '/api/board/posts', member(USER_A, 'US'), {
    title: 'should not land',
    content: 'no schema',
  });
  await closeServer(bareServer);
  check(
    '스키마가 없으면 미국 쓰기는 오류이고 한국 표에 넣지 않는다',
    bareWrite.status === 503 && bareWrite.json && bareWrite.json.error === 'REGION_SCHEMA_UNAVAILABLE' && inserts === 0,
    JSON.stringify(bareWrite.json)
  );

  persist.resetAdminClientForTests();
  console.log('AUTH_NOT_RUN');
  console.log('REAL_US_IP_NOT_RUN');
  if (failed) {
    console.log('SUPABASE_MOCK_CHECKS_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('SUPABASE_MOCK_CHECKS_OK');
}

main().catch(function (err) {
  persist.resetAdminClientForTests();
  console.log('SUPABASE_MOCK_CHECKS_FAIL', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
