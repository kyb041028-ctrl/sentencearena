-- =============================================================================
-- Additive: profiles.territory = Earth membership (HOME), not board view.
-- =============================================================================
-- Scope: current Earth membership only. NULL = not yet chosen.
-- Allowed: PIONEER / CENTRAL / GUARDIAN. ALIEN/KANTAPBIYA rejected.
-- No DEFAULT. No backfill. No row UPDATE/DELETE. No DROP TABLE.
-- Political score / territory transition / history not in this migration.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS territory text NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_territory_earth_membership_chk;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_territory_earth_membership_chk
  CHECK (
    territory IS NULL
    OR territory IN ('PIONEER', 'CENTRAL', 'GUARDIAN')
  );

COMMENT ON COLUMN public.profiles.territory IS
  'Earth membership territory (HOME). PIONEER/CENTRAL/GUARDIAN or NULL if unset. Not board view. Not ALIEN.';

CREATE OR REPLACE FUNCTION public.protect_canonical_membership_territory()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.territory IS DISTINCT FROM OLD.territory THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'PROFILES_TERRITORY_CLIENT_WRITE_FORBIDDEN';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.territory IS NOT NULL THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'PROFILES_TERRITORY_CLIENT_WRITE_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_canonical_membership_territory ON public.profiles;
CREATE TRIGGER trg_protect_canonical_membership_territory
BEFORE INSERT OR UPDATE OF territory ON public.profiles
FOR EACH ROW
EXECUTE PROCEDURE public.protect_canonical_membership_territory();

COMMENT ON FUNCTION public.protect_canonical_membership_territory() IS
  'Browser/authenticated clients cannot write profiles.territory. Server/service_role only.';
