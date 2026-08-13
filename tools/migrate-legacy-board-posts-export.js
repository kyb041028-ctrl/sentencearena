#!/usr/bin/env node
'use strict';

/**
 * localStorage sc_board_bundle_v1 export → board_posts canonical INSERT (admin one-time)
 *
 * - browser count 신뢰 금지 · export JSON 파일만 처리
 * - authorId 가 auth.users.id UUID 인 글만
 * - demo/seed/guest 제외
 * - DAILY_ISSUE_DATABASE_URL + --confirm-dev-db (apply 시)
 *
 * Export 예 (브라우저 콘솔):
 *   copy(localStorage.getItem('sc_board_bundle_v1'))
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERRITORY_MAP = {
  COMMON: 'CENTRAL',
  CENTRAL: 'CENTRAL',
  CONSERVATIVE: 'GUARDIAN',
  GUARDIAN: 'GUARDIAN',
  PROGRESSIVE: 'PIONEER',
  PIONEER: 'PIONEER',
  KANTAPBIYA: 'ALIEN',
  ALIEN: 'ALIEN',
};

const DEMO_AUTHOR_PREFIXES = ['운영자', 'guest', 'guest_demo'];

function parseArgs(argv) {
  const out = { input: '', dryRun: true, confirm: false };
  argv.forEach(function (a, i) {
    if (a === '--input' && argv[i + 1]) out.input = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--apply') out.dryRun = false;
    else if (a === '--confirm-dev-db') out.confirm = true;
  });
  return out;
}

function isDemoAuthor(authorId) {
  const s = String(authorId || '').trim();
  if (!s) return true;
  if (s === 'guest' || s === 'guest_demo') return true;
  for (let i = 0; i < DEMO_AUTHOR_PREFIXES.length; i++) {
    if (s.indexOf(DEMO_AUTHOR_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function isDemoPostId(id) {
  const s = String(id || '').trim();
  return !s || /^seed_/i.test(s) || /^demo_/i.test(s);
}

function parseBundle(raw) {
  let o = raw;
  if (typeof raw === 'string') {
    o = JSON.parse(raw);
  }
  if (o && o.posts && typeof o.posts === 'object') return o;
  throw new Error('INVALID_BUNDLE: posts object required');
}

function territoryFromKey(key, fallback) {
  const k = String(key || '').trim();
  const tid = k.split('_s')[0] || fallback || 'COMMON';
  const mapped = TERRITORY_MAP[String(tid).toUpperCase()] || 'CENTRAL';
  return mapped;
}

function collectLegacyPosts(bundle) {
  const out = [];
  const postsMap = bundle.posts || {};
  Object.keys(postsMap).forEach(function (key) {
    const arr = postsMap[key];
    if (!Array.isArray(arr)) return;
    const territory = territoryFromKey(key, 'COMMON');
    arr.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      out.push({
        legacyKey: key,
        legacyId: String(p.id || '').trim(),
        authorId: String(p.authorId || '').trim(),
        title: String(p.title || '').trim(),
        content: String(p.body != null ? p.body : p.content || '').trim(),
        createdAt: p.createdAt ? String(p.createdAt) : null,
        categoryKey: p.categoryKey || p.category || null,
        territory: territory,
      });
    });
  });
  return out;
}

function classifyPost(post) {
  if (isDemoPostId(post.legacyId)) {
    return { action: 'SKIP', reason: 'DEMO_OR_SEED_ID' };
  }
  if (isDemoAuthor(post.authorId)) {
    return { action: 'SKIP', reason: 'DEMO_OR_GUEST_AUTHOR' };
  }
  if (!UUID_RE.test(post.authorId)) {
    return { action: 'SKIP', reason: 'AUTHOR_NOT_UUID' };
  }
  if (!post.title || !post.content) {
    return { action: 'SKIP', reason: 'EMPTY_TITLE_OR_CONTENT' };
  }
  return { action: 'MIGRATE', reason: 'OWNERSHIP_VERIFIABLE' };
}

async function userExists(sb, userId) {
  try {
    const r = await sb.auth.admin.getUserById(userId);
    return !!(r && r.data && r.data.user && r.data.user.id);
  } catch (_) {
    return false;
  }
}

async function postAlreadyExists(sb, row) {
  let q = sb
    .from('board_posts')
    .select('id')
    .eq('author_user_id', row.author_user_id)
    .eq('title', row.title)
    .limit(1);
  if (row.created_at) {
    q = q.eq('created_at', row.created_at);
  }
  const { data, error } = await q;
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error(JSON.stringify({ ok: false, error: 'INPUT_REQUIRED', hint: '--input export.json' }));
    process.exit(1);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  const inputPath = path.resolve(args.input);
  const raw = fs.readFileSync(inputPath, 'utf8');
  const bundle = parseBundle(raw);
  const legacyPosts = collectLegacyPosts(bundle);

  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const sb =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
      : null;

  const report = {
    totalLegacyPosts: legacyPosts.length,
    migrate: 0,
    skip: 0,
    skippedReasons: {},
    uniqueAuthors: {},
    samples: [],
  };

  const toInsert = [];
  for (let i = 0; i < legacyPosts.length; i++) {
    const post = legacyPosts[i];
    const cls = classifyPost(post);
    report.skip += cls.action === 'SKIP' ? 1 : 0;
    report.migrate += cls.action === 'MIGRATE' ? 1 : 0;
    report.skippedReasons[cls.reason] = (report.skippedReasons[cls.reason] || 0) + 1;

    if (cls.action !== 'MIGRATE') continue;

    if (sb) {
      const exists = await userExists(sb, post.authorId);
      if (!exists) {
        report.migrate -= 1;
        report.skip += 1;
        report.skippedReasons.USER_NOT_FOUND = (report.skippedReasons.USER_NOT_FOUND || 0) + 1;
        continue;
      }
    }

    report.uniqueAuthors[post.authorId] = (report.uniqueAuthors[post.authorId] || 0) + 1;
    const row = {
      author_user_id: post.authorId,
      territory: post.territory,
      category_key: post.categoryKey || null,
      board_stage: 1,
      title: post.title.slice(0, 500),
      content: post.content.slice(0, 15000),
      is_anonymous: false,
      status: 'ACTIVE',
      created_at: post.createdAt || new Date().toISOString(),
    };
    toInsert.push({ legacy: post, row: row });
    if (report.samples.length < 5) {
      report.samples.push({
        legacyId: post.legacyId,
        authorPrefix: post.authorId.slice(0, 8),
        territory: post.territory,
        titleLen: post.title.length,
      });
    }
  }

  report.uniqueAuthorCount = Object.keys(report.uniqueAuthors).length;

  if (args.dryRun || !args.confirm) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          maskedDbUrl: url ? maskDatabaseUrl(url) : null,
          report: report,
          wouldInsert: toInsert.length,
        },
        null,
        2,
      ),
    );
    if (!args.dryRun && !args.confirm) {
      console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED' }));
      process.exit(1);
    }
    return;
  }

  if (!sb) {
    console.error(JSON.stringify({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' }));
    process.exit(1);
  }

  let inserted = 0;
  let deduped = 0;
  let failed = 0;
  for (let j = 0; j < toInsert.length; j++) {
    const item = toInsert[j];
    if (await postAlreadyExists(sb, item.row)) {
      deduped += 1;
      continue;
    }
    const ins = await sb.from('board_posts').insert(item.row).select('id').single();
    if (ins.error) {
      failed += 1;
      continue;
    }
    inserted += 1;
  }

  const after = await sb.from('board_posts').select('id', { count: 'exact', head: true });
  console.log(
    JSON.stringify(
      {
        ok: failed === 0,
        applied: true,
        report: report,
        inserted: inserted,
        deduped: deduped,
        failed: failed,
        boardPostsTotal: after.count,
      },
      null,
      2,
    ),
  );
  if (failed > 0) process.exit(1);
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
