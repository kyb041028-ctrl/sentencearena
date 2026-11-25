'use strict';
/**
 * 실제 회원 표 모양을 격리 Postgres에만 두고 기존 계급 엔진에 연결한다.
 * 운영 데이터베이스와 원격 Supabase는 열지 않는다.
 * node tools/test-rank-live-source.js
 */
const formula = require('../shared/rank-formula-core');
const store = require('../server/leader-election-pg-store');
const live = require('../server/rank-live-source-adapter');

const DAY = formula.DAY_MS;

function line(ok, name) {
  return (ok ? 'VERIFIED ' : 'FAIL ') + name;
}

function wednesdayMs() {
  let ms = Date.UTC(2026, 10, 10, 15, 0, 0);
  for (let i = 0; i < 14; i += 1) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
    ms += DAY;
  }
  throw new Error('wednesday not found');
}

async function main() {
  const requested = 'postgres://127.0.0.1:5432/postgres';
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN rank-live-source: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN rank-live-source: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_live_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  const lines = [];
  let client;
  let other;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    await client.query(`
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        home_country text NOT NULL,
        territory text NULL,
        citizen_rank_unused text NULL
      );
      CREATE TABLE public.user_progression (
        user_id uuid PRIMARY KEY,
        reputation_score bigint NULL,
        citizen_rank text NULL
      );
      CREATE TABLE public.user_progression_events (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        event_type text NOT NULL,
        amount bigint NULL,
        source_id text NULL,
        dedupe_key text NOT NULL,
        occurred_at timestamptz NOT NULL,
        activity_region text NULL,
        territory_at_event text NULL
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL,
        activity_region text NULL,
        territory_at_follow text NULL,
        cancelled_at timestamptz NULL
      );
      CREATE TABLE public.board_reactions (
        id uuid PRIMARY KEY,
        actor_user_id uuid NOT NULL,
        target_author_user_id uuid NOT NULL,
        reaction_group text NOT NULL,
        created_at timestamptz NOT NULL,
        cancelled_at timestamptz NULL,
        target_author_territory_at_reaction text NULL,
        post_id uuid NULL,
        comment_id uuid NULL,
        activity_region text NULL
      );
      CREATE TABLE public.board_posts (
        id uuid PRIMARY KEY,
        author_user_id uuid NOT NULL,
        territory text NOT NULL,
        activity_region text NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY,
        author_user_id uuid NOT NULL,
        territory text NOT NULL,
        activity_region text NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL
      );
    `);
    const asOf = wednesdayMs();
    const inside = new Date(asOf - (10 * DAY)).toISOString();
    const old = new Date(asOf - (100 * DAY)).toISOString();
    const recent = new Date(asOf - DAY).toISOString();
    const idA = '11111111-1111-4111-8111-111111111111';
    const idM = '22222222-2222-4222-8222-222222222222';
    const idG = '33333333-3333-4333-8333-333333333333';
    const fan = '44444444-4444-4444-8444-444444444444';
    const eva = '55555555-5555-4555-8555-555555555555';

    lines.push(line((await live.dryRun({ connectionParameters: { host: 'db.supabase.co' } }, {
      country: 'KR', territory: 'pioneer', asOfMs: asOf,
    })).reason === 'REMOTE_DATABASE_BLOCKED', '1-remote-blocked'));
    lines.push(line((await live.dryRun(client, {
      country: 'US', territory: 'pioneer', asOfMs: asOf,
    })).reason === 'NOT_REFRESH_MOMENT', '2-us-not-new-york-midnight'));
    lines.push(line((await live.dryRun(client, {
      country: 'KR', territory: 'alien', asOfMs: asOf,
    })).reason === 'TERRITORY_NOT_IN_PROFILES', '3-alien-not-in-profiles'));

    await client.query(
      `INSERT INTO public.profiles (id, home_country, territory) VALUES
        ($1,'US','PIONEER'), ($2,'KR','PIONEER'), ($3,'KR','GUARDIAN')`,
      [idA, idM, idG]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, reputation_score, citizen_rank) VALUES ($1,40,'leader')`,
      [idA]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, reputation_score, citizen_rank) VALUES ($1,5,'representative')`,
      [idG]
    );
    const missing = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    lines.push(line(
      missing.reason === 'POPULATION_INCOMPLETE' && missing.officialApply === false &&
      missing.applied === false && missing.scoreKind === 'REFERENCE' &&
      (missing.planned || []).length === 0 &&
      (missing.unverified || []).some(function (row) { return row.id === idM && row.reason === 'FAME_SOURCE_MISSING'; }) &&
      (missing.scores || []).some(function (row) { return row.id === idA; }),
      '4-member-without-progression-blocks'
    ));
    await client.query('DELETE FROM public.profiles WHERE id = $1', [idM]);

    await client.query(
      `INSERT INTO public.user_progression_events (id, user_id, event_type, amount, dedupe_key, occurred_at)
       VALUES ($1,$2,'EMPATHY_RECEIVED', NULL, $3, $4)`,
      ['66666666-6666-4666-8666-666666666666', idA, 'EMPATHY_RECEIVED:post:' + eva, inside]
    );
    const unknown = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    lines.push(line(unknown.reason === 'FAME_OVERLAP_UNCONFIRMED' && unknown.applied === false, '5-unknown-overlap-blocks'));
    await client.query('DELETE FROM public.user_progression_events WHERE user_id = $1', [idA]);

    await client.query(
      `INSERT INTO public.user_progression_events
        (id, user_id, event_type, amount, dedupe_key, occurred_at, activity_region, territory_at_event) VALUES
        ('77777777-7777-4777-8777-777777777771',$1,'EMPATHY_RECEIVED',4,$2,$3,'KR','PIONEER'),
        ('77777777-7777-4777-8777-777777777772',$1,'EMPATHY_RECEIVED',6,$4,$3,'KR','PIONEER')`,
      [idA, 'EMPATHY_RECEIVED:post-a:' + eva, inside, 'EMPATHY_RECEIVED:post-b:' + eva]
    );
    await client.query(
      `INSERT INTO public.user_follows
        (follower_user_id, following_user_id, created_at, activity_region, territory_at_follow)
       VALUES ($1,$2,$3,'KR','PIONEER')`,
      [fan, idA, old]
    );
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, territory, activity_region, status, created_at) VALUES
        ('88888888-8888-4888-8888-888888888881',$1,'PIONEER','KR','ACTIVE',$2),
        ('88888888-8888-4888-8888-888888888882',$1,'PIONEER','US','ACTIVE',$2)`,
      [idA, recent]
    );
    await client.query(
      `INSERT INTO public.leader_offices (id, country, territory, leader_id) VALUES ('office-kr-pioneer','KR','pioneer',NULL)`
    );

    const preview = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const scored = preview.scores && preview.scores.filter(function (row) { return row.id === idA; })[0];
    const plannedIds = (preview.planned || []).map(function (row) { return row.id; });
    const fameBefore = await client.query('SELECT reputation_score, citizen_rank FROM public.user_progression WHERE user_id = $1', [idA]);
    lines.push(line(
      preview.dryRun === true && preview.applied === false && preview.productionApply === false &&
      plannedIds.indexOf(idA) >= 0 && plannedIds.indexOf(idG) < 0 &&
      scored && scored.d === 1 && scored.r === 30 && scored.f === 1 && scored.storedFame === 40 &&
      preview.territoryPopulation === 1 &&
      preview.planned.filter(function (row) { return row.id === idA; })[0].rank === 'citizen' &&
      Number(fameBefore.rows[0].reputation_score) === 40 && fameBefore.rows[0].citizen_rank === 'leader' &&
      preview.usedCitizenRank === false && preview.usedHomeCountry === false,
      '6-canonical-dry-run-keeps-stored-fame'
    ));

    other = new Client({ connectionString: dbUrl });
    await other.connect();
    let pending = null;
    const applied = await live.applyIsolated(client, {
      apply: true,
      country: 'KR',
      territory: 'pioneer',
      asOfMs: asOf,
      afterLock: async function () {
        pending = other.query('UPDATE public.user_progression SET reputation_score = reputation_score + 1 WHERE user_id = $1', [idA]);
        await new Promise(function (resolve) { setTimeout(resolve, 300); });
      },
    });
    await pending;
    const fameAfter = await client.query('SELECT reputation_score FROM public.user_progression WHERE user_id = $1', [idA]);
    const rankRow = await client.query(
      'SELECT fame, rank, comparison_score FROM public.leader_rank_members WHERE person_id = $1',
      [idA]
    );
    const office = await client.query(`SELECT leader_id FROM public.leader_offices WHERE id = 'office-kr-pioneer'`);
    lines.push(line(
      applied.applied === true && applied.productionApply === false &&
      Number(fameAfter.rows[0].reputation_score) === 41 &&
      Number(rankRow.rows[0].fame) === 40 && rankRow.rows[0].rank === 'citizen' &&
      Number(rankRow.rows[0].comparison_score) === scored.storedScore &&
      office.rows[0].leader_id == null,
      '7-apply-does-not-rewrite-member-fame-or-office'
    ));
    const again = await live.applyIsolated(client, {
      apply: true, country: 'KR', territory: 'pioneer', asOfMs: asOf,
    });
    const rankStill = await client.query('SELECT rank FROM public.leader_rank_members WHERE person_id = $1', [idA]);
    lines.push(line(again.reason === 'ROUND_ALREADY_APPLIED' && rankStill.rows[0].rank === 'citizen', '8-second-apply-does-not-change-rank'));

    const keep = '99999999-9999-4999-8999-999999999991';
    const ids = [keep, '99999999-9999-4999-8999-999999999992', '99999999-9999-4999-8999-999999999993', '99999999-9999-4999-8999-999999999994'];
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(
        `INSERT INTO public.profiles (id, home_country, territory) VALUES ($1,'KR','CENTRAL')`,
        [ids[i]]
      );
      await client.query(
        `INSERT INTO public.user_progression (user_id, reputation_score, citizen_rank) VALUES ($1,20,'leader')`,
        [ids[i]]
      );
      await client.query(
        `INSERT INTO public.board_posts (id, author_user_id, territory, activity_region, status, created_at)
         VALUES ($1,$2,'CENTRAL','KR','ACTIVE',$3)`,
        ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa' + (i + 1), ids[i], recent]
      );
      for (let n = 0; n < 10; n += 1) {
        const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-' + String(i) + String(n).padStart(11, '0');
        await client.query(
          `INSERT INTO public.user_progression_events
            (id, user_id, event_type, amount, dedupe_key, occurred_at, activity_region, territory_at_event)
           VALUES ($1,$2,'EMPATHY_RECEIVED',1,$3,$4,'KR','CENTRAL')`,
          ['cccccccc-cccc-4ccc-8ccc-' + String(i) + String(n).padStart(11, '0'), ids[i], 'EMPATHY_RECEIVED:old:' + actor, old]
        );
      }
    }
    await client.query(
      `INSERT INTO public.leader_rank_members (country, territory, person_id, fame, rank, elected_leader, unique_positive_evaluators)
       VALUES ('KR','central',$1,20,'debater',false,10)`,
      [keep]
    );
    const tied = await live.dryRun(client, { country: 'KR', territory: 'central', asOfMs: asOf });
    const tieScores = tied.scores.map(function (row) { return row.storedScore; });
    const tieApply = await live.applyIsolated(client, {
      apply: true, country: 'KR', territory: 'central', asOfMs: asOf,
    });
    const debaters = await client.query(
      `SELECT person_id FROM public.leader_rank_members WHERE country='KR' AND territory='central' AND rank='debater'`
    );
    lines.push(line(
      tied.dryRun === true && tieScores.every(function (score) { return score === tieScores[0]; }) &&
      tieApply.applied === true && debaters.rows.length === 1 && debaters.rows[0].person_id === keep,
      '9-same-percentile-tie-keeps-existing-rank'
    ));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (other) {
      try { await other.end(); } catch (_e) { /* 닫기 */ }
    }
    if (client) {
      try { await client.end(); } catch (_e) { /* 닫기 */ }
    }
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
      await admin.query('DROP DATABASE IF EXISTS ' + dbName);
    } catch (_drop) { /* 정리 실패는 보고 */ }
    try { await admin.end(); } catch (_e) { /* 닫기 */ }
  }
  const failed = lines.filter(function (row) { return row.indexOf('FAIL') === 0; });
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write(failed.length ? 'RESULT FAIL\n' : 'RESULT PASS\n');
  process.exit(failed.length ? 1 : 0);
}

main();
