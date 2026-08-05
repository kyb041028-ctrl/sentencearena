'use strict';

/**
 * 데일리 이슈 검수 저장소 공통 계약
 * — JSON / DB 구현체가 동일 오류 코드·정규화를 사용한다.
 * 상태 전환 정책은 lifecycle-core / review-core에 남긴다.
 */

const ERROR_CODES = Object.freeze({
  REPOSITORY_NOT_INITIALIZED: 'REPOSITORY_NOT_INITIALIZED',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  DUPLICATE_CANDIDATE_VERSION: 'DUPLICATE_CANDIDATE_VERSION',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  STALE_VERSION: 'STALE_VERSION',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  STATUS_CHANGED: 'STATUS_CHANGED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  AUDIT_WRITE_FAILED: 'AUDIT_WRITE_FAILED',
  HISTORY_APPEND_FAILED: 'HISTORY_APPEND_FAILED',
  PERSIST_FAILED: 'PERSIST_FAILED',
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
  DESERIALIZATION_FAILED: 'DESERIALIZATION_FAILED',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  MIGRATION_REQUIRED: 'MIGRATION_REQUIRED',
  FATAL_ROLLBACK_FAILED: 'FATAL_ROLLBACK_FAILED',
  PATH_TRAVERSAL_BLOCKED: 'PATH_TRAVERSAL_BLOCKED',
  JSON_PARSE_FAILED: 'JSON_PARSE_FAILED',
  NOT_FOUND: 'NOT_FOUND',
});

const REPOSITORY_KINDS = Object.freeze({
  JSON: 'json',
  DB: 'db',
  FAKE_DB: 'fake-db',
});

const CONTRACT_METHODS = Object.freeze([
  'initialize',
  'healthCheck',
  'getById',
  'getByCandidateId',
  'findByStatus',
  'list',
  'findDuplicateMatches',
  'insertReviewItems',
  'transitionReviewItem',
  'applyExistingIssueUpdate',
  'getPublishedIssues',
  'getRecentHistoricalIssues',
  'listAuditEvents',
  'buildManifestSnapshot',
  'withTransaction',
]);

function normalizeReviewItem(raw) {
  const item = raw && typeof raw === 'object' ? Object.assign({}, raw) : {};
  const lv = Number(item.lockVersion);
  item.lockVersion = Number.isFinite(lv) && lv >= 1 ? Math.floor(lv) : 1;
  const ver = Number(item.version);
  item.version = Number.isFinite(ver) && ver >= 1 ? Math.floor(ver) : 1;
  if (!item.id && item.candidateId) item.id = item.candidateId;
  if (!item.candidateId && item.id) item.candidateId = item.id;
  return item;
}

function candidateVersionKey(item) {
  const id = String((item && (item.candidateId || item.id)) || '');
  const ver = Number((item && item.version) || 1);
  return id + '::' + ver;
}

function assertRepositoryContract(repo) {
  if (!repo || typeof repo !== 'object') {
    return { ok: false, error: ERROR_CODES.SCHEMA_VALIDATION_FAILED, missing: CONTRACT_METHODS.slice() };
  }
  const missing = [];
  CONTRACT_METHODS.forEach(function (m) {
    if (typeof repo[m] !== 'function') missing.push(m);
  });
  return missing.length
    ? { ok: false, error: ERROR_CODES.SCHEMA_VALIDATION_FAILED, missing: missing }
    : { ok: true };
}

function repoError(code, message, extra) {
  return Object.assign({ ok: false, error: code, message: message || code }, extra || {});
}

module.exports = {
  ERROR_CODES: ERROR_CODES,
  REPOSITORY_KINDS: REPOSITORY_KINDS,
  CONTRACT_METHODS: CONTRACT_METHODS,
  normalizeReviewItem: normalizeReviewItem,
  candidateVersionKey: candidateVersionKey,
  assertRepositoryContract: assertRepositoryContract,
  repoError: repoError,
};
