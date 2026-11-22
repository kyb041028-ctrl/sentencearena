'use strict';

/**
 * 정치성향 사본과 국가 없는 반응. 격리 Postgres만.
 * node tools/test-alignment-reaction-copy.js
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createBoardService } = require('../server/board-service');
const { createBoardRouter } = require('../server/board-routes');
const { createCanonicalUserContextAdapter } = require('../server/board-user-context-adapter');
const { createActivityRegionPgRepository } = require('../server/activity-region-pg-repository');
const { createCountryProgressionStore } = require('../server/country-progression-store');
const { createLegalGateService } = require('../server/legal-gate-service');
const regionCore = require('../shared/activity-region-core');
const batchCore = require('../shared/alignment-batch-core');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function line(ok, name, detail) {
  return (ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : '');
}

function request(app, method, pathName, headers, bodyObj) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      const payload = bodyObj != null ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
      const hdrs = Object.assign({}, headers || {});
      if (payload) {
        hdrs['Content-Type'] = 'application/json';
        hdrs['Content-Length'] = String(payload.length);
      }
      const req = require('http').request({
        hostname: '127.0.0.1', port: port, path: pathName, method: method, headers: hdrs,
      }, function (res) {
        let raw = '';
        res.on('data', function (chunk) { raw += chunk; });
        res.on('end', function () {
          server.close();
          let body = null;
          try { body = JSON.parse(raw); } catch (_) { body = raw; }
          resolve({ status: res.statusCode, body: body });
        });
      });
      req.on('error', function () { server.close(); resolve({ status: 0, body: null }); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function main() {
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN alignment-reaction-copy: pg module missing\n');
    process.exit(0);
  }
  const adminDb = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await adminDb.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN alignment-reaction-copy: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }

  const dbName = 'align_reaction_copy_' + process.pid;
  const lines = [];
  let client;
  const counts = { alignment: 0 };
  async function query(sql, params) {
    if (String(sql).indexOf('user_alignment_state') !== -1) counts.alignment += 1;
    return client.query(sql, params);
  }

  try {
    await adminDb.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE FUNCTION public.country_level_from_xp(score bigint) RETURNS integer
      LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;
      CREATE TABLE public.user_alignment_state (
        user_id uuid PRIMARY KEY,
        score numeric
      );
      CREATE TABLE public.alignment_history (
        history_id text PRIMARY KEY,
        user_id uuid
      );
      CREATE TABLE public.alignment_territory_history (
        history_id text PRIMARY KEY,
        user_id uuid,
        reason text
      );
      CREATE TABLE public.user_legal_consents (
        user_id uuid PRIMARY KEY,
        sensitive_political_consented_at timestamptz,
        sensitive_political_policy_version text,
        territory_disclosure_consented_at timestamptz,
        territory_disclosure_policy_version text,
        political_profile_visibility text,
        updated_at timestamptz
      );
      CREATE TABLE public.user_activity_region_legal_consents (
        user_id uuid NOT NULL,
        activity_region text NOT NULL,
        sensitive_political_consented_at timestamptz,
        sensitive_political_policy_version text,
        territory_disclosure_consented_at timestamptz,
        territory_disclosure_policy_version text,
        terms_consented_at timestamptz,
        terms_document_version text,
        privacy_acknowledged_at timestamptz,
        privacy_document_version text,
        privacy_processing_consent_at timestamptz,
        age_requirement_confirmed_at timestamptz,
        age_policy_version text,
        marketing_opt_in boolean,
        marketing_withdrawn_at timestamptz,
        sensitive_applies_to text,
        territory_disclosure_applies_to text,
        updated_at timestamptz,
        PRIMARY KEY (user_id, activity_region)
      );
      CREATE TABLE public.user_activity_region_profile (
        user_id uuid NOT NULL,
        activity_region text NOT NULL,
        territory text,
        xp bigint NOT NULL DEFAULT 0,
        level integer NOT NULL DEFAULT 1,
        reputation_score bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, activity_region)
      );
      CREATE TABLE public.country_progression_grants (
        dedupe_key text PRIMARY KEY,
        user_id uuid,
        activity_region text,
        xp_delta bigint,
        fame_delta bigint
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
        status text DEFAULT 'ACTIVE'
      );
      CREATE TABLE public.board_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid,
        parent_comment_id uuid,
        author_user_id uuid,
        territory text,
        content text,
        is_anonymous boolean,
        activity_region text,
        status text DEFAULT 'ACTIVE'
      );
      CREATE TABLE public.board_reactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id uuid,
        target_type text,
        post_id uuid,
        comment_id uuid,
        target_author_user_id uuid,
        reaction_type text,
        reaction_group text,
        audience_scope text,
        actor_territory_at_reaction text,
        target_author_territory_at_reaction text,
        actor_alignment_score_at_reaction numeric,
        target_author_alignment_score_at_reaction numeric,
        activity_region text,
        cancelled_at timestamptz
      );
    `);
    await client.query('INSERT INTO public.user_alignment_state (user_id, score) VALUES ($1, 7.5)', [A]);
    await client.query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory, xp, reputation_score)
       VALUES ($1, 'KR', 'central', 20, 4), ($1, 'US', 'central', 30, 5),
              ($2, 'KR', 'central', 8, 2), ($2, 'US', 'central', 9, 3)`,
      [A, B]
    );
    await client.query(
      `INSERT INTO public.user_legal_consents (user_id, political_profile_visibility) VALUES ($1, 'public')`,
      [A]
    );
    const withdrawSql = fs.readFileSync(path.join(__dirname, '../supabase/migration_sensitive_consent_withdraw_tx_v1.sql'), 'utf8');
    await client.query(withdrawSql.split('REVOKE ALL')[0]);

    const repository = createActivityRegionPgRepository({ query: query });
    const progression = createCountryProgressionStore({ query: query });
    const userContext = createCanonicalUserContextAdapter({ query: query });
    const service = createBoardService({
      repository: repository,
      userContext: userContext,
      operational: true,
      countryProgression: progression,
      countryStructure: true,
    });
    const krActor = { userId: A, activityRegion: 'KR' };
    const usActor = { userId: A, activityRegion: 'US' };
    const krPost = await service.createPost(krActor, { title: '한국 글', content: '한국 본문' });
    const usPost = await service.createPost(usActor, { title: 'US note', content: 'US body' });
    const usPostB = await service.createPost({ userId: B, activityRegion: 'US' }, { title: 'US other', content: 'body' });
    const krComment = await service.createComment(krActor, krPost.post.id, { content: '한국 댓글' });
    const usComment = await service.createComment(usActor, usPost.post.id, { content: 'US reply' });

    const beforeKr = await progression.read(A, 'KR');
    const beforeUs = await progression.read(A, 'US');
    const beforeUsB = await progression.read(B, 'US');
    counts.alignment = 0;
    const krLike = await service.toggleReaction(krActor, {
      targetType: 'POST', targetId: krPost.post.id, reactionType: 'LIKE', activityRegion: 'KR',
    });
    const krReads = counts.alignment;
    const krRow = (await query(
      `SELECT actor_alignment_score_at_reaction::text AS actor, target_author_alignment_score_at_reaction::text AS author, activity_region
       FROM public.board_reactions WHERE post_id = $1 AND reaction_type = 'LIKE' AND cancelled_at IS NULL`,
      [krPost.post.id]
    )).rows[0];
    lines.push(line(
      krLike.action === 'CREATED' && krReads > 0 && krRow && krRow.actor === '7.5' && krRow.author === '7.5' && krRow.activity_region === 'KR',
      '1-kr-like-copies-kr-score',
      'function reads=' + krReads
    ));

    counts.alignment = 0;
    const usLike = await service.toggleReaction(usActor, {
      targetType: 'POST', targetId: usPost.post.id, reactionType: 'LIKE', activityRegion: 'US',
    });
    const usReads = counts.alignment;
    const usRow = (await query(
      `SELECT actor_alignment_score_at_reaction AS actor, target_author_alignment_score_at_reaction AS author, activity_region
       FROM public.board_reactions WHERE post_id = $1 AND reaction_type = 'LIKE' AND cancelled_at IS NULL`,
      [usPost.post.id]
    )).rows[0];
    lines.push(line(
      usLike.action === 'CREATED' && usReads === 0 && usRow && usRow.actor == null && usRow.author == null && String(usRow.actor) !== '0',
      '2-us-like-does-not-read-or-copy-7.5',
      'function reads=' + usReads
    ));
    lines.push(line(
      usRow && usRow.actor == null && usRow.author == null && usRow.activity_region === 'US',
      '3-us-like-score-is-null-not-zero',
      'function'
    ));

    const usDislike = await service.toggleReaction(usActor, {
      targetType: 'POST', targetId: usPost.post.id, reactionType: 'DISLIKE', activityRegion: 'US',
    });
    const usCancel = await service.toggleReaction(usActor, {
      targetType: 'POST', targetId: usPost.post.id, reactionType: 'LIKE', activityRegion: 'US',
    });
    const usCommentLike = await service.toggleReaction(usActor, {
      targetType: 'COMMENT', targetId: usComment.comment.id, reactionType: 'LIKE', activityRegion: 'US',
    });
    const krCommentLike = await service.toggleReaction(krActor, {
      targetType: 'COMMENT', targetId: krComment.comment.id, reactionType: 'LIKE', activityRegion: 'KR',
    });
    const commentRows = await query(
      `SELECT activity_region, actor_alignment_score_at_reaction AS actor FROM public.board_reactions WHERE comment_id IS NOT NULL`
    );
    const usCommentRow = commentRows.rows.filter(function (row) { return row.activity_region === 'US'; })[0];
    const krCommentRow = commentRows.rows.filter(function (row) { return row.activity_region === 'KR'; })[0];
    lines.push(line(
      usDislike.action === 'CREATED' && usCancel.action === 'CANCELLED' &&
      usCommentLike.action === 'CREATED' && usCommentRow && usCommentRow.actor == null &&
      krCommentLike.action === 'CREATED' && krCommentRow && String(krCommentRow.actor) === '7.5',
      '4-us-like-dislike-cancel-and-comment',
      'function ' + [usDislike.action, usCancel.action, usCommentLike.action, krCommentLike.action, JSON.stringify(commentRows.rows)].join(' ')
    ));

    counts.alignment = 0;
    const empathy = await service.receivePostEmpathy(usActor, usPostB.post.id);
    const afterKr = await progression.read(A, 'KR');
    const afterUs = await progression.read(A, 'US');
    const afterUsB = await progression.read(B, 'US');
    lines.push(line(
      empathy && empathy.granted === true && afterUsB.region === 'US' &&
      (afterUsB.xp !== beforeUsB.xp || afterUsB.fame !== beforeUsB.fame),
      '5-us-empathy-keeps-us-xp-path',
      'function xp ' + beforeUsB.xp + ' to ' + afterUsB.xp + ' fame ' + beforeUsB.fame + ' to ' + afterUsB.fame
    ));
    lines.push(line(
      afterKr.xp === beforeKr.xp && afterKr.fame === beforeKr.fame && afterUs.fame === beforeUs.fame,
      '6-kr-xp-fame-unchanged-by-us-activity',
      'function kr ' + afterKr.xp + '/' + afterKr.fame
    ));

    const weights = batchCore.getAlignmentBatchProcessorConfig().reactionWeights;
    const explicit = regionCore.selectAlignmentBatch({
      region: 'KR',
      explicitCountryOnly: true,
      users: [{ userId: A, activityRegion: 'KR' }, { userId: A, activityRegion: 'US' }, { userId: A, activityRegion: null }],
      reactions: [
        { id: 'kr', activityRegion: 'KR' },
        { id: 'us', activityRegion: 'US' },
        { id: 'blank', activity_region: null },
      ],
    });
    const legacy = regionCore.selectAlignmentBatch({
      region: 'KR',
      reactions: [
        { id: 'kr', activityRegion: 'KR' },
        { id: 'blank', activity_region: null },
      ],
    });
    lines.push(line(
      weights.sameTerritoryPositive === 70 && explicit.reactions.length === 1 && explicit.reactions[0].id === 'kr' &&
      explicit.users.length === 1,
      '7-kr-analysis-keeps-formula-and-kr-rows',
      'function'
    ));

    await query(
      `INSERT INTO public.board_posts (author_user_id, territory, title, content, activity_region)
       VALUES ($1, 'CENTRAL', '옛 글', '국가 없음', NULL)`,
      [A]
    );
    const blankPost = (await query(
      `SELECT id FROM public.board_posts WHERE title = '옛 글'`
    )).rows[0];
    let blankErr = null;
    try {
      await service.toggleReaction(krActor, {
        targetType: 'POST', targetId: blankPost.id, reactionType: 'LIKE', activityRegion: 'KR',
      });
    } catch (err) { blankErr = err; }
    const blankReactions = await query(
      'SELECT count(*)::int AS n FROM public.board_reactions WHERE post_id = $1',
      [blankPost.id]
    );
    lines.push(line(
      blankErr && blankErr.code === 'COUNTRY_REQUIRED' && blankReactions.rows[0].n === 0,
      '8-new-reaction-without-country-rejected',
      'function'
    ));
    lines.push(line(
      explicit.reactions.every(function (row) { return row.id !== 'blank'; }) &&
      legacy.reactions.some(function (row) { return row.id === 'blank'; }),
      '9-old-blank-reaction-excluded-when-country-structure-on',
      'function legacy-still-counts-blank=' + legacy.reactions.length
    ));

    let mismatchErr = null;
    counts.alignment = 0;
    try {
      await service.toggleReaction(krActor, {
        targetType: 'POST', targetId: usPost.post.id, reactionType: 'LIKE', activityRegion: 'KR',
      });
    } catch (err) { mismatchErr = err; }
    lines.push(line(
      mismatchErr && mismatchErr.code === 'REGION_MISMATCH' && counts.alignment === 0,
      '10a-kr-actor-on-us-post-rejected',
      'function'
    ));

    process.env.SA_TEST_ACTOR_HEADER = '1';
    const app = express();
    app.use(express.json());
    app.use('/api/board', createBoardRouter({
      operational: true,
      pgQuery: query,
      userContext: userContext,
      countryProgression: progression,
      resolveActorFromRequest: async function (req) {
        const id = req.headers['x-user-id'];
        if (!id) return null;
        return { userId: String(id) };
      },
    }));
    const httpUs = await request(app, 'POST', '/api/board/reactions/toggle', {
      'x-user-id': A,
      cookie: 'sa_ar=US; sa_ar_x=1',
    }, { targetType: 'POST', targetId: usPost.post.id, reactionType: 'DISLIKE', activityRegion: 'US' });
    const httpKrCookie = await request(app, 'POST', '/api/board/reactions/toggle', {
      'x-user-id': A,
      cookie: 'sa_ar=KR; sa_ar_x=1',
    }, { targetType: 'POST', targetId: usPost.post.id, reactionType: 'LIKE' });
    const previousEnforce = process.env.LEGAL_GATE_ENFORCE;
    process.env.LEGAL_GATE_ENFORCE = '1';
    const httpConsent = await request(app, 'POST', '/api/board/reactions/toggle', {
      'x-user-id': A,
      cookie: 'sa_ar=US; sa_ar_x=1',
    }, { targetType: 'POST', targetId: usPost.post.id, reactionType: 'LIKE', activityRegion: 'US' });
    if (previousEnforce == null) delete process.env.LEGAL_GATE_ENFORCE;
    else process.env.LEGAL_GATE_ENFORCE = previousEnforce;
    lines.push(line(
      httpUs.status === 200 && httpKrCookie.body && httpKrCookie.body.error === 'REGION_MISMATCH' &&
      httpConsent.body && (httpConsent.body.error === 'AGE_UNVERIFIED' || httpConsent.body.error === 'US_CONSENT_REQUIRED'),
      '10b-http-kr-cookie-mismatch-and-us-age-check',
      'route ' + httpUs.status + ' ' + (httpKrCookie.body && httpKrCookie.body.error) + ' ' + (httpConsent.body && httpConsent.body.error)
    ));

    const scoreBeforeWithdraw = await query('SELECT score::text AS score FROM public.user_alignment_state WHERE user_id = $1', [A]);
    const usXpBeforeWithdraw = await progression.read(B, 'US');
    await query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [A]);
    const afterKrWithdraw = await query('SELECT score FROM public.user_alignment_state WHERE user_id = $1', [A]);
    const usAfterKrWithdraw = await progression.read(B, 'US');
    lines.push(line(
      afterKrWithdraw.rows.length === 0 && usAfterKrWithdraw.xp === usXpBeforeWithdraw.xp,
      '12-kr-withdraw-leaves-us-activity',
      'sql'
    ));
    await query('INSERT INTO public.user_alignment_state (user_id, score) VALUES ($1, 7.5)', [A]);
    await query(
      `INSERT INTO public.user_activity_region_legal_consents (user_id, activity_region, sensitive_political_consented_at)
       VALUES ($1, 'US', now())`,
      [A]
    );
    const gate = createLegalGateService({
      query: query,
      getAdminClient: function () {
        return {
          from: function () {
            const state = { payload: null };
            const api = {
              update: function (payload) { state.payload = payload; return api; },
              eq: function () { return api; },
              select: async function () {
                const cols = Object.keys(state.payload || {});
                const params = cols.map(function (key) { return state.payload[key]; });
                params.push(A);
                await query(
                  'UPDATE public.user_activity_region_legal_consents SET ' +
                    cols.map(function (key, i) { return key + ' = $' + (i + 1); }).join(', ') +
                    ' WHERE user_id = $' + params.length + " AND activity_region = 'US'",
                  params
                );
                return { data: [{ user_id: A }], error: null };
              },
            };
            return api;
          },
        };
      },
    });
    let usWithdrawErr = null;
    try { await gate.withdrawUsSensitiveConsent(A); }
    catch (err) { usWithdrawErr = err; }
    const scoreAfterUsWithdraw = await query('SELECT score::text AS score FROM public.user_alignment_state WHERE user_id = $1', [A]);
    lines.push(line(
      !usWithdrawErr && scoreAfterUsWithdraw.rows[0] && scoreAfterUsWithdraw.rows[0].score === '7.5' &&
      scoreBeforeWithdraw.rows[0].score === '7.5',
      '11-us-withdraw-leaves-kr-alignment',
      'service ' + (usWithdrawErr && (usWithdrawErr.code || usWithdrawErr.message) || '')
    ));

    const copied = await query(
      `SELECT count(*)::int AS n FROM public.board_reactions
       WHERE activity_region = 'US' AND actor_alignment_score_at_reaction = 7.5`
    );
    lines.push(line(copied.rows[0].n === 0, 'us-rows-never-store-7.5', 'sql'));
  } finally {
    if (client) await client.end().catch(function () {});
    await adminDb.query('DROP DATABASE IF EXISTS ' + dbName).catch(function () {});
    await adminDb.end().catch(function () {});
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
