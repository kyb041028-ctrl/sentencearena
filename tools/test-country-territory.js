'use strict';

/**
 * 국가별 영토 소속. 격리 Postgres만 연다.
 * node tools/test-country-territory.js
 */
const fs = require('fs');
const path = require('path');
const store = require('../server/country-territory-store');
const { createCanonicalUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const assembler = require('../server/user-profile-assembler');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000aa';

function line(ok, name, detail) {
  return (ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : '');
}

async function main() {
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN country-territory: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-territory: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_territory_' + process.pid;
  const dbUrl = 'postgres://127.0.0.1:5432/' + dbName;
  const lines = [];
  let client;
  let other;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    other = new Client({ connectionString: dbUrl });
    await other.connect();
    await client.query(`
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        territory text NULL
      );
      CREATE TABLE public.user_activity_region_profile (
        user_id uuid NOT NULL,
        activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
        level integer NOT NULL DEFAULT 1,
        xp bigint NOT NULL DEFAULT 0,
        reputation_score bigint NOT NULL DEFAULT 0,
        territory text NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, activity_region)
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        activity_region text NULL
      );
      CREATE TABLE public.user_notifications (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        activity_region text NULL
      );
    `);
    await client.query(
      `INSERT INTO public.profiles (id, territory) VALUES ($1, 'CENTRAL')`,
      [USER]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_profile
        (user_id, activity_region, xp, reputation_score, territory) VALUES
        ($1, 'KR', 10, 3, NULL),
        ($1, 'US', 20, 4, NULL)`,
      [USER]
    );
    await client.query(
      `INSERT INTO public.user_follows (follower_user_id, following_user_id, activity_region)
       VALUES ($1, $1, 'KR')`,
      [USER]
    );
    await client.query(
      `INSERT INTO public.user_notifications (id, user_id, activity_region)
       VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-0000000000bb', $1, 'US')`,
      [USER]
    );

    const q = client.query.bind(client);
    await store.setCountryTerritory(q, {
      userId: USER, sessionRegion: 'KR', targetRegion: 'KR', territory: 'pioneer',
    });
    await store.setCountryTerritory(q, {
      userId: USER, sessionRegion: 'US', targetRegion: 'US', territory: 'guardian',
    });
    const kr = await store.readAffiliation(q, USER, 'KR');
    const us = await store.readAffiliation(q, USER, 'US');
    const profile = await client.query('SELECT territory FROM public.profiles WHERE id = $1', [USER]);
    lines.push(line(
      kr.territory === 'pioneer' && us.territory === 'guardian' && profile.rows[0].territory === 'CENTRAL',
      '1-different-countries-profiles-untouched'
    ));

    await store.setCountryTerritory(q, {
      userId: USER, sessionRegion: 'KR', targetRegion: 'KR', territory: 'central',
    });
    const after = await store.readAffiliation(q, USER, 'US');
    const scores = await client.query(
      `SELECT activity_region, xp, reputation_score FROM public.user_activity_region_profile
       WHERE user_id = $1 ORDER BY activity_region`,
      [USER]
    );
    lines.push(line(
      (await store.readAffiliation(q, USER, 'KR')).territory === 'central' &&
      after.territory === 'guardian' &&
      Number(scores.rows[0].xp) === 10 && Number(scores.rows[0].reputation_score) === 3 &&
      Number(scores.rows[1].xp) === 20 && Number(scores.rows[1].reputation_score) === 4,
      '2-one-side-change-keeps-scores'
    ));

    let mismatch = '';
    try {
      await store.setCountryTerritory(q, {
        userId: USER, sessionRegion: 'KR', targetRegion: 'US', territory: 'alien',
      });
    } catch (err) { mismatch = err.code; }
    lines.push(line(
      mismatch === 'REGION_MISMATCH' && (await store.readAffiliation(q, USER, 'US')).territory === 'guardian',
      '3-other-country-blocked'
    ));

    let missing = '';
    try {
      await store.setCountryTerritory(q, {
        userId: USER, sessionRegion: '', targetRegion: 'KR', territory: 'pioneer',
      });
    } catch (err) { missing = err.code; }
    lines.push(line(missing === 'COUNTRY_REQUIRED', '4-missing-country-rejected'));

    const usAgain = await store.readAffiliation(q, USER, 'US');
    lines.push(line(usAgain.territory === 'guardian', '5-persists-after-country-switch-read'));

    await Promise.all([
      store.setCountryTerritory(other.query.bind(other), {
        userId: USER, sessionRegion: 'KR', targetRegion: 'KR', territory: 'alien',
      }),
      store.setCountryTerritory(q, {
        userId: USER, sessionRegion: 'US', targetRegion: 'US', territory: 'pioneer',
      }),
    ]);
    const mixedKr = await store.readAffiliation(q, USER, 'KR');
    const mixedUs = await store.readAffiliation(q, USER, 'US');
    lines.push(line(
      mixedKr.territory === 'alien' && mixedUs.territory === 'pioneer',
      '6-concurrent-countries-do-not-mix'
    ));

    const adapter = createCanonicalUserContextAdapter({ query: q });
    const postKr = await adapter.getUserTerritory(USER, 'KR');
    const postUs = await adapter.getUserTerritory(USER, 'US');
    let usEmpty = '';
    await client.query(
      `UPDATE public.user_activity_region_profile SET territory = NULL
       WHERE user_id = $1 AND activity_region = 'US'`,
      [USER]
    );
    try { await adapter.getUserTerritory(USER, 'US'); }
    catch (err) { usEmpty = err.code; }
    await store.setCountryTerritory(q, {
      userId: USER, sessionRegion: 'US', targetRegion: 'US', territory: 'guardian',
    });
    lines.push(line(
      postKr === 'ALIEN' && postUs === 'PIONEER' && usEmpty === 'BOARD_USER_TERRITORY_UNAVAILABLE',
      '7-post-context-uses-country-row'
    ));

    const memory = createBoardMemoryRepository();
    memory.supportsActivityRegion = true;
    const board = createBoardService({
      repository: memory,
      operational: true,
      userContext: adapter,
    });
    let krPost = null;
    let usPost = null;
    let postError = '';
    try {
      krPost = await board.createPost(
        { userId: USER, activityRegion: 'KR' },
        { title: '한국 글', content: '본문' }
      );
      usPost = await board.createPost(
        { userId: USER, activityRegion: 'US' },
        { title: 'US post', content: 'body' }
      );
    } catch (err) {
      postError = err && err.code ? err.code : String(err && err.message || err);
    }
    lines.push(line(
      krPost && krPost.post && krPost.post.territory === 'ALIEN' &&
      usPost && usPost.post && usPost.post.territory === 'GUARDIAN' &&
      !postError,
      '8-create-post-context',
      postError
    ));

    assembler.setRepository({
      getProfile: async function () { return { id: USER, display_name: 'A', territory: 'CENTRAL' }; },
      getProgression: async function () { return { level: 1, xp: 1 }; },
      getPublicProgression: async function () { return { level: 1, follower_count: 0, following_count: 0 }; },
      getFollowState: async function () { return { isFollowing: false, isFollowedBy: false }; },
      getAchievements: async function () { return []; },
      getFeaturedAchievements: async function () { return []; },
      readCountryTerritory: async function (_id, region) {
        return (await store.readAffiliation(q, USER, region)).territory;
      },
    });
    const selfKr = await assembler.getSelfUserProfile({ userId: USER, activityRegion: 'KR' });
    const selfUs = await assembler.getSelfUserProfile({ userId: USER, activityRegion: 'US' });
    lines.push(line(
      selfKr.territory === 'alien' && selfUs.territory === 'guardian' && selfKr.territory !== 'CENTRAL',
      '9-profile-display-country-row'
    ));

    const follows = await client.query('SELECT count(*)::int AS n FROM public.user_follows');
    const notes = await client.query('SELECT count(*)::int AS n FROM public.user_notifications');
    const common = await client.query('SELECT territory FROM public.profiles WHERE id = $1', [USER]);
    lines.push(line(
      follows.rows[0].n === 1 && notes.rows[0].n === 1 && common.rows[0].territory === 'CENTRAL',
      '10-follow-notice-common-territory-unchanged'
    ));

    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'migration_country_territory_history_candidate.sql'),
      'utf8'
    );
    await client.query(sql);
    const sqlResult = await client.query(
      `SELECT public.set_country_territory($1, 'KR', 'KR', 'pioneer') AS territory`,
      [USER]
    );
    const history = await client.query(
      `SELECT activity_region, to_territory FROM public.country_territory_history
       WHERE user_id = $1`,
      [USER]
    );
    const usAfterSql = await store.readAffiliation(q, USER, 'US');
    lines.push(line(
      sqlResult.rows[0].territory === 'pioneer' &&
      history.rows.length === 1 && history.rows[0].activity_region === 'KR' &&
      usAfterSql.territory === 'guardian' &&
      (await client.query('SELECT territory FROM public.profiles WHERE id = $1', [USER])).rows[0].territory === 'CENTRAL',
      '11-candidate-sql-isolated'
    ));

    const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'activity-region-routes.js'), 'utf8');
    const boardRouteSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'board-routes.js'), 'utf8');
    lines.push(line(
      routeSrc.indexOf('setCountryTerritory') === -1 &&
      routeSrc.indexOf('set_country_territory') === -1 &&
      boardRouteSrc.indexOf('set_country_territory') === -1,
      '12-no-move-http-route'
    ));
  } finally {
    if (other) await other.end().catch(function () {});
    if (client) await client.end().catch(function () {});
    await admin.query('DROP DATABASE IF EXISTS ' + dbName).catch(function (err) {
      lines.push('DROP ' + String(err && err.message || err));
    });
    await admin.end().catch(function () {});
  }
  const failed = lines.filter(function (item) { return item.indexOf('FAIL') === 0; });
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write((failed.length ? 'FAIL ' : 'PASS ') + lines.length + '\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch(function (err) {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
