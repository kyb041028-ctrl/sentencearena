#!/usr/bin/env node
'use strict';

/**
 * Isolated embedded Postgres only.
 * Proves a same-named constraint in daily_issue_test does not hide the daily_issue CHECK,
 * and that a column CHECK does not keep a child region equal to its parent.
 */

const assert = require('assert');
const core = require('../shared/daily-issue-production-migration-core');
const { bootDailyIssueLocalPg, TEST_USER } = require('./lib/daily-issue-local-pg-harness');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

async function main() {
  const boot = await bootDailyIssueLocalPg({ schemaName: 'daily_issue_test' });
  if (!boot.ok) throw new Error(boot.error || 'BOOT_FAILED');
  const client = boot.client;
  try {
    const names = await client.query(
      "SELECT n.nspname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.conname = 'daily_issue_review_items_alignment_direction_chk'",
    );
    ok('I1. daily_issue_test에 같은 제약 이름이 이미 있음', names.rows.some(function (r) { return r.nspname === 'daily_issue_test'; }));

    await client.query('CREATE SCHEMA IF NOT EXISTS daily_issue');
    const official = core.materializeApplyPlan('daily_issue', {
      env: {
        DAILY_ISSUE_CONFIRM_US_REGION_CANDIDATE: core.EXTENSION_MIGRATION_FILES[0].confirmValue,
        DAILY_ISSUE_CONFIRM_PHASE19_SAFETY: core.EXTENSION_MIGRATION_FILES[1].confirmValue,
      },
    });
    ok('I2. 확인값이 있어도 공식 적용 SQL은 6개', official.ok && official.migrations.length === 6 && official.kind === 'official');
    const blockedPlan = core.materializeApplyPlan('daily_issue', { fileId: 'us_region_candidate', env: {} });
    ok('I2b. 확장 확인값이 없으면 SQL 계획이 비어 있음', blockedPlan.ok === false && blockedPlan.migrations.length === 0);
    const usPlan = core.materializeApplyPlan('daily_issue', {
      fileId: 'us_region_candidate',
      env: { DAILY_ISSUE_CONFIRM_US_REGION_CANDIDATE: core.EXTENSION_MIGRATION_FILES[0].confirmValue },
    });
    const phasePlan = core.materializeApplyPlan('daily_issue', {
      fileId: 'phase19_safety',
      env: { DAILY_ISSUE_CONFIRM_PHASE19_SAFETY: core.EXTENSION_MIGRATION_FILES[1].confirmValue },
    });
    ok(
      'I2c. 확장 확인값이 있으면 각 파일만 실행 대상',
      usPlan.ok && usPlan.migrations.length === 1 && usPlan.migrations[0].id === 'us_region_candidate' &&
        phasePlan.ok && phasePlan.migrations.length === 1 && phasePlan.migrations[0].id === 'phase19_safety',
    );
    const rewritten = official.migrations.concat(usPlan.migrations).concat(phasePlan.migrations);
    for (let i = 0; i < rewritten.length; i += 1) {
      await client.query(rewritten[i].rewrittenSql);
    }

    const both = await client.query(
      "SELECT n.nspname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace JOIN pg_class rel ON rel.oid = c.conrelid WHERE c.conname = 'daily_issue_review_items_alignment_direction_chk' AND rel.relname = 'daily_issue_review_items' ORDER BY 1",
    );
    const schemas = both.rows.map(function (r) { return r.nspname; });
    ok('I3. daily_issue CHECK가 빠지지 않음', schemas.indexOf('daily_issue') >= 0 && schemas.indexOf('daily_issue_test') >= 0);

    let badAlignment = false;
    try {
      await client.query(
        "INSERT INTO daily_issue.daily_issue_review_items (id, candidate_id, status, title, alignment_direction) VALUES ('bad-align', 'bad-align-c', 'READY_FOR_REVIEW', 'Title', 'LEFT')",
      );
    } catch (e) {
      badAlignment = /check/i.test(String(e.message || e));
    }
    ok('I4. daily_issue alignment CHECK가 잘못된 값을 거부', badAlignment);

    await client.query(
      "INSERT INTO daily_issue.daily_issue_review_items (id, candidate_id, status, title, activity_region) VALUES ('us-item', 'us-item-c', 'READY_FOR_REVIEW', 'US title', 'US')",
    );
    const checkDef = await client.query(
      "SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid JOIN pg_namespace n ON n.oid = rel.relnamespace WHERE n.nspname = 'daily_issue' AND rel.relname = 'daily_issue_comments' AND c.conname = 'daily_issue_comments_activity_region_chk'",
    );
    ok('I5. 댓글 CHECK는 부모 이슈를 보지 않음', checkDef.rows.length === 1 && checkDef.rows[0].def.indexOf('daily_issue_review_items') < 0);

    await client.query('BEGIN');
    await client.query('ALTER TABLE daily_issue.daily_issue_comments DISABLE TRIGGER daily_issue_comments_region_match');
    await client.query(
      'INSERT INTO daily_issue.daily_issue_comments (id, issue_id, user_id, body, activity_region) VALUES ($1,$2,$3,$4,$5)',
      ['c-check-only', 'us-item', TEST_USER, 'cross region', 'KR'],
    );
    const parked = await client.query("SELECT activity_region FROM daily_issue.daily_issue_comments WHERE id = 'c-check-only'");
    ok('I6. 트리거를 끄면 CHECK만으로 부모 US와 자식 KR이 통과', parked.rows[0].activity_region === 'KR');
    await client.query('ROLLBACK');

    let mismatch = false;
    try {
      await client.query(
        'INSERT INTO daily_issue.daily_issue_comments (id, issue_id, user_id, body, activity_region) VALUES ($1,$2,$3,$4,$5)',
        ['c-mismatch', 'us-item', TEST_USER, 'cross region', 'KR'],
      );
    } catch (e) {
      mismatch = String(e.message || e).indexOf('daily_issue_region_mismatch') >= 0;
    }
    ok('I7. 트리거가 부모와 다른 자식 지역을 거부', mismatch);

    await client.query(
      'INSERT INTO daily_issue.daily_issue_comments (id, issue_id, user_id, body) VALUES ($1,$2,$3,$4)',
      ['c-copy', 'us-item', TEST_USER, 'copied region'],
    );
    const copied = await client.query("SELECT activity_region FROM daily_issue.daily_issue_comments WHERE id = 'c-copy'");
    ok('I8. 지역을 비운 댓글은 부모 지역을 복사', copied.rows[0].activity_region === 'US');

    let parentLocked = false;
    try {
      await client.query("UPDATE daily_issue.daily_issue_review_items SET activity_region = 'KR' WHERE id = 'us-item'");
    } catch (e) {
      parentLocked = String(e.message || e).indexOf('daily_issue_region_immutable_with_children') >= 0;
    }
    const kept = await client.query("SELECT activity_region FROM daily_issue.daily_issue_comments WHERE id = 'c-copy'");
    const parentStill = await client.query("SELECT activity_region FROM daily_issue.daily_issue_review_items WHERE id = 'us-item'");
    ok('I9. 댓글이 있으면 부모 지역 변경을 거부', parentLocked && parentStill.rows[0].activity_region === 'US');
    ok('I9a. 기존 댓글 지역은 덮이지 않음', kept.rows[0].activity_region === 'US');

    await client.query(
      'INSERT INTO daily_issue.daily_issue_reactions (id, user_id, issue_id, reaction_type, issue_alignment_direction_at_reaction) VALUES ($1,$2,$3,$4,$5)',
      ['r-copy', TEST_USER, 'us-item', 'LIKE', 'NEUTRAL'],
    );
    const reaction = await client.query("SELECT activity_region FROM daily_issue.daily_issue_reactions WHERE id = 'r-copy'");
    ok('I9b. 지역을 비운 반응은 부모 지역을 복사', reaction.rows[0].activity_region === 'US');
    let reactionLocked = false;
    try {
      await client.query("UPDATE daily_issue.daily_issue_review_items SET activity_region = 'KR' WHERE id = 'us-item'");
    } catch (e) {
      reactionLocked = String(e.message || e).indexOf('daily_issue_region_immutable_with_children') >= 0;
    }
    const reactionKept = await client.query("SELECT activity_region FROM daily_issue.daily_issue_reactions WHERE id = 'r-copy'");
    ok('I9c. 반응이 있어도 부모 변경은 거부되고 반응 값은 유지', reactionLocked && reactionKept.rows[0].activity_region === 'US');

    await client.query(
      "INSERT INTO daily_issue.daily_issue_review_items (id, candidate_id, status, title, activity_region) VALUES ('free-item', 'free-item-c', 'READY_FOR_REVIEW', 'Free title', 'US')",
    );
    await client.query("UPDATE daily_issue.daily_issue_review_items SET activity_region = 'KR' WHERE id = 'free-item'");
    const freeParent = await client.query("SELECT activity_region FROM daily_issue.daily_issue_review_items WHERE id = 'free-item'");
    ok('I9d. 자식이 없으면 부모 지역 변경이 됨', freeParent.rows[0].activity_region === 'KR');

    await client.query(
      "INSERT INTO daily_issue.daily_issue_scheduler_runs (run_key, run_type, scheduled_at, status, activity_region) VALUES ('sched-us', 'COLLECT', now(), 'STARTED', 'US')",
    );
    let badScheduler = false;
    try {
      await client.query(
        "INSERT INTO daily_issue.daily_issue_scheduler_runs (run_key, run_type, scheduled_at, status, activity_region) VALUES ('sched-bad', 'COLLECT', now(), 'STARTED', 'EU')",
      );
    } catch (e) {
      badScheduler = /check/i.test(String(e.message || e));
    }
    const schedTriggers = await client.query(
      "SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'daily_issue' AND c.relname = 'daily_issue_scheduler_runs' AND NOT t.tgisinternal",
    );
    const schedRow = await client.query("SELECT activity_region FROM daily_issue.daily_issue_scheduler_runs WHERE run_key = 'sched-us'");
    ok('I9e. 스케줄 행은 CHECK만 있고 이슈 자식 트리거가 없음', badScheduler && schedTriggers.rows.length === 0 && schedRow.rows[0].activity_region === 'US');

    let orphan = false;
    try {
      await client.query(
        "INSERT INTO daily_issue.daily_issue_recollect_jobs (id, review_item_id, run_key, scheduled_at, status) VALUES ('job-missing', 'missing-item', 'recollect:missing', now(), 'PENDING')",
      );
    } catch (e) {
      orphan = /foreign key/i.test(String(e.message || e));
    }
    ok('I10. 없는 review item 재취합 작업은 FK로 거부', orphan);

    await client.query(
      "INSERT INTO daily_issue.daily_issue_recollect_jobs (id, review_item_id, run_key, scheduled_at, status) VALUES ('job-ok', 'us-item', 'recollect:us-item', now(), 'PENDING')",
    );
    ok('I11. 있는 review item 재취합 작업은 들어감', true);

    const halt = await client.query('SELECT region FROM daily_issue.daily_issue_emergency_halt ORDER BY region');
    ok('I12. phase19 halt 초기 행은 KR과 US', halt.rows.map(function (r) { return r.region; }).join(',') === 'KR,US');
  } finally {
    await boot.shutdown();
  }
  console.log('\nOK', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.message ? e.message : e);
  process.exit(1);
});
