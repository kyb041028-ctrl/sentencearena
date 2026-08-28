'use strict';

/**
 * 데일리 이슈 API 오류 매핑
 */

const crypto = require('crypto');
const contract = require('../shared/daily-issue-review-repository-contract');

const HTTP = Object.freeze({
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
});

function newRequestId() {
  return 'req_' + crypto.randomBytes(8).toString('hex');
}

function mapErrorCode(code) {
  const c = String(code || '');
  if (
    c === 'UNAUTHORIZED' ||
    c === 'ADMIN_TOKEN_MISSING' ||
    c === 'ADMIN_TOKEN_INVALID' ||
    c === 'ADMIN_TOKEN_NOT_CONFIGURED' ||
    c === 'ADMIN_AUTH_NOT_CONFIGURED'
  ) {
    return { status: HTTP.UNAUTHORIZED, code: c };
  }
  if (c === 'FORBIDDEN' || c === 'QUERY_TOKEN_FORBIDDEN' || c === 'ADMIN_ROLE_MISSING' || c === 'ADMIN_ROLE_FORBIDDEN' || c === 'COMMENT_FORBIDDEN' || c === 'LEGAL_GATE_INCOMPLETE' || c === 'AGE_CONFIRM_REQUIRED' || c === 'SANCTION_WRITE_RESTRICTED' || c === 'SANCTION_ACCOUNT_RESTRICTED' || c === 'SANCTION_TEMP_SUSPENDED' || c === 'SANCTION_PERMANENT_BAN') {
    return { status: HTTP.FORBIDDEN, code: c };
  }
  if (c === contract.ERROR_CODES.ITEM_NOT_FOUND || c === 'NOT_FOUND' || c === 'COMMENT_NOT_FOUND') {
    return { status: HTTP.NOT_FOUND, code: c === 'COMMENT_NOT_FOUND' ? 'COMMENT_NOT_FOUND' : contract.ERROR_CODES.ITEM_NOT_FOUND };
  }
  if (
    c === contract.ERROR_CODES.STALE_VERSION ||
    c === contract.ERROR_CODES.CONCURRENT_MODIFICATION ||
    c === contract.ERROR_CODES.STATUS_CHANGED ||
    c === contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION ||
    c === contract.ERROR_CODES.INVALID_STATE_TRANSITION ||
    c === 'INVALID_STATE_TRANSITION' ||
    c === 'INVALID_TRANSITION'
  ) {
    return {
      status: HTTP.CONFLICT,
      code: c === 'INVALID_TRANSITION' ? 'INVALID_STATE_TRANSITION' : c,
    };
  }
  if (
    c === 'HOLD_REASON_REQUIRED' ||
    c === 'REJECT_REASON_REQUIRED' ||
    c === 'RETIRE_REASON_REQUIRED' ||
    c === 'APPROVE_BLOCKED' ||
    c === 'PUBLISH_BLOCKED' ||
    c === 'OPS_BLOCKED' ||
    c === 'INSTRUCTION_REQUIRED' ||
    c === 'DUPLICATE_JOB' ||
    c === 'ALREADY_PUBLISHED_SAME' ||
    c === 'JOB_KEY_REQUIRED' ||
    c === 'VERSION_NOT_FOUND' ||
    c === 'INVALID_DELAY_PRESET' ||
    c === 'INVALID_CUSTOM_DELAY' ||
    c === 'OPERATOR_APPROVAL_REQUIRED' ||
    c === 'NOT_YET_EXPIRED' ||
    c === 'VALIDATION_ERROR' ||
    c === 'REASON_CODE_INVALID' ||
    c === 'EXPECTED_STATUS_REQUIRED' ||
    c === 'EXPECTED_LOCK_VERSION_REQUIRED' ||
    c === 'INVALID_CONTENT_TYPE' ||
    c === 'ALIGNMENT_DIRECTION_INVALID' ||
    c === 'REACTION_TYPE_INVALID' ||
    c === 'COMMENT_BODY_REQUIRED' ||
    c === 'COMMENT_TOO_LONG'
  ) {
    return { status: HTTP.UNPROCESSABLE, code: c };
  }
  if (c === 'RATE_LIMITED') {
    return { status: HTTP.TOO_MANY, code: c };
  }
  if (
    c === contract.ERROR_CODES.DATABASE_UNAVAILABLE ||
    c === contract.ERROR_CODES.MIGRATION_REQUIRED ||
    c === contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED
  ) {
    return { status: HTTP.UNAVAILABLE, code: c };
  }
  if (c === 'BAD_REQUEST' || c === 'INVALID_ID' || c === 'INVALID_LIMIT' || c === 'INVALID_CATEGORY') {
    return { status: HTTP.BAD_REQUEST, code: c };
  }
  return { status: HTTP.INTERNAL, code: 'INTERNAL_ERROR' };
}

function publicMessage(code) {
  const messages = {
    ADMIN_TOKEN_MISSING: 'Admin authorization required',
    ADMIN_TOKEN_INVALID: 'Admin authorization invalid',
    ADMIN_TOKEN_NOT_CONFIGURED: 'Admin API token is not configured',
    ADMIN_AUTH_NOT_CONFIGURED: 'Admin auth is not configured',
    ADMIN_ROLE_MISSING: 'Admin role is missing',
    ADMIN_ROLE_FORBIDDEN: 'Admin role is not allowed',
    QUERY_TOKEN_FORBIDDEN: 'Token must not be passed via query string',
    ITEM_NOT_FOUND: 'Item not found',
    STALE_VERSION: 'Stale lock version',
    CONCURRENT_MODIFICATION: 'Concurrent modification',
    STATUS_CHANGED: 'Status changed',
    INVALID_STATE_TRANSITION: 'Invalid state transition',
    DUPLICATE_CANDIDATE_VERSION: 'Duplicate candidate version',
    DATABASE_UNAVAILABLE: 'Database unavailable',
    RATE_LIMITED: 'Too many requests',
    VALIDATION_ERROR: 'Validation failed',
    EXPECTED_STATUS_REQUIRED: 'expectedStatus is required',
    EXPECTED_LOCK_VERSION_REQUIRED: 'expectedLockVersion is required',
    HOLD_REASON_REQUIRED: 'hold reasonCode required',
    REJECT_REASON_REQUIRED: 'reject reasonCode required',
    RETIRE_REASON_REQUIRED: 'retire reasonCode required',
    APPROVE_BLOCKED: 'Approve blocked by policy',
    PUBLISH_BLOCKED: 'Publish blocked by policy',
    OPS_BLOCKED: 'Operator action blocked',
    INSTRUCTION_REQUIRED: 'Revision instruction is required',
    DUPLICATE_JOB: 'Duplicate recrawl reservation',
    ALREADY_PUBLISHED_SAME: 'Already published for this candidate',
    JOB_KEY_REQUIRED: 'Recrawl job key is required',
    VERSION_NOT_FOUND: 'Draft version not found',
    INVALID_DELAY_PRESET: 'Invalid recrawl delay',
    INVALID_CUSTOM_DELAY: 'Invalid custom recrawl delay',
    OPERATOR_APPROVAL_REQUIRED: 'Operator approval required before publish',
    INVALID_CONTENT_TYPE: 'Content-Type must be application/json',
    ALIGNMENT_DIRECTION_INVALID: 'alignmentDirection must be PIONEER, GUARDIAN, or NEUTRAL',
    REACTION_TYPE_INVALID: 'reactionType must be LIKE or DISLIKE',
    COMMENT_BODY_REQUIRED: 'Comment body is required',
    COMMENT_TOO_LONG: 'Comment exceeds max length',
    COMMENT_NOT_FOUND: 'Comment not found',
    COMMENT_FORBIDDEN: 'Not allowed to delete this comment',
    INTERNAL_ERROR: 'Internal error',
  };
  return messages[code] || 'Request failed';
}

function sendOk(res, data, status) {
  const requestId = res.locals && res.locals.requestId;
  return res.status(status || HTTP.OK).json({
    ok: true,
    requestId: requestId || null,
    data: data,
  });
}

function sendFail(res, code, details, overrideStatus) {
  const mapped = mapErrorCode(code);
  const requestId = res.locals && res.locals.requestId;
  const status = overrideStatus || mapped.status;
  const safeCode = mapped.code === 'INTERNAL_ERROR' ? 'INTERNAL_ERROR' : mapped.code;
  return res.status(status).json({
    ok: false,
    requestId: requestId || null,
    error: {
      code: safeCode,
      message: publicMessage(safeCode),
      details: details && typeof details === 'object' ? sanitizeDetails(details) : null,
    },
  });
}

function sanitizeDetails(details) {
  try {
    const raw = JSON.stringify(details);
    if (/password|DATABASE_URL|SERVICE_ROLE|Bearer\s+\S+/i.test(raw)) {
      return { note: 'details omitted' };
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function fromServiceResult(result) {
  if (!result || result.ok) return null;
  return result.error || 'INTERNAL_ERROR';
}

module.exports = {
  HTTP: HTTP,
  newRequestId: newRequestId,
  mapErrorCode: mapErrorCode,
  publicMessage: publicMessage,
  sendOk: sendOk,
  sendFail: sendFail,
  fromServiceResult: fromServiceResult,
  sanitizeDetails: sanitizeDetails,
};
