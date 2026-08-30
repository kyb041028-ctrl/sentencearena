#!/usr/bin/env node
'use strict';

/**
 * 베타 공식 기본 게시글 등록 도구.
 * 기본은 dry-run. Production 거부. 가짜 회원/댓글/반응 생성 없음.
 *
 *   node tools/apply-beta-official-posts.js
 *   node tools/apply-beta-official-posts.js --dry-run --author-user-id <uuid>
 *   node tools/apply-beta-official-posts.js --apply --confirm-dev-db --author-user-id <uuid>
 */

require('dotenv').config();

const core = require('../shared/beta-official-posts-core');

function parseArgs(argv) {
  const out = { apply: false, confirm: false, authorUserId: '' };
  argv.forEach(function (a, i) {
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--author-user-id' && argv[i + 1]) out.authorUserId = String(argv[++i]).trim();
  });
  return out;
}

function productionRefused() {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') return 'NODE_ENV_PRODUCTION';
  const origin = String(process.env.APP_PUBLIC_ORIGIN || '').toLowerCase();
  if (origin.indexOf('sentencearena.com') !== -1) return 'PRODUCTION_ORIGIN';
  return null;
}

function getAdmin() {
  try {
    const { getAlignmentSupabaseAdminClient } = require('../server/alignment-supabase-admin');
    return getAlignmentSupabaseAdminClient();
  } catch (_) {
    return null;
  }
}

async function loadExistingTitles(admin) {
  const titles = core.POSTS.map(function (p) {
    return p.title;
  });
  const res = await admin
    .from('board_posts')
    .select('id, title, status, territory')
    .eq('territory', core.TERRITORY)
    .eq('status', 'ACTIVE')
    .in('title', titles);
  if (res.error) {
    const err = new Error(res.error.message || 'BOARD_OFFICIAL_LOOKUP_FAILED');
    err.code = 'BOARD_OFFICIAL_LOOKUP_FAILED';
    throw err;
  }
  return (res.data || []).map(function (r) {
    return r.title;
  });
}

async function authorExists(admin, userId) {
  const res = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (res.error) return false;
  return !!(res.data && res.data.id);
}

function isMissingOfficialColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  if (code === 'PGRST204' || code === '42703') return true;
  return /is_official/.test(msg);
}

async function insertOne(admin, row) {
  const res = await admin.from('board_posts').insert(row).select('id, title, is_official').single();
  if (res.error) {
    const err = new Error(res.error.message || 'BOARD_POST_CREATE_FAILED');
    err.code = isMissingOfficialColumnError(res.error)
      ? 'IS_OFFICIAL_COLUMN_MISSING'
      : (res.error.code || 'BOARD_POST_CREATE_FAILED');
    throw err;
  }
  return res.data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pack = core.validatePack();
  if (!pack.ok) {
    console.log(JSON.stringify({ ok: false, error: 'PACK_INVALID', details: pack.errors }));
    process.exit(1);
  }

  const prod = productionRefused();
  if (args.apply && prod) {
    console.log(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED', reason: prod }));
    process.exit(1);
  }

  const authorUserId = args.authorUserId;
  if (args.apply && !core.isUuid(authorUserId)) {
    console.log(JSON.stringify({ ok: false, error: 'AUTHOR_USER_ID_REQUIRED' }));
    process.exit(1);
  }
  if (authorUserId && !core.isUuid(authorUserId)) {
    console.log(JSON.stringify({ ok: false, error: 'AUTHOR_USER_ID_INVALID' }));
    process.exit(1);
  }

  const admin = getAdmin();
  let existingTitles = [];
  let authorOk = null;
  if (admin && authorUserId) {
    authorOk = await authorExists(admin, authorUserId);
  }
  if (admin) {
    try {
      existingTitles = await loadExistingTitles(admin);
    } catch (e) {
      if (args.apply) {
        console.log(JSON.stringify({ ok: false, error: e.code || 'LOOKUP_FAILED', message: e.message }));
        process.exit(1);
      }
    }
  }

  const plan = core.planInserts(existingTitles);
  const summary = {
    ok: true,
    dryRun: !args.apply,
    territory: core.TERRITORY,
    boardStage: core.BOARD_STAGE,
    authorUserId: authorUserId || null,
    authorExists: authorOk,
    create: plan.create.map(function (p) {
      return { seedKey: p.seedKey, title: p.title, kind: p.kind };
    }),
    skip: plan.skip.map(function (p) {
      return { seedKey: p.seedKey, title: p.title, reason: 'TITLE_EXISTS' };
    }),
    created: [],
    comments: 0,
    reactions: 0,
    usersCreated: 0,
  };

  if (!args.apply) {
    console.log(JSON.stringify(summary));
    return;
  }

  if (!args.confirm) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', hint: '--confirm-dev-db' }));
    process.exit(1);
  }
  if (!admin) {
    console.log(JSON.stringify({ ok: false, error: 'ADMIN_CLIENT_UNAVAILABLE' }));
    process.exit(1);
  }
  if (authorOk !== true) {
    console.log(JSON.stringify({ ok: false, error: 'AUTHOR_NOT_FOUND', authorUserId: authorUserId }));
    process.exit(1);
  }

  for (let i = 0; i < plan.create.length; i++) {
    const post = plan.create[i];
    const again = await loadExistingTitles(admin);
    if (again.indexOf(post.title) !== -1) {
      summary.skip.push({ seedKey: post.seedKey, title: post.title, reason: 'TITLE_EXISTS' });
      continue;
    }
    const row = core.insertRow(post, authorUserId);
    const saved = await insertOne(admin, row);
    summary.created.push({ seedKey: post.seedKey, id: saved.id, title: saved.title });
  }

  summary.create = plan.create.filter(function (p) {
    return summary.created.some(function (c) {
      return c.seedKey === p.seedKey;
    });
  }).map(function (p) {
    return { seedKey: p.seedKey, title: p.title, kind: p.kind };
  });

  console.log(JSON.stringify(summary));
}

main().catch(function (e) {
  console.log(JSON.stringify({ ok: false, error: e && e.code ? e.code : 'APPLY_FAILED', message: e && e.message }));
  process.exit(1);
});
