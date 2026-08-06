#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 05:00 KST 아침판 자동 게시 CLI
 *
 * --force  아침 창 무시(개발/테스트)
 * --dry-run
 * --as-of=ISO
 * --repository=db|json
 * --schema=daily_issue_test
 */

require('dotenv').config({ path: '.env' });
const reviewService = require('../server/daily-issue-review-service');

function parseArgs(argv) {
  const out = { dryRun: false, force: false };
  argv.forEach(function (a) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--ignore-morning-window') out.ignoreMorningWindow = true;
    else if (a.startsWith('--as-of=')) out.asOf = a.slice(8);
    else if (a.startsWith('--repository=')) out.repository = a.slice(13);
    else if (a.startsWith('--schema=')) out.schema = a.slice(9);
    else if (a.startsWith('--review-root=')) out.reviewRoot = a.slice(14);
  });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const common = {
    dryRun: args.dryRun,
    force: args.force,
    ignoreMorningWindow: args.ignoreMorningWindow || args.force,
    asOf: args.asOf,
    reviewRoot: args.reviewRoot,
    repository: args.repository || process.env.DAILY_ISSUE_REPOSITORY || 'json',
    schemaName: args.schema || process.env.DAILY_ISSUE_DB_SCHEMA,
  };

  if (String(common.repository).toLowerCase() === 'db') {
    const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');
    const repo = createDailyIssueReviewRepository({
      kind: 'db',
      schemaName: common.schemaName,
    });
    const init = await Promise.resolve(repo.initialize());
    if (!init.ok) {
      console.error(JSON.stringify({ ok: false, error: init.error, message: init.message }));
      process.exit(1);
    }
    common.repositoryInstance = repo;
  }

  const res = await Promise.resolve(reviewService.runMorningAutoPublish(common));
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch(function (e) {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
