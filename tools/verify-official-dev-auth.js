#!/usr/bin/env node
'use strict';

// Real DEV Auth, isolated Daily Issue fixtures. Never loads .env or service-role keys.
// Supply JSON {url,publishableKey,testEmail,testPassword} through stdin.
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { requireAuthenticatedUser } = require('../server/auth/require-authenticated-user');
const { createTestApp, makeReady, authHeaders } = require('./daily-issue-api-test-fixtures');
const { requestApp } = require('./daily-issue-api-http-helper');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const config = JSON.parse(input);
  assert.equal(config.url, 'https://wzpreuseuiuzwpoqqckr.supabase.co');
  assert.match(config.publishableKey, /^sb_publishable_/);
  assert.match(config.testEmail, /^dev-auth-check-.*@sentencearena\.test$/);
  assert.notEqual(process.env.NODE_ENV, 'production');
  // Fail closed: the fixture harness uses development-only, local legal/moderation stores.
  assert.notEqual(process.env.LEGAL_GATE_ENFORCE, '1');
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = await client.auth.signInWithPassword({ email: config.testEmail, password: config.testPassword });
  assert.ifError(login.error);
  const token = login.data.session.access_token;
  assert(!['ADMIN', 'OWNER'].includes(login.data.user.app_metadata.role));
  const authConfig = { url: config.url, key: config.publishableKey };
  const { app, repo } = createTestApp({
    resolveActorFromRequest: async (req, res) => {
      const result = await requireAuthenticatedUser(req, res, authConfig);
      return result.ok ? { userId: result.user.id, supabase: result.supabase } : null;
    },
  });
  const issue = makeReady('official_dev_auth_' + Date.now());
  repo.insertReviewItems([issue], [], {});
  // Fixture setup uses the existing test-only admin guard; the DEV user remains a member.
  let r = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + issue.id + '/approve', {
    headers: authHeaders(), body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1 },
  });
  assert.equal(r.status, 200);
  r = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + issue.id + '/publish', {
    headers: authHeaders(), body: { expectedStatus: 'APPROVED', expectedLockVersion: r.body.data.item.lockVersion },
  });
  assert.equal(r.status, 200);
  const base = '/api/daily-issues/' + issue.id;
  const headers = { Authorization: 'Bearer ' + token };
  let commentId;
  try {
    for (const authorization of [null, 'Bearer invalid-dev-token']) {
      r = await requestApp(app, 'POST', base + '/comments', {
        headers: authorization ? { Authorization: authorization } : {}, body: { body: 'must reject' },
      });
      assert.equal(r.status, 401);
    }
    console.log('PASS guest and invalid JWT rejected');
    r = await requestApp(app, 'POST', base + '/comments', { headers, body: { body: 'Official DEV Auth isolated smoke test' } });
    assert.equal(r.status, 201);
    commentId = r.body.data.item.id;
    r = await requestApp(app, 'GET', base + '/comments', { headers });
    assert(r.body.data.items.some(x => x.id === commentId));
    console.log('PASS real DEV password login, getUser, comment create/read');
    for (const active of [true, false]) {
      r = await requestApp(app, 'POST', base + '/reactions/toggle', { headers, body: { reactionType: 'LIKE' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.active, active);
      r = await requestApp(app, 'GET', base, { headers });
      assert.equal(r.body.data.viewerReaction, active ? 'LIKE' : null);
    }
    console.log('PASS reaction on/off and viewer state');
  } finally {
    if (commentId) {
      r = await requestApp(app, 'DELETE', base + '/comments/' + commentId, { headers });
      assert.equal(r.status, 200);
      r = await requestApp(app, 'GET', base + '/comments', {});
      assert(!r.body.data.items.some(x => x.id === commentId));
    }
    await client.auth.signOut();
  }
  console.log('PASS own fixture comment removed and session signed out');
  console.log('SCOPE: live official DEV Auth; in-memory Daily Issue fixture; no production/remote issue writes');
}
main().catch(() => { console.error('FAIL official DEV auth smoke (credentials suppressed)'); process.exitCode = 1; });

