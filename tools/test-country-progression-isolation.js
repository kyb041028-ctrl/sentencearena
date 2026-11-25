'use strict';
/**
 * 1단계 국가별 진행 저장. 격리 Postgres만 사용한다.
 * node tools/test-country-progression-isolation.js
 */
const fs = require('fs');
const path = require('path');
const formula = require('../shared/rank-formula-core');
const electionStore = require('../server/leader-election-pg-store');
const live = require('../server/rank-live-source-adapter');
const scope = require('../server/activity-region-scope');
const { createCountryProgressionStore } = require('../server/country-progression-store');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

const A = '11111111-1111-4111-8111-111111111111';

function line(ok, name) {
  return (ok ? 'PASS ' : 'FAIL ') + name;
}

function wednesday() {
  const start = Date.UTC(2026, 10, 1);
  for (let ms = start; ms < start + 14 * 24 * 60 * 60 * 1000; ms += 60 * 1000) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
  }
  return null;
}

async function main() {
  delete process.env.LEADER_ELECTION_BACKEND;
  delete process.env.LEADER_ELECTION_PG_ISOLATED;
  delete process.env.LEADER_ELECTION_PG_URL;
  const lines = [];
  lines.push(line(
    formula.WEIGHTS.fame === 0.45 && formula.WEIGHTS.uniqueEvaluators === 0.3 &&
    formula.WEIGHTS.reactions === 0.15 && formula.WEIGHTS.followers === 0.1,
    'weights-45-30-15-10'
  ));
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN country-progression: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-progression: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_progress_' + process.pid;
  const dbUrl = 'postgres://127.0.0.1:5432/' + dbName;
  let client;
  let other;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    other = new Client({ connectionString: dbUrl });
    await other.connect();
    await client.query(fs.readFileSync(
      path.join(__dirname, '../supabase/migration_country_progression_candidate.sql'), 'utf8'
    ));
    await client.query(`
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        xp bigint NOT NULL DEFAULT 0,
        level integer NOT NULL DEFAULT 1,
        reputation_score bigint NOT NULL DEFAULT 0
      );
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        home_country text NOT NULL,
        territory text NULL
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
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.user_progression_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        event_type text,
        amount bigint,
        dedupe_key text,
        occurred_at timestamptz
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid,
        following_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        author_user_id uuid,
        territory text,
        activity_region text,
        status text NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(
      'INSERT INTO public.profiles (id, home_country, territory) VALUES ($1, \'KR\', \'PIONEER\')',
      [A]
    );
    await client.query(
      'INSERT INTO public.user_progression (user_id, xp, level, reputation_score) VALUES ($1, 10, 1, 40)',
      [A]
    );
    const store = createCountryProgressionStore({ query: function (sql, params) { return client.query(sql, params); } });
    const otherStore = createCountryProgressionStore({ query: function (sql, params) { return other.query(sql, params); } });
    await store.applyDelta({ userId: A, region: 'KR', xpDelta: 0, fameDelta: 500, dedupeKey: 'KR-fame-500' });
    await store.applyDelta({ userId: A, region: 'US', xpDelta: 0, fameDelta: 100, dedupeKey: 'US-fame-100' });
    const kr = await store.read(A, 'KR');
    const us = await store.read(A, 'US');
    const legacy = await client.query('SELECT xp, level, reputation_score FROM public.user_progression WHERE user_id = $1', [A]);
    lines.push(line(
      kr.fame === 500 && us.fame === 100 && Number(legacy.rows[0].reputation_score) === 40,
      'kr-fame-500-us-fame-100-legacy-untouched'
    ));
    await store.applyDelta({ userId: A, region: 'KR', xpDelta: 50, fameDelta: 0, dedupeKey: 'KR-xp-50' });
    const krAfter = await store.read(A, 'KR');
    const usAfter = await store.read(A, 'US');
    lines.push(line(
      krAfter.xp === 50 && krAfter.level === 2 && krAfter.fame === 500 &&
      usAfter.xp === 0 && usAfter.level === 1 && usAfter.fame === 100,
      'kr-xp-level-leaves-us'
    ));
    let rejected = false;
    try {
      await store.applyDelta({ userId: A, region: '', xpDelta: 1, fameDelta: 0, dedupeKey: 'no-country' });
    } catch (err) { rejected = err && err.code === 'COUNTRY_REQUIRED'; }
    const norm = await client.query("SELECT public.activity_region_norm(NULL) AS region");
    const labeled = await client.query(
      "SELECT public.label_activity_region_if_verified(NULL, NULL) AS unknown, public.label_activity_region_if_verified(NULL, 'KR') AS verified"
    );
    lines.push(line(
      rejected && norm.rows[0].region == null &&
      labeled.rows[0].unknown == null && labeled.rows[0].verified === 'KR',
      'missing-country-rejected'
    ));
    const aimed = await client.query(
      `UPDATE public.user_activity_region_profile
       SET reputation_score = reputation_score + 1
       WHERE user_id = $1 AND activity_region = 'US' AND activity_region = 'KR'`,
      [A]
    );
    await otherStore.applyDelta({ userId: A, region: 'US', xpDelta: 0, fameDelta: 1, dedupeKey: 'US-only-plus-one' });
    const afterAim = await store.read(A, 'KR');
    const usAim = await store.read(A, 'US');
    lines.push(line(
      aimed.rowCount === 0 && afterAim.fame === 500 && usAim.fame === 101,
      'write-aimed-at-other-country-does-not-change-kr'
    ));
    await Promise.all([
      store.applyDelta({ userId: A, region: 'KR', xpDelta: 1, fameDelta: 0, dedupeKey: 'concurrent-kr' }),
      otherStore.applyDelta({ userId: A, region: 'US', xpDelta: 3, fameDelta: 0, dedupeKey: 'concurrent-us' }),
    ]);
    const krMix = await store.read(A, 'KR');
    const usMix = await store.read(A, 'US');
    lines.push(line(
      krMix.xp === 51 && krMix.fame === 500 && usMix.xp === 3 && usMix.fame === 101,
      'concurrent-kr-us-do-not-mix'
    ));
    const event = await store.applyEvent({
      userId: A, region: 'KR', eventType: 'POST_CREATED', sourceId: 'explicit-kr-post',
    });
    const legacyAfter = await client.query('SELECT xp, reputation_score FROM public.user_progression WHERE user_id = $1', [A]);
    lines.push(line(
      event.xpDelta === 25 && event.status === 'APPLIED' &&
      Number(legacyAfter.rows[0].xp) === 10 && Number(legacyAfter.rows[0].reputation_score) === 40,
      'explicit-kr-post-xp-does-not-double-write-legacy'
    ));
    await client.query(
      `INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region)
       VALUES ($1, 'CENTRAL', 'explicit kr', 'body', 'KR'),
              ($1, 'CENTRAL', 'legacy blank', 'body', NULL),
              ($1, 'CENTRAL', 'explicit us', 'body', 'US')`,
      [A]
    );
    const query = function (sql, params) { return client.query(sql, params); };
    const repository = createActivityRegionPgRepository({ query: query });
    const service = createBoardService({
      repository: repository,
      userContext: createMockUserContextAdapter({ territories: {} }),
      operational: true,
      countryProgression: store,
    });
    const listed = await service.listPosts({ userId: A, activityRegion: 'KR' }, { territory: 'CENTRAL' });
    const titles = listed.map(function (row) { return row.title; });
    let blankRejected = false;
    try { await repository.createPost({ authorUserId: A, territory: 'CENTRAL', title: 'x', content: 'y' }); }
    catch (err) { blankRejected = err && err.code === 'COUNTRY_REQUIRED'; }
    lines.push(line(
      titles.indexOf('explicit kr') >= 0 && titles.indexOf('explicit us') < 0 &&
      titles.indexOf('legacy blank') < 0 &&
      scope.legacyUnassigned({ activity_region: null }) === true &&
      blankRejected,
      'kr-board-lists-explicit-kr-and-not-unknown'
    ));
    await electionStore.applyMigration(client);
    const B = '22222222-2222-4222-8222-222222222222';
    await client.query(
      `INSERT INTO public.profiles (id, home_country, territory) VALUES ($1, 'KR', 'PIONEER')`,
      [B]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region, reputation_score, territory)
       VALUES ($1, 'KR', 200, 'pioneer')`,
      [B]
    );
    await client.query(
      `UPDATE public.user_activity_region_profile SET territory = 'pioneer'
       WHERE user_id = $1 AND activity_region = 'KR'`,
      [A]
    );
    const asOf = wednesday();
    const preview = asOf == null ? null : await live.dryRun(client, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
    });
    const countryScore = formula.scoreCohort({
      country: 'KR',
      territory: 'pioneer',
      asOfMs: asOf || 0,
      members: [
        { id: A, country: 'KR', territory: 'pioneer', fame: 500 },
        { id: B, country: 'KR', territory: 'pioneer', fame: 200 },
      ],
      reactions: [],
      follows: [],
    });
    const legacyScore = formula.scoreCohort({
      country: 'KR',
      territory: 'pioneer',
      asOfMs: asOf || 0,
      members: [
        { id: A, country: 'KR', territory: 'pioneer', fame: 40 },
        { id: B, country: 'KR', territory: 'pioneer', fame: 200 },
      ],
      reactions: [],
      follows: [],
    });
    const got = preview && preview.scores ? preview.scores.filter(function (row) { return row.id === A; })[0] : null;
    const rankOk = preview && preview.ok === true && got && countryScore.ok === true &&
      got.combined === countryScore.members[0].combined &&
      got.combined !== legacyScore.members[0].combined &&
      countryScore.weights.fame === 0.45;
    lines.push(line(rankOk, 'rank-formula-reads-kr-country-fame'));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (other) { try { await other.end(); } catch (_e) { /* 닫기 */ } }
    if (client) { try { await client.end(); } catch (_e) { /* 닫기 */ } }
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
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
