#!/usr/bin/env node
'use strict';

/**
 * first-post live smoke: insert canonical board_posts → evaluator grant
 * Creates a throwaway auth user, then deletes it.
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const persist = require('../server/achievement-persist-service');
const evaluator = require('../server/achievement-evaluator-service');

(async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'NO_SERVICE_ROLE' }));
    process.exit(2);
  }
  persist.resetAdminClientForTests();
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let userId = null;
  let postId = null;
  try {
    const email = 'first-post-smoke-' + Date.now() + '@example.com';
    const created = await sb.auth.admin.createUser({
      email: email,
      email_confirm: true,
      user_metadata: { test: 'first-post-canonical' },
    });
    userId = created.data && created.data.user && created.data.user.id;
    if (!userId) throw created.error || new Error('createUser failed');

    const ins = await sb
      .from('board_posts')
      .insert({
        author_user_id: userId,
        territory: 'CENTRAL',
        title: 'smoke first post',
        content: 'canonical first-post evaluator smoke',
      })
      .select('id')
      .single();
    if (ins.error) throw ins.error;
    postId = ins.data.id;

    const first = await evaluator.evaluateAfterPostCreated(userId);
    const keys = (first.granted || []).map(function (g) {
      return g.achievementKey || (g.record && g.record.achievementId);
    });
    const owned = await persist.listAchievementsForUser(userId);
    const row = owned.find(function (r) { return r.achievementId === 'first-post'; });

    const second = await evaluator.evaluateAfterPostCreated(userId);
    const secondKeys = (second.granted || []).map(function (g) {
      return g.achievementKey || (g.record && g.record.achievementId);
    });
    const owned2 = await persist.listAchievementsForUser(userId);
    const row2 = owned2.find(function (r) { return r.achievementId === 'first-post'; });

    const ok =
      first.ok === true &&
      keys.indexOf('first-post') !== -1 &&
      !!row &&
      secondKeys.indexOf('first-post') === -1 &&
      owned2.filter(function (r) { return r.achievementId === 'first-post'; }).length === 1 &&
      row2 &&
      row2.acquiredAt === row.acquiredAt &&
      row2.acquisitionSequence === row.acquisitionSequence;

    console.log(
      JSON.stringify({
        ok: ok,
        firstGranted: keys,
        secondGranted: secondKeys,
        acquiredAt: row && row.acquiredAt,
        sequence: row && row.acquisitionSequence,
        duplicateUnchanged: !!(row && row2 && row.acquiredAt === row2.acquiredAt),
      }),
    );
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 400) }));
    process.exit(1);
  } finally {
    try {
      if (userId) {
        await sb.from('user_achievements').delete().eq('user_id', userId);
        await sb.from('board_posts').delete().eq('author_user_id', userId);
        await sb.auth.admin.deleteUser(userId);
      }
    } catch (_) {}
  }
})();
