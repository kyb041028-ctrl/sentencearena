#!/usr/bin/env node
'use strict';
/**
 * Production disposable verify for retention policy.
 * Does not touch protected accounts. Cleans up leftover test rows.
 *
 *   node tools/verify-retention-policy-live.js --confirm-production
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const BASE = 'https://sentencearena.com';
const PASSWORD = 'RetainLive!2026a';
const stamp = Date.now();
const EMAIL_A = 'sc.retain.a.' + stamp + '@example.com';
const EMAIL_B = 'sc.retain.b.' + stamp + '@example.com';

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
  try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
  return { status: res.status, json: json, raw: raw.slice(0, 300) };
}

async function ensureUser(admin, email) {
  const created = await admin.auth.admin.createUser({
    email: email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { test: 'retention-policy-live' },
  });
  if (created.data && created.data.user && created.data.user.id) {
    return created.data.user.id;
  }
  throw new Error('CREATE_USER_FAILED ' + ((created.error && created.error.message) || ''));
}

async function signIn(authCfg, email) {
  const anon = createClient(authCfg.url, authCfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const res = await anon.auth.signInWithPassword({ email: email, password: PASSWORD });
  if (res.error || !res.data || !res.data.session) {
    throw new Error('SIGNIN_FAILED ' + ((res.error && res.error.message) || ''));
  }
  return res.data.session.access_token;
}

async function productionAuthCfg() {
  const cfg = await httpJson('GET', '/api/supabase-config');
  if (!cfg.json || !cfg.json.url || !cfg.json.anonKey) {
    throw new Error('PROD_SUPABASE_CONFIG_FAILED');
  }
  return { url: cfg.json.url, key: cfg.json.anonKey, configured: true };
}

async function completeLegal(token) {
  const age = await httpJson('POST', '/api/me/legal/age-confirm', token, {
    year: 1990,
    month: 1,
    day: 15,
  });
  const cons = await httpJson('POST', '/api/me/legal/sensitive-consent', token, {
    consented: true,
    policyVersion: 'sensitive-political-v1',
  });
  return { ageStatus: age.status, consentStatus: cons.status };
}

async function main() {
  if (!argHas('--confirm-production')) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED' }));
    process.exit(1);
  }
  const url = String(process.env.SUPABASE_URL || '').trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  let authCfg = {
    url: url,
    key: String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
    configured: !!(url && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY)),
  };
  if (!authCfg.configured) authCfg = await productionAuthCfg();
  if (!url || !service) {
    console.log(JSON.stringify({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' }));
    process.exit(2);
  }
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const out = {
    health: null,
    ready: null,
    postDelete: null,
    evidenceAfterDelete: null,
    withdrawA: null,
    profileAfterWithdraw: null,
    evidenceAfterWithdraw: null,
    alignmentAfterWithdraw: null,
    banWithdraw: null,
    rejoinRows: null,
    rejoinHasEmail: null,
    rejoinHasAlignment: null,
    cleaned: false,
  };

  let userA = null;
  let userB = null;
  let postId = null;
  let evidenceId = null;

  try {
    const health = await httpJson('GET', '/health');
    const ready = await httpJson('GET', '/ready');
    out.health = health.json;
    out.ready = ready.json;

    userA = await ensureUser(admin, EMAIL_A);
    userB = await ensureUser(admin, EMAIL_B);
    const tokenA = await signIn(authCfg, EMAIL_A);
    const me = await httpJson('GET', '/api/auth/me', tokenA);
    const legal = await completeLegal(tokenA);
    out.authMe = { status: me.status, error: me.json && me.json.error };
    out.legal = legal;

    const created = await httpJson('POST', '/api/board/posts', tokenA, {
      title: '보관정책 검증용 게시글 제목입니다',
      content: '보관정책 검증용 본문입니다. 충분히 길게 작성합니다.',
    });
    postId = created.json && created.json.post && created.json.post.id;
    if (!postId) throw new Error('POST_CREATE_FAILED ' + created.status + ' ' + created.raw);

    const deleted = await httpJson('DELETE', '/api/board/posts/' + postId, tokenA);
    out.postDelete = {
      status: deleted.status,
      screenStatus: deleted.json && deleted.json.post && deleted.json.post.status,
      hiddenContent: deleted.json && deleted.json.post ? deleted.json.post.content == null : null,
    };

    const ev = await admin
      .from('deleted_content_evidence')
      .select('id, content_kind, body, author_user_id, retention_until, legal_hold')
      .eq('content_kind', 'POST')
      .eq('source_content_id', postId)
      .maybeSingle();
    evidenceId = ev.data && ev.data.id;
    out.evidenceAfterDelete = {
      ok: !!(ev.data && ev.data.body && ev.data.body.indexOf('보관정책 검증용 본문') !== -1),
      authorUserId: ev.data && ev.data.author_user_id,
      retentionUntil: ev.data && ev.data.retention_until,
      hasEmail: JSON.stringify(ev.data || {}).indexOf(EMAIL_A) !== -1,
    };

    const wd = await httpJson('POST', '/api/me/withdraw', tokenA, {
      acknowledged: true,
      policyVersion: 'withdrawal-v1',
    });
    out.withdrawA = { status: wd.status, withdrawn: wd.json && wd.json.withdrawn };

    const profile = await admin.from('profiles').select('id').eq('id', userA).maybeSingle();
    const align = await admin.from('user_alignment_state').select('user_id').eq('user_id', userA).maybeSingle();
    const ev2 = await admin.from('deleted_content_evidence').select('id, author_user_id, body').eq('id', evidenceId).maybeSingle();
    out.profileAfterWithdraw = !(profile.data && profile.data.id);
    out.alignmentAfterWithdraw = !(align.data && align.data.user_id);
    out.evidenceAfterWithdraw = !!(ev2.data && ev2.data.id && ev2.data.author_user_id === userA);

    const tokenB = await signIn(authCfg, EMAIL_B);
    await completeLegal(tokenB);
    await admin.from('user_moderation_state').upsert({
      user_id: userB,
      current_sanction_type: 'PERMANENT_BAN',
      current_sanction_permanent: true,
      current_sanction_status: 'ACTIVE',
      current_sanction_reason_code: 'abuse',
      current_sanction_starts_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    const wdB = await httpJson('POST', '/api/me/withdraw', tokenB, {
      acknowledged: true,
      policyVersion: 'withdrawal-v1',
    });
    out.banWithdraw = { status: wdB.status, withdrawn: wdB.json && wdB.json.withdrawn };
    const blocks = await admin.from('banned_rejoin_blocks').select('*').gte('created_at', new Date(stamp).toISOString());
    const dump = JSON.stringify(blocks.data || []);
    out.rejoinRows = (blocks.data || []).length;
    out.rejoinHasEmail = dump.indexOf(EMAIL_B) !== -1;
    out.rejoinHasAlignment = /alignment|planetPct|progressivePct/.test(dump);

    const ok =
      out.health && out.health.ok !== false &&
      out.postDelete && out.postDelete.status === 200 &&
      out.evidenceAfterDelete && out.evidenceAfterDelete.ok && !out.evidenceAfterDelete.hasEmail &&
      out.withdrawA && out.withdrawA.status === 200 &&
      out.profileAfterWithdraw === true &&
      out.alignmentAfterWithdraw === true &&
      out.evidenceAfterWithdraw === true &&
      out.banWithdraw && out.banWithdraw.status === 200 &&
      out.rejoinRows >= 1 &&
      out.rejoinHasEmail === false &&
      out.rejoinHasAlignment === false;

    console.log(JSON.stringify({ ok: !!ok, result: out }, null, 2));
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), result: out }));
    process.exitCode = 1;
  } finally {
    try {
      if (evidenceId) await admin.from('deleted_content_evidence').delete().eq('id', evidenceId);
      if (postId) {
        await admin.from('board_comments').delete().eq('post_id', postId);
        await admin.from('board_posts').delete().eq('id', postId);
      }
      const since = new Date(stamp - 5000).toISOString();
      await admin.from('user_sanction_records').delete().gte('created_at', since);
      const blocks = await admin
        .from('banned_rejoin_blocks')
        .select('id, created_at')
        .gte('created_at', since);
      const rows = blocks.data || [];
      for (let i = 0; i < rows.length; i++) {
        await admin.from('banned_rejoin_blocks').delete().eq('id', rows[i].id);
      }
      if (userA) await admin.auth.admin.deleteUser(userA);
      if (userB) await admin.auth.admin.deleteUser(userB);
    } catch (_) {}
  }
}

main();
