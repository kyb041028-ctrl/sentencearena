-- =============================================================================
-- Account withdrawal v1 (additive)
-- =============================================================================
-- - No DROP TABLE / TRUNCATE / DELETE FROM of existing content rows
-- - Makes public-content author FKs nullable + ON DELETE SET NULL
-- - Snapshot reaction counts on posts/comments are NOT decremented on withdraw
-- - Completed audit rows contain no user_id / email / OAuth ids
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nullable public-content authors
-- -----------------------------------------------------------------------------
ALTER TABLE public.board_posts
  ALTER COLUMN author_user_id DROP NOT NULL;

ALTER TABLE public.board_comments
  ALTER COLUMN author_user_id DROP NOT NULL;

ALTER TABLE public.board_reactions
  ALTER COLUMN target_author_user_id DROP NOT NULL;

ALTER TABLE public.board_reports
  ALTER COLUMN reporter_user_id DROP NOT NULL;

ALTER TABLE public.board_reports
  ALTER COLUMN target_author_user_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.board_posts DROP CONSTRAINT IF EXISTS board_posts_author_user_id_fkey;
  ALTER TABLE public.board_posts
    ADD CONSTRAINT board_posts_author_user_id_fkey
    FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.board_posts DROP CONSTRAINT IF EXISTS board_posts_deleted_by_fkey;
  ALTER TABLE public.board_posts
    ADD CONSTRAINT board_posts_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.board_comments DROP CONSTRAINT IF EXISTS board_comments_author_user_id_fkey;
  ALTER TABLE public.board_comments
    ADD CONSTRAINT board_comments_author_user_id_fkey
    FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.board_comments DROP CONSTRAINT IF EXISTS board_comments_deleted_by_fkey;
  ALTER TABLE public.board_comments
    ADD CONSTRAINT board_comments_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.board_reactions DROP CONSTRAINT IF EXISTS board_reactions_actor_user_id_fkey;
  ALTER TABLE public.board_reactions
    ADD CONSTRAINT board_reactions_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  ALTER TABLE public.board_reactions DROP CONSTRAINT IF EXISTS board_reactions_target_author_user_id_fkey;
  ALTER TABLE public.board_reactions
    ADD CONSTRAINT board_reactions_target_author_user_id_fkey
    FOREIGN KEY (target_author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.board_reports DROP CONSTRAINT IF EXISTS board_reports_reporter_user_id_fkey;
  ALTER TABLE public.board_reports
    ADD CONSTRAINT board_reports_reporter_user_id_fkey
    FOREIGN KEY (reporter_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.board_reports DROP CONSTRAINT IF EXISTS board_reports_target_author_user_id_fkey;
  ALTER TABLE public.board_reports
    ADD CONSTRAINT board_reports_target_author_user_id_fkey
    FOREIGN KEY (target_author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.board_reports DROP CONSTRAINT IF EXISTS board_reports_reviewed_by_fkey;
  ALTER TABLE public.board_reports
    ADD CONSTRAINT board_reports_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

COMMENT ON COLUMN public.board_posts.author_user_id IS
  'Author auth.users.id. NULL after account withdrawal (display: 탈퇴한 사용자).';
COMMENT ON COLUMN public.board_comments.author_user_id IS
  'Comment author. NULL after account withdrawal.';

-- -----------------------------------------------------------------------------
-- 2. Pending job (short-lived, CASCADE when auth user is deleted)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_withdrawal_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_withdrawal_jobs_status_chk CHECK (status IN ('PENDING', 'ANONYMIZED', 'FAILED'))
);

COMMENT ON TABLE public.account_withdrawal_jobs IS
  'Short-lived withdraw lock. user_id is removed when auth.users is deleted.';

ALTER TABLE public.account_withdrawal_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_withdrawal_jobs FROM PUBLIC;
REVOKE ALL ON public.account_withdrawal_jobs FROM authenticated;
GRANT ALL ON public.account_withdrawal_jobs TO service_role;
GRANT ALL ON public.account_withdrawal_jobs TO postgres;

-- -----------------------------------------------------------------------------
-- 3. Non-identifying completion audit
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_withdrawal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawn_at timestamptz NOT NULL DEFAULT now(),
  withdrawal_policy_version text NOT NULL,
  privacy_policy_version text NULL,
  anonymized_post_count integer NOT NULL DEFAULT 0,
  anonymized_board_comment_count integer NOT NULL DEFAULT 0,
  anonymized_daily_issue_comment_count integer NOT NULL DEFAULT 0,
  anonymized_report_count integer NOT NULL DEFAULT 0,
  deleted_record_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_deleted boolean NOT NULL DEFAULT false,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_withdrawal_audit_counts_nonneg CHECK (
    anonymized_post_count >= 0
    AND anonymized_board_comment_count >= 0
    AND anonymized_daily_issue_comment_count >= 0
    AND anonymized_report_count >= 0
  ),
  CONSTRAINT account_withdrawal_audit_result_chk CHECK (
    result IN ('COMPLETED', 'ANONYMIZED', 'AUTH_DELETE_FAILED', 'FAILED')
  )
);

COMMENT ON TABLE public.account_withdrawal_audit IS
  'Non-identifying withdraw completion log. No user_id, email, or OAuth identifiers.';

ALTER TABLE public.account_withdrawal_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_withdrawal_audit FROM PUBLIC;
REVOKE ALL ON public.account_withdrawal_audit FROM authenticated;
GRANT ALL ON public.account_withdrawal_audit TO service_role;
GRANT ALL ON public.account_withdrawal_audit TO postgres;

ALTER TABLE public.account_withdrawal_jobs
  ADD COLUMN IF NOT EXISTS last_audit_id uuid NULL REFERENCES public.account_withdrawal_audit(id);

-- -----------------------------------------------------------------------------
-- 4. Anonymize + private-row delete (called before auth.admin.deleteUser)
-- Snapshot counts on posts/comments are intentionally not decremented.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_account_anonymize(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_posts integer := 0;
  v_comments integer := 0;
  v_di_comments integer := 0;
  v_reports integer := 0;
  v_deleted jsonb := '{}'::jsonb;
  v_n integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'WITHDRAW_USER_ID_INVALID';
  END IF;

  SELECT count(*)::integer INTO v_posts
  FROM public.board_posts WHERE author_user_id = p_user_id;
  UPDATE public.board_posts
    SET author_user_id = NULL, updated_at = now()
    WHERE author_user_id = p_user_id;
  UPDATE public.board_posts SET deleted_by = NULL WHERE deleted_by = p_user_id;

  SELECT count(*)::integer INTO v_comments
  FROM public.board_comments WHERE author_user_id = p_user_id;
  UPDATE public.board_comments
    SET author_user_id = NULL, updated_at = now()
    WHERE author_user_id = p_user_id;
  UPDATE public.board_comments SET deleted_by = NULL WHERE deleted_by = p_user_id;

  SELECT count(*)::integer INTO v_reports
  FROM public.board_reports
  WHERE reporter_user_id = p_user_id OR target_author_user_id = p_user_id;
  UPDATE public.board_reports SET reporter_user_id = NULL WHERE reporter_user_id = p_user_id;
  UPDATE public.board_reports SET target_author_user_id = NULL WHERE target_author_user_id = p_user_id;
  UPDATE public.board_reports SET reviewed_by = NULL WHERE reviewed_by = p_user_id;

  DELETE FROM public.board_reactions WHERE actor_user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('board_reactions_actor', v_n);
  UPDATE public.board_reactions
    SET target_author_user_id = NULL
    WHERE target_author_user_id = p_user_id;

  IF to_regclass('daily_issue.daily_issue_comments') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer FROM daily_issue.daily_issue_comments WHERE user_id = $1'
      INTO v_di_comments USING p_user_id;
    EXECUTE 'UPDATE daily_issue.daily_issue_comments SET user_id = NULL, updated_at = now() WHERE user_id = $1'
      USING p_user_id;
  ELSIF to_regclass('public.daily_issue_comments') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_di_comments
    FROM public.daily_issue_comments WHERE user_id = p_user_id;
    UPDATE public.daily_issue_comments
      SET user_id = NULL, updated_at = now()
      WHERE user_id = p_user_id;
  END IF;

  IF to_regclass('daily_issue.daily_issue_reactions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM daily_issue.daily_issue_reactions WHERE user_id = $1' USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('daily_issue_reactions', v_n);
  ELSIF to_regclass('public.daily_issue_reactions') IS NOT NULL THEN
    DELETE FROM public.daily_issue_reactions WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('daily_issue_reactions', v_n);
  END IF;

  IF to_regclass('public.user_moderation_events') IS NOT NULL THEN
    UPDATE public.user_moderation_events SET created_by = NULL WHERE created_by = p_user_id;
  END IF;

  -- Private account rows. CASCADE would also remove them on auth delete; delete here for counts.
  IF to_regclass('public.user_alignment_state') IS NOT NULL THEN
    DELETE FROM public.user_alignment_state WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_alignment_state', v_n);
  END IF;
  IF to_regclass('public.alignment_history') IS NOT NULL THEN
    DELETE FROM public.alignment_history WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('alignment_history', v_n);
  END IF;
  IF to_regclass('public.alignment_territory_history') IS NOT NULL THEN
    DELETE FROM public.alignment_territory_history WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('alignment_territory_history', v_n);
  END IF;
  IF to_regclass('public.user_progression_events') IS NOT NULL THEN
    DELETE FROM public.user_progression_events WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_progression_events', v_n);
  END IF;
  IF to_regclass('public.user_progression') IS NOT NULL THEN
    DELETE FROM public.user_progression WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_progression', v_n);
  END IF;
  IF to_regclass('public.user_featured_achievements') IS NOT NULL THEN
    DELETE FROM public.user_featured_achievements WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_featured_achievements', v_n);
  END IF;
  IF to_regclass('public.user_achievements') IS NOT NULL THEN
    DELETE FROM public.user_achievements WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_achievements', v_n);
  END IF;
  IF to_regclass('public.user_moderation_notifications') IS NOT NULL THEN
    DELETE FROM public.user_moderation_notifications WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_moderation_notifications', v_n);
  END IF;
  IF to_regclass('public.user_moderation_events') IS NOT NULL THEN
    DELETE FROM public.user_moderation_events WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_moderation_events', v_n);
  END IF;
  IF to_regclass('public.user_moderation_state') IS NOT NULL THEN
    DELETE FROM public.user_moderation_state WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_moderation_state', v_n);
  END IF;
  IF to_regclass('public.identity_history') IS NOT NULL THEN
    DELETE FROM public.identity_history WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('identity_history', v_n);
  END IF;
  IF to_regclass('public.user_follows') IS NOT NULL THEN
    DELETE FROM public.user_follows
      WHERE follower_user_id = p_user_id OR following_user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_follows', v_n);
  END IF;
  IF to_regclass('public.user_bookmarks') IS NOT NULL THEN
    DELETE FROM public.user_bookmarks WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_bookmarks', v_n);
  END IF;
  IF to_regclass('public.user_notifications') IS NOT NULL THEN
    DELETE FROM public.user_notifications WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_notifications', v_n);
  END IF;
  IF to_regclass('public.user_activity_events') IS NOT NULL THEN
    DELETE FROM public.user_activity_events WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_activity_events', v_n);
  END IF;
  IF to_regclass('public.user_domain_event_log') IS NOT NULL THEN
    UPDATE public.user_domain_event_log SET actor_user_id = NULL WHERE actor_user_id = p_user_id;
    DELETE FROM public.user_domain_event_log WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('user_domain_event_log', v_n);
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('profiles', v_n);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'anonymized_post_count', v_posts,
    'anonymized_board_comment_count', v_comments,
    'anonymized_daily_issue_comment_count', v_di_comments,
    'anonymized_report_count', v_reports,
    'deleted_record_counts', v_deleted
  );
END;
$$;

COMMENT ON FUNCTION public.withdraw_account_anonymize(uuid) IS
  'Account withdrawal: anonymize public content, delete private rows. No snapshot count decrement. Called before auth.users delete.';

REVOKE ALL ON FUNCTION public.withdraw_account_anonymize(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_account_anonymize(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_account_anonymize(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_account_anonymize(uuid) TO postgres;
