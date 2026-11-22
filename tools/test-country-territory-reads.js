'use strict';

/**
 * 국가별 조회·인구·팔로우 소속·계급 입력. 격리 Postgres만.
 * node tools/test-country-territory-reads.js
 */
const store = require('../server/country-territory-store');
const territoryService = require('../server/canonical-user-territory-service');
const repo = require('../server/user-data-supabase-repository');
const live = require('../server/rank-live-source-adapter');
const formula = require('../shared/rank-formula-core');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000aa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-0000000000bb';
const C = 'cccccccc-cccc-4ccc-8ccc-0000000000cc';
const FAN = 'dddddddd-dddd-4ddd-8ddd-0000000000dd';

function line(ok, name, detail) {
  return (ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : '');
}

function wednesdayMs() {
  let ms = Date.UTC(2026, 10, 10, 15, 0, 0);
  for (let i = 0; i < 14; i += 1) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
    ms += formula.DAY_MS;
  }
  return null;
}

async function main() {
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN country-territory-reads: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-territory-reads: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_reads_' + process.pid;
  const lines = [];
  let client;
  let other;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    other = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await other.connect();
    await client.query(`
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        territory text NULL,
        citizenship_status text NULL
      );
      CREATE TABLE public.user_activity_region_profile (
        user_id uuid NOT NULL,
        activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
        xp bigint NOT NULL DEFAULT 0,
        reputation_score bigint NOT NULL DEFAULT 0,
        territory text NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, activity_region)
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        activity_region text NULL,
        territory_at_follow text NULL,
        cancelled_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.user_notifications (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        activity_region text NULL
      );
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        follower_count bigint NOT NULL DEFAULT 0,
        reputation_score bigint NULL
      );
    `);
    await client.query(
      `INSERT INTO public.profiles (id, territory, citizenship_status) VALUES
        ($1, 'CENTRAL', 'CITIZEN'),
        ($2, 'PIONEER', 'CITIZEN'),
        ($3, 'CENTRAL', 'CITIZEN')`,
      [A, B, C]
    );
    const q = function (sql, params) { return client.query(sql, params); };
    await store.setCountryTerritory(q, { userId: A, sessionRegion: 'KR', targetRegion: 'KR', territory: 'pioneer' });
    await store.setCountryTerritory(q, { userId: A, sessionRegion: 'US', targetRegion: 'US', territory: 'guardian' });
    await client.query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory, reputation_score)
       VALUES ($1, 'KR', NULL, 9)`,
      [C]
    );
    await client.query(
      `UPDATE public.user_activity_region_profile SET xp = 11, reputation_score = 21
       WHERE user_id = $1 AND activity_region = 'KR'`,
      [A]
    );
    await client.query(
      `UPDATE public.user_activity_region_profile SET xp = 12, reputation_score = 22
       WHERE user_id = $1 AND activity_region = 'US'`,
      [A]
    );
    await client.query(
      `INSERT INTO public.user_notifications (id, user_id, activity_region)
       VALUES ('eeeeeeee-eeee-4eee-8eee-0000000000ee', $1, 'KR')`,
      [A]
    );
    await client.query(
      `INSERT INTO public.user_follows
        (follower_user_id, following_user_id, activity_region, territory_at_follow, cancelled_at)
       VALUES
        ($1, $2, 'KR', 'PIONEER', NULL),
        ($1, $2, 'KR', 'PIONEER', now()),
        ($1, $2, 'US', 'GUARDIAN', NULL)`,
      [FAN, A]
    );

    const kr = await territoryService.getCountryUserTerritory(A, 'KR', { query: q });
    const us = await territoryService.getCountryUserTerritory(A, 'US', { query: q });
    const common = await client.query('SELECT territory FROM public.profiles WHERE id = $1', [A]);
    lines.push(line(
      kr.territory === 'pioneer' && us.territory === 'guardian' && kr.source === 'user_activity_region_profile',
      '1-kr-pioneer-us-guardian',
      'function'
    ));
    lines.push(line(
      common.rows[0].territory === 'CENTRAL' && kr.territory !== 'central' && us.territory !== 'central',
      '2-shared-central-not-used',
      'function'
    ));

    const krPioneer = await store.countCountryPopulation(q, 'KR', 'pioneer');
    const krCentral = await store.countCountryPopulation(q, 'KR', 'central');
    const usGuardian = await store.countCountryPopulation(q, 'US', 'guardian');
    const usCentral = await store.countCountryPopulation(q, 'US', 'central');
    const usPioneer = await store.countCountryPopulation(q, 'US', 'pioneer');
    lines.push(line(krPioneer.population === 1 && krCentral.population === 0, '3-kr-pioneer-population-only-a', 'function'));
    lines.push(line(
      usGuardian.population === 1 && usCentral.population === 0 && usPioneer.population === 0,
      '4-us-guardian-population-only-a',
      'function'
    ));

    const unset = await territoryService.getCountryUserTerritory(C, 'KR', { query: q });
    const noRow = await territoryService.getCountryUserTerritory(B, 'US', { query: q });
    lines.push(line(
      unset.reason === 'TERRITORY_UNSET' && unset.territory == null &&
      noRow.reason === 'TERRITORY_UNSET' && noRow.territory == null,
      '5-empty-country-territory-not-filled',
      'function'
    ));

    repo.setAdminClient({ query: q });
    const krFollow = await repo.readCountryAffiliation(A, 'KR');
    const usFollow = await repo.readCountryAffiliation(A, 'US');
    const unsetFollow = await repo.readCountryAffiliation(C, 'KR');
    lines.push(line(
      krFollow.available === true && krFollow.territory === 'pioneer' &&
      usFollow.territory === 'guardian' && krFollow.territory !== usFollow.territory,
      '6-kr-follow-read-does-not-use-us-territory',
      'function'
    ));

    const krInput = await live.readCountryInputs(client, 'KR', 'pioneer');
    const usInput = await live.readCountryInputs(client, 'US', 'guardian');
    const usRun = await live.dryRun(client, { country: 'US', territory: 'guardian', asOfMs: wednesdayMs() });
    lines.push(line(
      krInput.weeklyRun === false && krInput.members.length === 1 && krInput.members[0].id === A &&
      krInput.follows.length === 1 && krInput.follows[0].activity_region === 'KR',
      '7-kr-rank-input-kr-only',
      'function'
    ));
    lines.push(line(
      usInput.weeklyRun === false && usInput.members.length === 1 && usInput.members[0].territory === 'GUARDIAN' &&
      usInput.follows.length === 1 && usInput.follows[0].activity_region === 'US' &&
      usRun.reason === 'NOT_REFRESH_MOMENT' && usRun.applied !== true,
      '8-us-input-without-weekly-run',
      'function'
    ));

    let missing = '';
    try {
      await store.countCountryPopulation(q, '', 'pioneer');
    } catch (err) { missing = err.code; }
    lines.push(line(
      missing === 'COUNTRY_REQUIRED' && unsetFollow.available === true && unsetFollow.territory == null,
      '9-missing-country-and-unset-blocked',
      'function'
    ));

    await Promise.all([
      store.setCountryTerritory(q, { userId: A, sessionRegion: 'KR', targetRegion: 'KR', territory: 'central' }),
      store.setCountryTerritory(other.query.bind(other), { userId: A, sessionRegion: 'US', targetRegion: 'US', territory: 'alien' }),
    ]);
    const afterKr = await store.readAffiliation(q, A, 'KR');
    const afterUs = await store.readAffiliation(q, A, 'US');
    const scores = await client.query(
      `SELECT activity_region, xp, reputation_score FROM public.user_activity_region_profile
       WHERE user_id = $1 ORDER BY activity_region`,
      [A]
    );
    const notes = await client.query('SELECT count(*)::int AS n FROM public.user_notifications');
    const profileLeft = await client.query('SELECT territory FROM public.profiles WHERE id = $1', [A]);
    lines.push(line(
      afterKr.territory === 'central' && afterUs.territory === 'alien',
      '10-concurrent-update-no-mix',
      'function'
    ));
    lines.push(line(
      Number(scores.rows[0].xp) === 11 && Number(scores.rows[0].reputation_score) === 21 &&
      Number(scores.rows[1].xp) === 12 && Number(scores.rows[1].reputation_score) === 22 &&
      notes.rows[0].n === 1 && profileLeft.rows[0].territory === 'CENTRAL' &&
      usFollow.territory === 'guardian',
      '11-progression-follow-notice-profile-unchanged',
      'function'
    ));
  } finally {
    if (other) await other.end().catch(function () {});
    if (client) await client.end().catch(function () {});
    await admin.query('DROP DATABASE IF EXISTS ' + dbName).catch(function () {});
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
