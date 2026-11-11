-- PROPOSAL ONLY. Not in the Daily Issue apply catalog.
-- Do not execute against DEV or production.
-- Rewrite maps the public schema prefix onto schema daily_issue.
-- Constraint existence must follow that table, including inside DO blocks.
-- No privilege expansion.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_issue_review_items_alignment_direction_chk'
      AND conrelid = 'public.daily_issue_review_items'::regclass
  ) THEN
    ALTER TABLE public.daily_issue_review_items
      ADD CONSTRAINT daily_issue_review_items_alignment_direction_chk
      CHECK (
        alignment_direction IS NULL
        OR alignment_direction IN ('PIONEER', 'GUARDIAN', 'NEUTRAL')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_issue_review_items_activity_region_chk'
      AND conrelid = 'public.daily_issue_review_items'::regclass
  ) THEN
    ALTER TABLE public.daily_issue_review_items
      ADD CONSTRAINT daily_issue_review_items_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_issue_comments_activity_region_chk'
      AND conrelid = 'public.daily_issue_comments'::regclass
  ) THEN
    ALTER TABLE public.daily_issue_comments
      ADD CONSTRAINT daily_issue_comments_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_issue_reactions_activity_region_chk'
      AND conrelid = 'public.daily_issue_reactions'::regclass
  ) THEN
    ALTER TABLE public.daily_issue_reactions
      ADD CONSTRAINT daily_issue_reactions_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_issue_scheduler_runs_activity_region_chk'
      AND conrelid = 'public.daily_issue_scheduler_runs'::regclass
  ) THEN
    ALTER TABLE public.daily_issue_scheduler_runs
      ADD CONSTRAINT daily_issue_scheduler_runs_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
END $$;
