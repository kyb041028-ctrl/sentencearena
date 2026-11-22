-- Country beta apply runbook.
-- Entry point: supabase/migration_country_beta_apply.sql
-- This file is read-only. It does not apply the entry, does not change policies,
-- and does not connect by itself. Do not run it on production until a separate approval.
-- Do not run the older country migration files after the entry.
-- US rank refresh time and season length are not decided here.
-- US political alignment stays inactive. This entry does not create a US score table.

-- 1. Apply order inside supabase/migration_country_beta_apply.sql
-- 1. auth.uid and board_reaction_group, only when missing
-- 2. login profile, Korean legacy progression, Korean alignment score
-- 3. country profile, territory history, follows, board, achievement ledger
-- 4. activity_region_norm that keeps NULL unknown
-- 5. country progression, territory, empathy fame, follow
-- 6. toggle_board_reaction country path and legacy 0-score path
-- 7. reaction trigger that does not rewrite NULL to KR
-- 8. country_beta_require_column for the columns listed below
-- 9. country_beta_ensure_policy, which keeps an identical policy and raises
--    COUNTRY_BETA_POLICY_CONFLICT when the same name has a different scope
-- Before step 9, run tools/country-beta-policy-precheck.js against an approved
-- policy snapshot. If that command stops, do not run the entry.

-- 2. Existing tables and columns the entry expects when they already exist.
-- Missing columns of the expected type are added by country_beta_require_column.
-- A column that exists with a different type raises COUNTRY_BETA_COLUMN_TYPE_MISMATCH
-- and stops the entry. These checks are the pre-apply SQL.
SELECT c.table_name, c.column_name, c.data_type, c.udt_name
FROM (VALUES
  ('board_posts', 'activity_region', 'text'),
  ('board_comments', 'activity_region', 'text'),
  ('board_reactions', 'activity_region', 'text'),
  ('board_reactions', 'actor_alignment_score_at_reaction', 'numeric'),
  ('board_reactions', 'target_author_alignment_score_at_reaction', 'numeric'),
  ('user_follows', 'activity_region', 'text'),
  ('user_follows', 'territory_at_follow', 'text'),
  ('user_follows', 'cancelled_at', 'timestamp with time zone'),
  ('user_follows', 'last_cancelled_at', 'timestamp with time zone'),
  ('user_progression_events', 'activity_region', 'text'),
  ('user_progression_events', 'territory_at_event', 'text'),
  ('user_progression_events', 'cancelled_at', 'timestamp with time zone'),
  ('user_progression_events', 'last_cancelled_at', 'timestamp with time zone'),
  ('user_activity_region_profile', 'territory', 'text'),
  ('user_activity_region_profile', 'xp', 'bigint'),
  ('user_activity_region_profile', 'level', 'integer'),
  ('user_activity_region_profile', 'reputation_score', 'bigint'),
  ('user_legal_consents', 'territory_disclosure_consented_at', 'timestamp with time zone'),
  ('user_legal_consents', 'territory_disclosure_policy_version', 'text'),
  ('user_notifications', 'activity_region', 'text'),
  ('user_activity_events', 'activity_region', 'text')
) AS need(table_name, column_name, data_type)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = need.table_name
 AND c.column_name = need.column_name
ORDER BY need.table_name, need.column_name;

-- Stop before apply when a listed column exists and data_type/udt_name is not the expected type.
-- A missing column is not a stop. The entry adds it.
-- Also stop when public.user_follows has user_follows_unique or
-- user_follows_follower_user_id_following_user_id_key and the operator has not
-- confirmed that constraint is the old pair-only key. The entry drops those two
-- named constraints. This runbook does not drop them.

-- 3. Pre-apply policy export. Save the JSON and pass it to
-- node tools/country-beta-policy-precheck.js --snapshot <file>
-- Do not export this from production until that comparison is approved.
-- If the snapshot cannot be produced, the precheck returns
-- PRODUCTION_STRUCTURE_UNKNOWN and the apply stops.
SELECT cls.relname AS table_name,
       pol.polname AS policy_name,
       pol.polcmd AS command,
       pol.polpermissive AS permissive,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND cls.relname IN (
    'user_activity_region_profile',
    'user_activity_region_achievement',
    'country_territory_history',
    'user_follows',
    'board_posts',
    'user_legal_consents',
    'user_notifications',
    'user_activity_events'
  )
ORDER BY cls.relname, pol.polname;

-- 4. Stop conditions
-- PRODUCTION_STRUCTURE_UNKNOWN: no complete snapshot, or a required table is absent.
-- POLICY_SCOPE_MISMATCH: same policy name, different command, role, permissive flag,
--   USING, or WITH CHECK. Report both expressions. Do not drop and recreate.
-- POLICY_WOULD_REQUIRE_DROP: user_follows_select_all is present. Leave it in place.
-- COUNTRY_BETA_COLUMN_TYPE_MISMATCH: existing column type differs.
-- COUNTRY_BETA_POLICY_CONFLICT: the entry itself raises this and does not drop the policy.
-- Blank activity_region must stay NULL. If the current activity_region_norm turns a
-- blank value into KR, stop and do not apply a second copy of that function after the entry.
SELECT pg_get_functiondef(p.oid) AS activity_region_norm_def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'activity_region_norm';

-- 5. Post-apply checks. Run only after an approved apply on the approved database.
SELECT public.country_level_from_xp(30) AS level_for_xp_30,
       public.country_level_from_xp(40) AS level_for_xp_40,
       public.activity_region_norm('') AS blank_region,
       public.activity_region_norm(NULL) AS null_region;
-- Expected: level_for_xp_30 = 1, level_for_xp_40 = 2, blank_region NULL, null_region NULL.

SELECT pol.polname,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND pol.polname IN (
    'country_beta_profile_select_own',
    'country_beta_achievement_select_own',
    'country_beta_territory_select_own',
    'country_beta_follow_select_party',
    'country_beta_follow_insert_own',
    'country_beta_consent_select_own',
    'country_beta_notification_select_own',
    'country_beta_activity_select_own',
    'country_beta_post_country_update',
    'country_beta_post_country_insert',
    'board_posts_select_visible'
  )
ORDER BY pol.polname;
-- A listed policy that already existed with the same scope stays. A same name with
-- a different scope must have aborted the apply before this query.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name ILIKE '%alignment%'
  AND table_name ILIKE '%us%';
-- Expected: no rows. The Korean table public.user_alignment_state is not a US score table.

-- 6. Recovery
-- Take a database backup before the approved apply. If the apply stops, keep the
-- failed transaction rolled back and do not continue with an older country file.
-- Restore the backup if a change was committed outside a transaction.
-- Do not recover by dropping a policy and creating it again.
-- Do not delete country profile rows, achievement rows, or legal consent rows to recover.
-- Login id remains the shared identity. Do not copy a row with a blank country into KR or US.
