#!/usr/bin/env node
'use strict';
/**
 * Additive: board_posts.faction_battle_enabled
 *
 *   node tools/apply-faction-battle-enabled-migration.js --dry-run
 *   railway run --service sentencearena node tools/apply-faction-battle-enabled-migration.js --confirm-apply
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_faction_battle_enabled_v1.sql');

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

async function verify(exec) {
  const col = await exec.query(
    `SELECT column_name, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='board_posts'
        AND column_name='faction_battle_enabled'`,
  );
  const posts = await exec.query('SELECT COUNT(*)::int AS n FROM public.board_posts');
  const profiles = await exec.query('SELECT COUNT(*)::int AS n FROM public.profiles');
  return {
    hasColumn: !!(col.rows && col.rows[0]),
    columnDefault: col.rows && col.rows[0] && col.rows[0].column_default,
    nullable: col.rows && col.rows[0] && col.rows[0].is_nullable,
    postCount: posts.rows[0] && posts.rows[0].n,
    profileCount: profiles.rows[0] && profiles.rows[0].n,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const sqlBody = sql.replace(/--[^\n]*/g, '');

  if (/\bTRUNCATE\b|\bDROP TABLE\b|\bDELETE FROM\b/i.test(sqlBody)) {
    console.error(JSON.stringify({ ok: false, error: 'DESTRUCTIVE_SQL_REFUSED' }));
    process.exit(1);
  }

  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      bytes: sql.length,
      maskedUrl: maskDatabaseUrl(url),
      addsColumn: /faction_battle_enabled/.test(sql),
    }));
    return;
  }
  if (!args.confirm) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', hint: '--confirm-apply' }));
    process.exit(2);
  }

  const exec = createDailyIssuePgExecutor({ connectionString: url });
  const before = await verify(exec);
  await exec.query(sql);
  try {
    await exec.query("NOTIFY pgrst, 'reload schema'");
  } catch (_) {}
  const after = await verify(exec);
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_faction_battle_enabled_v1.sql',
    before: before,
    after: after,
    postsPreserved: before.postCount == null || before.postCount === after.postCount,
    profilesPreserved: before.profileCount == null || before.profileCount === after.profileCount,
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
