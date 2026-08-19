-- =============================================================================
-- Daily Issue public comments (additive)
-- =============================================================================
-- - No DROP / TRUNCATE / DELETE FROM
-- - Does not alter review_items rows
-- - Does not write reaction or political seed tables
-- - issue_id FK = daily_issue_review_items.id (canonical PK)
-- - Soft delete via deleted_at (DELETE_XP_POLICY = PENDING)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_issue_comments (
  id text PRIMARY KEY,
  issue_id text NOT NULL REFERENCES public.daily_issue_review_items(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT daily_issue_comments_body_not_blank CHECK (length(trim(body)) > 0),
  CONSTRAINT daily_issue_comments_body_max_len CHECK (char_length(body) <= 1500)
);

CREATE INDEX IF NOT EXISTS idx_daily_issue_comments_issue_created
  ON public.daily_issue_comments (issue_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_issue_comments_user
  ON public.daily_issue_comments (user_id, created_at DESC);

COMMENT ON TABLE public.daily_issue_comments IS
  'Public Daily Issue comments. Soft-deleted rows kept for XP source ids.';
COMMENT ON COLUMN public.daily_issue_comments.issue_id IS
  'FK to daily_issue_review_items.id (stable row PK, not version-less candidate_id).';
COMMENT ON COLUMN public.daily_issue_comments.body IS
  'Plain text. Max 1500 chars, same as board comments. Render with textContent.';

ALTER TABLE public.daily_issue_comments ENABLE ROW LEVEL SECURITY;
