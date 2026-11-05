'use strict';

/**
 * Phase 20 — 공식 catalog 순서 SSOT (apply 도구 실행 아님).
 */

const pub = require('./production-public-migration-core');
const di = require('./daily-issue-production-migration-core');

const OFFICIAL_PUBLIC_REQUIRED_FILES = Object.freeze(pub.REQUIRED.map(function (e) {
  return e.fileName;
}));

const OFFICIAL_DAILY_ISSUE_FILES = Object.freeze(
  di.MIGRATION_FILES.map(function (e) {
    return e.fileName;
  }),
);

/** 스테이징 전용. production daily_issue catalog 6개에 미포함. 운영 catalog 자동 승격 금지. */
const STAGING_DAILY_ISSUE_EXTENSIONS = Object.freeze([
  'migration_daily_issue_us_region_candidate.sql',
  'migration_daily_issue_phase19_safety_v1.sql',
]);

const PLAN_ONLY_PUBLIC_FILES = Object.freeze(['migration_activity_region_v2.sql']);

const CANDIDATE_ONLY_PUBLIC_FILES = Object.freeze([
  'migration_activity_region_plan.sql',
  'migration_activity_region_legal_consent_candidate.sql',
]);

const DO_NOT_APPLY_PUBLIC_FILES = Object.freeze(
  pub.DO_NOT_APPLY.map(function (e) {
    return e.fileName;
  }),
);

/** activity-region-auth-env: 공식 public subset + PLAN ONLY v2 (user_data_system 제외). */
const ACTIVITY_REGION_TEST_PUBLIC_FILES = Object.freeze([
  'schema_profiles_identity_history.sql',
  'migration_handle_new_user_emailless_oauth.sql',
  'migration_canonical_user_territory.sql',
  'migration_canonical_territory_central_start.sql',
  'migration_board_core_system.sql',
  'migration_political_alignment_persistence.sql',
  'migration_activity_region_v2.sql',
]);

module.exports = {
  OFFICIAL_PUBLIC_REQUIRED_FILES: OFFICIAL_PUBLIC_REQUIRED_FILES,
  OFFICIAL_DAILY_ISSUE_FILES: OFFICIAL_DAILY_ISSUE_FILES,
  STAGING_DAILY_ISSUE_EXTENSIONS: STAGING_DAILY_ISSUE_EXTENSIONS,
  STAGING_DAILY_ISSUE_ALL: Object.freeze(OFFICIAL_DAILY_ISSUE_FILES.concat(STAGING_DAILY_ISSUE_EXTENSIONS)),
  PLAN_ONLY_PUBLIC_FILES: PLAN_ONLY_PUBLIC_FILES,
  CANDIDATE_ONLY_PUBLIC_FILES: CANDIDATE_ONLY_PUBLIC_FILES,
  DO_NOT_APPLY_PUBLIC_FILES: DO_NOT_APPLY_PUBLIC_FILES,
  ACTIVITY_REGION_TEST_PUBLIC_FILES: ACTIVITY_REGION_TEST_PUBLIC_FILES,
};
