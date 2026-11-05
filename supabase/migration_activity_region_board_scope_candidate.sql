-- =============================================================================
-- CANDIDATE ONLY — staging additive. Do not add to production-public REQUIRED
-- without owner approval.
--
-- Board scope only. See migration_activity_region_progression_scope_candidate.sql
-- for per-region profile/achievement tables (KR user_progression unchanged).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.activity_region_norm(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL OR btrim(value) = '' THEN 'KR'
    ELSE upper(btrim(value))
  END;
$$;

COMMENT ON FUNCTION public.activity_region_norm(text) IS
  'Empty or NULL reads as KR. US only when explicitly stored.';

ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS activity_region text;
ALTER TABLE public.board_comments
  ADD COLUMN IF NOT EXISTS activity_region text;
ALTER TABLE public.board_reactions
  ADD COLUMN IF NOT EXISTS activity_region text;

COMMENT ON COLUMN public.board_posts.activity_region IS
  'NULL means KR legacy row. US posts must be stored as US explicitly.';
COMMENT ON COLUMN public.board_comments.activity_region IS
  'Must match parent post region. NULL inherits from post on insert.';
COMMENT ON COLUMN public.board_reactions.activity_region IS
  'Must match target post region. NULL inherits on insert.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_posts_activity_region_chk'
  ) THEN
    ALTER TABLE public.board_posts
      ADD CONSTRAINT board_posts_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_comments_activity_region_chk'
  ) THEN
    ALTER TABLE public.board_comments
      ADD CONSTRAINT board_comments_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_reactions_activity_region_chk'
  ) THEN
    ALTER TABLE public.board_reactions
      ADD CONSTRAINT board_reactions_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS board_posts_activity_region_created_idx
  ON public.board_posts ((COALESCE(activity_region, 'KR')), created_at DESC);
CREATE INDEX IF NOT EXISTS board_comments_activity_region_created_idx
  ON public.board_comments ((COALESCE(activity_region, 'KR')), created_at DESC);
CREATE INDEX IF NOT EXISTS board_reactions_activity_region_created_idx
  ON public.board_reactions ((COALESCE(activity_region, 'KR')), created_at DESC);

CREATE OR REPLACE FUNCTION public.board_comment_same_activity_region()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_region text;
BEGIN
  SELECT activity_region INTO parent_region
  FROM public.board_posts
  WHERE id = NEW.post_id;
  IF NEW.activity_region IS NULL OR btrim(NEW.activity_region) = '' THEN
    NEW.activity_region := parent_region;
  ELSIF public.activity_region_norm(NEW.activity_region)
        IS DISTINCT FROM public.activity_region_norm(parent_region) THEN
    RAISE EXCEPTION 'REGION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS board_comments_same_activity_region ON public.board_comments;
CREATE TRIGGER board_comments_same_activity_region
  BEFORE INSERT OR UPDATE ON public.board_comments
  FOR EACH ROW
  EXECUTE PROCEDURE public.board_comment_same_activity_region();

CREATE OR REPLACE FUNCTION public.board_reaction_same_activity_region()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_region text;
BEGIN
  IF NEW.target_type = 'COMMENT' THEN
    SELECT p.activity_region INTO parent_region
    FROM public.board_comments c
    JOIN public.board_posts p ON p.id = c.post_id
    WHERE c.id = NEW.comment_id;
  ELSE
    SELECT activity_region INTO parent_region
    FROM public.board_posts
    WHERE id = NEW.post_id;
  END IF;
  IF NEW.activity_region IS NULL OR btrim(NEW.activity_region) = '' THEN
    NEW.activity_region := parent_region;
  ELSIF public.activity_region_norm(NEW.activity_region)
        IS DISTINCT FROM public.activity_region_norm(parent_region) THEN
    RAISE EXCEPTION 'REGION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS board_reactions_same_activity_region ON public.board_reactions;
CREATE TRIGGER board_reactions_same_activity_region
  BEFORE INSERT OR UPDATE ON public.board_reactions
  FOR EACH ROW
  EXECUTE PROCEDURE public.board_reaction_same_activity_region();
