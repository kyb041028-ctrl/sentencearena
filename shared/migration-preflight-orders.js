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

/** Not in official apply. Each file runs only with its own confirm value. Isolated local boots may apply this list. */
const STAGING_DAILY_ISSUE_EXTENSIONS = Object.freeze(
  di.EXTENSION_MIGRATION_FILES.map(function (e) {
    return e.fileName;
  }),
);

const PLAN_ONLY_PUBLIC_FILES = Object.freeze(['migration_activity_region_v2.sql']);

const CANDIDATE_ONLY_PUBLIC_FILES = Object.freeze([
  'migration_activity_region_plan.sql',
  'migration_activity_region_legal_consent_candidate.sql',
  'migration_activity_region_board_scope_candidate.sql',
  'migration_activity_region_progression_scope_candidate.sql',
]);

const DO_NOT_APPLY_PUBLIC_FILES = Object.freeze(
  pub.DO_NOT_APPLY.map(function (e) {
    return e.fileName;
  }),
);

const OFFICIAL_PUBLIC_REQUIRED_COUNT = OFFICIAL_PUBLIC_REQUIRED_FILES.length;

/** Staging apply order after official public REQUIRED (not in production-public REQUIRED). */
const STAGING_ACTIVITY_REGION_CANDIDATES = Object.freeze([
  'migration_activity_region_board_scope_candidate.sql',
  'migration_activity_region_progression_scope_candidate.sql',
]);

/** Official public 22 + staging board/progression candidates (no PLAN v2, no user_data stub). */
const ACTIVITY_REGION_PREFLIGHT_PUBLIC_FILES = Object.freeze(
  OFFICIAL_PUBLIC_REQUIRED_FILES.concat(STAGING_ACTIVITY_REGION_CANDIDATES),
);

/** @deprecated use ACTIVITY_REGION_PREFLIGHT_PUBLIC_FILES — subset test only */
const ACTIVITY_REGION_TEST_PUBLIC_FILES = Object.freeze([
  'schema_profiles_identity_history.sql',
  'migration_handle_new_user_emailless_oauth.sql',
  'migration_canonical_user_territory.sql',
  'migration_canonical_territory_central_start.sql',
  'migration_board_core_system.sql',
  'migration_political_alignment_persistence.sql',
  'migration_activity_region_board_scope_candidate.sql',
  'migration_activity_region_progression_scope_candidate.sql',
]);

module.exports = {
  OFFICIAL_PUBLIC_REQUIRED_FILES: OFFICIAL_PUBLIC_REQUIRED_FILES,
  OFFICIAL_DAILY_ISSUE_FILES: OFFICIAL_DAILY_ISSUE_FILES,
  STAGING_DAILY_ISSUE_EXTENSIONS: STAGING_DAILY_ISSUE_EXTENSIONS,
  STAGING_DAILY_ISSUE_ALL: Object.freeze(OFFICIAL_DAILY_ISSUE_FILES.concat(STAGING_DAILY_ISSUE_EXTENSIONS)),
  PLAN_ONLY_PUBLIC_FILES: PLAN_ONLY_PUBLIC_FILES,
  CANDIDATE_ONLY_PUBLIC_FILES: CANDIDATE_ONLY_PUBLIC_FILES,
  DO_NOT_APPLY_PUBLIC_FILES: DO_NOT_APPLY_PUBLIC_FILES,
  OFFICIAL_PUBLIC_REQUIRED_COUNT: OFFICIAL_PUBLIC_REQUIRED_COUNT,
  STAGING_ACTIVITY_REGION_CANDIDATES: STAGING_ACTIVITY_REGION_CANDIDATES,
  ACTIVITY_REGION_PREFLIGHT_PUBLIC_FILES: ACTIVITY_REGION_PREFLIGHT_PUBLIC_FILES,
  ACTIVITY_REGION_TEST_PUBLIC_FILES: ACTIVITY_REGION_TEST_PUBLIC_FILES,
};
