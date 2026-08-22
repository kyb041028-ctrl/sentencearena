#!/usr/bin/env node
'use strict';
/**
 * Production disposable verify for rights-infringement v1.
 * Does not use protected real-user accounts. Cleans up leftover test rows.
 *
 *   node tools/verify-rights-infringement-live.js --confirm-production
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const BASE = 'https://sentencearena.com';
const PASSWORD = 'RightsLive!2026a';
const stamp = Date.now();
const EMAIL_AUTHOR = 'sc.rights.author.' + stamp + '@example.com';
const EMAIL_CLAIMANT = 'sc.rights.claimant.' + stamp + '@example.com';
const EMAIL_ADMIN = 'sc.rights.admin.' + stamp + '@example.com';

function argHas(flag) {
  return process.argv.indexOf(flag) !== -1;
}

function longText(prefix, min) {
  let s = String(prefix || '');
  while (s.length < min) s += ' 구체적인 설명입니다.';
  return s;
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
  return { status: res.status, json: json, raw: raw.slice(0, 400) };
}

async function ensureUser(admin, email, appMetadata) {
  const created = await admin.auth.admin.createUser({
    email: email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { test: 'rights-infringement-live' },
    app_metadata: appMetadata || {},
  });
  if (created.data && created.data.user && created.data.user.id) {
    return created.data.user;
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
  await httpJson('POST', '/api/me/legal/age-confirm', token, {
    year: 1990,
    month: 1,
    day: 15,
  });
  await httpJson('POST', '/api/me/legal/sensitive-consent', token, {
    consented: true,
    policyVersion: 'sensitive-political-v1',
  });
}

function validBody(postId, email) {
  return {
    claimType: 'DEFAMATION',
    claimantKind: 'SELF',
    claimantName: '라이브검증신청',
    claimantEmail: email,
    targetKind: 'POST',
    postId: postId,
    problemExcerpt: '문제가 되는 정확한 문장 예시입니다',
    claimedRight: '명예에 관한 권리',
    infringementReason: longText('이 글은 제가 어제 뇌물을 받았다고 단정하여 사실과 다릅니다.', 50),
    caseNarrative: longText('게시 시각과 표현 위치를 특정할 수 있고 저는 당사자입니다.', 50),
    requestedAction: 'HIDE',
    truthConfirmed: true,
    abuseNoticeConfirmed: true,
    defamationStatement: 'A정치인이 어제 5억원을 뇌물로 받았다.',
    defamationRefersTo: '신청자 본인',
    defamationNature: 'FACT',
    defamationFalsehood: longText('해당 금전 수수는 없었고 날짜와 금액이 사실과 다릅니다.', 30),
    defamationHonorHarm: longText('구체적 범죄 사실 주장으로 사회적 평가가 저하된다고 봅니다.', 30),
  };
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
  };
  if (!authCfg.url || !authCfg.key) {
    const fromProd = await productionAuthCfg();
    if (!authCfg.url) authCfg.url = fromProd.url;
    if (!authCfg.key) authCfg.key = fromProd.key;
  }
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
    blankBlocked: null,
    submitted: null,
    adminList: null,
    converted: null,
    takedown: null,
    hiddenContent: null,
    objection: null,
    completed: null,
    abuseWarning: null,
    cleaned: false,
  };

  let author = null;
  let claimant = null;
  let operator = null;
  let postId = null;
  let requestId = null;

  try {
    const health = await httpJson('GET', '/health');
    const ready = await httpJson('GET', '/ready');
    out.health = health.json;
    out.ready = ready.json;

    author = await ensureUser(admin, EMAIL_AUTHOR);
    claimant = await ensureUser(admin, EMAIL_CLAIMANT);
    operator = await ensureUser(admin, EMAIL_ADMIN, { role: 'ADMIN', admin_role: 'ADMIN' });

    const tokenAuthor = await signIn(authCfg, EMAIL_AUTHOR);
    const tokenClaimant = await signIn(authCfg, EMAIL_CLAIMANT);
    const tokenAdmin = await signIn(authCfg, EMAIL_ADMIN);
    const me = await httpJson('GET', '/api/auth/me', tokenAuthor);
    out.authMe = { status: me.status, error: me.json && me.json.error };
    await completeLegal(tokenAuthor);
    await completeLegal(tokenClaimant);
    const tokenAuthor2 = await signIn(authCfg, EMAIL_AUTHOR);
    const tokenClaimant2 = await signIn(authCfg, EMAIL_CLAIMANT);

    const created = await httpJson('POST', '/api/board/posts', tokenAuthor2, {
      title: '권리침해 라이브 검증용 게시글 제목입니다',
      content: 'A정치인은 무능하다고 생각한다. 라이브 검증용 본문입니다. 충분히 깁니다.',
    });
    postId = created.json && created.json.post && created.json.post.id;
    if (!postId) throw new Error('POST_CREATE_FAILED ' + created.status + ' ' + created.raw);

    const blank = await httpJson('POST', '/api/rights-infringement/requests', tokenClaimant2, {
      claimType: 'DEFAMATION',
    });
    out.blankBlocked = blank.status === 400 && blank.json && blank.json.ok === false;

    const submitted = await httpJson('POST', '/api/rights-infringement/requests', tokenClaimant2, validBody(postId, EMAIL_CLAIMANT));
    out.submitted = {
      status: submitted.status,
      caseNumber: submitted.json && submitted.json.request && submitted.json.request.caseNumber,
      requestStatus: submitted.json && submitted.json.request && submitted.json.request.status,
      leakedEmail: JSON.stringify(submitted.json || {}).indexOf(EMAIL_CLAIMANT) !== -1,
    };
    if (submitted.status !== 201) throw new Error('SUBMIT_FAILED ' + submitted.status + ' ' + submitted.raw);

    const listed = await httpJson('GET', '/api/admin/rights-infringement/requests', tokenAdmin);
    out.adminList = { status: listed.status, count: listed.json && listed.json.requests ? listed.json.requests.length : 0 };
    const hit = ((listed.json && listed.json.requests) || []).filter(function (r) {
      return r.caseNumber === out.submitted.caseNumber;
    })[0];
    requestId = hit && hit.id;
    if (!requestId) throw new Error('ADMIN_LIST_MISS');

    const converted = await httpJson('POST', '/api/admin/rights-infringement/requests/' + requestId + '/action', tokenAdmin, {
      action: 'CONVERT_FORMAL',
      note: '라이브 검증: 당사자·대상·문제부분이 구체적이다.',
    });
    out.converted = { status: converted.status, statusNow: converted.json && converted.json.request && converted.json.request.status };

    const takedown = await httpJson('POST', '/api/admin/rights-infringement/requests/' + requestId + '/action', tokenAdmin, {
      action: 'TEMP_TAKEDOWN',
    });
    out.takedown = { status: takedown.status, statusNow: takedown.json && takedown.json.request && takedown.json.request.status };

    const viewed = await httpJson('GET', '/api/board/posts/' + postId, tokenClaimant2);
    out.hiddenContent = viewed.json && viewed.json.post && viewed.json.post.content;

    const notices = await httpJson('GET', '/api/rights-infringement/me/notices', tokenAuthor2);
    const notice = ((notices.json && notices.json.notices) || [])[0];
    const leaked = JSON.stringify(notices.json || {}).indexOf(EMAIL_CLAIMANT) !== -1;
    const objection = await httpJson('POST', '/api/rights-infringement/me/requests/' + requestId + '/objection', tokenAuthor2, {
      ground: 'POLITICAL_OPINION',
      explanation: longText('해당 문장은 정치인에 대한 평가이며 구체적 범죄 사실 주장이 아닙니다.', 50),
    });
    out.objection = {
      status: objection.status,
      noticeOk: !!(notice && notice.caseNumber),
      leakedClaimantEmail: leaked,
    };

    const completed = await httpJson('POST', '/api/admin/rights-infringement/requests/' + requestId + '/action', tokenAdmin, {
      action: 'COMPLETE',
      note: '라이브 검증 완료. 법적 진실을 확정하지 않는다.',
    });
    out.completed = { status: completed.status, statusNow: completed.json && completed.json.request && completed.json.request.status };

    const warn = await httpJson('POST', '/api/admin/rights-infringement/requests/' + requestId + '/action', tokenAdmin, {
      action: 'ABUSE_WARNING',
      note: '라이브 검증용 경고 후 즉시 정리',
    });
    out.abuseWarning = { status: warn.status, autoPermanent: warn.json && warn.json.automaticPermanentBan };
  } finally {
    try {
      if (requestId) {
        await admin.from('rights_infringement_requests').delete().eq('id', requestId);
      }
      await admin.from('rights_infringement_requests').delete().like('claimant_email', 'sc.rights.%@example.com');
      if (postId) {
        await admin.from('board_posts').delete().eq('id', postId);
      }
      const ids = [author, claimant, operator].filter(Boolean).map(function (u) { return u.id; });
      if (ids.length) {
        await admin.from('rights_infringement_abuse_state').delete().in('user_id', ids);
      }
      for (let i = 0; i < ids.length; i++) {
        try { await admin.auth.admin.deleteUser(ids[i]); } catch (_) {}
      }
      out.cleaned = true;
    } catch (cleanErr) {
      out.cleanError = String(cleanErr && cleanErr.message ? cleanErr.message : cleanErr);
    }
  }

  const pass = !!(
    out.health && out.ready &&
    out.blankBlocked === true &&
    out.submitted && out.submitted.status === 201 && out.submitted.requestStatus === 'RECEIVED' && out.submitted.leakedEmail === false &&
    out.converted && out.converted.statusNow === 'FORMAL_CASE' &&
    out.takedown && out.takedown.statusNow === 'TEMP_TAKEDOWN' &&
    String(out.hiddenContent || '').indexOf('임시로 게시가 중단') !== -1 &&
    out.objection && out.objection.status === 201 && out.objection.leakedClaimantEmail === false &&
    out.completed && out.completed.statusNow === 'COMPLETED' &&
    out.abuseWarning && out.abuseWarning.status === 200 && out.abuseWarning.autoPermanent === false &&
    out.cleaned === true
  );
  console.log(JSON.stringify({ ok: pass, result: out }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
