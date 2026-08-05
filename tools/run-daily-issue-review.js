#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 검수·게시 CLI (4차)
 * 승인과 게시는 분리. 자동 게시 없음.
 *
 * Commands: enqueue|list|show|approve|hold|reject|publish|expire|expire-all|
 *           retire|revalidate|history|build-bundle|update-existing
 */

const fs = require('fs');
const path = require('path');
const reviewService = require('../server/daily-issue-review-service');
const lifecycle = require('../shared/daily-issue-lifecycle-core');

function parseArgs(argv) {
  const out = {
    command: argv[0] || 'list',
    dryRun: false,
    autoRetire: true,
  };
  argv.slice(1).forEach(function (a) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--expired') out.expired = true;
    else if (a === '--no-auto-retire') out.autoRetire = false;
    else if (a.startsWith('--input=')) out.input = a.slice(8);
    else if (a.startsWith('--output=')) out.output = a.slice(9);
    else if (a.startsWith('--id=')) out.id = a.slice(5);
    else if (a.startsWith('--reviewer=')) out.reviewer = a.slice(11);
    else if (a.startsWith('--reason=')) out.reason = a.slice(9);
    else if (a.startsWith('--reason-text=')) out.reasonText = a.slice(14);
    else if (a.startsWith('--status=')) out.status = a.slice(9);
    else if (a.startsWith('--as-of=')) out.asOf = a.slice(8);
    else if (a.startsWith('--review-root=')) out.reviewRoot = a.slice(14);
    else if (a.startsWith('--repository=')) out.repository = a.slice(13);
    else if (a.startsWith('--schema=')) out.schema = a.slice(9);
    else if (a.startsWith('--update-existing=')) out.updateExisting = a.slice(18);
    else if (a.startsWith('--publish-as-follow-up=')) out.publishAsFollowUp = a.slice(23);
  });
  return out;
}

function loadInput(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  return JSON.parse(raw);
}

function printList(res) {
  console.log('count:', res.count);
  (res.items || []).forEach(function (it) {
    console.log(
      '-',
      it.id,
      '[' + it.status + ']',
      it.title,
      '| cat=' + it.category,
      'src=' + it.sourceCount,
      'fresh=' + (it.freshnessClass || '-'),
      'dup=' + (it.duplicateDecision || '-'),
      it.holdReason ? 'hold=' + it.holdReason : '',
      it.rejectReason ? 'reject=' + it.rejectReason : '',
    );
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args.command;
  const common = {
    dryRun: args.dryRun,
    reviewRoot: args.reviewRoot,
    asOf: args.asOf,
    reviewer: args.reviewer,
    reasonText: args.reasonText,
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

  if (cmd === 'enqueue') {
    if (!args.input) {
      console.error('usage: enqueue --input=<fresh-candidate-json>');
      process.exit(1);
    }
    const data = loadInput(args.input);
    const res = await Promise.resolve(reviewService.enqueueCandidates(data, common));
    console.log(JSON.stringify({ ok: res.ok, dryRun: res.dryRun, enqueuedCount: res.enqueuedCount, skippedCount: res.skippedCount, results: res.results }, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'list') {
    const res = await Promise.resolve(reviewService.listItems(Object.assign({}, common, { status: args.status, expired: args.expired })));
    printList(res);
    return;
  }

  if (cmd === 'show') {
    if (!args.id) {
      console.error('usage: show --id=<candidateId>');
      process.exit(1);
    }
    const res = await Promise.resolve(reviewService.showItem(args.id, common));
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'approve') {
    const res = await Promise.resolve(reviewService.transitionItem(args.id, lifecycle.REVIEW_STATUS.APPROVED, Object.assign({}, common, { action: 'approve' })));
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'hold') {
    const res = await Promise.resolve(
      reviewService.transitionItem(
        args.id,
        lifecycle.REVIEW_STATUS.HELD,
        Object.assign({}, common, { reason: args.reason, action: 'hold' }),
      ),
    );
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'reject') {
    const res = await Promise.resolve(
      reviewService.transitionItem(
        args.id,
        lifecycle.REVIEW_STATUS.REJECTED,
        Object.assign({}, common, { reason: args.reason, action: 'reject' }),
      ),
    );
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'publish') {
    if (args.updateExisting) {
      const res = await Promise.resolve(
        reviewService.applyUpdateExisting(args.id, Object.assign({}, common, { updateExisting: args.updateExisting })),
      );
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok) process.exit(1);
      return;
    }
    if (args.publishAsFollowUp) {
      const res = await Promise.resolve(
        reviewService.transitionItem(
          args.id,
          lifecycle.REVIEW_STATUS.PUBLISHED,
          Object.assign({}, common, { followUpOf: args.publishAsFollowUp, action: 'publish' }),
        ),
      );
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok) process.exit(1);
      return;
    }
    const res = await Promise.resolve(
      reviewService.transitionItem(args.id, lifecycle.REVIEW_STATUS.PUBLISHED, Object.assign({}, common, { action: 'publish' })),
    );
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'expire' || cmd === 'expire-all') {
    if (cmd === 'expire' && args.id) {
      const res = await Promise.resolve(
        reviewService.transitionItem(
          args.id,
          lifecycle.REVIEW_STATUS.EXPIRED,
          Object.assign({}, common, { forceExpire: true, action: 'expire' }),
        ),
      );
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok) process.exit(1);
      return;
    }
    const res = await Promise.resolve(reviewService.expireDueItems(common));
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === 'retire') {
    if (!args.id) {
      const res = await Promise.resolve(reviewService.retireDuePublished(common));
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    const res = await Promise.resolve(
      reviewService.transitionItem(
        args.id,
        lifecycle.REVIEW_STATUS.RETIRED,
        Object.assign({}, common, { reason: args.reason || 'MANUAL_RETIRE', action: 'retire' }),
      ),
    );
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'revalidate') {
    const res = await Promise.resolve(reviewService.revalidateItem(args.id, common));
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'history') {
    const res = await Promise.resolve(reviewService.readHistory(common));
    console.log(JSON.stringify(res.events, null, 2));
    return;
  }

  if (cmd === 'build-bundle') {
    const res = await Promise.resolve(
      reviewService.buildBundle(Object.assign({}, common, { output: args.output, autoRetire: args.autoRetire })),
    );
    console.log(
      JSON.stringify(
        {
          ok: res.ok,
          publishedCount: res.bundle && res.bundle.publishedCount,
          categories: res.bundle && Object.keys(res.bundle.categories || {}),
          output: args.output || null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'release-hold') {
    const res = await Promise.resolve(
      reviewService.transitionItem(
        args.id,
        lifecycle.REVIEW_STATUS.READY_FOR_REVIEW,
        Object.assign({}, common, { action: 'release_hold' }),
      ),
    );
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  console.error('unknown command:', cmd);
  console.error(
    'commands: enqueue list show approve hold reject publish expire expire-all retire revalidate history build-bundle release-hold',
  );
  process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
