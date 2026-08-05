#!/usr/bin/env node
'use strict';

/**
 * JSON repository 집중 스모크 — 전체 contract는 test-daily-issue-repository-contract.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJsonDailyIssueReviewRepository } = require('../server/daily-issue-review-json-repository');
const contract = require('../shared/daily-issue-review-repository-contract');

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-json-repo-'));
const repo = createJsonDailyIssueReviewRepository({ reviewRoot: root });
const init = repo.initialize();
ok('initialize', init.ok !== false);

const shape = contract.assertRepositoryContract(repo);
ok('contract methods', shape.ok);

const list = repo.list({});
ok('empty list', list.ok && Array.isArray(list.items) && list.items.length === 0);

const health = repo.healthCheck();
ok('healthCheck', health.ok !== false);

try {
  fs.rmSync(root, { recursive: true, force: true });
} catch (_) {}

console.log('\n=== json repository smoke: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed ? 1 : 0);
