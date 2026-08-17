#!/usr/bin/env node
'use strict';
/**
 * Development DB: board LIKE snapshot from user_alignment_state.
 * Does not change real member scores. Fixture users only. Production refused.
 *
 *   node tools/verify-board-alignment-score-snapshot-live.js --confirm-dev-db
 *   node tools/verify-board-alignment-score-snapshot-live.js --confirm-dev-db --serve
 */

require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { createBoardService } = require('../server/board-service');
const { createBoardSupabaseRepository } = require('../server/board-supabase-repository');
const { createCanonicalUserContextAdapter } = require('../server/board-user-context-adapter');
const { createBoardRouter } = require('../server/board-routes');
const { getCanonicalUserAlignmentScore } = require('../server/canonical-user-territory-service');
const { resolveSupabaseServerAuthConfig } = require('../server/supabase-server-auth-config');

const MARKER = 'SC_ALIGN_SNAP_VERIFY';
const PORT = Number(process.env.ALIGN_SNAP_VERIFY_PORT || 3022);
const PASSWORD = 'AlignSnap!2026a';
const EMAILS = {
  actor: 'sc.align.snap.actor@example.com',
  author: 'sc.align.snap.author@example.com',
  fresh: 'sc.align.snap.fresh@example.com',
};

function argHas(flag) {
  return process.argv.indexOf(flag) !== -1;
}

function fail(code, extra) {
  const err = new Error(code);
  err.code = code;
  if (extra) err.extra = extra;
  throw err;
}

function userClient(authCfg, token) {
  return createClient(authCfg.url, authCfg.key, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function ensureUser(admin, email) {
  const created = await admin.auth.admin.createUser({
    email: email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { test: MARKER },
  });
  if (created.data && created.data.user && created.data.user.id) {
    return { id: created.data.user.id, created: true, email: email };
  }
  const msg = String((created.error && created.error.message) || '');
  if (!/already|registered|exists/i.test(msg)) fail('FIXTURE_USER_CREATE_FAILED', msg);
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = ((listed.data && listed.data.users) || []).find(function (u) {
    return String(u.email || '').toLowerCase() === email.toLowerCase();
  });
  if (!found) fail('FIXTURE_USER_LOOKUP_FAILED', email);
  await admin.auth.admin.updateUserById(found.id, { password: PASSWORD, email_confirm: true });
  return { id: found.id, created: false, email: email };
}

async function signIn(authCfg, email) {
  const anon = createClient(authCfg.url, authCfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const res = await anon.auth.signInWithPassword({ email: email, password: PASSWORD });
  if (res.error || !res.data || !res.data.session) fail('SIGNIN_FAILED', res.error && res.error.message);
  return res.data.session.access_token;
}

async function upsertScore(admin, userId, score) {
  const { error } = await admin.from('user_alignment_state').upsert(
    {
      user_id: userId,
      score: score,
      previous_signal: 0,
    },
    { onConflict: 'user_id' }
  );
  if (error) fail('ALIGNMENT_UPSERT_FAILED', error.message);
}

async function deleteScore(admin, userId) {
  await admin.from('user_alignment_state').delete().eq('user_id', userId);
}

async function readReaction(admin, actorId, postId) {
  const { data, error } = await admin
    .from('board_reactions')
    .select(
      'id, actor_user_id, target_author_user_id, reaction_type, actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction, cancelled_at'
    )
    .eq('actor_user_id', actorId)
    .eq('post_id', postId)
    .is('cancelled_at', null)
    .maybeSingle();
  if (error) fail('REACTION_READ_FAILED', error.message);
  return data;
}

function boardForToken(authCfg, token) {
  return createBoardService({
    repository: createBoardSupabaseRepository({ client: userClient(authCfg, token) }),
    userContext: createCanonicalUserContextAdapter(),
    operational: true,
  });
}

async function cleanup(admin, ids, postIds) {
  let i;
  for (i = 0; i < postIds.length; i++) {
    await admin.from('board_reactions').delete().eq('post_id', postIds[i]);
    await admin.from('board_comments').delete().eq('post_id', postIds[i]);
    await admin.from('board_posts').delete().eq('id', postIds[i]);
  }
  for (i = 0; i < ids.length; i++) {
    await deleteScore(admin, ids[i]);
    await admin.from('board_posts').delete().eq('author_user_id', ids[i]);
    try {
      await admin.auth.admin.deleteUser(ids[i]);
    } catch (_) {}
  }
}

async function main() {
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.log(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }
  if (!argHas('--confirm-dev-db')) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED' }));
    process.exit(1);
  }

  const authCfg = resolveSupabaseServerAuthConfig();
  if (!authCfg.configured) fail('SUPABASE_NOT_CONFIGURED');
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) fail('SERVICE_ROLE_REQUIRED');
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const actor = await ensureUser(admin, EMAILS.actor);
  const author = await ensureUser(admin, EMAILS.author);
  const fresh = await ensureUser(admin, EMAILS.fresh);
  const ids = [actor.id, author.id, fresh.id];
  const postIds = [];

  try {
    await upsertScore(admin, actor.id, 120);
    await upsertScore(admin, author.id, -80);
    await deleteScore(admin, fresh.id);

    const jsActor = await getCanonicalUserAlignmentScore(actor.id);
    const jsAuthor = await getCanonicalUserAlignmentScore(author.id);
    const jsFresh = await getCanonicalUserAlignmentScore(fresh.id);
    if (jsActor !== 120) fail('JS_ACTOR_SCORE', jsActor);
    if (jsAuthor !== -80) fail('JS_AUTHOR_SCORE', jsAuthor);
    if (jsFresh !== 0) fail('JS_FRESH_SCORE', jsFresh);

    const authorToken = await signIn(authCfg, EMAILS.author);
    const actorToken = await signIn(authCfg, EMAILS.actor);
    const freshToken = await signIn(authCfg, EMAILS.fresh);

    const authorBoard = boardForToken(authCfg, authorToken);
    const created = await authorBoard.createPost(
      { userId: author.id, supabase: userClient(authCfg, authorToken) },
      { title: MARKER + ' post', content: MARKER + ' fixture content body' }
    );
    const postId = created && created.post && created.post.id;
    if (!postId) fail('POST_CREATE_FAILED');
    postIds.push(postId);

    const actorBoard = boardForToken(authCfg, actorToken);
    const rx = await actorBoard.toggleReaction(
      { userId: actor.id, supabase: userClient(authCfg, actorToken) },
      { targetType: 'POST', targetId: postId, reactionType: 'LIKE' }
    );
    if (!rx || rx.action !== 'CREATED') fail('LIKE_CREATE_FAILED', rx && rx.action);

    const row = await readReaction(admin, actor.id, postId);
    if (!row) fail('REACTION_ROW_MISSING');
    const actorSnap = Number(row.actor_alignment_score_at_reaction);
    const authorSnap = Number(row.target_author_alignment_score_at_reaction);
    if (actorSnap !== 120) fail('ACTOR_SNAPSHOT', actorSnap);
    if (authorSnap !== -80) fail('AUTHOR_SNAPSHOT', authorSnap);
    if (String(row.actor_user_id) !== actor.id) fail('ACTOR_ID_MISMATCH');
    if (String(row.target_author_user_id) !== author.id) fail('AUTHOR_ID_MISMATCH');

    await upsertScore(admin, actor.id, 300);
    await upsertScore(admin, author.id, -250);
    const after = await readReaction(admin, actor.id, postId);
    if (Number(after.actor_alignment_score_at_reaction) !== 120) fail('SNAPSHOT_MUTATED_ACTOR');
    if (Number(after.target_author_alignment_score_at_reaction) !== -80) fail('SNAPSHOT_MUTATED_AUTHOR');

    const cancel = await actorBoard.toggleReaction(
      { userId: actor.id, supabase: userClient(authCfg, actorToken) },
      { targetType: 'POST', targetId: postId, reactionType: 'LIKE' }
    );
    if (!cancel || cancel.action !== 'CANCELLED') fail('CANCEL_FAILED', cancel && cancel.action);
    const gone = await readReaction(admin, actor.id, postId);
    if (gone) fail('CANCELLED_STILL_ACTIVE');

    const dislike = await actorBoard.toggleReaction(
      { userId: actor.id, supabase: userClient(authCfg, actorToken) },
      { targetType: 'POST', targetId: postId, reactionType: 'DISLIKE' }
    );
    if (!dislike || dislike.action !== 'CREATED') fail('DISLIKE_CREATE_FAILED');
    const dislikeRow = await admin
      .from('board_reactions')
      .select('reaction_type, actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction, cancelled_at')
      .eq('actor_user_id', actor.id)
      .eq('post_id', postId)
      .eq('reaction_type', 'DISLIKE')
      .is('cancelled_at', null)
      .maybeSingle();
    if (dislikeRow.error || !dislikeRow.data) fail('DISLIKE_ROW');
    if (Number(dislikeRow.data.actor_alignment_score_at_reaction) !== 300) fail('DISLIKE_ACTOR_SNAP');
    if (Number(dislikeRow.data.target_author_alignment_score_at_reaction) !== -250) fail('DISLIKE_AUTHOR_SNAP');

    const freshBoard = boardForToken(authCfg, freshToken);
    const freshRx = await freshBoard.toggleReaction(
      { userId: fresh.id, supabase: userClient(authCfg, freshToken) },
      { targetType: 'POST', targetId: postId, reactionType: 'LIKE' }
    );
    if (!freshRx || freshRx.action !== 'CREATED') fail('FRESH_LIKE_FAILED');
    const freshRow = await readReaction(admin, fresh.id, postId);
    if (!freshRow || Number(freshRow.actor_alignment_score_at_reaction) !== 0) fail('FRESH_SNAPSHOT', freshRow);

    const report = {
      ok: true,
      marker: MARKER,
      actorSnapshot: actorSnap,
      authorSnapshot: authorSnap,
      dislikeActorSnapshot: Number(dislikeRow.data.actor_alignment_score_at_reaction),
      dislikeAuthorSnapshot: Number(dislikeRow.data.target_author_alignment_score_at_reaction),
      freshSnapshot: Number(freshRow.actor_alignment_score_at_reaction),
      postId: postId,
      actorId: actor.id,
      authorId: author.id,
    };

    if (argHas('--serve')) {
      const app = express();
      app.use(express.json());
      app.use(
        '/api/board',
        createBoardRouter({
          supabaseUrl: authCfg.url,
          supabaseAnonKey: authCfg.key,
          createUserClient: function (token) {
            return userClient(authCfg, token);
          },
          operational: true,
          userContext: createCanonicalUserContextAdapter(),
        })
      );
      app.get('/', function (req, res) {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(
          '<!doctype html><meta charset="utf-8"><title>align snap verify</title>' +
            '<p id="status">ready</p>' +
            '<button id="like-btn" type="button">LIKE</button>' +
            '<pre id="out"></pre>' +
            '<script>(function(){' +
            'var token=' +
            JSON.stringify(actorToken) +
            ';var postId=' +
            JSON.stringify(postId) +
            ';' +
            'document.getElementById("like-btn").onclick=function(){' +
            'fetch("/api/board/reactions/toggle",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({targetType:"POST",targetId:postId,reactionType:"LIKE"})}).then(function(r){return r.json().then(function(j){return {status:r.status,j:j};});}).then(function(pack){document.getElementById("out").textContent=JSON.stringify(pack);document.getElementById("status").textContent=pack.j&&pack.j.ok!==false?"ok":"err";}).catch(function(e){document.getElementById("status").textContent="err";document.getElementById("out").textContent=String(e);});' +
            '};' +
            '})();</script>'
        );
      });
      const server = app.listen(PORT, '127.0.0.1', function () {
        console.log(JSON.stringify(Object.assign({ serve: true, url: 'http://127.0.0.1:' + PORT + '/' }, report)));
      });
      process.on('SIGINT', function () {
        server.close();
        cleanup(admin, ids, postIds).then(function () {
          process.exit(0);
        });
      });
      return;
    }

    await cleanup(admin, ids, postIds);
    console.log(JSON.stringify(report));
  } catch (e) {
    try {
      await cleanup(admin, ids, postIds);
    } catch (_) {}
    console.log(
      JSON.stringify({
        ok: false,
        error: (e && e.code) || (e && e.message) || String(e),
        extra: e && e.extra,
      })
    );
    process.exit(1);
  }
}

main();
