-- =============================================================================
-- BETA DAILY ISSUE ALIGNMENT SEED V1 (additive, development)
-- =============================================================================
-- alignment_direction is classification metadata only.
-- Does not change quality/freshness/duplicate/publication selection.
-- Does not backfill existing issues to PIONEER/GUARDIAN.
-- No DROP / TRUNCATE / DELETE FROM.
-- =============================================================================

ALTER TABLE public.daily_issue_review_items
  ADD COLUMN IF NOT EXISTS alignment_direction text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_issue_review_items_alignment_direction_chk'
  ) THEN
    ALTER TABLE public.daily_issue_review_items
      ADD CONSTRAINT daily_issue_review_items_alignment_direction_chk
      CHECK (
        alignment_direction IS NULL
        OR alignment_direction IN ('PIONEER', 'GUARDIAN', 'NEUTRAL')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.daily_issue_review_items.alignment_direction IS
  'Internal Daily Issue political direction metadata: PIONEER | GUARDIAN | NEUTRAL. NULL reads as NEUTRAL. Not a publish quota.';

CREATE TABLE IF NOT EXISTS public.daily_issue_reactions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  issue_id text NOT NULL REFERENCES public.daily_issue_review_items(id),
  reaction_type text NOT NULL,
  issue_alignment_direction_at_reaction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz NULL,
  CONSTRAINT daily_issue_reactions_type_chk CHECK (reaction_type IN ('LIKE', 'DISLIKE')),
  CONSTRAINT daily_issue_reactions_direction_chk CHECK (
    issue_alignment_direction_at_reaction IN ('PIONEER', 'GUARDIAN', 'NEUTRAL')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_issue_reactions_one_active
  ON public.daily_issue_reactions (user_id, issue_id)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_issue_reactions_user_created
  ON public.daily_issue_reactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_issue_reactions_issue
  ON public.daily_issue_reactions (issue_id);

COMMENT ON TABLE public.daily_issue_reactions IS
  'Canonical Daily Issue LIKE/DISLIKE. Snapshot issue direction at reaction time. Active row one per user+issue.';

ALTER TABLE public.daily_issue_reactions ENABLE ROW LEVEL SECURITY;
