'use strict';

/**
 * 데일리 이슈 검수 repository factory
 *
 * DAILY_ISSUE_REPOSITORY=json|db (기본: json)
 * db 선택 후 연결 실패 시 JSON으로 자동 fallback 하지 않음.
 */

const contract = require('../shared/daily-issue-review-repository-contract');
const { createJsonDailyIssueReviewRepository } = require('./daily-issue-review-json-repository');
const { createDbDailyIssueReviewRepository } = require('./daily-issue-review-db-repository');

function resolveKind(config) {
  const cfg = config || {};
  if (cfg.kind) return String(cfg.kind).toLowerCase();
  if (cfg.repository) return String(cfg.repository).toLowerCase();
  const env = String(process.env.DAILY_ISSUE_REPOSITORY || 'json').toLowerCase();
  return env || 'json';
}

/**
 * @param {object} [config]
 * @param {string} [config.kind] json|db|fake-db
 * @param {string} [config.reviewRoot] JSON root
 * @param {object} [config.client] DB client (optional)
 * @param {boolean} [config.fake] force fake DB
 */
function createDailyIssueReviewRepository(config) {
  const cfg = config || {};
  const kind = resolveKind(cfg);

  if (kind === 'json') {
    const repo = createJsonDailyIssueReviewRepository({ reviewRoot: cfg.reviewRoot });
    const checked = contract.assertRepositoryContract(repo);
    if (!checked.ok) {
      throw new Error('JSON repository missing methods: ' + (checked.missing || []).join(','));
    }
    return repo;
  }

  if (kind === 'fake-db' || kind === 'fake' || cfg.fake === true) {
    const repo = createDbDailyIssueReviewRepository({ fake: true, reviewRoot: cfg.reviewRoot });
    const checked = contract.assertRepositoryContract(repo);
    if (!checked.ok) {
      throw new Error('Fake DB repository missing methods: ' + (checked.missing || []).join(','));
    }
    return repo;
  }

  if (kind === 'db') {
    // Explicit DB — never fall back to JSON; never auto-use DATABASE_URL
    const dbOpts = {
      client: cfg.client,
      fake: false,
      executor: cfg.executor,
      query: cfg.query,
      withTransaction: cfg.withTransaction,
      schemaName: cfg.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
      Pool: cfg.Pool,
      pool: cfg.pool,
    };
    // Only forward when explicitly set — undefined must not block env URL resolution
    if (Object.prototype.hasOwnProperty.call(cfg, 'databaseUrl') && cfg.databaseUrl !== undefined) {
      dbOpts.databaseUrl = cfg.databaseUrl;
    }
    if (Object.prototype.hasOwnProperty.call(cfg, 'enabled') && cfg.enabled !== undefined) {
      dbOpts.enabled = cfg.enabled;
    }
    const repo = createDbDailyIssueReviewRepository(dbOpts);
    return repo;
  }

  throw new Error('Unknown repository kind: ' + kind);
}

module.exports = {
  createDailyIssueReviewRepository: createDailyIssueReviewRepository,
  resolveKind: resolveKind,
  ERROR_CODES: contract.ERROR_CODES,
  REPOSITORY_KINDS: contract.REPOSITORY_KINDS,
  assertRepositoryContract: contract.assertRepositoryContract,
};
