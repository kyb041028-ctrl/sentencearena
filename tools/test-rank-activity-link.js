'use strict';
/**
 * 계급 개발 3차. 격리 Postgres만 사용한다.
 * node tools/test-rank-activity-link.js
 */
const fs = require('fs');
const path = require('path');
const formula = require('../shared/rank-formula-core');
const store = require('../server/leader-election-pg-store');
const live = require('../server/rank-live-source-adapter');
const link = require('../server/rank-activity-link');

function line(ok, name) {
  return (ok ? 'VERIFIED ' : 'FAIL ') + name;
}

function wednesdayMs() {
  let ms = Date.UTC(2026, 10, 10, 15, 0, 0);
  for (let i = 0; i < 14; i += 1) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
    ms += formula.DAY_MS;
  }
  throw new Error('wednesday not found');
}

function uuidFrom(prefix, n) {
  return prefix + '-' + String(n).padStart(12, '0');
}

async function fameOf(client, id) {
  const found = await client.query('SELECT reputation_score FROM public.user_progression WHERE user_id = $1', [id]);
  return found.rows.length ? Number(found.rows[0].reputation_score) : null;
}

async function main() {
  const requested = 'postgres://127.0.0.1:5432/postgres';
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN rank-activity-link: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN rank-activity-link: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_link_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  const lines = [];
  let client;
  let other;
  try {
    const source = fs.readFileSync(path.join(__dirname, '../server/rank-activity-link.js'), 'utf8');
    lines.push(line(
      source.indexOf('apply_user_progression_event') < 0 && source.indexOf('toggle_user_follow') < 0 &&
      source.indexOf('home_country') < 0 && source.indexOf('homeCountry') < 0,
      '1-link-does-not-call-old-writer-or-home-country'
    ));
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    await store.applyMigration(client);
    await client.query(`
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, home_country text NOT NULL, territory text NULL);
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
        amount bigint NULL,
        source_type text NULL,
        source_id text NULL,
        dedupe_key text NOT NULL UNIQUE,
        occurred_at timestamptz NOT NULL
      );
      CREATE TABLE public.user_follows (
        follower_user_id uuid NOT NULL,
        following_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (follower_user_id, following_user_id)
      );
      CREATE TABLE public.board_posts (
        id uuid PRIMARY KEY, author_user_id uuid NOT NULL, territory text NOT NULL,
        activity_region text NULL, status text NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY, author_user_id uuid NOT NULL, territory text NOT NULL,
        activity_region text NULL, status text NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE TABLE public.board_reactions (
        id uuid PRIMARY KEY, actor_user_id uuid NOT NULL, target_author_user_id uuid NOT NULL,
        reaction_group text NOT NULL, created_at timestamptz NOT NULL, cancelled_at timestamptz NULL,
        target_author_territory_at_reaction text NULL, post_id uuid NULL, comment_id uuid NULL,
        activity_region text NULL
      );
    `);
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_rank_event_context_candidate.sql'), 'utf8'));

    const asOf = wednesdayMs();
    const inside = new Date(asOf - formula.DAY_MS).toISOString();
    const author = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const reactor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const fan = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    const oldAuthor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
    const centralGood = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
    const dedupe = 'EMPATHY_RECEIVED:post-new:' + reactor;
    await client.query(
      `INSERT INTO public.profiles (id, home_country, territory) VALUES
        ($1,'US','CENTRAL'), ($2,'US','PIONEER'), ($3,'KR','PIONEER'), ($4,'KR','PIONEER'), ($5,'US','CENTRAL')`,
      [author, reactor, fan, oldAuthor, centralGood]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, reputation_score) VALUES ($1,10), ($2,0), ($3,0), ($4,7), ($5,4)`,
      [author, reactor, fan, oldAuthor, centralGood]
    );
    await client.query(
      `INSERT INTO public.user_progression_events (user_id, event_type, amount, dedupe_key, occurred_at)
       VALUES ($1,'EMPATHY_RECEIVED',7,'EMPATHY_RECEIVED:old:legacy',$2)`,
      [oldAuthor, inside]
    );
    await client.query(
      `INSERT INTO public.user_follows (follower_user_id, following_user_id) VALUES ($1,$2)`,
      [fan, oldAuthor]
    );

    const ignoredHome = await link.grantEmpathy(client, {
      recipientId: author, amount: 1, sourceId: 'post-new', dedupeKey: dedupe,
      homeCountry: 'US', territory: 'PIONEER',
    });
    const granted = await link.grantEmpathy(client, {
      recipientId: author, amount: 1, sourceId: 'post-new', dedupeKey: dedupe,
      activityRegion: 'KR', territory: 'PIONEER', homeCountry: 'US',
    });
    const duplicate = await link.grantEmpathy(client, {
      recipientId: author, amount: 1, sourceId: 'post-new', dedupeKey: dedupe,
      activityRegion: 'KR', territory: 'PIONEER',
    });
    const stored = await client.query(
      `SELECT amount, activity_region, territory_at_event, dedupe_key, cancelled_at
       FROM public.user_progression_events WHERE dedupe_key = $1`,
      [dedupe]
    );
    const oldEvent = await client.query(
      `SELECT activity_region FROM public.user_progression_events WHERE user_id = $1 AND dedupe_key = 'EMPATHY_RECEIVED:old:legacy'`,
      [oldAuthor]
    );
    lines.push(line(
      ignoredHome.code === 'CONTEXT_UNKNOWN' && Number(await fameOf(client, author)) === 11 &&
      granted.status === 'APPLIED' && duplicate.status === 'DUPLICATE' && Number(duplicate.fameDelta) === 0 &&
      stored.rows.length === 1 && Number(stored.rows[0].amount) === 1 &&
      stored.rows[0].activity_region === 'KR' && stored.rows[0].territory_at_event === 'PIONEER' &&
      String(stored.rows[0].dedupe_key).endsWith(reactor) && oldEvent.rows[0].activity_region == null,
      '2-empathy-grant-and-duplicate-store-context-once'
    ));

    const cancelled = await link.cancelEmpathy(client, {
      recipientId: author, dedupeKey: dedupe, activityRegion: 'KR', territory: 'PIONEER',
    });
    const fameAfterCancel = Number(await fameOf(client, author));
    const cancelAgain = await link.cancelEmpathy(client, {
      recipientId: author, dedupeKey: dedupe, activityRegion: 'KR', territory: 'PIONEER',
    });
    const afterCancel = await client.query(
      'SELECT cancelled_at IS NOT NULL AS cancelled FROM public.user_progression_events WHERE dedupe_key = $1',
      [dedupe]
    );
    const regrant = await link.grantEmpathy(client, {
      recipientId: author, amount: 1, sourceId: 'post-new', dedupeKey: dedupe,
      activityRegion: 'KR', territory: 'PIONEER',
    });
    const reopened = await client.query(
      'SELECT count(*)::int AS n, bool_or(cancelled_at IS NULL) AS open FROM public.user_progression_events WHERE dedupe_key = $1',
      [dedupe]
    );
    const fameAfterRegrant = Number(await fameOf(client, author));
    lines.push(line(
      cancelled.status === 'APPLIED' && fameAfterCancel === 10 &&
      cancelAgain.status === 'NOT_FOUND' && afterCancel.rows[0].cancelled === true &&
      regrant.status === 'APPLIED' && regrant.regrant === true &&
      reopened.rows[0].n === 1 && reopened.rows[0].open === true &&
      fameAfterRegrant === 11,
      '3-empathy-cancel-keeps-row-and-regrant-once'
    ));

    const usGrant = await link.grantEmpathy(client, {
      recipientId: author, amount: 9, sourceId: 'us-post', dedupeKey: 'EMPATHY_RECEIVED:us:' + reactor,
      activityRegion: 'US', territory: 'PIONEER',
    });
    const usRows = await client.query(
      `SELECT count(*)::int AS n FROM public.user_progression_events WHERE dedupe_key = $1`,
      ['EMPATHY_RECEIVED:us:' + reactor]
    );
    lines.push(line(
      usGrant.code === 'FAME_NOT_COUNTRY_SEPARATED' && usRows.rows[0].n === 0 &&
      Number(await fameOf(client, author)) === fameAfterRegrant,
      '5-us-empathy-does-not-enter-shared-fame'
    ));

    const beforeFail = Number(await fameOf(client, author));
    await client.query('BEGIN');
    await link.grantEmpathy(client, {
      recipientId: author, amount: 4, sourceId: 'fail', dedupeKey: 'EMPATHY_RECEIVED:fail:' + reactor,
      activityRegion: 'KR', territory: 'CENTRAL',
    });
    try { await client.query('SELECT 1/0'); }
    catch (_err) { await client.query('ROLLBACK'); }
    const failLeft = await client.query(
      `SELECT count(*)::int AS n FROM public.user_progression_events WHERE dedupe_key = $1`,
      ['EMPATHY_RECEIVED:fail:' + reactor]
    );
    lines.push(line(
      Number(await fameOf(client, author)) === beforeFail && failLeft.rows[0].n === 0,
      '6-transaction-failure-rolls-fame-and-event-back'
    ));

    other = new Client({ connectionString: dbUrl });
    await other.connect();
    const concurrentKey = 'EMPATHY_RECEIVED:race:' + reactor;
    const raced = await Promise.all([
      link.grantEmpathy(client, {
        recipientId: author, amount: 1, sourceId: 'race', dedupeKey: concurrentKey,
        activityRegion: 'KR', territory: 'PIONEER',
      }),
      link.grantEmpathy(other, {
        recipientId: author, amount: 1, sourceId: 'race', dedupeKey: concurrentKey,
        activityRegion: 'KR', territory: 'PIONEER',
      }),
    ]);
    const statuses = raced.map(function (row) { return row.status; }).sort();
    lines.push(line(
      statuses[0] === 'APPLIED' && statuses[1] === 'DUPLICATE' &&
      Number(await fameOf(client, author)) === beforeFail + 1,
      '7-concurrent-same-empathy-adds-fame-once'
    ));

    const followed = await link.follow(client, {
      followerId: fan, targetId: author, activityRegion: 'KR', territory: 'PIONEER', homeCountry: 'US',
    });
    const followAgain = await link.follow(client, {
      followerId: fan, targetId: author, activityRegion: 'KR', territory: 'PIONEER',
    });
    const locked = await link.follow(client, {
      followerId: fan, targetId: author, activityRegion: 'US', territory: 'CENTRAL',
    });
    const followRow = await client.query(
      `SELECT activity_region, territory_at_follow, cancelled_at FROM public.user_follows
       WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, author]
    );
    const counts = await client.query(
      'SELECT follower_count FROM public.user_progression WHERE user_id = $1',
      [author]
    );
    const oldFollow = await client.query(
      `SELECT activity_region, cancelled_at FROM public.user_follows
       WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, oldAuthor]
    );
    const oldUntouched = await link.follow(client, {
      followerId: fan, targetId: oldAuthor, activityRegion: 'KR', territory: 'PIONEER',
    });
    lines.push(line(
      followed.status === 'FOLLOWED' && followAgain.status === 'DUPLICATE' &&
      locked.code === 'CONTEXT_LOCKED' && followRow.rows.length === 1 &&
      followRow.rows[0].activity_region === 'KR' && followRow.rows[0].territory_at_follow === 'PIONEER' &&
      followRow.rows[0].cancelled_at == null && Number(counts.rows[0].follower_count) === 1 &&
      oldFollow.rows[0].activity_region == null && oldUntouched.code === 'FOLLOW_BASELINE_UNKNOWN',
      '8-follow-once-context-locked-old-row-unchanged'
    ));
    const unfollowed = await link.follow(client, {
      followerId: fan, targetId: author, activityRegion: 'KR', territory: 'PIONEER', cancel: true,
    });
    const refollowed = await link.follow(client, {
      followerId: fan, targetId: author, activityRegion: 'KR', territory: 'PIONEER',
    });
    const afterFollow = await client.query(
      `SELECT cancelled_at IS NULL AS active FROM public.user_follows
       WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, author]
    );
    const countAgain = await client.query(
      'SELECT follower_count FROM public.user_progression WHERE user_id = $1',
      [author]
    );
    lines.push(line(
      unfollowed.status === 'CANCELLED' && refollowed.status === 'FOLLOWED' &&
      afterFollow.rows.length === 1 && afterFollow.rows[0].active === true &&
      Number(countAgain.rows[0].follower_count) === 1,
      '9-unfollow-keeps-row-and-refollow-counts-once'
    ));

    await client.query(
      `INSERT INTO public.user_progression_events
        (user_id, event_type, amount, dedupe_key, occurred_at, activity_region, territory_at_event)
       VALUES ($1,'EMPATHY_RECEIVED',5,'EMPATHY_RECEIVED:manual-us:actor',$2,'US','PIONEER')`,
      [author, inside]
    );
    await client.query('UPDATE public.user_progression SET reputation_score = reputation_score + 5 WHERE user_id = $1', [author]);
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, territory, activity_region, status, created_at)
       VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',$1,'CENTRAL','KR','ACTIVE',$2)`,
      [centralGood, inside]
    );
    const mixed = await live.dryRun(client, { country: 'KR', territory: 'central', asOfMs: asOf });
    const centralOnly = (mixed.unverified || []).filter(function (row) { return row.id === author; })[0];
    const centralSibling = (mixed.scores || []).filter(function (row) { return row.id === centralGood; })[0];
    lines.push(line(
      mixed.officialApply === false && mixed.scoreKind === 'REFERENCE' && (mixed.planned || []).length === 0 &&
      centralOnly && centralOnly.reason === 'COUNTRY_MIXED_EVENT' && !!centralSibling &&
      mixed.productionApply === false,
      '10-shared-us-fame-blocks-that-territory-without-splitting'
    ));
    const pioneerClean = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    lines.push(line(
      pioneerClean.ok === true &&
      !(pioneerClean.unverified || []).some(function (row) { return row.reason === 'COUNTRY_MIXED_EVENT'; }),
      '11-other-territory-call-is-not-failed-by-central-mix'
    ));

    await client.query(`DELETE FROM public.profiles WHERE territory = 'PIONEER'`);
    await client.query(`
      INSERT INTO public.profiles (id, home_country, territory)
      SELECT (('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid), 'US', 'PIONEER'
      FROM generate_series(1, 1000) AS n
    `);
    await client.query(`
      INSERT INTO public.user_progression (user_id, reputation_score)
      SELECT id, 10 FROM public.profiles WHERE territory = 'PIONEER'
    `);
    const all = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    lines.push(line(
      all.officialApply === true && all.scoreKind === 'COMPLETE_COHORT' &&
      (all.scores || []).length === 1000 && (all.unverified || []).length === 0 &&
      (all.planned || []).length === 1000 && all.usedHomeCountry === false,
      '12-complete-1000-cohort-can-be-official'
    ));

    await client.query(`
      INSERT INTO public.user_progression_events (user_id, event_type, amount, dedupe_key, occurred_at)
      SELECT id, 'EMPATHY_RECEIVED', 3, 'EMPATHY_RECEIVED:gap:' || id::text, $1::timestamptz
      FROM public.profiles
      WHERE territory = 'PIONEER'
        AND id >= '10000000-0000-4000-8000-000000000601'::uuid
    `, [inside]);
    const partial = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const partialApply = await live.applyIsolated(client, {
      apply: true, country: 'KR', territory: 'pioneer', asOfMs: asOf,
    });
    const rankCount = await client.query(
      `SELECT count(*)::int AS n FROM public.leader_rank_members WHERE country = 'KR' AND territory = 'pioneer'`
    );
    lines.push(line(
      (partial.scores || []).length === 600 && (partial.unverified || []).length === 400 &&
      partial.officialApply === false && partial.scoreKind === 'REFERENCE' &&
      (partial.planned || []).length === 0 && (partial.referenceAssignments || []).length === 600 &&
      partialApply.applied === false && rankCount.rows[0].n === 0,
      '13-partial-600-of-1000-reference-only-no-rank-write'
    ));

    await client.query(`DELETE FROM public.user_progression_events WHERE activity_region IS NULL`);
    await client.query(`
      UPDATE public.user_progression up
         SET reputation_score = 100000
       WHERE user_id = '10000000-0000-4000-8000-000000000001'::uuid
    `);
    await client.query(`
      INSERT INTO public.user_progression_events (user_id, event_type, amount, dedupe_key, occurred_at)
      VALUES ('10000000-0000-4000-8000-000000000001','EMPATHY_RECEIVED',9,'EMPATHY_RECEIVED:top:unknown',$1)
    `, [inside]);
    await client.query(`
      INSERT INTO public.leader_rank_members
        (country, territory, person_id, fame, rank, comparison_score, valid, elected_leader, unique_positive_evaluators)
      VALUES ('KR','pioneer','10000000-0000-4000-8000-000000000001',100000,'representative',1,true,false,0)
    `);
    const top = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const topRef = (top.scores || []).map(function (row) { return row.storedFame; });
    const topMax = topRef.length ? Math.max.apply(null, topRef) : 0;
    const topApply = await live.applyIsolated(client, { apply: true, country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const topRank = await client.query(
      `SELECT rank FROM public.leader_rank_members WHERE person_id = '10000000-0000-4000-8000-000000000001'`
    );
    lines.push(line(
      top.officialApply === false && topMax < 100000 && topApply.applied === false &&
      topRank.rows[0].rank === 'representative',
      '14-unverified-top-score-is-not-official-percentile'
    ));

    await client.query(`DELETE FROM public.user_progression_events WHERE dedupe_key = 'EMPATHY_RECEIVED:top:unknown'`);
    await client.query(`
      UPDATE public.user_progression SET reputation_score = 0
      WHERE user_id = '10000000-0000-4000-8000-000000000002'::uuid
    `);
    await client.query(`
      INSERT INTO public.user_progression_events (user_id, event_type, amount, dedupe_key, occurred_at)
      VALUES ('10000000-0000-4000-8000-000000000002','EMPATHY_RECEIVED',1,'EMPATHY_RECEIVED:bottom:unknown',$1)
    `, [inside]);
    await client.query(`
      INSERT INTO public.leader_rank_members
        (country, territory, person_id, fame, rank, comparison_score, valid, elected_leader, unique_positive_evaluators)
      VALUES ('KR','pioneer','10000000-0000-4000-8000-000000000002',0,'elder',1,true,false,0)
    `);
    const bottom = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const bottomApply = await live.applyIsolated(client, { apply: true, country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const elderRank = await client.query(
      `SELECT rank FROM public.leader_rank_members WHERE person_id = '10000000-0000-4000-8000-000000000002'`
    );
    lines.push(line(
      bottom.officialApply === false && bottomApply.applied === false &&
      (bottom.unverified || []).some(function (row) { return row.id === '10000000-0000-4000-8000-000000000002' && row.rank === 'elder'; }) &&
      elderRank.rows[0].rank === 'elder' && topRank.rows[0].rank === 'representative',
      '15-unverified-bottom-and-existing-elder-representative-stay'
    ));

    await client.query(`DELETE FROM public.user_progression_events WHERE dedupe_key LIKE 'EMPATHY_RECEIVED:%unknown'`);
    await client.query(`DELETE FROM public.leader_rank_members WHERE territory = 'pioneer'`);
    await client.query(`DELETE FROM public.leader_rank_rounds WHERE territory = 'pioneer'`);
    await client.query(`DELETE FROM public.profiles WHERE territory = 'PIONEER' AND id > '10000000-0000-4000-8000-000000000020'::uuid`);
    await client.query(`UPDATE public.user_progression SET reputation_score = 20 WHERE user_id IN (SELECT id FROM public.profiles WHERE territory = 'PIONEER')`);
    await client.query(`
      INSERT INTO public.leader_rank_members
        (country, territory, person_id, fame, rank, comparison_score, valid, elected_leader, unique_positive_evaluators)
      SELECT 'KR', 'pioneer', id::text, 20, 'representative', 1, true, false, 0
      FROM public.profiles
      WHERE territory = 'PIONEER' AND id <= '10000000-0000-4000-8000-000000000010'::uuid
    `);
    const tie = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const tieReps = (tie.planned || []).filter(function (row) { return row.rank === 'representative'; });
    const tieApply = await live.applyIsolated(client, { apply: true, country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const tieSecond = await live.applyIsolated(client, { apply: true, country: 'KR', territory: 'pioneer', asOfMs: asOf });
    lines.push(line(
      tie.officialApply === true && tieReps.length === 10 &&
      tieReps.every(function (row) { return row.id <= '10000000-0000-4000-8000-000000000010'; }) &&
      tieApply.applied === true && tieSecond.reason === 'ROUND_ALREADY_APPLIED',
      '16-tie-at-seat-boundary-and-weekly-rerun-once'
    ));

    const guardianId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    await client.query(
      `INSERT INTO public.profiles (id, home_country, territory) VALUES ($1,'KR','GUARDIAN')`,
      [guardianId]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, reputation_score) VALUES ($1,3)`,
      [guardianId]
    );
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, territory, activity_region, status, created_at)
       VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1',$1,'GUARDIAN','KR','ACTIVE',$2)`,
      [guardianId, inside]
    );
    const guardian = await live.dryRun(client, { country: 'KR', territory: 'guardian', asOfMs: asOf });
    const guardianApply = await live.applyIsolated(client, {
      apply: true, country: 'KR', territory: 'guardian', asOfMs: asOf,
    });
    lines.push(line(
      guardian.officialApply === true && guardianApply.applied === true && tie.officialApply === true,
      '17-complete-guardian-still-applies-beside-other-work'
    ));
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
