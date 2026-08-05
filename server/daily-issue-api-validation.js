'use strict';

/**
 * 데일리 이슈 API 입력 검증
 */

const lifecycle = require('../shared/daily-issue-lifecycle-core');

const CATEGORIES = Object.freeze(['world', 'korea-economy', 'korea-policy', 'society', 'tech', 'other']);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_REASON_TEXT = 500;
const MAX_REVIEWER_ID = 80;

function fail(code, details) {
  return { ok: false, error: code, details: details || null };
}

function ok(data) {
  return { ok: true, data: data };
}

function parseLimit(raw, fallback) {
  if (raw == null || raw === '') return ok(fallback != null ? fallback : DEFAULT_LIMIT);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fail('INVALID_LIMIT');
  if (n > MAX_LIMIT) return ok(MAX_LIMIT);
  return ok(n);
}

function parseOffset(raw) {
  if (raw == null || raw === '') return ok(0);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fail('BAD_REQUEST', { field: 'offset' });
  return ok(n);
}

function parseId(raw) {
  const id = String(raw == null ? '' : raw).trim();
  if (!id || id.length > 200) return fail('INVALID_ID');
  if (!/^[A-Za-z0-9_.:\-]+$/.test(id)) return fail('INVALID_ID');
  return ok(id);
}

function parseStatus(raw) {
  if (raw == null || raw === '') return ok(null);
  const s = String(raw).trim();
  if (!lifecycle.REVIEW_STATUS[s] && !Object.values(lifecycle.REVIEW_STATUS).includes(s)) {
    return fail('VALIDATION_ERROR', { field: 'status' });
  }
  return ok(s);
}

function parseCategory(raw) {
  if (raw == null || raw === '') return ok(null);
  const c = String(raw).trim();
  if (CATEGORIES.indexOf(c) < 0) return fail('INVALID_CATEGORY');
  return ok(c);
}

function requireJsonContentType(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return ok(true);
  const ct = String((req.headers && (req.headers['content-type'] || req.headers['Content-Type'])) || '');
  if (!ct || ct.indexOf('application/json') < 0) return fail('INVALID_CONTENT_TYPE');
  return ok(true);
}

function parseTransitionBody(body, options) {
  const opt = options || {};
  const b = body && typeof body === 'object' ? body : {};
  if (b.expectedStatus == null || String(b.expectedStatus).trim() === '') {
    return fail('EXPECTED_STATUS_REQUIRED');
  }
  if (b.expectedLockVersion == null || b.expectedLockVersion === '') {
    return fail('EXPECTED_LOCK_VERSION_REQUIRED');
  }
  const lock = Number(b.expectedLockVersion);
  if (!Number.isInteger(lock) || lock < 1) {
    return fail('VALIDATION_ERROR', { field: 'expectedLockVersion' });
  }
  const status = String(b.expectedStatus).trim();
  if (!Object.values(lifecycle.REVIEW_STATUS).includes(status)) {
    return fail('VALIDATION_ERROR', { field: 'expectedStatus' });
  }

  const out = {
    expectedStatus: status,
    expectedLockVersion: lock,
    reviewerId: String(b.reviewerId || b.reviewer || 'api-admin').trim().slice(0, MAX_REVIEWER_ID),
    reasonText: String(b.reasonText || '').trim().slice(0, MAX_REASON_TEXT),
  };

  if (opt.requireReason) {
    const code = String(b.reasonCode || b.reason || '').trim();
    if (!code) return fail(opt.reasonError || 'VALIDATION_ERROR');
    const allow = opt.reasonAllowlist || {};
    if (!allow[code]) return fail('REASON_CODE_INVALID', { reasonCode: code });
    out.reasonCode = code;
  }

  return ok(out);
}

module.exports = {
  CATEGORIES: CATEGORIES,
  MAX_LIMIT: MAX_LIMIT,
  DEFAULT_LIMIT: DEFAULT_LIMIT,
  parseLimit: parseLimit,
  parseOffset: parseOffset,
  parseId: parseId,
  parseStatus: parseStatus,
  parseCategory: parseCategory,
  requireJsonContentType: requireJsonContentType,
  parseTransitionBody: parseTransitionBody,
};
