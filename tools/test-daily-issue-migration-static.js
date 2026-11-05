#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const core = require('../shared/daily-issue-production-migration-core');
const orders = require('../shared/migration-preflight-orders');

const ORDER = [
  'review_lifecycle',
  'morning_scheduler',
  'alignment_seed',
  'comments',
  'account_withdrawal',
  'ops_workflow',
  'us_region_candidate',
  'phase19_safety',
];

const FILES = {
  review_lifecycle: 'migration_daily_issue_review_lifecycle.sql',
  morning_scheduler: 'migration_daily_issue_morning_scheduler.sql',
  alignment_seed: 'migration_daily_issue_alignment_seed_v1.sql',
  comments: 'migration_daily_issue_comments_v1.sql',
  account_withdrawal: 'migration_daily_issue_account_withdrawal_v1.sql',
  ops_workflow: 'migration_daily_issue_ops_workflow_v1.sql',
  us_region_candidate: 'migration_daily_issue_us_region_candidate.sql',
  phase19_safety: 'migration_daily_issue_phase19_safety_v1.sql',
};

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

const loaded = ORDER.map(function (id, index) {
  const relativePath = path.join('supabase', FILES[id]);
  const sql = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  core.assertNoDestructiveSql(sql);
  const rewritten = core.rewriteSchema(sql, 'daily_issue');
  core.assertNoDestructiveSql(rewritten);
  return { id: id, order: index + 1, sql: sql, rewrittenSql: rewritten };
});

ok('S1. 8개 순서', loaded.map(function (m) { return m.id; }).join(',') === ORDER.join(','));
ok('S2. public.daily_issue_ 가 daily_issue.daily_issue_ 로 바뀜', loaded.every(function (m) {
  return m.rewrittenSql.indexOf('daily_issue.daily_issue_') >= 0 && !/\bpublic\.daily_issue_/.test(m.rewrittenSql);
}));
ok('S3. auth.users 참조는 유지', loaded.some(function (m) {
  return m.rewrittenSql.indexOf('REFERENCES auth.users(id)') >= 0;
}));
ok('S4. service_role GRANT 없음', loaded.every(function (m) {
  return !/\bGRANT\b[\s\S]{0,200}\bservice_role\b/i.test(m.rewrittenSql);
}));
ok('S5. 적용 목록은 8개', core.MIGRATION_FILES.map(function (m) { return m.id; }).join(',') === ORDER.join(','));

const unscoped = core.findUnscopedConstraintLookups(loaded);
ok('S6. 공식 8개의 제약 조회는 regclass에 묶임', unscoped.length === 0);

const proposalPath = path.join(__dirname, '..', 'docs', 'candidates', 'daily-issue-constraint-lookup-proposal.sql');
const proposalSql = fs.readFileSync(proposalPath, 'utf8');
const proposalRewritten = core.rewriteSchema(proposalSql, 'daily_issue');
ok('S7. 수정안은 실행 목록에 없음', core.MIGRATION_FILES.every(function (m) {
  return m.fileName !== 'daily-issue-constraint-lookup-proposal.sql';
}));
ok('S8. 수정안 rewrite 후 regclass가 daily_issue 테이블', proposalRewritten.indexOf("'daily_issue.daily_issue_review_items'::regclass") >= 0 &&
  proposalRewritten.indexOf("'daily_issue.daily_issue_comments'::regclass") >= 0 &&
  proposalRewritten.indexOf("'daily_issue.daily_issue_reactions'::regclass") >= 0 &&
  proposalRewritten.indexOf("'daily_issue.daily_issue_scheduler_runs'::regclass") >= 0 &&
  !/\bpublic\.daily_issue_/.test(proposalRewritten));
ok('S9. 수정안에 GRANT 없음', !/\bGRANT\b/i.test(proposalRewritten));
const regionFile = loaded.find(function (m) { return m.id === 'us_region_candidate'; });
ok('S10. 지역 함수는 us_region에만 있고 service_role GRANT가 없음', /CREATE OR REPLACE FUNCTION public\.daily_issue_child_region_match/.test(regionFile.sql) &&
  /CREATE OR REPLACE FUNCTION public\.daily_issue_parent_region_cascade/.test(regionFile.sql) &&
  loaded.filter(function (m) { return /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(m.sql); }).length === 1 &&
  !/\bGRANT\b/i.test(regionFile.sql));
ok('S11. CHECK 정의는 부모 이슈를 보지 않음', /CHECK \(activity_region IS NULL OR activity_region IN \('KR', 'US'\)\)/.test(regionFile.sql) &&
  regionFile.sql.indexOf('SELECT activity_region INTO parent_region') >= 0);
ok('S12. recollect FK는 대상 테이블 regclass로 찾음', /daily_issue_recollect_jobs_review_item_id_fkey[\s\S]+conrelid = 'public\.daily_issue_recollect_jobs'::regclass/.test(
  loaded.find(function (m) { return m.id === 'ops_workflow'; }).sql,
));
ok(
  'S13. 게이트 적용 목록은 8개이고 중복이 없음',
  core.MIGRATION_FILES.length === 8 &&
    orders.STAGING_DAILY_ISSUE_ALL.length === 8 &&
    new Set(orders.STAGING_DAILY_ISSUE_ALL).size === 8,
);

console.log('\nOK', passed);
