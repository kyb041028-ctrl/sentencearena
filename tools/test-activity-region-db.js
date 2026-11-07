#!/usr/bin/env node
'use strict';

/**
 * 로컬 PostgreSQL 검증. 운영 Supabase에는 접속하지 않는다.
 * 이 파일이 끝나기 전에 DB가 없으면 성공으로 끝내지 않는다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Client } = require('pg');

const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createActivityRegionScoreRepository } = require('../server/activity-region-score-repository');
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

async function one(client, sql, params) {
  const res = await client.query(sql, params);
  return res.rows[0];
}

async function main() {
  const mod = await import(pathToFileURL(
    path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')
  ).href);
  const EmbeddedPostgres = mod.default;
  const dataDir = path.join(os.tmpdir(), 'sa-region-cluster-' + Date.now());
  const cluster = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: 55432,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: function () {},
    onError: function () {},
  });
  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase('sentencearena_region_test');
  const client = cluster.getPgClient('sentencearena_region_test');
  await client.connect();
  console.log('DB', 'local-postgresql', 'sentencearena_region_test', 'port', 55432);
  try {
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
      ['schema_profiles_identity_history.sql', readSql('schema_profiles_identity_history.sql')],
      ['migration_board_core_system.sql', readSql('migration_board_core_system.sql')],
      ['migration_user_data_system.sql', readSql('migration_user_data_system.sql')],
      ['migration_political_alignment_persistence.sql', readSql('migration_political_alignment_persistence.sql')],
    ];
    let blocked = false;
    for (let i = 0; i < steps.length; i++) {
      const err = await applySql(client, steps[i][0], steps[i][1]);
      if (err) blocked = true;
    }
    if (blocked) throw new Error('prerequisite migration failed');

    await client.query(
      'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)',
      [USER_A, 'a@example.test', USER_B, 'b@example.test']
    );
    const seedPost = await one(client,
      "INSERT INTO public.board_posts (author_user_id, territory, title, content) " +
        "VALUES ($1, 'CENTRAL', '한국 보존 글', '보존 본문') RETURNING id, title",
      [USER_A]
    );
    const seedComment = await one(client,
      "INSERT INTO public.board_comments (post_id, author_user_id, territory, content) " +
        "VALUES ($1, $2, 'CENTRAL', '한국 보존 댓글') RETURNING id",
      [seedPost.id, USER_A]
    );
    await client.query(
      'INSERT INTO public.board_reactions (' +
        'actor_user_id, target_type, post_id, target_author_user_id, reaction_type, reaction_group, ' +
        'audience_scope, actor_territory_at_reaction, target_author_territory_at_reaction) ' +
        "VALUES ($1, 'POST', $2, $3, 'LIKE', 'POSITIVE', 'EARTH', 'CENTRAL', 'CENTRAL')",
      [USER_B, seedPost.id, USER_A]
    );
    await client.query(
      'INSERT INTO public.user_progression (user_id, xp, level, reputation_score) VALUES ($1, 80, 2, 9) ' +
        'ON CONFLICT (user_id) DO UPDATE SET xp = 80, level = 2, reputation_score = 9',
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

    async function sample() {
      const post = await one(client, 'SELECT title, content FROM public.board_posts WHERE id = $1', [seedPost.id]);
      const prog = await one(client,
        'SELECT xp, level, reputation_score FROM public.user_progression WHERE user_id = $1', [USER_A]);
      const ach = await one(client,
        'SELECT count(*)::int AS n FROM public.user_achievements WHERE user_id = $1 AND achievement_key = $2',
        [USER_A, 'kr-kept-badge']);
      const align = await one(client,
        'SELECT score::text AS score FROM public.user_alignment_state WHERE user_id = $1', [USER_A]);
      const counts = await one(client,
        'SELECT ' +
          '(SELECT count(*)::int FROM public.board_posts) AS posts, ' +
          '(SELECT count(*)::int FROM public.board_comments) AS comments, ' +
          '(SELECT count(*)::int FROM public.board_reactions) AS reactions, ' +
          '(SELECT count(*)::int FROM public.user_notifications) AS notices'
      );
      return { post: post, prog: prog, ach: ach.n, align: align.score, counts: counts, commentId: seedComment.id };
    }

    const before = await sample();
    const v2 = readSql('migration_activity_region_v2.sql');
    const v2err = await applySql(client, 'migration_activity_region_v2.sql', v2);
    check('v2 적용', !v2err, v2err);
    if (v2err) throw new Error('v2 failed');
    const after = await sample();
    check('마이그레이션 후 보존 글',
      after.post.title === before.post.title && after.post.content === before.post.content);
    check('마이그레이션 후 한국 경험·명성',
      Number(after.prog.xp) === Number(before.prog.xp)
      && Number(after.prog.reputation_score) === Number(before.prog.reputation_score)
      && Number(after.prog.level) === Number(before.prog.level));
    check('마이그레이션 후 한국 업적·성향',
      after.ach === before.ach && after.align === before.align);
    check('마이그레이션 후 행 수',
      after.counts.posts === before.counts.posts
      && after.counts.comments === before.counts.comments
      && after.counts.reactions === before.counts.reactions
      && after.counts.notices === before.counts.notices);
    const nullRegion = await one(client,
      'SELECT activity_region FROM public.board_posts WHERE id = $1', [seedPost.id]);
    check('옛 글의 국가 열은 비어 있다', nullRegion.activity_region == null);
    const v2again = await applySql(client, 'migration_activity_region_v2.sql-again', v2);
    check('v2 재실행', !v2again, v2again);

    const query = function (sql, params) { return client.query(sql, params); };
    const repository = createActivityRegionPgRepository({ query: query });
    const regionScores = createActivityRegionScoreRepository({ query: query });
    const service = createBoardService({
      repository: repository,
      userContext: createMockUserContextAdapter({
        territories: { [USER_A]: 'CENTRAL', [USER_B]: 'CENTRAL' },
      }),
      operational: true,
      regionScores: regionScores,
    });
    const kr = { userId: USER_A, activityRegion: 'KR' };
    const us = { userId: USER_A, activityRegion: 'US' };
    const usB = { userId: USER_B, activityRegion: 'US' };

    const krPost = await service.createPost(kr, { title: '한국 새 글', content: '한국 본문' });
    await service.createComment(kr, krPost.post.id, { content: '한국 새 댓글' });
    await service.toggleReaction(kr, {
      targetType: 'POST', targetId: krPost.post.id, reactionType: 'LIKE',
    });
    const usPost = await service.createPost(us, { title: 'US fresh note', content: 'US body' });
    const usComment = await service.createComment(us, usPost.post.id, { content: 'US reply' });
    const usReaction = await service.toggleReaction(us, {
      targetType: 'POST', targetId: usPost.post.id, reactionType: 'LIKE',
    });
    await service.receivePostEmpathy(usB, usPost.post.id);

    const usProfile = await regionScores.readProfile(USER_A, 'US');
    const krProfile = await regionScores.readProfile(USER_A, 'KR');
    check('미국 경험치가 저장된다', usProfile.stored && usProfile.xp === 37, JSON.stringify(usProfile));
    check('미국 명성이 저장된다', usProfile.fame === 1, String(usProfile.fame));
    check('미국 업적이 저장된다', usProfile.achievements.indexOf('first-post') !== -1, usProfile.achievements.join(','));
    check('미국 성향 점수는 없다', usProfile.tendency == null);
    check('한국 점수를 미국 표로 복사하지 않는다', krProfile.stored === false && usProfile.xp !== 80);

    const kept = await sample();
    check('미국 활동 뒤에도 한국 표본이 같다',
      kept.post.title === '한국 보존 글'
      && Number(kept.prog.xp) === 80
      && Number(kept.prog.reputation_score) === 9
      && kept.ach === 1
      && kept.align === '12.500000');
    const copied = await one(client,
      "SELECT count(*)::int AS n FROM public.user_activity_region_achievement WHERE achievement_key = 'kr-kept-badge'");
    check('한국 업적 키가 미국 표에 복사되지 않는다', copied.n === 0);

    const krTitles = (await service.listPosts(kr, { territory: 'CENTRAL' })).map(function (row) { return row.title; });
    const usTitles = (await service.listPosts(us, { territory: 'CENTRAL' })).map(function (row) { return row.title; });
    check('한국 목록에 미국 글이 없다', krTitles.indexOf('US fresh note') === -1 && krTitles.indexOf('한국 보존 글') !== -1);
    check('미국 목록에 한국 글이 없다', usTitles.indexOf('한국 보존 글') === -1 && usTitles.indexOf('한국 새 글') === -1 && usTitles.indexOf('US fresh note') !== -1);

    const storedUsComment = await one(client, 'SELECT activity_region FROM public.board_comments WHERE id = $1', [usComment.comment.id]);
    const storedKrComment = await one(client,
      "SELECT activity_region FROM public.board_comments WHERE content = '한국 새 댓글'");
    check('댓글 국가는 원글과 같다',
      storedUsComment.activity_region === 'US' && storedKrComment.activity_region == null);
    check('반응 국가는 원글과 같다', usReaction.activityRegion === 'US');

    let editErr = null;
    try {
      await service.updatePost({ userId: USER_B, activityRegion: 'KR' }, krPost.post.id, {
        title: 'B가 고침', content: '안 됨',
      });
    } catch (err) { editErr = err; }
    check('B는 A의 글을 고치지 못한다', editErr && editErr.code === 'BOARD_FORBIDDEN');

    let guestErr = null;
    try { await service.createPost(null, { title: '손님', content: '거절' }); }
    catch (err) { guestErr = err; }
    check('비로그인 쓰기는 거절된다', guestErr && guestErr.code === 'BOARD_AUTH_REQUIRED');

    let spoofErr = null;
    try {
      await service.createPost(kr, { title: '파라미터 미국', content: '거절', activityRegion: 'US' });
    } catch (err) { spoofErr = err; }
    check('국가 파라미터 우회는 거절된다', spoofErr && spoofErr.code === 'REGION_MISMATCH');
    const spoofRow = await one(client, "SELECT count(*)::int AS n FROM public.board_posts WHERE title = '파라미터 미국'");
    check('거절된 글은 저장되지 않는다', spoofRow.n === 0);

    let mismatch = null;
    try {
      await client.query(
        "INSERT INTO public.board_comments (post_id, author_user_id, territory, content, activity_region) " +
          "VALUES ($1, $2, 'CENTRAL', '잘못된 국가', 'US')",
        [seedPost.id, USER_A]
      );
    } catch (err) { mismatch = err; }
    check('원글과 다른 국가 댓글은 DB가 거절한다', mismatch && String(mismatch.message).indexOf('REGION_MISMATCH') !== -1);

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
      return one(client, "SELECT count(*)::int AS n FROM public.board_posts WHERE activity_region = 'US'");
    });
    await client.query('ROLLBACK');
    const directKr = await asMember(function () {
      return one(client, "SELECT count(*)::int AS n FROM public.board_posts WHERE title = '한국 보존 글'");
    });
    await client.query('ROLLBACK');
    const otherScore = await asMember(function () {
      return one(client,
        'SELECT count(*)::int AS n FROM public.user_activity_region_profile WHERE user_id = $1', [USER_B]);
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
    let directScore = null;
    try {
      await asMember(function () {
        return client.query(
          "INSERT INTO public.user_activity_region_profile (user_id, activity_region, xp) VALUES ($1, 'US', 999)",
          [USER_A]
        );
      });
    } catch (err) { directScore = err; }
    try { await client.query('ROLLBACK'); } catch (_) {}
    let progUpdate = { rowCount: -1 };
    try {
      progUpdate = await asMember(function () {
        return client.query('UPDATE public.user_progression SET xp = 1 WHERE user_id = $1', [USER_A]);
      });
    } catch (err) {
      progUpdate = { rowCount: 0, error: err };
    }
    try { await client.query('ROLLBACK'); } catch (_) {}
    check('직접 접속은 미국 글을 보지 못한다', directUs.n === 0);
    check('직접 접속은 빈 국가 글을 한국으로 본다', directKr.n === 1);
    check('직접 접속은 다른 사람 점수를 보지 못한다', otherScore.n === 0);
    check('직접 접속은 미국 글을 쓰지 못한다', !!directWrite);
    check('직접 접속은 점수 표를 쓰지 못한다', !!directScore);
    check('직접 접속은 한국 경험치를 바꾸지 못한다', progUpdate.rowCount === 0);

    const still = await one(client, 'SELECT xp FROM public.user_progression WHERE user_id = $1', [USER_A]);
    check('롤백 뒤 한국 경험치가 그대로다', Number(still.xp) === 80);
    const usAgain = await regionScores.readProfile(USER_A, 'US');
    check('미국 재조회가 저장값을 복원한다', usAgain.xp === 37 && usAgain.fame === 1 && usAgain.achievements.indexOf('first-post') !== -1);

    const popularKr = await service.listPopularPosts(kr, { period: 'day', territory: 'CENTRAL', limit: 20 });
    const popularUs = await service.listPopularPosts(us, { period: 'day', territory: 'CENTRAL', limit: 20 });
    const ids = function (result) { return (result.posts || []).map(function (row) { return row.id; }); };
    check('인기글이 섞이지 않는다',
      ids(popularKr).indexOf(usPost.post.id) === -1 && ids(popularUs).indexOf(seedPost.id) === -1
      && ids(popularUs).indexOf(usPost.post.id) !== -1);

    const krNotice = await one(client,
      "SELECT count(*)::int AS n FROM public.user_notifications " +
        "WHERE public.activity_region_norm(activity_region) = 'KR' AND message = '한국 알림'");
    const usNotice = await one(client,
      "SELECT count(*)::int AS n FROM public.user_notifications " +
        "WHERE activity_region = 'US' AND public.activity_region_norm(activity_region) = 'KR'");
    const usFeed = await one(client,
      "SELECT count(*)::int AS n FROM public.user_activity_events WHERE activity_region = 'US'");
    const krFeedMix = await one(client,
      "SELECT count(*)::int AS n FROM public.user_activity_events " +
        "WHERE activity_region = 'US' AND public.activity_region_norm(activity_region) = 'KR'");
    check('한국 알림이 남아 있다', krNotice.n === 1);
    check('미국 알림이 한국 조회에 섞이지 않는다', usNotice.n === 0 && usFeed.n > 0 && krFeedMix.n === 0);

    let persistCalls = 0;
    const skipped = await runAlignmentBatch({
      batchId: 'alignment-db-us-skip',
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
    const alignAfter = await one(client, 'SELECT score::text AS score FROM public.user_alignment_state WHERE user_id = $1', [USER_A]);
    check('한국 성향 점수는 그대로다', alignAfter.score === '12.500000');
  } finally {
    await client.end();
    await cluster.stop();
  }

  if (failed) {
    console.error('DB_TESTS_FAILED', failed);
    process.exit(1);
  }
  console.log('LOCAL_POSTGRES_TESTS_PASS');
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
