#!/usr/bin/env node
'use strict';

/**
 * JSON → DB migration plan dry-run (운영 write 기본 비활성)
 *
 * --input-dir=.cache/daily-issue/review
 * --dry-run --validate-only --output-plan=<path>
 * --apply 는 DATABASE_URL 없으면 DATABASE_UNAVAILABLE
 */

const fs = require('fs');
const path = require('path');
const contract = require('../shared/daily-issue-review-repository-contract');
const { loadStore, listAuditEvents, resolveReviewRoot } = require('../server/daily-issue-review-json-repository');
const lifecycle = require('../shared/daily-issue-lifecycle-core');

function parseArgs(argv) {
  const out = { dryRun: true, validateOnly: false, apply: false, confirmApply: false };
  argv.forEach(function (a) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--validate-only') out.validateOnly = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--confirm-dev-apply') out.confirmApply = true;
    else if (a.startsWith('--input-dir=')) out.inputDir = a.slice(12);
    else if (a.startsWith('--source-dir=')) out.inputDir = a.slice(12);
    else if (a.startsWith('--output-plan=')) out.outputPlan = a.slice(14);
    else if (a.startsWith('--repository=')) out.repository = a.slice(13);
  });
  return out;
}

function validateItem(item, errors) {
  if (!item.id || !item.candidateId) errors.push('MISSING_ID:' + (item.title || '?'));
  if (!lifecycle.ALLOWED_TRANSITIONS[item.status] && item.status !== 'PUBLISHED' && item.status !== 'REJECTED' && item.status !== 'EXPIRED' && item.status !== 'RETIRED' && item.status !== 'SUPERSEDED' && item.status !== 'UPDATE_PENDING' && item.status !== 'APPROVED' && item.status !== 'HELD' && item.status !== 'READY_FOR_REVIEW') {
    errors.push('INVALID_STATUS:' + item.status);
  }
  if (!(item.sourceRefs || []).length) errors.push('NO_SOURCES:' + item.id);
  if (!(item.claims || []).length) errors.push('NO_CLAIMS:' + item.id);
  if (!Number.isFinite(Number(item.lockVersion || 1))) errors.push('BAD_LOCK:' + item.id);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = resolveReviewRoot(args.inputDir || path.join(__dirname, '..', '.cache', 'daily-issue', 'review'));

  if (args.apply) {
    const diUrl = process.env.DAILY_ISSUE_DATABASE_URL;
    if (!diUrl || args.repository !== 'db') {
      console.error(
        JSON.stringify({
          ok: false,
          error: contract.ERROR_CODES.DATABASE_UNAVAILABLE,
          message: '--apply blocked without DAILY_ISSUE_DATABASE_URL and --repository=db (DATABASE_URL not auto-used)',
        }),
      );
      process.exit(1);
    }
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
      console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
      process.exit(1);
    }
    if (!args.confirmApply) {
      console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED', message: 'Pass --confirm-dev-apply' }));
      process.exit(1);
    }
  }

  let store;
  try {
    store = loadStore(inputDir);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.code || 'LOAD_FAILED', message: String(e.message || e) }));
    process.exit(1);
  }

  const items = []
    .concat(store.queue.items || [])
    .concat(store.published.items || [])
    .concat(store.rejected.items || [])
    .concat(store.retired.items || []);

  const errors = [];
  const seen = {};
  items.forEach(function (it) {
    validateItem(it, errors);
    const key = contract.candidateVersionKey(it);
    if (seen[key]) errors.push('DUPLICATE_CANDIDATE_VERSION:' + key);
    seen[key] = 1;
  });

  let audits = [];
  try {
    audits = listAuditEvents(inputDir);
  } catch (_) {}

  const plan = {
    ok: errors.length === 0,
    dryRun: true,
    inputDir: inputDir,
    itemCount: items.length,
    auditCount: audits.length,
    byStatus: items.reduce(function (acc, it) {
      acc[it.status] = (acc[it.status] || 0) + 1;
      return acc;
    }, {}),
    errors: errors,
    note: 'No DB write performed. Operational migration not executed.',
  };

  if (args.outputPlan) {
    fs.mkdirSync(path.dirname(path.resolve(args.outputPlan)), { recursive: true });
    fs.writeFileSync(path.resolve(args.outputPlan), JSON.stringify(plan, null, 2), 'utf8');
    console.log('wrote plan', path.resolve(args.outputPlan));
  }
  console.log(JSON.stringify(plan, null, 2));
  process.exit(plan.ok ? 0 : 1);
}

main();
