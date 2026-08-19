-- =============================================================================
-- Daily Issue account withdrawal (additive)
-- SQL uses public schema daily_issue_* names; production rewriter maps to daily_issue schema.
-- No DROP TABLE / TRUNCATE / content DELETE.
-- =============================================================================

ALTER TABLE public.daily_issue_comments
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.daily_issue_comments DROP CONSTRAINT IF EXISTS daily_issue_comments_user_id_fkey;
  ALTER TABLE public.daily_issue_comments
    ADD CONSTRAINT daily_issue_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.daily_issue_reactions DROP CONSTRAINT IF EXISTS daily_issue_reactions_user_id_fkey;
  ALTER TABLE public.daily_issue_reactions
    ADD CONSTRAINT daily_issue_reactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

COMMENT ON COLUMN public.daily_issue_comments.user_id IS
  'Comment author. NULL after account withdrawal (display: 탈퇴한 사용자).';
