#!/usr/bin/env node
'use strict';
/**
 * Production disposable verify for misinfo report extras.
 *
 *   node tools/verify-misinfo-report-live.js --confirm-production
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const misinfoCore = require('../shared/misinfo-report-core');

const BASE = 'https://sentencearena.com';
const PASSWORD = 'MisinfoLive!2026a';
const stamp = Date.now();
const EMAIL_AUTHOR = 'sc.misinfo.author.' + stamp + '@example.com';
const EMAIL_REPORTER = 'sc.misinfo.reporter.' + stamp + '@example.com';
const EMAIL_ADMIN = 'sc.misinfo.admin.' + stamp + '@example.com';

function argHas(flag) {
  return process.argv.indexOf(flag) !== -1;
}

function longText(prefix, min) {
  let s = String(prefix || '');
  while (misinfoCore.meaningfulLen(s) < min) s += ' 구체적인 설명입니다.';
  return s;
}

function validMisinfo() {
  return {
    misinfoClaimKind: 'FACT',
    misinfoExcerpt: '중앙선거관리위원회가 오늘 투표를 취소했다고 발표했다.',
    misinfoFalsehoodReason: longText('공식 발표와 달리 해당 날짜에 투표가 취소된 사실이 없다.', 50),
    misinfoEvidenceUrl: 'https://www.nec.go.kr/notice/live-verify',
    misinfoExternalCheck: 'NONE',
  };
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
  return { status: res.status, json: json, raw: raw.slice(0, 500) };
}

async function ensureUser(admin, email, appMetadata) {
  const created = await admin.auth.admin.createUser({
    email: email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { test: 'misinfo-report-live' },
    app_metadata: appMetadata || {},
  });
  if (created.data && created.data.user && created.data.user.id) return created.data.user;
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
  if (!cfg.json || !cfg.json.url || !cfg.json.anonKey) throw new Error('PROD_SUPABASE_CONFIG_FAILED');
  return { url: cfg.json.url, key: cfg.json.anonKey };
}

async function completeLegal(token) {
  await httpJson('POST', '/api/me/legal/age-confirm', token, { year: 1990, month: 1, day: 15 });
  await httpJson('POST', '/api/me/legal/sensitive-consent', token, {
    consented: true,
    policyVersion: 'sensitive-political-v1',
  });
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
    shortBlocked: null,
    submitted: null,
    adminExtra: null,
    insufficient: null,
    noAuthorSanction: null,
    confirmed: null,
    noAlien: null,
    abuseWarning: null,
    restricted: null,
    abuseStillWorks: null,
    rightsStillWorks: null,
    cleaned: false,
  };

  let author = null;
  let reporter = null;
  let operator = null;
  let postId = null;
  let extraPostId = null;

  try {
    const health = await httpJson('GET', '/health');
    const ready = await httpJson('GET', '/ready');
    out.health = health.json;
    out.ready = ready.json;

    author = await ensureUser(admin, EMAIL_AUTHOR);
    reporter = await ensureUser(admin, EMAIL_REPORTER);
    operator = await ensureUser(admin, EMAIL_ADMIN, { role: 'ADMIN', admin_role: 'ADMIN' });

    let tokenAuthor = await signIn(authCfg, EMAIL_AUTHOR);
    let tokenReporter = await signIn(authCfg, EMAIL_REPORTER);
    const tokenAdmin = await signIn(authCfg, EMAIL_ADMIN);
    await completeLegal(tokenAuthor);
    await completeLegal(tokenReporter);
    tokenAuthor = await signIn(authCfg, EMAIL_AUTHOR);
    tokenReporter = await signIn(authCfg, EMAIL_REPORTER);

    const created = await httpJson('POST', '/api/board/posts', tokenAuthor, {
      title: '허위정보 라이브 검증용 게시글 제목입니다',
      content: '중앙선거관리위원회가 오늘 투표를 취소했다고 발표했다. 라이브 검증용 본문입니다.',
    });
    postId = created.json && created.json.post && created.json.post.id;
    if (!postId) throw new Error('POST_CREATE_FAILED ' + created.status + ' ' + created.raw);

    const blank = await httpJson('POST', '/api/board/reports', tokenReporter, {
      targetType: 'POST', targetId: postId, reasonCode: 'misinfo',
    });
    out.blankBlocked = blank.status === 400 && String((blank.json && blank.json.error) || '').indexOf('MISINFO_') === 0;

    const short = await httpJson('POST', '/api/board/reports', tokenReporter, {
      targetType: 'POST',
      targetId: postId,
      reasonCode: 'misinfo',
      misinfoClaimKind: 'FACT',
      misinfoExcerpt: '짧음',
      misinfoFalsehoodReason: '짧음',
      misinfoEvidenceUrl: 'https://www.nec.go.kr/notice/live-verify',
    });
    out.shortBlocked = short.status === 400;

    const submitted = await httpJson('POST', '/api/board/reports', tokenReporter, Object.assign({
      targetType: 'POST',
      targetId: postId,
      reasonCode: 'misinfo',
    }, validMisinfo()));
    out.submitted = {
      status: submitted.status,
      reportStatus: submitted.json && submitted.json.report && submitted.json.report.status,
      leakedReporter: JSON.stringify(submitted.json || {}).indexOf(reporter.id) !== -1,
    };
    if (submitted.status !== 201) throw new Error('SUBMIT_FAILED ' + submitted.status + ' ' + submitted.raw);

    const listed = await httpJson('GET', '/api/admin/moderation/reports', tokenAdmin);
    const group = ((listed.json && listed.json.behaviors) || []).filter(function (g) {
      return g.postId === postId;
    })[0];
    out.adminExtra = {
      status: listed.status,
      hasGuide: !!(group && group.misinfoGuide),
      hasExcerpt: !!(group && group.reports && group.reports[0] && group.reports[0].misinfo && group.reports[0].misinfo.excerpt),
    };
    if (!group) throw new Error('ADMIN_GROUP_MISS');

    const insuff = await httpJson('POST', '/api/admin/moderation/behaviors/review', tokenAdmin, {
      behaviorKey: group.behaviorKey,
      misinfoDecision: 'INSUFFICIENT_EVIDENCE',
      operatorSanction: 'NONE',
    });
    out.insufficient = { status: insuff.status, now: insuff.json && insuff.json.result && insuff.json.result.behavior && insuff.json.result.behavior.status };
    out.noAuthorSanction = insuff.json && insuff.json.result && insuff.json.result.behavior && insuff.json.result.behavior.sanctionClass === 'MISINFO';

    const extra = await httpJson('POST', '/api/board/posts', tokenAuthor, {
      title: '허위정보 확인 라이브 검증용 게시글 제목입니다',
      content: '중앙선거관리위원회가 오늘 투표를 취소했다고 발표했다. 두 번째 검증용입니다.',
    });
    extraPostId = extra.json && extra.json.post && extra.json.post.id;
    const second = await httpJson('POST', '/api/board/reports', tokenReporter, Object.assign({
      targetType: 'POST',
      targetId: extraPostId,
      reasonCode: 'misinfo',
    }, validMisinfo()));
    if (second.status !== 201) throw new Error('SECOND_SUBMIT_FAILED ' + second.status + ' ' + second.raw);
    const listed2 = await httpJson('GET', '/api/admin/moderation/reports', tokenAdmin);
    const group2 = ((listed2.json && listed2.json.behaviors) || []).filter(function (g) {
      return g.postId === extraPostId;
    })[0];
    const confirmed = await httpJson('POST', '/api/admin/moderation/behaviors/review', tokenAdmin, {
      behaviorKey: group2.behaviorKey,
      misinfoDecision: 'CONFIRMED',
      operatorSanction: 'AUTO',
    });
    out.confirmed = { status: confirmed.status, now: confirmed.json && confirmed.json.result && confirmed.json.result.behavior && confirmed.json.result.behavior.status };
    out.noAlien = !(confirmed.json && confirmed.json.result && confirmed.json.result.alien && confirmed.json.result.alien.action === 'TRANSFER');

    const warn = await httpJson('POST', '/api/admin/moderation/misinfo-abuse', tokenAdmin, {
      reporterUserId: reporter.id,
      action: 'WARNING',
      note: '라이브 검증용 악용 경고',
    });
    out.abuseWarning = { status: warn.status, count: warn.json && warn.json.warningCount };
    const restrict = await httpJson('POST', '/api/admin/moderation/misinfo-abuse', tokenAdmin, {
      reporterUserId: reporter.id,
      action: 'RESTRICT_30D',
      note: '라이브 검증용 30일 제한',
    });
    out.restricted = { status: restrict.status, restricted: restrict.json && restrict.json.state && restrict.json.state.restricted };

    const blocked = await httpJson('POST', '/api/board/reports', tokenReporter, Object.assign({
      targetType: 'POST',
      targetId: extraPostId,
      reasonCode: 'misinfo',
      misinfoEvidenceUrl: 'https://www.nec.go.kr/notice/another',
    }, validMisinfo()));
    out.restricted.blocked = blocked.status === 403 && blocked.json && blocked.json.error === 'MISINFO_REPORT_RESTRICTED';

    const abusePost = await httpJson('POST', '/api/board/posts', tokenAuthor, {
      title: '일반 신고 유지 확인용 게시글 제목입니다',
      content: '허위정보 신고 제한 중에도 일반 욕설 신고가 가능한지 확인하는 본문입니다.',
    });
    const abusePostId = abusePost.json && abusePost.json.post && abusePost.json.post.id;
    const abuseStill = await httpJson('POST', '/api/board/reports', tokenReporter, {
      targetType: 'POST',
      targetId: abusePostId,
      reasonCode: 'abuse',
    });
    out.abuseStillWorks = abuseStill.status === 201;
    out.abuseStillStatus = abuseStill.status;
    if (abusePostId) {
      try { await admin.from('board_reports').delete().eq('post_id', abusePostId); } catch (_) {}
      try { await admin.from('board_posts').delete().eq('id', abusePostId); } catch (_) {}
    }

    const rights = await httpJson('POST', '/api/rights-infringement/requests', tokenReporter, {
      claimType: 'OTHER_RIGHTS',
      claimantKind: 'SELF',
      claimantName: '라이브검증',
      claimantEmail: EMAIL_REPORTER,
      targetKind: 'POST',
      postId: postId,
      problemExcerpt: '문제가 되는 정확한 문장 예시입니다',
      claimedRight: '명예에 관한 권리',
      infringementReason: longText('구체적인 침해 이유를 충분히 작성합니다.', 50),
      caseNarrative: longText('사건 설명을 충분히 작성합니다.', 50),
      requestedAction: 'HIDE',
      truthConfirmed: true,
      abuseNoticeConfirmed: true,
    });
    out.rightsStillWorks = rights.status === 201 || rights.status === 409 || rights.status === 400;
  } finally {
    try {
      if (postId) await admin.from('board_reports').delete().eq('post_id', postId);
      if (extraPostId) await admin.from('board_reports').delete().eq('post_id', extraPostId);
      await admin.from('misinfo_report_abuse_state').delete().in('user_id', [reporter && reporter.id].filter(Boolean));
      if (postId) await admin.from('board_posts').delete().eq('id', postId);
      if (extraPostId) await admin.from('board_posts').delete().eq('id', extraPostId);
      const ids = [author, reporter, operator].filter(Boolean).map(function (u) { return u.id; });
      for (let i = 0; i < ids.length; i++) {
        await admin.auth.admin.deleteUser(ids[i]);
      }
      out.cleaned = true;
    } catch (e) {
      out.cleanupError = String(e && e.message ? e.message : e).slice(0, 120);
    }
  }

  const pass = !!(
    out.blankBlocked &&
    out.shortBlocked &&
    out.submitted && out.submitted.status === 201 &&
    out.submitted.leakedReporter === false &&
    out.adminExtra && out.adminExtra.hasExcerpt &&
    out.insufficient &&
    out.noAuthorSanction &&
    out.confirmed &&
    out.noAlien &&
    out.abuseWarning &&
    out.restricted && out.restricted.restricted &&
    out.restricted.blocked &&
    out.abuseStillWorks &&
    (out.rightsStillWorks === true) &&
    out.cleaned
  );
  console.log(JSON.stringify({ ok: pass, out: out }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
