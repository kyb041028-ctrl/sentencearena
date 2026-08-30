#!/usr/bin/env node
'use strict';
/**
 * Production disposable verify: board post XP +25 + first-post.
 *
 *   railway run --service sentencearena node tools/verify-achievement-first-post-live.js --confirm-production
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const BASE = 'https://sentencearena.com';
const PASSWORD = 'AchLive!2026a';
const stamp = Date.now();
const EMAIL = 'sc.ach.firstpost.' + stamp + '@example.com';

function argHas(flag) {
  return process.argv.indexOf(flag) !== -1;
}

async function httpJson(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_) {}
  return { status: res.status, json: json, raw: raw.slice(0, 800) };
}

async function main() {
  if (!argHas('--confirm-production')) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED' }));
    process.exit(1);
  }

  const url = String(process.env.SUPABASE_URL || '').trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !service) {
    console.log(JSON.stringify({ ok: false, error: 'NO_CREDS' }));
    process.exit(1);
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const beforeProfiles = await admin.from('profiles').select('id', { count: 'exact', head: true });
  const beforeAch = await admin.from('user_achievements').select('achievement_key', { count: 'exact', head: true });

  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { test: 'achievement-first-post-live' },
  });
  if (!created.data || !created.data.user) {
    throw new Error('CREATE_USER_FAILED ' + ((created.error && created.error.message) || ''));
  }
  const userId = created.data.user.id;

  const anonCfg = await httpJson('GET', '/api/supabase-config');
  const anon = createClient(anonCfg.json.url, anonCfg.json.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (!signed.data || !signed.data.session) {
    throw new Error('SIGNIN_FAILED');
  }
  const token = signed.data.session.access_token;

  await httpJson('POST', '/api/me/legal/age-confirm', token, { year: 1990, month: 1, day: 15 });
  await httpJson('POST', '/api/me/legal/sensitive-consent', token, {
    consented: true,
    territoryDisclosureConsented: true,
    policyVersion: 'sensitive-political-v1',
    territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
  });
  // re-sign after legal (some gates refresh claims)
  const signed2 = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const token2 = signed2.data.session.access_token;

  const prog0 = await httpJson('GET', '/api/me/profile', token2);
  const xp0 = Number((prog0.json && prog0.json.xp) || 0);
  const level0 = Number((prog0.json && prog0.json.level) || 1);

  const postRes = await httpJson('POST', '/api/board/posts', token2, {
    title: '업적 연결 검증 글 ' + stamp,
    content: 'Production disposable first-post / XP 검증용 게시글입니다. 자동 정리됩니다.',
    isAnonymous: false,
  });

  const postOk = postRes.status === 201 || postRes.status === 200;
  const progression = postRes.json && postRes.json.progression;
  const granted = postRes.json && postRes.json.newlyGrantedAchievements;
  const postId = postRes.json && postRes.json.post && postRes.json.post.id;

  const achList = await httpJson('GET', '/api/users/me/achievements', token2);
  const owned =
    (achList.json && achList.json.data && achList.json.data.currentAchievements) ||
    (achList.json && achList.json.currentAchievements) ||
    [];
  const hasFirst = owned.some(function (r) {
    return r && (r.achievementId === 'first-post' || r.achievementKey === 'first-post');
  }) || (granted || []).some(function (g) {
    const id = g && (g.achievementId || (g.record && g.record.achievementId));
    return id === 'first-post';
  });

  let notifiedOk = null;
  const firstRec =
    owned.find(function (r) {
      return r && (r.achievementId === 'first-post' || r.achievementKey === 'first-post');
    }) ||
    ((granted || []).map(function (g) { return g && g.record ? g.record : g; }).find(function (r) {
      return r && r.achievementId === 'first-post';
    }));
  if (firstRec && firstRec.acquisitionSequence) {
    const mark = await httpJson('POST', '/api/users/me/achievements/notified', token2, {
      achievementId: 'first-post',
      acquisitionSequence: firstRec.acquisitionSequence,
    });
    notifiedOk = mark.status < 400 && mark.json && mark.json.ok !== false;
  }

  const prog1 = await httpJson('GET', '/api/me/profile', token2);

  // cleanup disposable only
  if (postId) {
    await httpJson('DELETE', '/api/board/posts/' + encodeURIComponent(postId), token2);
  }
  await admin.from('user_achievements').delete().eq('user_id', userId);
  await admin.from('user_featured_achievements').delete().eq('user_id', userId);
  await admin.from('user_progression_events').delete().eq('user_id', userId);
  await admin.from('user_progression').delete().eq('user_id', userId);
  await admin.from('board_posts').delete().eq('author_user_id', userId);
  await admin.from('profiles').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);

  const afterProfiles = await admin.from('profiles').select('id', { count: 'exact', head: true });
  const afterAch = await admin.from('user_achievements').select('achievement_key', { count: 'exact', head: true });

  const report = {
    ok: true,
    email: EMAIL,
    userIdPrefix: String(userId).slice(0, 8),
    beforeXp: xp0,
    beforeLevel: level0,
    postStatus: postRes.status,
    postOk: postOk,
    progression: progression,
    xpPlus25: progression && Number(progression.xp) === Number(xp0 || 0) + 25,
    newlyGrantedKeys: (granted || []).map(function (g) {
      return (g && (g.achievementId || (g.record && g.record.achievementId))) || null;
    }).filter(Boolean),
    achievementsListOk: achList.status < 400 && achList.json && achList.json.ok !== false,
    hasFirstPost: hasFirst,
    notifiedOk: notifiedOk,
    afterXp: prog1.json && prog1.json.xp,
    profilesBefore: beforeProfiles.count,
    profilesAfter: afterProfiles.count,
    achievementsBefore: beforeAch.count,
    achievementsAfter: afterAch.count,
    residualProfiles: beforeProfiles.count !== afterProfiles.count,
    residualAchievements: beforeAch.count !== afterAch.count,
    postError: postOk ? null : (postRes.json && postRes.json.error) || postRes.raw,
  };

  report.pass =
    report.postOk &&
    report.xpPlus25 &&
    report.hasFirstPost &&
    report.achievementsListOk &&
    !report.residualProfiles &&
    !report.residualAchievements;

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
