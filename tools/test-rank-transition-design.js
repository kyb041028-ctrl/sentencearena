'use strict';
/**
 * 계급 전환 설계 4차. 격리 Postgres만 사용한다.
 * node tools/test-rank-transition-design.js
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

async function fameOf(client, id) {
  const found = await client.query('SELECT reputation_score FROM public.user_progression WHERE user_id = $1', [id]);
  return Number(found.rows[0].reputation_score);
}

async function main() {
  const requested = 'postgres://127.0.0.1:5432/postgres';
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN rank-transition-design: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: requested, connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN rank-transition-design: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_transition_' + process.pid;
  const dbUrl = requested.replace(/\/[^/]*$/, '/' + dbName);
  const lines = [];
  let client;
  let other;
  try {
    const board = fs.readFileSync(path.join(__dirname, '../server/board-service.js'), 'utf8');
    const receive = board.slice(board.indexOf('async function receivePostEmpathy'), board.indexOf('async function revokePostEmpathy'));
    const repo = fs.readFileSync(path.join(__dirname, '../server/user-data-supabase-repository.js'), 'utf8');
    const followers = repo.slice(repo.indexOf('async function getFollowers'), repo.indexOf('async function getFollowing'));
    lines.push(line(
      receive.indexOf('applyEmpathyReceivedFame') >= 0 &&
      receive.indexOf('apply_empathy_fame_with_context') < 0 &&
      repo.indexOf("rpc('toggle_user_follow'") >= 0 &&
      followers.indexOf('cancelled_at IS NULL') >= 0,
      '1-live-routes-stay-on-old-functions'
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
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_empathy_received_fame_rpc.sql'), 'utf8').replace(/REVOKE[\s\S]*$/m, ''));
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/migration_rank_event_context_candidate.sql'), 'utf8'));
    await client.query(`
      CREATE OR REPLACE FUNCTION public.toggle_user_follow_isolated_copy(p_follower uuid, p_following uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE v_exists boolean;
      BEGIN
        SELECT EXISTS(
          SELECT 1 FROM public.user_follows
           WHERE follower_user_id = p_follower AND following_user_id = p_following
        ) INTO v_exists;
        IF v_exists THEN
          DELETE FROM public.user_follows
           WHERE follower_user_id = p_follower AND following_user_id = p_following;
          UPDATE public.user_progression SET follower_count = GREATEST(0, follower_count - 1) WHERE user_id = p_following;
          UPDATE public.user_progression SET following_count = GREATEST(0, following_count - 1) WHERE user_id = p_follower;
          RETURN jsonb_build_object('status', 'UNFOLLOWED');
        END IF;
        INSERT INTO public.user_follows (follower_user_id, following_user_id)
        VALUES (p_follower, p_following) ON CONFLICT DO NOTHING;
        UPDATE public.user_progression SET follower_count = follower_count + 1 WHERE user_id = p_following;
        UPDATE public.user_progression SET following_count = following_count + 1 WHERE user_id = p_follower;
        RETURN jsonb_build_object('status', 'FOLLOWED');
      END;
      $$;
    `);

    const asOf = wednesdayMs();
    const inside = new Date(asOf - formula.DAY_MS).toISOString();
    const kept = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
    const otherFame = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';
    const raced = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03';
    const fan = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04';
    const legacyTarget = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05';
    const rep = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06';
    const elder = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07';
    const citizen = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08';
    const central = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09';
    await client.query(
      `INSERT INTO public.profiles (id, home_country, territory) VALUES
        ($1,'US','PIONEER'),($2,'US','PIONEER'),($3,'KR','PIONEER'),($4,'KR','PIONEER'),
        ($5,'KR','PIONEER'),($6,'KR','PIONEER'),($7,'KR','PIONEER'),($8,'KR','PIONEER'),($9,'US','CENTRAL')`,
      [kept, otherFame, raced, fan, legacyTarget, rep, elder, citizen, central]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, reputation_score, follower_count) VALUES
        ($1,40,0),($2,27,0),($3,15,0),($4,0,0),($5,18,0),($6,20,3),($7,12,0),($8,8,0),($9,9,0)`,
      [kept, otherFame, raced, fan, legacyTarget, rep, elder, citizen, central]
    );
    await client.query(
      `INSERT INTO public.user_follows (follower_user_id, following_user_id) VALUES ($1,$2)`,
      [fan, rep]
    );

    const dedupe = 'EMPATHY_RECEIVED:kept:' + fan;
    const liveFirst = await client.query(
      `SELECT public.apply_user_progression_event($1,'EMPATHY_RECEIVED',1,'EMPATHY','post',$2,now()) AS result`,
      [kept, dedupe]
    );
    const contextSecond = await link.grantEmpathy(client, {
      recipientId: kept, amount: 1, sourceId: 'post', dedupeKey: dedupe,
      activityRegion: 'KR', territory: 'PIONEER', homeCountry: 'US',
    });
    const reverseKey = 'EMPATHY_RECEIVED:other:' + fan;
    const contextFirst = await link.grantEmpathy(client, {
      recipientId: otherFame, amount: 1, sourceId: 'post', dedupeKey: reverseKey,
      activityRegion: 'KR', territory: 'PIONEER',
    });
    const liveSecond = await client.query(
      `SELECT public.apply_user_progression_event($1,'EMPATHY_RECEIVED',1,'EMPATHY','post',$2,now()) AS result`,
      [otherFame, reverseKey]
    );
    lines.push(line(
      liveFirst.rows[0].result.status === 'APPLIED' && contextSecond.status === 'DUPLICATE' &&
      await fameOf(client, kept) === 41 &&
      contextFirst.status === 'APPLIED' && liveSecond.rows[0].result.status === 'DUPLICATE' &&
      await fameOf(client, otherFame) === 28 &&
      await fameOf(client, kept) !== 0 && await fameOf(client, otherFame) !== 0,
      '2-both-empathy-writers-add-once-and-keep-existing-fame'
    ));

    other = new Client({ connectionString: dbUrl });
    await other.connect();
    const raceKey = 'EMPATHY_RECEIVED:race:' + fan;
    await Promise.all([
      client.query(
        `SELECT public.apply_user_progression_event($1,'EMPATHY_RECEIVED',1,'EMPATHY','post',$2,now())`,
        [raced, raceKey]
      ),
      other.query(
        `SELECT public.apply_empathy_fame_with_context($1,1,'post',$2,now(),'KR','PIONEER')`,
        [raced, raceKey]
      ),
    ]);
    const raceRows = await client.query(
      'SELECT count(*)::int AS n FROM public.user_progression_events WHERE dedupe_key = $1',
      [raceKey]
    );
    lines.push(line(
      await fameOf(client, raced) === 16 && raceRows.rows[0].n === 1,
      '3-concurrent-live-and-context-empathy-adds-once'
    ));

    const bareCancel = await link.cancelEmpathy(client, {
      recipientId: kept, dedupeKey: dedupe, activityRegion: 'KR', territory: 'PIONEER',
    });
    const contextKey = 'EMPATHY_RECEIVED:context:' + fan;
    const contextGrant = await link.grantEmpathy(client, {
      recipientId: kept, amount: 1, sourceId: 'context-post', dedupeKey: contextKey,
      activityRegion: 'KR', territory: 'PIONEER',
    });
    const cancelled = await link.cancelEmpathy(client, {
      recipientId: kept, dedupeKey: contextKey, activityRegion: 'KR', territory: 'PIONEER',
    });
    const keptCancel = await client.query(
      'SELECT cancelled_at IS NOT NULL AS cancelled, last_cancelled_at IS NOT NULL AS remembered, amount FROM public.user_progression_events WHERE dedupe_key = $1',
      [contextKey]
    );
    const regrant = await link.grantEmpathy(client, {
      recipientId: kept, amount: 1, sourceId: 'context-post', dedupeKey: contextKey,
      activityRegion: 'KR', territory: 'PIONEER',
    });
    const reopened = await client.query(
      'SELECT cancelled_at IS NULL AS open, last_cancelled_at IS NOT NULL AS remembered FROM public.user_progression_events WHERE dedupe_key = $1',
      [contextKey]
    );
    lines.push(line(
      bareCancel.code === 'CONTEXT_UNKNOWN' && contextGrant.status === 'APPLIED' &&
      cancelled.status === 'APPLIED' &&
      keptCancel.rows[0].cancelled === true && keptCancel.rows[0].remembered === true &&
      Number(keptCancel.rows[0].amount) === 1 &&
      regrant.regrant === true && await fameOf(client, kept) === 42 &&
      reopened.rows[0].open === true && reopened.rows[0].remembered === true,
      '4-cancel-regrant-keeps-cancel-history-and-original-fame'
    ));

    const lockedKey = 'EMPATHY_RECEIVED:locked:' + fan;
    await link.grantEmpathy(client, {
      recipientId: kept, amount: 1, sourceId: 'post-2', dedupeKey: lockedKey,
      activityRegion: 'KR', territory: 'PIONEER',
    });
    await link.cancelEmpathy(client, {
      recipientId: kept, dedupeKey: lockedKey, activityRegion: 'KR', territory: 'PIONEER',
    });
    const fameBeforeLock = await fameOf(client, kept);
    const refused = await link.grantEmpathy(client, {
      recipientId: kept, amount: 1, sourceId: 'post-2', dedupeKey: lockedKey,
      activityRegion: 'US', territory: 'CENTRAL',
    });
    const locked = await client.query(
      `SELECT public.apply_empathy_fame_with_context($1,1,'post-2',$2,now(),'US','CENTRAL') AS result`,
      [kept, lockedKey]
    ).then(function (found) { return found.rows[0].result; });
    const lockedRow = await client.query(
      'SELECT activity_region, territory_at_event, cancelled_at IS NOT NULL AS cancelled FROM public.user_progression_events WHERE dedupe_key = $1',
      [lockedKey]
    );
    lines.push(line(
      refused.code === 'FAME_NOT_COUNTRY_SEPARATED' && locked.code === 'CONTEXT_LOCKED' &&
      await fameOf(client, kept) === fameBeforeLock &&
      lockedRow.rows[0].activity_region === 'KR' && lockedRow.rows[0].territory_at_event === 'PIONEER' &&
      lockedRow.rows[0].cancelled === true,
      '5-country-or-territory-change-does-not-rewrite-or-add-fame'
    ));

    const beforeRollback = await fameOf(client, kept);
    await client.query('BEGIN');
    await link.grantEmpathy(client, {
      recipientId: kept, amount: 1, sourceId: 'rollback', dedupeKey: 'EMPATHY_RECEIVED:rollback:' + fan,
      activityRegion: 'KR', territory: 'PIONEER',
    });
    try { await client.query('SELECT 1/0'); }
    catch (_err) { await client.query('ROLLBACK'); }
    lines.push(line(await fameOf(client, kept) === beforeRollback, '6-rollback-keeps-existing-fame'));

    const followed = await link.follow(client, {
      followerId: fan, targetId: elder, activityRegion: 'KR', territory: 'PIONEER',
    });
    const unfollowed = await link.follow(client, {
      followerId: fan, targetId: elder, activityRegion: 'KR', territory: 'PIONEER', cancel: true,
    });
    const during = await client.query(
      `SELECT activity_region, cancelled_at IS NOT NULL AS cancelled, last_cancelled_at IS NOT NULL AS remembered
       FROM public.user_follows WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, elder]
    );
    const refollowed = await link.follow(client, {
      followerId: fan, targetId: elder, activityRegion: 'KR', territory: 'PIONEER',
    });
    const afterFollow = await client.query(
      `SELECT activity_region IS NOT NULL AS contextual, cancelled_at IS NULL AS active,
              last_cancelled_at IS NOT NULL AS remembered
       FROM public.user_follows WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, elder]
    );
    const legacy = await client.query(
      `SELECT activity_region IS NULL AS legacy, cancelled_at IS NULL AS active
       FROM public.user_follows WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, rep]
    );
    const liveList = await client.query(
      'SELECT count(*)::int AS n FROM public.user_follows WHERE following_user_id = $1',
      [elder]
    );
    const activeList = await client.query(
      'SELECT count(*)::int AS n FROM public.user_follows WHERE following_user_id = $1 AND cancelled_at IS NULL',
      [elder]
    );
    const countRow = await client.query(
      'SELECT follower_count FROM public.user_progression WHERE user_id = $1',
      [elder]
    );
    const legacyCount = await client.query(
      'SELECT follower_count FROM public.user_progression WHERE user_id = $1',
      [rep]
    );
    lines.push(line(
      followed.status === 'FOLLOWED' && unfollowed.status === 'CANCELLED' &&
      during.rows[0].cancelled === true && during.rows[0].remembered === true &&
      refollowed.status === 'FOLLOWED' && afterFollow.rows[0].contextual === true &&
      afterFollow.rows[0].active === true && afterFollow.rows[0].remembered === true &&
      legacy.rows[0].legacy === true && legacy.rows[0].active === true &&
      liveList.rows[0].n === 1 && activeList.rows[0].n === 1 &&
      Number(countRow.rows[0].follower_count) === 1 && Number(legacyCount.rows[0].follower_count) === 3,
      '7-old-and-new-follows-stay-distinct-and-active-count-ignores-cancel'
    ));

    const hazardBefore = Number((await client.query(
      'SELECT follower_count FROM public.user_progression WHERE user_id = $1',
      [citizen]
    )).rows[0].follower_count);
    await link.follow(client, {
      followerId: fan, targetId: citizen, activityRegion: 'KR', territory: 'PIONEER',
    });
    const rawToggle = await client.query(
      'SELECT public.toggle_user_follow_isolated_copy($1,$2) AS result',
      [fan, citizen]
    );
    const hazardRow = await client.query(
      'SELECT count(*)::int AS n FROM public.user_follows WHERE following_user_id = $1',
      [citizen]
    );
    const hazardCount = Number((await client.query(
      'SELECT follower_count FROM public.user_progression WHERE user_id = $1',
      [citizen]
    )).rows[0].follower_count);
    lines.push(line(
      rawToggle.rows[0].result.status === 'UNFOLLOWED' && hazardRow.rows[0].n === 0 &&
      hazardCount === hazardBefore,
      '8-raw-live-toggle-after-context-follow-deletes-instead-of-doubling'
    ));

    const legacyGuard = await client.query(
      `SELECT public.isolate_follow_once($1,$2,'KR','PIONEER',false) AS result`,
      [fan, rep]
    );
    const legacyStill = await client.query(
      `SELECT activity_region IS NULL AS legacy FROM public.user_follows
       WHERE follower_user_id = $1 AND following_user_id = $2`,
      [fan, rep]
    );
    const fresh = await Promise.all([
      client.query(`SELECT public.isolate_follow_once($1,$2,'KR','CENTRAL',false) AS result`, [fan, central]),
      other.query(`SELECT public.isolate_follow_once($1,$2,'KR','CENTRAL',false) AS result`, [fan, central]),
    ]);
    const freshStatuses = fresh.map(function (row) { return row.rows[0].result.status; }).sort();
    const freshCount = Number((await client.query(
      'SELECT follower_count FROM public.user_progression WHERE user_id = $1',
      [central]
    )).rows[0].follower_count);
    lines.push(line(
      legacyGuard.rows[0].result.status === 'EXISTING' && legacyGuard.rows[0].result.legacy === true &&
      Number(legacyGuard.rows[0].result.followerCount) === 3 && legacyStill.rows[0].legacy === true &&
      freshStatuses[0] === 'EXISTING' && freshStatuses[1] === 'FOLLOWED' && freshCount === 1,
      '9-isolated-follow-wiring-does-not-double-or-delete'
    ));

    await client.query(
      `INSERT INTO public.leader_rank_members
        (country, territory, person_id, fame, rank, comparison_score, valid, elected_leader, unique_positive_evaluators)
       VALUES
        ('KR','pioneer',$1,20,'representative',1,true,false,0),
        ('KR','pioneer',$2,12,'elder',1,true,false,0)`,
      [rep, elder]
    );
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, territory, activity_region, status, created_at) VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',$1,'PIONEER','KR','ACTIVE',$3),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',$2,'CENTRAL','KR','ACTIVE',$3)`,
      [citizen, central, inside]
    );
    await client.query(
      'UPDATE public.user_progression_events SET occurred_at = $1',
      [new Date(asOf - (200 * formula.DAY_MS)).toISOString()]
    );
    await client.query(
      'UPDATE public.user_follows SET created_at = $1 WHERE activity_region IS NULL',
      [inside]
    );
    const pioneer = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
    const pioneerApply = await live.applyIsolated(client, {
      apply: true, country: 'KR', territory: 'pioneer', asOfMs: asOf,
    });
    const repRank = await client.query(
      `SELECT rank FROM public.leader_rank_members WHERE person_id = $1`,
      [rep]
    );
    lines.push(line(
      pioneer.scoreKind === 'REFERENCE' && pioneer.officialApply === false &&
      pioneer.census.totalMembers === 8 && pioneer.census.evaluableCount === 7 &&
      pioneer.census.unevaluableCount === 1 &&
      pioneer.census.unevaluableReasons.FOLLOW_SCOPE_UNKNOWN === 1 &&
      pioneer.census.sittingRepresentativeEvaluable === false &&
      pioneer.census.sittingElderEvaluable === true &&
      pioneer.census.officialCapsApplied === false &&
      pioneer.census.resumeCondition === 'CUTOFF_UNCONFIRMED' &&
      pioneerApply.applied === false && repRank.rows[0].rank === 'representative' &&
      await fameOf(client, rep) === 20 && await fameOf(client, legacyTarget) === 18,
      '10-incomplete-cohort-blocks-only-that-territory'
    ));
    const centralRun = await live.dryRun(client, { country: 'KR', territory: 'central', asOfMs: asOf });
    const centralApply = await live.applyIsolated(client, {
      apply: true, country: 'KR', territory: 'central', asOfMs: asOf,
    });
    lines.push(line(
      centralRun.officialApply === true && centralRun.scoreKind === 'COMPLETE_COHORT' &&
      centralRun.census.unevaluableCount === 0 && centralApply.applied === true &&
      await fameOf(client, central) === 9,
      '11-complete-other-territory-still-applies'
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
