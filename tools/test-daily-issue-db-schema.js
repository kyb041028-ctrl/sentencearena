#!/usr/bin/env node
'use strict';

/**
 * DB migration SQL 정적 검증 (운영 DB 미실행)
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migration_daily_issue_review_lifecycle.sql');
let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

const sql = fs.readFileSync(MIGRATION, 'utf8');

const requiredTables = [
  'daily_issue_review_items',
  'daily_issue_sources',
  'daily_issue_evidences',
  'daily_issue_claims',
  'daily_issue_review_item_sources',
  'daily_issue_review_item_evidences',
  'daily_issue_review_item_claims',
  'daily_issue_claim_evidences',
  'daily_issue_claim_sources',
  'daily_issue_updates',
  'daily_issue_audit_logs',
  'daily_issue_repository_meta',
];

requiredTables.forEach(function (t) {
  ok('table ' + t, new RegExp('CREATE TABLE IF NOT EXISTS public\\.' + t + '\\b').test(sql));
});

[
  'candidate_id',
  'status',
  'lock_version',
  'content_signature',
  'cluster_signature',
  'source_set_signature',
  'claim_set_signature',
  'event_identity_signature',
  'expires_at',
  'publish_expires_at',
  'quality_meta',
  'freshness_meta',
  'duplicate_meta',
  'event_identity',
  'update_history',
  'document',
].forEach(function (col) {
  ok('review_items column ' + col, sql.indexOf(col) >= 0);
});

ok('status check constraint', /daily_issue_review_items_status_chk/.test(sql));
ok('READY_FOR_REVIEW enum value', /READY_FOR_REVIEW/.test(sql));
ok('UPDATE_PENDING enum value', /UPDATE_PENDING/.test(sql));
ok('candidate_id+version unique', /candidate_version_uq|UNIQUE \(candidate_id, version\)/.test(sql));
ok('lock_version present', /lock_version integer NOT NULL DEFAULT 1/.test(sql));
ok('audit log table', /daily_issue_audit_logs/.test(sql));
ok('FK evidence→source', /REFERENCES public\.daily_issue_sources\(id\)/.test(sql));
ok('signature indexes', /idx_daily_issue_review_items_content_sig/.test(sql));
ok('expires index', /idx_daily_issue_review_items_expires/.test(sql));
ok('publish_expires index', /idx_daily_issue_review_items_publish_expires/.test(sql));
ok('no DROP TABLE in body (except comment)', !/^\s*DROP TABLE/im.test(sql.split('Rollback')[0]));
ok('no TRUNCATE executable', !/^\s*TRUNCATE\b/im.test(sql));
ok('RLS enable', /ENABLE ROW LEVEL SECURITY/.test(sql));
ok('no profiles/alignment table change', !/profiles|alignment_score|user_alignment/i.test(sql));
ok('classification claim check', /CONFIRMED_FACT/.test(sql) && /REJECTED/.test(sql));
ok('raw_text_storage_policy', /OMIT_FULL_TEXT/.test(sql));
ok('미적용 경고 주석', /자동 적용하지 않음/.test(sql));

console.log('\n=== db schema static:', passed, 'passed,', failed, 'failed ===');
process.exit(failed ? 1 : 0);
