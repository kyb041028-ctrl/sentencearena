-- =============================================================================
-- Additive: board_posts.is_official
-- Server-trusted official post flag. Default false.
-- Existing rows stay false. No title backfill. No TRUNCATE / DROP / DELETE.
-- Authenticated/anon cannot set or change this column; service_role only.
-- Production apply is not part of this file. Do not run against Production here.
-- =============================================================================

ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.board_posts.is_official IS
  'Trusted official-content flag. true only when an operator tool/service_role sets it. Default false. Title text is not a source of truth.';

CREATE OR REPLACE FUNCTION public.protect_board_posts_is_official()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      NEW.is_official := false;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      NEW.is_official := OLD.is_official;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_board_posts_is_official() IS
  'Browser/authenticated cannot set board_posts.is_official. Service_role may set it on insert.';

DROP TRIGGER IF EXISTS trg_protect_board_posts_is_official ON public.board_posts;
CREATE TRIGGER trg_protect_board_posts_is_official
BEFORE INSERT OR UPDATE ON public.board_posts
FOR EACH ROW
EXECUTE PROCEDURE public.protect_board_posts_is_official();
