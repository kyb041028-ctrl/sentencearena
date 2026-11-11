'use strict';

/**
 * Daily Issue 격리 DB URL 검증 — 127.0.0.1 전용, 운영 Supabase·원격 거부.
 */

const { isAllowedTestSchema } = require('../../server/daily-issue-pg-client');

const REFUSED_PROD_HOST = /supabase\.(co|com)|pooler\.supabase|aws-0-[a-z0-9-]+\.pooler/i;
const REFUSED_USER_DB = /^(postgres|sentencearena_prod|production)$/i;

function assertDailyIssueIsolatedTarget(rawUrl, schemaName) {
  if (!rawUrl || !String(rawUrl).trim()) {
    return { ok: false, reason: 'DAILY_ISSUE_DATABASE_URL missing' };
  }
  const schema = String(schemaName || 'daily_issue_test').trim();
  if (!isAllowedTestSchema(schema)) {
    return { ok: false, reason: 'REFUSED_SCHEMA', schema: schema };
  }
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch (_) {
    return { ok: false, reason: 'URL_PARSE_FAILED' };
  }
  const host = String(parsed.hostname || '').toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    return { ok: false, reason: 'REFUSED_NON_LOCAL_HOST', host: host };
  }
  if (REFUSED_PROD_HOST.test(String(rawUrl))) {
    return { ok: false, reason: 'REFUSED_SUPABASE' };
  }
  const db = decodeURIComponent(String(parsed.pathname || '').replace(/^\//, ''));
  if (REFUSED_USER_DB.test(db)) {
    return { ok: false, reason: 'REFUSED_DATABASE_NAME', database: db };
  }
  return { ok: true, host: host, database: db, schema: schema };
}

module.exports = {
  assertDailyIssueIsolatedTarget: assertDailyIssueIsolatedTarget,
};
