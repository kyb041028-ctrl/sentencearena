-- =============================================================================
-- daily_issue staging catalog, file 7.
-- Adds activity_region. NULL stays KR-compatible and is not bulk-updated here.
-- A column CHECK does not make a child row match its parent issue.
-- Comments and reactions copy the parent region when theirs is null,
-- reject a different explicit region, and follow a later parent change.
-- Scheduler runs are not children of a review item.
-- =============================================================================

ALTER TABLE public.daily_issue_review_items
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

ALTER TABLE public.daily_issue_comments
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

ALTER TABLE public.daily_issue_reactions
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

ALTER TABLE public.daily_issue_scheduler_runs
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

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

CREATE OR REPLACE FUNCTION public.daily_issue_child_region_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_region text;
BEGIN
  SELECT activity_region INTO parent_region
  FROM public.daily_issue_review_items
  WHERE id = NEW.issue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'daily_issue_parent_missing';
  END IF;
  IF NEW.activity_region IS NULL THEN
    NEW.activity_region := parent_region;
    RETURN NEW;
  END IF;
  IF parent_region IS NULL THEN
    IF NEW.activity_region <> 'KR' THEN
      RAISE EXCEPTION 'daily_issue_region_mismatch';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.activity_region IS DISTINCT FROM parent_region THEN
    RAISE EXCEPTION 'daily_issue_region_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.daily_issue_child_region_match() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.daily_issue_parent_region_cascade()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.activity_region IS DISTINCT FROM OLD.activity_region THEN
    UPDATE public.daily_issue_comments
      SET activity_region = NEW.activity_region
      WHERE issue_id = NEW.id;
    UPDATE public.daily_issue_reactions
      SET activity_region = NEW.activity_region
      WHERE issue_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.daily_issue_parent_region_cascade() FROM PUBLIC;

DROP TRIGGER IF EXISTS daily_issue_comments_region_match ON public.daily_issue_comments;
CREATE TRIGGER daily_issue_comments_region_match
  BEFORE INSERT OR UPDATE OF activity_region, issue_id
  ON public.daily_issue_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.daily_issue_child_region_match();

DROP TRIGGER IF EXISTS daily_issue_reactions_region_match ON public.daily_issue_reactions;
CREATE TRIGGER daily_issue_reactions_region_match
  BEFORE INSERT OR UPDATE OF activity_region, issue_id
  ON public.daily_issue_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.daily_issue_child_region_match();

DROP TRIGGER IF EXISTS daily_issue_review_items_region_cascade ON public.daily_issue_review_items;
CREATE TRIGGER daily_issue_review_items_region_cascade
  AFTER UPDATE OF activity_region
  ON public.daily_issue_review_items
  FOR EACH ROW
  EXECUTE FUNCTION public.daily_issue_parent_region_cascade();
