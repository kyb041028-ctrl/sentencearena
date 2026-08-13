#!/usr/bin/env node
'use strict';

/**
 * RETROACTIVE 업적 server backfill (admin/service-role)
 * node tools/run-achievement-backfill.js --achievement first-post [--dry-run] [--apply]
 *
 * --apply 없이 --dry-run 기본. 실제 grant는 --apply --confirm-dev-db
 */

require('dotenv').config();

const backfill = require('../server/achievement-backfill-service');

function parseArgs(argv) {
  const out = {
    achievementId: 'first-post',
    dryRun: true,
    inspect: false,
    userIds: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--achievement' && argv[i + 1]) {
      out.achievementId = String(argv[++i]).trim();
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--apply') {
      out.dryRun = false;
    } else if (a === '--inspect') {
      out.inspect = true;
    } else if (a === '--confirm-dev-db') {
      out.confirm = true;
    } else if (a === '--user' && argv[i + 1]) {
      out.userIds.push(String(argv[++i]).trim());
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }

  if (args.inspect) {
    const report = await backfill.inspectBackfillEligibility(args.achievementId);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  if (!args.dryRun && !args.confirm) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'CONFIRM_REQUIRED',
        hint: '실제 grant는 --apply --confirm-dev-db 필요',
      }),
    );
    process.exit(1);
  }

  const result = await backfill.runAchievementBackfill({
    achievementId: args.achievementId,
    dryRun: args.dryRun,
    userIds: args.userIds.length ? args.userIds : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.skipped) process.exit(1);
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
