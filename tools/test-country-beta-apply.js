'use strict';
/**
 * 베타 진입 SQL을 새 격리 DB에 한 번 적용하고 핵심 흐름만 확인한다.
 * node tools/test-country-beta-apply.js
 */
const fs = require('fs');
const path = require('path');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createBoardService } = require('../server/board-service');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KR_POST = '11111111-1111-4111-8111-111111111111';
const US_POST = '22222222-2222-4222-8222-222222222222';
const BLANK_POST = '33333333-3333-4333-8333-333333333333';

function line(ok, name) {
  return (ok ? 'PASS ' : 'FAIL ') + name;
}

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const lines = [];
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN country-beta-apply: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN country-beta-apply: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'country_beta_apply_' + process.pid;
  let client = null;
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migration_country_beta_apply.sql'), 'utf8');
    await client.query(sql);

    const defs = await client.query(
      `SELECT p.proname, count(*)::int AS n
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN (
           'toggle_board_reaction', 'activity_region_norm', 'record_user_follow_with_context',
           'apply_country_progression', 'apply_empathy_fame_with_context', 'set_country_territory'
         )
       GROUP BY p.proname
       ORDER BY p.proname`
    );
    const oneEach = defs.rows.length === 6 && defs.rows.every(function (row) { return row.n === 1; });
    const norm = await client.query(`SELECT public.activity_region_norm(NULL) AS blank`);
    const toggleDef = await client.query(
      `SELECT pg_get_functiondef('public.toggle_board_reaction(text,uuid,text,text,text,text)'::regprocedure) AS def`
    );
    const body = toggleDef.rows[0].def;
    lines.push(line(
      oneEach && norm.rows[0].blank == null &&
      body.indexOf('COALESCE((SELECT score') >= 0 && body.indexOf("IS DISTINCT FROM 'US'") >= 0 &&
      body.indexOf('COUNTRY_REQUIRED') >= 0,
      '1-one-final-function-and-both-score-paths'
    ));

    const v2 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migration_activity_region_v2.sql'), 'utf8');
    const normSql = v2.slice(
      v2.indexOf('CREATE OR REPLACE FUNCTION public.activity_region_norm'),
      v2.indexOf('COMMENT ON FUNCTION public.activity_region_norm')
    );
    await client.query(normSql);
    const normAgain = await client.query(`SELECT public.activity_region_norm(NULL) AS blank, public.activity_region_norm('US') AS us`);
    lines.push(line(normAgain.rows[0].blank == null && normAgain.rows[0].us === 'US', '2-reapplying-v2-norm-does-not-restore-kr'));

    await client.query(
      `INSERT INTO public.profiles (id) VALUES ($1), ($2), ($3)`,
      [A, B, C]
    );
    await client.query(
      `INSERT INTO public.user_progression (user_id, xp, reputation_score) VALUES ($1, 80, 99)`,
      [B]
    );
    await client.query(`SELECT * FROM public.apply_country_progression($1, 'KR', 3, 1, 'kr-grant')`, [B]);
    await client.query(`SELECT * FROM public.apply_country_progression($1, 'US', 0, 4, 'us-grant')`, [B]);
    const shared = await client.query(`SELECT xp, reputation_score FROM public.user_progression WHERE user_id = $1`, [B]);
    const country = await client.query(
      `SELECT activity_region, xp, reputation_score, territory
       FROM public.user_activity_region_profile WHERE user_id = $1 ORDER BY activity_region`,
      [B]
    );
    lines.push(line(
      Number(shared.rows[0].reputation_score) === 99 && Number(shared.rows[0].xp) === 80 &&
      country.rows.length === 2 &&
      country.rows[0].activity_region === 'KR' && Number(country.rows[0].xp) === 3 && Number(country.rows[0].reputation_score) === 1 &&
      country.rows[1].activity_region === 'US' && Number(country.rows[1].xp) === 0 && Number(country.rows[1].reputation_score) === 4 &&
      country.rows[0].territory == null,
      '3-country-profile-does-not-copy-shared-fame'
    ));

    await client.query(`SELECT public.set_country_territory($1, 'KR', 'KR', 'pioneer')`, [B]);
    await client.query(`SELECT public.set_country_territory($1, 'US', 'US', 'central')`, [B]);
    const places = await client.query(
      `SELECT p.territory AS shared,
              (SELECT territory FROM public.user_activity_region_profile WHERE user_id = p.id AND activity_region = 'KR') AS kr,
              (SELECT territory FROM public.user_activity_region_profile WHERE user_id = p.id AND activity_region = 'US') AS us
       FROM public.profiles p WHERE p.id = $1`,
      [B]
    );
    lines.push(line(
      places.rows[0].shared == null && places.rows[0].kr === 'pioneer' && places.rows[0].us === 'central',
      '4-territory-read-is-per-country'
    ));

    await client.query(
      `INSERT INTO public.user_alignment_state (user_id, score) VALUES ($1, 7.5), ($2, 7.5)`,
      [A, B]
    );
    await client.query(
      `INSERT INTO public.user_legal_consents
        (user_id, age_requirement_confirmed_at, age_policy_version,
         sensitive_political_consented_at, sensitive_political_policy_version,
         territory_disclosure_consented_at, territory_disclosure_policy_version)
       VALUES ($1, now(), 'age-policy-v1', now(), 'sensitive-political-v1', now(), 'territory-disclosure-v1'),
              ($2, now(), 'age-policy-v1', now(), 'sensitive-political-v1', now(), 'territory-disclosure-v1')`,
      [A, B]
    );
    await client.query(
      `INSERT INTO public.board_posts (id, author_user_id, territory, title, content, status, activity_region)
       VALUES ($1,$2,'CENTRAL','한국 글','한국 본문','ACTIVE','KR'),
              ($3,$2,'CENTRAL','US post','US body','ACTIVE','US'),
              ($4,$2,'CENTRAL','국가 없는 옛 글','blank','ACTIVE',NULL)`,
      [KR_POST, B, US_POST, BLANK_POST]
    );
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [A]);
    const krLike = await client.query(
      `SELECT public.toggle_board_reaction('POST', $1, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL') AS result`,
      [KR_POST]
    );
    const krScore = await client.query(
      `SELECT actor_alignment_score_at_reaction AS actor_score, activity_region
       FROM public.board_reactions WHERE post_id = $1 AND cancelled_at IS NULL`,
      [KR_POST]
    );
    const usDislike = await client.query(
      `SELECT public.toggle_board_reaction('POST', $1, 'DISLIKE', 'CENTRAL', 'EARTH', 'CENTRAL') AS result`,
      [US_POST]
    );
    const usScore = await client.query(
      `SELECT actor_alignment_score_at_reaction AS actor_score,
              target_author_alignment_score_at_reaction AS target_score,
              activity_region
       FROM public.board_reactions WHERE post_id = $1 AND cancelled_at IS NULL`,
      [US_POST]
    );
    const usCancel = await client.query(
      `SELECT public.toggle_board_reaction('POST', $1, 'DISLIKE', 'CENTRAL', 'EARTH', 'CENTRAL') AS result`,
      [US_POST]
    );
    let blankCode = '';
    try {
      await client.query(
        `SELECT public.toggle_board_reaction('POST', $1, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL')`,
        [BLANK_POST]
      );
    } catch (err) {
      blankCode = String(err && err.message || err);
    }
    const kept = await client.query(`SELECT score FROM public.user_alignment_state WHERE user_id = $1`, [B]);
    lines.push(line(
      krLike.rows[0].result.action === 'CREATED' && Number(krScore.rows[0].actor_score) === 7.5 && krScore.rows[0].activity_region === 'KR' &&
      usDislike.rows[0].result.action === 'CREATED' && usScore.rows[0].actor_score == null && usScore.rows[0].target_score == null &&
      usScore.rows[0].activity_region === 'US' && usCancel.rows[0].result.action === 'CANCELLED' &&
      blankCode.indexOf('COUNTRY_REQUIRED') >= 0 && Number(kept.rows[0].score) === 7.5,
      '5-kr-score-copied-us-score-null-blank-rejected'
    ));

    const krFollow = await client.query(
      `SELECT public.record_user_follow_with_context($1, $2, 'KR', 'pioneer', false) AS result`,
      [A, B]
    );
    const usFollow = await client.query(
      `SELECT public.record_user_follow_with_context($1, $2, 'US', 'central', false) AS result`,
      [A, B]
    );
    const follows = await client.query(
      `SELECT activity_region FROM public.user_follows
       WHERE follower_user_id = $1 AND following_user_id = $2 AND cancelled_at IS NULL
       ORDER BY activity_region`,
      [A, B]
    );
    lines.push(line(
      krFollow.rows[0].result.status === 'FOLLOWED' && usFollow.rows[0].result.status === 'FOLLOWED' &&
      follows.rows.length === 2,
      '6-follow-rows-stay-in-each-country'
    ));

    const repo = createActivityRegionPgRepository({
      query: function (text, params) { return client.query(text, params); },
    });
    const comment = await repo.createComment({
      postId: KR_POST,
      authorUserId: A,
      territory: 'CENTRAL',
      content: '한국 댓글',
      activityRegion: 'KR',
    });
    const krList = await repo.listPosts({ countryStructure: true, activityRegion: 'KR', status: 'ACTIVE', q: 'US post' });
    const usList = await repo.listPosts({ countryStructure: true, activityRegion: 'US', status: 'ACTIVE', q: 'US post' });
    const service = createBoardService({ repository: repo, operational: true, countryStructure: true });
    const popular = await service.listPopularPosts({ activityRegion: 'KR' }, { territory: 'CENTRAL', limit: 5, nowMs: Date.now() });
    const popularIds = (popular.posts || []).map(function (post) { return post.id; });
    lines.push(line(
      comment && comment.activityRegion === 'KR' &&
      krList.length === 0 && usList.length === 1 && usList[0].id === US_POST &&
      popularIds.indexOf(KR_POST) >= 0 && popularIds.indexOf(US_POST) < 0 && popularIds.indexOf(BLANK_POST) < 0,
      '7-list-search-popular-and-comment'
    ));

    await client.query(`SELECT public.grant_country_achievement($1, 'KR', 'beta-citizen')`, [B]);
    await client.query(`SELECT public.grant_country_achievement($1, 'US', 'beta-citizen')`, [B]);
    const achievements = await client.query(
      `SELECT activity_region, achievement_key FROM public.user_activity_region_achievement
       WHERE user_id = $1 ORDER BY activity_region`,
      [B]
    );
    lines.push(line(
      achievements.rows.length === 2 &&
      achievements.rows[0].activity_region === 'KR' && achievements.rows[1].activity_region === 'US',
      '8-achievement-ledger-per-country'
    ));

    await client.query('DROP TRIGGER IF EXISTS board_reactions_same_activity_region ON public.board_reactions');
    await client.query('ALTER TABLE public.board_posts DROP COLUMN activity_region');
    await client.query('ALTER TABLE public.board_comments DROP COLUMN activity_region');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [C]);
    await client.query(
      `SELECT public.toggle_board_reaction('POST', $1, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL')`,
      [KR_POST]
    );
    const legacy = await client.query(
      `SELECT actor_alignment_score_at_reaction AS actor_score
       FROM public.board_reactions
       WHERE post_id = $1 AND actor_user_id = $2 AND cancelled_at IS NULL`,
      [KR_POST, C]
    );
    lines.push(line(legacy.rows.length === 1 && Number(legacy.rows[0].actor_score) === 0, '9-legacy-without-column-keeps-zero'));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    if (client) {
      try { await client.end(); } catch (_e) { /* 닫기 */ }
    }
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
  process.stdout.write('DB ' + dbName + (failed.length ? ' FAIL then dropped\n' : ' applied and dropped\n'));
  process.stdout.write(failed.length ? 'RESULT FAIL\n' : 'RESULT PASS\n');
  if (failed.length) process.exit(1);
}

main().catch(function (err) {
  process.stdout.write('FAIL runner ' + String(err && err.stack || err) + '\n');
  process.exit(1);
});
